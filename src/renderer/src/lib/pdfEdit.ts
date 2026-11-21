import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFObjectCopier,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage
} from '@cantoo/pdf-lib'

/**
 * The PDF editor's file work: merging, splitting, reordering, rotating, signing and filling in
 * forms. Everything happens on this computer, and the files you opened are never changed: a new
 * PDF is made each time you save.
 */

/** Thrown when a PDF needs a password (or the one given was wrong). */
export class PdfLockedError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? 'That password is not right.' : 'This PDF is protected with a password.')
  }
}

/** A PDF you opened. Its bytes stay as they were; edits are made on a copy when saving. */
export interface PdfSource {
  id: string
  name: string
  bytes: Uint8Array
  password?: string
  /** What you've typed or ticked in its form, by field name. */
  values: Record<string, FieldValue>
}

export type FieldValue = string | boolean

/** Something put on a page: a signature (a picture) or a line of text. */
export interface Stamp {
  id: string
  kind: 'image' | 'text'
  /** Where it sits, as fractions of the page as you see it (0,0 is the top left). */
  x: number
  y: number
  w: number
  h: number
  /** A PNG data URL (signatures). */
  image?: string
  text?: string
}

/** One page of the PDF being made: which file and page it comes from, and what's changed on it. */
export interface PageItem {
  key: string
  source: string
  /** 0-based page in its file. */
  index: number
  /** Extra turn, clockwise, in degrees (0, 90, 180 or 270). */
  turn: number
  stamps: Stamp[]
}

export interface FormField {
  name: string
  /** The field's own description, when it has one; otherwise a tidied-up name. */
  label: string
  kind: 'text' | 'check' | 'choice' | 'radio'
  options?: string[]
  multiline?: boolean
  readOnly: boolean
  value: FieldValue
  /** 0-based pages its boxes are on. */
  pages: number[]
}

export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { password, updateMetadata: false })
  } catch (err) {
    const name = (err as Error)?.name ?? ''
    const message = (err as Error)?.message ?? ''
    if (name === 'EncryptedPDFError' || /encrypted/i.test(message)) throw new PdfLockedError(false)
    if (/password/i.test(message)) throw new PdfLockedError(!!password)
    throw new Error("That PDF couldn't be opened. It may be damaged.")
  }
}

/** "first_name[0]" → "First name"; "agree.0" → "Agree 1" */
export function tidyFieldName(name: string): string {
  const parts = name.split('.').map((p) => p.replace(/\[\d+\]$/, '').trim())
  const tidy = (part: string): string => {
    const words = part
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
  }
  const last = parts[parts.length - 1]
  // Numbered boxes ("agree.0", "agree.1") are named after their group, counting from 1.
  if (/^\d+$/.test(last) && parts.length > 1 && parts[parts.length - 2]) return `${tidy(parts[parts.length - 2])} ${Number(last) + 1}`
  return tidy(last) || name
}

/** The boxes to fill in, in the order they appear on the pages. */
export function readFields(doc: PDFDocument): FormField[] {
  let fields
  try {
    fields = doc.getForm().getFields()
  } catch {
    return []
  }
  const pageOf = new Map<string, number>()
  doc.getPages().forEach((p, i) => pageOf.set(p.ref.toString(), i))
  const out: (FormField & { order: number })[] = []
  for (const f of fields) {
    const name = f.getName()
    const pages = new Set<number>()
    let top = Infinity
    for (const w of f.acroField.getWidgets()) {
      const p = w.P()
      let page = p ? pageOf.get(p.toString()) : undefined
      if (page === undefined) {
        // Some PDFs leave out which page a box is on; look for it.
        const ref = doc.context.getObjectRef(w.dict)
        if (ref) page = doc.getPages().findIndex((pg) => pg.node.Annots()?.asArray().some((a) => a.toString() === ref.toString()))
      }
      if (page !== undefined && page >= 0) pages.add(page)
      const r = w.getRectangle()
      top = Math.min(top, (page ?? 0) * 1e5 - (r.y + r.height))
    }
    const tu = f.acroField.dict.lookup(PDFName.of('TU'))
    const described = tu && 'decodeText' in tu ? (tu as { decodeText(): string }).decodeText().trim() : ''
    const base = { name, label: described || tidyFieldName(name), readOnly: f.isReadOnly(), pages: [...pages].sort((a, b) => a - b), order: top }
    if (f instanceof PDFTextField) out.push({ ...base, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() })
    else if (f instanceof PDFCheckBox) out.push({ ...base, kind: 'check', value: f.isChecked() })
    else if (f instanceof PDFDropdown) out.push({ ...base, kind: 'choice', options: f.getOptions(), value: f.getSelected()[0] ?? '' })
    else if (f instanceof PDFOptionList) out.push({ ...base, kind: 'choice', options: f.getOptions(), value: f.getSelected()[0] ?? '' })
    else if (f instanceof PDFRadioGroup) out.push({ ...base, kind: 'radio', options: f.getOptions(), value: f.getSelected() ?? '' })
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _, ...f }) => f)
}

