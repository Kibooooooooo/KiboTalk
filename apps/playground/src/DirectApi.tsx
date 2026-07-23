import { useRef, useState } from 'react'
import { encodeWav } from '@kibotalk/audio'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Textarea,
} from '@kibotalk/ui'
import { extractCandidates } from './partial-json'
import { parseSseStream } from './sse'
import { AudioSource } from './audio/audio-source'
import { SttProviderSelect, useTranscribeProvider, sttUrl } from './SttProviderSelect'
import { useConfig } from './config-store'
import { ReplyCandidateCard } from './components/ReplyCandidateCard'

type CandidateState = ReplyCandidate[]

type LlmRunStatus = 'idle' | 'waiting' | 'generating' | 'done' | 'aborted'

type LlmMetrics = {
  status: LlmRunStatus
  /** Request start → first token (ms). */
  ttftMs: number | null
  /** First token → end (ms). */
  genMs: number | null
  /** Request start → end (ms). */
  totalMs: number | null
  charCount: number
  charsPerSec: number | null
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatRate(rate: number | null): string {
  if (rate == null) return '—'
  return `${rate.toFixed(1)} chars/s`
}

/** Pretty-print complete JSON; otherwise show buffered tail for readability. */
function formatStreamBuffer(raw: string): { label: string; text: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { label: '（空）', text: '' }
  try {
    return { label: '完整 JSON', text: JSON.stringify(JSON.parse(trimmed), null, 2) }
  } catch {
    const tail = trimmed.length > 800 ? trimmed.slice(-800) : trimmed
    return {
      label: trimmed.length > 800 ? '缓冲中（尾部）' : '缓冲中',
      text: tail,
    }
  }
}

const STATUS_LABEL: Record<LlmRunStatus, string> = {
  idle: '空闲',
  waiting: '等待首 token…',
  generating: '生成中',
  done: '完成',
  aborted: '已中止',
}

export default function DirectApi() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>直连 API — 真实 /stt + /llm</CardTitle>
          <CardDescription>
            直接调用代理路由。需要在 api 服务端配置 <code>STT_OPENROUTER_*</code> /{' '}
            <code>LLM_*</code> 环境变量（见仓库根目录 .env.example；本地 LM Studio 用 <code>LLM_OPENAI_*</code>）。
          </CardDescription>
        </CardHeader>
      </Card>

      <SttPanel />
      <Separator />
      <LlmPanel />
    </div>
  )
}

