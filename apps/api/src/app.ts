import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'

export const app = new Hono()

// Stub /stt — returns a placeholder transcription. Real STT (OpenRouter) lands in T2.
app.post('/stt', async (c) => {
  return c.json({ text: '[stub transcription]' })
})

// Stub /llm — returns a placeholder response. Real SSE streaming lands in T3.
app.post('/llm', async (c) => {
  return c.json({
    candidates: [
      { meaningZh: '[stub]', targetText: '[stub]', reading: '[stub]' },
    ],
  })
})

// Serve apps/web's built static assets at / (same origin, no CORS).
// Root is relative to cwd (apps/api); apps/web/dist is a sibling.
app.use('/*', serveStatic({ root: '../web/dist' }))

export default app
