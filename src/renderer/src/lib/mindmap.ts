import type { Heading } from './outline'

/** One bubble on a note's mind map: the note itself in the middle, or one of its headings. */
export interface MindNode {
  /** Stays the same while you edit around it: "root", or the heading's text plus which copy it is. */
  id: string
  text: string
  /** Where the heading is in the note (null for a root that isn't a heading). */
  from: number | null
  /** Which main branch it's on, for its colour (-1 for the middle). */
  branch: number
  depth: number
  children: MindNode[]
}

export interface Point {
  x: number
  y: number
}

/** Map units between columns, rows, and neighbouring main branches. */
const COLUMN_GAP = 56
const ROW = 46
const BRANCH_GAP = 18

/** About how wide a bubble is (they're capped, and long headings are cut short with "…"). */
function bubbleWidth(n: MindNode): number {
  return n.depth === 0 ? Math.min(240, n.text.length * 9 + 38) : Math.min(190, n.text.length * 7.2 + 27)
}

/**
 * The note's headings as a tree. Each heading hangs off the nearest bigger heading above it, and
 * the top ones off the middle bubble. A note with a single # heading at the top uses that as the
 * middle (it's usually the note's title); otherwise the middle is `title`.
 */
export function buildMindTree(title: string, headings: Heading[]): MindNode {
  const seen = new Map<string, number>()
  const idOf = (text: string): string => {
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    return n ? `${text}#${n + 1}` : text
  }

  let rest = headings
  const root: MindNode = { id: 'root', text: title, from: null, branch: -1, depth: 0, children: [] }
  if (headings[0]?.level === 1 && headings.filter((h) => h.level === 1).length === 1) {
    root.text = headings[0].text
    root.from = headings[0].from
    rest = headings.slice(1)
  }

  const stack: { level: number; node: MindNode }[] = [{ level: 0, node: root }]
  for (const h of rest) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop()
    const parent = stack[stack.length - 1].node
    const node: MindNode = {
      id: idOf(h.text),
      text: h.text,
      from: h.from,
      branch: parent === root ? root.children.length : parent.branch,
      depth: parent.depth + 1,
      children: []
    }
    parent.children.push(node)
    stack.push({ level: h.level, node })
  }
  return root
}

const leaves = (n: MindNode): number => (n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1)

/**
 * Where each bubble goes before you move any: the middle at 0,0, the main branches split between
 * its right and left (about the same amount on each side), and each branch's headings fanning out
 * in columns, a parent level with the middle of its children.
 */
export function layoutMindMap(root: MindNode): Map<string, Point> {
  const at = new Map<string, Point>([[root.id, { x: 0, y: 0 }]])
  const total = leaves(root)
  const right: MindNode[] = []
  const left: MindNode[] = []
  let weight = 0
  for (const c of root.children) {
    // Fill the right side first, then the rest go left, so the order still reads clockwise.
    if (right.length === 0 || weight + leaves(c) / 2 <= total / 2) {
      right.push(c)
      weight += leaves(c)
    } else {
      left.push(c)
    }
  }

  const placeSide = (branches: MindNode[], dir: 1 | -1): void => {
    // Each column is as wide as its widest bubble, so short headings sit closer together.
    const widest: number[] = [bubbleWidth(root)]
    const measure = (n: MindNode): void => {
      widest[n.depth] = Math.max(widest[n.depth] ?? 0, bubbleWidth(n))
      n.children.forEach(measure)
    }
    branches.forEach(measure)
    const columnX = [0]
    for (let d = 1; d < widest.length; d++) columnX[d] = columnX[d - 1] + widest[d - 1] / 2 + COLUMN_GAP + widest[d] / 2

    let y = 0
    const place = (n: MindNode): number => {
      let ny: number
      if (n.children.length === 0) {
        ny = y
        y += ROW
      } else {
        const ys = n.children.map(place)
        ny = (ys[0] + ys[ys.length - 1]) / 2
      }
      at.set(n.id, { x: dir * columnX[n.depth], y: ny })
      return ny
    }
    branches.forEach((b, i) => {
      if (i > 0) y += BRANCH_GAP
      place(b)
    })
    // Centre the side on the middle bubble.
    const shift = (y - ROW) / 2
    const move = (n: MindNode): void => {
      at.get(n.id)!.y -= shift
      n.children.forEach(move)
    }
    branches.forEach(move)
  }
  placeSide(right, 1)
  placeSide(left, -1)
  return at
}

/**
 * Final positions: the automatic ones, plus the moves you made. Moving a bubble carries its whole
 * branch with it, so a bubble's own move adds to its parents'.
 */
export function placeMindMap(root: MindNode, offsets: Record<string, Point>): Map<string, Point> {
  const base = layoutMindMap(root)
  const out = new Map<string, Point>()
  const walk = (n: MindNode, dx: number, dy: number): void => {
    const o = offsets[n.id]
    const ox = dx + (o?.x ?? 0)
    const oy = dy + (o?.y ?? 0)
    const p = base.get(n.id)!
    out.set(n.id, { x: p.x + ox, y: p.y + oy })
    n.children.forEach((c) => walk(c, ox, oy))
  }
  walk(root, 0, 0)
  return out
}

/** Every bubble, parents before their children. */
export function allNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = []
  const walk = (n: MindNode): void => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}
