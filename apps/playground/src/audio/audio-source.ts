/**
 * Captures microphone PCM via `getUserMedia` and an AudioWorklet, resampled to
 * the AudioContext's sample rate (requested 16kHz). Emits fixed-size Float32Array
 * chunks to a callback — feed them to `createVAD.processAudio`.
 *
 * The AudioWorklet processor is inlined as a Blob URL so no separate worklet
 * file / Vite worklet bundling is needed. The browser resamples the mic stream
 * to the AudioContext rate, so chunks arrive at ~16kHz mono.
 */

const WORKLET_SOURCE = `
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(512)
    this.pointer = 0
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    let i = 0
    while (i < input.length) {
      const remaining = this.buffer.length - this.pointer
      const take = Math.min(remaining, input.length - i)
      this.buffer.set(input.subarray(i, i + take), this.pointer)
      this.pointer += take
      i += take
      if (this.pointer >= this.buffer.length) {
        this.port.postMessage({ buffer: this.buffer.slice() })
        this.pointer = 0
      }
    }
    return true
  }
}
registerProcessor('vad-processor', VadProcessor)
`

export class AudioSource {
  private audioContext: AudioContext | null = null
  private stream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null

  async start(onChunk: (pcm: Float32Array) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    this.audioContext = new AudioContext({ sampleRate: 16000 })
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    await this.audioContext.audioWorklet.addModule(URL.createObjectURL(blob))

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)
    this.workletNode = new AudioWorkletNode(this.audioContext, 'vad-processor')
    this.workletNode.port.onmessage = (e: MessageEvent<{ buffer: Float32Array }>) => {
      onChunk(e.data.buffer)
    }
    this.sourceNode.connect(this.workletNode)
    // Worklet has no output destination; connecting to destination is not required.
  }

  get sampleRate(): number {
    return this.audioContext?.sampleRate ?? 16000
  }

  stop(): void {
    this.workletNode?.disconnect()
    this.sourceNode?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.audioContext?.close().catch(() => {})
    this.workletNode = null
    this.sourceNode = null
    this.stream = null
    this.audioContext = null
  }
}
