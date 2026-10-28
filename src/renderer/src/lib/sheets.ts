import JSZip from 'jszip'
import { finishSheet as finish, type Cell, type Sheet } from '@shared/sheet'

/**
 * Reads spreadsheets (.xlsx/.xlsm workbooks, .csv and .tsv files) into plain grids of display text,
 * for viewing them in a tab. Workbooks are zipped XML, so this needs nothing beyond JSZip. Formulas show
 * the result Excel saved with the file; nothing is recalculated.
 */

export type { Cell, Sheet }

// ---------- CSV / TSV ----------

/** Splits delimited text into rows of cells, honouring "quoted, cells" and doubled "" quotes. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows
}

const NUMBERISH = /^[-+(]?[$£€¥]?\s?\d[\d,]*(\.\d+)?%?\)?$/

export function delimitedSheet(name: string, text: string, delimiter: string): Sheet {
  return finish({ name, rows: parseDelimited(text, delimiter).map((r) => r.map((t) => ({ text: t, num: NUMBERISH.test(t.trim()) }))), cols: 0 })
}

// ---------- XLSX ----------

/** Excel's built-in number formats, by id (the ones that change how a value reads). */
const BUILTIN_FORMATS: Record<number, string> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  37: '#,##0',
  38: '#,##0',
  39: '#,##0.00',
  40: '#,##0.00',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  49: '@'
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function unescapeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? whole)
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(attrs)
  return m ? unescapeXml(m[1]) : undefined
}

/** Every `<tag …>` (or `<x:tag …>`) element: its attributes and inner XML. */
function elements(xml: string, tag: string): { attrs: string; inner: string }[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g')
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', inner: m[2] ?? '' }))
}

/** The text of a string item: all its runs joined, minus phonetic hints. */
function itemText(inner: string): string {
  return elements(inner.replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, ''), 't')
    .map((t) => unescapeXml(t.inner))
    .join('')
}

/** "AB12" → column 27 (0-based). */
function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const code = ch.charCodeAt(0)
    if (code < 65 || code > 90) break
    n = n * 26 + code - 64
  }
  return n - 1
}

/** 0 → "A", 27 → "AB". */
export function columnName(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A format's first section with quoted text, [colours] and escapes taken out, for telling what it shows. */
function formatSkeleton(code: string): string {
  return code
    .split(';')[0]
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .toLowerCase()
}

function isDateFormat(code: string): boolean {
  const s = formatSkeleton(code)
  return /[dyhs]/.test(s) || (/m/.test(s) && !/[0#?]/.test(s))
}

/** The literal text a number format puts before the digits, like "$" or "£". */
function formatPrefix(code: string): string {
  const first = code.split(';')[0]
  let out = ''
  for (let i = 0; i < first.length; i++) {
    const c = first[i]
    if ('0#?.,'.includes(c)) break
    if (c === '"') {
      const end = first.indexOf('"', i + 1)
      out += first.slice(i + 1, end === -1 ? undefined : end)
      i = end === -1 ? first.length : end
    } else if (c === '[') {
      const end = first.indexOf(']', i)
      const inside = first.slice(i + 1, end === -1 ? undefined : end)
      // [$£-809] is a currency symbol; [Red] and the like are not shown.
      if (inside.startsWith('$')) out += inside.slice(1).split('-')[0]
      i = end === -1 ? first.length : end
    } else if (c === '\\') out += first[++i] ?? ''
    else if (c === '_' || c === '*') i++
    else if (c !== ' ' || out) out += c
  }
  return out
}

const EPOCH_1900 = Date.UTC(1899, 11, 30)
const EPOCH_1904 = Date.UTC(1904, 0, 1)

function serialToDate(serial: number, date1904: boolean): Date {
  return new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + Math.round(serial * 86400000))
}

function formatDate(date: Date, code: string): string {
  const s = formatSkeleton(code)
  const hasTime = /[hs]/.test(s)
  const hasDate = /[dy]/.test(s) || (/m/.test(s) && !hasTime)
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }
  if (hasDate) opts.dateStyle = 'medium'
  if (hasTime) opts.timeStyle = /s/.test(s) ? 'medium' : 'short'
  return new Intl.DateTimeFormat(undefined, opts).format(date)
}

/** How a number reads with the format `code`, close enough to Excel for viewing. */
export function formatNumber(value: number, code: string | undefined, date1904 = false): string {
  if (!code || /^general$/i.test(code) || code === '@') return String(Number(value.toPrecision(15)))
  if (isDateFormat(code)) return formatDate(serialToDate(value, date1904), code)
  const s = formatSkeleton(code)
  const decimals = /\.([0#?]+)/.exec(s)?.[1].length ?? 0
  if (/e[+-]/.test(s)) return value.toExponential(decimals).toUpperCase()
  const percent = s.includes('%')
  const n = percent ? value * 100 : value
  const digits = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: s.includes(',')
  }).format(Math.abs(n))
  const negative = n < 0 && digits.replace(/[^1-9]/g, '') !== ''
  return `${negative ? '-' : ''}${formatPrefix(code)}${digits}${percent ? '%' : ''}`
}

async function zipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0]
  return file ? file.async('string') : null
}

/** The targets of a .rels file, by relationship id, as paths inside the zip. */
function relationships(xml: string, base: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>()
  for (const { attrs } of elements(xml, 'Relationship')) {
    const id = attr(attrs, 'Id')
    const target = attr(attrs, 'Target')
    if (!id || !target) continue
    const path = target.startsWith('/') ? target.slice(1) : normalise(base + target)
    map.set(id, { target: path, type: attr(attrs, 'Type') ?? '' })
  }
  return map
}

