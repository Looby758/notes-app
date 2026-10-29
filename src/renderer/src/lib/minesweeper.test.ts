import { describe, expect, it } from 'vitest'
import { countsOf, isCleared, layMines, LEVELS, neighbours, reveal } from './minesweeper'

/** A small seeded random number maker, so the tests always see the same boards. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

describe('minesweeper', () => {
  it('finds the squares touching a corner, an edge and the middle', () => {
    expect(neighbours(0, 3, 3).sort()).toEqual([1, 3, 4])
    expect(neighbours(1, 3, 3).sort()).toEqual([0, 2, 3, 4, 5])
    expect(neighbours(4, 3, 3)).toHaveLength(8)
  })

  for (const level of LEVELS) {
    it(`lays ${level.mines} mines on ${level.label.toLowerCase()}, clear of the first click`, () => {
      const first = level.cols + 1
      const mine = layMines(level.rows, level.cols, level.mines, first, seeded(level.mines))
      expect(mine.filter(Boolean)).toHaveLength(level.mines)
      expect(mine[first]).toBe(false)
      expect(neighbours(first, level.rows, level.cols).some((j) => mine[j])).toBe(false)
    })
  }

  it('counts the mines around each square', () => {
    // A mine in the middle of a 3×3: every other square touches one.
    const mine = [false, false, false, false, true, false, false, false, false]
    expect(countsOf(mine, 3, 3)).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1])
  })

  it('opens the empty area around a click, stopping at numbers and flags', () => {
    // 1×5 strip with a mine at the end: clicking the start opens up to the number beside the mine.
    const mine = [false, false, false, false, true]
    const none = new Array(5).fill(false)
    expect(reveal(none, none, mine, 0, 1, 5)).toEqual([true, true, true, true, false])
    const flags = [false, false, true, false, false]
    expect(reveal(none, flags, mine, 0, 1, 5)).toEqual([true, true, false, false, false])
  })

  it('is won once every safe square is open', () => {
    const mine = [false, true]
    expect(isCleared([true, false], mine)).toBe(true)
    expect(isCleared([false, false], mine)).toBe(false)
  })
})
