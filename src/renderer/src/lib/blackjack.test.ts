import { describe, expect, it } from 'vitest'
import { canDouble, canSplit, deal, double, handValue, hit, newShoe, newTable, split, stand, type Round } from './blackjack'
import type { Card, Suit } from './solitaire'

const c = (rank: number, suit: Suit = 0): Card => ({ rank, suit, up: true })

/** A table whose shoe starts with these ranks (player, dealer, player, dealer, then draws), padded out. */
function rigged(ranks: number[], bank = 1000): Round {
  return { ...newTable(bank), shoe: [...ranks.map((r) => c(r)), ...newShoe().slice(0, 150)] }
}

describe('blackjack', () => {
  it('counts hands, with Aces as 1 or 11', () => {
    expect(handValue([c(1), c(13)])).toEqual({ total: 21, soft: true })
    expect(handValue([c(1), c(6)])).toEqual({ total: 17, soft: true })
    expect(handValue([c(1), c(6), c(10)])).toEqual({ total: 17, soft: false })
    expect(handValue([c(1), c(1), c(9)])).toEqual({ total: 21, soft: true })
    expect(handValue([c(12), c(11), c(2)])).toEqual({ total: 22, soft: false })
    expect(newShoe()).toHaveLength(208)
  })

  it('pays 3 to 2 for a blackjack straight away', () => {
    const r = deal(rigged([1, 9, 13, 8]), 100)
    expect(r.phase).toBe('done')
    expect(r.hands[0].outcome).toBe('blackjack')
    expect(r.bank).toBe(1000 + 150)
    expect(r.dealer.every((x) => x.up)).toBe(true)
  })

  it('ends the hand when the dealer has blackjack', () => {
    const r = deal(rigged([10, 1, 9, 12]), 50)
    expect(r.phase).toBe('done')
    expect(r.hands[0].outcome).toBe('lose')
    expect(r.bank).toBe(950)
  })

  it('busts when going over 21 and the dealer stands on 17', () => {
    let r = deal(rigged([10, 10, 6, 7, 9]), 20) // player 16, dealer 17
    expect(r.phase).toBe('playing')
    expect(r.dealer[1].up).toBe(false)
    r = hit(r) // 25
    expect(r.phase).toBe('done')
    expect(r.hands[0].outcome).toBe('lose')
    expect(r.dealer).toHaveLength(2)
    expect(r.bank).toBe(980)

    r = deal(rigged([10, 10, 8, 7]), 20) // 18 against 17
    r = stand(r)
    expect(r.hands[0].outcome).toBe('win')
    expect(r.bank).toBe(1020)
  })

  it('makes the dealer draw to 17', () => {
    let r = deal(rigged([10, 10, 9, 2, 3, 5]), 10) // player 19; dealer 12, draws 3 (15), 5 (20)
    r = stand(r)
    expect(r.dealer.map((x) => x.rank)).toEqual([10, 2, 3, 5])
    expect(r.hands[0].outcome).toBe('lose')
  })

  it('doubles for one card and twice the bet', () => {
    let r = deal(rigged([6, 10, 5, 7, 10]), 50) // 11, then a 10 = 21; dealer 17
    expect(canDouble(r)).toBe(true)
    r = double(r)
    expect(r.hands[0].cards).toHaveLength(3)
    expect(r.hands[0].bet).toBe(100)
    expect(r.hands[0].outcome).toBe('win')
    expect(r.bank).toBe(1100)
  })

  it('splits a pair into two hands played one after the other', () => {
    let r = deal(rigged([8, 10, 8, 7, 3, 10]), 50) // 8,8 vs 17; split gets 3 and 10
    expect(canSplit(r)).toBe(true)
    r = split(r)
    expect(r.hands).toHaveLength(2)
    expect(r.bank).toBe(900)
    expect(r.hands[0].cards.map((x) => x.rank)).toEqual([8, 3])
    r = stand(r) // 11 stands (loses to 17)
    expect(r.active).toBe(1)
    r = stand(r) // 18 beats 17
    expect(r.phase).toBe('done')
    expect(r.hands.map((h) => h.outcome)).toEqual(['lose', 'win'])
    expect(r.bank).toBe(1000)
  })

  it('gives split Aces one card each, and a split 21 is not a blackjack', () => {
    let r = deal(rigged([1, 10, 1, 7, 13, 5]), 50)
    r = split(r)
    expect(r.phase).toBe('done')
    expect(r.hands.map((h) => h.cards.length)).toEqual([2, 2])
    expect(r.hands[0].outcome).toBe('win')
    expect(r.hands[1].outcome).toBe('lose') // 16 against 17
    expect(r.bank).toBe(1000)
  })

  it("won't bet more than you have", () => {
    const r = rigged([10, 10, 8, 7], 30)
    expect(deal(r, 50)).toBe(r)
  })
})
