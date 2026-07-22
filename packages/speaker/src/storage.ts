import type { Embedding } from './types'

/**
 * Persistence for the enrolled speaker embedding. Injected into the verifier
 * so the core logic is testable in Node (InMemory) while the browser uses the
 * IndexedDB adapter. One embedding per device (MVP: no cross-device sync).
 */
export interface EmbeddingStorage {
  load(): Promise<Embedding | null>
  save(embedding: Embedding): Promise<void>
  clear(): Promise<void>
}

export class InMemoryEmbeddingStorage implements EmbeddingStorage {
  private embedding: Embedding | null = null

  async load(): Promise<Embedding | null> {
    return this.embedding
  }

  async save(embedding: Embedding): Promise<void> {
    this.embedding = embedding
  }

  async clear(): Promise<void> {
    this.embedding = null
  }
}
