import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { buildPdf, loadPdf, parsePageRanges, pdfName, PdfLockedError, readFields, splitEvery, tidyFieldName, toPdfPoint, type PageItem, type PdfSource } from './pdfEdit'

/** A small PDF with "A1", "A2"… written on its pages, and a form on the first two. */
async function makePdf(letter: string, pages: number, opts: { form?: boolean; password?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) doc.addPage([300, 400]).drawText(`${letter}${i}`, { x: 40, y: 300, size: 30, font })
  if (opts.form) {
    const form = doc.getForm()
    form.createTextField('full_name').addToPage(doc.getPage(0), { x: 40, y: 100, width: 200, height: 24 })
    form.createCheckBox('agree').addToPage(doc.getPage(1), { x: 40, y: 100, width: 18, height: 18 })
    const dd = form.createDropdown('colour')
    dd.addOptions(['Red', 'Green'])
    dd.addToPage(doc.getPage(0), { x: 40, y: 50, width: 100, height: 20 })
  }
  if (opts.password) doc.encrypt({ userPassword: opts.password, ownerPassword: `${opts.password}-owner` })
  return doc.save()
}

const source = (id: string, bytes: Uint8Array, extra: Partial<PdfSource> = {}): PdfSource => ({ id, name: `${id}.pdf`, bytes, values: {}, ...extra })
const page = (src: string, index: number, extra: Partial<PageItem> = {}): PageItem => ({ key: `${src}${index}`, source: src, index, turn: 0, stamps: [], ...extra })

/** Which of our "A1"-style labels each page of a PDF carries (read from the drawing commands). */
async function labels(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}

describe('pdf editor', () => {
  it('merges, reorders and leaves pages out', async () => {
    const a = source('a', await makePdf('A', 3))
    const b = source('b', await makePdf('B', 2))
    const out = await buildPdf([a, b], [page('b', 1), page('a', 2), page('a', 0)])
    expect(await labels(out)).toBe(3)
    const doc = await PDFDocument.load(out)
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 300, height: 400 },
      { width: 300, height: 400 },
      { width: 300, height: 400 }
    ])
  })

  it('turns pages', async () => {
    const a = source('a', await makePdf('A', 2))
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 0, { turn: 90 }), page('a', 1, { turn: 270 })]))
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 270])
  })

  it('fills in forms and keeps them fillable', async () => {
    const a = source('a', await makePdf('A', 3, { form: true }), { values: { full_name: 'Sam Smith', agree: true, colour: 'Green' } })
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 1), page('a', 0)]))
    const fields = readFields(out)
    expect(fields.map((f) => [f.name, f.value])).toEqual(
      expect.arrayContaining([
        ['full_name', 'Sam Smith'],
        ['agree', true],
        ['colour', 'Green']
      ])
    )
    // The pages moved, so the boxes are on the pages they moved to.
    expect(fields.find((f) => f.name === 'agree')!.pages).toEqual([0])
    expect(fields.find((f) => f.name === 'full_name')!.pages).toEqual([1])
  })

  it('drops the boxes of pages that were taken out', async () => {
    const a = source('a', await makePdf('A', 3, { form: true }))
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 0)]))
    expect(readFields(out).map((f) => f.name).sort()).toEqual(['colour', 'full_name'])
  })

  it('flattens answers into the page', async () => {
    const a = source('a', await makePdf('A', 2, { form: true }), { values: { full_name: 'Sam' } })
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 0), page('a', 1)], { flatten: true }))
    expect(readFields(out)).toEqual([])
  })

  it('reads fields with tidy names', async () => {
    const doc = await PDFDocument.load(await makePdf('A', 2, { form: true }))
    const fields = readFields(doc)
    expect(fields.find((f) => f.name === 'full_name')).toMatchObject({ label: 'Full name', kind: 'text', pages: [0] })
    expect(fields.find((f) => f.name === 'colour')).toMatchObject({ kind: 'choice', options: ['Red', 'Green'] })
    expect(fields.find((f) => f.name === 'agree')).toMatchObject({ kind: 'check', value: false, pages: [1] })
    expect(tidyFieldName('form1[0].page1[0].firstName[0]')).toBe('First name')
    expect(tidyFieldName('agree.0')).toBe('Agree 1')
    expect(tidyFieldName('Check Box3')).toBe('Check box3')
  })

  it('opens password-protected PDFs and saves them without the password', async () => {
    const bytes = await makePdf('A', 2, { password: 'secret' })
    await expect(loadPdf(bytes)).rejects.toBeInstanceOf(PdfLockedError)
    await expect(loadPdf(bytes, 'nope')).rejects.toMatchObject({ wrong: true })
    const a = source('a', bytes, { password: 'secret' })
    const out = await buildPdf([a], [page('a', 1)])
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
  })

  it('draws signatures and text on pages', async () => {
    // A 1×1 PNG.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const a = source('a', await makePdf('A', 1))
    const stamps = [
      { id: 's', kind: 'image' as const, x: 0.1, y: 0.7, w: 0.3, h: 0.1, image: png },
      { id: 't', kind: 'text' as const, x: 0.1, y: 0.1, w: 0.3, h: 0.05, text: 'Signed 21/11/2026 ✓' }
    ]
    const out = await buildPdf([a], [page('a', 0, { stamps, turn: 90 })])
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
    expect(out.byteLength).toBeGreaterThan(1000)
  })

  it('places things on turned pages', () => {
    const box = { x: 0, y: 0, width: 300, height: 400 }
    // The top-left corner as you see it.
    expect(toPdfPoint(0, 0, 0, box)).toEqual({ x: 0, y: 400 })
    expect(toPdfPoint(0, 0, 90, box)).toEqual({ x: 0, y: 0 })
    expect(toPdfPoint(0, 0, 180, box)).toEqual({ x: 300, y: 0 })
    expect(toPdfPoint(0, 0, 270, box)).toEqual({ x: 300, y: 400 })
    // The bottom-right corner.
    expect(toPdfPoint(1, 1, 0, box)).toEqual({ x: 300, y: 0 })
    expect(toPdfPoint(1, 1, 90, box)).toEqual({ x: 300, y: 400 })
  })

  it('splits and reads page ranges', () => {
    expect(splitEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]])
    expect(splitEvery(3, 1)).toEqual([[0], [1], [2]])
    expect(parsePageRanges('1-3, 5', 6)).toEqual([0, 1, 2, 4])
    expect(parsePageRanges('4-', 6)).toEqual([3, 4, 5])
    expect(parsePageRanges('7', 6)).toBeNull()
    expect(parsePageRanges('a', 6)).toBeNull()
    expect(pdfName('Contract.PDF', 'signed')).toBe('Contract (signed).pdf')
  })
})

