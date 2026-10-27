import { create } from 'zustand'
import { formatDate } from './dates'

/**
 * Sketch notes: drawings saved as .svg pictures in the attachments folder. The strokes are kept
 * inside the picture too (in its <metadata>), so a sketch can be opened again and added to,
 * while any other app still sees an ordinary picture.
 */

export type SketchTool = 'pen' | 'highlighter'
export type SketchPaper = 'plain' | 'grid' | 'lined'

export interface Stroke {
  tool: SketchTool
  color: string
  /** Line width at full pressure. */
  size: number
  /** x, y, pressure (0–1), x, y, pressure… */
  points: number[]
}

export interface Sketch {
  width: number
  height: number
  paper: SketchPaper
  strokes: Stroke[]
}

export const SKETCH_WIDTH = 1600
export const SKETCH_HEIGHT = 1000
export const PAPER_COLOUR = '#ffffff'
const PAPER_SPACING = 40
const GRID_COLOUR = '#e4e7ee'
const LINE_COLOUR = '#d6deeb'
const MARGIN_COLOUR = '#f4b4b4'
const HIGHLIGHTER_OPACITY = 0.35
const METADATA_ID = 'notes-sketch'

export const emptySketch = (paper: SketchPaper = 'plain'): Sketch => ({ width: SKETCH_WIDTH, height: SKETCH_HEIGHT, paper, strokes: [] })

/** "Sketch 2026-10-27 14-05-09.svg" */
export const sketchFileName = (now = new Date()): string => `Sketch ${formatDate(now, 'YYYY-MM-DD HH-mm-ss')}.svg`

/** Sketches made here are named "Sketch …"; used to offer Edit on pictures in a note. */
export const looksLikeSketch = (path: string): boolean => /(^|\/)sketch[^/]*\.svg$/i.test(path)

// ---------- drawing a stroke ----------

const round = (n: number): number => Math.round(n * 10) / 10

/** How wide the line is at a point: pens follow pressure, highlighters don't. */
function widthAt(stroke: Stroke, pressure: number): number {
  if (stroke.tool === 'highlighter') return stroke.size
  return stroke.size * (0.35 + 0.65 * Math.max(0, Math.min(1, pressure)))
}

/**
 * The outline of a stroke as an SVG path (filled, not stroked), so the line can get thicker
 * and thinner with pen pressure. The same path draws on the canvas (Path2D) and in the file.
 */