/** Puts your answers into a loaded PDF's form. Boxes that don't exist (or won't take the answer) are skipped. */
export function fillForm(doc: PDFDocument, values: Record<string, FieldValue>, font?: PDFFont): void {
  if (!Object.keys(values).length) return
  const form = doc.getForm()
  for (const [name, value] of Object.entries(values)) {
    try {
      const f = form.getFieldMaybe(name)
      if (!f || f.isReadOnly()) continue
      if (f instanceof PDFTextField) {
        const text = String(value)
        // A box with a letter limit cuts the text to fit rather than failing.
        const max = f.getMaxLength()
        f.setText(max !== undefined ? text.slice(0, max) : text)
        // Boxes left to size their own text (or set far too big) fill the whole box with a few huge
        // letters, which isn't what you see while typing; give them a normal size.
        const da = f.acroField.getDefaultAppearance() ?? ''
        const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0)
        const height = f.acroField.getWidgets()[0]?.getRectangle().height ?? 20
        const most = f.isMultiline() ? 14 : height * 0.8
        if (!size || size > most) f.setFontSize(f.isMultiline() ? Math.min(11, Math.max(7, height / 4)) : Math.min(12, Math.max(7, height * 0.62)))
      } else if (f instanceof PDFCheckBox) {
        if (value) f.check()
        else f.uncheck()
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        if (value === '') f.clear()
        else f.select(String(value))
      } else if (f instanceof PDFRadioGroup) {
        if (value === '') f.clear()
        else f.select(String(value))
      }
    } catch {
      // Leave that one as it was.
    }
  }
  try {
    if (font) form.updateFieldAppearances(font)
  } catch {
    // The answers are still saved; the PDF reader draws them itself.
  }
}

// ---------- where things go on a turned page ----------

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The page's size as you see it, after turning. */
export function shownSize(box: Box, rotation: number): { width: number; height: number } {
  return rotation % 180 === 0 ? { width: box.width, height: box.height } : { width: box.height, height: box.width }
}

/**
 * Turns a point on the page as you see it (fractions, from the top left) into the PDF's own
 * coordinates (points, from the bottom left of the unturned page).
 */
export function toPdfPoint(fx: number, fy: number, rotation: number, box: Box): { x: number; y: number } {
  const { x: x0, y: y0, width: w, height: h } = box
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: x0 + fy * w, y: y0 + fx * h }
    case 180:
      return { x: x0 + w - fx * w, y: y0 + fy * h }
    case 270:
      return { x: x0 + w - fy * w, y: y0 + h - fx * h }
    default:
      return { x: x0 + fx * w, y: y0 + (1 - fy) * h }
  }
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Drops letters the built-in PDF font can't draw (emoji and the like). */
export function drawableText(font: PDFFont, text: string): string {
  const allowed = new Set(font.getCharacterSet())
  return [...text].filter((ch) => allowed.has(ch.codePointAt(0)!)).join('')
}

/** How big a text stamp's letters are, as a share of its box's height (the page view uses this too). */
export const TEXT_SIZE = 0.78

