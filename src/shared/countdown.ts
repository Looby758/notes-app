/**
 * Countdowns: big "how long until" cards for things you're waiting for (a new season, a game
 * update, a trip, a birthday). A countdown is a date, and optionally a time; without a time it
 * counts down to the start of that day and then says "Today" for the whole day. Yearly ones
 * (birthdays, Christmas) roll on to next year once their day is over.
 *
 * Everything here works in the computer's own time zone, and day counts are whole calendar days,
 * so a clock change never makes "3 days" turn into "2 days 23 hours".
 */

export type CountdownKind = 'season' | 'game' | 'trip' | 'birthday' | 'event' | 'other'

export const COUNTDOWN_KINDS: readonly { id: CountdownKind; label: string; emoji: string }[] = [
  { id: 'season', label: 'New season', emoji: '📺' },
  { id: 'game', label: 'Game update', emoji: '🎮' },
  { id: 'trip', label: 'Trip', emoji: '✈️' },
  { id: 'birthday', label: 'Birthday', emoji: '🎂' },
  { id: 'event', label: 'Event', emoji: '🎟️' },
  { id: 'other', label: 'Other', emoji: '⏳' }
]

export interface Countdown {
  /** Stable id, made when the countdown is added. */
  id: string
  /** What it's counting down to, e.g. "Walking Dead season 2". */
  title: string
  kind: CountdownKind
  /** The day, as YYYY-MM-DD. */
  date: string
  /** The time on that day, as HH:MM (24-hour), or '' for the whole day. */
  time: string
  /** Comes round every year on the same date. */
  yearly: boolean
  /** When it was added (ms), so the card can show how much of the wait is done. */
  created: number
}

export const MAX_COUNTDOWNS = 50

export const countdownId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const kindOf = (kind: CountdownKind): (typeof COUNTDOWN_KINDS)[number] =>
  COUNTDOWN_KINDS.find((k) => k.id === kind) ?? COUNTDOWN_KINDS[COUNTDOWN_KINDS.length - 1]

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** True for a real calendar date written YYYY-MM-DD (no 31 February). */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

export const isTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v)

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** A saved list of countdowns, repaired: real dates only, each id once, short titles. */
export function cleanCountdowns(v: unknown): Countdown[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Countdown[] = []
  for (const c of v) {
    if (!c || typeof c !== 'object') continue
    const { id, title, kind, date, time, yearly, created } = c as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id) || !isDate(date)) continue
    if (typeof title !== 'string' || !title.trim()) continue
    seen.add(id)
    out.push({
      id,
      title: title.trim().slice(0, 80),
      kind: COUNTDOWN_KINDS.some((k) => k.id === kind) ? (kind as CountdownKind) : 'other',
      date,
      time: isTime(time) ? time : '',
      yearly: yearly === true,
      created: typeof created === 'number' && Number.isFinite(created) && created > 0 ? created : 0
    })
    if (out.length >= MAX_COUNTDOWNS) break
  }
  return out
}

// ---------- working out when ----------

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date)!
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Local midnight at the start of y-m-d; 29 February becomes the 28th in years without one. */
function startOfDay(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, Math.min(d, daysInMonth(y, m)))
}

function at(c: Countdown, year: number): Date {
  const [, m, d] = parts(c.date)
  const day = startOfDay(year, m, d)
  if (c.time) {
    const [h, min] = c.time.split(':').map(Number)
    day.setHours(h, min, 0, 0)
  }
  return day
}

/** How long a timed one stays "It's here!" before it counts as done. */
const HERE_FOR = 3_600_000

/** Has this occurrence finished? A whole-day one lasts until the day is over; a timed one for an hour. */
function over(c: Countdown, when: Date, now: Date): boolean {
  if (c.time) return now.getTime() >= when.getTime() + HERE_FOR
  const end = new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1)
  return now.getTime() >= end.getTime()
}

