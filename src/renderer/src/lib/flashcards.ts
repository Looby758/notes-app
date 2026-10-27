import { maskCode } from './links'
import { parseFrontmatter } from './tags'
import { dayKeyOf } from './when'
import { addDays } from './dates'

/**
 * Flashcards: any line written `Question :: Answer` (on its own, or as a list item) is a card.
 * Reviewing a card schedules it again, further away each time you know it (spaced repetition).
 */

export interface Flashcard {
  /** The note's path plus the question, so editing the answer keeps your progress. */
  id: string
  path: string
  question: string
  answer: string
  /** 0-based line in the note. */
  line: number
}

/** How a card is doing. Saved per card id in .notesapp/flashcards.json. */
export interface CardProgress {
  /** Day key (YYYY-MM-DD) the card is next due. */
  due: string
  /** Days between the last review and `due` (0 = later today). */
  interval: number
  /** How fast the interval grows when you know the card. */
  ease: number
  /** Reviews in a row you've known it. */
  streak: number
}

export type Grade = 'again' | 'hard' | 'good' | 'easy'
export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']

// "Question :: Answer", optionally after a list marker or checkbox. The spaces around "::" are
// required, so inline fields written like "rating:: 5" aren't mistaken for cards.
const CARD = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?(?:\[[ xX]\][ \t]+)?(\S.*?)[ \t]+::[ \t]+(\S.*?)[ \t]*$/d

export const cardId = (path: string, question: string): string => `${path}::${question.replace(/\s+/g, ' ').trim().toLowerCase()}`

/** The cards in a note, in order. Lines in code blocks and the frontmatter are skipped. */
export function parseCards(text: string, path: string): Flashcard[] {
  const start = parseFrontmatter(text).end
  const masked = text.slice(0, start).replace(/[^\n]/g, ' ') + maskCode(text).slice(start)
  const lines = text.split('\n')
  const maskedLines = masked.split('\n')
  const cards: Flashcard[] = []
  const seen = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    // Matched on the line with code blanked out, so a "::" inside `code` doesn't count.
    const m = maskedLines[i].includes('::') ? CARD.exec(maskedLines[i]) : null
    if (!m?.indices) continue
    const [q, a] = [m.indices[1]!, m.indices[2]!]
    const question = lines[i].slice(q[0], q[1]).trim()
    const id = cardId(path, question)
    if (seen.has(id)) continue
    seen.add(id)
    cards.push({ id, path, question, answer: lines[i].slice(a[0], a[1]).trim(), line: i })
  }
  return cards
}

// ---------- scheduling ----------

const START_EASE = 2.5
const MIN_EASE = 1.3


/** Whether a card should be reviewed today (new cards always are). */
export const isDue = (progress: CardProgress | undefined, today: string): boolean => !progress || progress.due <= today

/** What reviewing a card with `grade` today does to it. */
export function schedule(progress: CardProgress | undefined, grade: Grade, now: Date): CardProgress {
  const ease = progress?.ease ?? START_EASE
  const last = progress?.interval ?? 0
  let interval: number
  let nextEase = ease
  if (grade === 'again') {
    // Forgotten: see it again in this session, then start over.
    interval = 0
    nextEase = Math.max(MIN_EASE, ease - 0.2)
  } else if (!progress || last === 0) {
    // New (or just forgotten).
    interval = grade === 'easy' ? 4 : 1
    if (grade === 'easy') nextEase = ease + 0.15
  } else if (grade === 'hard') {
    interval = Math.max(last + 1, Math.round(last * 1.2))
    nextEase = Math.max(MIN_EASE, ease - 0.15)
  } else if (grade === 'good') {
    interval = Math.max(last + 1, Math.round(last * ease))
  } else {
    interval = Math.max(last + 2, Math.round(last * ease * 1.3))
    nextEase = ease + 0.15
  }
  return {
    due: dayKeyOf(addDays(now, interval)),
    interval,
    ease: Math.round(nextEase * 100) / 100,
    streak: grade === 'again' ? 0 : (progress?.streak ?? 0) + 1
  }
}

/** "now", "1 day", "3 weeks"… for the review buttons. */
export function describeInterval(days: number): string {
  if (days <= 0) return 'now'
  if (days < 14) return days === 1 ? '1 day' : `${days} days`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  if (days < 365) return `${Math.round(days / 30)} months`
  const years = Math.round((days / 365) * 10) / 10
  return years === 1 ? '1 year' : `${years} years`
}

/** Reads the saved progress file, keeping only well-formed entries. */
export function readProgress(raw: string | null): Record<string, CardProgress> {
  const out: Record<string, CardProgress> = {}
  if (!raw) return out
  try {
    const cards = JSON.parse(raw)?.cards
    if (!cards || typeof cards !== 'object') return out
    for (const [id, p] of Object.entries(cards as Record<string, Partial<CardProgress>>)) {
      if (p && typeof p.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.due) && typeof p.interval === 'number' && typeof p.ease === 'number') {
        out[id] = { due: p.due, interval: p.interval, ease: p.ease, streak: typeof p.streak === 'number' ? p.streak : 0 }
      }
    }
  } catch {
    // unreadable: start fresh rather than failing
  }
  return out
}
