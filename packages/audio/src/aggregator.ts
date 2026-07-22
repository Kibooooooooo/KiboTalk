/**
 * Segment aggregator — sits between VAD (+ speaker verification) and the
 * pipeline's `ingestSegment`. It accumulates VAD speech-ready segments of the
 * same speaker and flushes a merged chunk when:
 *   - silence since the last segment exceeds the current speaker's pause
 *     threshold (`otherPauseMs` / `userPauseMs`), or
 *   - the accumulated audio length exceeds `maxMs`, or
 *   - the speaker changes (the pending utterance is flushed, a new one starts).
 *
 * This realizes spec §2.4's "wait for the other to pause before triggering the
 * LLM" and the VAD panel's merge experiment, as a shared, pipeline-agnostic
 * layer. The pipeline's contract (one ingested segment = one turn) is unchanged.
 *
 * Silence between constituent segments is reconstructed from segment timing
 * (zero-filled gap = next.startedAt - prev.endedAt) so ASR keeps natural cadence.
 */
export type AggregatorConfig = {
  sampleRate: number
  /** Pause (ms) after the last `other` segment that flushes an other utterance. */
  otherPauseMs: number
  /** Pause (ms) after the last `user` segment that flushes a user utterance. */
  userPauseMs: number
  /** Force-flush when accumulated audio reaches this length (ms). */
  maxMs: number
}

export type FedSegment = {
  buffer: Float32Array
  speaker: 'user' | 'other'
  startedAt: number
  endedAt: number
}

export type AggregatedSegment = {
  pcm: Float32Array
  speaker: 'user' | 'other'
  startedAt: number
  endedAt: number
  /** Constituent VAD segments, in order (for UI nesting / playback). */
  segments: FedSegment[]
}

export type SegmentAggregator = {
  feed(segment: FedSegment): void
  flush(): void
  onFlush(handler: (seg: AggregatedSegment) => void): () => void
  updateConfig(patch: Partial<AggregatorConfig>): void
  dispose(): void
}

export function createSegmentAggregator(config: AggregatorConfig): SegmentAggregator {
  let cfg = config
  const handlers = new Set<(seg: AggregatedSegment) => void>()
  let current: FedSegment[] | null = null
  let currentSpeaker: 'user' | 'other' | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function emit(seg: AggregatedSegment): void {
    for (const h of handlers) h(seg)
  }

  function buildPcm(parts: FedSegment[]): Float32Array {
    const gapSamples: number[] = []
    let total = 0
    for (let i = 0; i < parts.length; i++) {
      total += parts[i].buffer.length
      if (i > 0) {
        const gapMs = Math.max(0, parts[i].startedAt - parts[i - 1].endedAt)
        const gap = Math.round((gapMs / 1000) * cfg.sampleRate)
        gapSamples.push(gap)
        total += gap
      }
    }
    const out = new Float32Array(total)
    let off = 0
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) off += gapSamples[i - 1]
      out.set(parts[i].buffer, off)
      off += parts[i].buffer.length
    }
    return out
  }

  function flush(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!current || current.length === 0) {
      current = null
      currentSpeaker = null
      return
    }
    const seg: AggregatedSegment = {
      pcm: buildPcm(current),
      speaker: currentSpeaker!,
      startedAt: current[0].startedAt,
      endedAt: current[current.length - 1].endedAt,
      segments: [...current],
    }
    current = null
    currentSpeaker = null
    emit(seg)
  }

  function armTimer(speaker: 'user' | 'other'): void {
    if (timer) clearTimeout(timer)
    const pause = speaker === 'other' ? cfg.otherPauseMs : cfg.userPauseMs
    timer = setTimeout(() => {
      timer = null
      flush()
    }, pause)
  }

  return {
    feed(segment) {
      // Speaker change → flush the pending utterance, start a new one.
      if (currentSpeaker !== null && currentSpeaker !== segment.speaker) {
        flush()
      }
      if (current === null) {
        current = []
        currentSpeaker = segment.speaker
      }
      current.push(segment)

      // Force-flush if the accumulated audio exceeds maxMs.
      const totalMs = (current.reduce((n, s) => n + s.buffer.length, 0) / cfg.sampleRate) * 1000
      if (totalMs >= cfg.maxMs) {
        flush()
        return
      }
      armTimer(segment.speaker)
    },
    flush,
    onFlush(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    updateConfig(patch) {
      cfg = { ...cfg, ...patch }
    },
    dispose() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      handlers.clear()
      current = null
      currentSpeaker = null
    },
  }
}
