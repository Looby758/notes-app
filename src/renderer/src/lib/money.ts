/**
 * The money tracker: what you spent and received, monthly budgets per category, and reading bank
 * statements (CSV files). Amounts are whole pence so sums never pick up rounding errors.
 */

export interface MoneyCategory {
  id: string
  name: string
  /** A colour for the charts. */
  color: string
  /** Money coming in (pay, refunds…) rather than going out. */
  income?: boolean
}

export interface MoneyEntry {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** Pence, always positive: `income` says which way it went. */
  amount: number
  income: boolean
  category: string
  note: string
  /** Set for rows from a bank statement, so the same row is never imported twice. */
  importKey?: string
}

export interface MoneyData {
  categories: MoneyCategory[]
  entries: MoneyEntry[]
  /** Monthly budget in pence, by category id. */
  budgets: Record<string, number>
  /** Categories you picked for shops and payees, by merchantKey(), used to sort imported rows. */
  rules: Record<string, string>
  /** Savings goals ("New PC £1,200"). */
  goals: SavingsGoal[]
  /** Repeating payments you said aren't subscriptions or bills (by merchantKey), so they aren't listed. */
  notRecurring: string[]
  /** Subscriptions and bills you added yourself (ones the statements don't show yet, or never will). */
  subscriptions: ManualSubscription[]
  /** Found subscriptions you said you've cancelled: merchantKey → the day you said so. A new payment after that day brings it back. */
  cancelled: Record<string, string>
  /** What you told Orbit is in your account, so the end-of-month forecast starts from real money rather than statements alone. */
  balance: Balance | null
}

export type RepeatInterval = 'weekly' | 'monthly' | 'yearly'

export interface ManualSubscription {
  id: string
  name: string
  /** Pence. */
  amount: number
  interval: RepeatInterval
  /** YYYY-MM-DD of one payment (usually the next one): the others are worked out from it. */
  date: string
  category: string
  /** Set when this is a found (statement) subscription you edited: that one's payee key, so yours is shown instead of it. */
  replaces?: string
}

export interface Balance {
  /** Pence; negative when overdrawn. */
  amount: number
  /** YYYY-MM-DD the balance was right on (entries after this day are added on top). */
  date: string
}

export interface SavingsGoal {
  id: string
  name: string
  /** Pence. */
  target: number
  /** Pence put aside so far. */
  saved: number
  /** YYYY-MM-DD you want it by, or '' for no date. */
  due: string
  color: string
}

export const OTHER = 'other'
export const OTHER_INCOME = 'other-income'

/** Colours for categories, in the order new ones get them (chosen to stay distinct for colour-blind readers). */
export const CATEGORY_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const GREY = '#8a8e9a'

export const DEFAULT_CATEGORIES: MoneyCategory[] = [
  { id: 'groceries', name: 'Groceries', color: CATEGORY_COLORS[0] },
  { id: 'eating-out', name: 'Eating out', color: CATEGORY_COLORS[1] },
  { id: 'transport', name: 'Transport', color: CATEGORY_COLORS[2] },
  { id: 'bills', name: 'Bills', color: CATEGORY_COLORS[3] },
  { id: 'shopping', name: 'Shopping', color: CATEGORY_COLORS[4] },
  { id: 'home', name: 'Home', color: CATEGORY_COLORS[5] },
  { id: 'subscriptions', name: 'Subscriptions', color: CATEGORY_COLORS[6] },
  { id: 'fun', name: 'Fun', color: CATEGORY_COLORS[7] },
  { id: OTHER, name: 'Other', color: GREY },
  { id: 'pay', name: 'Pay', color: CATEGORY_COLORS[2], income: true },
  { id: OTHER_INCOME, name: 'Other income', color: GREY, income: true }
]

export const emptyMoney = (): MoneyData => ({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), entries: [], budgets: {}, rules: {}, goals: [], notRecurring: [], subscriptions: [], cancelled: {}, balance: null })