function normalise(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

function readWorksheet(xml: string, strings: string[], formats: (string | undefined)[], date1904: boolean): Pick<Sheet, 'rows' | 'widths'> {
  const rows: Cell[][] = []
  let nextRow = 0
  for (const row of elements(xml, 'row')) {
    const r = Number(attr(row.attrs, 'r') ?? nextRow + 1) - 1
    nextRow = r + 1
    const cells: Cell[] = []
    let nextCol = 0
    for (const c of elements(row.inner, 'c')) {
      const ref = attr(c.attrs, 'r')
      const col = ref ? columnIndex(ref) : nextCol
      nextCol = col + 1
      const type = attr(c.attrs, 't') ?? 'n'
      const raw = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(c.inner)?.[1]
      const value = raw === undefined ? undefined : unescapeXml(raw)
      const format = formats[Number(attr(c.attrs, 's') ?? 0)]
      let cell: Cell | null = null
      if (type === 's') cell = { text: strings[Number(value)] ?? '' }
      else if (type === 'inlineStr') cell = { text: itemText(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(c.inner)?.[1] ?? '') }
      else if (value === undefined) {
        // Some apps save formulas without their result; show the formula rather than nothing.
        const formula = /<(?:\w+:)?f(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?f>/.exec(c.inner)?.[1]
        cell = formula ? { text: `=${unescapeXml(formula)}` } : null
      }
      else if (type === 'b') cell = { text: value === '1' ? 'TRUE' : 'FALSE' }
      else if (type === 'e' || type === 'str') cell = { text: value }
      else if (type === 'd') {
        const date = new Date(value)
        cell = isNaN(date.getTime()) ? { text: value } : { text: formatDate(date, format ?? 'yyyy-mm-dd h:mm'), num: true }
      } else {
        const n = Number(value)
        cell = isNaN(n) ? { text: value } : { text: formatNumber(n, format, date1904), num: true }
      }
      if (cell) cells[col] = cell
    }
    rows[r] = Array.from(cells, (c) => c ?? { text: '' })
  }
  const widths: (number | undefined)[] = []
  for (const col of elements(/<(?:\w+:)?cols>([\s\S]*?)<\/(?:\w+:)?cols>/.exec(xml)?.[1] ?? '', 'col')) {
    const width = Number(attr(col.attrs, 'width'))
    const min = Number(attr(col.attrs, 'min'))
    const max = Math.min(Number(attr(col.attrs, 'max')), min + 200)
    if (width > 0 && min > 0) for (let i = min; i <= max; i++) widths[i - 1] = width
  }
  return { rows: Array.from(rows, (r) => r ?? []), widths }
}

/** Every sheet in an .xlsx/.xlsm workbook, in tab order. */
export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<Sheet[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('This doesn’t look like an Excel workbook, or it’s password-protected.')
  }
  const rootRels = relationships((await zipText(zip, '_rels/.rels')) ?? '', '')
  const bookPath = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml'
  const book = await zipText(zip, bookPath)
  if (!book) throw new Error('This doesn’t look like an Excel workbook.')
  const base = bookPath.slice(0, bookPath.lastIndexOf('/') + 1)
  const rels = relationships((await zipText(zip, `${base}_rels/${bookPath.slice(base.length)}.rels`)) ?? '', base)
  const relOfType = (type: string): string | undefined => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.target

  const stringsXml = await zipText(zip, relOfType('sharedStrings') ?? `${base}sharedStrings.xml`)
  const strings = stringsXml ? elements(stringsXml, 'si').map((si) => itemText(si.inner)) : []

  const stylesXml = (await zipText(zip, relOfType('styles') ?? `${base}styles.xml`)) ?? ''
  const custom = new Map(elements(stylesXml, 'numFmt').map((f) => [Number(attr(f.attrs, 'numFmtId')), attr(f.attrs, 'formatCode') ?? '']))
  const xfs = /<(?:\w+:)?cellXfs[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)?.[1] ?? ''
  const formats = elements(xfs, 'xf').map((xf) => {
    const id = Number(attr(xf.attrs, 'numFmtId') ?? 0)
    return custom.get(id) ?? BUILTIN_FORMATS[id]
  })

  const date1904 = /<(?:\w+:)?workbookPr[^>]*\sdate1904="(1|true)"/.test(book)
  const sheets: Sheet[] = []
  for (const { attrs } of elements(book, 'sheet')) {
    const rel = rels.get(attr(attrs, 'id') ?? '')
    const name = attr(attrs, 'name') ?? `Sheet${sheets.length + 1}`
    const hidden = (attr(attrs, 'state') ?? 'visible') !== 'visible'
    // Chart sheets and the like have no cells to show.
    if (!rel || !rel.type.endsWith('/worksheet')) continue
    const xml = await zipText(zip, rel.target)
    if (xml === null) continue
    sheets.push(finish({ name, hidden, cols: 0, ...readWorksheet(xml, strings, formats, date1904) }))
  }
  if (sheets.length === 0) throw new Error('This workbook has no sheets to show.')
  return sheets
}

/** Reads any file Notes can show as a spreadsheet, by its extension. */
export async function readSpreadsheet(name: string, data: ArrayBuffer): Promise<Sheet[]> {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder().decode(data)
    return [delimitedSheet(name.replace(/\.[^.]+$/, ''), text, ext === 'tsv' ? '\t' : ',')]
  }
  return readWorkbook(data)
}
