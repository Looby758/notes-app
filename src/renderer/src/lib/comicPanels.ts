/**
 * Finding the panels on a comic page, for panel zoom: the page is cut along its gutters (the
 * plain strips between panels), across first and then down, again and again, the way you'd cut it
 * up with scissors. That gives the panels in reading order: top to bottom, and left to right
 * (right to left for manga). Pages without clear gutters (a splash page, art that bleeds into the
 * gutters) come back as nothing, and zoom just shows the whole page.
 */

export interface Panel {
  /** Fractions of the page, 0–1. */
  x: number
  y: number
  w: number
  h: number
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The page's paper colour: the usual brightness round its edge. */
function paperOf(gray: Uint8Array, w: number, h: number): number {
  const counts = new Array(256).fill(0)
  for (let x = 0; x < w; x++) {
    counts[gray[x]]++
    counts[gray[(h - 1) * w + x]]++
  }
  for (let y = 0; y < h; y++) {
    counts[gray[y * w]]++
    counts[gray[y * w + w - 1]]++
  }
  // The most common brightness, give or take a little (so off-white paper counts as one colour).
  let best = 255
  let bestCount = -1
  for (let v = 0; v < 256; v++) {
    let c = 0
    for (let d = -6; d <= 6; d++) c += counts[v + d] ?? 0
    if (c > bestCount) (bestCount = c), (best = v)
  }
  return best
}

/**
 * The panels on a page, from a small greyscale copy of it (`gray`: one brightness 0–255 per
 * pixel, row by row). [] when it doesn't have at least two clear panels.
 */
export function findPanels(gray: Uint8Array, w: number, h: number, rtl = false): Panel[] {
  if (w < 16 || h < 16) return []
  const paper = paperOf(gray, w, h)
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = Math.abs(gray[i] - paper) > 40 ? 1 : 0

  const out: Box[] = []
  const minGapY = Math.max(2, Math.round(h * 0.006))
  const minGapX = Math.max(2, Math.round(w * 0.006))

  /** Shrinks a box to the ink inside it; null when there's hardly any. */
  const trim = (b: Box): Box | null => {
    let { x0, y0, x1, y1 } = b
    const rowInk = (y: number): number => {
      let n = 0
      for (let x = x0; x < x1; x++) n += ink[y * w + x]
      return n
    }
    const colInk = (x: number): number => {
      let n = 0
      for (let y = y0; y < y1; y++) n += ink[y * w + x]
      return n
    }
    while (y0 < y1 && rowInk(y0) <= (x1 - x0) * 0.01) y0++
    while (y1 > y0 && rowInk(y1 - 1) <= (x1 - x0) * 0.01) y1--
    while (x0 < x1 && colInk(x0) <= (y1 - y0) * 0.01) x0++
    while (x1 > x0 && colInk(x1 - 1) <= (y1 - y0) * 0.01) x1--
    return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, x1, y1 } : null
  }

  /** Splits a box at its gutters, across (`rows`) or down. */
  const split = (b: Box, rows: boolean): Box[] => {
    const len = rows ? b.y1 - b.y0 : b.x1 - b.x0
    const across = rows ? b.x1 - b.x0 : b.y1 - b.y0
    const minGap = rows ? minGapY : minGapX
    const empty: boolean[] = []
    for (let i = 0; i < len; i++) {
      let n = 0
      for (let j = 0; j < across; j++) n += rows ? ink[(b.y0 + i) * w + b.x0 + j] : ink[(b.y0 + j) * w + b.x0 + i]
      empty.push(n <= Math.max(1, across * 0.005))
    }
    const parts: Box[] = []
    let start = 0
    let i = 0
    while (i < len) {
      if (!empty[i]) {
        i++
        continue
      }
      let j = i
      while (j < len && empty[j]) j++
      if (j - i >= minGap && i > start) {
        parts.push(rows ? { ...b, y0: b.y0 + start, y1: b.y0 + i } : { ...b, x0: b.x0 + start, x1: b.x0 + i })
        start = j
      }
      i = j
    }
    if (start < len) parts.push(rows ? { ...b, y0: b.y0 + start } : { ...b, x0: b.x0 + start })
    return parts
  }

  /** A box with a drawn frame all round is one panel, however much white is inside it. */
  const framed = (b: Box): boolean => {
    const line = (count: number, at: (i: number) => number): boolean => {
      let n = 0
      for (let i = 0; i < count; i++) n += at(i)
      return n >= count * 0.98
    }
    const bw = b.x1 - b.x0
    const bh = b.y1 - b.y0
    // The frame can be a pixel or two in from the edge after shrinking the copy.
    const edge = (d: number): boolean =>
      line(bw, (i) => ink[(b.y0 + d) * w + b.x0 + i]) &&
      line(bw, (i) => ink[(b.y1 - 1 - d) * w + b.x0 + i]) &&
      line(bh, (i) => ink[(b.y0 + i) * w + b.x0 + d]) &&
      line(bh, (i) => ink[(b.y0 + i) * w + b.x1 - 1 - d])
    return bw > 6 && bh > 6 && (edge(0) || edge(1) || edge(2))
  }

  const cut = (b: Box, depth: number): void => {
    const t = trim(b)
    if (!t) return
    if (depth < 8 && !(depth > 0 && framed(t))) {
      const bands = split(t, true)
      if (bands.length > 1) return bands.forEach((band) => cut(band, depth + 1))
      const cols = split(t, false)
      if (cols.length > 1) return (rtl ? cols.reverse() : cols).forEach((col) => cut(col, depth + 1))
    }
    out.push(t)
  }
  cut({ x0: 0, y0: 0, x1: w, y1: h }, 0)

  // Specks (a page number, a stray mark) aren't panels.
  const panels = out.filter((b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= w * h * 0.02 && b.x1 - b.x0 >= w * 0.08 && b.y1 - b.y0 >= h * 0.05)
  if (panels.length < 2) return []
  return panels.map((b) => ({ x: b.x0 / w, y: b.y0 / h, w: (b.x1 - b.x0) / w, h: (b.y1 - b.y0) / h }))
}

/** A small greyscale copy of a loaded picture, for findPanels. */
export function grayOf(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, maxSide = 500): { gray: Uint8Array; w: number; h: number } | null {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const gray = new Uint8Array(w * h)
    for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
    return { gray, w, h }
  } catch {
    return null
  }
}

/** Where to move and how much to scale a page shown `dw` × `dh` (top-left at bx, by) in a stage `sw` × `sh`, so a panel fills it. */
export function zoomTo(p: Panel, dw: number, dh: number, bx: number, by: number, sw: number, sh: number): { tx: number; ty: number; k: number } {
  const k = Math.min(sw / (p.w * dw), sh / (p.h * dh)) * 0.94
  const cx = (p.x + p.w / 2) * dw
  const cy = (p.y + p.h / 2) * dh
  return { tx: sw / 2 - bx - k * cx, ty: sh / 2 - by - k * cy, k }
}

/** Comic lettering is in capitals; this makes it read like ordinary sentences. */
export function sentenceCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^\s*|[.!?…]\s+)([a-z])/g, (_m, before: string, c: string) => before + c.toUpperCase())
    .replace(/\bi\b/g, 'I')
}

/** Joins the lines of a speech bubble back into one, keeping words broken with a hyphen whole. */
export function joinBubbleLines(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.replace(/-\n(?=[a-z])/gi, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
