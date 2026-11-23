import { describe, expect, it } from 'vitest'
import { emptyMoney, readMoney, type MoneyData, type MoneyEntry } from './money'
import { budgetHistory, budgetMonth, budgetWarnings, carryInto, daysInMonth, limitFor, suggestBudget, withBudgetFrom } from './moneyBudget'

let n = 0
const spend = (date: string, amount: number, category = 'groceries'): MoneyEntry => ({ id: String(n++), date, amount, income: false, category, note: '' })

const data = (change: Partial<MoneyData> = {}): MoneyData => ({ ...emptyMoney(), ...change })

describe('limitFor', () => {
  it('uses the plain budget when there is no history', () => {
    const d = data({ budgets: { groceries: 20000 } })
    expect(limitFor(d, 'groceries', '2026-01')).toBe(20000)
    expect(limitFor(d, 'fun', '2026-01')).toBe(0)
  })

  it('keeps old months at the amount they had', () => {
    const d = data({ budgets: { groceries: 25000 } })
    d.budget.history = { groceries: withBudgetFrom(data({ budgets: { groceries: 20000 } }), 'groceries', 25000, '2026-11').groceries }
    expect(limitFor(d, 'groceries', '2026-10')).toBe(20000)
    expect(limitFor(d, 'groceries', '2026-11')).toBe(25000)
    expect(limitFor(d, 'groceries', '2027-03')).toBe(25000)
  })

  it('starts a brand new budget from its month only', () => {
    const d = data()
    d.budget.history = withBudgetFrom(d, 'fun', 5000, '2026-11')
    expect(limitFor(d, 'fun', '2026-10')).toBe(0)
    expect(limitFor(d, 'fun', '2026-11')).toBe(5000)
  })

  it('lets one month have its own amount', () => {
    const d = data({ budgets: { groceries: 20000 } })
    d.budget.months = { '2026-12': { groceries: 35000 } }
    expect(limitFor(d, 'groceries', '2026-12')).toBe(35000)
    expect(limitFor(d, 'groceries', '2027-01')).toBe(20000)
  })
})

describe('withBudgetFrom', () => {
  it('replaces later steps and drops ones that change nothing', () => {
    const d = data()
    d.budget.history = { fun: [['2026-01', 5000], ['2026-06', 8000], ['2026-09', 9000]] }
    expect(withBudgetFrom(d, 'fun', 6000, '2026-06').fun).toEqual([['2026-01', 5000], ['2026-06', 6000]])
    expect(withBudgetFrom(d, 'fun', 5000, '2026-06').fun).toEqual([['2026-01', 5000]])
    expect(withBudgetFrom(d, 'fun', 0, '2026-01').fun).toBeUndefined()
  })
})

describe('rollover', () => {
  it('carries leftover and overspending into later months', () => {
    const d = data({
      budgets: { groceries: 10000 },
      entries: [spend('2026-09-03', 8000), spend('2026-10-10', 13000)]
    })
    d.budget.rollover = { groceries: '2026-09' }
    expect(carryInto(d, d.entries, 'groceries', '2026-09')).toBe(0)
    // September: £20 left over
    expect(carryInto(d, d.entries, 'groceries', '2026-10')).toBe(2000)
    // October: £100 + £20 available, £130 spent: £10 overspent comes off November
    expect(carryInto(d, d.entries, 'groceries', '2026-11')).toBe(-1000)
  })

  it('is nothing when rollover is off (the budget starts fresh)', () => {
    const d = data({ budgets: { groceries: 10000 }, entries: [spend('2026-09-03', 1000)] })
    expect(carryInto(d, d.entries, 'groceries', '2026-10')).toBe(0)
  })

  it('skips months without a budget', () => {
    const d = data({ entries: [spend('2026-09-03', 5000)] })
    d.budget.history = { groceries: [['2026-10', 10000]] }
    d.budget.rollover = { groceries: '2026-08' }
    expect(carryInto(d, d.entries, 'groceries', '2026-11')).toBe(10000)
  })
})

