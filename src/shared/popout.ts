/**
 * The pop-out window's sums (the window is main/popout.ts, the page is components/Popout): which
 * part of the app you cropped to, how to draw just that part, and how big the floating window
 * should be so the picture fits it without black bars.
 */

/** A part of the picture, as fractions of its width and height (0 to 1). The whole picture is FULL. */
export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: CropBox = { x: 0, y: 0, w: 1, h: 1 }

/** Smallest crop, as a fraction of the picture: anything smaller was a slip of the mouse. */
const MIN_CROP = 0.04

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export const isFull = (c: CropBox): boolean => c.x <= 0 && c.y <= 0 && c.w >= 1 && c.h >= 1

/**
 * The box you dragged from `a` to `b` (fractions of what's showing), any way round, kept inside the
 * picture. Null if it's too small to mean anything.
 */
export function cropFromDrag(a: { x: number; y: number }, b: { x: number; y: number }): CropBox | null {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1)
  const y1 = clamp(Math.min(a.y, b.y), 0, 1)
  const x2 = clamp(Math.max(a.x, b.x), 0, 1)
  const y2 = clamp(Math.max(a.y, b.y), 0, 1)
  if (x2 - x1 < MIN_CROP || y2 - y1 < MIN_CROP) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Cropping again while already cropped: `inner` is a part of what `outer` shows. */
export function composeCrop(outer: CropBox, inner: CropBox): CropBox {
  return { x: outer.x + inner.x * outer.w, y: outer.y + inner.y * outer.h, w: inner.w * outer.w, h: inner.h * outer.h }
}

/** Where to put the whole picture (as CSS percentages of the window) so only the cropped part shows. */
export function cropStyle(c: CropBox): { left: string; top: string; width: string; height: string } {
  const pct = (n: number): string => `${Math.round(n * 100000) / 1000}%`
  return { left: pct(-c.x / c.w), top: pct(-c.y / c.h), width: pct(1 / c.w), height: pct(1 / c.h) }
}

/** Width ÷ height of what shows: the picture's own shape, cut down to the crop. */
export function shownAspect(videoWidth: number, videoHeight: number, c: CropBox): number {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return 16 / 9
  return (videoWidth * c.w) / (videoHeight * c.h)
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The window's smallest side, in pixels. */
export const MIN_SIDE = 140

/**
 * The window's new size and place for a picture of shape `aspect`: about as big as it is now, the
 * same middle, no smaller than MIN_SIDE a side, no bigger than most of the screen, and on the screen.
 */
export function fitWindow(now: Rect, aspect: number, area: Rect): Rect {
  const a = Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 0.1, 10) : 16 / 9
  const size = Math.max(now.width * now.height, MIN_SIDE * MIN_SIDE)
  let width = Math.sqrt(size * a)
  let height = width / a
  // Too big for the screen: shrink to fit, keeping the shape.
  const shrink = Math.min(1, (area.width * 0.9) / width, (area.height * 0.9) / height)
  width *= shrink
  height *= shrink
  // Too thin: grow the short side to MIN_SIDE.
  const grow = Math.max(1, MIN_SIDE / width, MIN_SIDE / height)
  width = Math.round(width * grow)
  height = Math.round(height * grow)
  const cx = now.x + now.width / 2
  const cy = now.y + now.height / 2
  const x = Math.round(clamp(cx - width / 2, area.x, Math.max(area.x, area.x + area.width - width)))
  const y = Math.round(clamp(cy - height / 2, area.y, Math.max(area.y, area.y + area.height - height)))
  return { x, y, width, height }
}

/** See-through steps the window's button goes through. */
export const OPACITY_STEPS = [1, 0.85, 0.7, 0.5]

export function nextOpacity(now: number): number {
  const i = OPACITY_STEPS.findIndex((o) => Math.abs(o - now) < 0.01)
  return OPACITY_STEPS[(i + 1) % OPACITY_STEPS.length]
}
