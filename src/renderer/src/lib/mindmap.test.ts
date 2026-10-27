import { describe, expect, it } from 'vitest'
import { extractHeadings } from './outline'
import { allNodes, buildMindTree, layoutMindMap, placeMindMap } from './mindmap'

const tree = (text: string) => buildMindTree('My note', extractHeadings(text))

describe('buildMindTree', () => {
  it('hangs each heading off the nearest bigger one above it', () => {
    const root = tree('## Goals\n### Ship\n### Grow\n## Risks\n#### Deep\n## Ideas')
    expect(root.text).toBe('My note')
    expect(root.children.map((c) => c.text)).toEqual(['Goals', 'Risks', 'Ideas'])
    expect(root.children[0].children.map((c) => c.text)).toEqual(['Ship', 'Grow'])
    expect(root.children[1].children.map((c) => c.text)).toEqual(['Deep'])
    expect(root.children[0].children[1].branch).toBe(0)
    expect(root.children[2].branch).toBe(2)
  })

  it('uses a single # heading at the top as the middle', () => {
    const root = tree('# Trip plan\n## Flights\n## Hotel')
    expect(root.text).toBe('Trip plan')
    expect(root.from).toBe(0)
    expect(root.children.map((c) => c.text)).toEqual(['Flights', 'Hotel'])
  })

  it('keeps several # headings as branches', () => {
    const root = tree('# One\n## A\n# Two')
    expect(root.text).toBe('My note')
    expect(root.children.map((c) => c.text)).toEqual(['One', 'Two'])
  })

  it('gives repeated headings different ids', () => {
    const root = tree('## Notes\n### Todo\n## More\n### Todo')
    expect(allNodes(root).map((n) => n.id)).toEqual(['root', 'Notes', 'Todo', 'More', 'Todo#2'])
  })
})

describe('layoutMindMap', () => {
  it('puts branches on both sides, children further out than parents', () => {
    const root = tree('## A\n### A1\n### A2\n## B\n## C\n### C1\n### C2')
    const at = layoutMindMap(root)
    expect(at.get('root')).toEqual({ x: 0, y: 0 })
    expect(at.get('A')!.x).toBeGreaterThan(0)
    expect(at.get('C')!.x).toBeLessThan(0)
    expect(at.get('A1')!.x).toBeGreaterThan(at.get('A')!.x)
    expect(at.get('A')!.y).toBe((at.get('A1')!.y + at.get('A2')!.y) / 2)
    // No two bubbles in the same spot.
    const spots = new Set([...at.values()].map((p) => `${p.x},${p.y}`))
    expect(spots.size).toBe(at.size)
  })
})

describe('placeMindMap', () => {
  it('moves a bubble together with its branch', () => {
    const root = tree('## A\n### A1\n## B')
    const before = layoutMindMap(root)
    const after = placeMindMap(root, { A: { x: 10, y: -5 }, A1: { x: 1, y: 1 } })
    expect(after.get('A')).toEqual({ x: before.get('A')!.x + 10, y: before.get('A')!.y - 5 })
    expect(after.get('A1')).toEqual({ x: before.get('A1')!.x + 11, y: before.get('A1')!.y - 4 })
    expect(after.get('B')).toEqual(before.get('B'))
  })
})
