import { describe, expect, it } from 'vitest'
import { EmbeddingSpeakerVerifier, InMemoryEmbeddingStorage } from '../src'
import type { EmbedAudio } from '../src'

/** Embeds a chunk as [mean(pcm), 1]: similar PCM → similar embedding direction. */
const embedAudio: EmbedAudio = async (pcm) => {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]
  const mean = pcm.length ? sum / pcm.length : 0
  return new Float32Array([mean, 1])
}

async function* stream(chunks: ArrayBuffer[]): AsyncIterable<ArrayBuffer> {
  for (const c of chunks) yield c
}

function pcm(value: number, n = 16): ArrayBuffer {
  return new Float32Array(n).fill(value).buffer
}

describe('EmbeddingSpeakerVerifier', () => {
  it('enroll averages chunks and persists the embedding', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage, threshold: 0.8 })
    const emb = await verifier.enroll(stream([pcm(0.5), pcm(0.5)]), '固定文案')
    expect(emb.vector.length).toBe(2)
    expect(emb.passphrase).toBe('固定文案')
    // stored embedding is retrievable
    const loaded = await verifier.loadEmbedding()
    expect(loaded?.vector).toEqual(emb.vector)
  })

  it('verify labels a user-like chunk as user', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage, threshold: 0.8 })
    const emb = await verifier.enroll(stream([pcm(0.5)]), 'p')
    const result = await verifier.verify(pcm(0.5), emb)
    expect(result.speaker).toBe('user')
    expect(result.similarity).toBeGreaterThan(0.8)
    expect(result.confidence).toBe(result.similarity)
  })

  it('verify labels a different-sounding chunk as other', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage, threshold: 0.8 })
    const emb = await verifier.enroll(stream([pcm(0.5)]), 'p')
    // cosine([0.5,1],[-0.5,1]) = 0.6 → below 0.8 → other, confidence 1-0.6=0.4
    const result = await verifier.verify(pcm(-0.5), emb)
    expect(result.speaker).toBe('other')
    expect(result.similarity).toBeCloseTo(0.6, 1)
    expect(result.confidence).toBeCloseTo(0.4, 1)
  })

  it('enroll throws on an empty stream', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage })
    await expect(verifier.enroll(stream([]), 'p')).rejects.toThrow(/no audio/)
  })

  it('saveEmbedding / loadEmbedding round-trip through storage', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage })
    const emb = { vector: new Float32Array([1, 2, 3]), createdAt: 123, passphrase: 'p' }
    await verifier.saveEmbedding(emb)
    const loaded = await verifier.loadEmbedding()
    expect(loaded?.vector).toEqual(emb.vector)
    expect(loaded?.createdAt).toBe(123)
  })

  it('threshold is configurable', async () => {
    const storage = new InMemoryEmbeddingStorage()
    const verifier = new EmbeddingSpeakerVerifier({ embedAudio, storage, threshold: 0.5 })
    const emb = await verifier.enroll(stream([pcm(0.5)]), 'p')
    // sim 0.6 ≥ 0.5 → user now (would be other at default 0.8)
    const result = await verifier.verify(pcm(-0.5), emb)
    expect(result.speaker).toBe('user')
  })
})
