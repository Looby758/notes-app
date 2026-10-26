/**
 * Finds a date and/or time in everyday text, for quick capture → calendar:
 *   "Watch The Walking Dead with Jack at around 20:00 today" → today, 20:00, "Watch The Walking Dead with Jack"
 * Understands today/tonight/tomorrow, weekdays ("friday", "next tue"), "in 3 days", "28 Oct",
 * "October 28th", "28/10", "2026-10-28", and times like 20:00, 8pm, 8:30 am, noon, "at 8".
 * Everything is worked out here, on your computer.
 */

export interface When {
  /** The day (midnight, local time). */
  date: Date
  /** "20:00", if a time was given. */
  time?: string
  /** The text with the date and time words taken out. */
  title: string
  /** Whether a date was actually written (a time alone means today). */
  hasDate: boolean
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const pad = (n: number): string => String(n).padStart(2, '0')
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const WD = '(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?'
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const ORD = '(\\d{1,2})(?:st|nd|rd|th)?'

const weekdayIndex = (w: string): number => WEEKDAYS.findIndex((d) => d.startsWith(w.toLowerCase().slice(0, 3)))
const monthIndex = (m: string): number => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)))

/** A day of the month in the coming year (28 Oct written in November means next year's). */
function dayOfMonth(day: number, month: number, now: Date, year?: number): Date | null {
  if (month < 0 || day < 1 || day > 31) return null
  let d = new Date(year ?? now.getFullYear(), month, day)
  if (d.getMonth() !== month) return null
  if (year === undefined && d < startOfDay(now)) d = new Date(now.getFullYear() + 1, month, day)
  return d
}

interface Rule {
  re: RegExp
  date: (m: RegExpExecArray, now: Date) => Date | null
}

// Optional words in front of a date: "on", "this", "by".
const PRE = '(?:\\b(?:on|this|by|for)\\s+)?'

const DATE_RULES: Rule[] = [
  { re: new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'i'), date: (m) => dayOfMonth(+m[3], +m[2] - 1, new Date(0), +m[1]) },
  { re: /\b(?:the\s+)?day\s+after\s+tomorrow\b/i, date: (_m, now) => addDays(now, 2) },
  { re: /\b(?:tomorrow|tmrw|tmr)(?:\s+(?:morning|afternoon|evening|night))?\b/i, date: (_m, now) => addDays(now, 1) },
  { re: /\b(?:today|tonight|this\s+(?:morning|afternoon|evening))\b/i, date: (_m, now) => startOfDay(now) },
  { re: /\bin\s+(\d{1,2}|a|one|two|three)\s+(days?|weeks?)\b/i, date: (m, now) => {
      const n = { a: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase() as 'a'] ?? Number(m[1])
      return addDays(now, n * (/week/i.test(m[2]) ? 7 : 1))
    } },
  { re: new RegExp(`\\bnext\\s+week\\b`, 'i'), date: (_m, now) => addDays(now, 7) },
  { re: new RegExp(`${PRE}\\b(next\\s+)?${WD}\\b`, 'i'), date: (m, now) => {
      const target = weekdayIndex(m[2])
      if (target < 0) return null
      let ahead = (target - now.getDay() + 7) % 7
      if (ahead === 0) ahead = 7
      if (m[1] && ahead < 7) ahead += 7
      return addDays(now, ahead)
    } },
  { re: new RegExp(`${PRE}\\b(?:the\\s+)?${ORD}(?:\\s+of)?\\s+${MON}\\b(?:\\s+(\\d{4}))?`, 'i'), date: (m, now) => dayOfMonth(+m[1], monthIndex(m[2]), now, m[3] ? +m[3] : undefined) },
  { re: new RegExp(`${PRE}\\b${MON}\\s+(?:the\\s+)?${ORD}\\b(?:,?\\s+(\\d{4}))?`, 'i'), date: (m, now) => dayOfMonth(+m[2], monthIndex(m[1]), now, m[3] ? +m[3] : undefined) },
  // Day first, as in the UK: 28/10.
  { re: /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, date: (m, now) => dayOfMonth(+m[1], +m[2] - 1, now, m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined) }
]

// Optional words in front of a time: "at", "around", "at around", "about", "from".
const AT = '(?:\\b(?:at|@|around|about|from|by)\\s+){0,2}'

/** A time, and whether it was a bare hour ("at 8") that could mean morning or evening. */
type Parsed = [number, number] | [number, number, 'ambiguous']

const TIME_RULES: { re: RegExp; time: (m: RegExpExecArray) => Parsed | null }[] = [
  { re: new RegExp(`${AT}\\b(noon|midday)\\b`, 'i'), time: () => [12, 0] },
  { re: new RegExp(`${AT}\\bmidnight\\b`, 'i'), time: () => [0, 0] },
  { re: new RegExp(`${AT}\\b(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![\\w])`, 'i'), time: (m) => {
      let h = +m[1]
      if (h < 1 || h > 12) return null
      const pm = /^p/i.test(m[3])
      if (h === 12) h = pm ? 12 : 0
      else if (pm) h += 12
      return [h, m[2] ? +m[2] : 0]
    } },
  { re: new RegExp(`${AT}\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b`, 'i'), time: (m) => [+m[1], +m[2]] },
  // "at 8" (needs "at"/"around"): 1–7 are evening; 8–11 are morning unless that's already gone today.
  { re: /\b(?:at|around|at\s+around|about)\s+(\d{1,2})(?![\d:.\/]|\s*(?:am|pm|%|days?|weeks?|hours?|mins?|minutes?|people|of|st|nd|rd|th)\b)/i, time: (m) => {
      const h = +m[1]
      if (h < 1 || h > 23) return null
      return h <= 7 ? [h + 12, 0] : h < 12 ? [h, 0, 'ambiguous'] : [h, 0]
    } }
]

/** Removes `[from, to)` from the text and tidies the spaces and leftover joining words. */
function cut(text: string, from: number, to: number): string {
  return text.slice(0, from) + ' ' + text.slice(to)
}

function tidy(text: string): string {
  return text
    .replace(/\s+(?:at|on|around|about|by|for|from)\s*(?=[,.;!?]|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
}

/** The date and time in `text`, or null if there's neither. */
export function findWhen(text: string, now = new Date()): When | null {
  let rest = text
  let date: Date | null = null
  for (const rule of DATE_RULES) {
    const m = rule.re.exec(rest)
    if (!m) continue
    const d = rule.date(m, now)
    if (!d) continue
    date = startOfDay(d)
    rest = cut(rest, m.index, m.index + m[0].length)
    break
  }
  let time: string | undefined
  for (const rule of TIME_RULES) {
    const m = rule.re.exec(rest)
    if (!m) continue
    const t = rule.time(m)
    if (!t) continue
    let hour = t[0]
    // "Movie at 8" in the afternoon means this evening.
    const day = date ?? startOfDay(now)
    if (t[2] === 'ambiguous' && new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, t[1]) < now) hour += 12
    time = `${pad(hour)}:${pad(t[1])}`
    rest = cut(rest, m.index, m.index + m[0].length)
    break
  }
  // "tonight" without a time, or "this evening": still just the day.
  if (!date && !time) return null
  return { date: date ?? startOfDay(now), time, title: tidy(rest), hasDate: !!date }
}

export const dayKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
