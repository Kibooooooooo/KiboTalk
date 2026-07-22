import { useEffect, useRef, useState } from 'react'
import type { PipelineEvent } from '@kibotalk/pipeline'
import { Pipeline } from '@kibotalk/pipeline'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { InMemoryConversationStorage } from '@kibotalk/conversation'
import { EmbeddingSpeakerVerifier, IndexedDbEmbeddingStorage } from '@kibotalk/speaker'
import type { Embedding } from '@kibotalk/speaker'
import { createVAD, defaultVadConfig } from '@kibotalk/audio/vad'
import type { VAD, VadConfig } from '@kibotalk/audio/vad'
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
import { createSileroInfer } from './audio/silero-vad'
import { createWorkerEmbedAudio } from './audio/speaker-embed'
import { ProxySttClient, ProxyLlmClient } from './proxy-clients'

type TurnView = ConversationTurn & { candidates?: ReplyCandidate[] }

/** VAD knobs exposed in the UI (sampleRate is fixed by the mic, not tunable). */
type TunableVadParams = Pick<
  VadConfig,
  'speechThreshold' | 'exitThreshold' | 'minSilenceDurationMs' | 'speechPadMs' | 'minSpeechDurationMs'
>

const DEFAULT_VAD_PARAMS: TunableVadParams = {
  speechThreshold: defaultVadConfig.speechThreshold,
  exitThreshold: defaultVadConfig.exitThreshold,
  minSilenceDurationMs: defaultVadConfig.minSilenceDurationMs,
  speechPadMs: defaultVadConfig.speechPadMs,
  minSpeechDurationMs: defaultVadConfig.minSpeechDurationMs,
}

