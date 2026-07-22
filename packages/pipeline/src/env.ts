/**
 * Read a numeric env var in a way that works in both Node (tests, playground
 * server) and the browser (where `process` is undefined and config is normally
 * injected via `PipelineDeps.config`). Falls back to `fallback` when the var is
 * absent or non-numeric.
 */
export function envNumber(name: string, fallback: number): number {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const raw = g.process?.env?.[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