async function drawStamps(out: PDFDocument, page: PDFPage, stamps: Stamp[], font: () => Promise<PDFFont>): Promise<void> {
  if (!stamps.length) return
  const rotation = page.getRotation().angle
  const box = page.getCropBox()
  const shown = shownSize(box, rotation)
  for (const s of stamps) {
    // Things are drawn from their bottom-left corner, turned with the page so they look upright.
    const at = toPdfPoint(s.x, s.y + s.h, rotation, box)
    const width = s.w * shown.width
    const height = s.h * shown.height
    if (s.kind === 'image' && s.image) {
      const png = await out.embedPng(dataUrlBytes(s.image))
      page.drawImage(png, { x: at.x, y: at.y, width, height, rotate: degrees(rotation) })
    } else if (s.kind === 'text' && s.text) {
      const f = await font()
      const text = drawableText(f, s.text)
      if (!text) continue
      const size = height * TEXT_SIZE
      // Sit the letters on a baseline a little above the bottom of the box, as they look on screen.
      const lift = height * 0.24
      const rad = (rotation * Math.PI) / 180
      page.drawText(text, {
        x: at.x - Math.sin(rad) * lift,
        y: at.y + Math.cos(rad) * lift,
        size,
        font: f,
        color: rgb(0.05, 0.05, 0.1),
        rotate: degrees(rotation)
      })
    }
  }
}

/**
 * Form boxes point back at their page. Copying follows that link and would bring a second copy of
 * every page with it, so it's taken off before copying (keepFormFields puts it back).
 */
function unlinkWidgetPages(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (const a of annots.asArray()) {
      const dict = doc.context.lookup(a)
      if (dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))?.toString() === '/Widget') dict.delete(PDFName.of('P'))
    }
  }
}

