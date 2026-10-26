import { describe, expect, it } from 'vitest'
import { equalize, isValidLayout, presetLayout, removeFromLayout, resizeSplit, splitLayout } from './layout'
import { paneOrder, type LayoutNode } from '../store/editor'

const pane = (id: string): LayoutNode => ({ type: 'pane', id })
const shape = (n: LayoutNode): unknown =>
  n.type === 'pane' ? n.id : { [n.dir]: n.children.map(shape), sizes: n.sizes.map((s) => Math.round(s * 100) / 100) }

describe('splitLayout', () => {
  it('splits a single pane to the right or below', () => {
    expect(shape(splitLayout(pane('a'), 'a', 'b', 'right'))).toEqual({ row: ['a', 'b'], sizes: [0.5, 0.5] })
    expect(shape(splitLayout(pane('a'), 'a', 'b', 'up'))).toEqual({ column: ['b', 'a'], sizes: [0.5, 0.5] })
  })

  it('adds a sibling instead of nesting when the direction matches', () => {
    const two = splitLayout(pane('a'), 'a', 'b', 'right')
    expect(shape(splitLayout(two, 'b', 'c', 'right'))).toEqual({ row: ['a', 'b', 'c'], sizes: [0.5, 0.25, 0.25] })
  })

  it('nests when the direction differs', () => {
    const two = splitLayout(pane('a'), 'a', 'b', 'right')
    expect(shape(splitLayout(two, 'b', 'c', 'down'))).toEqual({
      row: ['a', { column: ['b', 'c'], sizes: [0.5, 0.5] }],
      sizes: [0.5, 0.5]
    })
  })
})

describe('removeFromLayout', () => {
  it('gives the space to a neighbour and folds one-child splits', () => {
    const three = splitLayout(splitLayout(pane('a'), 'a', 'b', 'right'), 'b', 'c', 'right')
    expect(shape(removeFromLayout(three, 'b'))).toEqual({ row: ['a', 'c'], sizes: [0.75, 0.25] })
    expect(shape(removeFromLayout(three, 'a'))).toEqual({ row: ['b', 'c'], sizes: [0.75, 0.25] })
    expect(shape(removeFromLayout(splitLayout(pane('a'), 'a', 'b', 'down'), 'b'))).toEqual('a')
  })

  it('flattens a nested split that now runs the same way as its parent', () => {
    // a | (b over (c | d))  → remove b → a | c | d
    let l = splitLayout(pane('a'), 'a', 'b', 'right')
    l = splitLayout(l, 'b', 'c', 'down')
    l = splitLayout(l, 'c', 'd', 'right')
    expect(paneOrder(removeFromLayout(l, 'b'))).toEqual(['a', 'c', 'd'])
    expect((removeFromLayout(l, 'b') as { dir: string }).dir).toBe('row')
  })

  it('never removes the last pane', () => {
    expect(shape(removeFromLayout(pane('a'), 'a'))).toEqual('a')
  })
})

describe('resize, equalize, presets, validation', () => {
  it('resizes and normalises', () => {
    const two = splitLayout(pane('a'), 'a', 'b', 'right') as Extract<LayoutNode, { type: 'split' }>
    expect(shape(resizeSplit(two, two.id, [3, 1]))).toEqual({ row: ['a', 'b'], sizes: [0.75, 0.25] })
    expect(shape(equalize(resizeSplit(two, two.id, [3, 1])))).toEqual({ row: ['a', 'b'], sizes: [0.5, 0.5] })
  })

  it('builds presets in reading order', () => {
    expect(paneOrder(presetLayout('grid4', ['a', 'b', 'c', 'd']))).toEqual(['a', 'b', 'c', 'd'])
    expect(shape(presetLayout('rows2', ['a', 'b']))).toEqual({ column: ['a', 'b'], sizes: [0.5, 0.5] })
  })

  it('rejects saved layouts that reference missing panes or are malformed', () => {
    const l = presetLayout('columns2', ['a', 'b'])
    expect(isValidLayout(l, new Set(['a', 'b']))).toBe(true)
    expect(isValidLayout(l, new Set(['a']))).toBe(false)
    expect(isValidLayout({ type: 'split', dir: 'row', children: [pane('a')], sizes: [1] }, new Set(['a']))).toBe(false)
  })
})
