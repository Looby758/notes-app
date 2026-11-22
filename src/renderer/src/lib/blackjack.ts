/**
 * Blackjack against the dealer, with pretend chips. Get closer to 21 than the dealer without going
 * over. House rules: a 4-deck shoe, the dealer stands on all 17s and peeks for blackjack, blackjack
 * pays 3 to 2, double on any first two cards, split a pair once (split Aces get one card each).
 */
import { shuffledDeck, type Card } from './solitaire'

export const DECKS = 4
export const START_BANK = 1000
export const CHIPS = [10, 25, 50, 100] as const

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose'

export interface Hand {
  cards: Card[]
  bet: number
  /** Stood, bust, doubled or 21: no more cards. */
  done: boolean
  doubled: boolean
  /** Came from a split (a two-card 21 here isn't a blackjack). */
  split: boolean
  outcome?: Outcome
}

export interface Round {
  shoe: Card[]
  dealer: Card[]
  hands: Hand[]
  /** The hand being played. */
  active: number
  phase: 'betting' | 'playing' | 'done'
  /** Chips not on the table. */
  bank: number
  /** The bet for the next hand. */
  bet: number
}

export function newShoe(random: () => number = Math.random): Card[] {
  const cards: Card[] = []
  for (let d = 0; d < DECKS; d++) cards.push(...shuffledDeck(random))
  // Shuffle the decks together too.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

export const newTable = (bank = START_BANK): Round => ({ shoe: newShoe(), dealer: [], hands: [], active: 0, phase: 'betting', bank, bet: 25 })

/** A card's points: picture cards are 10, an Ace is 1 (or 11, see handValue). */
export const cardPoints = (c: Card): number => Math.min(c.rank, 10)

/** The best total for a hand, and whether an Ace is counting as 11 ("soft"). */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = cards.reduce((n, c) => n + cardPoints(c), 0)
  const ace = cards.some((c) => c.rank === 1)
  const soft = ace && total + 10 <= 21
  if (soft) total += 10
  return { total, soft }
}

export const isBlackjack = (cards: readonly Card[]): boolean => cards.length === 2 && handValue(cards).total === 21
export const isBust = (cards: readonly Card[]): boolean => handValue(cards).total > 21

/** Takes the top card (face up unless asked), with a fresh shoe when it runs low. */
function draw(r: Round, up = true): { card: Card; shoe: Card[] } {
  const shoe = r.shoe.length < 15 ? newShoe() : r.shoe
  return { card: { ...shoe[0], up }, shoe: shoe.slice(1) }
}

/** Deals a new hand for `bet` chips: two cards each, the dealer's second face down. */
export function deal(r: Round, bet: number): Round {
  if (r.phase === 'playing' || bet <= 0 || bet > r.bank) return r
  // Reshuffle between hands once a quarter of the shoe is left.
  let next: Round = { ...r, shoe: r.shoe.length < (DECKS * 52) / 4 ? newShoe() : r.shoe }
  const take = (up = true): Card => {
    const d = draw(next, up)
    next = { ...next, shoe: d.shoe }
    return d.card
  }
  const p1 = take()
  const d1 = take()
  const p2 = take()
  const d2 = take(false)
  next = {
    ...next,
    bank: r.bank - bet,
    bet,
    dealer: [d1, d2],
    hands: [{ cards: [p1, p2], bet, done: false, doubled: false, split: false }],
    active: 0,
    phase: 'playing'
  }
  // A blackjack on either side ends the hand straight away (the dealer peeks).
  if (isBlackjack(next.hands[0].cards) || isBlackjack(next.dealer)) return settle(next)
  return next
}

const current = (r: Round): Hand | undefined => (r.phase === 'playing' ? r.hands[r.active] : undefined)

/** Moves on to the next hand still to play, or the dealer's turn when there isn't one. */
function advance(r: Round): Round {
  const i = r.hands.findIndex((h) => !h.done)
  return i >= 0 ? { ...r, active: i } : dealerPlays(r)
}

function withHand(r: Round, hand: Hand): Round {
  const hands = r.hands.map((h, i) => (i === r.active ? hand : h))
  return { ...r, hands }
}

