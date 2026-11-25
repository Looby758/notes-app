/**
 * Solitaire (Klondike): build each suit up from Ace to King on the four foundations. On the seven
 * piles, cards go down one rank at a time in alternating colours, and only a King fills an empty pile.
 */

/** 0 ♠, 1 ♥, 2 ♦, 3 ♣. */
export type Suit = 0 | 1 | 2 | 3

export interface Card {
  suit: Suit
  /** 1 (Ace) to 13 (King). */
  rank: number
  up: boolean
}

export interface Deal {
  stock: Card[]
  waste: Card[]
  foundations: Card[][]
  tableau: Card[][]
  /** Cards turned over from the stock each time: 1 or 3. */
  draw: 1 | 3
}

/** Where a move picks cards up from. `index` is the first card moved from a pile. */
export type From = { pile: 'waste' } | { pile: 'foundation'; f: number } | { pile: 'tableau'; col: number; index: number }
export type To = { pile: 'foundation'; f: number } | { pile: 'tableau'; col: number }

export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const isRed = (s: Suit): boolean => s === 1 || s === 2
export const rankName = (r: number): string => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[r] ?? String(r)

export function shuffledDeck(random: () => number = Math.random): Card[] {
  const deck: Card[] = []
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ suit: s as Suit, rank: r, up: false })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

/** Deals seven piles of 1 to 7 cards (only the top one face up); the rest is the stock. */
export function deal(draw: 1 | 3, random: () => number = Math.random): Deal {
  const deck = shuffledDeck(random)
  const tableau: Card[][] = []
  for (let col = 0; col < 7; col++) {
    const pile = deck.splice(0, col + 1)
    pile[col] = { ...pile[col], up: true }
    tableau.push(pile)
  }
  return { stock: deck, waste: [], foundations: [[], [], [], []], tableau, draw }
}

/** Turns over the next card or three from the stock, or turns the waste back over once the stock is empty. */
export function drawCards(d: Deal): Deal | null {
  if (!d.stock.length) {
    if (!d.waste.length) return null
    return { ...d, stock: [...d.waste].reverse().map((c) => ({ ...c, up: false })), waste: [] }
  }
  const n = Math.min(d.draw, d.stock.length)
  const turned = d.stock.slice(-n).reverse().map((c) => ({ ...c, up: true }))
  return { ...d, stock: d.stock.slice(0, -n), waste: [...d.waste, ...turned] }
}

/** The cards a move would pick up, or null if they can't be picked up together. */
export function picked(d: Deal, from: From): Card[] | null {
  if (from.pile === 'waste') return d.waste.length ? [d.waste[d.waste.length - 1]] : null
  if (from.pile === 'foundation') {
    const f = d.foundations[from.f]
    return f.length ? [f[f.length - 1]] : null
  }
  const pile = d.tableau[from.col]
  const cards = pile.slice(from.index)
  if (!cards.length || !cards[0].up) return null
  // A run being moved must already be in order.
  for (let i = 1; i < cards.length; i++) if (!fitsOn(cards[i], cards[i - 1])) return null
  return cards
}

/** Can `card` go on top of `under` on one of the seven piles? */
export const fitsOn = (card: Card, under: Card): boolean => under.up && isRed(card.suit) !== isRed(under.suit) && card.rank === under.rank - 1

export function canPlace(d: Deal, cards: Card[], to: To): boolean {
  const first = cards[0]
  if (to.pile === 'foundation') {
    if (cards.length !== 1) return false
    const f = d.foundations[to.f]
    const top = f[f.length - 1]
    return top ? top.suit === first.suit && first.rank === top.rank + 1 : first.rank === 1
  }
  const pile = d.tableau[to.col]
  const top = pile[pile.length - 1]
  return top ? fitsOn(first, top) : first.rank === 13
}

/** Makes the move, or returns null if it isn't allowed. The card left on top of a pile turns face up. */
export function move(d: Deal, from: From, to: To): Deal | null {
  if (from.pile === to.pile && (from.pile === 'tableau' ? from.col === (to as { col: number }).col : from.f === (to as { f: number }).f)) return null
  const cards = picked(d, from)
  if (!cards || !canPlace(d, cards, to)) return null
  const next: Deal = { ...d, waste: d.waste, foundations: [...d.foundations], tableau: [...d.tableau] }
  if (from.pile === 'waste') next.waste = d.waste.slice(0, -1)
  else if (from.pile === 'foundation') next.foundations[from.f] = d.foundations[from.f].slice(0, -1)
  else {
    const left = d.tableau[from.col].slice(0, from.index)
    if (left.length && !left[left.length - 1].up) left[left.length - 1] = { ...left[left.length - 1], up: true }
    next.tableau[from.col] = left
  }
  if (to.pile === 'foundation') next.foundations[to.f] = [...next.foundations[to.f], ...cards]
  else next.tableau[to.col] = [...next.tableau[to.col], ...cards]
  return next
}

/** The foundation a single card can go to, if any. */
export function foundationFor(d: Deal, card: Card): number {
  for (let f = 0; f < 4; f++) if (canPlace(d, [card], { pile: 'foundation', f })) return f
  return -1
}

/**
 * Where a double-click sends cards: home to a foundation if it can go, otherwise the first pile it
 * fits on (a pile with cards before an empty one).
 */
export function bestMove(d: Deal, from: From): Deal | null {
  const cards = picked(d, from)
  if (!cards) return null
  if (cards.length === 1 && from.pile !== 'foundation') {
    const f = foundationFor(d, cards[0])
    if (f >= 0) return move(d, from, { pile: 'foundation', f })
  }
  const cols = [...d.tableau.keys()].sort((a, b) => Number(!d.tableau[a].length) - Number(!d.tableau[b].length))
  for (const col of cols) {
    // Don't shuffle a King from one empty spot to another.
    if (from.pile === 'tableau' && from.index === 0 && !d.tableau[col].length) continue
    const next = move(d, from, { pile: 'tableau', col })
    if (next) return next
  }
  return null
}

export const isWon = (d: Deal): boolean => d.foundations.every((f) => f.length === 13)

/** Once every card is face up and the stock is used up, the rest can be played home automatically. */
export const canFinish = (d: Deal): boolean => !isWon(d) && !d.stock.length && !d.waste.length && d.tableau.every((p) => p.every((c) => c.up))

/** One card home towards finishing (lowest first), or null when nothing can go. */
export function finishStep(d: Deal): Deal | null {
  let best: { col: number; rank: number } | null = null
  d.tableau.forEach((p, col) => {
    const top = p[p.length - 1]
    if (top && foundationFor(d, top) >= 0 && (!best || top.rank < best.rank)) best = { col, rank: top.rank }
  })
  if (!best) return null
  const { col } = best as { col: number }
  const card = d.tableau[col][d.tableau[col].length - 1]
  return move(d, { pile: 'tableau', col, index: d.tableau[col].length - 1 }, { pile: 'foundation', f: foundationFor(d, card) })
}
