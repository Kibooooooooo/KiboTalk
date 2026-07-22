import { useRef, useState } from 'react'
import type { PipelineEvent } from '@kibotalk/pipeline'
import { Pipeline } from '@kibotalk/pipeline'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { InMemoryConversationStorage } from '@kibotalk/conversation'
import { createVAD } from '@kibotalk/audio/vad'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer } from './audio/silero-vad'
import { ProxySttClient, ProxyLlmClient } from './proxy-clients'

type TurnView = ConversationTurn & { candidates?: ReplyCandidate[] }

export default function LiveSession() {
  const [level, setLevel] = useState('N5')
  const [scene, setScene] = useState('便利店')
  const [speaker, setSpeaker] = useState<'user' | 'other'>('other')
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [state, setState] = useState('IDLE')
  const [turns, setTurns] = useState<TurnView[]>([])
  const [latestCandidates, setLatestCandidates] = useState<ReplyCandidate[] | null>(null)
  const [vadStatus, setVadStatus] = useState('idle')

  const speakerRef = useRef(speaker)
  speakerRef.current = speaker
  const llmRef = useRef<ProxyLlmClient | null>(null)
  const audioRef = useRef<AudioSource | null>(null)
  const pipelineRef = useRef<Pipeline | null>(null)
  const storageRef = useRef(new InMemoryConversationStorage())

  async function start() {
    setError('')
    setLoading('requesting mic + loading VAD model…')
    setTurns([])
    setLatestCandidates(null)
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      const infer = await createSileroInfer(audio.sampleRate)
      const vad = createVAD(infer, { sampleRate: audio.sampleRate })
      const stt = new ProxySttClient(audio.sampleRate)
      const llm = new ProxyLlmClient(level, scene)
      llmRef.current = llm
      const storage = storageRef.current
      const pipeline = new Pipeline({ stt, llm, conversation: storage })
      pipelineRef.current = pipeline

      pipeline.on((e: PipelineEvent) => {
        switch (e.type) {
          case 'state':
            setState(e.state)
            break
          case 'turnAppended':
            setTurns((prev) => [...prev, e.turn as TurnView])
            break
          case 'candidatesDone':
            setLatestCandidates(e.candidates)
            setTurns((prev) => prev.map((t) => (t.id === e.turnId ? { ...t, candidates: e.candidates } : t)))
            break
          case 'llmAborted':
            setLatestCandidates(null)
            break
          case 'sttFailed':
            setTurns((prev) => prev.map((t) => (t.id === e.turnId ? { ...t, sttFailed: true } as TurnView : t)))
            break
          case 'llmFailed':
            setLatestCandidates(null)
            break
          default:
            break
        }
      })

      vad.on('speech-start', () => setVadStatus('speech'))
      vad.on('speech-end', () => setVadStatus('silence'))
      vad.on('speech-ready', (e) => {
        const now = Date.now()
        void pipeline.ingestSegment({
          pcm: e.buffer,
          speaker: speakerRef.current,
          startedAt: now - e.duration * 1000,
          endedAt: now,
        })
      })

      await audio.start((chunk) => void vad.processAudio(chunk))
      setRunning(true)
      setLoading('')
    } catch (e) {
      setError((e as Error).message)
      setLoading('')
      stop()
    }
  }

  function stop() {
    audioRef.current?.stop()
    audioRef.current = null
    pipelineRef.current = null
    llmRef.current = null
    setRunning(false)
    setVadStatus('idle')
  }

  function onLevelChange(value: string) {
    setLevel(value)
    llmRef.current?.configure(value, scene)
  }
  function onSceneChange(value: string) {
    setScene(value)
    llmRef.current?.configure(level, value)
  }

  async function clearSession() {
    await storageRef.current.clearActiveSession()
    setTurns([])
    setLatestCandidates(null)
    setState('IDLE')
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 880 }}>
      <h1>Playground — Live session</h1>
      <p style={{ color: '#666' }}>
        Real mic → Silero VAD → manual speaker label → real /stt → pipeline → real /llm candidates.
        Flip the speaker toggle to match whoever is speaking; VAD segments are labeled with it.
        Speaking again while candidates stream aborts them (pipeline rule 2/5).
      </p>

      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <label>
          level:{' '}
          <select value={level} onChange={(e) => onLevelChange(e.target.value)} disabled={running}>
            {['N5', 'N4', 'N3', 'N2', 'N1'].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          scene: <input value={scene} onChange={(e) => onSceneChange(e.target.value)} style={{ width: 140 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          currently speaking:
          <select value={speaker} onChange={(e) => setSpeaker(e.target.value as 'user' | 'other')}>
            <option value="other">Other (相手)</option>
            <option value="user">Me (learner)</option>
          </select>
        </label>
      </section>

      <section style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {!running ? (
          <button onClick={start} disabled={!!loading}>{loading || 'Start session'}</button>
        ) : (
          <button onClick={stop}>Stop session</button>
        )}
        <button onClick={clearSession} disabled={running}>Clear session</button>
      </section>

      <section style={{ marginBottom: '1rem' }}>
        <strong>State:</strong> <span style={badge(state)}>{state}</span>
        {' · '}
        <strong>VAD:</strong> <span>{vadStatus}</span>
      </section>

      {error && <p style={{ color: '#dc2626' }}>error: {error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <section>
          <h2>Timeline</h2>
          {turns.length === 0 ? (
            <p style={{ color: '#999' }}>(no turns yet)</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0 }}>
              {turns.map((t) => (
                <li
                  key={t.id}
                  style={{
                    borderLeft: `3px solid ${t.speaker === 'other' ? '#3b82f6' : '#10b981'}`,
                    padding: '0.4rem 0.6rem',
                    marginBottom: '0.4rem',
                    background: t.sttFailed ? '#fee2e2' : '#f8fafc',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {t.speaker}{t.sttFailed ? ' · STT FAILED' : ''}
                  </div>
                  <div style={{ fontSize: '0.95rem' }}>{t.sttFailed ? '(空·转写失败)' : t.text}</div>
                  {t.candidates && t.candidates.length > 0 && (
                    <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                      {t.candidates.map((c) => (
                        <li key={c.id}>
                          {c.meaningZh} → <b>{c.targetText}</b> <span style={{ color: '#888' }}>[{c.reading}]</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2>Latest candidates</h2>
          {latestCandidates && latestCandidates.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {latestCandidates.map((c) => (
                <li key={c.id} style={candidateStyle}>
                  <div style={{ fontWeight: 600 }}>{c.targetText}</div>
                  <div>{c.meaningZh}</div>
                  <div style={{ color: '#888', fontSize: '0.85rem' }}>{c.reading}</div>
                </li>
              ))}
            </ul>
          ) : state === 'LLM_STREAMING' ? (
            <p style={{ color: '#888' }}>streaming…</p>
          ) : (
            <p style={{ color: '#999' }}>(no candidates yet)</p>
          )}
        </section>
      </div>
    </main>
  )
}

function badge(state: string): React.CSSProperties {
  const colors: Record<string, string> = {
    IDLE: '#64748b',
    OTHER_SPEAKING: '#3b82f6',
    USER_SPEAKING: '#10b981',
    LLM_STREAMING: '#f59e0b',
  }
  return {
    background: colors[state] ?? '#64748b',
    color: 'white',
    padding: '0.15rem 0.6rem',
    borderRadius: 999,
    fontSize: '0.85rem',
  }
}

const candidateStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '0.5rem 0.7rem',
  marginBottom: '0.4rem',
}
