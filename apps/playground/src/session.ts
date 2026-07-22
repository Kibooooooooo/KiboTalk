import { Pipeline } from '@kibotalk/pipeline'
import type { CandidateStreamEvent, LlmClient, SttClient } from '@kibotalk/pipeline'
import { InMemoryConversationStorage } from '@kibotalk/conversation'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { StubSpeakerVerifier } from '@kibotalk/speaker'

/**
 * In-browser mock providers for the playground session simulator. T4 ships no
 * real STT/LLM/WASM speaker — these stand in so the state machine can be driven
 * visually. Swap for real clients (T2/T3/T6) without touching this wiring.
 */

export class PlaygroundStt implements SttClient {
  constructor(private getText: () => string, private failNext = false) {}

  setFailNext(value: boolean): void {
    this.failNext = value
  }

  async transcribe(_pcm: Float32Array, _signal: AbortSignal): Promise<string> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('mock stt failure')
    }
    return this.getText()
  }
}

export class PlaygroundLlm implements LlmClient {
  async *streamCandidates(
    context: ConversationTurn[],
    _signal: AbortSignal,
  ): AsyncIterable<CandidateStreamEvent> {
    const lastOther = [...context].reverse().find((t) => t.speaker === 'other')
    const prompt = lastOther?.text ?? '(empty)'
    const candidates: ReplyCandidate[] = [
      { id: 'c0', meaningZh: `回复A·${prompt}`, targetText: `そうですか（A）`, reading: 'sou desu ka (A)' },
      { id: 'c1', meaningZh: `回复B·${prompt}`, targetText: `なるほど（B）`, reading: 'naruhodo (B)' },
      { id: 'c2', meaningZh: `回复C·${prompt}`, targetText: `もう一度お願いします（C）`, reading: 'mou ichido onegaai shimasu (C)' },
    ]
    for (let i = 0; i < candidates.length; i++) {
      yield { type: 'candidate-start', index: i }
      yield { type: 'candidate-done', index: i, candidate: candidates[i] }
    }
    yield { type: 'done' }
  }
}

export type SessionHandle = {
  pipeline: Pipeline
  storage: InMemoryConversationStorage
  stt: PlaygroundStt
  speaker: StubSpeakerVerifier
}

export function createSession(getText: () => string): SessionHandle {
  const storage = new InMemoryConversationStorage()
  const stt = new PlaygroundStt(getText)
  const llm = new PlaygroundLlm()
  const speaker = new StubSpeakerVerifier('other')
  const pipeline = new Pipeline({ stt, llm, conversation: storage })
  return { pipeline, storage, stt, speaker }
}
