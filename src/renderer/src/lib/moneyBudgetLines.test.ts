import { describe, expect, it } from 'vitest'
import { budgetTotals, lineMonthly, readMoney, type BudgetLine } from './money'

const line = (name: string, amount: number, income = false, interval: BudgetLine['interval'] = 'monthly'): BudgetLine => ({ id: name, name, amount, income, interval })

describe('budget lines', () => {
  it('turns weekly and yearly amounts into monthly ones', () => {
    expect(lineMonthly(line('Rent', 60000))).toBe(60000)
    expect(lineMonthly(line('Lunch', 1000, false, 'weekly'))).toBe(4333)
    expect(lineMonthly(line('Amazon Prime', 9500, false, 'yearly'))).toBe(792)
  })

  it('adds up what comes in, goes out and is left over', () => {
    const t = budgetTotals([line('Wages', 210000, true), line('Rent', 60000), line('Netflix', 1099), line('Gym', 1200, false, 'weekly')])
    expect(t).toEqual({ income: 210000, out: 60000 + 1099 + 5200, left: 210000 - 66299 })
    expect(budgetTotals([line('Rent', 60000)]).left).toBe(-60000)
    expect(budgetTotals([])).toEqual({ income: 0, out: 0, left: 0 })
  })

  it('reads budget lines, mending damaged ones', () => {
    const data = readMoney(
      JSON.stringify({
        budgetLines: [
          { id: 'a', name: 'Netflix', amount: 1099, interval: 'monthly' },
          { id: 'b', name: 'Wages', amount: -210000, income: true, interval: 'fortnightly' },
          { id: 'c', name: 'Broken' },
          null
        ]
      })
    )
    expect(data.budgetLines).toEqual([
      { id: 'a', name: 'Netflix', amount: 1099, income: false, interval: 'monthly' },
      { id: 'b', name: 'Wages', amount: 210000, income: true, interval: 'monthly' }
    ])
    expect(readMoney('{}').budgetLines).toEqual([])
  })
})