describe('pdf editor file size', () => {
  it("doesn't bring along the pages that were left out", async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 40; i++) doc.addPage([300, 400]).drawText(Array.from({ length: 3000 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(''), { x: 0, y: 200, size: 4, font })
    const form = doc.getForm()
    const radio = form.createRadioGroup('pick')
    radio.addOptionToPage('one', doc.getPage(0), { x: 10, y: 10, width: 10, height: 10 })
    radio.addOptionToPage('two', doc.getPage(39), { x: 10, y: 10, width: 10, height: 10 })
    const bytes = await doc.save()
    const out = await buildPdf([source('a', bytes)], [page('a', 0)])
    expect(out.byteLength).toBeLessThan(bytes.byteLength / 5)
    const fields = readFields(await PDFDocument.load(out))
    expect(fields).toMatchObject([{ name: 'pick', kind: 'radio', pages: [0] }])
  })
})

describe('pdf editor duplicates', () => {
  it('can use a page twice', async () => {
    const a = source('a', await makePdf('A', 2))
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 0), page('a', 0, { key: 'again', turn: 90 }), page('a', 1)]))
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0])
  })
})

describe('pdf editor text size', () => {
  it('gives long answers a sensible size', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const notes = doc.getForm().createTextField('notes')
    notes.enableMultiline()
    notes.addToPage(doc.getPage(0), { x: 10, y: 10, width: 280, height: 80 })
    const a = source('a', await doc.save(), { values: { notes: 'A longer answer that should wrap onto more than one line.' } })
    const out = await PDFDocument.load(await buildPdf([a], [page('a', 0)]))
    const da = out.getForm().getTextField('notes').acroField.getDefaultAppearance() ?? ''
    expect(Number(/([\d.]+)\s+Tf/.exec(da)?.[1])).toBeLessThanOrEqual(14)
  })
})
