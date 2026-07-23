import type { ConversationTurn } from '@kibotalk/conversation'

import type { ParsedReplyCandidate } from './schema'

export type JudgeVerdict = {
  score: number
  dimensions: {
    level_fit: number
    naturalness: number
    diversity: number
    usefulness: number
    furigana_quality: number
    particle_quality: number
    schema_faithfulness: number
  }
  reason: string
  annotationNotes?: string
}

export const JUDGE_SYSTEM = `You are a strict evaluator for a Japanese "live reply coach".
The coach suggests exactly 3 next utterances for a language learner, often with furigana segments.

Score overall quality on 0.0–1.0 and EACH dimension on 0.0–1.0:
- level_fit: vocabulary/grammar match the stated JLPT level
- naturalness: spoken Japanese a native would say in this context
- diversity: three meaningfully different strategies/intents
- usefulness: helps the learner continue appropriately (esp. after the last "Other" turn)
- furigana_quality: CRITICAL — segment.reading must appear ONLY on surfaces that contain 漢字.
  Penalize heavily if hiragana/katakana-only surfaces (こんにちは, です, します, ありがとう…) carry a reading,
  or if reading === surface, or if kanji lacks needed furigana when segments are present.
  Top-level "reading" is whole-phrase kana fallback; do not confuse it with per-segment ruby.
- particle_quality: CRITICAL — 助詞 (は/が/を/に/で/と/も/へ/から/まで/より/の/や/か/ね/よ…) should be
  separate segments with role "particle", not merged into content; punct → role "punct".
- schema_faithfulness: JSON shape / surfaces concat to targetText / Chinese meaningZh OK

Return STRICT JSON only:
{"score":0.0,"dimensions":{"level_fit":0.0,"naturalness":0.0,"diversity":0.0,"usefulness":0.0,"furigana_quality":0.0,"particle_quality":0.0,"schema_faithfulness":0.0},"reason":"short 中文 or English","annotationNotes":"list concrete bad ruby/particle examples if any"}

Weight furigana_quality and particle_quality strongly in the overall score when segments exist.
If suggestions have no segments, set furigana_quality and particle_quality to 0.5 (N/A mid) and judge content only.
Use deterministic annotationIssues in the user payload as hints, but verify against suggestions yourself.`

export function buildJudgeUserPayload(args: {
  rubric: string
  level: string
  context: Array<Pick<ConversationTurn, 'speaker' | 'text' | 'sttFailed'>>
  suggestions: ParsedReplyCandidate[]
  schemaErrors: string[]
  annotationIssues: string[]
  kanaOverRubyRate: number
  particleMissRate: number
  promptVariant: string
}): string {
  return JSON.stringify({
    rubric: args.rubric,
    promptVariant: args.promptVariant,
    level: args.level,
    conversation: args.context.map(t => ({
      speaker: t.speaker,
      text: t.sttFailed ? '(untranscribed)' : t.text,
    })),
    suggestions: args.suggestions,
    schemaErrors: args.schemaErrors,
    deterministicAnnotationIssues: args.annotationIssues,
    deterministicRates: {
      kanaOverRubyRate: args.kanaOverRubyRate,
      particleMissRate: args.particleMissRate,
    },
    focus: [
      'Reject kana-on-kana furigana (reading on kana-only surface).',
      'Check 助詞 isolation and role=particle.',
      'Check kanji segments have correct kana readings when present.',
    ],
  }, null, 2)
}

export function normalizeJudgeVerdict(value: unknown): JudgeVerdict {
  if (typeof value !== 'object' || value === null) {
    throw new Error('judge verdict is not an object')
  }
  const record = value as Record<string, unknown>
  const score = clamp01(Number(record.score))
  const dims = (record.dimensions ?? {}) as Record<string, unknown>
  return {
    score,
    dimensions: {
      level_fit: clamp01(Number(dims.level_fit ?? score)),
      naturalness: clamp01(Number(dims.naturalness ?? score)),
      diversity: clamp01(Number(dims.diversity ?? score)),
      usefulness: clamp01(Number(dims.usefulness ?? score)),
      furigana_quality: clamp01(Number(dims.furigana_quality ?? score)),
      particle_quality: clamp01(Number(dims.particle_quality ?? score)),
      schema_faithfulness: clamp01(Number(dims.schema_faithfulness ?? score)),
    },
    reason: typeof record.reason === 'string' ? record.reason : '',
    annotationNotes: typeof record.annotationNotes === 'string'
      ? record.annotationNotes
      : undefined,
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
