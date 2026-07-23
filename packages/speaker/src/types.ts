import type { Speaker } from '@kibotalk/conversation'

/**
 * A speaker embedding — a fixed-length float vector produced by enrollment.
 * Opaque to callers; only the speaker implementation knows its dimensionality
 * and distance metric. Persisted to IndexedDB (or Supabase later) as-is.
 */
export type Embedding = {
  vector: Float32Array
  createdAt: number
  passphrase?: string
}

/**
 * Result of comparing a chunk to the enrolled embedding.
 *
 * - `similarity`: raw cosine similarity vs the enrolled vector (use this for
 *   threshold tuning in the playground).
 * - `confidence`: confidence in the chosen `speaker` label — equal to
 *   `similarity` when labeled `user`, and `1 - similarity` when labeled `other`.
 */
export type VerifyResult = {
  speaker: Speaker
  confidence: number
  similarity: number
}

/**
 * Speaker verification: enroll once against a passphrase, then verify each
 * audio chunk against the stored embedding to label it `user` or `other`.
 * The real WASM implementation lands in T6; T4 ships a stub `verify` that
 * returns an injected label so the pipeline can be exercised end-to-end.
 */
export interface SpeakerVerifier {
  enroll(audioStream: AsyncIterable<ArrayBuffer>, passphrase: string): Promise<Embedding>
  loadEmbedding(): Promise<Embedding | null>
  saveEmbedding(embedding: Embedding): Promise<void>
  verify(audioChunk: ArrayBuffer, embedding: Embedding): Promise<VerifyResult>
}
