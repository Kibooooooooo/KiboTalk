/// <reference lib="webworker" />
import { AutoProcessor, AutoModel } from '@huggingface/transformers'

/**
 * Speaker-embedding Web Worker. Loads `Xenova/wavlm-base-plus-sv` (ONNX, via
 * Transformers.js) on first request and returns a speaker embedding for each
 * 16kHz mono PCM chunk posted to it. Runs off the main thread so embedding
 * inference never blocks the UI or the VAD/audio pipeline.
 */

type WorkerScope = DedicatedWorkerGlobalScope
const ctx: WorkerScope = self as unknown as WorkerScope

let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null
let loading: Promise<void> | null = null

async function ensureLoaded(): Promise<void> {
  if (model && processor) return
  if (!loading) {
    loading = (async () => {
      processor = await AutoProcessor.from_pretrained('Xenova/wavlm-base-plus-sv')
      model = await AutoModel.from_pretrained('Xenova/wavlm-base-plus-sv')
    })()
  }
  return loading
}

ctx.onmessage = async (event: MessageEvent) => {
  const { id, pcm } = event.data as { id: number; pcm: Float32Array }
  try {
    await ensureLoaded()
    const inputs = await processor!(pcm)
    const { embeddings } = (await model!(inputs)) as { embeddings: { data: Float32Array } }
    ctx.postMessage({ id, embedding: embeddings.data })
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
