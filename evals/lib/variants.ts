import type { ConversationTurn } from '@kibotalk/conversation'
import { buildReplySuggestionsMessages } from '@kibotalk/prompts'

import type { ChatMessage } from './chat'
import type { ValidateReplyOptions } from './schema'

/**
 * Prompt / schema proposals — especially furigana & 助詞 labeling.
 *
 * baseline — production (system_split + ruby_kanji_no_phrase)
 * system_split — system role + full schema with phrase reading
 * ruby_kanji_only — forbid reading on kana; still keeps top-level reading
 * no_phrase_reading — drop top-level reading; ruby rules less explicit
 * ruby_kanji_no_phrase — kanji-only ruby + no top-level reading (combined)
 * particle_ruby_strict — system_split + explicit particle list + kana ban
 */
export const PROMPT_VARIANTS = [
  'baseline',
  'system_split',
  'ruby_kanji_only',
  'no_phrase_reading',
  'ruby_kanji_no_phrase',
  'particle_ruby_strict',
] as const

export type PromptVariant = (typeof PROMPT_VARIANTS)[number]

export type VariantBuildInput = {
  context: ConversationTurn[]
  level: string
}

export type BuiltPrompt = {
  messages: ChatMessage[]
  promptText: string
  schema: ValidateReplyOptions
}

function formatContextLines(context: ConversationTurn[]): string {
  if (context.length === 0) {
    return '(no prior turns — this is the opening of the conversation)'
  }
  return context
    .map((turn) => {
      const speaker = turn.speaker === 'user' ? 'Me (learner)' : 'Other (native speaker)'
      const text = turn.sttFailed ? '(untranscribed)' : turn.text
      return `${speaker}: ${text}`
    })
    .join('\n')
}

const SYSTEM_COACH = `You are a live reply coach for a Japanese learner.
Given the conversation so far, suggest exactly 3 things the learner could say next.
Tailor vocabulary and grammar to the stated JLPT level.
Prefer natural spoken Japanese; keep the three replies meaningfully different (not near-paraphrases).
Respond with STRICT JSON ONLY — no prose, no code fences, no trailing text.`

const RUBY_RULES = `Furigana / segment rules (STRICT):
- segments cover targetText left-to-right; concatenating every surface MUST equal targetText.
- Each segment: {"surface":"...","role":"content"|"particle"|"punct", "reading"?: "..."}
- Include "reading" ONLY when surface contains at least one 漢字 (kanji). Reading is kana for that span.
- NEVER put "reading" on hiragana/katakana-only surfaces (です/ます/こんにちは/ありがとう/します…).
- NEVER set reading equal to surface.
- role "particle" for 助詞: は/が/を/に/で/と/も/へ/から/まで/より/の/や/か/ね/よ/など/だけ/しか…
- role "punct" for 。！？、…； everything else "content".`

const SCHEMA_FULL = `Output: a JSON array of EXACTLY 3 objects. Keys:
- meaningZh: learner intent in 中文, one short phrase
- targetText: Japanese reply
- reading: full-phrase kana reading of targetText (UI fallback)
- segments: as in furigana rules
Do not include other keys or a wrapper object.`

const SCHEMA_RUBY_KANJI = `Output: JSON array of EXACTLY 3 objects with keys meaningZh, targetText, reading, segments.

${RUBY_RULES}

BAD (do not do this):
{"surface":"こんにちは","reading":"こんにちは","role":"content"}
{"surface":"です","reading":"です","role":"content"}

GOOD:
{"surface":"こんにちは","role":"content"}
{"surface":"一度","reading":"いちど","role":"content"}
{"surface":"を","role":"particle"}
{"surface":"。","role":"punct"}

Example:
[{"meaningZh":"请求再说一遍","targetText":"もう一度お願いします。","reading":"もういちどおねがいします。","segments":[{"surface":"もう","role":"content"},{"surface":"一度","reading":"いちど","role":"content"},{"surface":"お願い","reading":"おねがい","role":"content"},{"surface":"します","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"表示明白","targetText":"わかりました。","reading":"わかりました。","segments":[{"surface":"わかりました","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"礼貌确认","targetText":"それでよろしいですか。","reading":"それでよろしいですか。","segments":[{"surface":"それ","role":"content"},{"surface":"で","role":"particle"},{"surface":"よろしい","role":"content"},{"surface":"です","role":"content"},{"surface":"か","role":"particle"},{"surface":"。","role":"punct"}]}]`

const SCHEMA_NO_PHRASE = `Output: JSON array of EXACTLY 3 objects with keys ONLY:
- meaningZh, targetText, segments
Do NOT include top-level "reading".

${RUBY_RULES}

Learners see ruby only from segment.reading on kanji spans; kana spans need no reading field.`

