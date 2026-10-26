/**
 * Markdown tables as data, and back:
 *   | Name | Score |
 *   | :--- | ----: |
 *   | Sam  |    10 |
 * Writing a table lines its columns up, so the markdown stays readable too.
 */

export type Align = '' | 'left' | 'center' | 'right'

export interface TableData {
  header: string[]
  align: Align[]
  rows: string[][]
}

export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim())
}

export function parseTable(text: string): TableData {
  const lines = text.split('\n').filter((l) => l.trim())
  const header = splitRow(lines[0] ?? '')
  const align = splitRow(lines[1] ?? '').map((d): Align => {
    const left = d.startsWith(':')
    const right = d.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
  })
  const width = header.length
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l)
    return Array.from({ length: width }, (_, i) => cells[i] ?? '')
  })
  return { header, align: Array.from({ length: width }, (_, i) => align[i] ?? ''), rows }
}

/** Escapes a cell's pipes and keeps it on one line. */
const cleanCell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim()

export function formatTable(t: TableData): string {
  const width = t.header.length
  const cells = [t.header, ...t.rows].map((r) => Array.from({ length: width }, (_, i) => cleanCell(r[i] ?? '')))
  const widths = Array.from({ length: width }, (_, i) => Math.max(3, ...cells.map((r) => [...r[i]].length)))
  const pad = (s: string, i: number): string => {
    const gap = widths[i] - [...s].length
    if (t.align[i] === 'right') return ' '.repeat(gap) + s
    if (t.align[i] === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2))
    return s + ' '.repeat(gap)
  }
  const row = (r: string[]): string => `| ${r.map(pad).join(' | ')} |`
  const divider = `| ${widths
    .map((w, i) => {
      const a = t.align[i]
      const dashes = '-'.repeat(Math.max(3, w - (a === 'center' ? 2 : a ? 1 : 0)))
      return a === 'center' ? `:${dashes}:` : a === 'right' ? `${dashes}:` : a === 'left' ? `:${dashes}` : dashes
    })
    .join(' | ')} |`
  return [row(cells[0]), divider, ...cells.slice(1).map(row)].join('\n')
}

// ---------- editing ----------

export const addRow = (t: TableData, after: number): TableData => {
  const rows = [...t.rows]
  rows.splice(after + 1, 0, t.header.map(() => ''))
  return { ...t, rows }
}

export const removeRow = (t: TableData, index: number): TableData => ({ ...t, rows: t.rows.filter((_, i) => i !== index) })

export const addColumn = (t: TableData, after: number): TableData => {
  const insert = <T>(arr: T[], v: T): T[] => [...arr.slice(0, after + 1), v, ...arr.slice(after + 1)]
  return { header: insert(t.header, `Column ${t.header.length + 1}`), align: insert(t.align, '' as Align), rows: t.rows.map((r) => insert(r, '')) }
}

export const removeColumn = (t: TableData, index: number): TableData =>
  t.header.length <= 1
    ? t
    : { header: t.header.filter((_, i) => i !== index), align: t.align.filter((_, i) => i !== index), rows: t.rows.map((r) => r.filter((_, i) => i !== index)) }

export const setAlign = (t: TableData, column: number, align: Align): TableData => ({ ...t, align: t.align.map((a, i) => (i === column ? align : a)) })

/** Sorts rows by a column: numbers as numbers, everything else alphabetically. */
export function sortBy(t: TableData, column: number, descending = false): TableData {
  const num = (s: string): number | null => (/^-?[\d,.]+%?$/.test(s.trim()) ? parseFloat(s.replace(/[,%]/g, '')) : null)
  const rows = [...t.rows].sort((a, b) => {
    const x = a[column] ?? ''
    const y = b[column] ?? ''
    const nx = num(x)
    const ny = num(y)
    const c = nx !== null && ny !== null ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
    return descending ? -c : c
  })
  return { ...t, rows }
}

export const setCell = (t: TableData, row: number, column: number, value: string): TableData =>
  row < 0
    ? { ...t, header: t.header.map((h, i) => (i === column ? value : h)) }
    : { ...t, rows: t.rows.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === column ? value : c)) : r)) }