/** Reads money.json, keeping whatever is usable from a damaged or older file. */
export function readMoney(text: string | null): MoneyData {
  const data = emptyMoney()
  if (!text) return data
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return data
  }
  if (!raw || typeof raw !== 'object') return data
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.categories)) {
    const cats = r.categories.filter(
      (c): c is MoneyCategory => !!c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.color === 'string'
    )
    if (cats.length) data.categories = cats.map((c) => ({ id: c.id, name: c.name, color: c.color, ...(c.income ? { income: true } : {}) }))
  }
  // The two catch-all categories always exist: deleted categories' entries move there.
  if (!data.categories.some((c) => c.id === OTHER)) data.categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === OTHER)! })
  if (!data.categories.some((c) => c.id === OTHER_INCOME)) data.categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === OTHER_INCOME)! })
  if (Array.isArray(r.entries)) {
    data.entries = r.entries.filter(
      (e): e is MoneyEntry =>
        !!e &&
        typeof e.id === 'string' &&
        typeof e.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
        Number.isFinite(e.amount) &&
        typeof e.category === 'string'
    )
    data.entries = data.entries.map((e) => ({
      id: e.id,
      date: e.date,
      amount: Math.abs(Math.round(e.amount)),
      income: !!e.income,
      category: e.category,
      note: typeof e.note === 'string' ? e.note : '',
      ...(typeof e.importKey === 'string' ? { importKey: e.importKey } : {})
    }))
  }
  if (r.budgets && typeof r.budgets === 'object') {
    for (const [k, v] of Object.entries(r.budgets as Record<string, unknown>)) {
      if (typeof v === 'number' && v > 0) data.budgets[k] = Math.round(v)
    }
  }
  if (r.rules && typeof r.rules === 'object') {
    for (const [k, v] of Object.entries(r.rules as Record<string, unknown>)) if (typeof v === 'string') data.rules[k] = v
  }
  if (Array.isArray(r.goals)) {
    data.goals = (r.goals as Record<string, unknown>[])
      .filter((g) => !!g && typeof g.id === 'string' && typeof g.name === 'string' && Number.isFinite(g.target) && (g.target as number) > 0)
      .map((g, i) => ({
        id: g.id as string,
        name: (g.name as string).slice(0, 80),
        target: Math.round(g.target as number),
        saved: Number.isFinite(g.saved) ? Math.max(0, Math.round(g.saved as number)) : 0,
        due: typeof g.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.due) ? g.due : '',
        color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : CATEGORY_COLORS[i % CATEGORY_COLORS.length]
      }))
  }
  if (Array.isArray(r.notRecurring)) data.notRecurring = (r.notRecurring as unknown[]).filter((k): k is string => typeof k === 'string')
  const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (Array.isArray(r.subscriptions)) {
    data.subscriptions = (r.subscriptions as Record<string, unknown>[])
      .filter(
        (x) =>
          !!x &&
          typeof x.id === 'string' &&
          typeof x.name === 'string' &&
          Number.isFinite(x.amount) &&
          (x.amount as number) > 0 &&
          (x.interval === 'weekly' || x.interval === 'monthly' || x.interval === 'yearly') &&
          isDay(x.date)
      )
      .map((x) => ({
        id: x.id as string,
        name: (x.name as string).slice(0, 80),
        amount: Math.round(x.amount as number),
        interval: x.interval as RepeatInterval,
        date: x.date as string,
        category: typeof x.category === 'string' ? x.category : 'subscriptions',
        ...(typeof x.replaces === 'string' && x.replaces ? { replaces: x.replaces } : {})
      }))
  }
  if (r.cancelled && typeof r.cancelled === 'object') {
    for (const [k, v] of Object.entries(r.cancelled as Record<string, unknown>)) if (isDay(v)) data.cancelled[k] = v
  }
  const b = r.balance as Record<string, unknown> | null | undefined
  if (b && typeof b === 'object' && Number.isFinite(b.amount) && isDay(b.date)) data.balance = { amount: Math.round(b.amount as number), date: b.date }
  return data
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// ---------- money as text ----------

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const gbpWhole = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })

/** 123456 → "£1,234.56". `whole` drops the pence (for chart labels). */
export const formatPounds = (pence: number, whole = false): string => (whole ? gbpWhole : gbp).format(pence / 100)

