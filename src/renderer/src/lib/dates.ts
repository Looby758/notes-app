/**
 * Small date formatting and parsing (no library needed). Format tokens:
 * YYYY 2026 · YY 26 · MMMM October · MMM Oct · MM 10 · M 10 · DD 05 · D 5 · dddd Monday · ddd Mon
 * HH 09 · H 9 · hh 09 · h 9 (12-hour) · mm 07 · ss 05 · A AM · a am. Text in [brackets] is kept as is.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g

export function formatDate(date: Date, format: string): string {
  return format.replace(TOKEN, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal
    const h12 = date.getHours() % 12 || 12
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear())
      case 'YY':
        return pad(date.getFullYear() % 100)
      case 'MMMM':
        return MONTHS[date.getMonth()]
      case 'MMM':
        return MONTHS[date.getMonth()].slice(0, 3)
      case 'MM':
        return pad(date.getMonth() + 1)
      case 'M':
        return String(date.getMonth() + 1)
      case 'DD':
        return pad(date.getDate())
      case 'D':
        return String(date.getDate())
      case 'dddd':
        return DAYS[date.getDay()]
      case 'ddd':
        return DAYS[date.getDay()].slice(0, 3)
      case 'HH':
        return pad(date.getHours())
      case 'H':
        return String(date.getHours())
      case 'hh':
        return pad(h12)
      case 'h':
        return String(h12)
      case 'mm':
        return pad(date.getMinutes())
      case 'ss':
        return pad(date.getSeconds())
      case 'A':
        return date.getHours() < 12 ? 'AM' : 'PM'
      case 'a':
        return date.getHours() < 12 ? 'am' : 'pm'
      default:
        return token
    }
  })
}

/**
 * Reads a date written in `format` (numeric tokens and month names). Returns null if the text
 * doesn't match or isn't a real date (e.g. 2026-02-30).
 */
export function parseDate(text: string, format: string): Date | null {
  const parts: { token: string }[] = []
  let pattern = ''
  let last = 0
  for (const m of format.matchAll(TOKEN)) {
    pattern += escape(format.slice(last, m.index))
    last = m.index + m[0].length
    if (m[1] !== undefined) {
      pattern += escape(m[1])
      continue
    }
    const token = m[0]
    // Day names are matched but not captured (they don't decide the date).
    if (!NON_CAPTURING.has(token)) parts.push({ token })
    pattern += TOKEN_PATTERNS[token] ?? escape(token)
  }
  pattern += escape(format.slice(last))
  const match = new RegExp(`^${pattern}$`, 'i').exec(text.trim())
  if (!match) return null

  let year = 1970
  let month = 0
  let day = 1
  let hour = 0
  let minute = 0
  let pm: boolean | null = null
  parts.forEach(({ token }, i) => {
    const v = match[i + 1]
    switch (token) {
      case 'YYYY':
        year = Number(v)
        break
      case 'YY':
        year = 2000 + Number(v)
        break
      case 'MMMM':
      case 'MMM':
        month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(v.toLowerCase().slice(0, 3)))
        break
      case 'MM':
      case 'M':
        month = Number(v) - 1
        break
      case 'DD':
      case 'D':
        day = Number(v)
        break
      case 'HH':
      case 'H':
      case 'hh':
      case 'h':
        hour = Number(v)
        break
      case 'mm':
        minute = Number(v)
        break
      case 'A':
      case 'a':
        pm = v.toLowerCase() === 'pm'
        break
    }
  })
  if (pm !== null) hour = (hour % 12) + (pm ? 12 : 0)
  const date = new Date(year, month, day, hour, minute)
  // Reject impossible dates that JavaScript would quietly roll over.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TOKEN_PATTERNS: Record<string, string> = {
  YYYY: '(\\d{4})',
  YY: '(\\d{2})',
  MMMM: '([A-Za-z]+)',
  MMM: '([A-Za-z]{3})',
  MM: '(\\d{2})',
  M: '(\\d{1,2})',
  DD: '(\\d{2})',
  D: '(\\d{1,2})',
  dddd: '(?:[A-Za-z]+)',
  ddd: '(?:[A-Za-z]{3})',
  HH: '(\\d{2})',
  H: '(\\d{1,2})',
  hh: '(\\d{2})',
  h: '(\\d{1,2})',
  mm: '(\\d{2})',
  ss: '(?:\\d{2})',
  A: '(AM|PM)',
  a: '(am|pm)'
}
const NON_CAPTURING = new Set(['dddd', 'ddd', 'ss'])

/** Midnight at the start of the day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "2026-10-26" — the stable key used for indexing things by day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return dayKey(d) === key ? d : null
}

/** The first day of the week containing `d` (weekStart: 0 = Sunday, 1 = Monday). */
export function startOfWeek(d: Date, weekStart: 0 | 1): Date {
  const diff = (d.getDay() - weekStart + 7) % 7
  return addDays(startOfDay(d), -diff)
}

/** The 6×7 grid of days shown for a month (starting on `weekStart`). */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): Date[] {
  const first = startOfWeek(new Date(year, month, 1), weekStart)
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}
