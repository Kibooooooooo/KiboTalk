import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '@kibotalk/pipeline'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@kibotalk/ui'
import { createSession } from './session'
import type { SessionHandle } from './session'

type TurnView = ConversationTurn & { candidates?: ReplyCandidate[]; failed?: boolean }

const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  IDLE: 'secondary',
  OTHER_SPEAKING: 'default',
  USER_SPEAKING: 'default',
  LLM_STREAMING: 'outline',
}

export default function PipelineSimulator() {
  const scriptedRef = useRef('こんにちは')
  const sessionRef = useRef<SessionHandle | null>(null)
  if (!sessionRef.current) sessionRef.current = createSession(() => scriptedRef.current)
  const session = sessionRef.current

  const [state, setState] = useState('IDLE')
  const [turns, setTurns] = useState<TurnView[]>([])
  const [latestCandidates, setLatestCandidates] = useState<ReplyCandidate[] | null>(null)
  const [failedTurnId, setFailedTurnId] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [scriptedText, setScriptedText] = useState('你好，欢迎光临！')
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>试用场 — 管线会话模拟器</CardTitle>
          <p className="text-sm text-muted-foreground">
            把脚本化的音频段喂给管线状态机（模拟 STT / LLM / 桩说话人）。
            演示规格 §2.4 规则 1–8。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">状态：</span>
            <Badge variant={STATE_VARIANT[state] ?? 'secondary'}>{state}</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="scripted-text">脚本文本</Label>
              <Input
                id="scripted-text"
                value={scriptedText}
                onChange={(e) => setScriptedText(e.target.value)}
                className="w-56"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sttFailNext}
                onChange={(e) => setSttFailNext(e.target.checked)}
                className="h-4 w-4"
              />
              下一次 STT 失败
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => inject('other')}>注入对方段落</Button>
            <Button variant="outline" onClick={() => inject('other', true)}>
              注入对方段落（被打断 → 抢说，不出候选）
            </Button>
            <Button variant="secondary" onClick={() => inject('user')}>注入我的段落</Button>
            <Button variant="ghost" onClick={clearSession}>清空会话</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>时间轴</CardTitle>
          </CardHeader>
          <CardContent>
            {turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">（还没有对话轮次）</p>
            ) : (
              <ol className="space-y-2">
                {turns.map((t) => (
                  <li
                    key={t.id}
                    className={`border-l-4 pl-3 py-2 rounded-r-md ${
                      t.speaker === 'other' ? 'border-blue-500' : 'border-emerald-500'
                    } ${t.sttFailed ? 'bg-red-50' : 'bg-muted/50'}`}
                  >
                    <div className="font-semibold text-sm">
                      {t.speaker === 'other' ? '对方' : '我'}
                      {t.sttFailed ? ' · STT 失败' : ''}
                    </div>
                    <div className="text-sm">{t.sttFailed ? '（空·转写失败）' : t.text}</div>
                    {t.candidates && t.candidates.length > 0 && (
                      <ul className="mt-1 ml-4 text-xs text-muted-foreground list-disc">
                        {t.candidates.map((c) => (
                          <li key={c.id}>
                            {c.meaningZh} → <b className="text-foreground">{c.targetText}</b> [{c.reading}]
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最新候选</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestCandidates && latestCandidates.length > 0 ? (
              <ul className="space-y-2">
                {latestCandidates.map((c) => (
                  <li key={c.id} className="rounded-md border p-3">
                    <div className="font-semibold">{c.targetText}</div>
                    <div className="text-sm">{c.meaningZh}</div>
                    <div className="text-xs text-muted-foreground">{c.reading}</div>
                  </li>
                ))}
              </ul>
            ) : failedTurnId ? (
              <p className="text-sm text-destructive">该轮次 STT 失败——UI 会把它标红。</p>
            ) : state === 'LLM_STREAMING' ? (
              <p className="text-sm text-muted-foreground">正在流式生成…</p>
            ) : (
              <p className="text-sm text-muted-foreground">（还没有候选）</p>
            )}

            <div>
              <h3 className="text-sm font-semibold mb-2">事件日志</h3>
              <pre className="bg-slate-950 text-slate-200 rounded-md p-3 text-xs overflow-auto max-h-60">
{log.join('\n') || '（无事件）'}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function describe(e: PipelineEvent): string {
  switch (e.type) {
    case 'state': return `状态 → ${e.state}`
    case 'turnAppended': return `追加轮次 ${e.turn.speaker === 'other' ? '对方' : '我'}: "${e.turn.text || '（空）'}"${e.turn.sttFailed ? ' [STT失败]' : ''}`
    case 'candidatesStreaming': return `候选流式中（轮次 ${e.turnId}）`
    case 'candidateDelta': return `候选增量 #${e.index}.${e.field} +${JSON.stringify(e.delta)}`
    case 'candidatesDone': return `候选完成（${e.candidates.length} 条）`
    case 'llmAborted': return `LLM 中止（轮次 ${e.turnId}）`
    case 'sttFailed': return `STT 失败（轮次 ${e.turnId}）`
    case 'llmFailed': return `LLM 失败（轮次 ${e.turnId}）`
    default: {
      const _exhaustive: never = e
      return String(_exhaustive)
    }
  }
}
