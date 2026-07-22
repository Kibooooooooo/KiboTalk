import type { ConversationTurn } from '@kibotalk/conversation'

export type ReplySuggestionsPromptArgs = {
  context: ConversationTurn[]
  level: string
  scene: string
}

/**
 * Render the prompt for "give me 3 reply candidates for the next thing the user
 * could say".
 *
 * Returns a single user-message body (no separate system message): the
 * instructions, the conversation context, the learner's level, and the scene
 * are all inlined into one string. The LLM is told to reply with strict JSON
 * — an array of exactly 3 objects with keys `meaningZh`, `targetText`,
 * `reading` — and nothing else, so the browser can do incremental JSON parsing
 * as tokens stream in.
 *
 * Deviation from the ticket: Velin TSX is intentionally NOT introduced, to
 * keep `packages/prompts` dependency-free apart from the shared conversation
 * types. This is a pure TS template function returning a string.
 */
export function renderReplySuggestionsPrompt(args: ReplySuggestionsPromptArgs): string {
  const { context, level, scene } = args
  const contextBlock =
    context.length === 0
      ? '(no prior turns — this is the opening of the conversation)'
      : context
          .map((turn) => {
            const speaker = turn.speaker === 'user' ? 'Me (learner)' : 'Other (native speaker)'
            const text = turn.sttFailed ? '(untranscribed)' : turn.text
            return `${speaker}: ${text}`
          })
          .join('\n')

  return [
    'You are a live reply coach for a Japanese learner. Given the conversation so far,',
    'suggest exactly 3 things the learner could say next.',
    '',
    `Learner level: ${level}.`,
    `Scene: ${scene}.`,
    'Tailor vocabulary and grammar difficulty to the level and scene above.',
    '',
    'Conversation so far:',
    contextBlock,
    '',
    'For each of the 3 suggestions provide:',
    '- meaningZh: the learner\'s intent in 中文 (Chinese), one short phrase.',
    '- targetText: the Japanese reply the learner should say.',
    '- reading: furigana/kana or romaji reading of targetText.',
    '',
    'Respond with STRICT JSON ONLY — no prose, no code fences, no trailing text.',
    'The response MUST be a JSON array of EXACTLY 3 objects, each with the keys',
    '"meaningZh", "targetText", and "reading", in that order. Do not include any',
    'other keys or wrapper object. Output the array and stop.',
  ].join('\n')
}
