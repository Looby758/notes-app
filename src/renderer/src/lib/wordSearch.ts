/**
 * Word search, as many puzzles as you like (not a daily puzzle). Words from a theme are hidden in a
 * square of letters, in straight lines; bigger puzzles hide them diagonally and backwards too. The
 * board is a string of letters, row by row.
 */
import { WALKING_DEAD_KIND_OF, WALKING_DEAD_SEARCH_KINDS, WORD_SEARCH_THEMES, type WordSearchTheme } from './wordSearchWords'

export type WordSearchSize = 'small' | 'medium' | 'large'

/** A step from one letter to the next: [rows, cols]. */
type Step = readonly [number, number]

const RIGHT: Step = [0, 1]
const DOWN: Step = [1, 0]
const DOWN_RIGHT: Step = [1, 1]
const UP_RIGHT: Step = [-1, 1]
const backwards = (s: Step): Step => [-s[0], -s[1]]

export const WORD_SEARCH_SIZES: { id: WordSearchSize; label: string; grid: number; longest: number; words: number; steps: Step[]; blurb: string }[] = [
  { id: 'small', label: 'Small', grid: 10, longest: 8, words: 8, steps: [RIGHT, DOWN], blurb: '10 × 10, words go across and down' },
  { id: 'medium', label: 'Medium', grid: 13, longest: 11, words: 12, steps: [RIGHT, DOWN, DOWN_RIGHT, UP_RIGHT], blurb: '13 × 13, diagonals too' },
  {
    id: 'large',
    label: 'Large',
    grid: 16,
    longest: 14,
    words: 18,
    steps: [RIGHT, DOWN, DOWN_RIGHT, UP_RIGHT].flatMap((s) => [s, backwards(s)]),
    blurb: '16 × 16, any direction, even backwards'
  }
]

export const sizeOf = (id: WordSearchSize): (typeof WORD_SEARCH_SIZES)[number] => WORD_SEARCH_SIZES.find((s) => s.id === id) ?? WORD_SEARCH_SIZES[0]
export const themeOf = (id: WordSearchTheme): (typeof WORD_SEARCH_THEMES)[number] => WORD_SEARCH_THEMES.find((t) => t.id === id) ?? WORD_SEARCH_THEMES[0]

/** A hidden word and the squares it covers, first letter first. */
export interface Placed {
  word: string
  cells: number[]
}

export interface WordSearch {
  theme: WordSearchTheme
  size: WordSearchSize
  grid: number
  letters: string
  words: Placed[]
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The squares a word would cover from a start square, or null if it runs off the board. */
function lineCells(grid: number, row: number, col: number, step: Step, length: number): number[] | null {
  const endRow = row + step[0] * (length - 1)
  const endCol = col + step[1] * (length - 1)
  if (endRow < 0 || endRow >= grid || endCol < 0 || endCol >= grid) return null
  return Array.from({ length }, (_, i) => (row + step[0] * i) * grid + col + step[1] * i)
}

/** Tries to fit a word somewhere it doesn't clash (it may cross another word on a shared letter). */
function place(board: string[], grid: number, word: string, steps: readonly Step[], random: () => number): number[] | null {
  for (let tries = 0; tries < 300; tries++) {
    const step = steps[Math.floor(random() * steps.length)]
    const cells = lineCells(grid, Math.floor(random() * grid), Math.floor(random() * grid), step, word.length)
    if (cells && cells.every((c, i) => !board[c] || board[c] === word[i])) {
      cells.forEach((c, i) => (board[c] = word[i]))
      return cells
    }
  }
  return null
}

/** Letters to fill the gaps with, roughly as common as in English so the board doesn't look odd. */
const FILL = 'eeeeeeaaaaarrrriiiioooottttnnnnsssslllcccuuddppmmhhggbbffyywkvxzjq'

/** A new puzzle: a random mix of the theme's words. */
export function makeWordSearch(theme: WordSearchTheme, size: WordSearchSize, random: () => number = Math.random): WordSearch {
  const s = sizeOf(size)
  const board: string[] = new Array(s.grid * s.grid).fill('')
  const words: Placed[] = []
  const pool = shuffle(
    themeOf(theme).words.filter((w) => w.length <= s.longest),
    random
  )
  // A random mix of lengths, placed longest first so they all fit; spare words fill in for any that don't.
  const picked = pool.slice(0, s.words).sort((a, b) => b.length - a.length)
  for (const word of [...picked, ...pool.slice(s.words)]) {
    if (words.length >= s.words) break
    // A word inside another one (WALKER in WALKERS) would be found twice, so only one of them goes in.
    if (words.some((p) => p.word.includes(word) || word.includes(p.word))) continue
    const cells = place(board, s.grid, word, s.steps, random)
    if (cells) words.push({ word, cells })
  }
  const letters = board.map((l) => l || FILL[Math.floor(random() * FILL.length)]).join('')
  return { theme, size, grid: s.grid, letters, words: words.sort((a, b) => a.word.localeCompare(b.word)) }
}

/**
 * The squares in a straight line from one square to another (across, down or diagonal), or just
 * the first square when the two aren't in line. Used while dragging, so the line follows the mouse.
 */
export function lineBetween(grid: number, from: number, to: number): number[] {
  const r1 = Math.floor(from / grid)
  const c1 = from % grid
  const dr = Math.floor(to / grid) - r1
  const dc = (to % grid) - c1
  if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return [from]
  const length = Math.max(Math.abs(dr), Math.abs(dc)) + 1
  return lineCells(grid, r1, c1, [Math.sign(dr), Math.sign(dc)], length) ?? [from]
}

/**
 * The squares in line from `from` closest to where the mouse is: snaps to the nearest of the eight
 * directions, so a slightly wobbly drag still picks a straight line.
 */
export function snapLine(grid: number, from: number, row: number, col: number): number[] {
  const r1 = Math.floor(from / grid)
  const c1 = from % grid
  const dr = row - r1
  const dc = col - c1
  if (!dr && !dc) return [from]
  const angle = Math.round(Math.atan2(dr, dc) / (Math.PI / 4))
  const step: Step = [Math.round(Math.sin((angle * Math.PI) / 4)), Math.round(Math.cos((angle * Math.PI) / 4))]
  const reach = Math.max(Math.abs(dr), Math.abs(dc))
  let cells: number[] | null = null
  for (let length = reach + 1; length >= 1 && !cells; length--) cells = lineCells(grid, r1, c1, step, length)
  return cells ?? [from]
}

/** Which hidden word a line of squares picks out (from either end), if any. */
export function wordAt(puzzle: WordSearch, cells: readonly number[], found: readonly string[] = []): Placed | null {
  if (cells.length < 2) return null
  const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((c, i) => c === b[i])
  const reversed = [...cells].reverse()
  const text = cells.map((c) => puzzle.letters[c]).join('')
  // The exact squares first; then any unfound word spelled out there (an accidental second copy still counts).
  const exact = puzzle.words.find((p) => same(p.cells, cells) || same(p.cells, reversed))
  if (exact) return exact
  const reverseText = [...text].reverse().join('')
  return puzzle.words.find((p) => !found.includes(p.word) && (p.word === text || p.word === reverseText)) ?? null
}

/** What a found Walking Dead word is ("a character"), or null for other themes. */
export function walkingDeadSearchKind(word: string): string | null {
  const kind = WALKING_DEAD_KIND_OF[word]
  return kind ? WALKING_DEAD_SEARCH_KINDS[kind] : null
}

/** How a word is shown in the list: DARYL, TDOG as T-DOG. */
export const displayWord = (word: string): string => (word === 'tdog' ? 'T-DOG' : word.toUpperCase())