function SttPanel() {
  const { providers, provider } = useTranscribeProvider()
  const patch = useConfig((s) => s.patch)
  const [transcription, setTranscription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const audioRef = useRef<AudioSource | null>(null)
  const chunksRef = useRef<Float32Array[]>([])

  async function sendWav(wav: ArrayBuffer) {
    setBusy(true)
    setError('')
    setTranscription('')
    try {
      // Always via the /stt proxy (keys stay server-side). ?provider= overrides
      // the active provider per request; the server resolves base URL / key /
      // model from its own env. See ADR 0002.
      const res = await fetch(sttUrl(useConfig.getState().transcribeProvider), { method: 'POST', body: wav })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setTranscription(json.text ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    setError('')
    setTranscription('')
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      chunksRef.current = []
      await audio.start((chunk) => {
        chunksRef.current.push(new Float32Array(chunk))
      })
      setRecording(true)
    } catch (e) {
      setError((e as Error).message)
      audioRef.current?.stop()
      audioRef.current = null
    }
  }

  async function stopAndTranscribe() {
    const audio = audioRef.current
    const sampleRate = audio?.sampleRate ?? 16000
    audio?.stop()
    audioRef.current = null
    setRecording(false)
    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) return
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      pcm.set(c, off)
      off += c.length
    }
    await sendWav(encodeWav(pcm, sampleRate))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>/stt — 语音转写</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">STT 来源：</span>
            <SttProviderSelect
              providers={providers}
              value={provider}
              onChange={(p) => patch({ transcribeProvider: p })}
              allowOff={false}
              offLabel=""
            />
          </div>
        </div>

        {provider === 'openai' && (
          <p className="text-xs text-muted-foreground">
            本地模式：服务端需在 <code>.env</code> 配置 <code>STT_OPENAI_*</code>（指向本机
            <code>mlx-qwen3-asr serve</code>，默认 :8765）并运行 <code>pnpm dev:api</code>。
            key / base URL / 模型都在服务端，浏览器只选 provider。仅 Apple Silicon。见 ADR 0002。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!recording ? (
            <Button onClick={startRecording} disabled={busy}>开始录音</Button>
          ) : (
            <Button variant="destructive" onClick={stopAndTranscribe}>停止并转写</Button>
          )}
          {recording && <span className="text-sm text-amber-600">录音中…（再次点击结束）</span>}
        </div>
        {busy && <p className="text-sm text-muted-foreground">转写中…</p>}
        {error && <p className="text-sm text-destructive">错误：{error}</p>}
        {transcription && (
          <p className="rounded-md bg-muted/60 p-3 text-sm">
            <b>文本：</b>{transcription}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function LlmPanel() {
  const [level, setLevel] = useState('N5')
  const [scene, setScene] = useState('便利店')
  const [contextText, setContextText] = useState('other: 你好，欢迎光临！\nuser: （我想说）我只是随便看看')
  const [candidates, setCandidates] = useState<CandidateState>([])
  const [raw, setRaw] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [metrics, setMetrics] = useState<LlmMetrics>({
    status: 'idle',
    ttftMs: null,
    genMs: null,
    totalMs: null,
    charCount: 0,
    charsPerSec: null,
  })
  const [tokenBatches, setTokenBatches] = useState<Array<{ atMs: number; chars: number }>>([])
  const abortRef = useRef<AbortController | null>(null)
  const batchRef = useRef({ chars: 0, lastFlush: 0 })

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
    setPrompt('')
    setCandidates([])
    setTokenBatches([])
    batchRef.current = { chars: 0, lastFlush: 0 }
    const t0 = performance.now()
    let firstTokenAt: number | null = null
    setMetrics({
      status: 'waiting',
      ttftMs: null,
      genMs: null,
      totalMs: null,
      charCount: 0,
      charsPerSec: null,
    })
    const controller = new AbortController()
    abortRef.current = controller
    let rawAccum = ''
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
        if (msg.event === 'error') {
          setError(msg.data)
          continue
        }
        if (msg.event === 'prompt') {
          setPrompt(msg.data)
          continue
        }
        if (msg.event !== 'token') continue

        const now = performance.now()
        if (firstTokenAt == null) {
          firstTokenAt = now
          setMetrics((m) => ({ ...m, status: 'generating', ttftMs: now - t0 }))
        }

        rawAccum += msg.data
        const next = rawAccum
        setRaw(next)
        setCandidates((cur) => {
          const parsed = extractCandidates(next)
          return parsed.length > cur.length ? parsed : cur
        })
        const elapsedGen = firstTokenAt != null ? now - firstTokenAt : 0
        setMetrics((m) => ({
          ...m,
          charCount: next.length,
          genMs: elapsedGen,
          totalMs: now - t0,
          charsPerSec: elapsedGen > 0 ? (next.length / elapsedGen) * 1000 : null,
        }))

        // Coalesce SSE token log ~every 100ms to keep the list readable.
        batchRef.current.chars += msg.data.length
        if (now - batchRef.current.lastFlush >= 100 && batchRef.current.chars > 0) {
          const chars = batchRef.current.chars
          batchRef.current = { chars: 0, lastFlush: now }
          setTokenBatches((prev) => [...prev, { atMs: now - t0, chars }])
        }
      }
      if (batchRef.current.chars > 0) {
        const now = performance.now()
        setTokenBatches((prev) => [...prev, { atMs: now - t0, chars: batchRef.current.chars }])
        batchRef.current = { chars: 0, lastFlush: now }
      }
      const tEnd = performance.now()
      setMetrics({
        status: 'done',
        ttftMs: firstTokenAt != null ? firstTokenAt - t0 : null,
        totalMs: tEnd - t0,
        genMs: firstTokenAt != null ? tEnd - firstTokenAt : null,
        charCount: rawAccum.length,
        charsPerSec:
          firstTokenAt != null && tEnd > firstTokenAt
            ? (rawAccum.length / (tEnd - firstTokenAt)) * 1000
            : null,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const tEnd = performance.now()
        setMetrics((m) => ({
          ...m,
          status: 'aborted',
          totalMs: tEnd - t0,
          genMs: firstTokenAt != null ? tEnd - firstTokenAt : m.genMs,
        }))
      } else {
        setError((e as Error).message)
        setMetrics((m) => ({ ...m, status: 'idle' }))
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function abort() {
    abortRef.current?.abort()
  }

  const streamView = formatStreamBuffer(raw)

  return (
    <Card>
      <CardHeader>
        <CardTitle>/llm — 3 条回复候选（流式）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="llm-level">水平</Label>
            <select
              id="llm-level"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {['N5', 'N4', 'N3', 'N2', 'N1'].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="llm-scene">场景</Label>
            <Input id="llm-scene" value={scene} onChange={(e) => setScene(e.target.value)} className="w-36" />
          </div>
        </div>

        <Textarea
          value={contextText}
          onChange={(e) => setContextText(e.target.value)}
          rows={4}
          className="font-mono"
        />

        <div className="flex gap-2">
          <Button onClick={generate} disabled={busy}>生成</Button>
          <Button variant="outline" onClick={abort} disabled={!busy}>中止</Button>
        </div>

        {metrics.status !== 'idle' && (
          <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 text-xs sm:grid-cols-3 md:grid-cols-6">
            <div>
              <div className="text-muted-foreground">状态</div>
              <div className="font-medium">{STATUS_LABEL[metrics.status]}</div>
            </div>
            <div>
              <div className="text-muted-foreground">预填充 (TTFT)</div>
              <div className="font-medium tabular-nums">{formatMs(metrics.ttftMs)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">生成时长</div>
              <div className="font-medium tabular-nums">{formatMs(metrics.genMs)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">总耗时</div>
              <div className="font-medium tabular-nums">{formatMs(metrics.totalMs)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">输出字符</div>
              <div className="font-medium tabular-nums">{metrics.charCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">速率</div>
              <div className="font-medium tabular-nums">{formatRate(metrics.charsPerSec)}</div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">错误：{error}</p>}

        {candidates.length > 0 ? (
          <ol className="space-y-2">
            {candidates.map((c) => (
              <ReplyCandidateCard key={c.id} candidate={c} />
            ))}
          </ol>
        ) : busy ? (
          <p className="text-sm text-muted-foreground">正在流式生成…</p>
        ) : (
          <p className="text-sm text-muted-foreground">（还没有候选）</p>
        )}

        <details open={Boolean(prompt)}>
          <summary className="cursor-pointer text-sm">
            发给模型的 prompt（role=user；当前无独立 system）
          </summary>
          {prompt ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-200 whitespace-pre-wrap">
{prompt}
            </pre>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">点「生成」后由服务端渲染并通过 SSE 下发。</p>
          )}
        </details>

        {raw && (
          <details open>
            <summary className="cursor-pointer text-sm">
              输出流 · {streamView.label}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-200">
{streamView.text}
            </pre>
          </details>
        )}

        {tokenBatches.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm">
              SSE token 批次（约 100ms 合并，{tokenBatches.length} 批）
            </summary>
            <ul className="mt-2 max-h-40 overflow-auto font-mono text-xs text-muted-foreground">
              {tokenBatches.map((b, i) => (
                <li key={i}>
                  +{formatMs(b.atMs)} · {b.chars} chars
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
