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
