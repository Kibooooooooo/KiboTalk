import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { serve } from '@hono/node-server'
import { app } from '../src/app'

const ENV = {
  LLM_ACTIVE: 'openrouter',
  LLM_OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
  LLM_OPENROUTER_API_KEY: 'sk-llm-secret-do-not-leak',
  LLM_OPENROUTER_MODEL: 'deepseek/deepseek-chat',
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
    if (k.startsWith('LLM_') && !(k in ENV)) delete process.env[k]
  }
}

/** Build an SSE response body that emits the given delta-content tokens, then [DONE]. */
function sseBody(tokens: string[]): string {
  return (
    tokens
      .map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  )
}

/** Parse an SSE response stream into {event, data} pairs. */
async function readSse(res: Response): Promise<Array<{ event: string; data: string }>> {
  const messages: Array<{ event: string; data: string }> = []
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) {
        continue
      }
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        messages.push({ event, data: line.slice(5).trim() })
        event = 'message'
      }
    }
  }
  return messages
}

/** xsai calls fetch with a URL object; normalize to a string. */
function toUrl(input: unknown): string {
  if (input instanceof URL) return input.toString()
  return typeof input === 'string' ? input : (input as Request).url
}

/** Mock only upstream provider calls; delegate localhost (the proxy) to real fetch. */
function mockUpstream(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = toUrl(input)
    if (url.startsWith(baseUrl)) return realFetch(input as RequestInfo, init as RequestInit)
    return response
  })
}

function upstreamCall(calls: Array<[unknown, RequestInit | undefined]>): [string, RequestInit] {
  const upstream = calls.find(([url]) => toUrl(url).includes('/chat/completions'))
  if (!upstream) throw new Error('upstream /chat/completions call not captured')
  return [toUrl(upstream[0]), upstream[1] as RequestInit]
}

describe('T3 — real /llm SSE through proxy', () => {
  it('streams token SSE events from the upstream provider', async () => {
    setEnv()
    const fetchSpy = mockUpstream(
      new Response(sseBody(['[', '{"meaningZh":"hi"}', ']']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    const res = await fetch(`${baseUrl}/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: [
          { id: 't0', speaker: 'other', text: 'こんにちは', startedAt: 0, endedAt: 1 },
        ],
        level: 'N5',
        scene: '便利店',
      }),
    })

    expect(res.ok).toBe(true)
    const messages = await readSse(res)
    const tokenEvents = messages.filter((m) => m.event === 'token')
    expect(tokenEvents.map((m) => m.data)).toEqual(['[', '{"meaningZh":"hi"}', ']'])

    const [url, init] = upstreamCall(fetchSpy.mock.calls as Array<[unknown, RequestInit | undefined]>)
    expect(url).toBe(`${ENV.LLM_OPENROUTER_BASE_URL}/chat/completions`)
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${ENV.LLM_OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    })
    const sent = JSON.parse(String(init.body)) as {
      model: string
      stream: boolean
      messages: Array<{ role: string; content: string }>
    }
    expect(sent.model).toBe(ENV.LLM_OPENROUTER_MODEL)
    expect(sent.stream).toBe(true)
    expect(sent.messages[0].content).toContain('便利店')
    expect(sent.messages[0].content).toContain('N5')
  })

  it('never leaks the env API key in the SSE response body or headers', async () => {
    setEnv()
    mockUpstream(new Response(sseBody(['x', 'y']), { status: 200 }))

    const res = await fetch(`${baseUrl}/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: [], level: 'N5', scene: '通用' }),
    })
    const bodyText = await res.text()

    expect(bodyText).not.toContain(ENV.LLM_OPENROUTER_API_KEY)
    for (const [h, v] of res.headers.entries()) {
      expect(h).not.toContain(ENV.LLM_OPENROUTER_API_KEY)
      expect(v).not.toContain(ENV.LLM_OPENROUTER_API_KEY)
    }
  })

  it('forwards the client abort signal to the upstream provider fetch', async () => {
    setEnv()
    let capturedSignal: AbortSignal | undefined
    let releaseUpstream: () => void
    const upstreamDone = new Promise<void>((resolve) => {
      releaseUpstream = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = toUrl(input)
      if (url.startsWith(baseUrl)) return realFetch(input as RequestInfo, init as RequestInit)
      capturedSignal = init?.signal ?? undefined
      const upstreamStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          await upstreamDone
          controller.close()
        },
      })
      return new Response(upstreamStream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const controller = new AbortController()
    const request = fetch(`${baseUrl}/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: [], level: 'N5', scene: '通用' }),
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(capturedSignal).toBeDefined(), { timeout: 2000 })
    controller.abort()
    await request.catch(() => {})

    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true), { timeout: 2000 })
    releaseUpstream!()
  })

  it('emits an error SSE event when LLM env is not configured', async () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('LLM_')) delete process.env[k]
    }
    const res = await fetch(`${baseUrl}/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: [], level: 'N5', scene: '通用' }),
    })
    const messages = await readSse(res)
    const errorEvent = messages.find((m) => m.event === 'error')
    expect(errorEvent?.data).toMatch(/LLM_ACTIVE/)
  })
})
