import { create } from 'zustand'
import { loadPdf, PdfLockedError, readFields, type FieldValue, type FormField, type PageItem, type PdfSource, type Stamp } from '../lib/pdfEdit'
import { closePdf, viewPdf } from '../lib/pdfView'
import { openSpecialTab, PDF_EDITOR_TAB } from '../lib/editorController'

/**
 * The PDF editor's open work (components/PdfEditor). It's kept here rather than in the page, so
 * looking at another tab and coming back loses nothing. It's only in memory: the PDFs you opened
 * are never changed, and nothing is saved until you press Save.
 */

/** A PDF waiting for its password before it can be added. */
export interface LockedPdf {
  name: string
  bytes: Uint8Array
  wrong: boolean
}

interface PdfEditorState {
  sources: PdfSource[]
  /** Each open PDF's form boxes, by source id. */
  fields: Record<string, FormField[]>
  pages: PageItem[]
  /** Keys of the pages picked in the page list. */
  selected: string[]
  /** The page open on its own, to sign or fill in (its key). */
  open: string | null
  locked: LockedPdf | null
  /** Bake form answers into the pages when saving. */
  flatten: boolean
  past: PageItem[][]
  future: PageItem[][]
  /** Bumped whenever a page or answer changes, so "Saved" can go away. */
  version: number
}

const empty = (): Pick<PdfEditorState, 'sources' | 'fields' | 'pages' | 'selected' | 'open' | 'locked' | 'past' | 'future'> => ({
  sources: [],
  fields: {},
  pages: [],
  selected: [],
  open: null,
  locked: null,
  past: [],
  future: []
})

export const usePdfEditor = create<PdfEditorState>(() => ({ ...empty(), flatten: false, version: 0 }))

const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const HISTORY = 60

/** Changes the pages, remembering how they were so it can be undone. */
export function changePages(change: (pages: PageItem[]) => PageItem[]): void {
  const s = usePdfEditor.getState()
  const next = change(s.pages)
  if (next === s.pages) return
  const keys = new Set(next.map((p) => p.key))
  usePdfEditor.setState({
    pages: next,
    past: [...s.past, s.pages].slice(-HISTORY),
    future: [],
    selected: s.selected.filter((k) => keys.has(k)),
    open: s.open && keys.has(s.open) ? s.open : null,
    version: s.version + 1
  })
}

/** Remembers the pages as they are now, before a change made in several steps (dragging a signature). */
export function checkpoint(): void {
  const s = usePdfEditor.getState()
  usePdfEditor.setState({ past: [...s.past, s.pages].slice(-HISTORY), future: [] })
}

/** Changes the pages without adding an undo step (the steps of a drag after its checkpoint). */
export function changePagesQuietly(change: (pages: PageItem[]) => PageItem[]): void {
  const s = usePdfEditor.getState()
  usePdfEditor.setState({ pages: change(s.pages), version: s.version + 1 })
}

export function undo(): void {
  const s = usePdfEditor.getState()
  const prev = s.past[s.past.length - 1]
  if (!prev) return
  const keys = new Set(prev.map((p) => p.key))
  usePdfEditor.setState({ pages: prev, past: s.past.slice(0, -1), future: [s.pages, ...s.future], selected: s.selected.filter((k) => keys.has(k)), open: s.open && keys.has(s.open) ? s.open : null, version: s.version + 1 })
}

export function redo(): void {
  const s = usePdfEditor.getState()
  const next = s.future[0]
  if (!next) return
  const keys = new Set(next.map((p) => p.key))
  usePdfEditor.setState({ pages: next, past: [...s.past, s.pages], future: s.future.slice(1), selected: s.selected.filter((k) => keys.has(k)), open: s.open && keys.has(s.open) ? s.open : null, version: s.version + 1 })
}

/**
 * Adds a PDF's pages to the end (the first one you open, or merging in another). A PDF with a
 * password waits in `locked` until it's given.
 */
export async function addPdf(name: string, bytes: Uint8Array, password?: string): Promise<void> {
  let doc
  try {
    doc = await loadPdf(bytes, password)
  } catch (err) {
    if (err instanceof PdfLockedError) {
      usePdfEditor.setState({ locked: { name, bytes, wrong: err.wrong } })
      return
    }
    throw err
  }
  const id = uid()
  // Make sure it can be shown too before adding it.
  await viewPdf(id, bytes, password)
  const count = doc.getPageCount()
  const fields = readFields(doc)
  const source: PdfSource = { id, name, bytes, password, values: {} }
  const s = usePdfEditor.getState()
  const added: PageItem[] = Array.from({ length: count }, (_, index) => ({ key: uid(), source: id, index, turn: 0, stamps: [] }))
  usePdfEditor.setState({ sources: [...s.sources, source], fields: { ...s.fields, [id]: fields }, locked: null })
  changePages((pages) => [...pages, ...added])
}

