/**
 * Repeating events, written in plain words after a 🔁 on an event line:
 *
 *   - 18:00-19:00 Football 🔁 every Tuesday
 *   - Rent day 🔁 every month on the 1st
 *   - 09:00 Standup 🔁 every weekday until 2027-03-31
 *   - Bins out 🔁 every 2 weeks on Thursday except 2026-12-24
 *
 * The event starts on the day of the note it's written in and repeats from there. The same rule
 * turns into a Google Calendar RRULE when an event is made in Google instead.
 */

export interface RepeatRule {
  freq: 'day' | 'week' | 'month' | 'year'
  /** Every 1, 2, 3… days/weeks/months/years. */
  interval: number
  /** Weekly: which days (0 = Sunday). Missing: the start day's weekday. */
  weekdays?: number[]
  /** Monthly: day of the month (1–31, or -1 for the last day). */
  monthDay?: number
  /** Monthly: the nth weekday (n 1–4, or -1 for the last one), e.g. the third Saturday. */
  nth?: { n: number; weekday: number }
  /** Last day it can happen (day key, included). */
  until?: string
  /** Days it's skipped (day keys). */
  except?: string[]
}

/** Marks a repeat rule on an event line. */
export const REPEAT_MARK = '🔁'
/** "🔁 every Tuesday until 2027-01-01" at the end of an event's text. */
export const REPEAT_TEXT = /\s*🔁\s*([^🔁]*?)\s*$/u

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_TITLES = DAY_NAMES.map((d) => d[0].toUpperCase() + d.slice(1))
const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 }
const ORDINAL_TITLES: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' }
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function weekdayOf(word: string): number {
  const w = word.toLowerCase().replace(/s$/, '')
  if (w.length < 2) return -1
  return DAY_NAMES.findIndex((d) => d.startsWith(w.slice(0, 3)) && d.startsWith(w))
}

/** "tuesday", "tue and thu", "Monday, Wednesday and Friday" → [2] / [2, 4] / [1, 3, 5] (null if not days). */
function parseDays(text: string): number[] | null {
  const words = text
    .split(/\s*(?:,|\band\b|&|\+|\/)\s*/i)
    .map((w) => w.trim())
    .filter(Boolean)
  if (!words.length) return null
  const days = words.map(weekdayOf)
  if (days.some((d) => d < 0)) return null
  return [...new Set(days)].sort((a, b) => a - b)
}

