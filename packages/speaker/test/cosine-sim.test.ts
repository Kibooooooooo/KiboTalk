import { describe, expect, it } from 'vitest'
import { cosineSimilarity } from '../src/cosine-sim'

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(1, 5)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 5)
  })

  it('is 0 for a zero vector', () => {
    expect(cosineSimilarity(new Float32Array([0, 0, 0]), new Float32Array([1, 2, 3]))).toBe(0)
  })

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toThrow(/mismatch/)
  })
})
