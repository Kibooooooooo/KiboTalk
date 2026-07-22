import { useEffect, useRef, useState } from 'react'
import { createVAD, defaultVadConfig } from '@kibotalk/audio/vad'
import type { VAD } from '@kibotalk/audio/vad'
import { encodeWav } from '@kibotalk/audio'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@kibotalk/ui'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer, SILERO_VARIANTS } from './audio/silero-vad'

type Segment = {
  id: number
  duration: number
  buffer: Float32Array
  text?: string
  transcribing?: boolean
  sttError?: string
  sttMs?: number
}

type MergedSegment = {
  id: number
  duration: number
  buffer: Float32Array
  text?: string
  transcribing?: boolean
  sttError?: string
  sttMs?: number
  /** Ids of the VAD segments that were merged into this chunk. */
  segmentIds: number[]
}

type TranscribeMode = 'perSegment' | 'aggregated'

const STATUS_VARIANT = { idle: 'secondary', speech: 'default', silence: 'outline' } as const

export default function VadPanel() {
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'speech' | 'silence'>('idle')
  const [segments, setSegments] = useState<Segment[]>([])
  const [speechThreshold, setSpeechThreshold] = useState(defaultVadConfig.speechThreshold)
  const [exitThreshold, setExitThreshold] = useState(defaultVadConfig.exitThreshold)
  const [minSilenceDurationMs, setMinSilenceDurationMs] = useState(defaultVadConfig.minSilenceDurationMs)
  const [minSpeechDurationMs, setMinSpeechDurationMs] = useState(defaultVadConfig.minSpeechDurationMs)
  const [prePadMs, setPrePadMs] = useState(80)
  const [postPadMs, setPostPadMs] = useState(80)
  const [autoTranscribe, setAutoTranscribe] = useState(true)
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>('aggregated')
  const [vadVariantId, setVadVariantId] = useState<string>(SILERO_VARIANTS[0].id)
  const [mergeGapMs, setMergeGapMs] = useState(2000)
  const [mergeMaxMs, setMergeMaxMs] = useState(30000)
  const [mergedSegments, setMergedSegments] = useState<MergedSegment[]>([])
  const [prob, setProb] = useState(0)
  const [probHistory, setProbHistory] = useState<number[]>([])

  const audioRef = useRef<AudioSource | null>(null)
  const vadRef = useRef<VAD | null>(null)
  const segIdRef = useRef(0)
  const mergedIdRef = useRef(0)
  const sampleRateRef = useRef(16000)
  const playCtxRef = useRef<AudioContext | null>(null)
  const autoTranscribeRef = useRef(autoTranscribe)
  autoTranscribeRef.current = autoTranscribe
  const transcribeModeRef = useRef(transcribeMode)
  transcribeModeRef.current = transcribeMode
  const mergeGapMsRef = useRef(mergeGapMs)
  mergeGapMsRef.current = mergeGapMs
  const mergeMaxMsRef = useRef(mergeMaxMs)
  mergeMaxMsRef.current = mergeMaxMs
  const prePadMsRef = useRef(prePadMs)
  prePadMsRef.current = prePadMs
  const postPadMsRef = useRef(postPadMs)
  postPadMsRef.current = postPadMs
  // Aggregation state (mutated in async chunk/event callbacks → refs, not state).
  const mergeActiveRef = useRef(false)
  const mergeChunksRef = useRef<Float32Array[]>([])
  const lastSpeechEndAtRef = useRef<number | null>(null)
  const lastSpeechEndIdxRef = useRef(0)
  const currentMergeSegIdsRef = useRef<number[]>([])

  // Live-tune VAD knobs without restarting. speechPadMs is forced to 0 so VAD
  // cuts stay tight; pre/post padding is applied at ASR-send time (see padBuffer).
  useEffect(() => {
    vadRef.current?.updateConfig({
      speechThreshold,
      exitThreshold,
      minSilenceDurationMs,
      minSpeechDurationMs,
      speechPadMs: 0,
    })
  }, [speechThreshold, exitThreshold, minSilenceDurationMs, minSpeechDurationMs])

  // Stop playback when the panel unmounts.
  useEffect(() => {
    return () => {
      playCtxRef.current?.close().catch(() => {})
      playCtxRef.current = null
    }
  }, [])

  function playSegment(buffer: Float32Array) {
    const sampleRate = sampleRateRef.current
    let ctx = playCtxRef.current
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate })
      playCtxRef.current = ctx
    }
    void ctx.resume()
    const audioBuffer = ctx.createBuffer(1, buffer.length, sampleRate)
    audioBuffer.getChannelData(0).set(buffer)
    const src = ctx.createBufferSource()
    src.buffer = audioBuffer
    src.connect(ctx.destination)
    src.start()
  }

  async function transcribeSegment(id: number, buffer: Float32Array) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, transcribing: true } : s)))
    const padded = padBuffer(buffer, prePadMsRef.current, postPadMsRef.current, sampleRateRef.current)
    const _wav = encodeWav(padded, sampleRateRef.current)
    const startedAt = performance.now()
    try {
      const res = await fetch('/stt?provider=openai', { method: 'POST', body: _wav })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const sttMs = Math.round(performance.now() - startedAt)
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, text: json.text ?? '', transcribing: false, sttMs } : s)),
      )
    } catch (e) {
      const sttMs = Math.round(performance.now() - startedAt)
      setSegments((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, transcribing: false, sttError: (e as Error).message, sttMs } : s,
        ),
      )
    }
  }

  /** Close the current merge group: keep audio up to last speech end + a small pad,
   *  trim the long trailing silence that triggered the flush, then send to ASR. */
  function flushMerge() {
    if (!mergeActiveRef.current) return
    const chunks = mergeChunksRef.current
    const endIdx = Math.min(
      chunks.length,
      lastSpeechEndIdxRef.current + Math.ceil((200 * sampleRateRef.current) / 1000 / 512),
    )
    const merged = chunks.slice(0, endIdx)
    const segIds = [...currentMergeSegIdsRef.current]
    mergeActiveRef.current = false
    mergeChunksRef.current = []
    lastSpeechEndAtRef.current = null
    currentMergeSegIdsRef.current = []
    if (merged.length === 0) return
    const raw = concatFloat32(merged)
    const buffer = padBuffer(raw, prePadMsRef.current, postPadMsRef.current, sampleRateRef.current)
    const id = ++mergedIdRef.current
    const duration = buffer.length / sampleRateRef.current
    setMergedSegments((prev) => [...prev, { id, duration, buffer, segmentIds: segIds }].slice(-20))
    if (autoTranscribeRef.current) void transcribeMerged(id, buffer)
  }

  async function transcribeMerged(id: number, buffer: Float32Array) {
    setMergedSegments((prev) => prev.map((s) => (s.id === id ? { ...s, transcribing: true } : s)))
    const startedAt = performance.now()
    try {
      const wav = encodeWav(buffer, sampleRateRef.current)
      const res = await fetch('/stt?provider=openai', { method: 'POST', body: wav })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const sttMs = Math.round(performance.now() - startedAt)
      setMergedSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, text: json.text ?? '', transcribing: false, sttMs } : s)),
      )
    } catch (e) {
      const sttMs = Math.round(performance.now() - startedAt)
      setMergedSegments((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, transcribing: false, sttError: (e as Error).message, sttMs } : s,
        ),
      )
    }
  }

  async function start() {
    setError('')
    setLoading('正在请求麦克风 + 加载 VAD 模型…')
    setSegments([])
    setMergedSegments([])
    setProb(0)
    setProbHistory([])
    setStatus('idle')
    mergeActiveRef.current = false
    mergeChunksRef.current = []
    lastSpeechEndAtRef.current = null
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      sampleRateRef.current = audio.sampleRate
      const infer = await createSileroInfer(
        SILERO_VARIANTS.find((v) => v.id === vadVariantId) ?? SILERO_VARIANTS[0],
        audio.sampleRate,
      )
      const vad = createVAD(infer, { sampleRate: audio.sampleRate })
      vadRef.current = vad
      vad.on('prob', (p) => {
        setProb(p)
        setProbHistory((prev) => [...prev, p].slice(-120))
      })
      vad.on('speech-start', () => {
        setStatus('speech')
        if (transcribeModeRef.current === 'aggregated' && !mergeActiveRef.current) {
          mergeActiveRef.current = true
          mergeChunksRef.current = []
          lastSpeechEndAtRef.current = null
          currentMergeSegIdsRef.current = []
        }
      })
      vad.on('speech-end', () => {
        setStatus('silence')
        if (transcribeModeRef.current === 'aggregated' && mergeActiveRef.current) {
          lastSpeechEndAtRef.current = Date.now()
          lastSpeechEndIdxRef.current = Math.max(0, mergeChunksRef.current.length - 1)
        }
      })
      vad.on('speech-ready', (e) => {
        const id = ++segIdRef.current
        setSegments((prev) => [...prev, { id, duration: e.duration, buffer: e.buffer }].slice(-20))
        if (transcribeModeRef.current === 'aggregated') {
          currentMergeSegIdsRef.current.push(id)
        } else if (autoTranscribeRef.current) {
          void transcribeSegment(id, e.buffer)
        }
      })
      await audio.start((chunk) => {
        // Tap the raw mic stream (speech + silence) for aggregation so the
        // silence between sub-segments is preserved in the merged chunk.
        if (transcribeModeRef.current === 'aggregated' && mergeActiveRef.current) {
          mergeChunksRef.current.push(chunk)
          const samples = mergeChunksRef.current.reduce((n, c) => n + c.length, 0)
          const durMs = (samples / sampleRateRef.current) * 1000
          if (durMs > mergeMaxMsRef.current) {
            flushMerge()
          } else if (
            lastSpeechEndAtRef.current !== null &&
            Date.now() - lastSpeechEndAtRef.current > mergeGapMsRef.current
          ) {
            flushMerge()
          }
        }
        void vad.processAudio(chunk)
      })
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
    vadRef.current = null
    setRunning(false)
    setStatus('idle')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAD 检测 — 是否有语音输入</CardTitle>
        <CardDescription>
          真实麦克风 → Silero VAD。实时显示说话/静音状态，并记录每一段被切出来的语音片段时长。
          用于验证 §2.4 的「一句结束」切段能力（F03 前置）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            {!running ? (
              <Button onClick={start} disabled={!!loading}>{loading || '开始检测'}</Button>
            ) : (
              <Button variant="destructive" onClick={stop}>停止检测</Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoTranscribe}
              onChange={(e) => setAutoTranscribe(e.target.checked)}
              className="h-4 w-4"
            />
            <span>自动转写（本地 Qwen3-ASR，/stt?provider=openai）</span>
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">VAD 模型：</span>
            <select
              value={vadVariantId}
              onChange={(e) => setVadVariantId(e.target.value)}
              disabled={running}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
            >
              {SILERO_VARIANTS.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">转写模式：</span>
            <select
              value={transcribeMode}
              onChange={(e) => setTranscribeMode(e.target.value as TranscribeMode)}
              disabled={running}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
            >
              <option value="aggregated">聚合（合并多段，保留中间静音）</option>
              <option value="perSegment">逐段（每个 VAD 片段单独转写）</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">状态：</span>
          <Badge variant={STATUS_VARIANT[status]}>
            {status === 'speech' ? '说话中' : status === 'silence' ? '静音' : '空闲'}
          </Badge>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium">已切段：</span>
          <span>{segments.length}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            label="进入阈值（0.5）"
            value={speechThreshold}
            step={0.01}
            min={0}
            max={1}
            onChange={setSpeechThreshold}
          />
          <NumberField
            label="退出阈值（0.3）"
            value={exitThreshold}
            step={0.01}
            min={0}
            max={1}
            onChange={setExitThreshold}
          />
          <NumberField
            label="静音结束 ms（400）"
            value={minSilenceDurationMs}
            step={50}
            min={0}
            onChange={setMinSilenceDurationMs}
          />
          <NumberField
            label="最短语音 ms（250）"
            value={minSpeechDurationMs}
            step={50}
            min={0}
            onChange={setMinSpeechDurationMs}
          />
          <NumberField
            label="前填充 ms（80）·ASR"
            value={prePadMs}
            step={10}
            min={0}
            onChange={setPrePadMs}
          />
          <NumberField
            label="后填充 ms（80）·ASR"
            value={postPadMs}
            step={10}
            min={0}
            onChange={setPostPadMs}
          />
          <NumberField
            label="合并间隙 ms（2000）·聚合"
            value={mergeGapMs}
            step={100}
            min={0}
            onChange={setMergeGapMs}
          />
          <NumberField
            label="合并上限 ms（30000）·聚合"
            value={mergeMaxMs}
            step={1000}
            min={0}
            onChange={setMergeMaxMs}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">语音概率：</span>
            <span className={(prob > speechThreshold ? 'text-green-600' : prob > speechThreshold * 0.5 ? 'text-yellow-600' : 'text-muted-foreground') + ' font-mono'}>
              {(prob * 100).toFixed(1)}%
            </span>
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                prob > speechThreshold
                  ? 'bg-green-500 shadow-sm shadow-green-500/50'
                  : prob > speechThreshold * 0.5
                    ? 'bg-yellow-500'
                    : 'bg-muted border border-muted-foreground/30'
              }`}
            />
            <span className="text-muted-foreground text-xs">
              （绿 = 超过进入阈值 {speechThreshold.toFixed(2)}；黄 = 接近；灰 = 静音）
            </span>
          </div>

          {/* Probability bar 0–1 with threshold markers */}
          <div className="relative h-4 w-full rounded-md border bg-muted/40 overflow-hidden">
            <div
              className={`h-full transition-[width] duration-75 ${
                prob > speechThreshold ? 'bg-green-500/70' : prob > speechThreshold * 0.5 ? 'bg-yellow-500/70' : 'bg-muted-foreground/30'
              }`}
              style={{ width: `${Math.min(100, prob * 100)}%` }}
            />
            <div className="absolute top-0 bottom-0 w-px bg-green-600" style={{ left: `${speechThreshold * 100}%` }} title={`进入阈值 ${speechThreshold}`} />
            <div className="absolute top-0 bottom-0 w-px bg-red-500/70" style={{ left: `${exitThreshold * 100}%` }} title={`退出阈值 ${exitThreshold}`} />
          </div>

          {/* Sparkline of recent probability with threshold line */}
          <div className="rounded-md border bg-muted/20 p-1">
            <svg viewBox="0 0 120 40" preserveAspectRatio="none" className="h-20 w-full">
              <line
                x1={0} x2={120} y1={40 - speechThreshold * 40} y2={40 - speechThreshold * 40}
                stroke="rgb(22 163 74)" strokeWidth={0.5} strokeDasharray="2 2"
              />
              <line
                x1={0} x2={120} y1={40 - exitThreshold * 40} y2={40 - exitThreshold * 40}
                stroke="rgb(239 68 68)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.6}
              />
              {probHistory.length > 1 && (
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  points={probHistory
                    .map((p, i) => `${(i / (probHistory.length - 1)) * 120},${40 - p * 40}`)
                    .join(' ')}
                />
              )}
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">
            实时概率历史（最近 {probHistory.length} 个 chunk）。绿虚线 = 进入阈值，红虚线 = 退出阈值。说话时曲线应越过绿线。
          </p>
        </div>

        {error && <p className="text-sm text-destructive">错误：{error}</p>}

        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="text-sm font-semibold">
            {transcribeMode === 'aggregated' ? '合并片段（最新在上，含组成片段）' : '语音片段（最新在上）'}
          </h4>

          {transcribeMode === 'aggregated' ? (
            mergedSegments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                （还没有合并片段——说几句话后停顿 {mergeGapMs}ms 以上会触发一次合并转写）
              </p>
            ) : (
              <ol className="space-y-3 text-sm">
                {[...mergedSegments].reverse().map((m) => {
                  const segById = new Map(segments.map((s) => [s.id, s]))
                  return (
                    <li key={m.id} className="rounded-md border bg-card p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">合并 #{m.id}</span>
                        <span className="text-muted-foreground">{(m.duration * 1000).toFixed(0)} ms</span>
                        <span className="text-muted-foreground">· 含 {m.segmentIds.length} 个片段</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => playSegment(m.buffer)}
                        >
                          播放合并
                        </Button>
                      </div>
                      {autoTranscribe && (
                        <div className="ml-1 flex items-start gap-2">
                          <span className="flex-1">
                            {m.transcribing ? (
                              <span className="text-muted-foreground">转写中…</span>
                            ) : m.sttError ? (
                              <span className="text-destructive">转写失败：{m.sttError}</span>
                            ) : (
                              <span>{m.text ?? ''}</span>
                            )}
                          </span>
                          {m.sttMs != null && !m.transcribing && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">耗时 {m.sttMs} ms</span>
                          )}
                        </div>
                      )}
                      <ol className="ml-3 border-l pl-3 space-y-1">
                        {m.segmentIds.map((sid) => {
                          const seg = segById.get(sid)
                          if (!seg) return null
                          return (
                            <li key={sid} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>片段 #{seg.id}</span>
                              <span>{(seg.duration * 1000).toFixed(0)} ms</span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-xs"
                                onClick={() => playSegment(seg.buffer)}
                              >
                                播放
                              </Button>
                            </li>
                          )
                        })}
                      </ol>
                    </li>
                  )
                })}
              </ol>
            )
          ) : segments.length === 0 ? (
            <p className="text-sm text-muted-foreground">（还没有检测到语音）</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {[...segments].reverse().map((s) => (
                <li key={s.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">#{s.id}</span>
                    <span>{(s.duration * 1000).toFixed(0)} ms</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => playSegment(s.buffer)}
                    >
                      播放
                    </Button>
                  </div>
                  {autoTranscribe && (
                    <div className="ml-6 flex items-start gap-2">
                      <span className="flex-1">
                        {s.transcribing ? (
                          <span className="text-muted-foreground">转写中…</span>
                        ) : s.sttError ? (
                          <span className="text-destructive">转写失败：{s.sttError}</span>
                        ) : (
                          <span>{s.text ?? ''}</span>
                        )}
                      </span>
                      {s.sttMs != null && !s.transcribing && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">耗时 {s.sttMs} ms</span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

      </CardContent>
    </Card>
  )
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="h-8"
      />
    </div>
  )
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** Pad an audio buffer with leading/trailing silence (ASR preprocessing). */
function padBuffer(buffer: Float32Array, preMs: number, postMs: number, sampleRate: number): Float32Array {
  const pre = Math.round((preMs / 1000) * sampleRate)
  const post = Math.round((postMs / 1000) * sampleRate)
  if (pre <= 0 && post <= 0) return buffer
  const out = new Float32Array(buffer.length + pre + post)
  out.set(buffer, pre)
  return out
}
