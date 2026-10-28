import type { Side } from './layout'

/**
 * What's being dragged right now. (The browser doesn't let drop targets read drag data until
 * the drop, so targets look here to decide whether and how to highlight.)
 */
export type DragPayload =
  | { kind: 'tab'; pane: string; id: string }
  /** A note from the file tree, or (fromStarred) from the Starred list being reordered. */
  | { kind: 'note'; path: string; fromStarred?: boolean }
  /** A picture, recording or other file from the file tree: dropped into a note, it's embedded. */
  | { kind: 'file'; path: string }

let current: DragPayload | null = null

export const getDrag = (): DragPayload | null => current
export const setDrag = (payload: DragPayload | null): void => {
  current = payload
  // Web pages would swallow the drag (they're separate pages): see theme.css.
  document.body.classList.toggle('dragging', !!payload)
}

export type DropZone = Side | 'center'

/** Which part of a pane the pointer is over: an edge (split there) or the middle (open here). */
export function zoneAt(rect: DOMRect, x: number, y: number): DropZone {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const edge = 0.22
  // Pick the nearest edge if within the edge band.
  const distances: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['up', fy],
    ['down', 1 - fy]
  ]
  const [side, d] = distances.reduce((a, b) => (b[1] < a[1] ? b : a))
  return d < edge ? side : 'center'
}
