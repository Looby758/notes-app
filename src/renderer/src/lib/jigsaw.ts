/**
 * Jigsaw: cuts a picture into interlocking pieces. Each piece's outline is an SVG path in the
 * picture's own units (the picture is BOARD_WIDTH wide), so the page can clip the picture with it.
 */

export const PIECE_COUNTS = [12, 24, 48, 96, 150] as const
export type PieceCount = (typeof PIECE_COUNTS)[number]

/** The picture's width in the puzzle's units; its height follows its shape. */
export const BOARD_WIDTH = 1000

/** Rows and columns that give about `count` roughly square pieces for a picture of this shape (width / height). */
export function gridFor(count: number, aspect: number): { rows: number; cols: number } {
  const a = Math.min(4, Math.max(0.25, aspect || 1))
  const cols = Math.max(2, Math.round(Math.sqrt(count * a)))
  const rows = Math.max(2, Math.round(count / cols))
  return { rows, cols }
}

/**
 * Which way each join between pieces bulges. `h[r][c]` is the join under piece (r, c) and
 * `v[r][c]` the join to its right: 1 means the tab sticks out of (r, c), -1 into it.
 */
export interface Joins {
  h: number[][]
  v: number[][]
}

export function makeJoins(rows: number, cols: number, random: () => number = Math.random): Joins {
  const side = (): number => (random() < 0.5 ? 1 : -1)
  return {
    h: Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, side)),
    v: Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, side))
  }
}

/** A piece's four sides (top, right, bottom, left): 0 flat (the picture's edge), 1 a tab out, -1 a hole in. */
export function sidesOf(joins: Joins, rows: number, cols: number, r: number, c: number): [number, number, number, number] {
  return [
    r === 0 ? 0 : -joins.h[r - 1][c],
    c === cols - 1 ? 0 : joins.v[r][c],
    r === rows - 1 ? 0 : joins.h[r][c],
    c === 0 ? 0 : -joins.v[r][c - 1]
  ]
}

export const isEdgePiece = (rows: number, cols: number, r: number, c: number): boolean => r === 0 || c === 0 || r === rows - 1 || c === cols - 1

/** How far a tab reaches out of a piece, as a share of the piece's shorter side. */
export const TAB_REACH = 0.26

// One side's tab, along the side (u, 0 to 1) and out from it (v, a share of the piece's shorter side).
// It's the same both ways round, so two neighbours trace the same line.
const TAB: [number, number][][] = [
  [[0.42, 0], [0.4, 0.08], [0.38, 0.13]],
  [[0.34, 0.24], [0.44, TAB_REACH], [0.5, TAB_REACH]],
  [[0.56, TAB_REACH], [0.66, 0.24], [0.62, 0.13]],
  [[0.6, 0.08], [0.58, 0], [0.64, 0]]
]

const num = (n: number): string => String(Math.round(n * 100) / 100)

/** The outline of piece (r, c), in the picture's units, where each piece is `pw` × `ph`. */
export function piecePath(sides: readonly number[], x: number, y: number, pw: number, ph: number): string {
  const corners: [number, number][] = [
    [x, y],
    [x + pw, y],
    [x + pw, y + ph],
    [x, y + ph]
  ]
  const reach = Math.min(pw, ph)
  let d = `M${num(x)} ${num(y)}`
  for (let s = 0; s < 4; s++) {
    const [ax, ay] = corners[s]
    const [bx, by] = corners[(s + 1) % 4]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    // Outwards is the direction of travel turned a quarter left (going round clockwise, y down).
    const nx = (dy / len) * reach * sides[s]
    const ny = (-dx / len) * reach * sides[s]
    const at = ([u, v]: [number, number]): string => `${num(ax + dx * u + nx * v)} ${num(ay + dy * u + ny * v)}`
    if (sides[s]) {
      d += ` L${at([0.36, 0])}`
      for (const [c1, c2, end] of TAB) d += ` C${at(c1)} ${at(c2)} ${at(end)}`
    }
    d += ` L${num(bx)} ${num(by)}`
  }
  return `${d} Z`
}

/** Where a loose piece sits: its top-left corner, in the picture's units. */
export interface Spot {
  x: number
  y: number
}

/**
 * Scatters the pieces around the picture's frame (never on it), in the space `margin` wide on
 * each side. Returns the top-left corner for each piece.
 */
export function scatter(count: number, width: number, height: number, pw: number, ph: number, margin: number, random: () => number = Math.random): Spot[] {
  const out: Spot[] = []
  const offBoard = (x: number, y: number): boolean => !(x + pw > 0 && x < width && y + ph > 0 && y < height)
  for (let i = 0; i < count; i++) {
    // Of a few spots off the picture, the one furthest from the pieces already down, so they don't pile up.
    let best: Spot | null = null
    let bestGap = -1
    for (let tries = 0, found = 0; tries < 200 && found < 12; tries++) {
      const x = -margin + random() * (width + 2 * margin - pw)
      const y = -margin + random() * (height + 2 * margin - ph)
      if (!offBoard(x, y)) continue
      found++
      let gap = Infinity
      for (const s of out) gap = Math.min(gap, Math.hypot((s.x - x) / pw, (s.y - y) / ph))
      if (gap > bestGap) {
        best = { x, y }
        bestGap = gap
      }
    }
    out.push(best ?? { x: -margin, y: -margin })
  }
  return out
}

/** The space left around the picture for loose pieces. */
export const marginFor = (width: number, height: number, pw: number, ph: number): number =>
  Math.max(Math.max(width, height) * 0.32, Math.max(pw, ph) * 1.6)

/** Whether a piece dropped at `spot` is close enough to its home to click into place. */
export function snapsHome(spot: Spot, home: Spot, pw: number, ph: number): boolean {
  return Math.abs(spot.x - home.x) < pw * 0.28 && Math.abs(spot.y - home.y) < ph * 0.28
}
