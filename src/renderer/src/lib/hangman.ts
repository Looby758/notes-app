/**
 * Hangman, as many rounds as you like: guess the hidden word a letter at a time before the drawing
 * is finished. Words come from everyday English (the Wordle list, 5 to 8 letters) or from one of the
 * word search themes, Walking Dead included.
 */
import { WORDLE_ANSWERS } from './wordleWords'
import { WORD_SEARCH_THEMES, WALKING_DEAD_KIND_OF, WALKING_DEAD_SEARCH_KINDS, type WordSearchTheme } from './wordSearchWords'

export type HangmanTheme = 'everyday' | Exclude<WordSearchTheme, 'everyday'>

/** Wrong guesses that finish the drawing (head, body, two arms, two legs) and end the round. */
export const MAX_WRONG = 6

const everyday: string[] = [5, 6, 7, 8].flatMap((n) => (WORDLE_ANSWERS[n] ?? '').split(' ').filter(Boolean))

export const HANGMAN_THEMES: { id: HangmanTheme; label: string; words: readonly string[] }[] = [
  { id: 'everyday', label: 'Any word', words: everyday },
  ...WORD_SEARCH_THEMES.filter((t) => t.id !== 'everyday').map((t) => ({ id: t.id as HangmanTheme, label: t.label, words: t.words.filter((w) => w.length >= 4) }))
]

export const hangmanThemeOf = (id: HangmanTheme): (typeof HANGMAN_THEMES)[number] => HANGMAN_THEMES.find((t) => t.id === id) ?? HANGMAN_THEMES[0]

/** A new word, avoiding the ones played most recently (up to half the list). */
export function pickHangmanWord(theme: HangmanTheme, recent: readonly string[] = [], random: () => number = Math.random): string {
  const all = hangmanThemeOf(theme).words
  const avoid = new Set(recent.slice(-Math.floor(all.length / 2)))
  const fresh = all.filter((w) => !avoid.has(w))
  const from = fresh.length ? fresh : all
  return from[Math.floor(random() * from.length)]
}

export const wrongGuesses = (word: string, guessed: readonly string[]): string[] => guessed.filter((l) => !word.includes(l))

export const isSolved = (word: string, guessed: readonly string[]): boolean => [...word].every((l) => guessed.includes(l))

export type HangmanState = 'playing' | 'won' | 'lost'

export function hangmanState(word: string, guessed: readonly string[]): HangmanState {
  if (isSolved(word, guessed)) return 'won'
  return wrongGuesses(word, guessed).length >= MAX_WRONG ? 'lost' : 'playing'
}

/** The word as shown so far: guessed letters, and gaps for the rest. */
export const shownLetters = (word: string, guessed: readonly string[]): (string | null)[] => [...word].map((l) => (guessed.includes(l) ? l : null))

/** A clue for a theme word: what kind of Walking Dead word it is, or the theme's name. */
export function hangmanClue(theme: HangmanTheme, word: string): string {
  if (theme === 'walkingDead') {
    const kind = WALKING_DEAD_KIND_OF[word]
    return kind ? `It's ${WALKING_DEAD_SEARCH_KINDS[kind]}` : 'From The Walking Dead'
  }
  if (theme === 'everyday') return `${word.length} letters`
  return `${hangmanThemeOf(theme).label}, ${word.length} letters`
}
