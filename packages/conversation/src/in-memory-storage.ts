import type { ConversationStorage } from './storage'
import type { ConversationTurn } from './types'

export class InMemoryConversationStorage implements ConversationStorage {
  private turns: ConversationTurn[] = []

  async appendTurn(turn: ConversationTurn): Promise<void> {
    this.turns.push(turn)
  }

  async loadActiveSession(): Promise<ConversationTurn[] | null> {
    return this.turns.length === 0 ? null : [...this.turns]
  }

  async clearActiveSession(): Promise<void> {
    this.turns = []
  }
}
