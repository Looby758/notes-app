import { describe, expect, it } from 'vitest'
import { clashes, formatTime, hasOneSolution, isSolved, makePuzzle, solve, type Difficulty } from './sudoku'

/** A small seeded random number maker, so the tests always see the same puzzles. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const isValidSolution = (g: number[]): boolean => g.every((n) => n >= 1 && n <= 9) && clashes(g).size === 0

describe('sudoku', () => {
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`makes a ${level} puzzle with one answer`, () => {
      const { puzzle, solution } = makePuzzle(level, seeded(level.length))
      expect(isValidSolution(solution)).toBe(true)
      expect(puzzle.every((n, i) => n === 0 || n === solution[i])).toBe(true)
      expect(hasOneSolution(puzzle)).toBe(true)
      expect(solve(puzzle)).toEqual(solution)
    })
  }

  it('gives harder puzzles fewer numbers', () => {
    const clues = (d: Difficulty): number => makePuzzle(d, seeded(7)).puzzle.filter(Boolean).length
    expect(clues('easy')).toBeGreaterThan(clues('medium'))
    expect(clues('medium')).toBeGreaterThan(clues('hard'))
  })

  it('spots clashing numbers', () => {
    const g = new Array(81).fill(0)
    g[0] = 5
    g[8] = 5 // same row
    g[40] = 3
    expect([...clashes(g)].sort((a, b) => a - b)).toEqual([0, 8])
  })

  it('knows when it is solved', () => {
    const { puzzle, solution } = makePuzzle('easy', seeded(3))
    expect(isSolved(puzzle, solution)).toBe(false)
    expect(isSolved([...solution], solution)).toBe(true)
  })

  it('formats the clock', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(247)).toBe('4:07')
    expect(formatTime(3729)).toBe('1:02:09')
  })
})
