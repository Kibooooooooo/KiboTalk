import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import { app } from '../src/app'

let server: ReturnType<typeof serve>
let baseUrl: string

beforeAll(async () => {
  server = serve({ fetch: app.fetch, port: 0 })
  const { port } = server.address() as { port: number }
  baseUrl = `http://localhost:${port}`
})

afterAll(() => {
  server.close()
})

describe('T1 seam — stub /stt', () => {
  it('returns a stub transcription JSON', async () => {
    const res = await fetch(`${baseUrl}/stt`, { method: 'POST' })
    expect(res.ok).toBe(true)
    const json = (await res.json()) as { text: string }
    expect(json.text).toBe('[stub transcription]')
  })
})
