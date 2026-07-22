import { useEffect, useRef, useState } from 'react'
import { EmbeddingSpeakerVerifier, IndexedDbEmbeddingStorage } from '@kibotalk/speaker'
import { createVAD } from '@kibotalk/audio/vad'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@kibotalk/ui'
import { AudioSource } from './audio/audio-source'
import { createSileroInfer } from './audio/silero-vad'
import { createWorkerEmbedAudio } from './audio/speaker-embed'

const PASSPHRASE = '你好，今天也请多多关照。'
type Status = 'idle' | 'requesting' | 'recording' | 'processing' | 'ready'

export default function Enrollment() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const verifierRef = useRef<EmbeddingSpeakerVerifier | null>(null)
  const audioRef = useRef<AudioSource | null>(null)

  function getVerifier(): EmbeddingSpeakerVerifier {
    if (!verifierRef.current) {
      verifierRef.current = new EmbeddingSpeakerVerifier({
        embedAudio: createWorkerEmbedAudio(),
        storage: new IndexedDbEmbeddingStorage(),
        threshold: 0.8,
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

  async function record() {
    setError('')
    setStatus('requesting')
    try {
      const audio = new AudioSource()
      audioRef.current = audio
      const infer = await createSileroInfer(audio.sampleRate)
      const vad = createVAD(infer, { sampleRate: audio.sampleRate })

      const captured = await new Promise<Float32Array>((resolve, reject) => {
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

      audio.stop()
      setStatus('processing')
      const verifier = getVerifier()
      async function* oneChunk() {
        yield captured.buffer as ArrayBuffer
      }
      await verifier.enroll(oneChunk(), PASSPHRASE)
      setEnrolled(true)
      setStatus('ready')
    } catch (e) {
      setError((e as Error).message)
      setStatus('idle')
      audioRef.current?.stop()
    }
  }

  async function clearEnrollment() {
    await new IndexedDbEmbeddingStorage().clear()
    setEnrolled(false)
    setStatus('idle')
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>声纹录入</CardTitle>
        <CardDescription>
          朗读一次固定文案以建立你的声纹（仅保存在本设备）。录入后，实时会话会自动判定你与对方。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/60 p-4">
          <div className="text-sm text-muted-foreground mb-1">固定文案：</div>
          <div className="text-xl font-semibold">{PASSPHRASE}</div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={record}
            disabled={status === 'requesting' || status === 'recording' || status === 'processing'}
          >
            {enrolled ? '重新录制' : '录制文案'}
          </Button>
          {enrolled && <Button variant="outline" onClick={clearEnrollment}>清除声纹</Button>}
        </div>

        <div className="space-y-1 text-sm">
          {status === 'requesting' && <p className="text-muted-foreground">正在请求麦克风 + 加载 VAD…</p>}
          {status === 'recording' && <p className="text-amber-600">录制中——请现在朗读文案…</p>}
          {status === 'processing' && (
            <p className="text-muted-foreground">正在计算声纹（首次使用会加载 wavlm）…</p>
          )}
          {status === 'ready' && <p className="text-emerald-600">已录入——实时会话将自动判定你。</p>}
          {enrolled && status === 'idle' && (
            <p className="text-emerald-600">本设备已有声纹。</p>
          )}
          {error && <p className="text-destructive">错误：{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