export function hit(r: Round): Round {
  const h = current(r)
  if (!h || h.done) return r
  const d = draw(r)
  const cards = [...h.cards, d.card]
  const total = handValue(cards).total
  return advance(withHand({ ...r, shoe: d.shoe }, { ...h, cards, done: total >= 21 }))
}

export function stand(r: Round): Round {
  const h = current(r)
  if (!h || h.done) return r
  return advance(withHand(r, { ...h, done: true }))
}

export const canDouble = (r: Round): boolean => {
  const h = current(r)
  return !!h && !h.done && h.cards.length === 2 && r.bank >= h.bet && !(h.split && h.cards[0].rank === 1)
}

/** Doubles the bet for exactly one more card. */
export function double(r: Round): Round {
  const h = current(r)
  if (!h || !canDouble(r)) return r
  const d = draw(r)
  return advance(withHand({ ...r, shoe: d.shoe, bank: r.bank - h.bet }, { ...h, cards: [...h.cards, d.card], bet: h.bet * 2, doubled: true, done: true }))
}

export const canSplit = (r: Round): boolean => {
  const h = current(r)
  return !!h && r.hands.length === 1 && h.cards.length === 2 && h.cards[0].rank === h.cards[1].rank && r.bank >= h.bet
}

/** Splits a pair into two hands, each with a new second card. Split Aces get just that one card. */
export function split(r: Round): Round {
  const h = current(r)
  if (!h || !canSplit(r)) return r
  let next: Round = { ...r, bank: r.bank - h.bet }
  const take = (): Card => {
    const d = draw(next)
    next = { ...next, shoe: d.shoe }
    return d.card
  }
  const aces = h.cards[0].rank === 1
  const make = (first: Card): Hand => {
    const cards = [first, take()]
    return { cards, bet: h.bet, done: aces || handValue(cards).total === 21, doubled: false, split: true }
  }
  next = { ...next, hands: [make(h.cards[0]), make(h.cards[1])], active: 0 }
  return advance(next)
}

/** The dealer turns the hidden card over and draws to 17, unless every hand is already bust. */
export function dealerPlays(r: Round): Round {
  let next: Round = { ...r, dealer: r.dealer.map((c) => ({ ...c, up: true })) }
  const allBust = next.hands.every((h) => isBust(h.cards))
  while (!allBust && handValue(next.dealer).total < 17) {
    const d = draw(next)
    next = { ...next, shoe: d.shoe, dealer: [...next.dealer, d.card] }
  }
  return settle(next)
}

/** How one hand did against the dealer. */
export function outcomeOf(hand: Hand, dealer: readonly Card[]): Outcome {
  const p = handValue(hand.cards).total
  const d = handValue(dealer).total
  const pBj = isBlackjack(hand.cards) && !hand.split
  const dBj = isBlackjack(dealer)
  if (pBj && dBj) return 'push'
  if (pBj) return 'blackjack'
  if (dBj) return 'lose'
  if (p > 21) return 'lose'
  if (d > 21 || p > d) return 'win'
  return p === d ? 'push' : 'lose'
}

/** What a hand pays back, its own bet included. */
export function payout(hand: Hand): number {
  switch (hand.outcome) {
    case 'blackjack':
      return hand.bet + Math.floor(hand.bet * 1.5)
    case 'win':
      return hand.bet * 2
    case 'push':
      return hand.bet
    default:
      return 0
  }
}

/** Ends the hand: shows the dealer's cards, decides each hand and pays out. */
export function settle(r: Round): Round {
  const dealer = r.dealer.map((c) => ({ ...c, up: true }))
  const hands = r.hands.map((h) => ({ ...h, done: true, outcome: outcomeOf(h, dealer) }))
  const bank = r.bank + hands.reduce((n, h) => n + payout(h), 0)
  // Keep the same bet next time, as long as you can still afford it.
  return { ...r, dealer, hands, bank, phase: 'done', bet: Math.min(r.bet, Math.max(bank, 0)) || Math.min(CHIPS[0], bank) }
}

/** Chips won or lost on the last hand, compared with what was bet. */
export const netResult = (r: Round): number => r.hands.reduce((n, h) => n + payout(h) - h.bet, 0)
