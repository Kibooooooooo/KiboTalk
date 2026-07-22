/**
 * Provider-agnostic LLM client.
 *
 * The factory selects a streaming adapter by `provider` name. Each adapter
 * implements the same `LlmClient` interface and turns a provider-specific SSE
 * format into a flat `AsyncIterable<string>` of raw token strings. Adding a
 * provider = adding an adapter + an env group, with no interface changes.
 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmClientOptions = {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface LlmClient {
  streamChat(args: { messages: ChatMessage[]; signal?: AbortSignal }): AsyncIterable<string>
}

export type LlmAdapterFactory = (opts: LlmClientOptions) => LlmClient

const adapters: Record<string, LlmAdapterFactory> = {
  openrouter: createOpenRouterClient,
}

/**
 * Create a streaming LLM client for the given provider. Throws a clear error
 * for unregistered providers so callers don't get a silent wrong-adapter call.
 */
export function createLlmClient(opts: LlmClientOptions): LlmClient {
  const factory = adapters[opts.provider]
  if (!factory) {
    throw new Error(
      `unknown provider: ${opts.provider}. registered: ${Object.keys(adapters).join(', ')}`,
    )
  }
  return factory(opts)
}

/**
 * OpenRouter streaming adapter.
 *
 * POSTs to `${baseUrl}/chat/completions` with Bearer auth, `stream: true`, and
 * parses the OpenAI-compatible SSE response: `data: {json}\n\n` lines
 * terminated by `data: [DONE]`. Yields `choices[0].delta.content` strings,
 * skipping empty/undefined deltas. The fetch `signal` is forwarded so aborting
 * the AbortSignal aborts the upstream request.
 */
function createOpenRouterClient({ baseUrl, apiKey, model }: LlmClientOptions): LlmClient {
  return {
    async *streamChat({ messages, signal }) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} ${text}`)
      }
      const body = response.body
      if (!body) throw new Error('OpenRouter response has no body')

      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newlineIndex: number
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const rawLine = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const line = rawLine.trim()
            if (!line) continue
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') return
            if (!data) continue
            try {
              const json = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>
              }
              const delta = json?.choices?.[0]?.delta?.content
              if (typeof delta === 'string' && delta.length > 0) yield delta
            } catch {
              // Skip malformed/non-JSON chunks; SSE may carry comments or pings.
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

/**
 * Read `LLM_ACTIVE` + the active `LLM_<PROVIDER>_*` group from an env map and
 * return the factory args. Pure: takes env as an argument, does not touch
 * `process.env`, so it is testable without node.
 */
export function llmConfigFromEnv(env: Record<string, string | undefined>): LlmClientOptions {
  const active = env.LLM_ACTIVE
  if (!active) throw new Error('LLM_ACTIVE is not set')
  const groupPrefix = `LLM_${active.toUpperCase()}_`
  const baseUrl = env[`${groupPrefix}BASE_URL`]
  const apiKey = env[`${groupPrefix}API_KEY`]
  const model = env[`${groupPrefix}MODEL`]
  const missing: string[] = []
  if (!baseUrl) missing.push(`${groupPrefix}BASE_URL`)
  if (!apiKey) missing.push(`${groupPrefix}API_KEY`)
  if (!model) missing.push(`${groupPrefix}MODEL`)
  if (missing.length > 0) {
    throw new Error(
      `missing env vars for provider "${active}": ${missing.join(', ')}`,
    )
  }
  return { provider: active, baseUrl: baseUrl!, apiKey: apiKey!, model: model! }
}
