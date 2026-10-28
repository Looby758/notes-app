/**
 * Reading a bank statement PDF. A PDF has no table in it, only bits of text at positions on the
 * page, so this rebuilds the lines, finds the column headings (Date, Paid out, Paid in, Balance…)
 * and reads each transaction off the line it's on. The result is a small table (Date, Description,
 * Amount) that goes through the same checks as a CSV statement.
 */

import { parseAmount, parseDate } from './money'

/** A piece of text on a page. x and y are in points from the top-left; y is the baseline. */
export interface PdfItem {
  str: string
  x: number
  y: number
  width: number
}

interface Cell {
  text: string
  x0: number
  x1: number
}

type ColumnKind = 'date' | 'out' | 'in' | 'amount' | 'balance'

interface Column {
  kind: ColumnKind
  x0: number
  x1: number
}

/** Groups a page's text into lines (top to bottom) of cells (left to right). */
export function pageLines(items: PdfItem[]): { y: number; cells: Cell[] }[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: PdfItem[][] = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - item.y) <= 3) line.push(item)
    else lines.push([item])
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x)
    const cells: Cell[] = []
    for (const item of line) {
      const last = cells[cells.length - 1]
      // Words of one phrase sit close together; columns are further apart.
      if (last && item.x - last.x1 < 6) {
        last.text += (item.x - last.x1 > 1 && !last.text.endsWith(' ') ? ' ' : '') + item.str
        last.x1 = Math.max(last.x1, item.x + item.width)
      } else {
        cells.push({ text: item.str, x0: item.x, x1: item.x + item.width })
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim()
    return { y: line[0].y, cells }
  })
}

const HEADINGS: [RegExp, ColumnKind][] = [
  [/^(transaction |posting |entry )?date$/i, 'date'],
  [/^(paid out|money out|withdrawn|withdrawals?|debits?|payments?( out)?|out|spent)( \(?£\)?)?$/i, 'out'],
  [/^(paid in|money in|deposits?|credits?|receipts?|payments? in|in|received)( \(?£\)?)?$/i, 'in'],
  [/^amount( \(?(£|gbp)\)?)?$/i, 'amount'],
  [/^balance( \(?(£|gbp)\)?)?$/i, 'balance']
]

/** The columns named on a line, if it's the line of column headings. */
function headingColumns(cells: Cell[]): Column[] | null {
  const cols: Column[] = []
  for (const c of cells) {
    // "Date Description" can come out as one piece of text.
    const text = c.text.replace(/^date\b.*/i, 'Date')
    const match = HEADINGS.find(([p]) => p.test(text))
    if (match) cols.push({ kind: match[1], x0: c.x0, x1: c.x1 })
  }
  const has = (k: ColumnKind): boolean => cols.some((c) => c.kind === k)
  if (!has('date')) return null
  if (!(has('out') || has('in') || has('amount'))) return null
  return cols
}

/** "12.34", "£1,234.56", "12.34 CR", "-5.00", "(5.00)": money, always with pence. */
const MONEY = /^(\(?[-+]?£?-?\d{1,3}(,?\d{3})*\.\d{2}\)?)( ?(CR|DR|D|C|OD))?$/i

function money(text: string): number | null {
  const m = MONEY.exec(text.replace(/\s+/g, ' ').trim())
  if (!m) return null
  let pence = parseAmount(m[1])
  if (pence === null) return null
  const suffix = (m[4] ?? '').toUpperCase()
  if (suffix === 'DR' || suffix === 'D' || suffix === 'OD') pence = -Math.abs(pence)
  return pence
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A date at the start of a line's text, which may leave out the year ("05 Jan"). */
const DATE_START =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)? ?[-\s]?(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:[-\s]?(?:\d{4}|\d{2}(?!\d)))?)(?=\s|$)/i

interface DayMonth {
  date: string | null
  day: number
  month: number
}

function readDateStart(text: string): { when: DayMonth; rest: string } | null {
  const m = DATE_START.exec(text)
  if (!m) return null
  const raw = m[1]
  const rest = text.slice(raw.length).trim()
  const full = parseDate(raw.replace(/^(\d{1,2})([a-z])/i, '$1 $2').replace(/([a-z])(\d)/i, '$1 $2'))
  if (full) return { when: { date: full, day: +full.slice(8), month: +full.slice(5, 7) }, rest }
  const dm = /^(\d{1,2})(?:st|nd|rd|th)?\s?-?\s?([a-z]{3})/i.exec(raw)
  if (!dm) return null
  const month = MONTHS.indexOf(dm[2].toLowerCase()) + 1
  if (!month || +dm[1] < 1 || +dm[1] > 31) return null
  return { when: { date: null, day: +dm[1], month }, rest }
}

/** Lines that aren't transactions even though they have amounts on them. */
const NOT_A_PAYMENT =
  /^(total|totals|sub-?total|balance (brought|carried) forward|(opening|closing|start(ing)?|end(ing)?|previous|new) balance|brought forward|carried forward|b\/f|c\/f)\b/i

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Reads the transactions of a statement from its pages' text. Returns rows as a table with a
 * heading row (Date, Description, Amount), money going out as negative amounts. Empty when no
 * transactions were found.
 */
