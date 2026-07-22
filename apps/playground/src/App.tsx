import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '@kibotalk/pipeline'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { createSession } from './session'
import type { SessionHandle } from './session'
import DirectApi from './DirectApi'
import LiveSession from './LiveSession'
import Enrollment from './Enrollment'

type TurnView = ConversationTurn & { candidates?: ReplyCandidate[]; failed?: boolean }

export default function App() {
  const [tab, setTab] = useState<'pipeline' | 'direct' | 'live' | 'enroll'>('pipeline')
  const scriptedRef = useRef('こんにちは')
  const sessionRef = useRef<SessionHandle | null>(null)
  if (!sessionRef.current) sessionRef.current = createSession(() => scriptedRef.current)
  const session = sessionRef.current

  const [state, setState] = useState('IDLE')
  const [turns, setTurns] = useState<TurnView[]>([])
  const [latestCandidates, setLatestCandidates] = useState<ReplyCandidate[] | null>(null)
  const [failedTurnId, setFailedTurnId] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [scriptedText, setScriptedText] = useState('こんにちは')
  const [sttFailNext, setSttFailNext] = useState(false)

  useEffect(() => {
    scriptedRef.current = scriptedText
  }, [scriptedText])

  useEffect(() => {
    const off = session.pipeline.on((e: PipelineEvent) => {
      pushLog(e)
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
          setFailedTurnId(e.turnId)
          break
        case 'llmFailed':
          setLatestCandidates(null)
          break
        default:
          break
      }
    })
    return off
  }, [session])

  function pushLog(e: PipelineEvent) {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${describe(e)}`, ...prev].slice(0, 50))
  }

  async function inject(speaker: 'user' | 'other', interrupted = false) {
    session.stt.setFailNext(sttFailNext)
    setSttFailNext(false)
    const now = Date.now()
    await session.pipeline.ingestSegment({
      pcm: new Float32Array(16),
      speaker,
      startedAt: now,
      endedAt: now + 1000,
      interrupted,
    })
  }

  async function clearSession() {
    await session.storage.clearActiveSession()
    setTurns([])
    setLatestCandidates(null)
    setFailedTurnId(null)
    setState('IDLE')
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 880 }}>
      <nav style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('pipeline')} style={tabBtn(tab === 'pipeline')}>Pipeline simulator</button>
        <button onClick={() => setTab('direct')} style={tabBtn(tab === 'direct')}>Direct API (STT/LLM)</button>
        <button onClick={() => setTab('live')} style={tabBtn(tab === 'live')}>Live session</button>
        <button onClick={() => setTab('enroll')} style={tabBtn(tab === 'enroll')}>Enrollment</button>
      </nav>
      {tab === 'direct' ? (
        <DirectApi />
      ) : tab === 'live' ? (
        <LiveSession />
      ) : tab === 'enroll' ? (
        <Enrollment />
      ) : (
        <>
      <h1>Playground — Pipeline session simulator</h1>
      <p style={{ color: '#666' }}>
        Feed scripted audio segments into the pipeline state machine (mock STT / LLM / stub speaker).
        Demonstrates spec §2.4 rules 1–8.
      </p>

      <section style={{ marginBottom: '1rem' }}>
        <strong>State:</strong>{' '}
        <span style={stateBadgeStyle(state)}>{state}</span>
      </section>

      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          scripted text:
          <input
            value={scriptedText}
            onChange={(e) => setScriptedText(e.target.value)}
            style={{ width: 220 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <input type="checkbox" checked={sttFailNext} onChange={(e) => setSttFailNext(e.target.checked)} />
          STT fail next
        </label>
      </section>

      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <button onClick={() => inject('other')}>Inject other segment</button>
        <button onClick={() => inject('other', true)}>Inject other (interrupted → 抢说, no LLM)</button>
        <button onClick={() => inject('user')}>Inject user segment</button>
        <button onClick={clearSession}>Clear session</button>
      </section>

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
                    {t.speaker}
                    {t.sttFailed ? ' · STT FAILED' : ''}
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
          ) : failedTurnId ? (
            <p style={{ color: '#dc2626' }}>STT failed for turn — UI would mark it red.</p>
          ) : state === 'LLM_STREAMING' ? (
            <p style={{ color: '#888' }}>streaming…</p>
          ) : (
            <p style={{ color: '#999' }}>(no candidates yet)</p>
          )}

          <h2 style={{ marginTop: '1.5rem' }}>Event log</h2>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '0.75rem', fontSize: '0.8rem', maxHeight: 240, overflow: 'auto' }}>
{log.join('\n') || '(no events)'}
          </pre>
        </section>
      </div>
        </>
      )}
    </main>
  )
}

function describe(e: PipelineEvent): string {
  switch (e.type) {
    case 'state': return `state → ${e.state}`
    case 'turnAppended': return `turnAppended ${e.turn.speaker}: "${e.turn.text || '(empty)'}"${e.turn.sttFailed ? ' [sttFailed]' : ''}`
    case 'candidatesStreaming': return `candidatesStreaming (turn ${e.turnId})`
    case 'candidateDelta': return `candidateDelta #${e.index}.${e.field} +${JSON.stringify(e.delta)}`
    case 'candidatesDone': return `candidatesDone (${e.candidates.length})`
    case 'llmAborted': return `llmAborted (turn ${e.turnId})`
    case 'sttFailed': return `sttFailed (turn ${e.turnId})`
    case 'llmFailed': return `llmFailed (turn ${e.turnId})`
    default: {
      const _exhaustive: never = e
      return String(_exhaustive)
    }
  }
}

function stateBadgeStyle(state: string): React.CSSProperties {
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

function tabBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? '#0f172a' : '#e2e8f0',
    color: active ? 'white' : '#0f172a',
    border: 'none',
    padding: '0.35rem 0.8rem',
    borderRadius: 6,
    cursor: 'pointer',
  }
}
