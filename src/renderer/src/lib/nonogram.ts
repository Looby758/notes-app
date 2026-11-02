/**
 * Nonograms (picture logic): a hidden picture on a grid, with the lengths of the runs of filled
 * squares given for every row and column. Puzzles are made so they can be solved one line at a
 * time with no guessing, which also means they have exactly one answer.
 * A grid is rows × cols booleans, row by row; true is a filled square.
 */

export type NonoLevel = 'small' | 'medium' | 'large'

export const NONO_LEVELS: { id: NonoLevel; label: string; size: number }[] = [
  { id: 'small', label: 'Small', size: 5 },
  { id: 'medium', label: 'Medium', size: 10 },
  { id: 'large', label: 'Large', size: 15 }
]

export const nonoLevelOf = (id: NonoLevel): (typeof NONO_LEVELS)[number] => NONO_LEVELS.find((l) => l.id === id) ?? NONO_LEVELS[0]

/** A square while solving: not decided yet, filled, or known to be empty. */
export const UNKNOWN = -1
export const EMPTY = 0
export const FILLED = 1
export type Cell = typeof UNKNOWN | typeof EMPTY | typeof FILLED

/** The lengths of the runs of filled squares in a line ([] for an empty line). */
export function cluesOf(line: readonly boolean[]): number[] {
  const out: number[] = []
  let run = 0
  for (const filled of line) {
    if (filled) run++
    else if (run) {
      out.push(run)
      run = 0
    }
  }
  if (run) out.push(run)
  return out
}

export const rowOf = <T>(grid: readonly T[], cols: number, r: number): T[] => grid.slice(r * cols, r * cols + cols)

export const colOf = <T>(grid: readonly T[], rows: number, cols: number, c: number): T[] =>
  Array.from({ length: rows }, (_, r) => grid[r * cols + c])

export function cluesFor(grid: readonly boolean[], rows: number, cols: number): { rows: number[][]; cols: number[][] } {
  return {
    rows: Array.from({ length: rows }, (_, r) => cluesOf(rowOf(grid, cols, r))),
    cols: Array.from({ length: cols }, (_, c) => cluesOf(colOf(grid, rows, cols, c)))
  }
}

/**
 * Everything that's certain about one line, given its clue and what's known so far: a square is
 * filled (or empty) when it's filled (or empty) in every way the runs can be laid out.
 * Returns null when no layout fits.
 */
export function solveLine(line: readonly Cell[], clue: readonly number[]): Cell[] | null {
  const n = line.length
  const k = clue.length
  // fits[j][i]: runs j.. can be laid out in squares i..n-1.
  const fits: boolean[][] = Array.from({ length: k + 1 }, () => new Array(n + 2).fill(false))
  const emptyFrom = (i: number, to: number): boolean => {
    for (let x = i; x < to; x++) if (line[x] === FILLED) return false
    return true
  }
  const runFits = (at: number, len: number): boolean => {
    if (at + len > n) return false
    for (let x = at; x < at + len; x++) if (line[x] === EMPTY) return false
    return at + len === n || line[at + len] !== FILLED
  }
  for (let i = n; i >= 0; i--) fits[k][i] = emptyFrom(i, n)
  for (let j = k - 1; j >= 0; j--) {
    for (let i = n; i >= 0; i--) {
      // Square i is empty and the runs start later, or run j starts here.
      const skip = i < n && line[i] !== FILLED && fits[j][i + 1]
      const here = runFits(i, clue[j]) && fits[j + 1][Math.min(n, i + clue[j] + 1)]
      fits[j][i] = skip || here
    }
  }
  if (!fits[0][0]) return null

  const canFill = new Array(n).fill(false)
  const canEmpty = new Array(n).fill(false)
  // reach[j][i]: squares 0..i-1 can hold runs 0..j-1 with a layout that carries on from i.
  const reach: boolean[][] = Array.from({ length: k + 1 }, () => new Array(n + 2).fill(false))
  reach[0][0] = true
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!reach[j][i] || !fits[j][i]) continue
      if (i < n && line[i] !== FILLED && fits[j][i + 1]) {
        canEmpty[i] = true
        reach[j][i + 1] = true
      }
      if (j < k && runFits(i, clue[j])) {
        const end = i + clue[j]
        const next = Math.min(n, end + 1)
        if (fits[j + 1][next]) {
          for (let x = i; x < end; x++) canFill[x] = true
          if (end < n) canEmpty[end] = true
          reach[j + 1][next] = true
        }
      }
    }
  }
  return line.map((cell, i) => (cell !== UNKNOWN ? cell : canFill[i] && !canEmpty[i] ? FILLED : canEmpty[i] && !canFill[i] ? EMPTY : UNKNOWN))
}

