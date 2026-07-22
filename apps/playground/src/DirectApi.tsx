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

type CandidateState = ReplyCandidate[]

export default function DirectApi() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>直连 API — 真实 /stt + /llm</CardTitle>
          <CardDescription>
            直接调用代理路由。需要在 api 服务端配置 <code>STT_OPENROUTER_*</code> /{' '}
            <code>LLM_OPENROUTER_*</code> 环境变量（见仓库根目录 .env.example）。
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
  const [provider, setProvider] = useState<'cloud' | 'local'>('cloud')
  const [transcription, setTranscription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<AudioSource | null>(null)
  const chunksRef = useRef<Float32Array[]>([])

  async function sendWav(wav: ArrayBuffer) {
    setBusy(true)
    setError('')
    setTranscription('')
    try {
      // Always via the /stt proxy (keys stay server-side). ?provider= overrides
      // the active provider per request; the server resolves base URL / key /
      // model from its own env. 'local' = the openai-compatible provider, which
      // defaults to a local mlx-qwen3-asr server (see ADR 0002).
      const url = provider === 'local' ? '/stt?provider=openai' : '/stt'
      const res = await fetch(url, { method: 'POST', body: wav })
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
    const sampleRate = 16000
    const pcm = new Float32Array(sampleRate)
    for (let i = 0; i < sampleRate; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3
    sendWav(encodeWav(pcm, sampleRate))
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
            <Label htmlFor="stt-provider">STT 来源</Label>
            <select
              id="stt-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'cloud' | 'local')}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="cloud">云端代理（/stt，藏 key）</option>
              <option value="local">本地 Qwen3-ASR（浏览器直连）</option>
            </select>
          </div>
        </div>

        {provider === 'local' && (
          <p className="text-xs text-muted-foreground">
            本地模式：服务端需在 <code>.env</code> 配置 <code>STT_OPENAI_*</code>（指向本机
            <code>mlx-qwen3-asr serve</code>，默认 :8765）并运行 <code>pnpm dev:api</code>。
            key / base URL / 模型都在服务端，浏览器只选 provider。仅 Apple Silicon。见 ADR 0002。
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".wav,audio/wav" onChange={onFile} className="text-sm" />
          <Button variant="outline" onClick={sendSample} disabled={busy || recording}>发送示例 WAV</Button>
        </div>
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

        {error && <p className="text-sm text-destructive">错误：{error}</p>}

        {candidates.length > 0 ? (
          <ol className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="rounded-md border p-3">
                <div className="font-semibold">{c.targetText}</div>
                <div className="text-sm">{c.meaningZh}</div>
                <div className="text-xs text-muted-foreground">{c.reading}</div>
              </li>
            ))}
          </ol>
        ) : busy ? (
          <p className="text-sm text-muted-foreground">正在流式生成…</p>
        ) : (
          <p className="text-sm text-muted-foreground">（还没有候选）</p>
        )}

        {raw && (
          <details>
            <summary className="text-sm cursor-pointer">原始流</summary>
            <pre className="bg-slate-950 text-slate-200 rounded-md p-3 text-xs overflow-auto mt-2">
{raw}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
