import { useNoteIndex, getNoteText } from '../../store/noteIndex'
import { getOpenText } from '../editorController'
import { isLocked } from '../lock/session'
import { noteTitle } from '../paths'
import { imagesIn, notesUnder, prepareNote, type ExportItem } from './prepare'
import { toHtmlDocument } from './html'
import type { DocxImage } from './docx'
import { diagramsIn, renderDiagram } from '../diagrams'

export type ExportFormat = 'pdf' | 'docx' | 'html'

export interface ExportRequest {
  /** A note path, a folder path, or '' (with isFolder) for every note. */
  target: string
  isFolder: boolean
  format: ExportFormat
  /** Folders: one file with every note (true) or a file per note. */
  combine: boolean
  subfolders: boolean
  includeProperties: boolean
  /** Several selected notes and folders (instead of `target`). */
  paths?: string[]
}

export const EXTENSIONS: Record<ExportFormat, string> = { pdf: 'pdf', docx: 'docx', html: 'html' }

/** File-name-safe version of a title. */
const fileName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Notes'

/** The notes a request covers (for showing a count before exporting). */
export function notesFor(req: Pick<ExportRequest, 'target' | 'isFolder' | 'subfolders' | 'paths'>): string[] {
  const all = useNoteIndex.getState().lookup.paths
  if (req.paths) {
    const out = new Set<string>()
    for (const p of req.paths) for (const n of notesUnder(all, p, !all.includes(p), req.subfolders)) out.add(n)
    return [...out]
  }
  return notesUnder(all, req.target, req.isFolder, req.subfolders)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

async function loadImage(path: string): Promise<{ blob: Blob } | null> {
  try {
    const bytes = await window.api.readImage(path)
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    return { blob: new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? 'application/octet-stream' }) }
  } catch {
    return null
  }
}

/** Word only takes PNG, JPEG and GIF; anything else (SVG, WebP…) is redrawn as a PNG. */
async function forWord(blob: Blob): Promise<DocxImage | null> {
  try {
    const img = new Image()
    // A data: URL (the page's security rules don't allow blob: images).
    img.src = await blobToDataUrl(blob)
    await img.decode()
    const width = img.naturalWidth || 400
    const height = img.naturalHeight || 300
    const type = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : null
    if (type) return { data: new Uint8Array(await blob.arrayBuffer()), type, width, height }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return png ? { data: new Uint8Array(await png.arrayBuffer()), type: 'png', width, height } : null
  } catch {
    return null
  }
}

/** Gives each note its own file name in a folder export ("Plan.pdf", "Plan (2).pdf"…). */
function fileNames(items: ExportItem[], ext: string): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const it of items) {
    const base = fileName(it.title)
    let name = `${base}.${ext}`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`
    used.add(name.toLowerCase())
    out.set(it.path, name)
  }
  return out
}

/**
 * Exports notes. Asks where to save (a file, or a folder for one-file-per-note), and returns
 * where they went, or null if cancelled.
 */
export async function runExport(req: ExportRequest): Promise<string | null> {
  const { lookup } = useNoteIndex.getState()
  // Locked notes are only exported while they're open and unlocked.
  const paths = notesFor(req).filter((p) => !isLocked(p) || getOpenText(p) !== null)
  if (paths.length === 0) throw new Error(isLocked(req.target) ? 'Open and unlock the note to export it.' : 'There are no notes to export there.')
  const ctx = { lookup, textOf: (p: string) => getOpenText(p) ?? getNoteText(p) }
  const items = paths.map((p) => prepareNote(p, ctx, req.includeProperties))
  const name = fileName(req.paths ? `Notes (${paths.length})` : req.isFolder ? (req.target ? noteTitle(req.target + '.md') : 'All notes') : noteTitle(req.target))
  const ext = EXTENSIONS[req.format]

  // Images, loaded once.
  const blobs = new Map<string, Blob>()
  for (const p of imagesIn(items)) {
    const loaded = await loadImage(p)
    if (loaded) blobs.set(p, loaded.blob)
  }
  const dataUrls = new Map<string, string>()
  const wordImages = new Map<string, DocxImage>()
  for (const [p, blob] of blobs) {
    if (req.format === 'docx') {
      const img = await forWord(blob)
      if (img) wordImages.set(p, img)
    } else dataUrls.set(p, await blobToDataUrl(blob))
  }

  // Diagrams, drawn once (web pages and PDFs only; Word gets their text).
  const diagrams = new Map<string, string>()
  if (req.format !== 'docx') {
    for (const code of new Set(items.flatMap((it) => diagramsIn(it.markdown)))) {
      try {
        diagrams.set(code.trim(), await renderDiagram(code, false))
      } catch {
        // Shown as its text instead.
      }
    }
  }

  const build = async (group: ExportItem[], title: string, otherFiles?: Map<string, string>): Promise<Uint8Array | string> => {
    if (req.format === 'docx') {
      const { toDocx } = await import('./docx')
      return toDocx({ items: group, images: wordImages, title })
    }
    const html = toHtmlDocument({ items: group, images: dataUrls, diagrams, title, forPrint: req.format === 'pdf', otherFiles })
    return req.format === 'pdf' ? window.api.printToPdf(html) : html
  }

  const single = (!req.isFolder && !req.paths) || req.combine || items.length === 1
  if (single) {
    const data = await build(items, name)
    return window.api.exportFile(`${name}.${ext}`, req.format, data)
  }
  const names = fileNames(items, ext)
  const files: { name: string; data: Uint8Array | string }[] = []
  for (const it of items) {
    // In a set of web pages, links between exported notes point at each other's files.
    files.push({ name: names.get(it.path)!, data: await build([it], it.title, req.format === 'html' ? names : undefined) })
  }
  return window.api.exportFiles(name, files)
}
