import type { NoteLookup, LinkRef } from './links'
import { noteTitle } from './paths'

/**
 * The graph of how notes link to each other, and the two ways of laying it out:
 * - neighbourhood: one note in the middle, the notes it links with around it in rings;
 * - constellation: every note at once, pulled together by its links (a small force simulation).
 */

export interface GraphNode {
  id: string
  title: string
  /** Top-level folder ('' for the vault root); used for colour. */
  group: string
  /** How many other notes it's linked with (either direction). */
  degree: number
}

export interface Graph {
  nodes: GraphNode[]
  byId: Map<string, GraphNode>
  /** Undirected neighbours. */
  neighbours: Map<string, Set<string>>
  edges: [string, string][]
}

export function buildGraph(notes: Map<string, { links: Pick<LinkRef, 'kind' | 'target'>[] }>, lookup: NoteLookup): Graph {
  const neighbours = new Map<string, Set<string>>()
  for (const path of notes.keys()) neighbours.set(path, new Set())
  const edges: [string, string][] = []
  for (const [source, { links }] of notes) {
    for (const link of links) {
      const target = lookup.resolve(link, source)
      if (!target || target === source || !neighbours.has(target)) continue
      if (neighbours.get(source)!.has(target)) continue
      neighbours.get(source)!.add(target)
      neighbours.get(target)!.add(source)
      edges.push(source < target ? [source, target] : [target, source])
    }
  }
  const nodes = [...notes.keys()].sort().map((id) => ({
    id,
    title: noteTitle(id),
    group: id.includes('/') ? id.slice(0, id.indexOf('/')) : '',
    degree: neighbours.get(id)!.size
  }))
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), neighbours, edges }
}

// ---------- neighbourhood ----------

export interface Placed {
  id: string
  x: number
  y: number
  /** 0 = the centre, 1 = linked with it, 2 = two steps away. */
  ring: 0 | 1 | 2
}

export const RING_1 = 190
export const RING_2 = 340

/**
 * Places `centre` in the middle, the notes linked with it evenly on a ring, and (with depth 2)
 * the notes one step further out on a wider ring, each near the note that connects it.
 */
export function neighbourhoodLayout(graph: Graph, centre: string, depth: 1 | 2): Placed[] {
  const first = [...(graph.neighbours.get(centre) ?? [])].sort((a, b) => graph.byId.get(a)!.title.localeCompare(graph.byId.get(b)!.title))
  const placed: Placed[] = [{ id: centre, x: 0, y: 0, ring: 0 }]
  const angleOf = new Map<string, number>()
  first.forEach((id, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, first.length)) * Math.PI * 2
    angleOf.set(id, a)
    placed.push({ id, x: Math.cos(a) * RING_1, y: Math.sin(a) * RING_1, ring: 1 })
  })
  if (depth === 2 && first.length) {
    const seen = new Set([centre, ...first])
    // Each second-step note sits by the first ring-1 note (alphabetically) that connects to it.
    const outer: { id: string; angle: number }[] = []
    for (const via of first) {
      for (const id of [...graph.neighbours.get(via)!].sort()) {
        if (seen.has(id)) continue
        seen.add(id)
        outer.push({ id, angle: angleOf.get(via)! })
      }
    }
    // Fan each group out around its linking note; if they'd crowd, space everyone evenly instead.
    const slot = (Math.PI * 2) / first.length
    const groups = new Map<number, string[]>()
    for (const { id, angle } of outer) groups.set(angle, [...(groups.get(angle) ?? []), id])
    const gap = Math.min(0.32, ...[...groups.values()].map((ids) => (slot * 0.85) / ids.length))
    const crowded = gap < 0.09
    if (crowded) {
      outer.sort((a, b) => a.angle - b.angle)
      const step = (Math.PI * 2) / outer.length
      outer.forEach(({ id }, i) => {
        const a = outer[0].angle + i * step
        placed.push({ id, x: Math.cos(a) * RING_2, y: Math.sin(a) * RING_2, ring: 2 })
      })
    } else {
      for (const [angle, ids] of groups) {
        ids.forEach((id, j) => {
          const a = angle + (j - (ids.length - 1) / 2) * gap
          placed.push({ id, x: Math.cos(a) * RING_2, y: Math.sin(a) * RING_2, ring: 2 })
        })
      }
    }
  }
  return placed
}

// ---------- constellation (force layout) ----------

export interface Body {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Held in place (being dragged). */
  fixed?: boolean
}

/** A stable starting spot for a note, so the picture doesn't reshuffle every time. */
export function seedPosition(id: string, spread: number): { x: number; y: number } {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2
  const r = (((h >>> 12) % 1000) / 1000) ** 0.5 * spread
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}

/**
 * One step of the simulation: notes push each other apart, links pull them together, and a gentle
 * pull keeps everything near the middle. Returns how much things moved (to know when to stop).
 */
export function simulate(bodies: Body[], edges: [number, number][], alpha: number): number {
  const n = bodies.length
  const REPEL = 2600
  const SPRING = 0.05
  const LENGTH = 70
  const GRAVITY = 0.012
  for (let i = 0; i < n; i++) {
    const a = bodies[i]
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) {
        dx = (i - j) * 0.1
        dy = 0.1
        d2 = dx * dx + dy * dy
      }
      if (d2 > 250000) continue // far apart: ignore
      const f = (REPEL / d2) * alpha
      const d = Math.sqrt(d2)
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
  }
  for (const [i, j] of edges) {
    const a = bodies[i]
    const b = bodies[j]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const f = (d - LENGTH) * SPRING * alpha
    a.vx += (dx / d) * f
    a.vy += (dy / d) * f
    b.vx -= (dx / d) * f
    b.vy -= (dy / d) * f
  }
  let moved = 0
  for (const b of bodies) {
    b.vx -= b.x * GRAVITY * alpha
    b.vy -= b.y * GRAVITY * alpha
    b.vx *= 0.6
    b.vy *= 0.6
    if (b.fixed) {
      b.vx = 0
      b.vy = 0
      continue
    }
    b.x += b.vx
    b.y += b.vy
    moved += Math.abs(b.vx) + Math.abs(b.vy)
  }
  return moved / Math.max(1, n)
}