/** Combined: kanji-only segment ruby + drop obsolete phrase-level reading. */
const SCHEMA_RUBY_KANJI_NO_PHRASE = `Output: JSON array of EXACTLY 3 objects with keys ONLY:
- meaningZh: learner intent in 中文, one short phrase
- targetText: Japanese reply
- segments: as in furigana rules
Do NOT include top-level "reading" (obsolete — UI renders furigana from segment.reading only).

${RUBY_RULES}

BAD (do not do this):
{"surface":"こんにちは","reading":"こんにちは","role":"content"}
{"surface":"です","reading":"です","role":"content"}
{"meaningZh":"...","targetText":"...","reading":"...","segments":[...]}  ← no top-level reading

GOOD:
{"surface":"こんにちは","role":"content"}
{"surface":"一度","reading":"いちど","role":"content"}
{"surface":"を","role":"particle"}
{"surface":"。","role":"punct"}

Example:
[{"meaningZh":"请求再说一遍","targetText":"もう一度お願いします。","segments":[{"surface":"もう","role":"content"},{"surface":"一度","reading":"いちど","role":"content"},{"surface":"お願い","reading":"おねがい","role":"content"},{"surface":"します","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"表示明白","targetText":"わかりました。","segments":[{"surface":"わかりました","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"礼貌确认","targetText":"それでよろしいですか。","segments":[{"surface":"それ","role":"content"},{"surface":"で","role":"particle"},{"surface":"よろしい","role":"content"},{"surface":"です","role":"content"},{"surface":"か","role":"particle"},{"surface":"。","role":"punct"}]}]`

const SCHEMA_PARTICLE_STRICT = `Output: JSON array of EXACTLY 3 objects: meaningZh, targetText, reading, segments.

${RUBY_RULES}

Extra particle discipline:
- Split 助詞 into their own segments even inside polite endings when they are true particles (か/ね/よ/が/を…).
- Do not glue は/が/を into neighboring content words.
- Copula です/ます are role "content" (NOT particle) and must have NO reading.`

function userWithContext(level: string, context: ConversationTurn[], schemaBlock: string): string {
  return [
    `Learner level: ${level}.`,
    '',
    'Conversation so far:',
    formatContextLines(context),
    '',
    schemaBlock,
  ].join('\n')
}

export async function buildPromptVariant(
  variant: PromptVariant,
  input: VariantBuildInput,
): Promise<BuiltPrompt> {
  switch (variant) {
    case 'baseline': {
      // Production prompt (system_split + ruby_kanji_no_phrase).
      const messages = await buildReplySuggestionsMessages(input)
      return {
        messages,
        promptText: messages
          .map(m => `${m.role.toUpperCase()}:\n${m.content}`)
          .join('\n\n'),
        schema: {
          requiresSegments: true,
          requiresPhraseReading: false,
          forbidKanaReading: true,
        },
      }
    }
    case 'system_split': {
      const user = userWithContext(input.level, input.context, `${RUBY_RULES}\n\n${SCHEMA_FULL}`)
      return {
        messages: [
          { role: 'system', content: SYSTEM_COACH },
          { role: 'user', content: user },
        ],
        promptText: `SYSTEM:\n${SYSTEM_COACH}\n\nUSER:\n${user}`,
        schema: {
          requiresSegments: true,
          requiresPhraseReading: true,
          forbidKanaReading: true,
        },
      }
    }
    case 'ruby_kanji_only': {
      const user = [
        SYSTEM_COACH,
        '',
        userWithContext(input.level, input.context, SCHEMA_RUBY_KANJI),
      ].join('\n')
      return {
        messages: [{ role: 'user', content: user }],
        promptText: user,
        schema: {
          requiresSegments: true,
          requiresPhraseReading: true,
          forbidKanaReading: true,
        },
      }
    }
    case 'no_phrase_reading': {
      const user = [
        SYSTEM_COACH,
        '',
        userWithContext(input.level, input.context, SCHEMA_NO_PHRASE),
      ].join('\n')
      return {
        messages: [{ role: 'user', content: user }],
        promptText: user,
        schema: {
          requiresSegments: true,
          requiresPhraseReading: false,
          forbidKanaReading: true,
        },
      }
    }
    case 'ruby_kanji_no_phrase': {
      const user = [
        SYSTEM_COACH,
        '',
        userWithContext(input.level, input.context, SCHEMA_RUBY_KANJI_NO_PHRASE),
      ].join('\n')
      return {
        messages: [{ role: 'user', content: user }],
        promptText: user,
        schema: {
          requiresSegments: true,
          requiresPhraseReading: false,
          forbidKanaReading: true,
        },
      }
    }
    case 'particle_ruby_strict': {
      const user = userWithContext(input.level, input.context, SCHEMA_PARTICLE_STRICT)
      return {
        messages: [
          { role: 'system', content: SYSTEM_COACH },
          { role: 'user', content: user },
        ],
        promptText: `SYSTEM:\n${SYSTEM_COACH}\n\nUSER:\n${user}`,
        schema: {
          requiresSegments: true,
          requiresPhraseReading: true,
          forbidKanaReading: true,
        },
      }
    }
    default: {
      const _exhaustive: never = variant
      throw new Error(`unknown prompt variant: ${_exhaustive}`)
    }
  }
}
