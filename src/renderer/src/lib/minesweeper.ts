/**
 * Minesweeper: lays the mines and works out what a click opens.
 * A board is rows × cols squares, row by row.
 */

export type Level = 'easy' | 'medium' | 'hard'

export const LEVELS: { id: Level; label: string; rows: number; cols: number; mines: number }[] = [
  { id: 'easy', label: 'Easy', rows: 9, cols: 9, mines: 10 },
  { id: 'medium', label: 'Medium', rows: 16, cols: 16, mines: 40 },
  { id: 'hard', label: 'Hard', rows: 16, cols: 30, mines: 99 }
]

export const levelOf = (id: Level): (typeof LEVELS)[number] => LEVELS.find((l) => l.id === id) ?? LEVELS[0]

/** The up to 8 squares touching square i. */
export function neighbours(i: number, rows: number, cols: number): number[] {
  const r = Math.floor(i / cols)
  const c = i % cols
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc)
    }
  }
  return out
}

/**
 * Lays the mines once the first square is clicked, keeping that square and the ones touching it
 * clear, so the first click always opens a patch to start from.
 */
export function layMines(rows: number, cols: number, count: number, first: number, random: () => number = Math.random): boolean[] {
  const keepClear = new Set([first, ...neighbours(first, rows, cols)])
  const spots = [...Array(rows * cols).keys()].filter((i) => !keepClear.has(i))
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[spots[i], spots[j]] = [spots[j], spots[i]]
  }
  const mine = new Array(rows * cols).fill(false)
  for (const i of spots.slice(0, count)) mine[i] = true
  return mine
}

/** How many mines touch each square. */
export function countsOf(mine: boolean[], rows: number, cols: number): number[] {
  return mine.map((_, i) => neighbours(i, rows, cols).filter((j) => mine[j]).length)
}

/** Opens square i; a square with no mines around it opens its neighbours too, and so on. Flags are left shut. */
export function reveal(open: boolean[], flags: boolean[], mine: boolean[], i: number, rows: number, cols: number): boolean[] {
  const out = [...open]
  const counts = countsOf(mine, rows, cols)
  const todo = [i]
  while (todo.length) {
    const j = todo.pop()!
    if (out[j] || flags[j]) continue
    out[j] = true
    if (!mine[j] && counts[j] === 0) todo.push(...neighbours(j, rows, cols))
  }
  return out
}

/** Won once every square without a mine is open. */
export const isCleared = (open: boolean[], mine: boolean[]): boolean => mine.every((m, i) => m || open[i])
