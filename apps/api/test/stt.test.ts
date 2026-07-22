import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { serve } from '@hono/node-server'
import { app } from '../src/app'
import { encodeWav } from '@kibotalk/audio'

const ENV = {
  STT_ACTIVE: 'openrouter',
  STT_OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
  STT_OPENROUTER_API_KEY: 'sk-test-secret-do-not-leak',
  STT_OPENROUTER_MODEL: 'openai/gpt-4o-transcribe',
}

let server: ReturnType<typeof serve>
let baseUrl: string
let realFetch: typeof globalThis.fetch

beforeAll(async () => {
  realFetch = globalThis.fetch.bind(globalThis)
  server = serve({ fetch: app.fetch, port: 0 })
  const { port } = server.address() as { port: number }
  baseUrl = `http://localhost:${port}`
})

afterAll(() => {
  server.close()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function setEnv() {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('STT_') && !(k in ENV)) delete process.env[k]
  }
}

/** Mock only upstream provider calls; delegate localhost (the proxy) to real fetch. */
function mockUpstream(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.startsWith(baseUrl)) return realFetch(input as RequestInfo, init as RequestInit)
    return response
  })
}

function upstreamCall(calls: Array<[unknown, RequestInit | undefined]>): [string, RequestInit] {
  const upstream = calls.find(([url]) => {
    const u = typeof url === 'string' ? url : (url as Request).url
    return u.includes('/audio/transcriptions')
  })
  if (!upstream) throw new Error('upstream /audio/transcriptions call not captured')
  return [upstream[0] as string, upstream[1] as RequestInit]
}

describe('T2 — real /stt through proxy', () => {
  it('returns the real transcription from the upstream provider', async () => {
    setEnv()
    const fetchSpy = mockUpstream(
      new Response(JSON.stringify({ text: 'こんにちは' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 0]), 16000)
    const res = await fetch(`${baseUrl}/stt`, { method: 'POST', body: wav })

    expect(res.ok).toBe(true)
    const json = (await res.json()) as { text: string }
    expect(json.text).toBe('こんにちは')

    // upstream was called with Bearer auth + the WAV base64 payload
    const [url, init] = upstreamCall(fetchSpy.mock.calls as Array<[unknown, RequestInit | undefined]>)
    expect(url).toBe(`${ENV.STT_OPENROUTER_BASE_URL}/audio/transcriptions`)
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${ENV.STT_OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    })
    const sentBody = JSON.parse(String(init.body)) as {
      model: string
      input_audio: { format: string; data: string }
    }
    expect(sentBody.model).toBe(ENV.STT_OPENROUTER_MODEL)
    expect(sentBody.input_audio.format).toBe('wav')
    expect(sentBody.input_audio.data.length).toBeGreaterThan(0)
  })

  it('never leaks the env API key in the response body or headers', async () => {
    setEnv()
    mockUpstream(new Response(JSON.stringify({ text: 'transcribed text' }), { status: 200 }))

    const wav = encodeWav(new Float32Array(32), 16000)
    const res = await fetch(`${baseUrl}/stt`, { method: 'POST', body: wav })
    const bodyText = await res.text()

    expect(bodyText).not.toContain(ENV.STT_OPENROUTER_API_KEY)
    for (const [h, v] of res.headers.entries()) {
      expect(h).not.toContain(ENV.STT_OPENROUTER_API_KEY)
      expect(v).not.toContain(ENV.STT_OPENROUTER_API_KEY)
    }
  })

  it('returns 500 with a clear error when STT env is not configured', async () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('STT_')) delete process.env[k]
    }
    const res = await fetch(`${baseUrl}/stt`, { method: 'POST', body: new ArrayBuffer(44) })
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/STT_ACTIVE/)
  })
})
