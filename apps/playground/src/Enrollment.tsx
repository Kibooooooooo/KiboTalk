import { useEffect, useRef, useState } from 'react'
import { EmbeddingSpeakerVerifier, IndexedDbEmbeddingStorage } from '@kibotalk/speaker'
import { createVAD } from '@kibotalk/audio/vad'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer } from './audio/silero-vad'
import { createWorkerEmbedAudio } from './audio/speaker-embed'

const PASSPHRASE = 'こんにちは。今日もいい一日になりますように。'
type Status = 'idle' | 'requesting' | 'recording' | 'processing' | 'ready'

export default function Enrollment() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const verifierRef = useRef<EmbeddingSpeakerVerifier | null>(null)
  const audioRef = useRef<AudioSource | null>(null)

  function getVerifier(): EmbeddingSpeakerVerifier {
    if (!verifierRef.current) {
      verifierRef.current = new EmbeddingSpeakerVerifier({
        embedAudio: createWorkerEmbedAudio(),
        storage: new IndexedDbEmbeddingStorage(),
        threshold: 0.8,
      })
    }
    return verifierRef.current
  }

  useEffect(() => {
    void getVerifier()
      .loadEmbedding()
      .then((e) => setEnrolled(!!e))
      .catch((e) => setError(String(e)))
  }, [])

  async function record() {
    setError('')
    setStatus('requesting')
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      const infer = await createSileroInfer(audio.sampleRate)
      const vad = createVAD(infer, { sampleRate: audio.sampleRate })

      const captured = await new Promise<Float32Array>((resolve, reject) => {
        let done = false
        vad.on('speech-ready', (e) => {
          if (done) return
          done = true
          resolve(e.buffer)
        })
        void audio.start((chunk) => void vad.processAudio(chunk))
        setStatus('recording')
        // Safety timeout: stop after 10s even if no speech-ready fires.
        setTimeout(() => {
          if (!done) {
            done = true
            reject(new Error('no speech detected within 10s'))
          }
        }, 10000)
      })

      audio.stop()
      setStatus('processing')
      const verifier = getVerifier()
      async function* oneChunk() {
        yield captured.buffer as ArrayBuffer
      }
      await verifier.enroll(oneChunk(), PASSPHRASE)
      setEnrolled(true)
      setStatus('ready')
    } catch (e) {
      setError((e as Error).message)
      setStatus('idle')
      audioRef.current?.stop()
    }
  }

  async function clearEnrollment() {
    await new IndexedDbEmbeddingStorage().clear()
    setEnrolled(false)
    setStatus('idle')
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 880 }}>
      <h1>Playground — Speaker enrollment</h1>
      <p style={{ color: '#666' }}>
        Read the passphrase once to build your voice embedding (stored on this device only).
        After enrolling, the live session auto-detects you vs the other person.
      </p>

      <section style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
        <div style={{ color: '#475569', marginBottom: '0.5rem' }}>Passphrase:</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{PASSPHRASE}</div>
      </section>

      <section style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={record} disabled={status === 'requesting' || status === 'recording' || status === 'processing'}>
          {enrolled ? 'Re-record' : 'Record passphrase'}
        </button>
        {enrolled && <button onClick={clearEnrollment}>Clear enrollment</button>}
      </section>

      <section>
        {status === 'requesting' && <p style={{ color: '#888' }}>requesting mic + loading VAD…</p>}
        {status === 'recording' && <p style={{ color: '#f59e0b' }}>recording — read the passphrase now…</p>}
        {status === 'processing' && <p style={{ color: '#888' }}>computing embedding (loads wavlm on first use)…</p>}
        {status === 'ready' && <p style={{ color: '#10b981' }}>enrolled — live session will auto-detect you.</p>}
        {enrolled && status === 'idle' && <p style={{ color: '#10b981' }}>already enrolled on this device.</p>}
        {error && <p style={{ color: '#dc2626' }}>error: {error}</p>}
      </section>
    </main>
  )
}
