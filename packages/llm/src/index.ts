import { streamText } from '@xsai/stream-text'

/**
 * Provider-agnostic LLM client backed by xsai.
 *
 * xsai is an OpenAI-compatible streaming runtime: it owns the fetch, the SSE
 * parsing, and abort forwarding. Each provider adapter only contributes the
 * provider-specific bits (base URL, extra headers); adding a provider = adding
 * an adapter + an env group, with no interface changes.
 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmThinkingMode = 'enabled' | 'disabled'

export type LlmClientOptions = {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** DeepSeek V4 defaults to thinking on; live coach wants this off for TTFT. */
  thinking: LlmThinkingMode
}

export interface LlmClient {
  streamChat(args: { messages: ChatMessage[]; signal?: AbortSignal }): AsyncIterable<string>
}

export type LlmAdapterFactory = (opts: LlmClientOptions) => LlmClient

/**
 * xsai streaming adapter. OpenRouter (and any OpenAI-compatible endpoint) works
 * with just a base URL + Bearer key; xsai handles `stream: true`, the SSE
 * `data:` parse, `[DONE]` termination, and forwarding `abortSignal` to fetch.
 * Empty deltas are skipped so downstream consumers only see real tokens.
 */
function createXsaiClient({ baseUrl, apiKey, model, thinking }: LlmClientOptions): LlmClient {
  return {
    async *streamChat({ messages, signal }) {
      const { textStream } = streamText({
        apiKey,
        baseURL: baseUrl,
        model,
        messages,
        abortSignal: signal,
        // DeepSeek OpenAI-compatible extension; ignored by providers that don't use it.
        thinking: { type: thinking },
      })
      const reader = textStream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

const adapters: Record<string, LlmAdapterFactory> = {
  openrouter: createXsaiClient,
  openai: createXsaiClient, // LM Studio / any OpenAI-compatible /v1
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
 * Read `LLM_ACTIVE` + the active `LLM_<PROVIDER>_*` group from an env map and
 * return the factory args. Pure: takes env as an argument, does not touch
 * `process.env`, so it is testable without node.
 *
 * `LLM_THINKING=enabled` turns on provider thinking/CoT (DeepSeek V4 default).
 * Anything else (including unset) → disabled, for live-coach TTFT.
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
  const thinking: LlmThinkingMode = env.LLM_THINKING === 'enabled' ? 'enabled' : 'disabled'
  return { provider: active, baseUrl: baseUrl!, apiKey: apiKey!, model: model!, thinking }
}
