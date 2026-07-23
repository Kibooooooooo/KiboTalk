import type { ReplyCandidate, ReplySegment } from '@kibotalk/conversation'
import { cn } from '@kibotalk/ui'

function SegmentSpan({ segment }: { segment: ReplySegment }) {
  const className = cn(
    segment.role === 'particle' && 'rounded-sm bg-amber-100 px-0.5 text-amber-900',
    segment.role === 'punct' && 'text-muted-foreground',
  )
  if (segment.reading) {
    return (
      <ruby className={className}>
        {segment.surface}
        <rt className="text-[0.55em] font-normal text-muted-foreground">{segment.reading}</rt>
      </ruby>
    )
  }
  return <span className={className}>{segment.surface}</span>
}

export type ReplyCandidateCardProps = {
  candidate: ReplyCandidate
  /** Timeline one-liner vs bordered card. */
  compact?: boolean
  className?: string
}

/**
 * Renders a reply candidate: ruby over kanji, particle highlight, Chinese below.
 * Falls back to plain targetText / reading when segments are missing.
 */
export function ReplyCandidateCard({ candidate, compact = false, className }: ReplyCandidateCardProps) {
  const { meaningZh, targetText, reading, segments } = candidate
  const jp =
    segments && segments.length > 0 ? (
      <span className="leading-relaxed">
        {segments.map((s, i) => (
          <SegmentSpan key={`${i}-${s.surface}`} segment={s} />
        ))}
      </span>
    ) : (
      <span>{targetText}</span>
    )

  if (compact) {
    return (
      <li className={cn('text-xs text-muted-foreground', className)}>
        <span className="text-foreground">{jp}</span>
        {meaningZh ? <span className="ml-1">（{meaningZh}）</span> : null}
        {!segments?.length && reading ? <span className="ml-1">[{reading}]</span> : null}
      </li>
    )
  }

  return (
    <li className={cn('rounded-md border p-3', className)}>
      <div className="text-base font-medium leading-loose">{jp}</div>
      {meaningZh ? <div className="mt-1 text-xs text-muted-foreground">{meaningZh}</div> : null}
      {!segments?.length && reading ? (
        <div className="mt-0.5 text-xs text-muted-foreground/80">{reading}</div>
      ) : null}
    </li>
  )
}
