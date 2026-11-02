import { describe, expect, it } from 'vitest'
import { NavHistory } from './navHistory'

const at = (tab: string, pane = 'p1') => ({ pane, tab })
const all = () => true

describe('NavHistory', () => {
  it('goes back and forward through the places visited', () => {
    const h = new NavHistory()
    h.visit(at('a.md'))
    h.visit(at('b.md'))
    h.visit(at('settings:'))
    expect(h.step(-1, all)).toEqual(at('b.md'))
    expect(h.step(-1, all)).toEqual(at('a.md'))
    expect(h.step(-1, all)).toBeNull()
    expect(h.step(1, all)).toEqual(at('b.md'))
    expect(h.step(1, all)).toEqual(at('settings:'))
    expect(h.step(1, all)).toBeNull()
  })

  it('forgets the forward places once you go somewhere new', () => {
    const h = new NavHistory()
    h.visit(at('a.md'))
    h.visit(at('b.md'))
    h.step(-1, all)
    h.visit(at('c.md'))
    expect(h.canGoForward()).toBe(false)
    expect(h.step(-1, all)).toEqual(at('a.md'))
  })

  it('does not repeat the same tab, but follows it to another pane', () => {
    const h = new NavHistory()
    h.visit(at('a.md'))
    h.visit(at('a.md', 'p2'))
    expect(h.current()).toEqual(at('a.md', 'p2'))
    expect(h.canGoBack()).toBe(false)
  })

  it('remembers what a pane showed before you moved into it', () => {
    const h = new NavHistory()
    h.visit(at('a.md'))
    // Clicked into pane 2 (showing b) and followed a link there to c.
    h.visit(at('c.md', 'p2'), at('b.md', 'p2'))
    expect(h.step(-1, all)).toEqual(at('b.md', 'p2'))
    expect(h.step(-1, all)).toEqual(at('a.md'))
  })

  it('skips and drops places that are gone', () => {
    const h = new NavHistory()
    h.visit(at('a.md'))
    h.visit(at('gone.md'))
    h.visit(at('c.md'))
    const there = (p: { tab: string }) => p.tab !== 'gone.md'
    expect(h.step(-1, there)).toEqual(at('a.md'))
    expect(h.step(1, there)).toEqual(at('c.md'))
    expect(h.canGoForward()).toBe(false)
  })

  it('keeps only the most recent places', () => {
    const h = new NavHistory(3)
    for (const t of ['a', 'b', 'c', 'd']) h.visit(at(t))
    expect(h.step(-1, all)).toEqual(at('c'))
    expect(h.step(-1, all)).toEqual(at('b'))
    expect(h.step(-1, all)).toBeNull()
  })
})
