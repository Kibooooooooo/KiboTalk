/** Hiragana, katakana, prolonged sound mark, and common small kana. */
const KANA_CHAR = /[\u3040-\u309F\u30A0-\u30FF\u30FC]/
const KANJI_CHAR = /[\u4E00-\u9FFF\u3400-\u4DBF]/

/** True when surface contains at least one kanji (furigana may be needed). */
export function surfaceHasKanji(surface: string): boolean {
  return KANJI_CHAR.test(surface)
}

/** True when surface is only kana / punctuation / spaces (must NOT carry furigana). */
export function surfaceIsKanaOnly(surface: string): boolean {
  const stripped = surface.replace(/[\s\u3000]/g, '')
  if (stripped.length === 0) return true
  // No kanji, and every remaining char is kana or Japanese punct/latin digits.
  if (KANJI_CHAR.test(stripped)) return false
  return [...stripped].every(
    ch => KANA_CHAR.test(ch) || /[。！？、…・「」『』（）().,!?\-—]/.test(ch) || /[0-9a-zA-Z]/.test(ch),
  )
}

const COMMON_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'へ', 'から', 'まで', 'より', 'の', 'や', 'か',
  'ね', 'よ', 'な', 'わ', 'さ', 'ぞ', 'ぜ', 'かな', 'けど', 'けれど', 'けれども',
  'など', 'なんて', 'とか', 'ばかり', 'だけ', 'しか', 'こそ', 'さえ', 'でも', 'すら',
])

export function looksLikeParticle(surface: string): boolean {
  return COMMON_PARTICLES.has(surface)
}

export type ParsedReplyCandidate = {
  meaningZh: string
  targetText: string
  reading?: string
  segments?: Array<{
    surface: string
    reading?: string
    role: string
  }>
}

export type SchemaValidation = {
  ok: boolean
  score: number
  errors: string[]
  /** Deterministic annotation nits for judge / metrics (not always hard-fail). */
  annotationIssues: string[]
  candidates: ParsedReplyCandidate[]
  /** Share of segment readings that wrongly annotate kana-only surfaces. */
  kanaOverRubyRate: number
  /** Share of obvious particles missing role "particle" (when segments exist). */
  particleMissRate: number
}

