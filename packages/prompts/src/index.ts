import { renderComponent } from '@velin-dev/core-react'

import { ReplySuggestionsPrompt } from './reply-suggestions'
import type { ReplySuggestionsPromptArgs } from './reply-suggestions'

export type { ReplySuggestionsPromptArgs } from './reply-suggestions'

/**
 * Render the reply-suggestions prompt to a single string via Velin.
 *
 * Velin renders the TSX component to static markup and converts it to markdown
 * (see `@velin-dev/core-react`). The returned string is used as the user-message
 * body sent to the LLM. Async because Velin's markdown conversion is async.
 */
export async function renderReplySuggestionsPrompt(
  args: ReplySuggestionsPromptArgs,
): Promise<string> {
  return renderComponent(ReplySuggestionsPrompt, args)
}
