import { useTotalUnread } from '../../store/messages'
import { useDueCount } from '../Flashcards/FlashcardsPage'

const short = (n: number): string => (n > 99 ? '99+' : String(n))

/** The unread or due count drawn on a feature's icon (top bar, dock, launcher). */
export function FeatureBadge({ id }: { id: 'messages' | 'flashcards' }) {
  return id === 'messages' ? <MessagesBadge /> : <DueBadge />
}

function MessagesBadge() {
  const { count, dot } = useTotalUnread()
  if (count > 0) return <span className="feature-badge">{short(count)}</span>
  return dot ? <span className="feature-badge dot" /> : null
}

function DueBadge() {
  const due = useDueCount()
  return due > 0 ? <span className="feature-badge">{short(due)}</span> : null
}
