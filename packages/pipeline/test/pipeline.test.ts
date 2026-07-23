import { describe, it, expect } from 'vitest'
import { Pipeline } from '../src/state-machine'
import type { PipelineEvent } from '../src/types'
import { InMemoryConversationStorage } from '@kibotalk/conversation'
import { MockStt, MockLlm, candidate, seg } from './mocks'

function recordEvents(pipeline: Pipeline, want: PipelineEvent['type'][] = []) {
  const events: PipelineEvent[] = []
  pipeline.on((e) => {
    if (want.length === 0 || want.includes(e.type)) events.push(e)
  })
  return events
}

const noSleep = async () => {}

describe('Pipeline state machine — spec §2.4 rules 1–8', () => {
  it('rule 1: other segment → append other turn → stream candidates', async () => {
    const stt = new MockStt(['こんにちは'])
    const llm = new MockLlm([
      [
        { type: 'candidate-start', index: 0 },
        candidate(0, '你好', 'こんにちは', 'konnichiwa'),
        { type: 'candidate-start', index: 1 },
        candidate(1, '您好', 'こんにちは', 'konnichiwa'),
        { type: 'candidate-start', index: 2 },
        candidate(2, '哈喽', 'こんにちは', 'konnichiwa'),
        { type: 'done' },
      ],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['turnAppended', 'candidatesDone', 'state'])

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()

    const turns = await conversation.loadActiveSession()
    expect(turns).toHaveLength(1)
    expect(turns![0]).toMatchObject({ speaker: 'other', text: 'こんにちは' })
    expect(events).toContainEqual({ type: 'turnAppended', turn: turns![0] })
    const done = events.find((e) => e.type === 'candidatesDone')!
    expect(done.type).toBe('candidatesDone')
    if (done.type === 'candidatesDone') expect(done.candidates).toHaveLength(3)
    expect(pipeline.getState()).toBe('IDLE')
  })

  it('rule 2: interruption — new other segment aborts in-flight LLM and discards partials', async () => {
    const stt = new MockStt(['first', 'second'])
    const llm = new MockLlm([
      // first LLM: emits one candidate then blocks on a gate (mid-stream)
      [
        { type: 'candidate-start', index: 0 },
        candidate(0, '一', '一', 'ichi'),
        { gate: 'block' },
      ],
      // second LLM (after interruption)
      [
        { type: 'candidate-start', index: 0 },
        candidate(0, '二', '二', 'ni'),
        { type: 'done' },
      ],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['candidatesDone', 'llmAborted', 'candidateDelta'])

    await pipeline.ingestSegment(seg('other', 1000)) // append first, start LLM
    await llm.gateEntered('block') // ensure first LLM is mid-stream
    await pipeline.ingestSegment(seg('other', 3000)) // abort first, append second, start new LLM
    await pipeline.idle()
    llm.resolveGate('block') // let orphaned first generator return
    await new Promise((r) => setTimeout(r, 0)) // flush orphaned generator

    expect(events.some((e) => e.type === 'llmAborted')).toBe(true)
    expect(llm.abortedCalls[0]).toBe(true)
    const done = events.filter((e) => e.type === 'candidatesDone')
    expect(done).toHaveLength(1)
    if (done[0].type === 'candidatesDone') {
      expect(done[0].candidates).toHaveLength(1)
      expect(done[0].candidates[0].meaningZh).toBe('二')
    }
    const turns = await conversation.loadActiveSession()
    expect(turns).toHaveLength(2)
  })

  it('rule 3: multi-turn no user — each other segment triggers a fresh LLM', async () => {
    const stt = new MockStt(['a', 'b', 'c'])
    const llm = new MockLlm([
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'a', targetText: 'a', reading: 'a' } }, { type: 'done' }],
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'b', targetText: 'b', reading: 'b' } }, { type: 'done' }],
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'c', targetText: 'c', reading: 'c' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.ingestSegment(seg('other', 3000))
    await pipeline.ingestSegment(seg('other', 5000))
    await pipeline.idle()

    expect(llm.callCount).toBe(3)
    const turns = await conversation.loadActiveSession()
    expect(turns!.map((t) => t.text)).toEqual(['a', 'b', 'c'])
  })

  it('rule 4: interrupted partials do not enter next LLM context', async () => {
    const stt = new MockStt(['first', 'second'])
    const llm = new MockLlm([
      [{ type: 'candidate-start', index: 0 }, candidate(0, 'partial', 'p', 'p'), { gate: 'block' }],
      [{ type: 'candidate-start', index: 0 }, candidate(0, 'full', 'f', 'f'), { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })

    await pipeline.ingestSegment(seg('other', 1000))
    await llm.gateEntered('block')
    await pipeline.ingestSegment(seg('other', 3000))
    await pipeline.idle()
    llm.resolveGate('block')

    const ctx = llm.receivedContexts[1]
    expect(ctx).toHaveLength(2)
    expect(ctx.every((t) => t.suggestions === undefined || t.suggestions.length === 0)).toBe(true)
    const turns = await conversation.loadActiveSession()
    expect(turns![0].suggestions).toBeUndefined()
  })

  it('rule 5: user抢说 — interrupted other appended (no LLM); user segment triggers LLM', async () => {
    const stt = new MockStt(['other-partial', 'user-actual'])
    const llm = new MockLlm([
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: '续', targetText: 'つづき', reading: 'tsuzuki' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['candidatesStreaming', 'candidatesDone', 'turnAppended'])

    await pipeline.ingestSegment(seg('other', 1000, 1500, true))
    await pipeline.ingestSegment(seg('user', 1500, 2500))
    await pipeline.idle()

    expect(llm.callCount).toBe(1)
    expect(events.some((e) => e.type === 'candidatesDone')).toBe(true)
    const turns = await conversation.loadActiveSession()
    expect(turns!.map((t) => t.speaker)).toEqual(['other', 'user'])
    expect(turns!.map((t) => t.text)).toEqual(['other-partial', 'user-actual'])
  })

  it('rule 5 (alt): user抢说 during LLM_STREAMING aborts LLM then user turn triggers new LLM', async () => {
    const stt = new MockStt(['other', 'user抢说'])
    const llm = new MockLlm([
      [{ type: 'candidate-start', index: 0 }, candidate(0, 'partial', 'p', 'p'), { gate: 'block' }],
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'user', targetText: 'u', reading: 'u' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['llmAborted', 'candidatesDone', 'candidatesStreaming'])

    await pipeline.ingestSegment(seg('other', 1000))
    await llm.gateEntered('block')
    await pipeline.ingestSegment(seg('user', 3000))
    await pipeline.idle()
    llm.resolveGate('block')

    expect(events.some((e) => e.type === 'llmAborted')).toBe(true)
    expect(llm.callCount).toBe(2)
    const done = events.filter((e) => e.type === 'candidatesDone')
    expect(done).toHaveLength(1)
    const turns = await conversation.loadActiveSession()
    expect(turns!.map((t) => t.speaker)).toEqual(['other', 'user'])
  })

  it('rule 6: STT failure retries once then appends sttFailed turn and still triggers LLM', async () => {
    const stt = new MockStt([new Error('stt down'), new Error('stt down again')])
    const llm = new MockLlm([
      [{ type: 'done' }], // model may return []
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['sttFailed', 'turnAppended', 'candidatesDone'])

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()

    expect(stt.callCount).toBe(2)
    expect(events.some((e) => e.type === 'sttFailed')).toBe(true)
    expect(llm.callCount).toBe(1)
    expect(events.some((e) => e.type === 'candidatesDone')).toBe(true)
    const turns = await conversation.loadActiveSession()
    expect(turns).toHaveLength(1)
    expect(turns![0].sttFailed).toBe(true)
    expect(turns![0].text).toBe('')

    stt.results.push('recovered')
    llm.scripts.push([{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'r', targetText: 'r', reading: 'r' } }, { type: 'done' }])
    await pipeline.ingestSegment(seg('other', 3000))
    await pipeline.idle()
    expect(llm.callCount).toBe(2)
  })

  it('rule 6: STT recovers on retry — no sttFailed, LLM proceeds', async () => {
    const stt = new MockStt([new Error('transient'), 'recovered'])
    const llm = new MockLlm([
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'ok', targetText: 'ok', reading: 'ok' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['sttFailed', 'candidatesDone'])

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()

    expect(stt.callCount).toBe(2)
    expect(events.every((e) => e.type !== 'sttFailed')).toBe(true)
    expect(events.some((e) => e.type === 'candidatesDone')).toBe(true)
  })

  it('rule 7: LLM failure retries once then emits llmFailed; other turn stays; session continues', async () => {
    const stt = new MockStt(['other-text'])
    const llm = new MockLlm([[{ throw: true }], [{ throw: true }]])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['llmFailed', 'candidatesDone', 'turnAppended'])

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()

    expect(llm.callCount).toBe(2)
    expect(events.some((e) => e.type === 'llmFailed')).toBe(true)
    expect(events.every((e) => e.type !== 'candidatesDone')).toBe(true)
    const turns = await conversation.loadActiveSession()
    expect(turns).toHaveLength(1)
    expect(turns![0].text).toBe('other-text')

    stt.results.push('next')
    llm.scripts.push([{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'n', targetText: 'n', reading: 'n' } }, { type: 'done' }])
    await pipeline.ingestSegment(seg('other', 3000))
    await pipeline.idle()
    expect(llm.callCount).toBe(3)
  })

  it('rule 7: LLM recovers on retry — candidatesDone emitted', async () => {
    const stt = new MockStt(['other'])
    const llm = new MockLlm([
      [{ throw: true }],
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: 'ok', targetText: 'ok', reading: 'ok' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['llmFailed', 'candidatesDone'])

    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()

    expect(llm.callCount).toBe(2)
    expect(events.every((e) => e.type !== 'llmFailed')).toBe(true)
    expect(events.some((e) => e.type === 'candidatesDone')).toBe(true)
  })

  it('user segment triggers LLM (same as other)', async () => {
    const stt = new MockStt(['user said this'])
    const llm = new MockLlm([
      [{ type: 'candidate-done', index: 0, candidate: { id: 'c0', meaningZh: '续写', targetText: 'つづき', reading: 'tsuzuki' } }, { type: 'done' }],
    ])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['candidatesDone'])

    await pipeline.ingestSegment(seg('user', 1000))
    await pipeline.idle()

    expect(llm.callCount).toBe(1)
    expect(events.some((e) => e.type === 'candidatesDone')).toBe(true)
    const turns = await conversation.loadActiveSession()
    expect(turns).toHaveLength(1)
    expect(turns![0].speaker).toBe('user')
    expect(pipeline.getState()).toBe('IDLE')
  })

  it('empty LLM result still emits candidatesDone with []', async () => {
    const stt = new MockStt(['わかりました'])
    const llm = new MockLlm([[{ type: 'done' }]])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({ stt, llm, conversation, sleep: noSleep })
    const events = recordEvents(pipeline, ['candidatesDone'])

    await pipeline.ingestSegment(seg('user', 1000))
    await pipeline.idle()

    const done = events.find((e) => e.type === 'candidatesDone')
    expect(done).toBeDefined()
    if (done?.type === 'candidatesDone') expect(done.candidates).toHaveLength(0)
  })

  it('config: pause thresholds accepted from injected config', async () => {
    const stt = new MockStt(['x'])
    const llm = new MockLlm([[{ type: 'done' }]])
    const conversation = new InMemoryConversationStorage()
    const pipeline = new Pipeline({
      stt,
      llm,
      conversation,
      sleep: noSleep,
      config: { vadOtherPauseMs: 700, vadUserPauseMs: 1500 },
    })
    await pipeline.ingestSegment(seg('other', 1000))
    await pipeline.idle()
    expect(pipeline.getState()).toBe('IDLE')
  })
})