/**
 * "£1,234.56", "12.5", "-3", "(4.20)", "4.20 DR" → pence, negative for money going out.
 * Returns null when it isn't an amount.
 */
export function parseAmount(text: string): number | null {
  let s = text.trim().replace(/[£\s,]|GBP/gi, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/DR$/i.test(s)) {
    negative = true
    s = s.slice(0, -2)
  } else if (/CR$/i.test(s)) s = s.slice(0, -2)
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  // "£-12.34" puts the minus after the pound sign, which was stripped above.
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null
  const pence = Math.round(parseFloat(s) * 100)
  return negative ? -pence : pence
}

// ---------- dates ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number): string => String(n).padStart(2, '0')

function validDay(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(y, m - 1, d)
  if (date.getMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * A bank statement's date as YYYY-MM-DD. UK banks put the day first: 05/01/2024 is 5 January.
 * Also reads 2024-01-05, "5 Jan 2024", "05-Jan-24" and a time after the date.
 */
export function parseDate(text: string): string | null {
  const s = text.trim().replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '')
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return validDay(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) return validDay(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,})\.?,?[\s-]+(\d{2}|\d{4})$/i.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (month >= 0) return validDay(+m[3], month + 1, +m[1])
  }
  // "Oct 3, 2026", as spreadsheets sometimes show dates.
  m = /^([a-z]{3,})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (month >= 0) return validDay(+m[3], month + 1, +m[2])
  }
  return null
}

/** "2026-10" → "October 2026" */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** "2026-10" plus 1 → "2026-11" */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export const monthOf = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
export const dayOf = (date: Date): string => `${monthOf(date)}-${pad(date.getDate())}`

// ---------- summaries ----------

export interface MonthTotals {
  spent: number
  received: number
  /** Spending by category id. */
  byCategory: Map<string, number>
}

export function monthTotals(entries: MoneyEntry[], month: string): MonthTotals {
  const totals: MonthTotals = { spent: 0, received: 0, byCategory: new Map() }
  for (const e of entries) {
    if (!e.date.startsWith(month)) continue
    if (e.income) {
      totals.received += e.amount
    } else {
      totals.spent += e.amount
      totals.byCategory.set(e.category, (totals.byCategory.get(e.category) ?? 0) + e.amount)
    }
  }
  return totals
}

export type BudgetState = 'ok' | 'near' | 'over'

/** Over the budget, or close to it (80% or more). */
export function budgetState(spent: number, budget: number): BudgetState {
  if (spent > budget) return 'over'
  if (spent >= budget * 0.8) return 'near'
  return 'ok'
}

// ---------- bank statements ----------

/** Splits CSV text into rows of cells, handling quotes ("a, b" and "say ""hi"""). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  // Some banks export with semicolons or tabs instead of commas.
  const firstLine = src.slice(0, src.indexOf('\n') >= 0 ? src.indexOf('\n') : undefined)
  const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c))
}

/** Which columns hold what. -1 means none. */
export interface CsvColumns {
  /** Row index of the column names, or -1 when the file has none. */
  headerRow: number
  date: number
  description: number
  /** One column with money in as positive and money out as negative… */
  amount: number
  /** …or separate columns for money out and money in. */
  paidOut: number
  paidIn: number
  /** Some cards (credit cards especially) show spending as positive numbers. */
  flip: boolean
}

const findCol = (names: string[], ...patterns: RegExp[]): number => {
  for (const p of patterns) {
    const i = names.findIndex((n) => p.test(n))
    if (i >= 0) return i
  }
  return -1
}

