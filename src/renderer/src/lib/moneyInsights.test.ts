import { describe, expect, it } from 'vitest'
import { findRecurring, forecastMonth, monthlyCost, occurrences, weeklyToGoal } from './moneyInsights'
import type { MoneyEntry } from './money'

let id = 0
const e = (date: string, amount: number, note: string, income = false, category = 'other'): MoneyEntry => ({ id: String(id++), date, amount, note, income, category })

const entries: MoneyEntry[] = [
  e('2026-08-03', 1099, 'NETFLIX.COM', false, 'subscriptions'),
  e('2026-09-03', 1099, 'NETFLIX.COM', false, 'subscriptions'),
  e('2026-10-03', 1099, 'NETFLIX.COM', false, 'subscriptions'),
  e('2026-08-28', 150000, 'ACME LTD SALARY', true, 'pay'),
  e('2026-09-28', 150000, 'ACME LTD SALARY', true, 'pay'),
  e('2026-10-28', 152000, 'ACME LTD SALARY', true, 'pay'),
  e('2026-10-02', 450, 'Costa'),
  e('2026-10-20', 1200, 'Costa'),
  e('2026-09-10', 3000, 'Old gym'),
  e('2026-08-10', 3000, 'Old gym'),
  e('2026-10-10', 1000, 'Tesco'),
  e('2026-10-12', 2000, 'Tesco'),
  e('2026-10-14', 1500, 'Tesco')
]

describe('findRecurring', () => {
  const found = findRecurring(entries, '2026-10-31')
  it('finds monthly subscriptions and pay', () => {
    expect(found.map((r) => r.name)).toEqual(['NETFLIX.COM', 'ACME LTD SALARY'])
    expect(found[0]).toMatchObject({ interval: 'monthly', next: '2026-11-03', amount: 1099, income: false })
    expect(found[1]).toMatchObject({ income: true, next: '2026-11-28' })
  })
  it('leaves out stopped payments, irregular shops and ones you dismissed', () => {
    expect(found.some((r) => r.name === 'Old gym')).toBe(false)
    expect(found.some((r) => r.name === 'Tesco' || r.name === 'Costa')).toBe(false)
    expect(findRecurring(entries, '2026-10-31', ['netflix com']).map((r) => r.name)).toEqual(['ACME LTD SALARY'])
  })
  it('works out monthly cost and dates', () => {
    expect(monthlyCost({ amount: 500, interval: 'weekly' })).toBe(2167)
    expect(monthlyCost({ amount: 12000, interval: 'yearly' })).toBe(1000)
    expect(occurrences({ last: '2026-01-31', interval: 'monthly' }, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-28', '2026-04-28'])
  })
})

describe('forecastMonth', () => {
  it('adds bills and pay still due and the everyday pace', () => {
    const list = [...entries, e('2026-08-30', 999, 'Spotify'), e('2026-09-30', 999, 'Spotify')].filter((x) => x.date <= '2026-10-15')
    const recurring = findRecurring(list, '2026-10-15')
    const f = forecastMonth(list, recurring, '2026-10-15')
    expect(f.billsDue).toBe(999)
    expect(f.payDue).toBe(150000)
    expect(f.daysLeft).toBe(16)
    // Everyday so far: Costa 450 + Tesco 4500 = 4950 over 15 days → 330/day × 16.
    expect(f.everydayLeft).toBe(5280)
    expect(f.endOfMonth).toBe(150000 - (1099 + 4950) - 999 - 5280)
  })
})

describe('weeklyToGoal', () => {
  it('splits what is left over the weeks to go', () => {
    expect(weeklyToGoal({ target: 120000, saved: 20000, due: '2026-12-26' }, '2026-10-31')).toBe(12500)
    expect(weeklyToGoal({ target: 100, saved: 100, due: '2026-12-26' }, '2026-10-31')).toBeNull()
    expect(weeklyToGoal({ target: 100, saved: 0, due: '' }, '2026-10-31')).toBeNull()
  })
})
