import { describe, it, expect } from 'vitest'
import { renderReplySuggestionsPrompt } from '../src/index'
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

describe('renderReplySuggestionsPrompt', () => {
  const args = {
    context: [
      turn('other', 'いらっしゃいませ'),
      turn('user', 'これをください'),
    ],
    level: 'N5',
    scene: '便利店',
  }

  const output = renderReplySuggestionsPrompt(args)

  it('mentions all 3 candidate field names', () => {
    expect(output).toContain('meaningZh')
    expect(output).toContain('targetText')
    expect(output).toContain('reading')
  })

  it('includes the conversation context (prior turn texts)', () => {
    expect(output).toContain('いらっしゃいませ')
    expect(output).toContain('これをください')
  })

  it('includes the level and the scene', () => {
    expect(output).toContain('N5')
    expect(output).toContain('便利店')
  })

  it('instructs a strict JSON array of exactly 3', () => {
    expect(output).toMatch(/JSON array of EXACTLY 3 objects/i)
    expect(output).toMatch(/STRICT JSON ONLY/i)
    expect(output).toMatch(/no prose/i)
  })

  it('handles an empty context gracefully', () => {
    const out = renderReplySuggestionsPrompt({ context: [], level: 'N4', scene: '通用' })
    expect(out).toContain('no prior turns')
    expect(out).toContain('N4')
    expect(out).toContain('通用')
  })
})
