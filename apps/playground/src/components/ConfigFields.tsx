import { Input, Label } from '@kibotalk/ui'
import { useConfig } from '../config-store'
import { SILERO_VARIANTS } from '../audio/silero-vad'
import { SttProviderSelect } from '../SttProviderSelect'
import { useTranscribeProvider } from '../SttProviderSelect'
import type { TranscribeMode } from '../config-store'

/** Shared numeric field. Reads/writes nothing itself — fully controlled. */
export function NumberField({
  label,
  value,
  step,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="h-8"
      />
    </div>
  )
}

/** VAD cut stage: thresholds, silence, min speech. */
export function VadParamsFields() {
  const speechThreshold = useConfig((s) => s.speechThreshold)
  const exitThreshold = useConfig((s) => s.exitThreshold)
  const minSilenceDurationMs = useConfig((s) => s.minSilenceDurationMs)
  const minSpeechDurationMs = useConfig((s) => s.minSpeechDurationMs)
  const patch = useConfig((s) => s.patch)
  return (
    <>
      <NumberField label="进入阈值（0.5）" value={speechThreshold} step={0.01} min={0} max={1}
        onChange={(v) => patch({ speechThreshold: v })} />
      <NumberField label="退出阈值（0.3）" value={exitThreshold} step={0.01} min={0} max={1}
        onChange={(v) => patch({ exitThreshold: v })} />
      <NumberField label="静音结束 ms（400）" value={minSilenceDurationMs} step={50} min={0}
        onChange={(v) => patch({ minSilenceDurationMs: v })} />
      <NumberField label="最短语音 ms（250）" value={minSpeechDurationMs} step={50} min={0}
        onChange={(v) => patch({ minSpeechDurationMs: v })} />
    </>
  )
}

/** ASR-send padding (applied at ASR send; VAD cuts stay tight). */
export function AsrPadFields() {
  const prePadMs = useConfig((s) => s.prePadMs)
  const postPadMs = useConfig((s) => s.postPadMs)
  const patch = useConfig((s) => s.patch)
  return (
    <>
      <NumberField label="前填充 ms（80）·ASR" value={prePadMs} step={10} min={0}
        onChange={(v) => patch({ prePadMs: v })} />
      <NumberField label="后填充 ms（80）·ASR" value={postPadMs} step={10} min={0}
        onChange={(v) => patch({ postPadMs: v })} />
    </>
  )
}

/** Merge / scheduling: per-speaker pause + max length. Only meaningful when
 *  transcribeMode is 'aggregated' (or merge enabled in the live session). */
export function MergeParamsFields({ disabled }: { disabled?: boolean }) {
  const otherPauseMs = useConfig((s) => s.otherPauseMs)
  const userPauseMs = useConfig((s) => s.userPauseMs)
  const mergeMaxMs = useConfig((s) => s.mergeMaxMs)
  const patch = useConfig((s) => s.patch)
  return (
    <>
      <NumberField label="对方暂停 ms（1000）·合并" value={otherPauseMs} step={100} min={0} disabled={disabled}
        onChange={(v) => patch({ otherPauseMs: v })} />
      <NumberField label="我方暂停 ms（1000）·合并" value={userPauseMs} step={100} min={0} disabled={disabled}
        onChange={(v) => patch({ userPauseMs: v })} />
      <NumberField label="合并上限 ms（30000）·合并" value={mergeMaxMs} step={1000} min={0} disabled={disabled}
        onChange={(v) => patch({ mergeMaxMs: v })} />
    </>
  )
}

/** VAD model selector (Silero v5 / v6.2). */
export function VadModelSelect({ disabled }: { disabled?: boolean }) {
  const vadVariantId = useConfig((s) => s.vadVariantId)
  const patch = useConfig((s) => s.patch)
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="font-medium">VAD 模型：</span>
      <select
        value={vadVariantId}
        onChange={(e) => patch({ vadVariantId: e.target.value })}
        disabled={disabled}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
      >
        {SILERO_VARIANTS.map((v) => (
          <option key={v.id} value={v.id}>{v.label}</option>
        ))}
      </select>
    </span>
  )
}

/** Transcribe mode: aggregate (merge) vs per-segment. */
export function TranscribeModeSelect({ disabled }: { disabled?: boolean }) {
  const transcribeMode = useConfig((s) => s.transcribeMode)
  const patch = useConfig((s) => s.patch)
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="font-medium">转写模式：</span>
      <select
        value={transcribeMode}
        onChange={(e) => patch({ transcribeMode: e.target.value as TranscribeMode })}
        disabled={disabled}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
      >
        <option value="aggregated">聚合（合并多段，保留中间静音）</option>
        <option value="perSegment">逐段（每个 VAD 片段单独转写）</option>
      </select>
    </span>
  )
}

/** STT provider selector wired to the shared store (auto-bootstraps to active). */
export function TranscribeProviderSelect({ allowOff = true }: { allowOff?: boolean }) {
  const { providers, provider } = useTranscribeProvider()
  const patch = useConfig((s) => s.patch)
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="font-medium">自动转写：</span>
      <SttProviderSelect
        providers={providers}
        value={provider}
        onChange={(p) => patch({ transcribeProvider: p })}
        allowOff={allowOff}
      />
    </span>
  )
}