const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  IDLE: 'secondary',
  OTHER_SPEAKING: 'default',
  USER_SPEAKING: 'default',
  LLM_STREAMING: 'outline',
}

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
  const [mode, setMode] = useState<'auto' | 'manual' | 'checking'>('checking')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [vadParams, setVadParams] = useState<TunableVadParams>(DEFAULT_VAD_PARAMS)
  const [speakerThreshold, setSpeakerThreshold] = useState(0.8)

  const speakerRef = useRef(speaker)
  speakerRef.current = speaker
  const llmRef = useRef<ProxyLlmClient | null>(null)
  const audioRef = useRef<AudioSource | null>(null)
  const pipelineRef = useRef<Pipeline | null>(null)
  const storageRef = useRef(new InMemoryConversationStorage())
  const verifierRef = useRef<EmbeddingSpeakerVerifier | null>(null)
  const embeddingRef = useRef<Embedding | null>(null)
  const autoRef = useRef(false)
  const vadRef = useRef<VAD | null>(null)

  // Live-tune VAD knobs and speaker threshold without restarting the session.
  useEffect(() => {
    vadRef.current?.updateConfig(vadParams)
  }, [vadParams])
  useEffect(() => {
    verifierRef.current?.setThreshold(speakerThreshold)
  }, [speakerThreshold])

  async function start() {
    setError('')
    setLoading('正在检查声纹录入…')
    setTurns([])
    setLatestCandidates(null)
    try {
      if (!verifierRef.current) {
        verifierRef.current = new EmbeddingSpeakerVerifier({
          embedAudio: createWorkerEmbedAudio(),
          storage: new IndexedDbEmbeddingStorage(),
          threshold: speakerThreshold,
        })
      }
      const embedding = await verifierRef.current.loadEmbedding()
      embeddingRef.current = embedding
      autoRef.current = !!embedding
      setMode(embedding ? 'auto' : 'manual')

      setLoading('正在请求麦克风 + 加载 VAD 模型…')
      const audio = new AudioSource()
      audioRef.current = audio
      const infer = await createSileroInfer(audio.sampleRate)
      const vad = createVAD(infer, { ...vadParams, sampleRate: audio.sampleRate })
      vadRef.current = vad
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
        const startedAt = now - e.duration * 1000
        const endedAt = now
        const ingest = (speaker: 'user' | 'other') =>
          void pipeline.ingestSegment({ pcm: e.buffer, speaker, startedAt, endedAt })

        if (autoRef.current && embeddingRef.current) {
          void verifierRef.current!
            .verify(e.buffer.buffer as ArrayBuffer, embeddingRef.current)
            .then((r) => {
              setConfidence(r.confidence)
              ingest(r.speaker)
            })
            .catch((err) => {
              setError(`说话人判定失败：${String(err)}`)
              ingest('other')
            })
        } else {
          ingest(speakerRef.current)
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
    audioRef.current?.stop()
    audioRef.current = null
    pipelineRef.current = null
    llmRef.current = null
    vadRef.current = null
    setRunning(false)
    setVadStatus('idle')
    setConfidence(null)
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>实时会话</CardTitle>
          <CardDescription>
            真实麦克风 → Silero VAD → 说话人判定 → 真实 /stt → 管线 → 真实 /llm 候选。
            候选流式生成时再次说话会中止它们（管线规则 2/5）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="live-level">水平</Label>
              <select
                id="live-level"
                value={level}
                onChange={(e) => onLevelChange(e.target.value)}
                disabled={running}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
              >
                {['N5', 'N4', 'N3', 'N2', 'N1'].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="live-scene">场景</Label>
              <Input
                id="live-scene"
                value={scene}
                onChange={(e) => onSceneChange(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="live-speaker">当前说话人</Label>
              <select
                id="live-speaker"
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value as 'user' | 'other')}
                disabled={mode === 'auto'}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
              >
                <option value="other">对方（相手）</option>
                <option value="user">我（学习者）</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            {!running ? (
              <Button onClick={start} disabled={!!loading}>{loading || '开始会话'}</Button>
            ) : (
              <Button variant="destructive" onClick={stop}>停止会话</Button>
            )}
            <Button variant="outline" onClick={clearSession} disabled={running}>清空会话</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">状态：</span>
            <Badge variant={STATE_VARIANT[state] ?? 'secondary'}>{state}</Badge>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">VAD：</span>
            <span>{vadStatus === 'speech' ? '说话中' : vadStatus === 'silence' ? '静音' : '空闲'}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium">说话人：</span>
            {mode === 'auto' ? (
              <span>自动{confidence !== null ? `（置信度 ${confidence.toFixed(2)}）` : ''}</span>
            ) : mode === 'manual' ? (
              <span>
                手动
                <span className="text-muted-foreground ml-2">
                 （到「声纹录入」页录入后可启用自动判定）
                </span>
              </span>
            ) : (
              <span>检测中…</span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">错误：{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>调试参数</CardTitle>
          <CardDescription>
            VAD 与说话人判定的阈值，改动实时生效（无需重启会话）。括号内为默认值。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <NumberField
              label="进入阈值（0.5）"
              value={vadParams.speechThreshold}
              step={0.05}
              min={0}
              max={1}
              onChange={(v) => setVadParams((p) => ({ ...p, speechThreshold: v }))}
            />
            <NumberField
              label="退出阈值（0.3）"
              value={vadParams.exitThreshold}
              step={0.05}
              min={0}
              max={1}
              onChange={(v) => setVadParams((p) => ({ ...p, exitThreshold: v }))}
            />
            <NumberField
              label="静音结束 ms（400）"
              value={vadParams.minSilenceDurationMs}
              step={50}
              min={0}
              onChange={(v) => setVadParams((p) => ({ ...p, minSilenceDurationMs: v }))}
            />
            <NumberField
              label="前后填充 ms（80）"
              value={vadParams.speechPadMs}
              step={10}
              min={0}
              onChange={(v) => setVadParams((p) => ({ ...p, speechPadMs: v }))}
            />
            <NumberField
              label="最短语音 ms（250）"
              value={vadParams.minSpeechDurationMs}
              step={50}
              min={0}
              onChange={(v) => setVadParams((p) => ({ ...p, minSpeechDurationMs: v }))}
            />
            <NumberField
              label="说话人阈值（0.8）"
              value={speakerThreshold}
              step={0.05}
              min={0}
              max={1}
              onChange={setSpeakerThreshold}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setVadParams(DEFAULT_VAD_PARAMS); setSpeakerThreshold(0.8) }}>
            恢复默认
          </Button>
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
                      {t.speaker === 'other' ? '对方' : '我'}{t.sttFailed ? ' · STT 失败' : ''}
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
          <CardContent>
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
            ) : state === 'LLM_STREAMING' ? (
              <p className="text-sm text-muted-foreground">正在流式生成…</p>
            ) : (
              <p className="text-sm text-muted-foreground">（还没有候选）</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
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