export function strokePath(stroke: Stroke): string {
  const pts: { x: number; y: number; r: number }[] = []
  for (let i = 0; i + 1 < stroke.points.length; i += 3) {
    pts.push({ x: stroke.points[i], y: stroke.points[i + 1], r: widthAt(stroke, stroke.points[i + 2] ?? 0.5) / 2 })
  }
  if (pts.length === 0) return ''
  const f = (n: number): string => String(round(n))
  if (pts.length === 1) {
    const { x, y, r } = pts[0]
    return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`
  }
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    let dx = b.x - a.x
    let dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const { x, y, r } = pts[i]
    left.push({ x: x - dy * r, y: y + dx * r })
    right.push({ x: x + dy * r, y: y - dx * r })
  }
  // Smooth each side by curving through the midpoints between its points.
  const side = (s: { x: number; y: number }[]): string => {
    let d = ''
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i].x + s[i + 1].x) / 2
      const my = (s[i].y + s[i + 1].y) / 2
      d += `Q${f(s[i].x)} ${f(s[i].y)} ${f(mx)} ${f(my)}`
    }
    const last = s[s.length - 1]
    return d + `L${f(last.x)} ${f(last.y)}`
  }
  const back = [...right].reverse()
  const end = pts[pts.length - 1].r
  const start = pts[0].r
  return (
    `M${f(left[0].x)} ${f(left[0].y)}` +
    side(left) +
    // Round ends.
    `A${f(end)} ${f(end)} 0 0 0 ${f(back[0].x)} ${f(back[0].y)}` +
    side(back) +
    `A${f(start)} ${f(start)} 0 0 0 ${f(left[0].x)} ${f(left[0].y)}Z`
  )
}

export const strokeOpacity = (stroke: Stroke): number => (stroke.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1)

/** True if the point (x, y) is within `radius` of the stroke's line (for the eraser). */
export function strokeHits(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const p = stroke.points
  const reach = radius + stroke.size / 2
  for (let i = 0; i + 1 < p.length; i += 3) {
    const ax = p[i]
    const ay = p[i + 1]
    const bx = i + 4 < p.length ? p[i + 3] : ax
    const by = i + 4 < p.length ? p[i + 4] : ay
    // Distance from the point to this bit of the line.
    const dx = bx - ax
    const dy = by - ay
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= reach) return true
  }
  return false
}

// ---------- the paper ----------

/** The lines printed on the paper, as [x1, y1, x2, y2, colour]. */
export function paperLines(sketch: Pick<Sketch, 'width' | 'height' | 'paper'>): [number, number, number, number, string][] {
  const { width, height, paper } = sketch
  const out: [number, number, number, number, string][] = []
  if (paper === 'grid') {
    for (let x = PAPER_SPACING; x < width; x += PAPER_SPACING) out.push([x, 0, x, height, GRID_COLOUR])
    for (let y = PAPER_SPACING; y < height; y += PAPER_SPACING) out.push([0, y, width, y, GRID_COLOUR])
  } else if (paper === 'lined') {
    for (let y = PAPER_SPACING * 2; y < height; y += PAPER_SPACING) out.push([0, y, width, y, LINE_COLOUR])
    out.push([PAPER_SPACING * 2, 0, PAPER_SPACING * 2, height, MARGIN_COLOUR])
  }
  return out
}

// ---------- the file ----------

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescapeXml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const escapeAttr = (s: string): string => escapeXml(s).replace(/"/g, '&quot;')

/** The sketch as an .svg picture, with its strokes kept inside so it can be edited again. */
export function sketchToSvg(sketch: Sketch): string {
  const { width, height } = sketch
  const data = { version: 1, ...sketch, strokes: sketch.strokes.map((s) => ({ ...s, points: s.points.map(round) })) }
  const lines = paperLines(sketch).map(([x1, y1, x2, y2, c]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1"/>`)
  const paths = sketch.strokes
    .map((s) => {
      const d = strokePath(s)
      if (!d) return ''
      const opacity = strokeOpacity(s)
      return `<path d="${d}" fill="${escapeAttr(s.color)}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`
    })
    .filter(Boolean)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<metadata id="${METADATA_ID}">${escapeXml(JSON.stringify(data))}</metadata>`,
    `<rect width="${width}" height="${height}" fill="${PAPER_COLOUR}"/>`,
    ...lines,
    ...paths,
    '</svg>',
    ''
  ].join('\n')
}

/** Reads the strokes back out of a sketch's .svg; null if the picture wasn't drawn in Notes. */
export function parseSketch(svg: string): Sketch | null {
  const m = new RegExp(`<metadata id="${METADATA_ID}">([\\s\\S]*?)</metadata>`).exec(svg)
  if (!m) return null
  try {
    const data = JSON.parse(unescapeXml(m[1]))
    if (!Array.isArray(data.strokes)) return null
    const paper: SketchPaper = ['plain', 'grid', 'lined'].includes(data.paper) ? data.paper : 'plain'
    const strokes: Stroke[] = data.strokes
      .filter((s: Stroke) => s && Array.isArray(s.points) && typeof s.color === 'string')
      .map((s: Stroke) => ({
        tool: s.tool === 'highlighter' ? 'highlighter' : 'pen',
        color: s.color,
        size: Number(s.size) || 4,
        points: s.points.map(Number)
      }))
    return {
      width: Number(data.width) || SKETCH_WIDTH,
      height: Number(data.height) || SKETCH_HEIGHT,
      paper,
      strokes
    }
  } catch {
    return null
  }
}

// ---------- showing the latest version ----------

/**
 * After a sketch is edited its file name stays the same, so pictures of it in notes would keep
 * showing the old one. Each save bumps a number that's added to the picture's address.
 */
export const useSketchVersions = create<Record<string, number>>(() => ({}))

export function bumpSketch(path: string): void {
  useSketchVersions.setState((s) => ({ [path]: (s[path] ?? 0) + 1 }))
}

/** `url` with the sketch's version added, if it has been edited. */
export function withSketchVersion(url: string, path: string): string {
  const v = useSketchVersions.getState()[path]
  return v ? `${url}?v=${v}` : url
}

/** Reads a sketch from the notes folder; null if the picture wasn't drawn in Notes. */
export async function loadSketch(path: string): Promise<Sketch | null> {
  if (!/\.svg$/i.test(path)) return null
  const bytes = await window.api.readImage(path)
  return parseSketch(new TextDecoder().decode(bytes))
}
