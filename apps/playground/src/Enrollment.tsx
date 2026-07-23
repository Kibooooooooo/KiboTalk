import { useEffect, useRef, useState } from 'react'
import { EmbeddingSpeakerVerifier, IndexedDbEmbeddingStorage } from '@kibotalk/speaker'
import type { Speaker } from '@kibotalk/conversation'
import { createVAD } from '@kibotalk/audio/vad'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@kibotalk/ui'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer, SILERO_VARIANTS } from './audio/silero-vad'
import { createWorkerEmbedAudio } from './audio/speaker-embed'
import { useConfig } from './config-store'
import { NumberField } from './components/ConfigFields'

const PASSPHRASE = '你好，今天也请多多关照。'
type Status = 'idle' | 'requesting' | 'recording' | 'processing' | 'ready'
type Mode = 'enroll' | 'verify'
type VerifyView = { speaker: Speaker; similarity: number }

function labelFromSimilarity(similarity: number, threshold: number): Speaker {
  return similarity >= threshold ? 'user' : 'other'
}

export default function Enrollment() {
  const [status, setStatus] = useState<Status>('idle')
  const [mode, setMode] = useState<Mode | null>(null)
  const [error, setError] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [verifyView, setVerifyView] = useState<VerifyView | null>(null)
  const speakerThreshold = useConfig((s) => s.speakerThreshold)
  const verifierRef = useRef<EmbeddingSpeakerVerifier | null>(null)
  const audioRef = useRef<AudioSource | null>(null)

  function getVerifier(): EmbeddingSpeakerVerifier {
    if (!verifierRef.current) {
      verifierRef.current = new EmbeddingSpeakerVerifier({
        embedAudio: createWorkerEmbedAudio(),
        storage: new IndexedDbEmbeddingStorage(),
        threshold: useConfig.getState().speakerThreshold,
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

  useEffect(() => {
    verifierRef.current?.setThreshold(speakerThreshold)
    setVerifyView((prev) =>
      prev
        ? { similarity: prev.similarity, speaker: labelFromSimilarity(prev.similarity, speakerThreshold) }
        : prev,
    )
  }, [speakerThreshold])

  async function captureSpeech(): Promise<Float32Array> {
    const audio = new AudioSource()
    audioRef.current = audio
    const infer = await createSileroInfer(SILERO_VARIANTS[0], audio.sampleRate)
    const vad = createVAD(infer, { sampleRate: audio.sampleRate })

    try {
      return await new Promise<Float32Array>((resolve, reject) => {
        let done = false
        vad.on('speech-ready', (e) => {
          if (done) return
          done = true
          resolve(e.buffer)
        })
        void audio.start((chunk) => void vad.processAudio(chunk))
        setStatus('recording')
        setTimeout(() => {
          if (!done) {
            done = true
            reject(new Error('10 秒内未检测到语音'))
          }
        }, 10000)
      })
    } finally {
      audio.stop()
    }
  }

  async function withCapture(nextMode: Mode, run: (pcm: Float32Array) => Promise<void>) {
    setError('')
    setMode(nextMode)
    setStatus('requesting')
    try {
      const captured = await captureSpeech()
      setStatus('processing')
      const verifier = getVerifier()
      verifier.setThreshold(useConfig.getState().speakerThreshold)
      await run(captured)
      setMode(null)
    } catch (e) {
      setError((e as Error).message)
      setStatus('idle')
      setMode(null)
      audioRef.current?.stop()
    }
  }

  async function record() {
    await withCapture('enroll', async (captured) => {
      async function* oneChunk() {
        yield captured.buffer as ArrayBuffer
      }
      await getVerifier().enroll(oneChunk(), PASSPHRASE)
      setVerifyView(null)
      setEnrolled(true)
      setStatus('ready')
    })
  }

  async function verify() {
    await withCapture('verify', async (captured) => {
      const verifier = getVerifier()
      const embedding = await verifier.loadEmbedding()
      if (!embedding) throw new Error('本设备尚无声纹，请先录入')
      const result = await verifier.verify(captured.buffer as ArrayBuffer, embedding)
      setVerifyView({ speaker: result.speaker, similarity: result.similarity })
      setStatus('idle')
    })
  }

  async function clearEnrollment() {
    await new IndexedDbEmbeddingStorage().clear()
    setEnrolled(false)
    setVerifyView(null)
    setStatus('idle')
    setMode(null)
  }

  const busy = status === 'requesting' || status === 'recording' || status === 'processing'

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>声纹录入</CardTitle>
        <CardDescription>
          朗读一次固定文案以建立你的声纹（仅保存在本设备）。录入后可在本页用自由说话验证判定，
          实时会话也会自动区分你与对方。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/60 p-4">
          <div className="text-sm text-muted-foreground mb-1">固定文案（录入用）：</div>
          <div className="text-xl font-semibold">{PASSPHRASE}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={record} disabled={busy}>
            {enrolled ? '重新录制' : '录制文案'}
          </Button>
          {enrolled && (
            <>
              <Button variant="secondary" onClick={verify} disabled={busy}>
                验证声纹
              </Button>
              <Button variant="outline" onClick={clearEnrollment} disabled={busy}>
                清除声纹
              </Button>
            </>
          )}
        </div>

        {enrolled && (
          <NumberField
            label="说话人阈值（0.8）"
            value={speakerThreshold}
            step={0.05}
            min={0}
            max={1}
            disabled={busy}
            onChange={(v) => useConfig.getState().patch({ speakerThreshold: v })}
          />
        )}

        <div className="space-y-1 text-sm">
          {status === 'requesting' && (
            <p className="text-muted-foreground">正在请求麦克风 + 加载 VAD…</p>
          )}
          {status === 'recording' && mode === 'enroll' && (
            <p className="text-amber-600">录制中——请现在朗读文案…</p>
          )}
          {status === 'recording' && mode === 'verify' && (
            <p className="text-amber-600">验证中——请随便说一句…</p>
          )}
          {status === 'processing' && mode === 'enroll' && (
            <p className="text-muted-foreground">正在计算声纹（首次使用会加载 wavlm）…</p>
          )}
          {status === 'processing' && mode === 'verify' && (
            <p className="text-muted-foreground">正在比对声纹…</p>
          )}
          {status === 'ready' && (
            <p className="text-emerald-600">已录入——可用「验证声纹」或到实时会话自动判定。</p>
          )}
          {enrolled && status === 'idle' && !verifyView && (
            <p className="text-emerald-600">本设备已有声纹。</p>
          )}
          {verifyView && (
            <p className={verifyView.speaker === 'user' ? 'text-emerald-600' : 'text-amber-700'}>
              判定：{verifyView.speaker === 'user' ? '匹配（我）' : '不匹配（对方）'}
              {' · '}
              cosine similarity {verifyView.similarity.toFixed(3)}
              {' · '}
              阈值 {speakerThreshold.toFixed(2)}
              <span className="text-muted-foreground">（改阈值会立刻重判，无需重录）</span>
            </p>
          )}
          {error && <p className="text-destructive">错误：{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
