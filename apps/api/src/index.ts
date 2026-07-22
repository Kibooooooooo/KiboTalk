import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './app'

// Load repo-root .env (apps/api/src → ../../ = repo root) so `pnpm dev:api`
// picks up STT_* / LLM_* without manually exporting shell vars. Tests import
// `app` directly and set process.env themselves, so this never runs in tests.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${info.port}`)
})
