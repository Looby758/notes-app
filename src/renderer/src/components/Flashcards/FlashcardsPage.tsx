import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CheckCircle2, FileText, Layers } from 'lucide-react'
import { useNoteIndex } from '../../store/noteIndex'
import { usePrefs } from '../../store/prefs'
import { reviewCard, useFlashcards } from '../../store/flashcards'
import { describeInterval, GRADES, isDue, schedule, type CardProgress, type Flashcard, type Grade } from '../../lib/flashcards'
import { dayKeyOf } from '../../lib/when'
import { isWithin, noteTitle } from '../../lib/paths'
import { FLASHCARDS_TAB, openNote, openSpecialTab } from '../../lib/editorController'
import { showKeys } from '@shared/platform'

const GRADE_LABELS: Record<Grade, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }

/** Every card in the vault (templates left out), in note order. */
export function useAllCards(): Flashcard[] {
  const notes = useNoteIndex((s) => s.notes)
  const templatesFolder = usePrefs((s) => s.prefs.templatesFolder)
  return useMemo(() => {
    const paths = [...notes.keys()]
      .filter((p) => notes.get(p)!.cards.length && !(templatesFolder && isWithin(p, templatesFolder)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    return paths.flatMap((p) => notes.get(p)!.cards)
  }, [notes, templatesFolder])
}

/** How many cards are waiting to be reviewed today. */
export function useDueCount(): number {
  const cards = useAllCards()
  const progress = useFlashcards((s) => s.progress)
  const today = dayKeyOf(new Date())
  return cards.filter((c) => isDue(progress[c.id], today)).length
}

/** The title bar button, with how many cards are waiting. */
export function FlashcardsButton() {
  const due = useDueCount()
  return (
    <button
      className="icon-btn flashcards-button"
      onClick={() => openSpecialTab(FLASHCARDS_TAB)}
      title={`Flashcards${due ? `: ${due} to review` : ''} (${showKeys('Ctrl+Shift+Y')})`}
      data-flashcards-button
    >
      <Layers size={15} />
      {due > 0 && <span className="flashcards-badge">{due > 99 ? '99+' : due}</span>}
    </button>
  )
}

/** Cards due first (most overdue first), then new cards in note order. */
function dueQueue(cards: Flashcard[], progress: Record<string, CardProgress>, today: string): string[] {
  const due = cards.filter((c) => progress[c.id] && isDue(progress[c.id], today))
  due.sort((a, b) => progress[a.id].due.localeCompare(progress[b.id].due))
  const fresh = cards.filter((c) => !progress[c.id])
  return [...due, ...fresh].map((c) => c.id)
}

interface Session {
  /** What's being reviewed: '' for all notes, otherwise one note's path. */
  deck: string
  queue: string[]
  done: number
  revealed: boolean
}

/** The flashcards page: an overview of your cards, and reviewing the ones due today. */
export default function FlashcardsPage() {
  const cards = useAllCards()
  const progress = useFlashcards((s) => s.progress)
  const [session, setSession] = useState<Session | null>(null)
  const today = dayKeyOf(new Date())
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const start = (deck: string): void => {
    const inDeck = deck ? cards.filter((c) => c.path === deck) : cards
    setSession({ deck, queue: dueQueue(inDeck, progress, today), done: 0, revealed: false })
  }

  return (
    <div className="flashcards-page" data-flashcards-page>
      <div className="flashcards-inner">
        {session ? (
          <Review session={session} setSession={setSession} byId={byId} />
        ) : (
          <Overview cards={cards} progress={progress} today={today} start={start} />
        )}
      </div>
    </div>
  )
}

function Overview({
  cards,
  progress,
  today,
  start
}: {
  cards: Flashcard[]
  progress: Record<string, CardProgress>
  today: string
  start: (deck: string) => void
}) {
  const decks = useMemo(() => {
    const map = new Map<string, { total: number; due: number }>()
    for (const c of cards) {
      const d = map.get(c.path) ?? { total: 0, due: 0 }
      d.total++
      if (isDue(progress[c.id], today)) d.due++
      map.set(c.path, d)
    }
    return [...map]
  }, [cards, progress, today])
  const due = decks.reduce((n, [, d]) => n + d.due, 0)
  const fresh = cards.filter((c) => !progress[c.id]).length

  return (
    <>
      <h2>
        <Layers size={18} /> Flashcards
      </h2>
      <p className="flashcards-intro">
        Write a line like <code>Capital of France :: Paris</code> in any note to make a card. Cards you know come back less and less often; cards you
        miss come back soon.
      </p>
      {cards.length === 0 ? (
        <p className="flashcards-none">No cards yet. Add a line with a question, “ :: ” and the answer to any note, and it shows up here.</p>
      ) : (
        <>
          <div className="flashcards-summary">
            <div>
              <strong>{due}</strong> to review today{fresh > 0 && <span> ({fresh} new)</span>}
            </div>
            <button className="btn btn-primary" disabled={due === 0} onClick={() => start('')} data-flashcards-start>
              {due === 0 ? 'All done for today' : 'Review all'}
            </button>
          </div>
          <ul className="flashcards-decks">
            {decks.map(([path, d]) => (
              <li key={path}>
                <button className="link-button" onClick={() => openNote(path)} title="Open the note">
                  <FileText size={13} /> {noteTitle(path)}
                </button>
                <span className="flashcards-deck-count">
                  {d.due > 0 ? `${d.due} to review · ` : ''}
                  {d.total} {d.total === 1 ? 'card' : 'cards'}
                </span>
                <button className="btn" disabled={d.due === 0} onClick={() => start(path)}>
                  Review
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function Review({
  session,
  setSession,
  byId
}: {
  session: Session
  setSession: (s: Session | null) => void
  byId: Map<string, Flashcard>
}) {
  const progress = useFlashcards((s) => s.progress)
  const box = useRef<HTMLDivElement>(null)
  // A card edited away or deleted mid-review is skipped.
  const queue = session.queue.filter((id) => byId.has(id))
  const card = queue.length ? byId.get(queue[0])! : null

  useEffect(() => box.current?.focus(), [card?.id, session.revealed])

  const grade = (g: Grade): void => {
    if (!card) return
    const next = reviewCard(card.id, g)
    // Missed cards go to the back of the queue to try again before you finish.
    const rest = queue.slice(1)
    setSession({ ...session, queue: next.interval === 0 ? [...rest, card.id] : rest, done: session.done + 1, revealed: false })
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') setSession(null)
    else if (!card) return
    else if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) setSession({ ...session, revealed: true })
    else if (session.revealed && /^[1-4]$/.test(e.key)) grade(GRADES[Number(e.key) - 1])
    else return
    e.preventDefault()
  }

  const title = session.deck ? noteTitle(session.deck) : 'All notes'
  const now = new Date()

  return (
    <div className="flashcards-review" ref={box} tabIndex={-1} onKeyDown={onKey} data-flashcards-review>
      <header>
        <span>
          <Layers size={15} /> {title}
        </span>
        <span className="flashcards-left">{card ? `${queue.length} left` : ''}</span>
        <button className="btn" onClick={() => setSession(null)}>
          {card ? 'Stop' : 'Back'}
        </button>
      </header>
      {card ? (
        <>
          <div className="flashcard">
            <div className="flashcard-question" data-flashcard-question>
              {card.question}
            </div>
            {session.revealed && (
              <div className="flashcard-answer" data-flashcard-answer>
                {card.answer}
              </div>
            )}
          </div>
          {session.revealed ? (
            <div className="flashcard-grades">
              {GRADES.map((g, i) => (
                <button key={g} className={`btn flashcard-grade grade-${g}`} onClick={() => grade(g)} data-grade={g}>
                  <span>{GRADE_LABELS[g]}</span>
                  <small>{describeInterval(schedule(progress[card.id], g, now).interval)}</small>
                  <kbd>{i + 1}</kbd>
                </button>
              ))}
            </div>
          ) : (
            <div className="flashcard-grades">
              <button className="btn btn-primary flashcard-show" onClick={() => setSession({ ...session, revealed: true })} data-flashcard-show>
                Show answer <kbd>Space</kbd>
              </button>
            </div>
          )}
          <button className="link-button flashcard-source" onClick={() => openNote(card.path, { line: card.line })}>
            <FileText size={12} /> From {noteTitle(card.path)}
          </button>
        </>
      ) : (
        <div className="flashcards-finished" data-flashcards-finished>
          <CheckCircle2 size={28} />
          <p>
            All done! You reviewed {session.done} {session.done === 1 ? 'card' : 'cards'}.
          </p>
          <button className="btn" onClick={() => setSession(null)}>
            Back to flashcards
          </button>
        </div>
      )}
    </div>
  )
}