/** "1st", "15th", "last day", "day 15", "first tuesday", "last friday" → a monthly position. */
function parseMonthPosition(text: string): Pick<RepeatRule, 'monthDay' | 'nth'> | null {
  const t = text.trim().toLowerCase().replace(/^the\s+/, '')
  if (/^last(?: day)?$/.test(t)) return { monthDay: -1 }
  let m = /^(?:day\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(t)
  if (m) {
    const d = Number(m[1])
    return d >= 1 && d <= 31 ? { monthDay: d } : null
  }
  m = /^(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(\w+)$/.exec(t)
  if (m) {
    const n = ORDINAL_WORDS[m[1]] ?? Number(m[1][0])
    const weekday = weekdayOf(m[2])
    return weekday >= 0 ? { nth: { n, weekday } } : null
  }
  return null
}

/** Reads "every Tuesday", "every month on the 1st", "the 1st of every month"… (null if it isn't a rule). */
export function parseRepeat(input: string): RepeatRule | null {
  let text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '')
  const rule: Partial<RepeatRule> = {}

  const except = /\s+(?:except|skip|not on)\s+([\d\-,\s]+(?:and\s+[\d-]+)?)$/.exec(text)
  if (except) {
    const days = except[1].split(/\s*(?:,|and)\s*/).map((d) => d.trim()).filter(Boolean)
    if (!days.every((d) => DAY_KEY.test(d))) return null
    rule.except = days
    text = text.slice(0, except.index)
  }
  const until = /\s+(?:until|till|ending|ends)\s+(\d{4}-\d{2}-\d{2})$/.exec(text)
  if (until) {
    rule.until = until[1]
    text = text.slice(0, until.index)
  }

  // "the 1st of every month", "the last friday of each month", "the 15th of every 2 months"
  const ofMonth = /^(?:on )?(?:the )?(.+?) of (?:every|each|the) (?:(\d+) )?months?$/.exec(text)
  if (ofMonth) {
    const pos = parseMonthPosition(ofMonth[1])
    if (!pos) return null
    return finish({ ...rule, freq: 'month', interval: Number(ofMonth[2] ?? 1), ...pos })
  }

  text = text.replace(/^(?:repeats? )?(?:every|each) /, 'every ')
  const simple: Record<string, Pick<RepeatRule, 'freq' | 'interval' | 'weekdays'>> = {
    daily: { freq: 'day', interval: 1 },
    weekly: { freq: 'week', interval: 1 },
    fortnightly: { freq: 'week', interval: 2 },
    monthly: { freq: 'month', interval: 1 },
    yearly: { freq: 'year', interval: 1 },
    annually: { freq: 'year', interval: 1 },
    weekdays: { freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] }
  }
  if (simple[text]) return finish({ ...rule, ...simple[text] })

  const m = /^every (?:(\d+|other) )?(.+)$/.exec(text)
  if (!m) return null
  const interval = m[1] === 'other' ? 2 : Number(m[1] ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null
  const rest = m[2]

  if (/^days?$/.test(rest)) return finish({ ...rule, freq: 'day', interval })
  if (/^(?:weekday|weekdays|work ?day|work ?days)$/.test(rest) && interval === 1) return finish({ ...rule, freq: 'week', interval, weekdays: [1, 2, 3, 4, 5] })
  if (/^(?:weekend|weekends)$/.test(rest) && interval === 1) return finish({ ...rule, freq: 'week', interval, weekdays: [0, 6] })
  if (/^fortnight$/.test(rest) && interval === 1) return finish({ ...rule, freq: 'week', interval: 2 })

  const week = /^weeks?(?: on (.+))?$/.exec(rest)
  if (week) {
    const days = week[1] ? parseDays(week[1]) : undefined
    if (days === null) return null
    return finish({ ...rule, freq: 'week', interval, ...(days ? { weekdays: days } : {}) })
  }
  const month = /^months?(?: on (.+))?$/.exec(rest)
  if (month) {
    const pos = month[1] ? parseMonthPosition(month[1]) : {}
    if (!pos) return null
    return finish({ ...rule, freq: 'month', interval, ...pos })
  }
  if (/^years?$/.test(rest)) return finish({ ...rule, freq: 'year', interval })

  // "every tuesday", "every tue and thu", "every other friday"
  const days = parseDays(rest)
  if (days) return finish({ ...rule, freq: 'week', interval, weekdays: days })
  return null
}

function finish(rule: Partial<RepeatRule>): RepeatRule {
  const out: RepeatRule = { freq: rule.freq!, interval: rule.interval ?? 1 }
  if (rule.weekdays?.length) out.weekdays = rule.weekdays
  if (rule.monthDay !== undefined) out.monthDay = rule.monthDay
  if (rule.nth) out.nth = rule.nth
  if (rule.until) out.until = rule.until
  if (rule.except?.length) out.except = [...new Set(rule.except)].sort()
  return out
}

const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${s}`
}

function joinDays(days: number[]): string {
  const names = days.map((d) => DAY_TITLES[d])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
}

/** The words for a rule, as written after 🔁 ("every Tuesday", "every month on the 1st"). */
export function formatRepeat(rule: RepeatRule): string {
  const n = rule.interval
  let text: string
  if (rule.freq === 'day') text = n === 1 ? 'every day' : `every ${n} days`
  else if (rule.freq === 'week') {
    const days = rule.weekdays
    if (n === 1 && days?.join() === '1,2,3,4,5') text = 'every weekday'
    else if (n === 1 && days?.join() === '0,6') text = 'every weekend'
    else if (!days?.length) text = n === 1 ? 'every week' : `every ${n} weeks`
    else text = n === 1 ? `every ${joinDays(days)}` : `every ${n} weeks on ${joinDays(days)}`
  } else if (rule.freq === 'month') {
    const base = n === 1 ? 'every month' : `every ${n} months`
    if (rule.nth) text = `${base} on the ${ORDINAL_TITLES[rule.nth.n]} ${DAY_TITLES[rule.nth.weekday]}`
    else if (rule.monthDay === -1) text = `${base} on the last day`
    else if (rule.monthDay) text = `${base} on the ${ordinal(rule.monthDay)}`
    else text = base
  } else text = n === 1 ? 'every year' : `every ${n} years`
  if (rule.until) text += ` until ${rule.until}`
  if (rule.except?.length) text += ` except ${rule.except.join(', ')}`
  return text
}

/** A short label for menus and cards: "Every Tuesday", "Every month on the 1st". */
export function describeRepeat(rule: RepeatRule): string {
  const text = formatRepeat({ ...rule, except: undefined })
  return text[0].toUpperCase() + text.slice(1)
}

// ---------- dates (day keys, worked out in UTC so clock changes don't matter) ----------

const DAY_MS = 86_400_000
const toNum = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}
const toKey = (num: number): string => new Date(num * DAY_MS).toISOString().slice(0, 10)
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** Moves a day key by `days`. */
export function shiftDay(key: string, days: number): string {
  return toKey(toNum(key) + days)
}

/** Days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return toNum(b) - toNum(a)
}

/** The day of the month the rule means in a given month (null if that month doesn't have one). */
function monthlyDay(rule: RepeatRule, start: string, y: number, m: number): number | null {
  const len = daysInMonth(y, m)
  if (rule.nth) {
    const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay()
    if (rule.nth.n === -1) {
      const lastWeekday = new Date(Date.UTC(y, m, len)).getUTCDay()
      return len - ((lastWeekday - rule.nth.weekday + 7) % 7)
    }
    const day = 1 + ((rule.nth.weekday - firstWeekday + 7) % 7) + (rule.nth.n - 1) * 7
    return day <= len ? day : null
  }
  const want = rule.monthDay ?? Number(start.slice(8, 10))
  if (want === -1) return len
  return want <= len ? want : null
}

/**
 * The days (keys) a repeating event happens on between `from` and `to` (both included), for an
 * event that starts on `start`. The start day itself always counts. At most `limit` days.
 */
export function occurrences(rule: RepeatRule, start: string, from: string, to: string, limit = 1500): string[] {
  const out: string[] = []
  const last = rule.until && rule.until < to ? rule.until : to
  if (last < start || last < from) return out
  const skip = new Set(rule.except ?? [])
  const add = (key: string): boolean => {
    if (key >= from && key <= last && key >= start && !skip.has(key)) out.push(key)
    return out.length < limit
  }
  const s = toNum(start)
  const lastNum = toNum(last)

  if (rule.freq === 'day' || rule.freq === 'week') {
    const days = rule.freq === 'week' ? new Set(rule.weekdays?.length ? rule.weekdays : [new Date(s * DAY_MS).getUTCDay()]) : null
    // Weeks counted from the Sunday on or before the start day.
    const startWeek = s - new Date(s * DAY_MS).getUTCDay()
    let d = Math.max(s, toNum(from))
    if (rule.freq === 'day') d = s + Math.ceil((d - s) / rule.interval) * rule.interval
    for (; d <= lastNum; d += rule.freq === 'day' ? rule.interval : 1) {
      if (days) {
        const weekday = new Date(d * DAY_MS).getUTCDay()
        const week = Math.floor((d - weekday - startWeek) / 7)
        if (d !== s && (!days.has(weekday) || week % rule.interval !== 0)) continue
      }
      if (!add(toKey(d))) break
    }
    return out
  }

  // Monthly and yearly: step through the months from the start.
  const sy = Number(start.slice(0, 4))
  const sm = Number(start.slice(5, 7)) - 1
  const step = rule.freq === 'year' ? 12 * rule.interval : rule.interval
  const fromY = Number(from.slice(0, 4))
  const fromM = Number(from.slice(5, 7)) - 1
  // Jump close to `from` without missing anything.
  const skipMonths = Math.max(0, (fromY - sy) * 12 + (fromM - sm) - step)
  let i = Math.floor(skipMonths / step) * step
  add(start)
  for (; ; i += step) {
    const y = sy + Math.floor((sm + i) / 12)
    const m = (sm + i) % 12
    if (Date.UTC(y, m, 1) / DAY_MS > lastNum) break
    let day: number | null
    if (rule.freq === 'year') {
      const want = Number(start.slice(8, 10))
      day = want <= daysInMonth(y, m) ? want : null
    } else day = monthlyDay(rule, start, y, m)
    if (day === null) continue
    const key = toKey(Date.UTC(y, m, day) / DAY_MS)
    if (key === start) continue
    if (!add(key)) break
  }
  return out.sort()
}

/** The same rule as a Google Calendar / iCalendar RRULE line. */
export function toRRule(rule: RepeatRule, start: string): string {
  const parts = [`FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[rule.freq]}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.freq === 'week') {
    const days = rule.weekdays?.length ? rule.weekdays : [new Date(toNum(start) * DAY_MS).getUTCDay()]
    parts.push(`BYDAY=${days.map((d) => RRULE_DAYS[d]).join(',')}`)
  }
  if (rule.freq === 'month') {
    if (rule.nth) parts.push(`BYDAY=${rule.nth.n}${RRULE_DAYS[rule.nth.weekday]}`)
    else parts.push(`BYMONTHDAY=${rule.monthDay ?? Number(start.slice(8, 10))}`)
  }
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}T235959Z`)
  return `RRULE:${parts.join(';')}`
}

/** Days the rule skips, as Google Calendar EXDATE lines (all-day or at a local time). */
export function toExDates(rule: RepeatRule): string[] {
  return (rule.except ?? []).map((d) => `EXDATE;VALUE=DATE:${d.replace(/-/g, '')}`)
}

/**
 * The rule after its event moves from `from` to `to`: a weekly "every Tuesday" moved a day later
 * becomes "every Wednesday", a monthly "on the 1st" becomes "on the 2nd", and so on.
 */
export function moveRule(rule: RepeatRule, from: string, to: string): RepeatRule {
  const delta = daysBetween(from, to)
  if (!delta) return rule
  const next: RepeatRule = { ...rule }
  if (rule.freq === 'week' && rule.weekdays?.length) next.weekdays = [...new Set(rule.weekdays.map((d) => (((d + delta) % 7) + 7) % 7))].sort((a, b) => a - b)
  if (rule.freq === 'month') {
    const day = Number(to.slice(8, 10))
    if (rule.nth) {
      const weekday = new Date(toNum(to) * DAY_MS).getUTCDay()
      const len = daysInMonth(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1)
      next.nth = { n: rule.nth.n === -1 && day + 7 > len ? -1 : Math.min(4, Math.ceil(day / 7)), weekday }
    } else if (rule.monthDay !== undefined) next.monthDay = rule.monthDay === -1 && daysInMonth(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1) === day ? -1 : day
  }
  // Skipped days keep their place relative to the series.
  if (rule.except?.length) next.except = rule.except.map((d) => shiftDay(d, delta))
  return finish(next)
}

/** Ready-made choices for a "Repeat" menu, worded for the day the event is on. */
export function repeatChoices(date: string): { label: string; rule: RepeatRule | null }[] {
  const weekday = new Date(toNum(date) * DAY_MS).getUTCDay()
  const day = Number(date.slice(8, 10))
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7)) - 1
  const nthN = day + 7 > daysInMonth(y, m) && day > 28 ? -1 : Math.ceil(day / 7)
  const choices: { label: string; rule: RepeatRule | null }[] = [
    { label: 'Doesn’t repeat', rule: null },
    { label: 'Every day', rule: { freq: 'day', interval: 1 } },
    { label: 'Every weekday (Mon–Fri)', rule: { freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    { label: `Every ${DAY_TITLES[weekday]}`, rule: { freq: 'week', interval: 1, weekdays: [weekday] } },
    { label: `Every 2 weeks on ${DAY_TITLES[weekday]}`, rule: { freq: 'week', interval: 2, weekdays: [weekday] } },
    { label: `Every month on the ${ordinal(day)}`, rule: { freq: 'month', interval: 1, monthDay: day } }
  ]
  if (nthN <= 4) choices.push({ label: `Every month on the ${ORDINAL_TITLES[nthN]} ${DAY_TITLES[weekday]}`, rule: { freq: 'month', interval: 1, nth: { n: nthN, weekday } } })
  if (day === daysInMonth(y, m)) choices.push({ label: 'Every month on the last day', rule: { freq: 'month', interval: 1, monthDay: -1 } })
  choices.push({ label: 'Every year', rule: { freq: 'year', interval: 1 } })
  return choices
}
