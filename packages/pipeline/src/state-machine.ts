import type {
  CandidateField,
  CandidateStreamEvent,
  PipelineDeps,
  PipelineEvent,
  PipelineEventHandler,
  PipelineState,
  Segment,
} from './types'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { envNumber } from './env'

const defaultGenerateId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * The conversation pipeline state machine (spec §2.4 rules 1–8).
 *
 * Concurrency model: `ingestSegment` awaits STT + turn append, then — for a
 * non-interrupted other turn — starts the LLM stream as a DETACHED task and
 * resolves. A subsequent segment aborts any in-flight LLM (AbortController),
 * discards its partial candidates, and proceeds. Ownership tracking prevents
 * a superseded LLM task from mutating shared state when it finally returns.
 *
 * Invariants:
 * - Every segment is appended as a turn (other's words are never lost).
 * - LLM is triggered only after a non-interrupted other turn append.
 * - STT/LLM each retry once on failure (1s backoff), then surface a
 *   user-visible state without killing the session.
 * - Partial candidates never enter the next LLM's context — context is the
 *   completed turns from `conversation.loadActiveSession()`.
 *
 * Callers MUST await `ingestSegment` before feeding the next segment (VAD
 * emits segments sequentially; tests control timing).
 */
export class Pipeline {
  private state: PipelineState = 'IDLE'
  private handlers = new Set<PipelineEventHandler>()
  private stt: NonNullable<PipelineDeps['stt']>
  private llm: NonNullable<PipelineDeps['llm']>
  private conversation: NonNullable<PipelineDeps['conversation']>
  private config: Required<import('./types').PipelineConfig>
  private generateId: () => string
  private sleep: (ms: number) => Promise<void>
  private currentLlm: { abort: AbortController; turnId: string } | null = null
  private currentStt: AbortController | null = null

  constructor(deps: PipelineDeps) {
    this.stt = deps.stt
    this.llm = deps.llm
    this.conversation = deps.conversation
    const cfg = deps.config ?? {}
    this.config = {
      vadOtherPauseMs: cfg.vadOtherPauseMs ?? envNumber('VAD_OTHER_PAUSE_MS', 1000),
      vadUserPauseMs: cfg.vadUserPauseMs ?? envNumber('VAD_USER_PAUSE_MS', 1000),
      sttRetryBackoffMs: cfg.sttRetryBackoffMs ?? 1000,
      llmRetryBackoffMs: cfg.llmRetryBackoffMs ?? 1000,
    }
    this.generateId = deps.generateId ?? defaultGenerateId
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  }

  on(handler: PipelineEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  getState(): PipelineState {
    return this.state
  }

  /** Resolves once the pipeline is IDLE with no detached LLM running. */
  idle(): Promise<void> {
    if (this.state === 'IDLE' && this.currentLlm === null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const off = this.on((e) => {
        if (e.type === 'state' && e.state === 'IDLE' && this.currentLlm === null) {
          off()
          resolve()
        }
      })
    })
  }

  async ingestSegment(segment: Segment): Promise<void> {
    // Rule 2 & 5: a new segment aborts any in-flight LLM and discards partials.
    if (this.currentLlm) {
      const aborted = this.currentLlm
      aborted.abort.abort()
      this.currentLlm = null
      this.emit({ type: 'llmAborted', turnId: aborted.turnId })
    }

    this.setState(segment.speaker === 'other' ? 'OTHER_SPEAKING' : 'USER_SPEAKING')

    const turnId = this.generateId()
    const text = await this.transcribeWithRetry(segment.pcm)
    const sttFailed = text === null

    const turn: ConversationTurn = {
      id: turnId,
      speaker: segment.speaker,
      text: sttFailed ? '' : text!,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      ...(sttFailed ? { sttFailed: true } : {}),
    }
    await this.conversation.appendTurn(turn)
    this.emit({ type: 'turnAppended', turn })

    if (sttFailed) {
      this.emit({ type: 'sttFailed', turnId })
      this.setState('IDLE')
      return
    }

    if (segment.speaker === 'other' && !segment.interrupted) {
      // Detached: resolves on its own; a newer segment may abort it mid-stream.
      void this.runLlm(turnId).catch(() => {
        // runLlm handles its own failures; this swallows unexpected rejections
        // so an orphaned task never surfaces an unhandled rejection.
      })
    } else {
      this.setState('IDLE')
    }
  }

  private async transcribeWithRetry(pcm: Float32Array): Promise<string | null> {
    this.currentStt = new AbortController()
    try {
      return await this.stt.transcribe(pcm, this.currentStt.signal)
    } catch {
      this.currentStt = new AbortController()
      await this.sleep(this.config.sttRetryBackoffMs)
      try {
        return await this.stt.transcribe(pcm, this.currentStt.signal)
      } catch {
        return null
      }
    } finally {
      this.currentStt = null
    }
  }

  private async runLlm(turnId: string): Promise<void> {
    const context = (await this.conversation.loadActiveSession()) ?? []
    const controller = new AbortController()
    this.currentLlm = { abort: controller, turnId }
    this.setState('LLM_STREAMING')
    this.emit({ type: 'candidatesStreaming', turnId })

    const candidates: ReplyCandidate[] = []
    const partials: Map<number, Partial<Record<CandidateField, string>>> = new Map()

    const streamOnce = async (): Promise<'done' | 'aborted' | 'failed'> => {
      try {
        for await (const ev of this.llm.streamCandidates(context, controller.signal)) {
          if (controller.signal.aborted) return 'aborted'
          this.handleStreamEvent(ev, turnId, candidates, partials)
          if (ev.type === 'done') break
        }
        return controller.signal.aborted ? 'aborted' : 'done'
      } catch {
        if (controller.signal.aborted) return 'aborted'
        return 'failed'
      }
    }

    let outcome = await streamOnce()
    if (outcome === 'failed') {
      // Rule 7: retry once.
      candidates.length = 0
      partials.clear()
      await this.sleep(this.config.llmRetryBackoffMs)
      this.emit({ type: 'candidatesStreaming', turnId })
      outcome = await streamOnce()
    }

    // Only the current owner may mutate shared state; a superseding segment
    // already aborted this task and emitted llmAborted.
    if (this.currentLlm?.abort !== controller) return

    this.currentLlm = null
    if (outcome === 'done') {
      this.emit({ type: 'candidatesDone', turnId, candidates })
      this.setState('IDLE')
    } else if (outcome === 'failed') {
      this.emit({ type: 'llmFailed', turnId })
      this.setState('IDLE')
    }
    // outcome === 'aborted': partials already discarded by the superseding
    // segment; emit nothing here.
  }

  private handleStreamEvent(
    ev: CandidateStreamEvent,
    turnId: string,
    candidates: ReplyCandidate[],
    partials: Map<number, Partial<Record<CandidateField, string>>>,
  ): void {
    switch (ev.type) {
      case 'candidate-start':
        partials.set(ev.index, {})
        return
      case 'candidate-delta': {
        const slot = partials.get(ev.index) ?? {}
        slot[ev.field] = (slot[ev.field] ?? '') + ev.delta
        partials.set(ev.index, slot)
        this.emit({ type: 'candidateDelta', turnId, index: ev.index, field: ev.field, delta: ev.delta })
        return
      }
      case 'candidate-done':
        partials.delete(ev.index)
        candidates.push(ev.candidate)
        return
      case 'done':
        return
      default: {
        const _exhaustive: never = ev
        void _exhaustive
        return
      }
    }
  }

  private setState(state: PipelineState): void {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'state', state })
  }

  private emit(event: PipelineEvent): void {
    for (const handler of this.handlers) handler(event)
  }
}
