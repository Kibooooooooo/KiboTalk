import React from 'react'
import type { ConversationTurn } from '@kibotalk/conversation'

export type ReplySuggestionsPromptArgs = {
  context: ConversationTurn[]
  level: string
  scene: string
}

/**
 * Velin TSX prompt for "give me 3 reply candidates for the learner's next
 * turn". Rendered via `@velin-dev/core-react` to a single string used as the
 * user-message body. The LLM must reply with strict JSON — an array of exactly
 * 3 objects — so the browser can incrementally parse tokens as they stream.
 */
export function ReplySuggestionsPrompt({ context, level, scene }: ReplySuggestionsPromptArgs) {
  const contextLines =
    context.length === 0
      ? ['(no prior turns — this is the opening of the conversation)']
      : context.map((turn) => {
          const speaker = turn.speaker === 'user' ? 'Me (learner)' : 'Other (native speaker)'
          const text = turn.sttFailed ? '(untranscribed)' : turn.text
          return `${speaker}: ${text}`
        })

  return (
    <article>
      <p>
        You are a live reply coach for a Japanese learner. Given the conversation so far,
        suggest exactly 3 things the learner could say next.
      </p>
      <p>Learner level: {level}.</p>
      <p>Scene: {scene}.</p>
      <p>Tailor vocabulary and grammar difficulty to the level and scene above.</p>

      <h2>Conversation so far</h2>
      <pre>{contextLines.join('\n')}</pre>

      <h2>Output format</h2>
      <p>For each of the 3 suggestions provide:</p>
      <ul>
        <li>meaningZh: the learner's intent in 中文 (Chinese), one short phrase.</li>
        <li>targetText: the Japanese reply the learner should say.</li>
        <li>reading: full-phrase furigana/kana reading of targetText (fallback).</li>
        <li>
          segments: array of word/morpheme spans covering targetText left-to-right.
          Concatenating every segment.surface MUST equal targetText.
          Each segment: {'{'} "surface", optional "reading" (furigana only when surface
          has kanji), "role" one of "content" | "particle" | "punct" {'}'}.
          Use role "particle" for 助詞 (は/が/を/に/で/と/も/へ/から/まで/より/の/や/か/ね/よ…).
          Use "punct" for 。！？、… and similar. Everything else is "content".
        </li>
      </ul>
      <p>Respond with STRICT JSON ONLY — no prose, no code fences, no trailing text.</p>
      <p>
        The response MUST be a JSON array of EXACTLY 3 objects, each with the keys
        "meaningZh", "targetText", "reading", and "segments", in that order. Do not include any
        other keys or wrapper object. Output the array and stop.
      </p>
    </article>
  )
}
