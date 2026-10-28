import type { ComponentType } from 'react'

/**
 * Extra boxes on the Home page, added by features that live elsewhere (email, money…).
 * A feature calls `addHomeCard` once when its module loads; its component renders nothing
 * (returns null) until there's something to show, e.g. before an account is connected.
 */
export interface HomeCard {
  id: string
  /** Lower comes first. The built-in boxes use 10 (today), 20 (weather), 30 (flashcards), 40 (recent notes). */
  order: number
  /** What the box is called while you're arranging the Home page. */
  title: string
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

/**
 * The boxes in the order you arranged them. `boxes` comes in its usual order; ones you never placed
 * (a feature added since) go right after the box they usually follow, so they don't all pile up at the end.
 */
export function arrangeHome<T extends { id: string }>(boxes: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const out = order.flatMap((id) => byId.get(id) ?? [])
  boxes.forEach((box, i) => {
    if (out.includes(box)) return
    const before = boxes.slice(0, i).reverse().find((b) => out.includes(b))
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, box)
  })
  return out
}

/** `ids` with `id` moved to `to` (the place it ends up). */
export function moveId(ids: readonly string[], id: string, to: number): string[] {
  const out = ids.filter((x) => x !== id)
  out.splice(Math.max(0, Math.min(to, out.length)), 0, id)
  return out
}
