import { describe, expect, it, vi } from 'vitest'
import { MERGE_MS, UndoHistory } from './undoHistory'
import { undoKey } from './undo'

/** A value with undo steps that set it back and forth. */
function counter(history: UndoHistory) {
  const state = { value: 0 }
  const set = (to: number, label = `set ${to}`, mergeKey?: string): void => {
    const from = state.value
    state.value = to
    history.record({ label, mergeKey, undo: () => void (state.value = from), redo: () => void (state.value = to) })
  }
  return { state, set }
}

describe('UndoHistory', () => {
  it('undoes and redoes in order', async () => {
    const h = new UndoHistory()
    const { state, set } = counter(h)
    set(1)
    set(2)
    expect(await h.undo()).toBe('set 2')
    expect(state.value).toBe(1)
    expect(await h.undo()).toBe('set 1')
    expect(state.value).toBe(0)
    expect(await h.undo()).toBeNull()
    expect(await h.redo()).toBe('set 1')
    expect(await h.redo()).toBe('set 2')
    expect(state.value).toBe(2)
  })

  it('a new change drops what could be redone', async () => {
    const h = new UndoHistory()
    const forget = vi.fn()
    h.record({ label: 'a', undo: () => {}, redo: () => {}, forget })
    await h.undo()
    h.record({ label: 'b', undo: () => {}, redo: () => {} })
    expect(h.canRedo).toBe(false)
    expect(forget).toHaveBeenCalledWith(false)
  })

  it('ignores changes made while undoing', async () => {
    const h = new UndoHistory()
    const { state, set } = counter(h)
    h.record({ label: 'outer', undo: () => set(5), redo: () => {} })
    await h.undo()
    expect(state.value).toBe(5)
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(true)
  })

  it('keeps only the newest steps, telling the oldest it has gone', () => {
    const h = new UndoHistory(2)
    const forget = vi.fn()
    h.record({ label: 'old', undo: () => {}, redo: () => {}, forget })
    h.record({ label: 'b', undo: () => {}, redo: () => {} })
    h.record({ label: 'c', undo: () => {}, redo: () => {} })
    expect(forget).toHaveBeenCalledWith(true)
  })

  it('merges quick changes with the same key (a dragged slider)', async () => {
    let now = 1000
    const h = new UndoHistory(100, () => now)
    const { state, set } = counter(h)
    set(1, 'size', 'prefs:size')
    now += 100
    set(2, 'size', 'prefs:size')
    now += 100
    set(3, 'size', 'prefs:size')
    await h.undo()
    expect(state.value).toBe(0)
    expect(h.canUndo).toBe(false)
    await h.redo()
    expect(state.value).toBe(3)
    // Later on, it's a new step.
    now += MERGE_MS + 1
    set(4, 'size', 'prefs:size')
    await h.undo()
    expect(state.value).toBe(3)
  })

  it('a failed undo is dropped and reported', async () => {
    const h = new UndoHistory()
    h.record({ label: 'ok', undo: () => {}, redo: () => {} })
    h.record({ label: 'bad', undo: () => Promise.reject(new Error('offline')), redo: () => {} })
    await expect(h.undo()).rejects.toThrow('offline')
    expect(h.canRedo).toBe(false)
    expect(await h.undo()).toBe('ok')
  })

  it('runs one undo at a time', async () => {
    const h = new UndoHistory()
    const order: string[] = []
    const slow = (name: string) => () => new Promise<void>((r) => setTimeout(() => (order.push(name), r()), name === 'a' ? 20 : 0))
    h.record({ label: 'a', undo: slow('a'), redo: () => {} })
    h.record({ label: 'b', undo: slow('b'), redo: () => {} })
    await Promise.all([h.undo(), h.undo()])
    expect(order).toEqual(['b', 'a'])
  })

  it('groups several changes into one step', async () => {
    const h = new UndoHistory()
    const { state, set } = counter(h)
    await h.group(
      (n) => `${n} changes`,
      async () => {
        set(1)
        await Promise.resolve()
        set(2)
      }
    )
    expect(h.nextUndo).toBe('2 changes')
    await h.undo()
    expect(state.value).toBe(0)
    await h.redo()
    expect(state.value).toBe(2)
  })
})

describe('undoKey', () => {
  const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
    key: k,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt
  })
  it('knows Windows keys', () => {
    expect(undoKey(key('z', { ctrl: true }), false)).toBe('undo')
    expect(undoKey(key('Z', { ctrl: true, shift: true }), false)).toBe('redo')
    expect(undoKey(key('y', { ctrl: true }), false)).toBe('redo')
    expect(undoKey(key('z', { ctrl: true, alt: true }), false)).toBeNull()
    expect(undoKey(key('z'), false)).toBeNull()
  })
  it('knows Mac keys', () => {
    expect(undoKey(key('z', { meta: true }), true)).toBe('undo')
    expect(undoKey(key('z', { meta: true, shift: true }), true)).toBe('redo')
    expect(undoKey(key('z', { ctrl: true }), true)).toBeNull()
    expect(undoKey(key('y', { meta: true }), true)).toBeNull()
  })
})
