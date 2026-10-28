/**
 * Sudoku: makes puzzles with exactly one answer, and checks moves.
 * A grid is 81 numbers, row by row; 0 is an empty square.
 */

export type Grid = number[]
export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' }
]

/** How many numbers are given at the start. */
const CLUES: Record<Difficulty, number> = { easy: 40, medium: 32, hard: 26 }

export const rowOf = (i: number): number => Math.floor(i / 9)
export const colOf = (i: number): number => i % 9
export const boxOf = (i: number): number => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3)

/** The squares in the same row, column or box as square i (not i itself). */
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const out: number[] = []
  for (let j = 0; j < 81; j++) {
    if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.push(j)
  }
  return out
})

export const peersOf = (i: number): readonly number[] => PEERS[i]

export function canPlace(grid: Grid, i: number, n: number): boolean {
  return PEERS[i].every((j) => grid[j] !== n)
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The empty square with the fewest options, and those options; null when the grid is full. */
function mostConstrained(grid: Grid): { i: number; options: number[] } | null {
  let best: { i: number; options: number[] } | null = null
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue
    const options = DIGITS.filter((n) => canPlace(grid, i, n))
    if (!best || options.length < best.options.length) best = { i, options }
    if (options.length <= 1) break
  }
  return best
}

/**
 * Counts answers, stopping at `limit`. With `random`, it tries numbers in a shuffled order and
 * leaves `grid` filled in with the answer it stopped at; without, `grid` is left as it was.
 */
function countSolutions(grid: Grid, limit: number, random?: () => number): number {
  const spot = mostConstrained(grid)
  if (!spot) return 1
  let found = 0
  for (const n of random ? shuffled(spot.options, random) : spot.options) {
    grid[spot.i] = n
    found += countSolutions(grid, limit - found, random)
    if (found >= limit) {
      if (random) return found // building a full grid: leave it filled in
      break
    }
  }
  grid[spot.i] = 0
  return found
}

/** The answer to a puzzle, or null if it has none. */
export function solve(puzzle: Grid): Grid | null {
  const grid = [...puzzle]
  return countSolutions(grid, 1, Math.random) ? grid : null
}

export function hasOneSolution(puzzle: Grid): boolean {
  return countSolutions([...puzzle], 2) === 1
}

export interface Puzzle {
  puzzle: Grid
  solution: Grid
}

/** A new puzzle with exactly one answer. */
export function makePuzzle(difficulty: Difficulty, random: () => number = Math.random): Puzzle {
  const solution: Grid = new Array(81).fill(0)
  countSolutions(solution, 1, random)
  const puzzle = [...solution]
  let clues = 81
  // Take numbers away (in mirrored pairs, so it looks neat) while the answer stays the only one.
  for (const i of shuffled([...Array(41).keys()], random)) {
    if (clues <= CLUES[difficulty]) break
    const pair = [i, 80 - i].filter((j, k, a) => a.indexOf(j) === k)
    const before = pair.map((j) => puzzle[j])
    pair.forEach((j) => (puzzle[j] = 0))
    if (hasOneSolution(puzzle)) clues -= pair.length
    else pair.forEach((j, k) => (puzzle[j] = before[k]))
  }
  return { puzzle, solution }
}

/** Squares whose number clashes with another in the same row, column or box. */
export function clashes(grid: Grid): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < 81; i++) {
    if (grid[i] && PEERS[i].some((j) => grid[j] === grid[i])) out.add(i)
  }
  return out
}

export const isSolved = (grid: Grid, solution: Grid): boolean => grid.every((n, i) => n === solution[i])

/** "4:07", or "1:02:09" past an hour. */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