const ROLES = new Set(['content', 'particle', 'punct'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ValidateReplyOptions = {
  requiresSegments: boolean
  /** When false, top-level `reading` may be omitted (segment-only ruby). */
  requiresPhraseReading: boolean
  /** Hard-fail when a kana-only segment.surface has a reading. Default true if segments required. */
  forbidKanaReading?: boolean
}

/**
 * Validate reply-coach JSON + furigana/particle hygiene.
 */
export function validateReplyCandidates(
  value: unknown,
  options: ValidateReplyOptions,
): SchemaValidation {
  const forbidKanaReading = options.forbidKanaReading ?? options.requiresSegments
  const errors: string[] = []
  const annotationIssues: string[] = []
  let kanaOverRubyCount = 0
  let kanaReadingSlots = 0
  let particleMissCount = 0
  let particleSlots = 0

  if (!Array.isArray(value)) {
    return {
      ok: false,
      score: 0,
      errors: ['root is not an array'],
      annotationIssues: [],
      candidates: [],
      kanaOverRubyRate: 0,
      particleMissRate: 0,
    }
  }
  if (value.length !== 3) {
    errors.push(`expected exactly 3 items, got ${value.length}`)
  }

  const candidates: ParsedReplyCandidate[] = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (!isRecord(item)) {
      errors.push(`[${i}] not an object`)
      continue
    }
    const meaningZh = item.meaningZh
    const targetText = item.targetText
    const reading = item.reading
    if (typeof meaningZh !== 'string' || meaningZh.trim() === '') {
      errors.push(`[${i}].meaningZh missing/empty`)
    }
    if (typeof targetText !== 'string' || targetText.trim() === '') {
      errors.push(`[${i}].targetText missing/empty`)
    }
    if (options.requiresPhraseReading) {
      if (typeof reading !== 'string' || reading.trim() === '') {
        errors.push(`[${i}].reading missing/empty`)
      }
    }
    else if (typeof reading === 'string' && reading.length > 0) {
      // Phrase-level reading is obsolete when the variant forbids it.
      errors.push(`[${i}].reading forbidden (use segment.reading on kanji only)`)
    }

    let segments: ParsedReplyCandidate['segments']
    if (item.segments !== undefined) {
      if (!Array.isArray(item.segments)) {
        errors.push(`[${i}].segments not an array`)
      }
      else {
        segments = []
        for (let j = 0; j < item.segments.length; j++) {
          const seg = item.segments[j]
          if (!isRecord(seg) || typeof seg.surface !== 'string') {
            errors.push(`[${i}].segments[${j}] invalid`)
            continue
          }
          if (typeof seg.role !== 'string' || !ROLES.has(seg.role)) {
            errors.push(`[${i}].segments[${j}].role invalid`)
          }
          if (seg.reading !== undefined && typeof seg.reading !== 'string') {
            errors.push(`[${i}].segments[${j}].reading not string`)
          }

          const surface = seg.surface
          const segReading = typeof seg.reading === 'string' ? seg.reading : undefined
          const role = String(seg.role ?? '')

          if (segReading !== undefined && segReading.length > 0) {
            if (surfaceIsKanaOnly(surface) || !surfaceHasKanji(surface)) {
              kanaReadingSlots += 1
              kanaOverRubyCount += 1
              const msg = `[${i}].segments[${j}] kana/non-kanji surface "${surface}" must not have reading "${segReading}"`
              if (forbidKanaReading) errors.push(msg)
              else annotationIssues.push(msg)
            }
            else if (segReading === surface) {
              annotationIssues.push(`[${i}].segments[${j}] reading equals surface (useless ruby)`)
            }
          }

          if (looksLikeParticle(surface)) {
            particleSlots += 1
            if (role !== 'particle') {
              particleMissCount += 1
              annotationIssues.push(`[${i}].segments[${j}] "${surface}" looks like 助詞 but role=${role || 'missing'}`)
            }
          }
          else if (role === 'particle' && surface.length > 0 && !looksLikeParticle(surface) && surfaceHasKanji(surface)) {
            annotationIssues.push(`[${i}].segments[${j}] role=particle but surface "${surface}" is unlikely 助詞`)
          }

          segments.push({ surface, reading: segReading, role })
        }
        if (
          typeof targetText === 'string'
          && segments.length > 0
          && segments.map(s => s.surface).join('') !== targetText
        ) {
          errors.push(`[${i}].segments surfaces do not concat to targetText`)
        }
      }
    }
    else if (options.requiresSegments) {
      errors.push(`[${i}].segments required but missing`)
    }

    candidates.push({
      meaningZh: typeof meaningZh === 'string' ? meaningZh : '',
      targetText: typeof targetText === 'string' ? targetText : '',
      reading: typeof reading === 'string' ? reading : undefined,
      segments,
    })
  }

  const ok = errors.length === 0 && candidates.length === 3
  const fieldsPerItem = (options.requiresSegments ? 3 : 2)
    + (options.requiresPhraseReading ? 1 : 0)
  const hardChecks = 1 + Math.max(value.length, 0) * fieldsPerItem
  const failed = Math.min(errors.length, hardChecks)
  const score = ok ? 1 : Math.max(0, (hardChecks - failed) / hardChecks)

  return {
    ok,
    score,
    errors,
    annotationIssues,
    candidates,
    kanaOverRubyRate: kanaReadingSlots === 0 ? 0 : kanaOverRubyCount / kanaReadingSlots,
    particleMissRate: particleSlots === 0 ? 0 : particleMissCount / particleSlots,
  }
}
