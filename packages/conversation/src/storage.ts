import type { ConversationTurn } from './types'

/**
 * Append-only conversation log storage. Implementations keep a single active
 * session (a `ConversationTurn[]`); `loadActiveSession` recovers it after a
 * refresh, `clearActiveSession` ends it. Swapping IndexedDB for Supabase later
 * only changes the adapter, not this interface.
 */
export interface ConversationStorage {
  appendTurn(turn: ConversationTurn): Promise<void>
  loadActiveSession(): Promise<ConversationTurn[] | null>
  clearActiveSession(): Promise<void>
}
