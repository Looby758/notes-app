import { describe, expect, it } from 'vitest'
import { allRecurring, chargedAfterCancelling, findRecurring, forecastMonth, monthlyCost, occurrences, weeklyToGoal } from './moneyInsights'
import { emptyMoney, readMoney, type MoneyEntry } from './money'

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
    expect(occurrences({ next: '2026-02-28', interval: 'monthly' }, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-28', '2026-04-28'])
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

describe('subscription finder fixes', () => {
  it('lists a subscription you have only paid once so far', () => {
    const found = findRecurring([...entries, e('2026-10-21', 999, 'NOW TV'), e('2026-10-22', 1250, 'Amazon Marketplace', false, 'shopping')], '2026-10-31')
    const now = found.find((r) => r.name === 'NOW TV')
    expect(now).toMatchObject({ fresh: true, interval: 'monthly', next: '2026-11-21', count: 1 })
    expect(found.some((r) => r.name === 'Amazon Marketplace')).toBe(false)
  })
  it('does not list a one-off subscription payment from long ago', () => {
    expect(findRecurring([e('2026-07-01', 999, 'NOWTV.COM')], '2026-10-31')).toEqual([])
  })
  it('keeps a subscription whose price went up after a cheap first month', () => {
    const list = [e('2026-08-15', 100, 'NOW TV'), e('2026-09-15', 999, 'NOW TV'), e('2026-10-15', 999, 'NOW TV')]
    expect(findRecurring(list, '2026-10-31')[0]).toMatchObject({ name: 'NOW TV', amount: 999, count: 3 })
  })

  const data = { ...emptyMoney(), entries }
  it('hides one you cancelled, and brings it back if it charges you again', () => {
    const cancelled = { 'netflix com': '2026-10-10' }
    expect(allRecurring({ ...data, cancelled }, '2026-10-31').some((r) => r.key === 'netflix com')).toBe(false)
    const again = [...entries, e('2026-11-03', 1099, 'NETFLIX.COM', false, 'subscriptions')]
    const back = allRecurring({ ...data, entries: again, cancelled }, '2026-11-05')
    expect(back.some((r) => r.key === 'netflix com')).toBe(true)
    expect(chargedAfterCancelling(back, cancelled).map((r) => r.key)).toEqual(['netflix com'])
  })
  it('adds ones you entered yourself, rolling the date on, and they win over a found one', () => {
    const subscriptions = [
      { id: 'a', name: 'NOW TV', amount: 999, interval: 'monthly' as const, date: '2026-09-21', category: 'subscriptions' },
      { id: 'b', name: 'Netflix.com', amount: 1299, interval: 'monthly' as const, date: '2026-11-03', category: 'subscriptions' }
    ]
    const all = allRecurring({ ...data, subscriptions }, '2026-10-31')
    expect(all.find((r) => r.manual === 'a')).toMatchObject({ last: '2026-10-21', next: '2026-11-21', amount: 999 })
    const netflix = all.filter((r) => r.key === 'netflix com')
    expect(netflix).toHaveLength(1)
    expect(netflix[0]).toMatchObject({ manual: 'b', amount: 1299, last: '' })
  })
  it('an edited found subscription replaces it, even under a new name, and survives a reload', () => {
    const subscriptions = [{ id: 'e', name: 'Netflix', amount: 1099, interval: 'monthly' as const, date: '2026-11-12', category: 'subscriptions', replaces: 'netflix com' }]
    const all = allRecurring({ ...data, subscriptions }, '2026-10-31')
    const netflix = all.filter((r) => r.key === 'netflix com')
    expect(netflix).toHaveLength(1)
    expect(netflix[0]).toMatchObject({ manual: 'e', edited: true, name: 'Netflix', next: '2026-11-12' })
    expect(readMoney(JSON.stringify({ subscriptions })).subscriptions[0].replaces).toBe('netflix com')
    // Taking the edit away brings the found one back.
    const found = allRecurring({ ...data, subscriptions: [] }, '2026-10-31').find((r) => r.key === 'netflix com')
    expect(found).toBeTruthy()
    expect(found!.manual).toBeUndefined()
  })
  it('reads and keeps the new fields', () => {
    const text = JSON.stringify({
      subscriptions: [{ id: 'a', name: 'NOW TV', amount: 999, interval: 'monthly', date: '2026-11-21', category: 'subscriptions' }, { id: 'bad', name: 'x', amount: -1, interval: 'monthly', date: '2026-11-21' }],
      cancelled: { 'old gym': '2026-10-01', broken: 5 },
      balance: { amount: -2500, date: '2026-10-30' }
    })
    const read = readMoney(text)
    expect(read.subscriptions.map((s) => s.id)).toEqual(['a'])
    expect(read.cancelled).toEqual({ 'old gym': '2026-10-01' })
    expect(read.balance).toEqual({ amount: -2500, date: '2026-10-30' })
    expect(readMoney('{}').balance).toBeNull()
  })
})

describe('forecast from your real balance', () => {
  it('starts from the balance you entered plus what happened since', () => {
    const list = entries.filter((x) => x.date <= '2026-10-15')
    const recurring = findRecurring(list, '2026-10-15')
    const plain = forecastMonth(list, recurring, '2026-10-15')
    const f = forecastMonth(list, recurring, '2026-10-15', { amount: 34000, date: '2026-10-11' })
    // Since the 11th: Tesco 2000 + 1500 out.
    expect(f.balanceNow).toBe(34000 - 3500)
    expect(f.endOfMonth).toBe(f.balanceNow! + plain.payDue - plain.billsDue - plain.everydayLeft)
    expect(plain.balanceNow).toBeUndefined()
  })
})
