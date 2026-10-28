import { describe, expect, it } from 'vitest'
import { addHomeCard, homeCards } from './home'

const Empty = (): null => null

describe('home cards', () => {
  it('keeps cards in order and replaces one added again', () => {
    addHomeCard({ id: 'money', order: 50, Card: Empty })
    addHomeCard({ id: 'email', order: 20, Card: Empty })
    expect(homeCards().map((c) => c.id)).toEqual(['email', 'money'])
    addHomeCard({ id: 'money', order: 5, Card: Empty })
    expect(homeCards().map((c) => [c.id, c.order])).toEqual([
      ['money', 5],
      ['email', 20]
    ])
  })
})
