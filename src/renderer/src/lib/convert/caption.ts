import type { GifCaption } from '@shared/types'

/** Fonts offered for captions (any other font on this computer can be typed in). */
export const CAPTION_FONTS = [
  'Futura',
  'Impact',
  'Arial Black',
  'Arial',
  'Helvetica Neue',
  'Segoe UI',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Trebuchet MS',
  'Comic Sans MS',
  'Courier New'
]

export const DEFAULT_CAPTION: GifCaption = {
  text: '',
  font: 'Futura',
  size: 0.08,
  bold: true,
  textColor: '#000000',
  barColor: '#ffffff',
  position: 'top'
}

/** A font for canvas text, with a fallback when the chosen font isn't on this computer. */
export const captionFont = (c: GifCaption, px: number): string =>
  `${c.bold ? '800' : '400'} ${px}px ${JSON.stringify(c.font)}, ${c.font === 'Futura' ? '"Futura Condensed ExtraBold", "Arial Black", ' : ''}Arial, sans-serif`

/** Splits text into lines that fit `width` (long words are kept whole); blank lines are kept. */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next) > width) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

/** Draws the caption bar `width` pixels wide onto a new canvas (null when there's no text). */
export function drawCaption(c: GifCaption, width: number): HTMLCanvasElement | null {
  if (!c.text.trim()) return null
  const px = Math.max(8, Math.round(width * c.size))
  const pad = Math.round(px * 0.6)
  const lineHeight = Math.round(px * 1.2)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = captionFont(c, px)
  const lines = wrapLines(c.text.trim(), width - pad * 2, (s) => ctx.measureText(s).width)
  canvas.width = width
  canvas.height = lines.length * lineHeight + pad * 2
  ctx.fillStyle = c.barColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = captionFont(c, px)
  ctx.fillStyle = c.textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((line, i) => ctx.fillText(line, width / 2, pad + lineHeight * i + lineHeight / 2, width - pad * 2))
  return canvas
}

/** The caption bar as PNG bytes, ready for the converter. */
export async function captionPng(c: GifCaption, width: number): Promise<{ png: Uint8Array; height: number } | null> {
  const canvas = drawCaption(c, width)
  if (!canvas) return null
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return { png: new Uint8Array(await blob.arrayBuffer()), height: canvas.height }
}
