import { create } from 'zustand'
import { defaultVadConfig } from '@kibotalk/audio/vad'
import { SILERO_VARIANTS } from './audio/silero-vad'
import type { SttProvider } from './SttProviderSelect'
import { defaultSttProvider } from './SttProviderSelect'

export type TranscribeMode = 'perSegment' | 'aggregated'

/**
 * Shared playground config — the React analog of a Pinia store. Consumed via
 * `useConfig(s => s.field)` so each component only re-renders on its own field.
 *
 * One store, two consumers (VAD panel + live session): change a knob on one
 * tab and it is already aligned on the other. Fields are grouped by pipeline
 * stage: VAD cut → ASR padding → merge/scheduling → selectors → speaker.
 */
type ConfigState = {
  // VAD cut stage
  speechThreshold: number
  exitThreshold: number
  minSilenceDurationMs: number
  minSpeechDurationMs: number
  // ASR-send padding (VAD cuts stay tight; padding applied at ASR send)
  prePadMs: number
  postPadMs: number
  // Merge / scheduling (segment aggregator flush triggers)
  otherPauseMs: number
  userPauseMs: number
  mergeMaxMs: number
  // Selectors
  vadVariantId: string
  transcribeProvider: string | null
  transcribeMode: TranscribeMode
  // Speaker verification (live session only, but shared for consistency)
  speakerThreshold: number
  // Bootstrap guard so the provider defaults to the active one once, then the
  // user can freely switch (including to "off" / null) without re-defaulting.
  providerBootstrapped: boolean
  // Actions
  patch: (partial: Partial<ConfigState>) => void
  reset: () => void
  bootstrapProvider: (providers: SttProvider[]) => void
}

const defaults = {
  speechThreshold: defaultVadConfig.speechThreshold,
  exitThreshold: defaultVadConfig.exitThreshold,
  minSilenceDurationMs: defaultVadConfig.minSilenceDurationMs,
  minSpeechDurationMs: defaultVadConfig.minSpeechDurationMs,
  prePadMs: 80,
  postPadMs: 80,
  otherPauseMs: 1000,
  userPauseMs: 1000,
  mergeMaxMs: 30000,
  vadVariantId: SILERO_VARIANTS[0].id,
  transcribeProvider: null as string | null,
  transcribeMode: 'aggregated' as TranscribeMode,
  speakerThreshold: 0.8,
  providerBootstrapped: false,
}

export const useConfig = create<ConfigState>((set) => ({
  ...defaults,
  patch: (partial) => set(partial),
  reset: () => set({ ...defaults, providerBootstrapped: true }),
  bootstrapProvider: (providers) =>
    set((s) =>
      s.providerBootstrapped
        ? s
        : { transcribeProvider: defaultSttProvider(providers), providerBootstrapped: true },
    ),
}))
