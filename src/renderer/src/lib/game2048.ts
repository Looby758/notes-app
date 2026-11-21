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
