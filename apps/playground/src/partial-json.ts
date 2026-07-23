import type { ReplyCandidate, ReplySegment, ReplySegmentRole } from '@kibotalk/conversation'

/**
 * Extract complete top-level JSON objects from a (possibly incomplete) JSON
 * array stream. Used to render reply candidates incrementally as LLM tokens
 * arrive, before the full array has been emitted.
 *
 * Tracks string/escape context and brace depth so braces inside string values
 * don't fool the scanner. Returns the parsed objects found so far.
 */
export function extractCompleteObjects(buffer: string): unknown[] {
  const objects: string[] = []
  let depth = 0
  let inString = false
  let escape = false
  let start = -1

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        objects.push(buffer.slice(start, i + 1))
        start = -1
      }
    }
  }

  const parsed: unknown[] = []
  for (const obj of objects) {
    try {
      parsed.push(JSON.parse(obj))
    } catch {
      // incomplete object — skip
    }
  }
  return parsed
}

const SEGMENT_ROLES: ReadonlySet<string> = new Set(['content', 'particle', 'punct'])

function parseSegments(value: unknown): ReplySegment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const segments: ReplySegment[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    if (typeof o.surface !== 'string' || o.surface.length === 0) continue
    if (typeof o.role !== 'string' || !SEGMENT_ROLES.has(o.role)) continue
    const segment: ReplySegment = {
      surface: o.surface,
      role: o.role as ReplySegmentRole,
    }
    if (typeof o.reading === 'string' && o.reading.length > 0) {
      segment.reading = o.reading
    }
    segments.push(segment)
  }
  return segments.length > 0 ? segments : undefined
}

/** Coerce extracted objects into ReplyCandidate shape, filling missing ids. */
export function extractCandidates(buffer: string): ReplyCandidate[] {
  return extractCompleteObjects(buffer)
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    .map((o, i) => {
      const candidate: ReplyCandidate = {
        id: typeof o.id === 'string' ? o.id : `c${i}`,
        meaningZh: typeof o.meaningZh === 'string' ? o.meaningZh : '',
        targetText: typeof o.targetText === 'string' ? o.targetText : '',
      }
      if (typeof o.reading === 'string' && o.reading.length > 0) {
        candidate.reading = o.reading
      }
      const segments = parseSegments(o.segments)
      if (segments) candidate.segments = segments
      return candidate
    })
}
