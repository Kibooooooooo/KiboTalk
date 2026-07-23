import { renderComponent } from '@velin-dev/core-react'

import {
  REPLY_SUGGESTIONS_SYSTEM,
  ReplySuggestionsUserPrompt,
} from './reply-suggestions'
import type {
  ReplySuggestionsChatMessage,
  ReplySuggestionsPromptArgs,
} from './reply-suggestions'

export type {
  ReplySuggestionsChatMessage,
  ReplySuggestionsPromptArgs,
} from './reply-suggestions'
export { REPLY_SUGGESTIONS_SYSTEM, ReplySuggestionsUserPrompt } from './reply-suggestions'

/**
 * Build system + user messages for the reply-suggestions coach
 * (production: system_split + ruby_kanji_no_phrase).
 */
export async function buildReplySuggestionsMessages(
  args: ReplySuggestionsPromptArgs,
): Promise<ReplySuggestionsChatMessage[]> {
  const user = await renderComponent(ReplySuggestionsUserPrompt, args)
  return [
    { role: 'system', content: REPLY_SUGGESTIONS_SYSTEM },
    { role: 'user', content: user },
  ]
}

/**
 * Render messages as a single debug string (SSE `prompt` event / playground).
 */
export async function renderReplySuggestionsPrompt(
  args: ReplySuggestionsPromptArgs,
): Promise<string> {
  const messages = await buildReplySuggestionsMessages(args)
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join('\n\n')
}
