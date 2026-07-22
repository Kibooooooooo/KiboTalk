import { AutoModel, Tensor } from '@huggingface/transformers'
import type { VadInfer } from '@kibotalk/audio/vad'

/**
 * Silero VAD variants supported by the playground. v5 and v6.2 share the same
 * tensor interface (`input` / `state[2,1,128]` / `sr` int64) but differ in the
 * input frame format:
 *  - v5 (`onnx-community/silero-vad`): 512 raw samples per chunk, no context.
 *  - v6.2 (`BricksDisplay/silero-vad-6.2`): 64-sample context (zeros first, then
 *    the previous chunk's tail) prepended to each 512-sample chunk → 576 samples.
 *    See snakers4/silero-vad `utils_vad.py` VADIterator (context_size = 64 @16kHz).
 */
export type SileroVariant = {
  id: string
  label: string
  modelId: string
  useContext: boolean
}

export const SILERO_VARIANTS: SileroVariant[] = [
  { id: 'v6.2', label: 'Silero VAD v6.2（新，需 context）', modelId: 'BricksDisplay/silero-vad-6.2', useContext: true },
  { id: 'v5', label: 'Silero VAD v5（旧，512 原始）', modelId: 'onnx-community/silero-vad', useContext: false },
]

// Transformers.js `PreTrainedModel extends Callable`: the instance is itself a
// callable closure (delegates to `_call` → `forward`). Describe that callable
// shape; the TS types don't expose it for custom models.
type SileroForward = (args: {
  input: Tensor
  sr: Tensor
  state: Tensor
}) => Promise<{ stateN: Tensor; output: Tensor }>

export async function createSileroInfer(
  variant: SileroVariant,
  sampleRate = 16000,
): Promise<VadInfer> {
  const model = (await AutoModel.from_pretrained(variant.modelId, {
    config: { model_type: 'custom' },
    dtype: 'fp32',
  } as Record<string, unknown>)) as unknown as SileroForward

  let state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
  const sr = new Tensor('int64', [BigInt(sampleRate)], [])
  const contextSize = variant.useContext ? (sampleRate === 16000 ? 64 : 32) : 0
  let context = new Float32Array(contextSize)

  return async (chunk: Float32Array): Promise<number> => {
    const inputSamples =
      contextSize > 0
        ? new Float32Array(contextSize + chunk.length)
        : chunk
    if (contextSize > 0) {
      inputSamples.set(context, 0)
      inputSamples.set(chunk, contextSize)
    }
    const input = new Tensor('float32', inputSamples, [1, inputSamples.length])
    const out = await model({ input, sr, state })
    state = out.stateN
    if (contextSize > 0) context = chunk.slice(chunk.length - contextSize)
    return Number(out.output.data[0])
  }
}
