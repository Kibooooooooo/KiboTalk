import type { Embedding, SpeakerVerifier, VerifyResult } from './types'
import type { Speaker } from '@kibotalk/conversation'
import type { EmbeddingStorage } from './storage'
import { cosineSimilarity } from './cosine-sim'

/**
 * A function that turns a PCM chunk (16kHz mono Float32Array) into a speaker
 * embedding vector. Injected so this package stays free of the model runtime
 * (the playground wires wavlm via @huggingface/transformers in a Web Worker).
 */
export type EmbedAudio = (pcm: Float32Array) => Promise<Float32Array>

export type EmbeddingVerifierOptions = {
  embedAudio: EmbedAudio
  storage: EmbeddingStorage
  /** Cosine-similarity at/above which a chunk is labeled `user`. ~0.8 for wavlm. */
  threshold?: number
  /** Injectable id generator for deterministic tests. */
  generateId?: () => string
}

const defaultGenerateId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Real speaker verification built on an injected embedding function.
 *
 * `enroll` averages embeddings across the supplied audio chunks (one passphrase
 * reading, possibly split into chunks) into a single user embedding, persisted
 * via the injected storage. `verify` compares a chunk to the stored embedding
 * by cosine similarity and labels it `user` (≥ threshold) or `other`.
 *
 * The model runs out-of-process (Web Worker in the playground); this class only
 * orchestrates embedding + comparison + persistence, so it is unit-testable in
 * Node with a mock `embedAudio` and `InMemoryEmbeddingStorage`.
 */
export class EmbeddingSpeakerVerifier implements SpeakerVerifier {
  private embedAudio: EmbedAudio
  private storage: EmbeddingStorage
  private threshold: number
  private generateId: () => string

  constructor(opts: EmbeddingVerifierOptions) {
    this.embedAudio = opts.embedAudio
    this.storage = opts.storage
    this.threshold = opts.threshold ?? 0.8
    this.generateId = opts.generateId ?? defaultGenerateId
  }

  async enroll(audioStream: AsyncIterable<ArrayBuffer>, passphrase: string): Promise<Embedding> {
    const vectors: Float32Array[] = []
    for await (const chunk of audioStream) {
      vectors.push(await this.embedAudio(new Float32Array(chunk)))
    }
    if (vectors.length === 0) throw new Error('enrollment received no audio')
    const embedding = averageVectors(vectors)
    const result: Embedding = {
      vector: embedding,
      createdAt: Date.now(),
      passphrase,
    }
    await this.storage.save(result)
    return result
  }

  async loadEmbedding(): Promise<Embedding | null> {
    return this.storage.load()
  }

  async saveEmbedding(embedding: Embedding): Promise<void> {
    await this.storage.save(embedding)
  }

  async verify(audioChunk: ArrayBuffer, embedding: Embedding): Promise<VerifyResult> {
    const chunkEmb = await this.embedAudio(new Float32Array(audioChunk))
    const sim = cosineSimilarity(chunkEmb, embedding.vector)
    const speaker: Speaker = sim >= this.threshold ? 'user' : 'other'
    const confidence = sim >= this.threshold ? sim : 1 - sim
    return { speaker, confidence }
  }
}

function averageVectors(vectors: Float32Array[]): Float32Array {
  const len = vectors[0].length
  const out = new Float32Array(len)
  for (const v of vectors) {
    for (let i = 0; i < len; i++) out[i] += v[i]
  }
  for (let i = 0; i < len; i++) out[i] /= vectors.length
  return out
}
