import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { api: { writeAppData: vi.fn(async () => undefined), readAppData: vi.fn(async () => '{}') } })

const { useMoney, addEntry, deleteEntry, updateGoal, addGoal, loadMoney } = await import('./money')
const { history } = await import('../lib/undo')

describe('money and Ctrl+Z', () => {
  beforeEach(async () => {
    await loadMoney()
    history.clear()
  })

  it('undoes and redoes a deleted entry', async () => {
    addEntry({ date: '2026-11-01', amount: 500, note: 'Coffee', category: 'other', income: false } as never)
    const id = useMoney.getState().entries[0].id
    deleteEntry(id)
    expect(useMoney.getState().entries).toHaveLength(0)
    expect(await history.undo()).toBe('Deleted “Coffee”')
    expect(useMoney.getState().entries.map((e) => e.id)).toEqual([id])
    await history.redo()
    expect(useMoney.getState().entries).toHaveLength(0)
  })

  it('undoes typing a goal name in one go', async () => {
    const goal = addGoal({ name: 'Car', target: 1000 } as never)
    updateGoal(goal.id, { name: 'Car!' })
    updateGoal(goal.id, { name: 'Car!!' })
    await history.undo()
    expect(useMoney.getState().goals[0].name).toBe('Car')
  })

  it("won't undo onto a reloaded tracker", async () => {
    addEntry({ date: '2026-11-01', amount: 500, note: 'Tea', category: 'other', income: false } as never)
    await loadMoney()
    await expect(history.undo()).rejects.toThrow(/reloaded/)
  })
})

describe('accounts, net worth and IOUs', () => {
  beforeEach(async () => {
    await loadMoney()
    history.clear()
  })

  it('writes today’s net worth when an account changes, and undo puts both back', async () => {
    const { addAccount, updateAccount } = await import('./money')
    const acc = addAccount({ name: 'Savings', kind: 'savings', amount: 10000, date: '2026-11-01' })
    expect(useMoney.getState().netWorth.at(-1)?.total).toBe(10000)
    updateAccount(acc.id, { amount: 25000 })
    expect(useMoney.getState().netWorth.at(-1)?.total).toBe(25000)
    expect(useMoney.getState().netWorth).toHaveLength(1)
    await history.undo()
    expect(useMoney.getState().accounts[0].amount).toBe(10000)
    expect(useMoney.getState().netWorth.at(-1)?.total).toBe(10000)
  })

  it('pays back part of an IOU, then settles it, and undoes', async () => {
    const { addIous, payBackIou } = await import('./money')
    const [made] = addIous([{ person: 'Sam', amount: 1000, theyOwe: true, note: 'Takeaway', date: '2026-11-01', remind: '' }])
    payBackIou(made.id, 400)
    expect(useMoney.getState().ious[0]).toMatchObject({ paid: 400 })
    expect(useMoney.getState().ious[0].settled).toBeUndefined()
    payBackIou(made.id, 9999)
    expect(useMoney.getState().ious[0]).toMatchObject({ paid: 1000 })
    expect(useMoney.getState().ious[0].settled).toBeTruthy()
    expect(await history.undo()).toBe('Settled up with Sam')
    expect(useMoney.getState().ious[0].settled).toBeUndefined()
  })
})

describe('budgets', () => {
  beforeEach(async () => {
    await loadMoney()
    history.clear()
  })

  it('changes a budget from this month on, keeping earlier months, and undoes', async () => {
    const { setBudget } = await import('./money')
    const { limitFor } = await import('../lib/moneyBudget')
    const { addMonths, monthOf } = await import('../lib/money')
    const now = monthOf(new Date())
    setBudget('groceries', 20000, addMonths(now, -3))
    setBudget('groceries', 25000)
    const s = useMoney.getState()
    expect(s.budgets.groceries).toBe(25000)
    expect(limitFor(s, 'groceries', addMonths(now, -1))).toBe(20000)
    expect(limitFor(s, 'groceries', now)).toBe(25000)
    await history.undo()
    expect(useMoney.getState().budgets.groceries).toBe(20000)
    setBudget('groceries', 0)
    expect(useMoney.getState().budgets.groceries).toBeUndefined()
    expect(limitFor(useMoney.getState(), 'groceries', addMonths(now, -1))).toBe(20000)
  })

  it('sets one month on its own, rollover and suggested budgets as single steps', async () => {
    const { setBudgets, setMonthBudget, setRollover } = await import('./money')
    setBudgets({ groceries: 20000, fun: 5000 })
    expect(useMoney.getState().budgets).toEqual({ groceries: 20000, fun: 5000 })
    setMonthBudget('fun', '2030-12', 9000)
    expect(useMoney.getState().budget.months).toEqual({ '2030-12': { fun: 9000 } })
    setMonthBudget('fun', '2030-12', null)
    expect(useMoney.getState().budget.months).toEqual({})
    setRollover('groceries', '2026-10')
    expect(useMoney.getState().budget.rollover).toEqual({ groceries: '2026-10' })
    await history.undo()
    expect(useMoney.getState().budget.rollover).toEqual({})
    // Setting a month's amount and going back to the usual one a moment later undo together.
    await history.undo()
    expect(await history.undo()).toBe('Set 2 budgets')
    expect(useMoney.getState().budgets).toEqual({})
  })

  it('forgets a deleted category’s budget settings', async () => {
    const { addCategory, deleteCategory, setBudget, setRollover } = await import('./money')
    addCategory({ name: 'Pets', color: '#123456' })
    const id = useMoney.getState().categories.at(-1)!.id
    setBudget(id, 3000)
    setRollover(id, '2026-01')
    deleteCategory(id)
    const { budget, budgets } = useMoney.getState()
    expect(budgets[id]).toBeUndefined()
    expect(budget.history[id]).toBeUndefined()
    expect(budget.rollover[id]).toBeUndefined()
  })

  it('says when something you add takes a budget nearly to its limit', async () => {
    const { setBudget, addEntry } = await import('./money')
    const { useNotify } = await import('./notify')
    const { dayOf } = await import('../lib/money')
    setBudget('groceries', 10000)
    addEntry({ date: dayOf(new Date()), amount: 8500, note: 'Big shop', category: 'groceries', income: false })
    expect(useNotify.getState().message).toBe('Groceries: only £15.00 left this month')
    addEntry({ date: dayOf(new Date()), amount: 2000, note: 'More', category: 'groceries', income: false })
    expect(useNotify.getState().message).toBe('Groceries is £5.00 over budget')
  })
})
