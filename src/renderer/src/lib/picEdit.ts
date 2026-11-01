/**
 * The quick picture editor: crop, resize, arrows, blur and text on a picture from the notes folder.
 *
 * Nothing is changed until you save. An edit is the original picture plus a list of changes, all
 * measured in the original picture's pixels: the crop box, the marks (arrows, blurred boxes, text),
 * and the size the result is saved at. Kept free of the app so it can be tested.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Mark =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; size: number }
  | { kind: 'blur'; x: number; y: number; w: number; h: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }

export interface PicEdit {
  /** The original picture's size. */
  width: number
  height: number
  /** The part kept; null keeps it all. */
  crop: Rect | null
  /** The saved picture's width; its height follows the shape of the crop. Null keeps the cropped size. */
  outWidth: number | null
  marks: Mark[]
}

export const newEdit = (width: number, height: number): PicEdit => ({ width, height, crop: null, outWidth: null, marks: [] })

/** A box from two corners dragged in any direction. */
export function rectFrom(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** `r` kept inside the picture, in whole pixels. */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, Math.round(r.x)))
  const y = Math.max(0, Math.min(height, Math.round(r.y)))
  const right = Math.max(x, Math.min(width, Math.round(r.x + r.w)))
  const bottom = Math.max(y, Math.min(height, Math.round(r.y + r.h)))
  return { x, y, w: right - x, h: bottom - y }
}

/** The part of the picture that's kept. */
export const cropOf = (edit: PicEdit): Rect => edit.crop ?? { x: 0, y: 0, w: edit.width, h: edit.height }

/** The size the picture is saved at (at least 1 × 1). */
export function outputSize(edit: PicEdit): { width: number; height: number } {
  const c = cropOf(edit)
  const width = Math.max(1, Math.round(edit.outWidth ?? c.w))
  return { width, height: Math.max(1, Math.round((width * c.h) / Math.max(1, c.w))) }
}

/** The width that gives `height`, keeping the crop's shape. */
export function widthForHeight(edit: PicEdit, height: number): number {
  const c = cropOf(edit)
  return Math.max(1, Math.round((height * c.w) / Math.max(1, c.h)))
}

/** Biggest a saved picture can be on each side (browsers can't make bigger canvases reliably). */
export const MAX_SIDE = 8000

/** A new saved width, kept between 1 pixel and MAX_SIDE on both sides. Null if it's the cropped width. */
export function clampWidth(edit: PicEdit, width: number): number | null {
  const c = cropOf(edit)
  const byHeight = Math.floor((MAX_SIDE * c.w) / Math.max(1, c.h))
  const w = Math.max(1, Math.min(MAX_SIDE, byHeight, Math.round(width)))
  return w === c.w ? null : w
}

/** Too small to be a mark you meant (a click, not a drag). */
export const tooSmall = (r: Rect): boolean => r.w < 4 || r.h < 4

/**
 * The three corners of an arrow's head, at (x2, y2), sized to the line.
 */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [number, number][] {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.max(size * 4, 12)
  const spread = Math.PI / 7
  return [
    [x2, y2],
    [x2 - len * Math.cos(angle - spread), y2 - len * Math.sin(angle - spread)],
    [x2 - len * Math.cos(angle + spread), y2 - len * Math.sin(angle + spread)]
  ]
}

/** Where the shaft stops, so its square end doesn't poke out past the arrow's point. */
export function shaftEnd(x1: number, y1: number, x2: number, y2: number, size: number): [number, number] {
  const length = Math.hypot(x2 - x1, y2 - y1)
  if (length === 0) return [x2, y2]
  const back = Math.min(length, Math.max(size * 4, 12) * 0.8)
  return [x2 - ((x2 - x1) / length) * back, y2 - ((y2 - y1) / length) * back]
}

/**
 * How coarse a blurred box is: the picture under it is shrunk to blocks this many pixels across and
 * smoothed back out, so writing under it is gone (not just fuzzy) and can't be un-blurred.
 */
export const blurCell = (r: Pick<Rect, 'w' | 'h'>): number => Math.max(10, Math.min(80, Math.round(Math.min(r.w, r.h) / 4)))

/** The pen sizes, scaled to the picture so a mark looks the same on a phone photo or a small screenshot. */
export function markSizes(edit: Pick<PicEdit, 'width' | 'height'>): { arrow: number[]; text: number[] } {
  const scale = Math.max(0.5, Math.max(edit.width, edit.height) / 1600)
  const s = (n: number): number => Math.max(1, Math.round(n * scale))
  return { arrow: [s(3), s(6), s(10)], text: [s(24), s(40), s(64)] }
}

// ---------- the file ----------

export type PicType = 'image/png' | 'image/jpeg' | 'image/webp'

/** Pictures that can be saved over in place; others are saved as a .png copy. */
export function saveType(path: string): PicType | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return null
}

/** "Holiday.jpg" → "Holiday (edited).jpg"; pictures that can't be saved over become .png. */
export function editedName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = saveType(path) ? name.slice(dot + 1) : 'png'
  return `${base} (edited).${ext}`
}

/** The folder a picture is in ('' for the top of the notes folder). */
export const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** True if the edit changes anything. */
export const isChanged = (edit: PicEdit): boolean => edit.crop !== null || edit.outWidth !== null || edit.marks.length > 0
