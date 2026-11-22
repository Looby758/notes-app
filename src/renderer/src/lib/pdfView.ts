/// <reference types="vite/client" />
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

/**
 * Draws the PDF editor's pages with pdf.js (the same reader the money tracker uses for bank
 * statements). Each open PDF is read once and kept until it's closed.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let lib: Promise<PdfJs> | null = null
function pdfjs(): Promise<PdfJs> {
  // The "legacy" build works on the version of Chrome inside the app; the standard one needs newer.
  lib ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default
    return m
  })
  return lib
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()
const tasks = new Map<string, { destroy(): Promise<void> }>()

/** Starts reading a PDF so its pages can be shown. */
export function viewPdf(id: string, bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  let doc = docs.get(id)
  if (!doc) {
    // pdf.js takes the bytes over, so it gets its own copy.
    doc = pdfjs().then((m) => {
      const task = m.getDocument({ data: bytes.slice(), password })
      tasks.set(id, task)
      return task.promise
    })
    docs.set(id, doc)
    doc.catch(() => docs.delete(id))
  }
  return doc
}

export function closePdf(id: string): void {
  docs.delete(id)
  void tasks.get(id)?.destroy().catch(() => undefined)
  tasks.delete(id)
  for (const k of [...thumbs.keys()]) if (k.startsWith(`${id}#`)) thumbs.delete(k)
}

export async function getPage(id: string, index: number): Promise<PDFPageProxy> {
  const doc = docs.get(id)
  if (!doc) throw new Error('That PDF is no longer open.')
  return (await doc).getPage(index + 1)
}

/** The page's size in points as you see it (turned), at scale 1. */
export async function pageSize(id: string, index: number, turn: number): Promise<{ width: number; height: number }> {
  const page = await getPage(id, index)
  const v = page.getViewport({ scale: 1, rotation: (page.rotate + turn) % 360 })
  return { width: v.width, height: v.height }
}

/** Draws a page onto a canvas, `width` CSS pixels wide (sharp on high-DPI screens). */
export async function drawPage(canvas: HTMLCanvasElement, id: string, index: number, turn: number, width: number): Promise<void> {
  const page = await getPage(id, index)
  const rotation = (page.rotate + turn) % 360
  const base = page.getViewport({ scale: 1, rotation })
  const ratio = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: (width / base.width) * ratio, rotation })
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  canvas.style.width = `${width}px`
  canvas.style.height = `${(viewport.height / viewport.width) * width}px`
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
}

/** Small pictures of pages, kept so going back to the page list is instant. */
const thumbs = new Map<string, string>()

export async function thumbnail(id: string, index: number, turn: number, width: number): Promise<string> {
  const key = `${id}#${index}#${turn}#${width}`
  const have = thumbs.get(key)
  if (have) return have
  const canvas = document.createElement('canvas')
  await drawPage(canvas, id, index, turn, width)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  thumbs.set(key, url)
  return url
}

/** A form box on a page, where it is on screen (pixels from the page's top left). */
export interface FieldBox {
  id: string
  name: string
  kind: 'text' | 'check' | 'radio' | 'choice' | 'other'
  /** Radio buttons: the choice this one stands for. Check boxes: the "on" value. */
  onValue?: string
  options?: { value: string; label: string }[]
  multiline: boolean
  readOnly: boolean
  left: number
  top: number
  width: number
  height: number
}

/** The form boxes on a page, placed for a page drawn `width` pixels wide. */
export async function fieldBoxes(id: string, index: number, turn: number, width: number): Promise<FieldBox[]> {
  const page = await getPage(id, index)
  const rotation = (page.rotate + turn) % 360
  const base = page.getViewport({ scale: 1, rotation })
  const viewport = page.getViewport({ scale: width / base.width, rotation })
  const annots = (await page.getAnnotations({ intent: 'display' })) as Record<string, unknown>[]
  const out: FieldBox[] = []
  for (const a of annots) {
    if (a.subtype !== 'Widget' || typeof a.fieldName !== 'string' || !Array.isArray(a.rect)) continue
    if (a.hidden) continue
    const r = a.rect as number[]
    const [x1, y1] = viewport.convertToViewportPoint(r[0], r[1]) as number[]
    const [x2, y2] = viewport.convertToViewportPoint(r[2], r[3]) as number[]
    const kind =
      a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Ch' ? 'choice' : a.fieldType === 'Btn' ? (a.checkBox ? 'check' : a.radioButton ? 'radio' : 'other') : 'other'
    if (kind === 'other') continue
    const options = Array.isArray(a.options)
      ? (a.options as { exportValue?: string; displayValue?: string }[]).map((o) => ({ value: String(o.displayValue ?? o.exportValue ?? ''), label: String(o.displayValue ?? o.exportValue ?? '') }))
      : undefined
    out.push({
      id: String(a.id),
      name: a.fieldName,
      kind,
      onValue: kind === 'radio' ? String(a.buttonValue ?? '') : kind === 'check' ? String(a.exportValue ?? 'Yes') : undefined,
      options,
      multiline: !!a.multiLine,
      readOnly: !!a.readOnly,
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1)
    })
  }
  return out
}
