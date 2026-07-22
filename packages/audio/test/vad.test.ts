import { describe, expect, it, vi } from 'vitest'
import { createVAD, defaultVadConfig } from '../src/vad'

const CFG = {
  sampleRate: 16000,
  speechThreshold: 0.5,
  exitThreshold: 0.3,
  minSilenceDurationMs: 400,
  speechPadMs: 80,
  minSpeechDurationMs: 250,
  newBufferSize: 512,
}

/** Infer that returns 1.0 for "speech" chunks and 0.0 for "silence" chunks. */
function inferFromMarks(marks: boolean[]): (chunk: Float32Array) => Promise<number> {
  let i = 0
  return async () => (marks[i++] ?? false ? 1 : 0)
}

function chunk(n: number): Float32Array {
  return new Float32Array(n)
}

async function runVad(marks: boolean[], chunkSize = CFG.newBufferSize) {
  const vad = createVAD(inferFromMarks(marks), CFG)
  const events: string[] = []
  vad.on('speech-start', () => events.push('start'))
  vad.on('speech-end', () => events.push('end'))
  vad.on('speech-ready', (e) => events.push(`ready:${e.duration.toFixed(3)}s,${e.buffer.length}`))
  vad.on('status', (e) => events.push(`status:${e.type}`))
  for (let i = 0; i < marks.length; i++) await vad.processAudio(chunk(chunkSize))
  return events
}

describe('createVAD', () => {
  it('emits start/end/ready for a speech segment surrounded by silence', async () => {
    // 5 silence, 10 speech, 13 silence (13 * 512 / 16 = 416ms > 400ms minSilence)
    const marks = [
      ...Array(5).fill(false),
      ...Array(10).fill(true),
      ...Array(13).fill(false),
    ]
    const events = await runVad(marks)
    expect(events[0]).toBe('start')
    expect(events.some((e) => e.startsWith('ready:'))).toBe(true)
    expect(events[events.length - 1]).toMatch(/^ready:/)
    // buffer length includes left-pad (speechPadMs ≈ 80ms) + speech + trailing silence
    const ready = events.find((e) => e.startsWith('ready:')) as string
    const len = Number(ready.split(',')[1])
    // speech alone = 10*512 = 5120 samples; plus padding + trailing silence
    expect(len).toBeGreaterThan(5120)
  })

  it('drops segments shorter than minSpeechDurationMs', async () => {
    // 2 silence, 2 speech (2*512/16 = 64ms < 250ms min), 13 silence
    const marks = [
      ...Array(2).fill(false),
      ...Array(2).fill(true),
      ...Array(13).fill(false),
    ]
    const events = await runVad(marks)
    expect(events).toContain('start')
    expect(events).toContain('end')
    expect(events.some((e) => e.startsWith('status:skip'))).toBe(true)
    expect(events.some((e) => e.startsWith('ready:'))).toBe(false)
  })

  it('does not start speech when probability stays below threshold', async () => {
    const events = await runVad(Array(20).fill(false))
    expect(events).toEqual([])
  })

  it('does not end speech while probability stays above exitThreshold', async () => {
    // silence to start, then continuous speech (never drops below exit) → no end
    const marks = [
      ...Array(5).fill(false),
      ...Array(20).fill(true),
    ]
    const events = await runVad(marks)
    expect(events).toContain('start')
    expect(events).not.toContain('end')
    expect(events.some((e) => e.startsWith('ready:'))).toBe(false)
  })

  it('updateConfig changes thresholds live', async () => {
    const vad = createVAD(async () => 0.4, CFG)
    const events: string[] = []
    vad.on('speech-start', () => events.push('start'))
    // 0.4 < default 0.5 → no start
    for (let i = 0; i < 5; i++) await vad.processAudio(chunk(512))
    expect(events).toEqual([])
    // lower threshold to 0.3 → now 0.4 starts speech
    vad.updateConfig({ speechThreshold: 0.3 })
    for (let i = 0; i < 3; i++) await vad.processAudio(chunk(512))
    expect(events).toContain('start')
  })

  it('defaultVadConfig has expected shape', () => {
    expect(defaultVadConfig.sampleRate).toBe(16000)
    expect(defaultVadConfig.minSilenceDurationMs).toBe(400)
    expect(defaultVadConfig.minSpeechDurationMs).toBe(250)
  })

  it('serializes inference so chunks process in order', async () => {
    const order: number[] = []
    let i = 0
    const infer = async () => {
      const n = i++
      order.push(n)
      return 0
    }
    const vad = createVAD(infer, CFG)
    // Fire many processAudio without awaiting between calls.
    const promises = Array.from({ length: 10 }, () => vad.processAudio(chunk(512)))
    await Promise.all(promises)
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
