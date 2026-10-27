import { isWithin, replacePrefix } from './paths'

/**
 * Canvas boards: an endless space of cards (notes, pictures, sketches, sticky notes) joined by
 * arrows. A board is a .canvas file in the notes folder, in the open JSON Canvas format
 * (https://jsoncanvas.org) that Obsidian uses too, so boards open there as well.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type End = 'none' | 'arrow'

interface CardBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** "1"–"6" (the format's preset colours) or a hex colour like "#ff8800". */
  color?: string
}

/** A sticky note: text typed straight onto the board. */
export interface TextCard extends CardBase {
  type: 'text'
  text: string
}

/** A note, picture, sketch or other file from the notes folder. */
export interface FileCard extends CardBase {
  type: 'file'
  file: string
}

/** A web link. */
export interface LinkCard extends CardBase {
  type: 'link'
  url: string
}

/** A labelled area that other cards sit in. */
export interface GroupCard extends CardBase {
  type: 'group'
  label?: string
}

export type Card = TextCard | FileCard | LinkCard | GroupCard

export interface Arrow {
  id: string
  fromNode: string
  fromSide?: Side
  /** Default 'none'. */
  fromEnd?: End
  toNode: string
  toSide?: Side
  /** Default 'arrow'. */
  toEnd?: End
  color?: string
  label?: string
}

export interface Board {
  nodes: Card[]
  edges: Arrow[]
}

export const emptyBoard = (): Board => ({ nodes: [], edges: [] })

/** The format's six preset colours, in its order (1 red … 6 purple). */
export const PRESET_COLOURS: Record<string, string> = {
  '1': '#e5484d',
  '2': '#f08c00',
  '3': '#e2b714',
  '4': '#2f9e5b',
  '5': '#1fa8c9',
  '6': '#8b7cf6'
}

/** A card's or arrow's colour as CSS, or null for the default. */
export function colourOf(color: string | undefined): string | null {
  if (!color) return null
  if (PRESET_COLOURS[color]) return PRESET_COLOURS[color]
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color : null
}

export const BOARD_EXTENSION = '.canvas'
export const isBoard = (path: string): boolean => path.toLowerCase().endsWith(BOARD_EXTENSION)
/** 'Projects/Plan.canvas' → 'Plan' */
export const boardTitle = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')

// ---------- the file ----------

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Reads a .canvas file. Anything unreadable is skipped rather than losing the whole board. */
export function parseBoard(text: string): Board {
  let data: { nodes?: unknown; edges?: unknown }
  try {
    data = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new Error('This board file is damaged, so it can’t be opened.')
  }
  const nodes: Card[] = []
  for (const raw of Array.isArray(data?.nodes) ? data.nodes : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue
    const base: CardBase = {
      id: raw.id,
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      width: Math.max(MIN_SIZE, num(raw.width, 250)),
      height: Math.max(MIN_SIZE, num(raw.height, 60)),
      ...(str(raw.color) ? { color: raw.color } : {})
    }
    // Keep any extra fields other apps wrote, so saving here doesn't lose them.
    const extra = { ...raw }
    if (raw.type === 'text') nodes.push({ ...extra, ...base, type: 'text', text: str(raw.text) ?? '' })
    else if (raw.type === 'file' && str(raw.file)) nodes.push({ ...extra, ...base, type: 'file', file: raw.file })
    else if (raw.type === 'link' && str(raw.url)) nodes.push({ ...extra, ...base, type: 'link', url: raw.url })
    else if (raw.type === 'group') nodes.push({ ...extra, ...base, type: 'group', ...(str(raw.label) ? { label: raw.label } : {}) })
  }
  const ids = new Set(nodes.map((n) => n.id))
  const edges: Arrow[] = []
  for (const raw of Array.isArray(data?.edges) ? data.edges : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue
    if (!ids.has(raw.fromNode) || !ids.has(raw.toNode)) continue
    const edge: Arrow = { ...raw, id: raw.id, fromNode: raw.fromNode, toNode: raw.toNode }
    for (const key of ['fromSide', 'toSide'] as const) if (!SIDES.includes(raw[key])) delete edge[key]
    for (const key of ['fromEnd', 'toEnd'] as const) if (raw[key] !== 'none' && raw[key] !== 'arrow') delete edge[key]
    if (!str(raw.label)) delete edge.label
    if (!str(raw.color)) delete edge.color
    edges.push(edge)
  }
  return { nodes, edges }
}

/** The board as a .canvas file (tab-indented, as Obsidian writes them). */
export function boardToText(board: Board): string {
  const round = (c: Card): Card => ({ ...c, x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) })
  return JSON.stringify({ nodes: board.nodes.map(round), edges: board.edges }, null, '\t') + '\n'
}

/** A random 16-character id, like the ones other canvas apps use. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- editing ----------

export const MIN_SIZE = 40

/** The board after a note or file moved from `from` to `to` (a folder moves everything in it); the same board if nothing pointed there. */
export function renameInBoard(board: Board, from: string, to: string): Board {
  let changed = false
  const nodes = board.nodes.map((n) => {
    if (n.type !== 'file' || !isWithin(n.file, from)) return n
    changed = true
    return { ...n, file: replacePrefix(n.file, from, to) }
  })
  return changed ? { ...board, nodes } : board
}

/** Removes cards (and every arrow touching them). */
export function removeCards(board: Board, ids: Set<string>): Board {
  return {
    nodes: board.nodes.filter((n) => !ids.has(n.id)),
    edges: board.edges.filter((e) => !ids.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode))
  }
}

