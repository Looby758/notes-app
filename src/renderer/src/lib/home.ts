import type { ComponentType } from 'react'

/**
 * Extra boxes on the Home page, added by features that live elsewhere (email, money…).
 * A feature calls `addHomeCard` once when its module loads; its component renders nothing
 * (returns null) until there's something to show, e.g. before an account is connected.
 */
export interface HomeCard {
  id: string
  /** Lower comes first. The built-in boxes use 10 (today), 30 (flashcards), 40 (recent notes). */
  order: number
  Card: ComponentType
}

const cards: HomeCard[] = []

export function addHomeCard(card: HomeCard): void {
  const i = cards.findIndex((c) => c.id === card.id)
  if (i === -1) cards.push(card)
  else cards[i] = card
  cards.sort((a, b) => a.order - b.order)
}

export const homeCards = (): readonly HomeCard[] => cards
