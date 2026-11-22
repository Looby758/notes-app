/**
 * 2048: slide the tiles, and two tiles with the same number join into one. A board is 4 × 4
 * numbers, row by row, with 0 for an empty square.
 */

export const SIZE = 4
export const GOAL = 2048

export type Direction = 'up' | 'down' | 'left' | 'right'

/** Slides one line of tiles towards its start, joining equal neighbours once each. */
export function slideLine(line: number[]): { line: number[]; gained: number } {
  const tiles = line.filter(Boolean)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2)
      gained += tiles[i] * 2
      i++
    } else out.push(tiles[i])
  }
  while (out.length < line.length) out.push(0)
  return { line: out, gained }
}

/** The squares of each line, listed from the side the tiles slide towards. */
function lines(dir: Direction): number[][] {
  const out: number[][] = []
  for (let a = 0; a < SIZE; a++) {
    const l: number[] = []
    for (let b = 0; b < SIZE; b++) {
      if (dir === 'left') l.push(a * SIZE + b)
      else if (dir === 'right') l.push(a * SIZE + (SIZE - 1 - b))
      else if (dir === 'up') l.push(b * SIZE + a)
      else l.push((SIZE - 1 - b) * SIZE + a)
    }
    out.push(l)
  }
  return out
}

/** Slides the whole board. `moved` is false when nothing could move that way. */
export function slide(board: number[], dir: Direction): { board: number[]; gained: number; moved: boolean; joined: number[] } {
  const next = [...board]
  let gained = 0
  const joined: number[] = []
  for (const squares of lines(dir)) {
    const before = squares.map((i) => board[i])
    const { line, gained: g } = slideLine(before)
    gained += g
    // Which squares now hold a joined tile (for the little pop).
    const kept = before.filter(Boolean)
    let k = 0
    line.forEach((v, j) => {
      if (!v) return
      if (kept[k] !== v) {
        joined.push(squares[j])
        k += 2
      } else k += 1
      next[squares[j]] = v
    })
    for (let j = line.filter(Boolean).length; j < SIZE; j++) next[squares[j]] = 0
  }
  const moved = next.some((v, i) => v !== board[i])
  return { board: next, gained, moved, joined }
}

/** Puts a 2 (or now and then a 4) on a random empty square. Returns the square, or -1 if full. */
export function addTile(board: number[], random: () => number = Math.random): { board: number[]; at: number } {
  const empty = board.flatMap((v, i) => (v ? [] : [i]))
  if (!empty.length) return { board, at: -1 }
  const at = empty[Math.floor(random() * empty.length)]
  const next = [...board]
  next[at] = random() < 0.9 ? 2 : 4
  return { board: next, at }
}

export function newBoard(random: () => number = Math.random): number[] {
  return addTile(addTile(new Array(SIZE * SIZE).fill(0), random).board, random).board
}

/** False once the board is full and no two touching tiles match. */
export const canMove = (board: number[]): boolean => (['up', 'down', 'left', 'right'] as Direction[]).some((d) => slide(board, d).moved)

export const biggest = (board: number[]): number => Math.max(...board)

/** A tile on screen. Ids stay the same as a tile slides, so it can glide to its new square. */
export interface Tile {
  id: number
  value: number
  /** Square index, row by row. */
  at: number
  /** Just made by two tiles joining. */
  merged?: boolean
  /** Just appeared. */
  isNew?: boolean
  /** Slid into another tile and is about to disappear. */
  gone?: boolean
  /** Moved to a new square this turn. */
  slid?: boolean
}

let nextId = 1
export const tileId = (): number => nextId++

export function tilesOf(board: number[]): Tile[] {
  return board.flatMap((value, at) => (value ? [{ id: tileId(), value, at }] : []))
}

/**
 * Slides the tiles like `slide`, keeping track of where each one goes: tiles that join both glide to
 * the same square (and are marked gone), and a new tile with the doubled number appears there.
 */
export function slideTiles(tiles: Tile[], dir: Direction): { tiles: Tile[]; moved: boolean } {
  const live = tiles.filter((t) => !t.gone)
  const byAt = new Map(live.map((t) => [t.at, t]))
  const out: Tile[] = []
  let moved = false
  for (const squares of lines(dir)) {
    const row = squares.map((sq) => byAt.get(sq)).filter((t): t is Tile => !!t)
    let target = 0
    for (let i = 0; i < row.length; i++) {
      const t = row[i]
      const n = row[i + 1]
      const to = squares[target]
      if (n && n.value === t.value) {
        out.push({ id: t.id, value: t.value, at: to, gone: true }, { id: n.id, value: n.value, at: to, gone: true })
        out.push({ id: tileId(), value: t.value * 2, at: to, merged: true })
        moved = true
        i++
      } else {
        if (t.at !== to) moved = true
        out.push({ id: t.id, value: t.value, at: to, ...(t.at !== to ? { slid: true } : {}) })
      }
      target++
    }
  }
  return { tiles: out, moved }
}

/** The board numbers the tiles stand for. */
export function boardOf(tiles: Tile[]): number[] {
  const b = new Array(SIZE * SIZE).fill(0)
  for (const t of tiles) if (!t.gone) b[t.at] = t.value
  return b
}