/** The moment it's counting down to: for a yearly one, the next time it comes round. */
export function targetOf(c: Countdown, now: Date): Date {
  const [y] = parts(c.date)
  if (!c.yearly) return at(c, y)
  // A yearly one starts counting from its first year, then the next one that isn't over yet.
  let year = Math.max(y, now.getFullYear() - 1)
  let when = at(c, year)
  while (over(c, when, now)) when = at(c, ++year)
  return when
}

/** Whole calendar days from `a`'s day to `b`'s day (negative if `b` is earlier). */
export function calendarDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / 86_400_000)
}

export type CountdownState = 'upcoming' | 'today' | 'now' | 'done'

export interface CountdownStatus {
  target: Date
  /**
   * upcoming: still to come. today: it's the day (a whole-day one), or a timed one later today.
   * now: a timed one that just arrived (the last hour). done: over, and not coming round again.
   */
  state: CountdownState
  /** Calendar days to go (0 on the day; negative once done). */
  days: number
  /** Milliseconds to go (0 once it's here). */
  ms: number
  /** How much of the wait from when it was added has gone, 0 to 1 (null if unknown). */
  progress: number | null
}

export function countdownStatus(c: Countdown, now: Date): CountdownStatus {
  const target = targetOf(c, now)
  const ms = Math.max(0, target.getTime() - now.getTime())
  const days = calendarDays(now, target)
  let state: CountdownState
  if (over(c, target, now)) state = 'done'
  else if (c.time && ms === 0) state = 'now'
  else state = days <= 0 ? 'today' : 'upcoming'

  let progress: number | null = null
  if (c.created > 0) {
    // For a yearly one the wait starts at the previous occurrence, or when it was added if later.
    const prev = c.yearly ? at(c, target.getFullYear() - 1).getTime() : 0
    const start = Math.max(c.created, prev)
    const span = target.getTime() - start
    progress = span > 0 ? Math.min(1, Math.max(0, (now.getTime() - start) / span)) : 1
  }
  return { target, state, days, ms, progress }
}

/** The days/hours/minutes/seconds left, for the ticking line on a card. */
export function splitTime(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { days: Math.floor(s / 86_400), hours: Math.floor(s / 3600) % 24, minutes: Math.floor(s / 60) % 60, seconds: s % 60 }
}

/** The short "how long" line: "In 12 days", "Tomorrow", "In 3 h 20 min", "Today", "3 days ago". */
export function leftText(status: CountdownStatus, timed: boolean): string {
  const { state, days, ms } = status
  if (state === 'now') return 'It’s here!'
  if (state === 'done') {
    const ago = -days
    return ago <= 0 ? 'Earlier today' : ago === 1 ? 'Yesterday' : `${ago} days ago`
  }
  if (state === 'today') {
    if (!timed) return 'Today!'
    const { hours, minutes } = splitTime(ms)
    return hours > 0 ? `In ${hours} h ${minutes} min` : minutes > 0 ? `In ${minutes} min` : 'Any second now'
  }
  if (days === 1) return 'Tomorrow'
  if (days < 14) return `In ${days} days`
  const weeks = Math.floor(days / 7)
  const rest = days % 7
  if (days < 60) return `In ${weeks} weeks${rest ? ` ${rest} day${rest === 1 ? '' : 's'}` : ''}`
  return `In ${days} days`
}

/** Soonest first; finished ones at the end, most recent first. */
export function sortCountdowns(list: readonly Countdown[], now: Date): Countdown[] {
  const keyed = list.map((c) => ({ c, s: countdownStatus(c, now) }))
  return keyed
    .sort((a, b) => {
      const ad = a.s.state === 'done'
      const bd = b.s.state === 'done'
      if (ad !== bd) return ad ? 1 : -1
      const diff = a.s.target.getTime() - b.s.target.getTime()
      return ad ? -diff : diff
    })
    .map((k) => k.c)
}

/** Today's date as YYYY-MM-DD, for the date picker's starting value. */
export function todayKey(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
