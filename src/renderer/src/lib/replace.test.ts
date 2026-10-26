import { describe, expect, it } from 'vitest'
import { applyMatches, buildPattern, findMatches } from './replace'

const opts = { matchCase: false, wholeWord: false, regex: false }
const find = (text: string, q: string, rep: string, o = {}) => {
  const p = buildPattern(q, { ...opts, ...o })
  if (typeof p === 'string') throw new Error(p)
  return findMatches(text, p, rep, { ...opts, ...o })
}

describe('find and replace', () => {
  it('finds plain text, any case, special characters included', () => {
    expect(find('Cat cat CAT (cat)', 'cat', 'dog').map((m) => m.from)).toEqual([0, 4, 8, 13])
    expect(find('a.b axb', 'a.b', 'X').map((m) => m.from)).toEqual([0])
  })
  it('matches case and whole words when asked', () => {
    expect(find('Cat cat', 'cat', 'x', { matchCase: true }).map((m) => m.from)).toEqual([4])
    expect(find('cat category bobcat cat', 'cat', 'x', { wholeWord: true }).map((m) => m.from)).toEqual([0, 20])
  })
  it('uses groups in regular expressions', () => {
    const text = 'call 2026-10-26 and 2026-11-01'
    const ms = find(text, '(\\d{4})-(\\d{2})-(\\d{2})', '$3/$2/$1', { regex: true })
    expect(applyMatches(text, ms)).toBe('call 26/10/2026 and 01/11/2026')
    expect(find('a$b', 'a', '$$', { regex: true })[0].replacement).toBe('$')
  })
  it('reports a broken pattern instead of failing', () => {
    expect(buildPattern('(oops', { ...opts, regex: true })).toMatch(/doesn't work/)
    expect(buildPattern('', opts)).toMatch(/Type something/)
  })
  it('replaces only the chosen matches, and shows the line', () => {
    const text = 'one\ntwo two\nthree'
    const ms = find(text, 'two', '2')
    expect(ms[1]).toMatchObject({ line: 1, snippet: 'two two', snipFrom: 4, snipTo: 7 })
    expect(applyMatches(text, [ms[1]])).toBe('one\ntwo 2\nthree')
  })
  it('skips empty matches', () => {
    expect(find('abc', 'x*', '-', { regex: true })).toEqual([])
  })
})
