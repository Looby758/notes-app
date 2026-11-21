import { describe, expect, it } from 'vitest'
import { bestMove, canFinish, deal, drawCards, finishStep, isWon, move, type Card, type Deal, type Suit } from './solitaire'
import { recordGame } from './gameStats'

const c = (rank: number, suit: Suit, up = true): Card => ({ rank, suit, up })

describe('solitaire', () => {
  it('deals seven piles with the top card face up and 24 in the stock', () => {
    const d = deal(1)
    expect(d.tableau.map((p) => p.length)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(d.tableau.every((p) => p[p.length - 1].up && p.slice(0, -1).every((x) => !x.up))).toBe(true)
    expect(d.stock).toHaveLength(24)
  })

  it('draws one or three, and turns the waste back over', () => {
    let d: Deal = { ...deal(3), stock: [c(1, 0, false), c(2, 0, false), c(3, 0, false), c(4, 0, false)] }
    d = drawCards(d)!
    expect(d.waste.map((x) => x.rank)).toEqual([4, 3, 2])
    d = drawCards(d)!
    expect(d.waste.map((x) => x.rank)).toEqual([4, 3, 2, 1])
    d = drawCards(d)!
    expect(d.waste).toHaveLength(0)
    expect(d.stock.map((x) => x.rank)).toEqual([1, 2, 3, 4])
  })

  it('stacks down in alternating colours, and only a King fills an empty pile', () => {
    const d: Deal = { stock: [], waste: [c(6, 1)], foundations: [[], [], [], []], tableau: [[c(7, 0)], [c(7, 2)], [], [], [], [], []], draw: 1 }
    expect(move(d, { pile: 'waste' }, { pile: 'tableau', col: 0 })).not.toBeNull()
    expect(move(d, { pile: 'waste' }, { pile: 'tableau', col: 1 })).toBeNull()
    expect(move(d, { pile: 'waste' }, { pile: 'tableau', col: 2 })).toBeNull()
  })

  it('moves a run and turns over the card left behind', () => {
    const d: Deal = {
      stock: [],
      waste: [],
      foundations: [[], [], [], []],
      tableau: [[c(2, 0, false), c(9, 1), c(8, 0)], [c(10, 3)], [], [], [], [], []],
      draw: 1
    }
    const next = move(d, { pile: 'tableau', col: 0, index: 1 }, { pile: 'tableau', col: 1 })!
    expect(next.tableau[1].map((x) => x.rank)).toEqual([10, 9, 8])
    expect(next.tableau[0][0].up).toBe(true)
  })

  it('sends a card home on double-click', () => {
    const d: Deal = { stock: [], waste: [c(1, 2)], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], draw: 1 }
    const next = bestMove(d, { pile: 'waste' })!
    expect(next.foundations.flat()).toHaveLength(1)
  })

  it('finishes a game once every card is showing', () => {
    let d: Deal = {
      stock: [],
      waste: [],
      foundations: [0, 1, 2, 3].map((s) => Array.from({ length: 12 }, (_, i) => c(i + 1, s as Suit))),
      tableau: [[c(13, 0), c(13, 1)], [c(13, 2)], [c(13, 3)], [], [], [], []],
      draw: 1
    }
    expect(canFinish(d)).toBe(true)
    let step: Deal | null
    while ((step = finishStep(d))) d = step
    expect(isWon(d)).toBe(true)
  })
})

describe('game stats', () => {
  it('keeps the streak, best streak and fastest win', () => {
    let r = recordGame(undefined, true, 300)
    r = recordGame(r, true, 200)
    r = recordGame(r, false)
    r = recordGame(r, true, 250)
    expect(r).toEqual({ played: 4, won: 3, streak: 1, bestStreak: 2, bestTime: 200 })
  })
})
