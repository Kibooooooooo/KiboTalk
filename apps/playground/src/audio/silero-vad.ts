import { AutoModel, Tensor } from '@huggingface/transformers'
import type { VadInfer } from '@kibotalk/audio/vad'

/**
 * Load the Silero VAD model (onnx-community/silero-vad) via Transformers.js and
 * return a stateful `infer` function for `createVAD`. Mirrors AIRI's
 * `apps/stage-web/src/workers/vad/vad.ts` inference: a recurrent model whose
 * `state` tensor is carried across calls.
 *
 * The model is fetched from the HuggingFace hub on first use (~2MB). Runs on the
 * main thread (like AIRI); for a production app move to a worker.
 */

// The Transformers.js `PreTrainedModel` type isn't declared as callable for
// custom models, but the runtime instance is. Describe the silero forward shape.
type SileroForward = (args: {
  input: Tensor
  sr: Tensor
  state: Tensor
}) => Promise<{ stateN: Tensor; output: Tensor }>

export async function createSileroInfer(sampleRate = 16000): Promise<VadInfer> {
  const model = (await AutoModel.from_pretrained('onnx-community/silero-vad', {
    config: { model_type: 'custom' },
    dtype: 'fp32',
  } as Record<string, unknown>)) as unknown as { __call__: SileroForward }

  let state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
  const sr = new Tensor('int64', [BigInt(sampleRate)], [])

  return async (chunk: Float32Array): Promise<number> => {
    const input = new Tensor('float32', chunk, [1, chunk.length])
    const out = await model.__call__({ input, sr, state })
    state = out.stateN
    return Number(out.output.data[0])
  }
}
