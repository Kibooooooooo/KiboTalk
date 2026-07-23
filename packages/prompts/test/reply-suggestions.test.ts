import { describe, it, expect } from 'vitest'
import {
  buildReplySuggestionsMessages,
  renderReplySuggestionsPrompt,
  REPLY_SUGGESTIONS_SYSTEM,
} from '../src/index'
import type { ConversationTurn } from '@kibotalk/conversation'

function turn(speaker: 'user' | 'other', text: string): ConversationTurn {
  return {
    id: `${speaker}-${text}`,
    speaker,
    text,
    startedAt: 0,
    endedAt: 0,
  }
}

describe('reply suggestions prompt (production schema)', async () => {
  const args = {
    context: [
      turn('other', 'いらっしゃいませ'),
      turn('user', 'これをください'),
    ],
    level: 'N5',
  }

  const messages = await buildReplySuggestionsMessages(args)
  const output = await renderReplySuggestionsPrompt(args)

  it('returns system + user messages', () => {
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages[0]?.content).toBe(REPLY_SUGGESTIONS_SYSTEM)
  })

  it('debug render includes SYSTEM and USER sections', () => {
    expect(output).toMatch(/^SYSTEM:/)
    expect(output).toContain('USER:')
  })

  it('requires meaningZh, targetText, segments — not top-level reading', () => {
    const user = messages[1]!.content
    expect(user).toContain('meaningZh')
    expect(user).toContain('targetText')
    expect(user).toContain('segments')
    expect(user).toContain('particle')
    expect(user).toMatch(/Do NOT include top-level/)
    expect(user).toMatch(/NEVER put/)
    expect(user).toContain('こんにちは')
    // Schema keys list should not demand phrase-level reading as required.
    expect(user).toMatch(/keys ONLY:\s*meaningZh, targetText, segments/i)
  })

  it('includes the conversation context (prior turn texts)', () => {
    expect(messages[1]!.content).toContain('いらっしゃいませ')
    expect(messages[1]!.content).toContain('これをください')
  })

  it('includes the level and not a scene field', () => {
    expect(messages[1]!.content).toContain('N5')
    expect(output).not.toMatch(/Scene:/i)
  })

  it('allows [] or exactly 3, and states last-speaker gate rules', () => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    expect(system).toMatch(/STRICT JSON ONLY/i)
    expect(system).toMatch(/empty array \[\]/i)
    expect(user).toMatch(/\[\] or a JSON array of EXACTLY 3 objects/i)
    expect(user).toContain('Last speaker')
    expect(user).toContain('Me (learner)')
    expect(user).toMatch(/Stuck mid-utterance/i)
    expect(user).toMatch(/FULL speakable sentences/i)
    expect(user).toMatch(/almost always return EXACTLY 3/i)
    expect(user).toMatch(/be liberal/i)
  })

  it('handles an empty context gracefully', async () => {
    const msgs = await buildReplySuggestionsMessages({ context: [], level: 'N4' })
    expect(msgs[1]!.content).toContain('no prior turns')
    expect(msgs[1]!.content).toContain('N4')
    expect(msgs[1]!.content).toContain('none (opening)')
  })
})