/** Joins the form fields of the copied pages into the new PDF's form, so they can still be filled in. */
function keepFormFields(out: PDFDocument, used: { doc: PDFDocument; pages: PDFPage[] }[]): void {
  /** The boxes on the pages being kept. */
  const keptWidgets = new Set<string>()
  const roots: PDFRef[] = []
  const seen = new Set<string>()
  for (const page of out.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (const a of annots.asArray()) {
      const dict = out.context.lookup(a)
      if (!(dict instanceof PDFDict) || dict.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue
      // Copying gave the box a copy of its old page; point it at the page it's really on.
      dict.set(PDFName.of('P'), page.ref)
      keptWidgets.add(a.toString())
      // Climb to the top field; a widget that is its own field has no Parent.
      let ref: PDFRef | undefined = a instanceof PDFRef ? a : undefined
      let node: PDFDict = dict
      for (let guard = 0; guard < 20; guard++) {
        const parent = node.get(PDFName.of('Parent'))
        if (!(parent instanceof PDFRef)) break
        const pd = out.context.lookup(parent)
        if (!(pd instanceof PDFDict)) break
        ref = parent
        node = pd
      }
      if (ref && !seen.has(ref.toString())) {
        seen.add(ref.toString())
        roots.push(ref)
      }
    }
  }
  if (!roots.length) return

  // Boxes on pages that were left out are taken off their fields.
  const prune = (dict: PDFDict): boolean => {
    const kids = dict.lookup(PDFName.of('Kids'))
    if (!(kids instanceof PDFArray)) return true
    for (let i = kids.size() - 1; i >= 0; i--) {
      const ref = kids.get(i)
      const kid = kids.lookup(i)
      if (!(kid instanceof PDFDict)) continue
      const isWidget = kid.get(PDFName.of('Subtype'))?.toString() === '/Widget'
      if (isWidget ? !keptWidgets.has(ref.toString()) : !prune(kid)) kids.remove(i)
    }
    return kids.size() > 0
  }

  const acro = out.context.obj({}) as PDFDict
  const fields = out.context.obj([]) as PDFArray
  for (const r of roots) {
    const d = out.context.lookup(r)
    if (d instanceof PDFDict && (keptWidgets.has(r.toString()) || prune(d))) fields.push(r)
  }
  acro.set(PDFName.of('Fields'), fields)

  // The fonts and look the fields were drawn with come from the original files' forms.
  const fonts = out.context.obj({}) as PDFDict
  for (const { doc } of used) {
    const src = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    if (!src) continue
    const copier = PDFObjectCopier.for(doc.context, out.context)
    if (!acro.has(PDFName.of('DA'))) {
      const da = src.get(PDFName.of('DA'))
      if (da) acro.set(PDFName.of('DA'), copier.copy(da))
    }
    const dr = src.lookupMaybe(PDFName.of('DR'), PDFDict)
    const srcFonts = dr?.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (srcFonts)
      for (const [k, v] of srcFonts.entries()) {
        if (!fonts.has(k)) fonts.set(k, copier.copy(v))
      }
    const need = src.get(PDFName.of('NeedAppearances'))
    if (need) acro.set(PDFName.of('NeedAppearances'), need)
  }
  if (fonts.keys().length) acro.set(PDFName.of('DR'), out.context.obj({ Font: fonts }))
  out.catalog.set(PDFName.of('AcroForm'), out.context.register(acro))
}

export interface BuildOptions {
  /** Bake the form answers into the pages, so they can't be changed. */
  flatten?: boolean
  title?: string
}

/** Makes a new PDF from these pages, in this order, with their turns, signatures, text and form answers. */
export async function buildPdf(sources: PdfSource[], pages: PageItem[], opts: BuildOptions = {}): Promise<Uint8Array> {
  if (!pages.length) throw new Error('There are no pages to save.')
  const out = await PDFDocument.create()
  let helvetica: PDFFont | undefined
  const font = async (): Promise<PDFFont> => (helvetica ??= await out.embedFont(StandardFonts.Helvetica))

  // Copy each file's pages in one go, so the fonts and pictures they share are copied once.
  const bySource = new Map<string, number[]>()
  for (const p of pages) bySource.set(p.source, [...(bySource.get(p.source) ?? []), p.index])
  const copied = new Map<string, PDFPage[]>()
  const used: { doc: PDFDocument; pages: PDFPage[] }[] = []
  for (const [id, indexes] of bySource) {
    const src = sources.find((s) => s.id === id)
    if (!src) throw new Error('One of the PDFs is no longer open.')
    const doc = await loadPdf(src.bytes, src.password)
    fillForm(doc, src.values, Object.keys(src.values).length ? await doc.embedFont(StandardFonts.Helvetica) : undefined)
    if (opts.flatten) {
      try {
        doc.getForm().flatten()
      } catch {
        // No form, or one that can't be flattened: the answers stay as fillable boxes.
      }
    }
    unlinkWidgetPages(doc)
    const unique = [...new Set(indexes)]
    const got = await out.copyPages(doc, unique)
    unique.forEach((index, i) => copied.set(`${id}#${index}`, [got[i]]))
    // A page used twice needs a copy of its own each extra time.
    const seen = new Set<number>()
    for (const index of indexes) {
      if (!seen.has(index)) {
        seen.add(index)
        continue
      }
      const [again] = await out.copyPages(doc, [index])
      copied.get(`${id}#${index}`)!.push(again)
    }
    used.push({ doc, pages: got })
  }

  for (const p of pages) {
    const page = copied.get(`${p.source}#${p.index}`)!.shift()!
    out.addPage(page)
    if (p.turn) page.setRotation(degrees((((page.getRotation().angle + p.turn) % 360) + 360) % 360))
    await drawStamps(out, page, p.stamps, font)
  }

  if (!opts.flatten) keepFormFields(out, used)
  if (opts.title) out.setTitle(opts.title)
  out.setProducer('Orbit')
  return out.save()
}

/** Splits page numbers 0…count-1 into runs of `every` pages: 5 pages every 2 → [[0,1],[2,3],[4]]. */
export function splitEvery(count: number, every: number): number[][] {
  const n = Math.max(1, Math.floor(every))
  const parts: number[][] = []
  for (let i = 0; i < count; i += n) parts.push(Array.from({ length: Math.min(n, count - i) }, (_, k) => i + k))
  return parts
}

/**
 * Reads page ranges as people type them: "1-3, 5, 8-" (1-based, in a document of `count` pages).
 * Returns 0-based page numbers in the order given, or null if it doesn't make sense.
 */
export function parsePageRanges(text: string, count: number): number[] | null {
  const out: number[] = []
  const parts = text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return null
  for (const part of parts) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part)
    if (m) {
      const from = m[1] ? Number(m[1]) : 1
      const to = m[2] ? Number(m[2]) : count
      if (from < 1 || to > count || from > to) return null
      for (let i = from; i <= to; i++) out.push(i - 1)
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1 || n > count) return null
      out.push(n - 1)
    } else return null
  }
  return out
}

/** "Contract.pdf" → "Contract (signed).pdf" */
export function pdfName(original: string, suffix: string): string {
  const base = original.replace(/\.pdf$/i, '')
  return `${base}${suffix ? ` (${suffix})` : ''}.pdf`
}
