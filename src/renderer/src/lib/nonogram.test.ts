import { describe, expect, it } from 'vitest'
import { cluesFor, cluesOf, EMPTY, FILLED, isNonoSolved, lineDone, makeNonogram, solveByLines, solveLine, UNKNOWN, type Cell, type Mark } from './nonogram'

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const U = UNKNOWN
const F = FILLED
const E = EMPTY

describe('nonogram', () => {
  it('reads the runs in a line', () => {
    expect(cluesOf([true, true, false, true, false, false, true, true, true])).toEqual([2, 1, 3])
    expect(cluesOf([false, false])).toEqual([])
    expect(cluesOf([true, true, true])).toEqual([3])
  })

  it('works out the certain squares of a line', () => {
    // A run of 4 in 5 squares: the middle three are certain.
    expect(solveLine([U, U, U, U, U], [4])).toEqual([U, F, F, F, U])
    // 2 1 in 4 squares fits exactly one way.
    expect(solveLine([U, U, U, U], [2, 1])).toEqual([F, F, E, F])
    // Nothing to fill: all empty.
    expect(solveLine([U, U, U], [])).toEqual([E, E, E])
    // A known filled square at the end pins a run of 2.
    expect(solveLine([U, U, U, U, F], [2])).toEqual([E, E, E, F, F])
  })

  it('spots a line that cannot be laid out', () => {
    expect(solveLine([U, E, U], [2])).toBeNull()
    expect(solveLine([F, F, F], [2])).toBeNull()
    expect(solveLine([U, U, U], [1, 2])).toBeNull()
  })

  it('agrees with trying every layout', () => {
    const random = seeded(7)
    for (let t = 0; t < 300; t++) {
      const n = 3 + Math.floor(random() * 6)
      const truth = Array.from({ length: n }, () => random() < 0.5)
      const clue = cluesOf(truth)
      const line: Cell[] = truth.map((f) => (random() < 0.3 ? (f ? F : E) : U))
      // Every line of n squares that matches the clue and what's known.
      const all: boolean[][] = []
      for (let m = 0; m < 1 << n; m++) {
        const cand = Array.from({ length: n }, (_, i) => !!(m & (1 << i)))
        if (cand.every((f, i) => line[i] === U || (line[i] === F) === f) && cluesOf(cand).join() === clue.join()) all.push(cand)
      }
      const expected = line.map((_, i) => (all.every((c) => c[i]) ? F : all.every((c) => !c[i]) ? E : U))
      expect(solveLine(line, clue)).toEqual(expected)
    }
  })

  for (const level of ['small', 'medium', 'large'] as const) {
    it(`makes a ${level} puzzle that can be solved line by line`, () => {
      const p = makeNonogram(level, seeded(level.length * 11))
      expect(p.solution.length).toBe(p.rows * p.cols)
      expect(p.clues).toEqual(cluesFor(p.solution, p.rows, p.cols))
      expect(solveByLines(p.clues.rows, p.clues.cols)).toEqual(p.solution)
      expect(p.clues.rows.every((c) => c.length > 0)).toBe(true)
    })
  }

  it('checks a solution and finished lines', () => {
    const solution = [true, false, false, true]
    expect(isNonoSolved([1, 2, 0, 1] as Mark[], solution)).toBe(true)
    expect(isNonoSolved([1, 1, 0, 1] as Mark[], solution)).toBe(false)
    expect(lineDone([1, 1, 2, 1] as Mark[], [2, 1])).toBe(true)
    expect(lineDone([1, 0, 2, 1] as Mark[], [2, 1])).toBe(false)
  })
})
