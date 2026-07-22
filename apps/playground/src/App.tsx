import { useState } from 'react'

export default function App() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('uploading')
    try {
      const form = new FormData()
      form.append('audio', file)
      const res = await fetch('/stt', { method: 'POST', body: form })
      const json = (await res.json()) as { text: string }
      setText(json.text)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <h1>Playground — STT echo</h1>
      <p>Upload a WAV; it POSTs to <code>/stt</code> and shows the response.</p>
      <input type="file" accept="audio/wav,audio/*" onChange={onFile} disabled={status === 'uploading'} />
      <p>status: {status}</p>
      <pre style={{ background: '#f4f4f4', padding: '1rem' }}>{text || '(no response yet)'}</pre>
    </main>
  )
}
