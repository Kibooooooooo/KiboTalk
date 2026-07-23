import type { ConversationStorage, ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { envNumber } from './env'

/**
 * Pipeline state machine states (spec §2.4).
 *
 * Segments arrive pre-cut by VAD + speaker (pipeline does no VAD/speaker
 * itself). OTHER_SPEAKING / USER_SPEAKING mean "STT is in flight for that
 * speaker, the turn has not been appended yet". LLM_STREAMING means candidates
 * are streaming for the most recent turn (user or other).
 */
export type PipelineState = 'IDLE' | 'OTHER_SPEAKING' | 'USER_SPEAKING' | 'LLM_STREAMING'

/**
 * A VAD-cut, speaker-labeled audio segment. `interrupted` is set by the VAD
 * when the segment was cut short because a new voice started (as opposed to a
 * pause ≥ threshold). An interrupted segment is still appended but does NOT
 * trigger LLM — the interrupting segment follows and requests coach (spec
 * §2.4 rule 5).
 */
export type Segment = {
  pcm: Float32Array
  speaker: 'user' | 'other'
  startedAt: number
  endedAt: number
  interrupted?: boolean
}

export type CandidateField = 'meaningZh' | 'targetText' | 'reading'

/**
 * What an LLM client streams back. T3 will map real SSE tokens onto this; T4
 * mocks it. `candidate-start` opens a slot, `candidate-delta` fills a field
 * incrementally, `candidate-done` seals a candidate, `done` ends the stream.
 */
export type CandidateStreamEvent =
  | { type: 'candidate-start'; index: number }
  | { type: 'candidate-delta'; index: number; field: CandidateField; delta: string }
  | { type: 'candidate-done'; index: number; candidate: ReplyCandidate }
  | { type: 'done' }

/** LLM client — streams 3 candidates or []. No internal retry. */
export interface LlmClient {
  streamCandidates(
    context: ConversationTurn[],
    signal: AbortSignal,
  ): AsyncIterable<CandidateStreamEvent>
}

/** STT client — transcribes one segment's PCM. No internal retry. */
export interface SttClient {
  transcribe(pcm: Float32Array, signal: AbortSignal): Promise<string>
}

/** Pipeline behavior knobs. Pause thresholds are VAD's, surfaced here so the
 * pipeline can read env config; tests inject directly. */
export type PipelineConfig = {
  vadOtherPauseMs: number
  vadUserPauseMs: number
  sttRetryBackoffMs: number
  llmRetryBackoffMs: number
}

export function defaultConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    vadOtherPauseMs: envNumber('VAD_OTHER_PAUSE_MS', 1000),
    vadUserPauseMs: envNumber('VAD_USER_PAUSE_MS', 1000),
    sttRetryBackoffMs: 1000,
    llmRetryBackoffMs: 1000,
    ...overrides,
  }
}

/** Events the pipeline emits for UI / test subscription. */
export type PipelineEvent =
  | { type: 'state'; state: PipelineState }
  | { type: 'turnAppended'; turn: ConversationTurn }
  | { type: 'candidatesStreaming'; turnId: string }
  | { type: 'candidateDelta'; turnId: string; index: number; field: CandidateField; delta: string }
  | { type: 'candidatesDone'; turnId: string; candidates: ReplyCandidate[] }
  | { type: 'llmAborted'; turnId: string }
  | { type: 'sttFailed'; turnId: string }
  | { type: 'llmFailed'; turnId: string }

export type PipelineEventHandler = (event: PipelineEvent) => void

export type PipelineDeps = {
  stt: SttClient
  llm: LlmClient
  conversation: ConversationStorage
  config?: Partial<PipelineConfig>
  /** Injectable id generator for deterministic tests. */
  generateId?: () => string
  /** Injectable sleep for deterministic retry-backoff tests. */
  sleep?: (ms: number) => Promise<void>
}
