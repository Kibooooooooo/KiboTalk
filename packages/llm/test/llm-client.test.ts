import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLlmClient, llmConfigFromEnv } from '../src/index'

/**
 * Build a Response whose body is a ReadableStream emitting the given SSE
 * lines (each line is emitted followed by `\n`).
 */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

type FetchCall = {
  url: string
  init: RequestInit
}

/** xsai calls fetch with a URL object; normalize to a string for assertions. */
function toUrl(input: unknown): string {
  if (input instanceof URL) return input.toString()
  return String(input)
}

describe('createLlmClient — OpenRouter streaming adapter', () => {
  let fetchCalls: FetchCall[]
  let originalFetch: typeof fetch

  beforeEach(() => {
    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: toUrl(input), init: init ?? {} })
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":""}}]}',
        'data: {"choices":[{"delta":{}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: {"choices":[{"delta":{"content":"!"}}]}',
        'data: [DONE]',
      ])
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs to ${baseUrl}/chat/completions with Bearer auth, stream:true, and the given messages', async () => {
    const client = createLlmClient({
      provider: 'openrouter',
      baseUrl: 'https://example.test/api',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
    })
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: 'You are a coach.' },
      { role: 'user', content: 'Suggest replies.' },
    ]

    const tokens: string[] = []
    for await (const t of client.streamChat({ messages })) tokens.push(t)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('https://example.test/api/chat/completions')
    const headers = new Headers(fetchCalls[0].init.headers as HeadersInit)
    expect(headers.get('Authorization')).toBe('Bearer secret-key')
    expect(headers.get('Content-Type')).toBe('application/json')
    const body = JSON.parse(fetchCalls[0].init.body as string)
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      stream: true,
      messages,
    })
  })

  it('yields delta content tokens in order, skips empty deltas, stops at [DONE]', async () => {
    const client = createLlmClient({
      provider: 'openrouter',
      baseUrl: 'https://example.test',
      apiKey: 'k',
      model: 'm',
    })
    const tokens: string[] = []
    for await (const t of client.streamChat({ messages: [] })) tokens.push(t)
    expect(tokens).toEqual(['Hello', ' world', '!'])
  })

  it('forwards the AbortSignal to fetch', async () => {
    const client = createLlmClient({
      provider: 'openrouter',
      baseUrl: 'https://example.test',
      apiKey: 'k',
      model: 'm',
    })
    const controller = new AbortController()
    // Drain the stream so fetch is actually invoked.
    for await (const _ of client.streamChat({ messages: [], signal: controller.signal })) {
      // no-op
    }
    expect(fetchCalls[0].init.signal).toBe(controller.signal)
  })

  it('throws a clear "unknown provider" error for unregistered providers', () => {
    expect(() =>
      createLlmClient({
        provider: 'not-a-real-provider',
        baseUrl: 'https://example.test',
        apiKey: 'k',
        model: 'm',
      }),
    ).toThrowError(/unknown provider: not-a-real-provider/)
  })
})

describe('llmConfigFromEnv', () => {
  it('returns the active provider group when all vars are present', () => {
    const cfg = llmConfigFromEnv({
      LLM_ACTIVE: 'openrouter',
      LLM_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_OPENROUTER_API_KEY: 'key-123',
      LLM_OPENROUTER_MODEL: 'anthropic/claude-3.5',
      // unrelated group should be ignored
      LLM_OPENAI_BASE_URL: 'https://api.openai.com',
    })
    expect(cfg).toEqual({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'key-123',
      model: 'anthropic/claude-3.5',
    })
  })

  it('throws a clear error when LLM_ACTIVE is missing', () => {
    expect(() => llmConfigFromEnv({})).toThrowError(/LLM_ACTIVE is not set/)
  })

  it('throws a clear error when the active group is incomplete', () => {
    expect(() =>
      llmConfigFromEnv({
        LLM_ACTIVE: 'openrouter',
        LLM_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        // missing API_KEY and MODEL
      }),
    ).toThrowError(/missing env vars for provider "openrouter"/)
  })
})
