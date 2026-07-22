import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { createSttClient, sttConfigFromEnv } from '@kibotalk/stt'
import { createLlmClient, llmConfigFromEnv } from '@kibotalk/llm'
import { renderReplySuggestionsPrompt } from '@kibotalk/prompts'
import type { ConversationTurn } from '@kibotalk/conversation'

export const app = new Hono()

// POST /stt — receive a WAV (16kHz mono), forward to the active STT provider,
// return { text }. The provider/key come from env (STT_ACTIVE + STT_<PROVIDER>_*);
// the key never leaves this process. Client abort aborts the upstream request.
app.post('/stt', async (c) => {
  const wav = await c.req.arrayBuffer()
  let sttClient
  try {
    sttClient = createSttClient(sttConfigFromEnv(process.env))
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

// POST /llm — SSE. Body: { context, level, scene }. Render the reply-suggestions
// prompt, stream raw LLM tokens to the browser as `token` SSE events. On client
// disconnect, c.req.raw.signal aborts, which we forward to the upstream provider
// fetch so it stops generating. Half-streamed candidates are dropped by the
// client (per spec §1.4 "以 STT 为准").
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
