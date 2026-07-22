export type Speaker = 'user' | 'other'

export type ReplyCandidate = {
  id: string
  meaningZh: string
  targetText: string
  reading: string
}

export type ConversationTurn = {
  id: string
  speaker: Speaker
  text: string
  startedAt: number
  endedAt: number
  suggestions?: ReplyCandidate[]
  userId?: string
  sttFailed?: boolean
}
