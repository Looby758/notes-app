import type { LayoutNode } from '../store/editor'

/** Where a new pane goes relative to an existing one. */
export type Side = 'left' | 'right' | 'up' | 'down'

export type Preset = 'single' | 'columns2' | 'columns3' | 'rows2' | 'grid4'

export const newId = (prefix: 'p' | 's'): string => `${prefix}_${Math.random().toString(36).slice(2, 9)}`

const dirFor = (side: Side): 'row' | 'column' => (side === 'left' || side === 'right' ? 'row' : 'column')
const before = (side: Side): boolean => side === 'left' || side === 'up'

/** Puts `newPane` next to `target`, halving the space `target` had. */
export function splitLayout(root: LayoutNode, target: string, newPane: string, side: Side): LayoutNode {
  const dir = dirFor(side)
  const fresh: LayoutNode = { type: 'pane', id: newPane }

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'pane') {
      if (node.id !== target) return node
      return {
        type: 'split',
        id: newId('s'),
        dir,
        children: before(side) ? [fresh, node] : [node, fresh],
        sizes: [0.5, 0.5]
      }
    }
    const i = node.children.findIndex((c) => c.type === 'pane' && c.id === target)
    if (i !== -1 && node.dir === dir) {
      // Same direction as this split: add a sibling instead of nesting another split.
      const half = node.sizes[i] / 2
      const children = [...node.children]
      const sizes = [...node.sizes]
      const at = before(side) ? i : i + 1
      children.splice(at, 0, fresh)
      sizes.splice(i, 1, half)
      sizes.splice(at, 0, half)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(visit) }
  }
  return visit(root)
}

/** Removes a pane; its space goes to its neighbour, and one-child splits fold away. Never removes the last pane. */
export function removeFromLayout(root: LayoutNode, paneId: string): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'pane') return node.id === paneId ? null : node
    const kept: LayoutNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, i) => {
      const next = visit(child)
      if (next) {
        kept.push(next)
        sizes.push(node.sizes[i])
      } else if (sizes.length) {
        sizes[sizes.length - 1] += node.sizes[i] // give the space to the previous sibling
      } else {
        sizes.push(-node.sizes[i]) // …or to the next one (settled below)
      }
    })
    if (kept.length === 0) return null
    // Settle space handed forward from a removed first child.
    const settled: number[] = []
    let carry = 0
    for (const s of sizes) {
      if (s < 0) carry += -s
      else {
        settled.push(s + carry)
        carry = 0
      }
    }
    if (kept.length === 1) return kept[0]
    return flatten({ ...node, children: kept, sizes: normalize(settled) })
  }
  return visit(root) ?? root
}

/** Merges a child split into its parent when they run the same way, so the tree stays shallow. */
function flatten(node: Extract<LayoutNode, { type: 'split' }>): LayoutNode {
  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    if (child.type === 'split' && child.dir === node.dir) {
      child.children.forEach((grand, j) => {
        children.push(grand)
        sizes.push(node.sizes[i] * child.sizes[j])
      })
    } else {
      children.push(child)
      sizes.push(node.sizes[i])
    }
  })
  return { ...node, children, sizes }
}

const normalize = (sizes: number[]): number[] => {
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  return sizes.map((s) => s / total)
}

export function resizeSplit(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'pane') return root
  if (root.id === splitId) return { ...root, sizes: normalize(sizes) }
  return { ...root, children: root.children.map((c) => resizeSplit(c, splitId, sizes)) }
}

export function equalize(root: LayoutNode): LayoutNode {
  if (root.type === 'pane') return root
  return { ...root, sizes: root.children.map(() => 1 / root.children.length), children: root.children.map(equalize) }
}

/** How many panes each preset has. */
export const PRESET_PANES: Record<Preset, number> = { single: 1, columns2: 2, columns3: 3, rows2: 2, grid4: 4 }

/** A fresh layout for a preset, using the given pane ids (as many as PRESET_PANES says). */
export function presetLayout(preset: Preset, ids: string[]): LayoutNode {
  const pane = (i: number): LayoutNode => ({ type: 'pane', id: ids[i] })
  const split = (dir: 'row' | 'column', children: LayoutNode[]): LayoutNode => ({
    type: 'split',
    id: newId('s'),
    dir,
    children,
    sizes: children.map(() => 1 / children.length)
  })
  switch (preset) {
    case 'single':
      return pane(0)
    case 'columns2':
      return split('row', [pane(0), pane(1)])
    case 'columns3':
      return split('row', [pane(0), pane(1), pane(2)])
    case 'rows2':
      return split('column', [pane(0), pane(1)])
    case 'grid4':
      return split('column', [split('row', [pane(0), pane(1)]), split('row', [pane(2), pane(3)])])
  }
}

/** Checks a saved layout: every pane in it must exist, and sizes must make sense. */
export function isValidLayout(node: unknown, paneIds: Set<string>): node is LayoutNode {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'pane') return typeof n.id === 'string' && paneIds.has(n.id)
  return (
    n.type === 'split' &&
    (n.dir === 'row' || n.dir === 'column') &&
    Array.isArray(n.children) &&
    Array.isArray(n.sizes) &&
    n.children.length >= 2 &&
    n.children.length === n.sizes.length &&
    (n.sizes as unknown[]).every((s) => typeof s === 'number' && s > 0) &&
    (n.children as unknown[]).every((c) => isValidLayout(c, paneIds))
  )
}
