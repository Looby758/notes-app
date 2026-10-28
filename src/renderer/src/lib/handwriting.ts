import type { Prefs } from '@shared/prefs'
import { strokePath, type Sketch, type Stroke } from './sketch'

/**
 * Turning a sketch's handwriting into text: which reader to use, and the picture it reads, which
 * is just the pen lines in black on white (no paper lines or highlighter, which only confuse it),
 * cropped to the writing.
 */

export type Reader = 'ai' | 'offline'

/** "AI helper if set up" uses it once a key is saved. */
export const pickReader = (pref: Prefs['handwritingReader'], hasKey: boolean): Reader => (pref === 'auto' ? (hasKey ? 'ai' : 'offline') : pref)

export const READER_NAMES: Record<Reader, string> = { ai: 'the AI helper', offline: 'the offline reader' }

const penStrokes = (sketch: Sketch): Stroke[] => sketch.strokes.filter((s) => s.tool === 'pen' && s.points.length >= 3)

/** The box around the pen lines with room around it, kept on the page; null if there are none. */
export function inkBox(sketch: Sketch, margin = 24): { x: number; y: number; width: number; height: number } | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const s of penStrokes(sketch)) {
    const r = s.size / 2
    for (let i = 0; i + 1 < s.points.length; i += 3) {
      left = Math.min(left, s.points[i] - r)
      right = Math.max(right, s.points[i] + r)
      top = Math.min(top, s.points[i + 1] - r)
      bottom = Math.max(bottom, s.points[i + 1] + r)
    }
  }
  if (left > right) return null
  const x = Math.max(0, Math.floor(left - margin))
  const y = Math.max(0, Math.floor(top - margin))
  return { x, y, width: Math.min(sketch.width, Math.ceil(right + margin)) - x, height: Math.min(sketch.height, Math.ceil(bottom + margin)) - y }
}

/** How tall the writing is: the middle of the pen lines' heights (one line is often a letter). */
export function letterHeight(sketch: Sketch): number | null {
  const heights: number[] = []
  for (const s of penStrokes(sketch)) {
    let top = Infinity
    let bottom = -Infinity
    for (let i = 1; i < s.points.length; i += 3) {
      top = Math.min(top, s.points[i])
      bottom = Math.max(bottom, s.points[i])
    }
    // Dots and dashes say nothing about size.
    if (bottom - top >= 8) heights.push(bottom - top)
  }
  if (!heights.length) return null
  heights.sort((a, b) => a - b)
  return heights[Math.floor(heights.length / 2)]
}

// The offline reader does best with letters about this many pixels tall and lines a few pixels
// thick, whatever size you wrote at; a picture this size is also plenty for the AI helper.
const LETTER_PX = 44
const LINE_PX = 3.5
const MAX_SIDE = 2000

/** The writing as a PNG, or null if nothing has been written with the pen. */
export async function inkPng(sketch: Sketch): Promise<Uint8Array | null> {
  const box = inkBox(sketch)
  if (!box) return null
  const k = Math.min(MAX_SIDE / Math.max(box.width, box.height), Math.max(0.25, Math.min(2, LETTER_PX / (letterHeight(sketch) ?? LETTER_PX))))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(box.width * k))
  canvas.height = Math.max(1, Math.round(box.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k)
  ctx.fillStyle = ctx.strokeStyle = '#000000'
  // Outlining each line as well as filling it keeps thin pen lines from fading when shrunk.
  ctx.lineWidth = LINE_PX / k
  ctx.lineJoin = ctx.lineCap = 'round'
  for (const s of penStrokes(sketch)) {
    const path = new Path2D(strokePath(s))
    ctx.fill(path)
    ctx.stroke(path)
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Couldn’t make a picture of the sketch to read.')
  return new Uint8Array(await blob.arrayBuffer())
}
