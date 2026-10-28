import { describe, expect, it } from 'vitest'
import { addHomeCard, arrangeHome, homeCards, moveId } from './home'

const Empty = (): null => null

describe('home cards', () => {
  it('keeps cards in order and replaces one added again', () => {
    addHomeCard({ id: 'money', order: 50, title: 'Money', Card: Empty })
    addHomeCard({ id: 'email', order: 20, title: 'Email', Card: Empty })
    expect(homeCards().map((c) => c.id)).toEqual(['email', 'money'])
    addHomeCard({ id: 'money', order: 5, title: 'Money', Card: Empty })
    expect(homeCards().map((c) => [c.id, c.order])).toEqual([
      ['money', 5],
      ['email', 20]
    ])
  })
})

describe('arranging the Home page', () => {
  const boxes = ['today', 'weather', 'email', 'recent'].map((id) => ({ id }))
  const ids = (order: string[]): string[] => arrangeHome(boxes, order).map((b) => b.id)

  it('keeps the usual order until you move something', () => {
    expect(ids([])).toEqual(['today', 'weather', 'email', 'recent'])
  })

  it('follows the order you saved', () => {
    expect(ids(['recent', 'email', 'weather', 'today'])).toEqual(['recent', 'email', 'weather', 'today'])
  })

  it('puts a box you never placed after the one it usually follows', () => {
    // "email" is new since you arranged things: it goes after weather, wherever weather is now.
    expect(ids(['recent', 'weather', 'today'])).toEqual(['recent', 'weather', 'email', 'today'])
    // A new first box stays first.
    expect(ids(['weather', 'email', 'recent'])).toEqual(['today', 'weather', 'email', 'recent'])
  })

  it('ignores boxes that are gone', () => {
    expect(ids(['music', 'recent', 'today', 'weather', 'email'])).toEqual(['recent', 'today', 'weather', 'email'])
  })

  it('moves an id to a new place', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 99)).toEqual(['a', 'c', 'b'])
  })
})
