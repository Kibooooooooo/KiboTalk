export type Speaker = 'user' | 'other'

export type ReplySegmentRole = 'content' | 'particle' | 'punct'

/** One surface span of a Japanese reply; used for furigana + particle highlight. */
export type ReplySegment = {
  surface: string
  /** Furigana for kanji spans; omit when surface is already kana/latin/punct. */
  reading?: string
  role: ReplySegmentRole
}

export type ReplyCandidate = {
  id: string
  meaningZh: string
  targetText: string
  reading: string
  /** Tokenized targetText; when absent, UI falls back to plain targetText + reading. */
  segments?: ReplySegment[]
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