/** Copies of these cards (and the arrows between them), nudged down and right. */
export function duplicateCards(board: Board, ids: Set<string>, offset = 30): { board: Board; added: string[] } {
  const map = new Map<string, string>()
  const copies = board.nodes.filter((n) => ids.has(n.id)).map((n) => {
    const id = newId()
    map.set(n.id, id)
    return { ...n, id, x: n.x + offset, y: n.y + offset }
  })
  const arrows = board.edges
    .filter((e) => map.has(e.fromNode) && map.has(e.toNode))
    .map((e) => ({ ...e, id: newId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }))
  return { board: { nodes: [...board.nodes, ...copies], edges: [...board.edges, ...arrows] }, added: copies.map((c) => c.id) }
}

/** Puts these cards on top of the others (later cards draw over earlier ones). Groups stay underneath. */
export function bringToFront(board: Board, ids: Set<string>): Board {
  const moving = board.nodes.filter((n) => ids.has(n.id))
  return { ...board, nodes: [...board.nodes.filter((n) => !ids.has(n.id)), ...moving] }
}

/** Cards that sit wholly inside a group (they move along with it). */
export function cardsInGroup(board: Board, group: Card): Card[] {
  return board.nodes.filter(
    (n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height
  )
}

// ---------- geometry ----------

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function sidePoint(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y }
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height }
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 }
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 }
  }
}

const OUTWARD: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

/** The side of `r` that faces `p` best. */
export function sideFacing(r: Rect, p: Point): Side {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const dx = (p.x - cx) / Math.max(1, r.width)
  const dy = (p.y - cy) / Math.max(1, r.height)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

/** An arrow's line as a curve (start, two bends, end), from its sides or the sides that face each other. */
export function arrowCurve(from: Rect, to: Rect | Point, fromSide?: Side, toSide?: Side): [Point, Point, Point, Point] {
  const toRect = 'width' in to ? to : null
  const fs = fromSide ?? sideFacing(from, toRect ? centre(toRect) : to)
  const a = sidePoint(from, fs)
  const ts = toRect ? (toSide ?? sideFacing(toRect, a)) : null
  const b = toRect && ts ? sidePoint(toRect, ts) : (to as Point)
  const reach = Math.max(40, Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) / 2.5))
  const c1 = { x: a.x + OUTWARD[fs].x * reach, y: a.y + OUTWARD[fs].y * reach }
  const c2 = ts ? { x: b.x + OUTWARD[ts].x * reach, y: b.y + OUTWARD[ts].y * reach } : b
  return [a, c1, c2, b]
}

/** A point part-way (t = 0…1) along a curve. */
export function curvePoint([a, b, c, d]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y
  }
}

/** The SVG path for a curve. */
export const curvePath = ([a, b, c, d]: [Point, Point, Point, Point]): string => `M${a.x} ${a.y}C${b.x} ${b.y} ${c.x} ${c.y} ${d.x} ${d.y}`

/** The direction a curve is heading at its end (for the arrowhead), as an angle in radians. */
export function endAngle([, b, c, d]: [Point, Point, Point, Point]): number {
  const from = c.x === d.x && c.y === d.y ? b : c
  return Math.atan2(d.y - from.y, d.x - from.x)
}

/** The direction a curve leaves its start, as an angle in radians (pointing back out of the line, for an arrowhead there). */
export function startAngle([a, b, c]: [Point, Point, Point, Point]): number {
  const to = a.x === b.x && a.y === b.y ? c : b
  return Math.atan2(a.y - to.y, a.x - to.x)
}

/** The smallest rectangle around every card, or null for an empty board. */
export function boundsOf(cards: Rect[]): Rect | null {
  if (cards.length === 0) return null
  const minX = Math.min(...cards.map((c) => c.x))
  const minY = Math.min(...cards.map((c) => c.y))
  const maxX = Math.max(...cards.map((c) => c.x + c.width))
  const maxY = Math.max(...cards.map((c) => c.y + c.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 3

export interface View {
  /** Board position at the top-left of the screen. */
  x: number
  y: number
  zoom: number
}

/** The view that shows all of `bounds` in a `width` × `height` window (never zooming in past 100%). */
export function fitView(bounds: Rect | null, width: number, height: number, padding = 60): View {
  if (!bounds) return { x: -width / 2, y: -height / 2, zoom: 1 }
  const zoom = Math.max(MIN_ZOOM, Math.min(1, (width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height))
  return { x: bounds.x + bounds.width / 2 - width / 2 / zoom, y: bounds.y + bounds.height / 2 - height / 2 / zoom, zoom }
}

/** Zooms by `factor` keeping the board point under the screen point (sx, sy) in place. */
export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor))
  const bx = view.x + sx / view.zoom
  const by = view.y + sy / view.zoom
  return { x: bx - sx / zoom, y: by - sy / zoom, zoom }
}

/** A short plain-text preview of a note: its text without frontmatter and markdown symbols. */
export function notePreview(text: string, max = 400, title?: string): string {
  let body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
  // A first heading that just repeats the note's name (already shown above the preview).
  const first = /^\s*#\s+(.+)\n?/.exec(body)
  if (first && title && first[1].trim().toLowerCase() === title.toLowerCase()) body = body.slice(first[0].length)
  const plain = body
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?(\[![^\]]*\]\s*)?/, '')
        .replace(/^\s*[-*+]\s+\[( |x|X)\]\s+/, (_m, done) => (done === ' ' ? '☐ ' : '☑ '))
        .replace(/^\s*[-*+]\s+/, '• ')
        .replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[\[([^\]|#]+)(#[^\]|]*)?\|([^\]]+)\]\]/g, '$3')
        .replace(/\[\[([^\]|#]+)(#[^\]|]*)?\]\]/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|==|`)/g, '')
    )
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
    .join('\n')
    .trim()
  return plain.length > max ? plain.slice(0, max).trimEnd() + '…' : plain
}
