import { generateText } from '@xsai/generate-text'
import {
  createOpenAIProviderAdapter,
  normalizeOpenAITextOutput,
} from 'vieval/core/inference-executors'
import {
  emitChatModelErrorTelemetry,
  emitChatModelRequestTelemetry,
  emitChatModelResponseTelemetry,
  modelFromRun,
  openaiFromRunContext,
} from 'vieval/plugins/chat-models'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type EvalContext = Parameters<typeof emitChatModelRequestTelemetry>[0]
type ModelDef = ReturnType<typeof modelFromRun>

export type ChatCallResult = {
  text: string
  reasoningText?: string
  latencyMs: number
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
  raw: unknown
}

/**
 * OpenAI-compatible chat via xsai + vieval adapter/telemetry (BYOA pattern).
 * `thinking` maps to DeepSeek's extension; ignored by providers that lack it.
 */
export async function chatWithModel(
  context: EvalContext,
  modelDef: ModelDef,
  messages: ChatMessage[],
  options: { thinking: 'enabled' | 'disabled', label: string },
): Promise<ChatCallResult> {
  const runtime = openaiFromRunContext(modelDef)
  const adapter = createOpenAIProviderAdapter(runtime.apiKey, runtime.baseURL)
  const provider = { id: 'openai', model: runtime.model }

  emitChatModelRequestTelemetry(context, {
    data: {
      label: options.label,
      messagesCount: messages.length,
      thinking: options.thinking,
      roles: messages.map(m => m.role),
    },
    provider,
  })

  const startedAt = Date.now()
  try {
    const response = await adapter.runWithRetry(() =>
      generateText({
        ...adapter.provider.chat(runtime.model),
        messages,
        thinking: { type: options.thinking },
      }),
    )
    const latencyMs = Date.now() - startedAt
    emitChatModelResponseTelemetry(context, {
      latencyMs,
      provider,
      response,
    })

    const usage = (response as { usage?: ChatCallResult['usage'] }).usage
    return {
      text: normalizeOpenAITextOutput(response),
      reasoningText: (response as { reasoningText?: string }).reasoningText,
      latencyMs,
      usage,
      raw: response,
    }
  }
  catch (error) {
    emitChatModelErrorTelemetry(context, { error, provider })
    throw error
  }
}

/** Pull the first JSON array/object from model text (fences / prose OK). */
export function extractJsonValue(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()
  const startObj = body.indexOf('{')
  const startArr = body.indexOf('[')
  let start = -1
  if (startObj < 0) start = startArr
  else if (startArr < 0) start = startObj
  else start = Math.min(startObj, startArr)
  if (start < 0) throw new Error(`no JSON found in model output: ${body.slice(0, 200)}`)

  const candidate = body.slice(start)
  try {
    return JSON.parse(candidate)
  }
  catch {
    const open = candidate[0]
    const close = open === '[' ? ']' : '}'
    const end = candidate.lastIndexOf(close)
    if (end <= 0) throw new Error(`JSON parse failed: ${candidate.slice(0, 200)}`)
    return JSON.parse(candidate.slice(0, end + 1))
  }
}