export function statementFromPdf(pages: PdfItem[][], today = new Date()): string[][] {
  const allText = pages.flatMap((p) => p.map((i) => i.str)).join(' ')
  // The statement's year, from dates written out in full ("1 January 2026", "01/01/2026"), else any year.
  const yearsIn = (pattern: RegExp): number[] =>
    [...allText.matchAll(pattern)].map((m) => +(m[1] ?? m[2])).filter((y) => y >= 1990 && y <= today.getFullYear() + 1)
  const dated = yearsIn(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,? (\d{4})\b|\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/gi)
  const years = dated.length ? dated : yearsIn(/\b(\d{4})\b/g)
  let year = years.length ? Math.min(...years) : today.getFullYear()
  let lastMonth = 0

  const rows: string[][] = [['Date', 'Description', 'Amount']]
  let columns: Column[] | null = null
  let date: string | null = null
  let balance: number | null = null

  const dateOf = (when: DayMonth): string => {
    if (when.date) {
      year = +when.date.slice(0, 4)
      lastMonth = when.month
      return when.date
    }
    // Statements often leave the year out: carry on from the last year seen, ticking over in January.
    if (lastMonth && when.month < lastMonth - 6) year++
    lastMonth = when.month
    return `${year}-${pad(when.month)}-${pad(when.day)}`
  }

  const columnFor = (cell: Cell): Column | null => {
    if (!columns) return null
    let best: Column | null = null
    let bestDistance = Infinity
    for (const col of columns) {
      if (col.kind === 'date') continue
      // Amounts and their headings are usually lined up on the right, sometimes centred.
      const distance = Math.min(Math.abs(cell.x1 - col.x1), Math.abs((cell.x0 + cell.x1) / 2 - (col.x0 + col.x1) / 2))
      if (distance < bestDistance) {
        bestDistance = distance
        best = col
      }
    }
    return bestDistance < 60 ? best : null
  }

  interface Payment {
    y: number
    date: string
    pence: number
    newBalance: number | null
    parts: { y: number; text: string }[]
  }

  for (const page of pages) {
    const payments: Payment[] = []
    /** Text on lines without amounts: descriptions that wrap onto a second line. */
    const loose: { y: number; text: string }[] = []

    for (const { y, cells } of pageLines(page)) {
      const heading = headingColumns(cells)
      if (heading) {
        columns = heading
        continue
      }
      const amounts: { cell: Cell; pence: number }[] = []
      const words: Cell[] = []
      for (const c of cells) {
        const pence = money(c.text)
        if (pence !== null) amounts.push({ cell: c, pence })
        else words.push(c)
      }
      let text = words.map((w) => w.text).join(' ')
      const start = readDateStart(text)
      if (start) {
        date = dateOf(start.when)
        text = start.rest
      }
      if (!amounts.length) {
        if (date && text && (columns || start) && !/^page \d+( of \d+)?$/i.test(text)) loose.push({ y, text })
        continue
      }

      let pence: number | null = null
      let newBalance: number | null = null
      if (columns) {
        for (const a of amounts) {
          const col = columnFor(a.cell)
          if (col?.kind === 'balance') newBalance = a.pence
          else if (col?.kind === 'out') pence = -Math.abs(a.pence)
          else if (col?.kind === 'in') pence = Math.abs(a.pence)
          else if (col?.kind === 'amount') pence = a.pence
        }
      } else if (amounts.length >= 2) {
        // No headings found: the last amount is the balance when there are two…
        newBalance = amounts[amounts.length - 1].pence
        pence = amounts[amounts.length - 2].pence
      } else if (date) {
        pence = amounts[0].pence
      } else {
        // …and a lone amount before any dates is the opening balance.
        newBalance = amounts[0].pence
      }

      if (pence === null || !date || NOT_A_PAYMENT.test(text)) {
        if (newBalance !== null) balance = newBalance
        continue
      }
      // When the balance is shown, it says for sure which way the money went.
      if (balance !== null && newBalance !== null && Math.abs(Math.abs(newBalance - balance) - Math.abs(pence)) < 1) {
        pence = newBalance < balance ? -Math.abs(pence) : Math.abs(pence)
      }
      if (newBalance !== null) balance = newBalance
      payments.push({ y, date, pence, newBalance, parts: text ? [{ y, text }] : [] })
    }

    // Each wrapped line belongs to the nearest payment above or below it (the one below when it's a tie,
    // as amounts are often on a description's last line). Text far from any payment is left out.
    for (const line of loose) {
      let best: Payment | null = null
      for (const p of payments) {
        const d = Math.abs(p.y - line.y)
        if (d <= 18 && (!best || d < Math.abs(best.y - line.y) || (d === Math.abs(best.y - line.y) && p.y > best.y))) best = p
      }
      best?.parts.push(line)
    }
    for (const p of payments) {
      const description = p.parts
        .sort((a, b) => a.y - b.y)
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (p.pence === 0 || NOT_A_PAYMENT.test(description)) continue
      rows.push([p.date, description, (p.pence / 100).toFixed(2)])
    }
  }
  return rows.length > 1 ? rows : []
}