/** Opens a PDF from the notes folder or the computer (by its vault:// address) in the PDF editor. */
export async function openInPdfEditor(name: string, url: string): Promise<void> {
  openSpecialTab(PDF_EDITOR_TAB)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`“${name}” couldn't be read.`)
  await addPdf(name, new Uint8Array(await res.arrayBuffer()))
}

export function setFieldValue(source: string, name: string, value: FieldValue): void {
  const s = usePdfEditor.getState()
  usePdfEditor.setState({
    sources: s.sources.map((src) => (src.id === source ? { ...src, values: { ...src.values, [name]: value } } : src)),
    version: s.version + 1
  })
}

/** What a form box says now: your answer, or what was already in the PDF. */
export function fieldValue(state: PdfEditorState, source: string, name: string): FieldValue {
  const src = state.sources.find((s) => s.id === source)
  if (src && name in src.values) return src.values[name]
  return state.fields[source]?.find((f) => f.name === name)?.value ?? ''
}

export function addStamp(pageKey: string, stamp: Omit<Stamp, 'id'>): string {
  const id = uid()
  changePages((pages) => pages.map((p) => (p.key === pageKey ? { ...p, stamps: [...p.stamps, { ...stamp, id }] } : p)))
  return id
}

export function updateStamp(pageKey: string, id: string, patch: Partial<Stamp>, quietly = false): void {
  const change = (pages: PageItem[]): PageItem[] => pages.map((p) => (p.key === pageKey ? { ...p, stamps: p.stamps.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : p))
  if (quietly) changePagesQuietly(change)
  else changePages(change)
}

export function removeStamp(pageKey: string, id: string): void {
  changePages((pages) => pages.map((p) => (p.key === pageKey ? { ...p, stamps: p.stamps.filter((s) => s.id !== id) } : p)))
}

/** Turns pages a quarter clockwise (1) or anticlockwise (-1). */
export function turnPages(keys: string[], dir: 1 | -1): void {
  const set = new Set(keys)
  changePages((pages) => pages.map((p) => (set.has(p.key) ? { ...p, turn: (p.turn + dir * 90 + 360) % 360 } : p)))
}

export function removePages(keys: string[]): void {
  const set = new Set(keys)
  changePages((pages) => pages.filter((p) => !set.has(p.key)))
}

/** Moves these pages (kept in their order) so they sit before the page now at `to` (pages.length: the end). */
export function movePages(keys: string[], to: number): void {
  changePages((pages) => {
    const set = new Set(keys)
    const moving = pages.filter((p) => set.has(p.key))
    if (!moving.length) return pages
    const before = pages.slice(0, to).filter((p) => !set.has(p.key)).length
    const rest = pages.filter((p) => !set.has(p.key))
    const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)]
    return next.every((p, i) => p === pages[i]) ? pages : next
  })
}

/** Makes a copy of a page right after it (for a page you need twice). */
export function duplicatePage(key: string): void {
  changePages((pages) => {
    const i = pages.findIndex((p) => p.key === key)
    if (i < 0) return pages
    return [...pages.slice(0, i + 1), { ...pages[i], key: uid(), stamps: pages[i].stamps.map((s) => ({ ...s, id: uid() })) }, ...pages.slice(i + 1)]
  })
}

/** Closes everything, to start again with another PDF. */
export function closeAll(): void {
  for (const s of usePdfEditor.getState().sources) closePdf(s.id)
  usePdfEditor.setState({ ...empty(), version: usePdfEditor.getState().version + 1 })
}

// ---------- your signature, remembered on this computer ----------

const SIGNATURE_KEY = 'notesapp.pdf.signature'

export function savedSignature(): string | null {
  try {
    return localStorage.getItem(SIGNATURE_KEY)
  } catch {
    return null
  }
}

export function rememberSignature(png: string | null): void {
  try {
    if (png) localStorage.setItem(SIGNATURE_KEY, png)
    else localStorage.removeItem(SIGNATURE_KEY)
  } catch {
    // Not remembered, but still used this time.
  }
}
