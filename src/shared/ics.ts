/**
 * A small iCalendar (.ics) reader for calendar subscription links, e.g. Google Calendar's
 * "secret address in iCal format". Handles all-day and timed events, time zones (TZID),
 * repeating events (RRULE: daily / weekly / monthly / yearly with INTERVAL, COUNT, UNTIL, BYDAY,
 * BYMONTHDAY), skipped dates (EXDATE) and moved occurrences (RECURRENCE-ID).
 */

export interface IcsEvent {
  uid: string
  title: string
  location?: string
  url?: string
  /** All-day events use day keys ("2026-10-26", end exclusive); timed events use ISO times. */
  allDay: boolean
  start: string
  end: string
}

interface Wall {
  y: number
  m: number // 1-12
  d: number
  h: number
  mi: number
  s: number
}

interface IcsDate {
  wall: Wall
  /** 'UTC', an IANA zone, or null for floating (local) time. */
  tz: string | null
  allDay: boolean
}

type Props = Map<string, { params: Record<string, string>; value: string }[]>

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const keyOfWall = (w: Wall): string => `${w.y}-${pad(w.m)}-${pad(w.d)}`

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  // NAME;PARAM=VALUE;PARAM="quoted:value":VALUE
  let i = 0
  let inQuotes = false
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuotes = !inQuotes
    else if (c === ':' && !inQuotes) break
  }
  if (i >= line.length) return null
  const head = line.slice(0, i)
  const value = line.slice(i + 1)
  const [name, ...rawParams] = head.split(';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

function parseIcsDate(value: string, params: Record<string, string>): IcsDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const wall: Wall = { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 }
  const allDay = !m[4] || params.VALUE === 'DATE'
  const tz = m[7] ? 'UTC' : (params.TZID ?? null)
  return { wall, tz, allDay }
}

/** How far a time zone is from UTC (in minutes) at a given instant. */
function zoneOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return (asUtc - utcMs) / 60000
}

/** Converts a wall-clock time in a zone to an instant. Unknown zones are treated as local time. */
function toInstant(w: Wall, tz: string | null): Date {
  if (tz === 'UTC') return new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s))
  if (tz) {
    try {
      const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
      let utc = guess - zoneOffset(guess, tz) * 60000
      utc = guess - zoneOffset(utc, tz) * 60000 // second pass settles daylight-saving edges
      return new Date(utc)
    } catch {
      // not a zone this computer knows: fall back to local time
    }
  }
  return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
}

function addToWall(w: Wall, { days = 0, months = 0, years = 0 }): Wall {
  // Wall-clock arithmetic on the calendar date, keeping the time of day.
  const d = new Date(Date.UTC(w.y + years, w.m - 1 + months, w.d + days))
  return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

const weekday = (w: Wall): number => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay()
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function parseDuration(v: string): number {
  // P1D, PT1H30M, P1W… → milliseconds
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return 0
  const [, sign, w, d, h, mi, s] = m
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000
  return sign === '-' ? -ms : ms
}

/** The wall-clock start of every occurrence of a repeating event, until `limit` (an instant). */
function expandRule(start: IcsDate, rule: string, limit: Date, exdates: Set<string>): Wall[] {
  const parts = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]))
  const freq = parts.FREQ
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1))
  const count = parts.COUNT ? Number(parts.COUNT) : Infinity
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL, {}) : null
  const untilInstant = until ? toInstant(until.wall, until.allDay ? start.tz : until.tz) : null
  const byDay = parts.BYDAY ? parts.BYDAY.split(',') : null
  const byMonthDay = parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : null

  const out: Wall[] = []
  let produced = 0
  const accept = (w: Wall): boolean => {
    const instant = toInstant(w, start.tz)
    if (untilInstant && instant > untilInstant) return false
    if (instant > limit) return false
    produced++
    if (!exdates.has(wallKey(w, start.allDay))) out.push(w)
    return produced < count
  }

  for (let period = 0; period < 5000; period++) {
    let candidates: Wall[] = []
    if (freq === 'DAILY') {
      candidates = [addToWall(start.wall, { days: period * interval })]
    } else if (freq === 'WEEKLY') {
      const weekStart = addToWall(start.wall, { days: period * interval * 7 - weekday(start.wall) })
      const days = byDay ? byDay.map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((i) => i >= 0) : [weekday(start.wall)]
      candidates = days.sort((a, b) => a - b).map((i) => addToWall(weekStart, { days: i }))
    } else if (freq === 'MONTHLY') {
      const month = addToWall({ ...start.wall, d: 1 }, { months: period * interval })
      if (byDay) {
        for (const code of byDay) {
          const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(code)
          if (!m) continue
          const wd = DAY_CODES.indexOf(m[2])
          const n = m[1] ? Number(m[1]) : 1
          const dim = daysInMonth(month.y, month.m)
          const matching: number[] = []
          for (let d = 1; d <= dim; d++) if (weekday({ ...month, d }) === wd) matching.push(d)
          const day = n > 0 ? matching[n - 1] : matching[matching.length + n]
          if (day) candidates.push({ ...month, d: day })
        }
      } else {
        const dim = daysInMonth(month.y, month.m)
        for (const md of byMonthDay ?? [start.wall.d]) {
          const day = md > 0 ? md : dim + md + 1
          if (day >= 1 && day <= dim) candidates.push({ ...month, d: day })
        }
      }
      candidates.sort((a, b) => a.d - b.d)
    } else if (freq === 'YEARLY') {
      const y = start.wall.y + period * interval
      if (start.wall.d <= daysInMonth(y, start.wall.m)) candidates = [{ ...start.wall, y }]
    } else {
      return [start.wall]
    }
    for (const c of candidates) {
      // Skip anything before the series' own first occurrence.
      if (toInstant(c, start.tz) < toInstant(start.wall, start.tz)) continue
      if (!accept(c)) return out
    }
  }
  return out
}

