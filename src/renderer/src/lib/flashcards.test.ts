import { describe, expect, it } from 'vitest'
import { describeInterval, isDue, parseCards, readProgress, schedule } from './flashcards'

describe('parseCards', () => {
  it('reads Question :: Answer lines, in lists too', () => {
    const text = '# French\n\nCapital of France :: Paris\n- Dog :: le chien\n2. [ ] Cat :: le chat\nNot a card\n'
    expect(parseCards(text, 'French.md').map((c) => [c.question, c.answer, c.line])).toEqual([
      ['Capital of France', 'Paris', 2],
      ['Dog', 'le chien', 3],
      ['Cat', 'le chat', 4]
    ])
  })
  it('skips code, frontmatter and inline fields', () => {
    const text = '---\ntitle :: nope\n---\nrating:: 5\n```\na :: b\n```\nWhat does `a :: b` mean :: nothing\n`x :: y`\n'
    expect(parseCards(text, 'n.md').map((c) => [c.question, c.answer])).toEqual([['What does `a :: b` mean', 'nothing']])
  })
  it('keys cards by note and question, so editing the answer keeps progress', () => {
    const [a] = parseCards('Capital  of France :: Paris', 'n.md')
    const [b] = parseCards('capital of france :: Paris!', 'n.md')
    expect(a.id).toBe(b.id)
    expect(parseCards('Q :: A\nQ :: B', 'n.md')).toHaveLength(1)
  })
})

describe('schedule', () => {
  const now = new Date(2026, 9, 27, 15)
  it('starts new cards at a day, or four days if easy', () => {
    expect(schedule(undefined, 'good', now)).toMatchObject({ due: '2026-10-28', interval: 1, streak: 1 })
    expect(schedule(undefined, 'easy', now)).toMatchObject({ due: '2026-10-31', interval: 4 })
    expect(schedule(undefined, 'again', now)).toMatchObject({ due: '2026-10-27', interval: 0, streak: 0 })
  })
  it('spaces known cards further apart each time', () => {
    let p = schedule(undefined, 'good', now)
    const gaps = [p.interval]
    for (let i = 0; i < 4; i++) {
      p = schedule(p, 'good', now)
      gaps.push(p.interval)
    }
    expect(gaps).toEqual([1, 3, 8, 20, 50])
  })
  it('orders hard < good < easy, and again starts over with lower ease', () => {
    const p = { due: '2026-10-27', interval: 10, ease: 2.5, streak: 3 }
    const [hard, good, easy] = (['hard', 'good', 'easy'] as const).map((g) => schedule(p, g, now).interval)
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
    expect(schedule(p, 'again', now)).toMatchObject({ interval: 0, ease: 2.3, streak: 0 })
  })
  it('never lets ease drop below 1.3', () => {
    let p = { due: '2026-10-27', interval: 0, ease: 1.35, streak: 0 }
    p = schedule(p, 'again', now)
    expect(p.ease).toBe(1.3)
  })
})

describe('helpers', () => {
  it('knows what is due', () => {
    expect(isDue(undefined, '2026-10-27')).toBe(true)
    expect(isDue({ due: '2026-10-27', interval: 1, ease: 2.5, streak: 1 }, '2026-10-27')).toBe(true)
    expect(isDue({ due: '2026-10-28', interval: 1, ease: 2.5, streak: 1 }, '2026-10-27')).toBe(false)
  })
  it('describes intervals', () => {
    expect([0, 1, 3, 21, 90, 365, 800].map(describeInterval)).toEqual(['now', '1 day', '3 days', '3 weeks', '3 months', '1 year', '2.2 years'])
  })
  it('reads saved progress, dropping anything malformed', () => {
    const raw = JSON.stringify({ cards: { a: { due: '2026-10-28', interval: 1, ease: 2.5, streak: 1 }, b: { due: 'soon' }, c: null } })
    expect(Object.keys(readProgress(raw))).toEqual(['a'])
    expect(readProgress('not json')).toEqual({})
    expect(readProgress(null)).toEqual({})
  })
})
