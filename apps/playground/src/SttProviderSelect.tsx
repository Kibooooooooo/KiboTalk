import { useEffect, useState } from 'react'

export type SttProvider = { id: string; label: string; model: string; active: boolean }

/**
 * Fetch the configured STT providers from the proxy once on mount. Returns an
 * empty list if the proxy is unreachable or nothing is configured. Keys never
 * arrive — only ids/labels/models.
 */
export function useSttProviders(): SttProvider[] {
  const [providers, setProviders] = useState<SttProvider[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/stt/providers')
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d: { providers?: SttProvider[] }) => {
        if (!cancelled) setProviders(d.providers ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return providers
}

/** Build the /stt proxy URL for a provider id (null/empty → active provider). */
export function sttUrl(provider: string | null): string {
  return provider ? `/stt?provider=${encodeURIComponent(provider)}` : '/stt'
}

/** Pick the default provider: the active one, else the first available. */
export function defaultSttProvider(providers: SttProvider[]): string | null {
  return providers.find((p) => p.active)?.id ?? providers[0]?.id ?? null
}

type SttProviderSelectProps = {
  providers: SttProvider[]
  value: string | null
  onChange: (provider: string | null) => void
  /** Include an "off" option (default true). Set false for panels that always transcribe. */
  allowOff?: boolean
  offLabel?: string
  disabled?: boolean
  id?: string
}

/** Shared STT provider selector. Used by the VAD panel and the direct-API panel. */
export function SttProviderSelect({
  providers,
  value,
  onChange,
  allowOff = true,
  offLabel = '关闭',
  disabled,
  id,
}: SttProviderSelectProps) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || providers.length === 0}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
      >
        {allowOff && <option value="">{offLabel}</option>}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}（{p.model}）{p.active ? ' · 默认' : ''}
          </option>
        ))}
      </select>
      {providers.length === 0 && (
        <span className="text-xs text-muted-foreground">（服务端未配置任何 STT provider）</span>
      )}
    </span>
  )
}