/** Works out the columns of a bank statement, from the column names or, failing that, the contents. */
export function detectColumns(rows: string[][]): CsvColumns {
  const none: CsvColumns = { headerRow: -1, date: -1, description: -1, amount: -1, paidOut: -1, paidIn: -1, flip: false }
  // Some statements start with a few lines about the account before the column names.
  const headerRow = rows.slice(0, 15).findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3)
  if (headerRow >= 0) {
    const names = rows[headerRow].map((n) => n.toLowerCase())
    const cols: CsvColumns = { ...none, headerRow }
    cols.date = findCol(names, /^(transaction )?date$/, /^date/, /date/)
    cols.paidOut = findCol(names, /paid out|money out|debit|withdrawal|spent|^out$/)
    cols.paidIn = findCol(names, /paid in|money in|credit|deposit|received|^in$/)
    if (cols.paidOut < 0 || cols.paidIn < 0) {
      cols.paidOut = cols.paidIn = -1
      cols.amount = findCol(names, /^amount$/, /^value$/, /amount/, /value/)
    }
    cols.description = findCol(
      names,
      /^(transaction )?description$/,
      /^name$/,
      /counter ?party|payee|merchant/,
      /description|details|narrative|memo/,
      /reference/
    )
    if (cols.date >= 0 && cols.description >= 0 && (cols.amount >= 0 || cols.paidOut >= 0)) return cols
  }
  // No column names: guess from the first rows. Dates are dates, amounts are numbers, the description is the longest text.
  const sample = rows.slice(headerRow + 1, headerRow + 21)
  const width = Math.max(0, ...sample.map((r) => r.length))
  const share = (test: (c: string) => boolean, col: number): number =>
    sample.filter((r) => r[col] !== undefined && r[col] !== '' && test(r[col])).length / Math.max(1, sample.length)
  const cols: CsvColumns = { ...none, headerRow: headerRow >= 0 ? headerRow : -1 }
  const used = new Set<number>()
  for (let c = 0; c < width; c++) {
    if (share((x) => parseDate(x) !== null, c) > 0.8) {
      cols.date = c
      used.add(c)
      break
    }
  }
  // The first number column is the amount (the last one is usually the balance).
  for (let c = 0; c < width; c++) {
    if (!used.has(c) && share((x) => parseAmount(x) !== null, c) > 0.8) {
      cols.amount = c
      used.add(c)
      break
    }
  }
  let longest = 0
  for (let c = 0; c < width; c++) {
    if (used.has(c)) continue
    const len = sample.reduce((n, r) => n + (r[c]?.length ?? 0), 0)
    if (len > longest) {
      longest = len
      cols.description = c
    }
  }
  return cols
}

export interface StatementRow {
  date: string
  /** Pence: negative for money going out. */
  amount: number
  description: string
}

/** The rows of a statement that have a date and an amount (others, like balance lines, are skipped). */
export function readStatement(rows: string[][], cols: CsvColumns): StatementRow[] {
  const out: StatementRow[] = []
  for (const r of rows.slice(cols.headerRow + 1)) {
    const date = cols.date >= 0 ? parseDate(r[cols.date] ?? '') : null
    if (!date) continue
    let amount: number | null = null
    if (cols.paidOut >= 0 || cols.paidIn >= 0) {
      const outV = cols.paidOut >= 0 ? parseAmount(r[cols.paidOut] ?? '') : null
      const inV = cols.paidIn >= 0 ? parseAmount(r[cols.paidIn] ?? '') : null
      if (outV) amount = -Math.abs(outV)
      else if (inV) amount = Math.abs(inV)
    } else if (cols.amount >= 0) {
      amount = parseAmount(r[cols.amount] ?? '')
      if (amount !== null && cols.flip) amount = -amount
    }
    if (!amount) continue
    out.push({ date, amount, description: (r[cols.description] ?? '').replace(/\s+/g, ' ').trim() })
  }
  return out
}

/**
 * What identifies a statement row, so importing the same statement (or overlapping ones) twice
 * doesn't add things twice. Two identical rows on one day (two coffees) are told apart by a count.
 */