const wallKey = (w: Wall, allDay: boolean): string => (allDay ? keyOfWall(w) : `${keyOfWall(w)}T${pad(w.h)}${pad(w.mi)}`)

function exdateKeys(props: Props, allDay: boolean): Set<string> {
  const keys = new Set<string>()
  for (const { value, params } of props.get('EXDATE') ?? []) {
    for (const v of value.split(',')) {
      const d = parseIcsDate(v, params)
      if (d) keys.add(wallKey(d.wall, allDay))
    }
  }
  return keys
}

function prop(props: Props, name: string): { params: Record<string, string>; value: string } | undefined {
  return props.get(name)?.[0]
}

/** Events in an .ics file that overlap [from, to). */
export function parseIcs(text: string, from: Date, to: Date): IcsEvent[] {
  const blocks: Props[] = []
  let current: Props | null = null
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT$/i.test(line)) current = new Map()
    else if (/^END:VEVENT$/i.test(line)) {
      if (current) blocks.push(current)
      current = null
    } else if (current) {
      const p = parseLine(line)
      if (p) current.set(p.name, [...(current.get(p.name) ?? []), { params: p.params, value: p.value }])
    }
  }

  // Moved or edited single occurrences of repeating events: uid → occurrence keys they replace.
  const overridden = new Map<string, Set<string>>()
  for (const b of blocks) {
    const rid = prop(b, 'RECURRENCE-ID')
    const uid = prop(b, 'UID')?.value ?? ''
    if (!rid) continue
    const d = parseIcsDate(rid.value, rid.params)
    if (d) overridden.set(uid, new Set([...(overridden.get(uid) ?? []), wallKey(d.wall, d.allDay)]))
  }

  const events: IcsEvent[] = []
  for (const b of blocks) {
    if (prop(b, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue
    const startProp = prop(b, 'DTSTART')
    if (!startProp) continue
    const start = parseIcsDate(startProp.value, startProp.params)
    if (!start) continue
    const endProp = prop(b, 'DTEND')
    const end = endProp ? parseIcsDate(endProp.value, endProp.params) : null
    const uid = prop(b, 'UID')?.value ?? `${startProp.value}-${prop(b, 'SUMMARY')?.value ?? ''}`
    const title = unescapeText(prop(b, 'SUMMARY')?.value ?? '(No title)')
    const location = prop(b, 'LOCATION') ? unescapeText(prop(b, 'LOCATION')!.value) : undefined
    const url = prop(b, 'URL')?.value

    // Length of one occurrence.
    const startInstant = toInstant(start.wall, start.tz)
    let lengthMs: number
    if (end) lengthMs = toInstant(end.wall, end.tz ?? start.tz).getTime() - startInstant.getTime()
    else if (prop(b, 'DURATION')) lengthMs = parseDuration(prop(b, 'DURATION')!.value)
    else lengthMs = start.allDay ? 86400000 : 0
    const lengthDays = Math.max(1, Math.round(lengthMs / 86400000))

    const rule = prop(b, 'RRULE')?.value
    const isOverride = !!prop(b, 'RECURRENCE-ID')
    const skip = new Set([...exdateKeys(b, start.allDay), ...(isOverride ? [] : (overridden.get(uid) ?? []))])
    const occurrences = rule && !isOverride ? expandRule(start, rule, to, skip) : [start.wall]

    for (const w of occurrences) {
      if (start.allDay) {
        const s = keyOfWall(w)
        const e = keyOfWall(addToWall(w, { days: lengthDays }))
        const sDate = new Date(w.y, w.m - 1, w.d)
        const eDate = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate() + lengthDays)
        if (eDate > from && sDate < to) events.push({ uid, title, location, url, allDay: true, start: s, end: e })
      } else {
        const s = toInstant(w, start.tz)
        const e = new Date(s.getTime() + lengthMs)
        if (e >= from && s < to) events.push({ uid, title, location, url, allDay: false, start: s.toISOString(), end: e.toISOString() })
      }
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start))
}
