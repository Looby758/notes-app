/** A spreadsheet as the viewer shows it: plain grids of display text. Shared by the file reader and Google Sheets. */

export interface Cell {
  text: string
  /** Numbers (and dates) line up on the right, as in Excel. */
  num?: boolean
}

export interface Sheet {
  name: string
  rows: Cell[][]
  /** How many columns the widest row has. */
  cols: number
  /** Column widths in characters, where the workbook sets them. */
  widths?: (number | undefined)[]
  hidden?: boolean
}

/** Drops empty rows and columns from the bottom and right, and counts the columns left. */
export function finishSheet(sheet: Sheet): Sheet {
  const rows = sheet.rows.map((r) => {
    let end = r.length
    while (end > 0 && !r[end - 1]?.text) end--
    return r.slice(0, end)
  })
  let last = rows.length
  while (last > 0 && rows[last - 1].length === 0) last--
  rows.length = last
  const cols = rows.reduce((max, r) => Math.max(max, r.length), 0)
  return { ...sheet, rows, cols }
}

// ---------- Google Sheets (.gsheet) ----------

/** What a .gsheet file points to. Google Drive for desktop writes these as small JSON files. */
export interface GsheetLink {
  id: string
  /** Needed for some files shared by link. */
  resourceKey?: string
  /** The Google account the file belongs to, as Drive recorded it. */
  email?: string
}

export function parseGsheetFile(text: string): GsheetLink | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const id =
    str(data.doc_id) ??
    str(data.resource_id)?.replace(/^spreadsheet:/, '') ??
    /\/spreadsheets\/d\/([\w-]+)/.exec(str(data.url) ?? '')?.[1]
  if (!id || !/^[\w-]+$/.test(id)) return null
  return { id, resourceKey: str(data.resource_key), email: str(data.email) }
}

/** Where to switch the Sheets API on for your Google project. */
export const ENABLE_SHEETS_API_URL = 'https://console.cloud.google.com/apis/library/sheets.googleapis.com'

export const gsheetWebUrl = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`

/** The parts of a Sheets API `spreadsheets.get` (with grid data) we use. */
interface ApiSpreadsheet {
  sheets?: {
    properties?: { title?: string; hidden?: boolean; sheetType?: string }
    data?: {
      startRow?: number
      startColumn?: number
      rowData?: { values?: { formattedValue?: string; effectiveValue?: { numberValue?: number } }[] }[]
      columnMetadata?: { pixelSize?: number }[]
    }[]
  }[]
}

/** Turns the Sheets API's answer into the viewer's sheets. Google has already formatted every value. */
export function sheetsFromApi(json: ApiSpreadsheet): Sheet[] {
  return (json.sheets ?? [])
    .filter((s) => (s.properties?.sheetType ?? 'GRID') === 'GRID')
    .map((s, i) => {
      const rows: Cell[][] = []
      const widths: (number | undefined)[] = []
      for (const grid of s.data ?? []) {
        const top = grid.startRow ?? 0
        const left = grid.startColumn ?? 0
        ;(grid.rowData ?? []).forEach((row, r) => {
          const cells = (rows[top + r] ??= [])
          ;(row.values ?? []).forEach((v, c) => {
            cells[left + c] = { text: v.formattedValue ?? '', num: typeof v.effectiveValue?.numberValue === 'number' }
          })
        })
        // Google measures in pixels; the viewer in characters of about 7.5px.
        ;(grid.columnMetadata ?? []).forEach((m, c) => {
          if (m.pixelSize && m.pixelSize !== 100) widths[left + c] = Math.max(1, (m.pixelSize - 10) / 7.5)
        })
      }
      return finishSheet({
        name: s.properties?.title ?? `Sheet${i + 1}`,
        hidden: !!s.properties?.hidden,
        rows: Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? { text: '' })),
        cols: 0,
        widths
      })
    })
}
