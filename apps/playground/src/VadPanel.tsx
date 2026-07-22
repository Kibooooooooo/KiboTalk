import { useEffect, useRef, useState } from 'react'
import { createVAD } from '@kibotalk/audio/vad'
import type { VAD } from '@kibotalk/audio/vad'
import { encodeWav, padBuffer } from '@kibotalk/audio'
import { createSegmentAggregator } from '@kibotalk/audio/aggregator'
import type { SegmentAggregator, AggregatedSegment } from '@kibotalk/audio/aggregator'
import { useConfig } from './config-store'
import { sttUrl } from './SttProviderSelect'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kibotalk/ui'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer, SILERO_VARIANTS } from './audio/silero-vad'
import {
  VadParamsFields,
  AsrPadFields,
  MergeParamsFields,
  VadModelSelect,
  TranscribeModeSelect,
  TranscribeProviderSelect,
} from './components/ConfigFields'

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
  constituents: { buffer: Float32Array; duration: number }[]
}

const STATUS_VARIANT = { idle: 'secondary', speech: 'default', silence: 'outline' } as const

export default function VadPanel() {
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'speech' | 'silence'>('idle')
  const [segments, setSegments] = useState<Segment[]>([])
  const [mergedSegments, setMergedSegments] = useState<MergedSegment[]>([])
  const [prob, setProb] = useState(0)
  const [probHistory, setProbHistory] = useState<number[]>([])

  // Shared config (zustand). UI reads via hooks; async callbacks read
  // useConfig.getState() so they always see the latest values without refs.
  const speechThreshold = useConfig((s) => s.speechThreshold)
  const exitThreshold = useConfig((s) => s.exitThreshold)
  const minSilenceDurationMs = useConfig((s) => s.minSilenceDurationMs)
  const minSpeechDurationMs = useConfig((s) => s.minSpeechDurationMs)
  const otherPauseMs = useConfig((s) => s.otherPauseMs)
  const userPauseMs = useConfig((s) => s.userPauseMs)
  const transcribeProvider = useConfig((s) => s.transcribeProvider)
  const transcribeMode = useConfig((s) => s.transcribeMode)
  const mergeMaxMs = useConfig((s) => s.mergeMaxMs)

  const audioRef = useRef<AudioSource | null>(null)
  const vadRef = useRef<VAD | null>(null)
  const aggregatorRef = useRef<SegmentAggregator | null>(null)
  const segIdRef = useRef(0)
  const mergedIdRef = useRef(0)
  const sampleRateRef = useRef(16000)
  const playCtxRef = useRef<AudioContext | null>(null)

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

  // Live-tune the aggregator's merge/scheduling knobs.
  useEffect(() => {
    aggregatorRef.current?.updateConfig({ otherPauseMs, userPauseMs, maxMs: mergeMaxMs })
  }, [otherPauseMs, userPauseMs, mergeMaxMs])

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
    const { prePadMs, postPadMs, transcribeProvider } = useConfig.getState()
    const padded = padBuffer(buffer, prePadMs, postPadMs, sampleRateRef.current)
    const _wav = encodeWav(padded, sampleRateRef.current)
    const startedAt = performance.now()
    try {
      const res = await fetch(sttUrl(transcribeProvider), { method: 'POST', body: _wav })
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

  async function transcribeMerged(id: number, buffer: Float32Array) {
    setMergedSegments((prev) => prev.map((s) => (s.id === id ? { ...s, transcribing: true } : s)))
    const { transcribeProvider } = useConfig.getState()
    const startedAt = performance.now()
    try {
      const wav = encodeWav(buffer, sampleRateRef.current)
      const res = await fetch(sttUrl(transcribeProvider), { method: 'POST', body: wav })
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
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      sampleRateRef.current = audio.sampleRate
      const cfg = useConfig.getState()
      const infer = await createSileroInfer(
        SILERO_VARIANTS.find((v) => v.id === cfg.vadVariantId) ?? SILERO_VARIANTS[0],
        audio.sampleRate,
      )
      const vad = createVAD(infer, { sampleRate: audio.sampleRate })
      vadRef.current = vad

      // Aggregator: same shared module the live session uses. The VAD panel has
      // no speaker verification, so every segment is fed as 'other' (the panel's
      // pause threshold is therefore `otherPauseMs`).
      const aggregator = createSegmentAggregator({
        sampleRate: audio.sampleRate,
        otherPauseMs: cfg.otherPauseMs,
        userPauseMs: cfg.userPauseMs,
        maxMs: cfg.mergeMaxMs,
      })
      aggregator.onFlush((merged: AggregatedSegment) => {
        const id = ++mergedIdRef.current
        const { prePadMs, postPadMs, transcribeProvider } = useConfig.getState()
        const buffer = padBuffer(merged.pcm, prePadMs, postPadMs, sampleRateRef.current)
        const duration = buffer.length / sampleRateRef.current
        const constituents = merged.segments.map((s) => ({
          buffer: s.buffer,
          duration: s.buffer.length / sampleRateRef.current,
        }))
        setMergedSegments((prev) => [...prev, { id, duration, buffer, constituents }].slice(-20))
        if (transcribeProvider !== null) void transcribeMerged(id, buffer)
      })
      aggregatorRef.current = aggregator

      vad.on('prob', (p) => {
        setProb(p)
        setProbHistory((prev) => [...prev, p].slice(-120))
      })
      vad.on('speech-start', () => setStatus('speech'))
      vad.on('speech-end', () => setStatus('silence'))
      vad.on('speech-ready', (e) => {
        const id = ++segIdRef.current
        setSegments((prev) => [...prev, { id, duration: e.duration, buffer: e.buffer }].slice(-20))
        const { transcribeMode, transcribeProvider } = useConfig.getState()
        if (transcribeMode === 'aggregated') {
          aggregator.feed({
            buffer: e.buffer,
            speaker: 'other',
            startedAt: Date.now() - e.duration * 1000,
            endedAt: Date.now(),
          })
        } else if (transcribeProvider !== null) {
          void transcribeSegment(id, e.buffer)
        }
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
    aggregatorRef.current?.flush()
    aggregatorRef.current?.dispose()
    aggregatorRef.current = null
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
          <TranscribeProviderSelect />
          <VadModelSelect disabled={running} />
          <TranscribeModeSelect disabled={running} />
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
          <VadParamsFields />
          <AsrPadFields />
          <MergeParamsFields disabled={transcribeMode === 'perSegment'} />
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
                （还没有合并片段——说几句话后停顿 {otherPauseMs}ms 以上会触发一次合并转写）
              </p>
            ) : (
              <ol className="space-y-3 text-sm">
                {[...mergedSegments].reverse().map((m) => {
                  return (
                    <li key={m.id} className="rounded-md border bg-card p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">合并 #{m.id}</span>
                        <span className="text-muted-foreground">{(m.duration * 1000).toFixed(0)} ms</span>
                        <span className="text-muted-foreground">· 含 {m.constituents.length} 个片段</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => playSegment(m.buffer)}
                        >
                          播放合并
                        </Button>
                      </div>
                      {transcribeProvider !== null && (
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
                        {m.constituents.map((c, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>片段 {i + 1}</span>
                            <span>{(c.duration * 1000).toFixed(0)} ms</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-5 px-1.5 text-xs"
                              onClick={() => playSegment(c.buffer)}
                            >
                              播放
                            </Button>
                          </li>
                        ))}
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
                  {transcribeProvider !== null && (
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
