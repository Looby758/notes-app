/**
 * Wordle, any time (not a daily puzzle): guess a hidden word in (letters + 1) tries. After each guess
 * every letter is marked right (right letter, right place), close (in the word, somewhere else) or
 * out (not in the word, or not as many times). Guesses can be any letters, real words or not, so
 * "AEIOU" is a fine way to find vowels. Only the answers come from a word list.
 */
import { WORDLE_ANSWERS } from './wordleWords'
import { WALKING_DEAD_ANSWERS, WALKING_DEAD_KIND_OF, WALKING_DEAD_KINDS } from './wordleWalkingDead'

export type WordleMode = 'classic' | 'walkingDead'

export const WORDLE_MODES: { id: WordleMode; label: string; lengths: number[] }[] = [
  { id: 'classic', label: 'Classic', lengths: [2, 3, 4, 5, 6, 7, 8] },
  { id: 'walkingDead', label: 'Walking Dead', lengths: [2, 3, 4, 5, 6, 7, 8] }
]

export const wordleModeOf = (id: WordleMode): (typeof WORDLE_MODES)[number] => WORDLE_MODES.find((m) => m.id === id) ?? WORDLE_MODES[0]

/** One more try than there are letters: 3 for a two-letter word, 9 for an eight-letter one. */
export const maxGuesses = (length: number): number => length + 1

const classic: Record<number, string[]> = {}
export function answersFor(mode: WordleMode, length: number): readonly string[] {
  if (mode === 'walkingDead') return WALKING_DEAD_ANSWERS[length] ?? []
  return (classic[length] ??= (WORDLE_ANSWERS[length] ?? '').split(' ').filter(Boolean))
}

/** What kind of word a Walking Dead answer is ("a character"), for when the round is over. */
export const walkingDeadKind = (word: string): string | null => {
  const kind = WALKING_DEAD_KIND_OF[word.toLowerCase()]
  return kind ? WALKING_DEAD_KINDS[kind] : null
}

/**
 * A new answer, avoiding the ones played most recently (up to half the list) so words don't come
 * round again soon.
 */
export function pickAnswer(mode: WordleMode, length: number, recent: readonly string[] = [], random: () => number = Math.random): string {
  const all = answersFor(mode, length)
  if (!all.length) return ''
  const avoid = new Set(recent.slice(-Math.floor(all.length / 2)))
  const fresh = all.filter((w) => !avoid.has(w))
  const from = fresh.length ? fresh : all
  return from[Math.floor(random() * from.length)]
}

export type LetterMark = 'right' | 'close' | 'out'

/**
 * Marks a guess against the answer, the way Wordle does with repeated letters: right places are
 * counted first, then a letter elsewhere is "close" only while the answer still has one unclaimed.
 */
export function markGuess(guess: string, answer: string): LetterMark[] {
  const g = guess.toLowerCase()
  const a = answer.toLowerCase()
  const marks: LetterMark[] = new Array(g.length).fill('out')
  const left: Record<string, number> = {}
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) marks[i] = 'right'
    else left[a[i]] = (left[a[i]] ?? 0) + 1
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'right' || !left[g[i]]) continue
    marks[i] = 'close'
    left[g[i]]--
  }
  return marks
}

const RANK: Record<LetterMark, number> = { out: 0, close: 1, right: 2 }

/** The best each letter has done in any guess so far, for colouring the keyboard. */
export function keyboardMarks(guesses: readonly string[], answer: string): Record<string, LetterMark> {
  const keys: Record<string, LetterMark> = {}
  for (const guess of guesses) {
    markGuess(guess, answer).forEach((m, i) => {
      const k = guess[i].toLowerCase()
      if (!keys[k] || RANK[m] > RANK[keys[k]]) keys[k] = m
    })
  }
  return keys
}

/** Wins, losses and streaks for one mode and length. `wins[n]` counts wins on guess n + 1. */
export interface WordleStats {
  played: number
  streak: number
  bestStreak: number
  wins: number[]
}

export const emptyStats = (length: number): WordleStats => ({ played: 0, streak: 0, bestStreak: 0, wins: new Array(maxGuesses(length)).fill(0) })

/** The stats after a finished round: won on guess `tries`, or lost (tries null). */
export function recordResult(stats: WordleStats | undefined, length: number, tries: number | null): WordleStats {
  const s = stats && stats.wins?.length === maxGuesses(length) ? stats : emptyStats(length)
  const wins = [...s.wins]
  if (tries !== null) wins[tries - 1]++
  const streak = tries !== null ? s.streak + 1 : 0
  return { played: s.played + 1, streak, bestStreak: Math.max(s.bestStreak, streak), wins }
}

export const winCount = (s: WordleStats): number => s.wins.reduce((a, b) => a + b, 0)