/** Solves a puzzle one line at a time. Returns the grid, or null if it can't be done without guessing. */
export function solveByLines(rowClues: number[][], colClues: number[][]): boolean[] | null {
  const rows = rowClues.length
  const cols = colClues.length
  const grid: Cell[] = new Array(rows * cols).fill(UNKNOWN)
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r < rows; r++) {
      const line = grid.slice(r * cols, r * cols + cols)
      const solved = solveLine(line, rowClues[r])
      if (!solved) return null
      solved.forEach((cell, c) => {
        if (cell !== line[c]) {
          grid[r * cols + c] = cell
          changed = true
        }
      })
    }
    for (let c = 0; c < cols; c++) {
      const line = Array.from({ length: rows }, (_, r) => grid[r * cols + c])
      const solved = solveLine(line, colClues[c])
      if (!solved) return null
      solved.forEach((cell, r) => {
        if (cell !== line[r]) {
          grid[r * cols + c] = cell
          changed = true
        }
      })
    }
  }
  return grid.every((c) => c !== UNKNOWN) ? grid.map((c) => c === FILLED) : null
}

/**
 * A random picture that looks like something: mirrored left to right (like a sprite or a face),
 * then smoothed so the filled squares clump into shapes instead of noise.
 */
function randomPicture(rows: number, cols: number, random: () => number): boolean[] {
  let grid = Array.from({ length: rows * cols }, () => random() < 0.55)
  const at = (g: boolean[], r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols && g[r * cols + c]
  // One smoothing step: a square takes the side most of its neighbours are on.
  grid = grid.map((filled, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    let around = 0
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && at(grid, r + dr, c + dc)) around++
    return around > 4 || (around === 4 && filled)
  })
  if (random() < 0.7) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols / 2; c++) grid[r * cols + (cols - 1 - c)] = grid[r * cols + c]
  }
  return grid
}

export interface Nonogram {
  rows: number
  cols: number
  solution: boolean[]
  clues: { rows: number[][]; cols: number[][] }
}

/** A new puzzle: a picture that can be worked out line by line, with a good share of it filled. */
export function makeNonogram(level: NonoLevel, random: () => number = Math.random): Nonogram {
  const { size } = nonoLevelOf(level)
  let fallback: Nonogram | null = null
  for (let attempt = 0; attempt < 400; attempt++) {
    const solution = randomPicture(size, size, random)
    const share = solution.filter(Boolean).length / solution.length
    if (share < 0.35 || share > 0.75) continue
    const clues = cluesFor(solution, size, size)
    // Every row and column has something in it, so no line is a freebie.
    if (clues.rows.some((c) => !c.length) || clues.cols.some((c) => !c.length)) continue
    const puzzle = { rows: size, cols: size, solution, clues }
    if (solveByLines(clues.rows, clues.cols)) return puzzle
    fallback ??= puzzle
  }
  // Practically never reached; a picture that's always solvable (every square filled except a cross) beats no puzzle.
  if (fallback) {
    const solution = fallback.solution.map((_, i) => Math.floor(i / size) !== Math.floor(size / 2) && i % size !== Math.floor(size / 2))
    return { rows: size, cols: size, solution, clues: cluesFor(solution, size, size) }
  }
  const solution = new Array(size * size).fill(true)
  return { rows: size, cols: size, solution, clues: cluesFor(solution, size, size) }
}

/** The player's squares: 0 untouched, 1 filled, 2 marked empty (a cross). */
export type Mark = 0 | 1 | 2

/** Solved when the filled squares match the picture (crosses and blanks both count as empty). */
export const isNonoSolved = (marks: readonly Mark[], solution: readonly boolean[]): boolean => solution.every((filled, i) => filled === (marks[i] === 1))

/** Whether a line's filled squares already match its clue (to dim the clue). */
export function lineDone(marks: readonly Mark[], clue: readonly number[]): boolean {
  const got = cluesOf(marks.map((m) => m === 1))
  return got.length === clue.length && got.every((n, i) => n === clue[i])
}
