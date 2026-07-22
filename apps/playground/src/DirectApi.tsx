import { useRef, useState } from 'react'
import { encodeWav } from '@kibotalk/audio'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { extractCandidates } from './partial-json'
import { parseSseStream } from './sse'

type CandidateState = ReplyCandidate[]

export default function DirectApi() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 880 }}>
      <h1>Playground — Direct API (real /stt + /llm)</h1>
      <p style={{ color: '#666' }}>
        Exercise the proxy routes directly. Requires <code>STT_OPENROUTER_*</code> /
        <code> LLM_OPENROUTER_*</code> env on the api server.
      </p>
      <SttPanel />
      <hr style={{ margin: '2rem 0' }} />
      <LlmPanel />
    </main>
  )
}

function SttPanel() {
  const [transcription, setTranscription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function sendWav(wav: ArrayBuffer) {
    setBusy(true)
    setError('')
    setTranscription('')
    try {
      const res = await fetch('/stt', { method: 'POST', body: wav })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setTranscription(json.text ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    sendWav(await file.arrayBuffer())
  }

  function sendSample() {
    // 1 second of 440Hz sine at 16kHz, as a WAV — for testing the wire without a file.
    const sampleRate = 16000
    const pcm = new Float32Array(sampleRate)
    for (let i = 0; i < sampleRate; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3
    sendWav(encodeWav(pcm, sampleRate))
  }

  return (
    <section>
      <h2>/stt — transcription</h2>
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <input ref={fileRef} type="file" accept=".wav,audio/wav" onChange={onFile} />
        <button onClick={sendSample} disabled={busy}>Send sample WAV</button>
      </section>
      {busy && <p style={{ color: '#888' }}>transcribing…</p>}
      {error && <p style={{ color: '#dc2626' }}>error: {error}</p>}
      {transcription && (
        <p style={{ background: '#f8fafc', padding: '0.6rem', borderRadius: 6 }}>
          <b>text:</b> {transcription}
        </p>
      )}
    </section>
  )
}

function LlmPanel() {
  const [level, setLevel] = useState('N5')
  const [scene, setScene] = useState('便利店')
  const [contextText, setContextText] = useState('other: いらっしゃいませ\nuser: （我想说）只是看看')
  const [candidates, setCandidates] = useState<CandidateState>([])
  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  function parseContext(text: string): ConversationTurn[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const m = line.match(/^(user|other)\s*:\s*(.*)$/i)
        const speaker = m ? (m[1].toLowerCase() as 'user' | 'other') : 'other'
        const t = m ? m[2] : line
        return { id: `t${i}`, speaker, text: t, startedAt: i, endedAt: i + 1 }
      })
  }

  async function generate() {
    setBusy(true)
    setError('')
    setRaw('')
    setCandidates([])
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: parseContext(contextText), level, scene }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${txt}`)
      }
      for await (const msg of parseSseStream(res)) {
        if (msg.event === 'error') setError(msg.data)
        else if (msg.event === 'token') {
          setRaw((prev) => {
            const next = prev + msg.data
            setCandidates((cur) => {
              const parsed = extractCandidates(next)
              return parsed.length > cur.length ? parsed : cur
            })
            return next
          })
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function abort() {
    abortRef.current?.abort()
  }

  return (
    <section>
      <h2>/llm — 3 reply candidates (streaming)</h2>
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <label>
          level:{' '}
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {['N5', 'N4', 'N3', 'N2', 'N1'].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          scene: <input value={scene} onChange={(e) => setScene(e.target.value)} style={{ width: 140 }} />
        </label>
      </section>
      <textarea
        value={contextText}
        onChange={(e) => setContextText(e.target.value)}
        rows={4}
        style={{ width: '100%', fontFamily: 'monospace', marginBottom: '0.5rem' }}
      />
      <section style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button onClick={generate} disabled={busy}>Generate</button>
        <button onClick={abort} disabled={!busy}>Abort</button>
      </section>
      {error && <p style={{ color: '#dc2626' }}>error: {error}</p>}
      {candidates.length > 0 ? (
        <ol style={{ listStyle: 'none', padding: 0 }}>
          {candidates.map((c) => (
            <li key={c.id} style={candidateStyle}>
              <div style={{ fontWeight: 600 }}>{c.targetText}</div>
              <div>{c.meaningZh}</div>
              <div style={{ color: '#888', fontSize: '0.85rem' }}>{c.reading}</div>
            </li>
          ))}
        </ol>
      ) : busy ? (
        <p style={{ color: '#888' }}>streaming…</p>
      ) : (
        <p style={{ color: '#999' }}>(no candidates yet)</p>
      )}
      {raw && (
        <details style={{ marginTop: '0.75rem' }}>
          <summary>raw stream</summary>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '0.6rem', fontSize: '0.8rem', overflow: 'auto' }}>
{raw}
          </pre>
        </details>
      )}
    </section>
  )
}

const candidateStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '0.5rem 0.7rem',
  marginBottom: '0.4rem',
}
