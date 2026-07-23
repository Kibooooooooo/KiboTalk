import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { createSttClient, sttConfigFromEnv, listSttProviders } from '@kibotalk/stt'
import { createLlmClient, llmConfigFromEnv } from '@kibotalk/llm'
import { renderReplySuggestionsPrompt } from '@kibotalk/prompts'
import type { ConversationTurn } from '@kibotalk/conversation'

export const app = new Hono()

// GET /stt/providers — list STT providers fully configured in server env (no
// keys), so the browser can offer a provider selector. Each entry carries
// `active` (matches STT_ACTIVE) so the client can default to it.
app.get('/stt/providers', (c) => {
  const providers = listSttProviders(process.env).filter((p) => p.configured)
  return c.json({ providers })
})

// POST /stt — receive a WAV (16kHz mono), forward to an STT provider, return
// { text }. Provider is STT_ACTIVE by default; an optional ?provider= query
// overrides per-request (must be a registered provider; its base URL / key /
// model still come from server env, so keys never leave this process). Client
// abort aborts the upstream request.
app.post('/stt', async (c) => {
  const wav = await c.req.arrayBuffer()
  const providerOverride = c.req.query('provider') || undefined
  let sttClient
  try {
    sttClient = createSttClient(sttConfigFromEnv(process.env, providerOverride))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
  try {
    const text = await sttClient.transcribe(wav, { signal: c.req.raw.signal })
    return c.json({ text })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

// POST /llm — SSE. Body: { context, level, scene }. Emit the rendered prompt
// first (`prompt` event), then stream raw LLM tokens as `token` events. On
// client disconnect, c.req.raw.signal aborts, which we forward to the upstream
// provider fetch so it stops generating. Half-streamed candidates are dropped
// by the client (per spec §1.4 "以 STT 为准").
app.post('/llm', (c) =>
  streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal
    const body = (await c.req.json().catch(() => null)) as {
      context?: ConversationTurn[]
      level?: string
      scene?: string
    } | null
    const prompt = await renderReplySuggestionsPrompt({
      context: body?.context ?? [],
      level: body?.level ?? 'N5',
      scene: body?.scene ?? '通用',
    })
    await stream.writeSSE({ event: 'prompt', data: prompt })
    let llmClient
    try {
      llmClient = createLlmClient(llmConfigFromEnv(process.env))
    } catch (e) {
      await stream.writeSSE({ event: 'error', data: (e as Error).message })
      return
    }
    try {
      const tokenStream = llmClient.streamChat({
        messages: [{ role: 'user', content: prompt }],
        signal,
      })
      for await (const token of tokenStream) {
        await stream.writeSSE({ event: 'token', data: token })
      }
    } catch {
      // upstream error or client abort — end the stream silently
    }
  }),
)

// Serve apps/web's built static assets at / (same origin, no CORS).
// Root is relative to cwd (apps/api); apps/web/dist is a sibling.
app.use('/*', serveStatic({ root: '../web/dist' }))

export default app
