/**
 * Voice Activity Detection state machine (spec §2.4; config shape follows AIRI's
 * `createVAD`).
 *
 * The neural-net inference is injected (`infer` returns a speech probability for
 * a PCM chunk), so this module is provider-agnostic, dependency-free, and
 * testable in Node without loading a model. The playground wires Silero VAD via
 * `@huggingface/transformers` into `infer`.
 *
 * Emits `speech-start`, `speech-end`, and `speech-ready` (with the segmented PCM
 * buffer + duration). Segments shorter than `minSpeechDurationMs` are dropped.
 */
export type VadConfig = {
  sampleRate: number
  /** Probability above this → considered speech (enter speech state). */
  speechThreshold: number
  /** Probability below this → considered silence (count toward exit). */
  exitThreshold: number
  /** Silence duration that ends a speech segment. */
  minSilenceDurationMs: number
  /** Padding kept before (and after) the speech segment. */
  speechPadMs: number
  /** Segments shorter than this are dropped. */
  minSpeechDurationMs: number
  /** Size of the chunks fed in (samples per `processAudio` call). */
  newBufferSize: number
}

export const defaultVadConfig: VadConfig = {
  sampleRate: 16000,
  speechThreshold: 0.5,
  exitThreshold: 0.3,
  minSilenceDurationMs: 400,
  speechPadMs: 80,
  minSpeechDurationMs: 250,
  newBufferSize: 512,
}

export type VadSpeechReady = { buffer: Float32Array; duration: number }

export type VadEvents = {
  'speech-start': void
  'speech-end': void
  'speech-ready': VadSpeechReady
  'status': { type: string; message: string }
}

type EventName = keyof VadEvents
type Listener<K extends EventName> = (payload: VadEvents[K]) => void

export type VadInfer = (chunk: Float32Array) => Promise<number>

export interface VAD {
  /** Feed one PCM chunk; resolves once inference for this chunk has run. */
  processAudio(chunk: Float32Array): Promise<void>
  on<K extends EventName>(event: K, listener: Listener<K>): () => void
  updateConfig(patch: Partial<VadConfig>): void
  getConfig(): VadConfig
}

export function createVAD(infer: VadInfer, userConfig: Partial<VadConfig> = {}): VAD {
  const config: VadConfig = { ...defaultVadConfig, ...userConfig }
  const listeners = new Map<EventName, Set<Function>>()

  function on<K extends EventName>(event: K, listener: Listener<K>): () => void {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(listener as Function)
    return () => set!.delete(listener as Function)
  }
  function emit<K extends EventName>(event: K, payload: VadEvents[K]): void {
    for (const l of listeners.get(event) ?? []) (l as Listener<K>)(payload)
  }

  let inSpeech = false
  let silenceSamples = 0
  // Actual speech samples (excludes trailing silence), for the min-duration check.
  let speechSamples = 0
  // Rolling window of recent chunks, used to left-pad a speech segment.
  let prevBuffers: Float32Array[] = []
  // Chunks accumulated during the current speech segment (incl. trailing silence).
  let recording: Float32Array[] = []
  // Serialize inference so out-of-order chunk arrival can't race the state machine.
  let chain: Promise<void> = Promise.resolve()

  const maxPrevBuffers = () =>
    Math.ceil((config.speechPadMs * (config.sampleRate / 1000)) / config.newBufferSize)

  function concat(chunks: Float32Array[]): Float32Array {
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
    }
    return out
  }

  async function handleChunk(chunk: Float32Array): Promise<void> {
    // Roll the prev-buffer window (used as left padding on speech start).
    prevBuffers.push(chunk)
    while (prevBuffers.length > maxPrevBuffers()) prevBuffers.shift()

    const prob = await infer(chunk)

    if (!inSpeech) {
      if (prob > config.speechThreshold) {
        inSpeech = true
        silenceSamples = 0
        speechSamples = 0
        // Left-pad with the audio immediately preceding the detected speech.
        recording = [...prevBuffers]
        emit('speech-start', undefined)
      }
      return
    }

    // In speech: accumulate every chunk (including trailing silence).
    recording.push(chunk)
    if (prob < config.exitThreshold) {
      silenceSamples += chunk.length
      const minSilenceSamples = config.minSilenceDurationMs * (config.sampleRate / 1000)
      if (silenceSamples >= minSilenceSamples) {
        inSpeech = false
        silenceSamples = 0
        const buffer = concat(recording)
        recording = []
        const speechMs = (speechSamples / config.sampleRate) * 1000
        emit('speech-end', undefined)
        if (speechMs >= config.minSpeechDurationMs) {
          emit('speech-ready', { buffer, duration: buffer.length / config.sampleRate })
        } else {
          emit('status', { type: 'skip', message: `segment too short (${speechMs.toFixed(0)}ms)` })
        }
      }
    } else {
      silenceSamples = 0
      speechSamples += chunk.length
    }
  }

  return {
    on,
    processAudio(chunk) {
      chain = chain
        .then(() => handleChunk(chunk))
        .catch((e) => emit('status', { type: 'error', message: String(e) }))
      return chain
    },
    updateConfig(patch) {
      Object.assign(config, patch)
    },
    getConfig() {
      return { ...config }
    },
  }
}
