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

describe('budget lines', () => {
  beforeEach(async () => {
    await loadMoney()
    history.clear()
  })

  it('adds, changes and removes lines, and undoes each', async () => {
    const { addBudgetLines, updateBudgetLine, deleteBudgetLine } = await import('./money')
    const [netflix] = addBudgetLines([{ name: 'Netflix', amount: 1099, income: false, interval: 'monthly' }])
    updateBudgetLine(netflix.id, { amount: 1299 })
    expect(useMoney.getState().budgetLines[0].amount).toBe(1299)
    deleteBudgetLine(netflix.id)
    expect(useMoney.getState().budgetLines).toEqual([])
    expect(await history.undo()).toBe('Removed “Netflix” from your budget')
    await history.undo()
    expect(useMoney.getState().budgetLines[0].amount).toBe(1099)
    addBudgetLines([
      { name: 'Wages', amount: 200000, income: true, interval: 'monthly' },
      { name: 'Spotify', amount: 1199, income: false, interval: 'monthly' }
    ])
    expect(await history.undo()).toBe('Added 2 lines to your budget')
  })
})
