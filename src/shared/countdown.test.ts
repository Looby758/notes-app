import { describe, expect, it } from 'vitest'
import { calendarDays, cleanCountdowns, countdownStatus, isDate, leftText, sortCountdowns, splitTime, targetOf, type Countdown } from './countdown'

const cd = (over: Partial<Countdown>): Countdown => ({ id: 'a', title: 'Thing', kind: 'other', date: '2026-12-25', time: '', yearly: false, created: 0, ...over })

describe('isDate', () => {
  it('takes real dates only', () => {
    expect(isDate('2026-12-25')).toBe(true)
    expect(isDate('2028-02-29')).toBe(true)
    expect(isDate('2027-02-29')).toBe(false)
    expect(isDate('2026-13-01')).toBe(false)
    expect(isDate('25/12/2026')).toBe(false)
  })
})

describe('cleanCountdowns', () => {
  it('drops broken ones and repairs the rest', () => {
    const out = cleanCountdowns([
      { id: 'a', title: '  Trip ', kind: 'trip', date: '2026-12-01', time: '09:30', yearly: false, created: 5 },
      { id: 'a', title: 'Duplicate', date: '2026-12-01' },
      { id: 'b', title: 'Bad date', date: '2026-02-30' },
      { id: 'c', title: '', date: '2026-12-01' },
      { id: 'd', title: 'Odd kind', kind: 'nope', date: '2026-12-01', time: '25:00' },
      'junk'
    ])
    expect(out).toEqual([
      { id: 'a', title: 'Trip', kind: 'trip', date: '2026-12-01', time: '09:30', yearly: false, created: 5 },
      { id: 'd', title: 'Odd kind', kind: 'other', date: '2026-12-01', time: '', yearly: false, created: 0 }
    ])
    expect(cleanCountdowns('nope')).toEqual([])
  })
})

describe('countdownStatus', () => {
  it('counts whole calendar days to a whole-day one', () => {
    const now = new Date(2026, 11, 20, 23, 30)
    const s = countdownStatus(cd({}), now)
    expect(s.state).toBe('upcoming')
    expect(s.days).toBe(5)
    expect(leftText(s, false)).toBe('In 5 days')
  })

  it('says Today for the whole of the day, then done', () => {
    expect(countdownStatus(cd({}), new Date(2026, 11, 25, 0, 0)).state).toBe('today')
    expect(leftText(countdownStatus(cd({}), new Date(2026, 11, 25, 22, 0)), false)).toBe('Today!')
    const after = countdownStatus(cd({}), new Date(2026, 11, 28, 10, 0))
    expect(after.state).toBe('done')
    expect(leftText(after, false)).toBe('3 days ago')
  })

  it('counts hours on the day of a timed one, then It’s here for an hour', () => {
    const c = cd({ time: '19:00' })
    const s = countdownStatus(c, new Date(2026, 11, 25, 15, 40))
    expect(s.state).toBe('today')
    expect(leftText(s, true)).toBe('In 3 h 20 min')
    expect(countdownStatus(c, new Date(2026, 11, 25, 19, 30)).state).toBe('now')
    expect(countdownStatus(c, new Date(2026, 11, 25, 20, 1)).state).toBe('done')
  })

  it('says Tomorrow the day before', () => {
    expect(leftText(countdownStatus(cd({}), new Date(2026, 11, 24, 8)), false)).toBe('Tomorrow')
  })

  it('shows how much of the wait has gone', () => {
    const created = new Date(2026, 11, 15).getTime()
    const s = countdownStatus(cd({ created }), new Date(2026, 11, 20))
    expect(s.progress).toBeCloseTo(0.5)
  })
})

describe('yearly countdowns', () => {
  it('rolls on to next year once the day is over', () => {
    const c = cd({ date: '2025-03-14', yearly: true })
    expect(targetOf(c, new Date(2026, 2, 14, 12)).getFullYear()).toBe(2026)
    expect(targetOf(c, new Date(2026, 2, 15, 0, 1)).getFullYear()).toBe(2027)
    expect(countdownStatus(c, new Date(2026, 2, 15)).state).toBe('upcoming')
  })

  it('keeps a 29 February birthday on the 28th in other years', () => {
    const t = targetOf(cd({ date: '2024-02-29', yearly: true }), new Date(2026, 0, 1))
    expect([t.getFullYear(), t.getMonth(), t.getDate()]).toEqual([2026, 1, 28])
  })

  it('never starts before its first year', () => {
    expect(targetOf(cd({ date: '2030-06-01', yearly: true }), new Date(2026, 0, 1)).getFullYear()).toBe(2030)
  })
})

describe('helpers', () => {
  it('splits time left', () => {
    expect(splitTime(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 })
  })

  it('counts calendar days across a clock change', () => {
    expect(calendarDays(new Date(2026, 2, 28, 12), new Date(2026, 2, 30, 0))).toBe(2)
  })

  it('sorts soonest first with finished ones last', () => {
    const now = new Date(2026, 5, 1)
    const list = [
      cd({ id: 'late', date: '2026-09-01' }),
      cd({ id: 'old', date: '2026-01-01' }),
      cd({ id: 'soon', date: '2026-06-03' }),
      cd({ id: 'older', date: '2025-01-01' })
    ]
    expect(sortCountdowns(list, now).map((c) => c.id)).toEqual(['soon', 'late', 'old', 'older'])
  })
})
