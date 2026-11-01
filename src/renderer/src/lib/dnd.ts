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
  /** A file from the file explorer tab (its full path on the computer): dropped into a note, it's attached. */
  | { kind: 'computer'; path: string }
  /** Several items, or folders, from the file explorer tab: the notes tree takes them all, a note the files among them. */
  | { kind: 'computerMany'; paths: string[]; files: string[] }

let current: DragPayload | null = null

/** Full paths on the computer being dragged from the file explorer tab, if that's what's being dragged. */
export const computerPaths = (drag: DragPayload | null): string[] =>
  drag?.kind === 'computer' ? [drag.path] : drag?.kind === 'computerMany' ? drag.paths : []

/**
 * Notes, attachments and folders dragged from the notes tree in the sidebar (paths inside the
 * notes folder), so a Files tab can take them too. Set on dragstart, cleared on dragend.
 */
let fromTree: string[] = []
export const getTreeDrag = (): string[] => fromTree
export const setTreeDrag = (paths: string[]): void => void (fromTree = paths)

/** The files (not folders) being dragged from the file explorer tab, which a note can take. */
export const computerFiles = (drag: DragPayload | null): string[] =>
  drag?.kind === 'computer' ? [drag.path] : drag?.kind === 'computerMany' ? drag.files : []

export const getDrag = (): DragPayload | null => current
export const setDrag = (payload: DragPayload | null): void => {
  current = payload
  // Web pages would swallow the drag (they're separate pages): see theme.css. Files from the Files
  // tab are a real drag of files, though, so web pages (Discord, WhatsApp…) can take them.
  document.body.classList.toggle('dragging', !!payload)
  document.body.classList.toggle('dragging-files', computerPaths(payload).length > 0)
}

/**
 * Drags files from the file explorer tab out as real files, so they can be dropped into Discord,
 * a browser, File Explorer / Finder or any other app, as well as anywhere in Orbit that takes them.
 * Call from dragstart: it cancels the page's own drag and the computer runs one instead.
 *
 * That drag never sends dragend back here, so `payload` (what Orbit's own drop targets read) is
 * cleared once it's over: on a drop in this window, or when the mouse is next used without a
 * button held (it was let go somewhere else).
 */
export function dragFilesOut(e: { preventDefault(): void }, paths: string[], payload: DragPayload): void {
  e.preventDefault()
  setDrag(payload)
  window.api.explorerStartDrag(paths)
  const done = (): void => {
    window.removeEventListener('drop', onDrop, true)
    window.removeEventListener('mousemove', onMouse, true)
    window.removeEventListener('mousedown', onMouse, true)
    window.removeEventListener('blur', onBlur)
    if (current === payload) setDrag(null)
  }
  // After this drop's own handlers have read the payload.
  const onDrop = (): void => void setTimeout(done, 0)
  const onMouse = (m: MouseEvent): void => {
    if (m.buttons === 0 || m.type === 'mousedown') done()
  }
  // Dropped in another app, the window isn't the focused one any more: tidy up when it comes back.
  const onBlur = (): void => window.addEventListener('focus', done, { once: true })
  window.addEventListener('drop', onDrop, true)
  window.addEventListener('mousemove', onMouse, true)
  window.addEventListener('mousedown', onMouse, true)
  window.addEventListener('blur', onBlur)
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
