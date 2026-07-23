import React from 'react'
import type { ConversationTurn } from '@kibotalk/conversation'

export type ReplySuggestionsPromptArgs = {
  context: ConversationTurn[]
  level: string
}

export type ReplySuggestionsChatMessage = {
  role: 'system' | 'user'
  content: string
}

/**
 * System role for the live reply coach.
 * Split from the user message (vieval: system_split + ruby_kanji_no_phrase).
 */
export const REPLY_SUGGESTIONS_SYSTEM = `You are a live reply coach for a Japanese learner.
After either speaker's turn, decide whether the learner needs opening help.
Return STRICT JSON ONLY: either an array of EXACTLY 3 suggestion objects, or an empty array [].
Never wrap the array. No prose, no code fences, no trailing text.
Tailor vocabulary and grammar to the stated JLPT level.
When returning 3 replies, prefer natural spoken Japanese and keep them meaningfully different (not near-paraphrases).`

function formatContextLines(context: ConversationTurn[]): string[] {
  if (context.length === 0) {
    return ['(no prior turns — this is the opening of the conversation)']
  }
  return context.map((turn) => {
    const speaker = turn.speaker === 'user' ? 'Me (learner)' : 'Other (native speaker)'
    const text = turn.sttFailed ? '(untranscribed)' : turn.text
    return `${speaker}: ${text}`
  })
}

function lastSpeakerLabel(context: ConversationTurn[]): string {
  const last = context[context.length - 1]
  if (!last) return 'none (opening)'
  return last.speaker === 'user' ? 'Me (learner)' : 'Other (native speaker)'
}

/**
 * User-message body: level, last speaker, gate rules, conversation, and schema
 * (kanji-only segment ruby; no top-level phrase `reading`).
 */
export function ReplySuggestionsUserPrompt({ context, level }: ReplySuggestionsPromptArgs) {
  const contextLines = formatContextLines(context)
  const lastSpeaker = lastSpeakerLabel(context)

  return (
    <article>
      <p>Learner level: {level}.</p>
      <p>Last speaker (this request was triggered by): {lastSpeaker}.</p>

      <h2>When to return 3 vs []</h2>
      <ul>
        <li>
          If last speaker is Other: almost always return EXACTLY 3. Use [] only for
          noise, tiny meaningless fragments, or when the learner is clearly not
          expected to speak yet.
        </li>
        <li>
          If last speaker is Me (learner): be liberal — usually return EXACTLY 3
          unless the learner clearly finished their turn and is waiting for Other.
          Prefer helping when the learner seems stuck mid-utterance (short /
          incomplete / trailing off after a pause).
        </li>
        <li>
          Stuck mid-utterance: return 3 FULL speakable sentences that complete what
          the learner started (the learner can read each suggestion from the start).
          Do NOT return only a continuation tail.
        </li>
        <li>
          Reply vs completion use the SAME object shape (no kind field). meaningZh
          is still a short 中文 intent phrase.
        </li>
      </ul>

      <h2>Conversation so far</h2>
      <pre>{contextLines.join('\n')}</pre>

      <h2>Output format</h2>
      <p>
        Output either [] or a JSON array of EXACTLY 3 objects with keys ONLY:
        meaningZh, targetText, segments.
        Do NOT include top-level &quot;reading&quot; (obsolete — UI renders furigana from
        segment.reading only).
      </p>
      <ul>
        <li>meaningZh: learner intent in 中文, one short phrase.</li>
        <li>targetText: Japanese the learner should say (full sentence).</li>
        <li>
          segments: word/morpheme spans covering targetText left-to-right.
          Concatenating every segment.surface MUST equal targetText.
          Each: {'{'} &quot;surface&quot;, optional &quot;reading&quot;, &quot;role&quot;:
          &quot;content&quot; | &quot;particle&quot; | &quot;punct&quot; {'}'}.
        </li>
      </ul>

      <h2>Furigana / segment rules (STRICT)</h2>
      <ul>
        <li>
          Include &quot;reading&quot; ONLY when surface contains at least one 漢字 (kanji).
          Reading is kana for that span.
        </li>
        <li>
          NEVER put &quot;reading&quot; on hiragana/katakana-only surfaces
          (です / ます / こんにちは / ありがとう / します…).
        </li>
        <li>NEVER set reading equal to surface.</li>
        <li>
          role &quot;particle&quot; for 助詞 (は/が/を/に/で/と/も/へ/から/まで/より/の/や/か/ね/よ/など/だけ/しか…).
        </li>
        <li>role &quot;punct&quot; for 。！？、…； everything else &quot;content&quot;.</li>
      </ul>

      <h2>BAD (do not do this)</h2>
      <pre>{`{"surface":"こんにちは","reading":"こんにちは","role":"content"}
{"surface":"です","reading":"です","role":"content"}
{"meaningZh":"...","targetText":"...","reading":"...","segments":[...]}`}</pre>

      <h2>GOOD</h2>
      <pre>{`{"surface":"こんにちは","role":"content"}
{"surface":"一度","reading":"いちど","role":"content"}
{"surface":"を","role":"particle"}
{"surface":"。","role":"punct"}`}</pre>

      <h2>Example (shape only — 3 suggestions)</h2>
      <pre>{`[{"meaningZh":"请求再说一遍","targetText":"もう一度お願いします。","segments":[{"surface":"もう","role":"content"},{"surface":"一度","reading":"いちど","role":"content"},{"surface":"お願い","reading":"おねがい","role":"content"},{"surface":"します","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"表示明白","targetText":"わかりました。","segments":[{"surface":"わかりました","role":"content"},{"surface":"。","role":"punct"}]},{"meaningZh":"礼貌确认","targetText":"それでよろしいですか。","segments":[{"surface":"それ","role":"content"},{"surface":"で","role":"particle"},{"surface":"よろしい","role":"content"},{"surface":"です","role":"content"},{"surface":"か","role":"particle"},{"surface":"。","role":"punct"}]}]`}</pre>

      <p>Respond with STRICT JSON ONLY — no prose, no code fences, no trailing text. Output [] or the array of 3 and stop.</p>
    </article>
  )
}

/** @deprecated Prefer ReplySuggestionsUserPrompt; kept as alias for Velin discovery. */
export const ReplySuggestionsPrompt = ReplySuggestionsUserPrompt
