import { describe, expect, it } from 'vitest'
import { gridFor, isEdgePiece, makeJoins, marginFor, piecePath, scatter, sidesOf, snapsHome } from './jigsaw'

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

describe('jigsaw', () => {
  it('picks a grid close to the number of pieces, shaped like the picture', () => {
    expect(gridFor(12, 4 / 3)).toEqual({ rows: 3, cols: 4 })
    expect(gridFor(24, 3 / 2)).toEqual({ rows: 4, cols: 6 })
    const tall = gridFor(48, 3 / 4)
    expect(tall.rows).toBeGreaterThan(tall.cols)
    for (const n of [12, 24, 48, 96, 150]) {
      const { rows, cols } = gridFor(n, 16 / 9)
      expect(Math.abs(rows * cols - n) / n).toBeLessThan(0.2)
    }
  })

  it('makes neighbours fit: a tab on one side is a hole on the other', () => {
    const rows = 4
    const cols = 5
    const joins = makeJoins(rows, cols, seeded(3))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [top, right, bottom, left] = sidesOf(joins, rows, cols, r, c)
        expect(top === 0).toBe(r === 0)
        expect(left === 0).toBe(c === 0)
        expect(bottom === 0).toBe(r === rows - 1)
        expect(right === 0).toBe(c === cols - 1)
        if (c < cols - 1) expect(right).toBe(-sidesOf(joins, rows, cols, r, c + 1)[3])
        if (r < rows - 1) expect(bottom).toBe(-sidesOf(joins, rows, cols, r + 1, c)[0])
        expect(isEdgePiece(rows, cols, r, c)).toBe(top === 0 || right === 0 || bottom === 0 || left === 0)
      }
    }
  })

  it('draws a closed outline, square for a flat-sided piece', () => {
    expect(piecePath([0, 0, 0, 0], 0, 0, 100, 80)).toBe('M0 0 L100 0 L100 80 L0 80 L0 0 Z')
    const tabbed = piecePath([1, -1, 1, -1], 100, 100, 100, 100)
    expect(tabbed.startsWith('M100 100')).toBe(true)
    expect(tabbed.endsWith('L100 100 Z')).toBe(true)
    expect(tabbed.match(/C/g)).toHaveLength(16)
    // A tab out of the top reaches above the piece; a hole in the right stays inside it.
    const ys = [...tabbed.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(Math.min(...ys)).toBeLessThan(100)
  })

  it('shares one line between two neighbours', () => {
    // The right side of a piece with a tab out, and the left side of the one beside it with a hole in.
    const a = piecePath([0, 1, 0, 0], 0, 0, 100, 100)
    const b = piecePath([0, 0, 0, -1], 100, 0, 100, 100)
    const pts = (d: string): Set<string> => new Set([...d.matchAll(/-?[\d.]+ -?[\d.]+/g)].map((m) => m[0]))
    // a's tab sticks out to the right of x=100; b's hole goes into b, also right of x=100.
    const aSide = [...pts(a)].filter((p) => Number(p.split(' ')[0]) >= 100).sort()
    const bSide = [...pts(b)].filter((p) => Number(p.split(' ')[0]) < 199.9).sort()
    expect(aSide.length).toBeGreaterThan(10)
    expect(aSide).toEqual(bSide)
  })

  it('scatters pieces off the picture', () => {
    const w = 1000
    const h = 750
    const pw = 250
    const ph = 250
    const margin = marginFor(w, h, pw, ph)
    const spots = scatter(12, w, h, pw, ph, margin, seeded(9))
    expect(spots).toHaveLength(12)
    for (const s of spots) {
      const onBoard = s.x + pw > 0 && s.x < w && s.y + ph > 0 && s.y < h
      expect(onBoard).toBe(false)
      expect(s.x).toBeGreaterThanOrEqual(-margin)
      expect(s.y).toBeGreaterThanOrEqual(-margin)
    }
  })

  it('snaps a piece home only when it is close', () => {
    expect(snapsHome({ x: 105, y: 95 }, { x: 100, y: 100 }, 100, 100)).toBe(true)
    expect(snapsHome({ x: 140, y: 100 }, { x: 100, y: 100 }, 100, 100)).toBe(false)
  })
})