describe('budgetMonth', () => {
  it('adds up budgets, spending and what is left, with warnings', () => {
    const d = data({
      budgets: { groceries: 10000, fun: 5000, transport: 4000 },
      entries: [spend('2026-11-02', 8500), spend('2026-11-05', 6000, 'fun'), spend('2026-11-06', 1500, 'shopping'), spend('2026-10-06', 99999, 'fun')]
    })
    const b = budgetMonth(d, '2026-11', '2026-11-30')
    const by = Object.fromEntries(b.rows.map((r) => [r.cat.id, r]))
    expect(by.groceries.state).toBe('near')
    expect(by.fun.state).toBe('over')
    expect(by.fun.left).toBe(-1000)
    expect(by.transport.state).toBe('ok')
    expect(b.available).toBe(19000)
    expect(b.spent).toBe(14500)
    expect(b.unbudgeted.map((u) => u.cat.id)).toEqual(['shopping'])
  })

  it('warns at the share you picked', () => {
    const d = data({ budgets: { groceries: 10000 }, entries: [spend('2026-11-02', 6000)] })
    expect(budgetMonth(d, '2026-11', '2026-11-20').rows[0].state).toBe('ok')
    d.budget.warnAt = 0.5
    expect(budgetMonth(d, '2026-11', '2026-11-20').rows[0].state).toBe('near')
  })

  it('works out the pace and what you can spend each day', () => {
    const d = data({ budgets: { groceries: 30000 }, entries: [spend('2026-11-02', 15000)] })
    const b = budgetMonth(d, '2026-11', '2026-11-10')
    const row = b.rows[0]
    expect(row.pace).toBeCloseTo(10 / 30)
    // £150 in 10 days is £450 by the end of a 30-day month
    expect(row.projected).toBe(45000)
    expect(row.ahead).toBe(true)
    expect(b.daysLeft).toBe(21)
    expect(b.perDay).toBe(Math.floor(15000 / 21))
    // Another month has no pace
    expect(budgetMonth(d, '2026-10', '2026-11-10').rows[0].pace).toBeUndefined()
  })

  it("doesn't call it fast in the first few days", () => {
    const d = data({ budgets: { groceries: 30000 }, entries: [spend('2026-11-01', 15000)] })
    expect(budgetMonth(d, '2026-11', '2026-11-02').rows[0].ahead).toBe(false)
  })

  it('counts spending in a deleted category under Other', () => {
    const d = data({ budgets: { other: 1000 }, entries: [spend('2026-11-01', 700, 'gone')] })
    expect(budgetMonth(d, '2026-11', '2026-11-02').rows[0].spent).toBe(700)
  })
})

describe('suggestBudget', () => {
  it('averages recent months with spending, rounded up to £5', () => {
    const entries = [spend('2026-10-01', 10000), spend('2026-09-01', 12000), spend('2026-07-01', 14100), spend('2026-11-01', 99999)]
    // (100 + 120 + 141) / 3 = 120.33 → £125
    expect(suggestBudget(entries, 'groceries', '2026-11')).toBe(12500)
    expect(suggestBudget(entries, 'fun', '2026-11')).toBe(0)
  })
})

describe('budgetHistory and budgetWarnings', () => {
  it('shows how each past month went', () => {
    const d = data({ budgets: { groceries: 10000 }, entries: [spend('2026-10-01', 12000), spend('2026-09-01', 9000)] })
    const cells = budgetHistory(d, 'groceries', '2026-11', 3)
    expect(cells.map((c) => c.state)).toEqual(['ok', 'near', 'over'])
  })

  it('names budgets that just got worse', () => {
    const d = data({ budgets: { groceries: 10000, fun: 1000 }, entries: [spend('2026-11-01', 7000)] })
    const before = budgetMonth(d, '2026-11', '2026-11-05')
    d.entries.push(spend('2026-11-05', 1500))
    const after = budgetMonth(d, '2026-11', '2026-11-05')
    expect(budgetWarnings(before, after).map((r) => [r.cat.id, r.state])).toEqual([['groceries', 'near']])
    expect(budgetWarnings(after, after)).toEqual([])
  })
})

describe('reading budget settings', () => {
  it('keeps good settings and drops damaged ones', () => {
    const read = readMoney(
      JSON.stringify({
        budgets: { groceries: 20000 },
        budget: {
          warnAt: 0.7,
          rollover: { groceries: '2026-09', bad: 'soon' },
          history: { groceries: [['2026-11', 25000], ['2026-01', 20000], ['nope', 5]], fun: 'x' },
          months: { '2026-12': { groceries: 30000, fun: -1 }, later: { groceries: 1 } }
        }
      })
    )
    expect(read.budget).toEqual({
      warnAt: 0.7,
      rollover: { groceries: '2026-09' },
      history: { groceries: [['2026-01', 20000], ['2026-11', 25000]] },
      months: { '2026-12': { groceries: 30000 } }
    })
    expect(readMoney('{}').budget.warnAt).toBe(0.8)
    expect(readMoney(JSON.stringify({ budget: { warnAt: 5 } })).budget.warnAt).toBe(0.8)
  })

  it('knows how long months are', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-11')).toBe(30)
  })
})
