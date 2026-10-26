import { describe, expect, it } from 'vitest'
import { NoteLookup, parseLinks } from './links'
import { buildGraph, neighbourhoodLayout, RING_1, RING_2, seedPosition, simulate, type Body } from './graph'

const notes = (files: Record<string, string>) => new Map(Object.entries(files).map(([p, t]) => [p, { links: parseLinks(t) }]))

const files = {
  'Hub.md': '[[A]] [[B]] [[C]] [[Missing]] [[Hub]]',
  'A.md': '[[Hub]] [[Far]]',
  'B.md': '',
  'C.md': '[[B]]',
  'Work/Far.md': '',
  'Lonely.md': ''
}

describe('buildGraph', () => {
  const g = buildGraph(notes(files), new NoteLookup(Object.keys(files)))
  it('links notes both ways, once, ignoring missing notes and self-links', () => {
    expect([...g.neighbours.get('Hub.md')!].sort()).toEqual(['A.md', 'B.md', 'C.md'])
    expect(g.edges).toHaveLength(5)
    expect(g.byId.get('B.md')!.degree).toBe(2)
    expect(g.byId.get('Lonely.md')!.degree).toBe(0)
  })
  it('groups notes by top-level folder', () => {
    expect(g.byId.get('Work/Far.md')!.group).toBe('Work')
    expect(g.byId.get('A.md')!.group).toBe('')
  })
})

describe('neighbourhoodLayout', () => {
  const g = buildGraph(notes(files), new NoteLookup(Object.keys(files)))
  it('puts the note in the middle and its links on a ring', () => {
    const placed = neighbourhoodLayout(g, 'Hub.md', 1)
    expect(placed[0]).toEqual({ id: 'Hub.md', x: 0, y: 0, ring: 0 })
    expect(placed.slice(1).map((p) => p.id)).toEqual(['A.md', 'B.md', 'C.md'])
    for (const p of placed.slice(1)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(RING_1)
  })
  it('adds the next step out on a wider ring with depth 2', () => {
    const placed = neighbourhoodLayout(g, 'Hub.md', 2)
    const far = placed.find((p) => p.id === 'Work/Far.md')!
    expect(far.ring).toBe(2)
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(RING_2)
    expect(placed.filter((p) => p.ring === 2)).toHaveLength(1)
  })
  it('handles a note with no links', () => {
    expect(neighbourhoodLayout(g, 'Lonely.md', 2)).toHaveLength(1)
  })
})

describe('simulate', () => {
  it('settles linked notes closer than unlinked ones', () => {
    const bodies: Body[] = ['a', 'b', 'c'].map((id) => ({ id, ...seedPosition(id, 200), vx: 0, vy: 0 }))
    for (let i = 0; i < 400; i++) simulate(bodies, [[0, 1]], 1)
    const d = (i: number, j: number) => Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y)
    expect(d(0, 1)).toBeLessThan(d(0, 2))
    expect(d(0, 1)).toBeLessThan(d(1, 2))
  })
  it('starts each note in the same place every time', () => {
    expect(seedPosition('Notes/Plan.md', 100)).toEqual(seedPosition('Notes/Plan.md', 100))
  })
})