export function importKeys(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const base = `${r.date}|${r.amount}|${r.description.toLowerCase().replace(/[^a-z0-9]/g, '')}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return `${base}|${n}`
  })
}

const NOISE =
  /^(card payment to|card payment|contactless payment|contactless|payment to|direct debit to|direct debit|standing order to|standing order|faster payment to|faster payment|bill payment to|bank giro credit|transfer to|transfer from|purchase|pos|vis|dd|so|fps|bgc|deb|cpt|chq|tfr)\b[\s:-]*/i

/** The shop or payee in a description, used to remember categories: "CARD PAYMENT TO TESCO STORES 3297" → "tesco stores". */
export function merchantKey(description: string): string {
  let s = description.toLowerCase().replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3 && NOISE.test(s); i++) s = s.replace(NOISE, '')
  const words = s
    .replace(/[^a-z&' ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 || w === '&')
  return words.slice(0, 2).join(' ')
}

const KNOWN: [RegExp, string][] = [
  [/uber ?eats|deliveroo|just ?eat|mcdonald|kfc|burger king|greggs|\bpret\b|costa|starbucks|caffe nero|nando|domino|pizza|subway|wagamama|\bleon\b|itsu|restaurant|cafe|coffee/, 'eating-out'],
  [/tesco|sainsbury|asda|aldi|lidl|morrison|waitrose|co-?op|ocado|iceland|marks ?(&|and)? ?spencer|m&s|farmfoods|\bspar\b|budgens/, 'groceries'],
  [/\btfl\b|trainline|national rail|\buber\b|\bbolt\b|addison lee|\bshell\b|\bbp\b|esso|texaco|parking|ringgo|paybyphone|stagecoach|first bus|arriva|gwr|lner|avanti|northern rail|easyjet|ryanair|\bdvla\b/, 'transport'],
  [/netflix|spotify|disney|prime video|amazon prime|puregym|the gym|david lloyd|apple\.com|itunes|youtube|now ?tv|\bnow\b.*(membership|entertainment|cinema|boost|subscription)|paramount|crunchyroll|dazn|discord|twitch|duolingo|adobe|microsoft 365|ea play|tidal|deezer|nord ?vpn|express ?vpn|google one|audible|patreon|playstation plus|xbox game pass|icloud|google storage|chatgpt|claude/, 'subscriptions'],
  [/british gas|octopus|\bedf\b|\be\.?on\b|\bovo\b|scottish power|thames water|severn trent|anglian water|united utilities|council tax|\bbt\b|\bsky\b|virgin media|vodafone|\bee\b|\bo2\b|\bthree\b|giffgaff|tv licen|insurance|admiral|aviva|direct line|\brent\b|mortgage/, 'bills'],
  [/ikea|b&q|wickes|screwfix|homebase|dunelm|the range|toolstation/, 'home'],
  [/cinema|odeon|vue|cineworld|steam|nintendo|playstation|ticketmaster|eventbrite|see tickets|theatre|museum|bowling/, 'fun'],
  [/amazon|amzn|ebay|argos|asos|primark|john lewis|\bnext\b|h&m|zara|uniqlo|currys|tk ?maxx|boots|superdrug|etsy|shein|temu|vinted/, 'shopping']
]

const SUBSCRIPTION_NAMES = KNOWN.find(([, id]) => id === 'subscriptions')![0]

/** Whether a payee's name is a well-known subscription (Netflix, NOW, Spotify…). */
export const looksLikeSubscription = (description: string): boolean => SUBSCRIPTION_NAMES.test(description.toLowerCase())

/** The category for a statement row: one you've picked for that shop before, then a guess from well-known UK names. */
export function guessCategory(row: StatementRow, rules: Record<string, string>, categories: MoneyCategory[]): string {
  const income = row.amount > 0
  const exists = (id: string): boolean => categories.some((c) => c.id === id && !!c.income === income)
  const learned = rules[merchantKey(row.description)]
  if (learned && exists(learned)) return learned
  const d = row.description.toLowerCase()
  if (income) {
    if (/salary|wages|payroll|\bpay\b/.test(d) && exists('pay')) return 'pay'
    return OTHER_INCOME
  }
  for (const [pattern, id] of KNOWN) if (pattern.test(d) && exists(id)) return id
  return OTHER
}

/** Spending as amounts on a chart's axis: rounded up to a tidy number. */
export function niceMax(pence: number): number {
  if (pence <= 0) return 10000
  const pounds = pence / 100
  const step = Math.pow(10, Math.floor(Math.log10(pounds)))
  for (const m of [1, 2, 2.5, 5, 10]) if (pounds <= m * step) return m * step * 100
  return 10 * step * 100
}
