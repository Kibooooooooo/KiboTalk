import type { Embedding, SpeakerVerifier, VerifyResult } from './types'
import type { Speaker } from '@kibotalk/conversation'

/**
 * Stub speaker verifier for playground / pipeline testing. `verify` returns
 * the injected label regardless of audio, so downstream pipeline behavior
 * can be exercised without loading WASM. `enroll` produces a zero vector —
 * real embeddings come from T6. Embedding persistence is in-memory only.
 */
export class StubSpeakerVerifier implements SpeakerVerifier {
  private embedding: Embedding | null = null
  private injectedLabel: Speaker

  constructor(injectedLabel: Speaker = 'other') {
    this.injectedLabel = injectedLabel
  }

  setLabel(label: Speaker): void {
    this.injectedLabel = label
  }

  async enroll(_audioStream: AsyncIterable<ArrayBuffer>, passphrase: string): Promise<Embedding> {
    const embedding: Embedding = { vector: new Float32Array(0), createdAt: Date.now(), passphrase }
    this.embedding = embedding
    return embedding
  }

  async loadEmbedding(): Promise<Embedding | null> {
    return this.embedding
  }

  async saveEmbedding(embedding: Embedding): Promise<void> {
    this.embedding = embedding
  }

  async verify(_audioChunk: ArrayBuffer, _embedding: Embedding): Promise<VerifyResult> {
    const similarity = this.injectedLabel === 'user' ? 1 : 0
    return { speaker: this.injectedLabel, confidence: 1, similarity }
  }
}
