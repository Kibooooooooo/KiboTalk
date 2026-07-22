import type { EmbedAudio } from '@kibotalk/speaker'

/**
 * Create an `embedAudio` function (for `EmbeddingSpeakerVerifier`) backed by a
 * Web Worker running wavlm-base-plus-sv. Each call posts the PCM chunk to the
 * worker and awaits the returned embedding. The chunk is copied (not
 * transferred) so the same PCM can still be sent to /stt by the pipeline.
 */
export function createWorkerEmbedAudio(): EmbedAudio {
  const worker = new Worker(new URL('./speaker-worker.ts', import.meta.url), { type: 'module' })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>()

  worker.onmessage = (e: MessageEvent) => {
    const { id, embedding, error } = e.data as {
      id: number
      embedding?: Float32Array
      error?: string
    }
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve(new Float32Array(embedding ?? new Float32Array(0)))
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'worker error'))
    pending.clear()
  }

  return async (pcm: Float32Array): Promise<Float32Array> => {
    const id = nextId++
    return new Promise<Float32Array>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, pcm })
    })
  }
}
