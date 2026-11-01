/**
 * World clocks: what time it is in other places, worked out from each place's time zone (the
 * "Europe/London" style names the system knows), so daylight saving is always right for that
 * place on that date. Nothing here keeps its own table of clock changes: the system's time zone
 * data does, and it's updated with Windows / macOS.
 */

export interface WorldClock {
  /** Stable id, made when the clock is added. */
  id: string
  /** What you call it, e.g. "Mum (Sydney)". */
  label: string
  /** IANA time zone, e.g. "America/New_York". */
  zone: string
}

export const MAX_CLOCKS = 24

/** True if the system knows this time zone. */
export function isZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** This computer's own time zone. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** A saved list of clocks, repaired: valid zones only, each id once, short labels. */
export function cleanClocks(v: unknown): WorldClock[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: WorldClock[] = []
  for (const c of v) {
    if (!c || typeof c !== 'object') continue
    const { id, label, zone } = c as Record<string, unknown>
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id) || !isZone(zone)) continue
    seen.add(id)
    out.push({ id, zone, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : cityOfZone(zone) })
    if (out.length >= MAX_CLOCKS) break
  }
  return out
}

// ---------- reading the time in a zone ----------

const formatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short'
    })
    formatters.set(zone, f)
  }
  return f
}

export interface ZoneTime {
  year: number
  /** 1–12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday */
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The wall-clock time in `zone` at the moment `at`. */
export function timeIn(zone: string, at: Date): ZoneTime {
  const parts: Record<string, string> = {}
  for (const p of partsFormatter(zone).formatToParts(at)) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday))
  }
}

/** How far ahead of UTC the clocks in `zone` are at `at`, in minutes (London in summer: 60). */
export function offsetMinutes(zone: string, at: Date): number {
  const t = timeIn(zone, at)
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  const whole = Math.floor(at.getTime() / 1000) * 1000
  return Math.round((asUtc - whole) / 60_000)
}

/** "UTC+5:30", "UTC−4", "UTC" */
export function offsetText(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes > 0 ? '+' : '−'
  const m = Math.abs(minutes)
  return `UTC${sign}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`
}

/** The zone's short name right now where there is a well-known one, e.g. "BST", "GMT", "EST". */
export function zoneAbbreviation(zone: string, at: Date): string {
  for (const locale of ['en-GB', 'en-US']) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value
      if (name && !/^(GMT|UTC)[+−-]/.test(name)) return name
    } catch {
      /* fall through */
    }
  }
  return offsetText(offsetMinutes(zone, at))
}

/** "2 hours", "30 minutes", "5 hours 30 minutes" */
export function durationText(minutes: number): string {
  const m = Math.abs(minutes)
  const h = Math.floor(m / 60)
  const rest = m % 60
  const hours = h ? `${h} hour${h === 1 ? '' : 's'}` : ''
  const mins = rest ? `${rest} minute${rest === 1 ? '' : 's'}` : ''
  return [hours, mins].filter(Boolean).join(' ')
}

/** How a place's clock compares to yours: "5 hours behind", "1 hour ahead", "Same time". */
export function differenceText(zone: string, home: string, at: Date): string {
  const diff = offsetMinutes(zone, at) - offsetMinutes(home, at)
  if (diff === 0) return 'Same time as you'
  return `${durationText(diff)} ${diff > 0 ? 'ahead' : 'behind'}`
}

/** "Today", "Tomorrow" or "Yesterday" there, compared with the day where you are. */
export function relativeDay(zone: string, home: string, at: Date): 'Today' | 'Tomorrow' | 'Yesterday' {
  const a = timeIn(zone, at)
  const b = timeIn(home, at)
  const diff = (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000
  return diff > 0 ? 'Tomorrow' : diff < 0 ? 'Yesterday' : 'Today'
}

/** "14:05" or "2:05 pm" */
export function clockText(t: { hour: number; minute: number }, twelve: boolean): string {
  const mm = String(t.minute).padStart(2, '0')
  if (!twelve) return `${String(t.hour).padStart(2, '0')}:${mm}`
  const h = t.hour % 12 || 12
  return `${h}:${mm} ${t.hour < 12 ? 'am' : 'pm'}`
}

/** Night, morning, day or evening there, for the clock's colours. */
export function partOfDay(hour: number): 'night' | 'morning' | 'day' | 'evening' {
  if (hour < 6 || hour >= 22) return 'night'
  if (hour < 9) return 'morning'
  if (hour < 18) return 'day'
  return 'evening'
}

// ---------- daylight saving ----------

export interface ClockChange {
  /** The moment the clocks change. */
  at: Date
  /** Offset from UTC before and after, in minutes. */
  before: number
  after: number
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Narrows a change known to happen between `lo` (offset `before`) and `hi` to the exact minute. */
function pinpoint(zone: string, lo: number, hi: number, before: number): number {
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000
    if (offsetMinutes(zone, new Date(mid)) === before) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * The next time the clocks change in `zone` after `from`, looking up to `days` ahead; null if
 * they don't (most of the world has no daylight saving).
 */
export function nextChange(zone: string, from: Date, days = 400): ClockChange | null {
  const start = from.getTime()
  const before = offsetMinutes(zone, from)
  // Clock changes are months apart, so checking every 6 hours can't step over two of them.
  for (let t = start + 6 * HOUR; t <= start + days * DAY; t += 6 * HOUR) {
    const off = offsetMinutes(zone, new Date(t))
    if (off !== before) {
      const at = pinpoint(zone, t - 6 * HOUR, t, before)
      return { at: new Date(at), before, after: offsetMinutes(zone, new Date(at)) }
    }
  }
  return null
}

/** The last time the clocks changed in `zone` before `from`, looking up to `days` back. */
export function lastChange(zone: string, from: Date, days = 400): ClockChange | null {
  const end = from.getTime()
  const now = offsetMinutes(zone, from)
  for (let t = end - 6 * HOUR; t >= end - days * DAY; t -= 6 * HOUR) {
    const off = offsetMinutes(zone, new Date(t))
    if (off !== now) {
      const at = pinpoint(zone, t, t + 6 * HOUR, off)
      return { at: new Date(at), before: off, after: now }
    }
  }
  return null
}

/** True while the zone is on summer time (its clocks are ahead of where they are for part of the year). */
export function onSummerTime(zone: string, at: Date): boolean {
  const year = timeIn(zone, at).year
  const jan = offsetMinutes(zone, new Date(Date.UTC(year, 0, 1)))
  const jul = offsetMinutes(zone, new Date(Date.UTC(year, 6, 1)))
  if (jan === jul) return false
  return offsetMinutes(zone, at) === Math.max(jan, jul)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sun 29 Mar" as it is in `zone`. */
export function dayText(zone: string, at: Date): string {
  const t = timeIn(zone, at)
  return `${WEEKDAYS[t.weekday]} ${t.day} ${MONTHS[t.month - 1]}`
}

/**
 * A change, said the way people say it, in the place's own time:
 * "Clocks go back 1 hour on Sun 25 Oct at 02:00 (to 01:00)".
 */
export function changeSentence(zone: string, change: ClockChange, twelve: boolean, past = false): string {
  const forward = change.after > change.before
  const amount = durationText(change.after - change.before)
  // The wall-clock time just as it changes, by the old clocks and by the new ones.
  const wall = (offset: number): string => {
    const d = new Date(change.at.getTime() + offset * 60_000)
    return clockText({ hour: d.getUTCHours(), minute: d.getUTCMinutes() }, twelve)
  }
  const verb = past ? (forward ? 'went forward' : 'went back') : forward ? 'go forward' : 'go back'
  return `Clocks ${verb} ${amount} on ${dayText(zone, change.at)} at ${wall(change.before)} (to ${wall(change.after)})`
}

export interface GapChange {
  /** When the difference between the two places changes. */
  at: Date
  /** Minutes the place is ahead of you (negative: behind), before and after. */
  before: number
  after: number
  /** Whose clocks change then. */
  who: 'there' | 'here' | 'both'
}

/**
 * The next time the gap between `zone` and `home` changes. Places that change on the same day by
 * the same amount (London and Paris) keep the same gap, so those changes are skipped; ones that
 * change on different dates (London and New York) get a few weeks with an unusual gap.
 */
export function nextGapChange(zone: string, home: string, from: Date, days = 400): GapChange | null {
  const limit = from.getTime() + days * DAY
  const gapAt = (d: Date): number => offsetMinutes(zone, d) - offsetMinutes(home, d)
  const before = gapAt(from)
  let t = from
  for (let i = 0; i < 8; i++) {
    const a = nextChange(zone, t, Math.ceil((limit - t.getTime()) / DAY))
    const b = nextChange(home, t, Math.ceil((limit - t.getTime()) / DAY))
    const first = [a, b].filter((c): c is ClockChange => !!c).sort((x, y) => x.at.getTime() - y.at.getTime())[0]
    if (!first || first.at.getTime() > limit) return null
    const after = gapAt(first.at)
    if (after !== before) {
      const there = !!a && a.at.getTime() === first.at.getTime()
      const here = !!b && b.at.getTime() === first.at.getTime()
      return { at: first.at, before, after, who: there && here ? 'both' : there ? 'there' : 'here' }
    }
    t = first.at
  }
  return null
}

// ---------- places ----------

/** "America/Argentina/Buenos_Aires" → "Buenos Aires" */
export function cityOfZone(zone: string): string {
  const last = zone.split('/').pop() ?? zone
  return last.replace(/_/g, ' ')
}

export interface ClockPlace {
  name: string
  country: string
  zone: string
  /** Other words it can be found by. */
  also?: string
}

/** Well-known places, so the common ones are found instantly while you type (no internet needed). */
export const CLOCK_PLACES: ClockPlace[] = [
  { name: 'London', country: 'United Kingdom', zone: 'Europe/London', also: 'uk england britain gb manchester birmingham leeds' },
  { name: 'Edinburgh', country: 'United Kingdom', zone: 'Europe/London', also: 'scotland glasgow' },
  { name: 'Cardiff', country: 'United Kingdom', zone: 'Europe/London', also: 'wales' },
  { name: 'Belfast', country: 'United Kingdom', zone: 'Europe/London', also: 'northern ireland' },
  { name: 'Dublin', country: 'Ireland', zone: 'Europe/Dublin' },
  { name: 'Lisbon', country: 'Portugal', zone: 'Europe/Lisbon' },
  { name: 'Paris', country: 'France', zone: 'Europe/Paris' },
  { name: 'Madrid', country: 'Spain', zone: 'Europe/Madrid', also: 'barcelona' },
  { name: 'Tenerife', country: 'Spain', zone: 'Atlantic/Canary', also: 'canary islands gran canaria lanzarote' },
  { name: 'Amsterdam', country: 'Netherlands', zone: 'Europe/Amsterdam', also: 'holland' },
  { name: 'Brussels', country: 'Belgium', zone: 'Europe/Brussels' },
  { name: 'Berlin', country: 'Germany', zone: 'Europe/Berlin', also: 'munich hamburg frankfurt' },
  { name: 'Zurich', country: 'Switzerland', zone: 'Europe/Zurich', also: 'geneva' },
  { name: 'Rome', country: 'Italy', zone: 'Europe/Rome', also: 'milan' },
  { name: 'Vienna', country: 'Austria', zone: 'Europe/Vienna' },
  { name: 'Prague', country: 'Czechia', zone: 'Europe/Prague' },
  { name: 'Warsaw', country: 'Poland', zone: 'Europe/Warsaw', also: 'krakow' },
  { name: 'Copenhagen', country: 'Denmark', zone: 'Europe/Copenhagen' },
  { name: 'Stockholm', country: 'Sweden', zone: 'Europe/Stockholm' },
  { name: 'Oslo', country: 'Norway', zone: 'Europe/Oslo' },
  { name: 'Helsinki', country: 'Finland', zone: 'Europe/Helsinki' },
  { name: 'Athens', country: 'Greece', zone: 'Europe/Athens' },
  { name: 'Bucharest', country: 'Romania', zone: 'Europe/Bucharest' },
  { name: 'Kyiv', country: 'Ukraine', zone: 'Europe/Kyiv', also: 'kiev' },
  { name: 'Istanbul', country: 'Turkey', zone: 'Europe/Istanbul', also: 'turkiye ankara' },
  { name: 'Moscow', country: 'Russia', zone: 'Europe/Moscow' },
  { name: 'Reykjavik', country: 'Iceland', zone: 'Atlantic/Reykjavik' },
  { name: 'Cairo', country: 'Egypt', zone: 'Africa/Cairo' },
  { name: 'Lagos', country: 'Nigeria', zone: 'Africa/Lagos' },
  { name: 'Nairobi', country: 'Kenya', zone: 'Africa/Nairobi' },
  { name: 'Johannesburg', country: 'South Africa', zone: 'Africa/Johannesburg', also: 'cape town' },
  { name: 'Casablanca', country: 'Morocco', zone: 'Africa/Casablanca', also: 'marrakech' },
  { name: 'Dubai', country: 'United Arab Emirates', zone: 'Asia/Dubai', also: 'uae abu dhabi' },
  { name: 'Riyadh', country: 'Saudi Arabia', zone: 'Asia/Riyadh' },
  { name: 'Tel Aviv', country: 'Israel', zone: 'Asia/Jerusalem', also: 'jerusalem' },
  { name: 'Tehran', country: 'Iran', zone: 'Asia/Tehran' },
  { name: 'Karachi', country: 'Pakistan', zone: 'Asia/Karachi', also: 'lahore islamabad' },
  { name: 'Delhi', country: 'India', zone: 'Asia/Kolkata', also: 'new delhi mumbai bangalore kolkata chennai' },
  { name: 'Kathmandu', country: 'Nepal', zone: 'Asia/Kathmandu' },
  { name: 'Dhaka', country: 'Bangladesh', zone: 'Asia/Dhaka' },
  { name: 'Bangkok', country: 'Thailand', zone: 'Asia/Bangkok' },
  { name: 'Jakarta', country: 'Indonesia', zone: 'Asia/Jakarta' },
  { name: 'Bali', country: 'Indonesia', zone: 'Asia/Makassar', also: 'denpasar' },
  { name: 'Singapore', country: 'Singapore', zone: 'Asia/Singapore' },
  { name: 'Kuala Lumpur', country: 'Malaysia', zone: 'Asia/Kuala_Lumpur' },
  { name: 'Manila', country: 'Philippines', zone: 'Asia/Manila' },
  { name: 'Hong Kong', country: 'China', zone: 'Asia/Hong_Kong' },
  { name: 'Beijing', country: 'China', zone: 'Asia/Shanghai', also: 'shanghai shenzhen' },
  { name: 'Taipei', country: 'Taiwan', zone: 'Asia/Taipei' },
  { name: 'Seoul', country: 'South Korea', zone: 'Asia/Seoul', also: 'korea' },
  { name: 'Tokyo', country: 'Japan', zone: 'Asia/Tokyo', also: 'osaka kyoto' },
  { name: 'Perth', country: 'Australia', zone: 'Australia/Perth' },
  { name: 'Adelaide', country: 'Australia', zone: 'Australia/Adelaide' },
  { name: 'Darwin', country: 'Australia', zone: 'Australia/Darwin' },
  { name: 'Brisbane', country: 'Australia', zone: 'Australia/Brisbane', also: 'queensland gold coast' },
  { name: 'Sydney', country: 'Australia', zone: 'Australia/Sydney', also: 'canberra' },
  { name: 'Melbourne', country: 'Australia', zone: 'Australia/Melbourne' },
  { name: 'Auckland', country: 'New Zealand', zone: 'Pacific/Auckland', also: 'wellington' },
  { name: 'Honolulu', country: 'United States', zone: 'Pacific/Honolulu', also: 'hawaii' },
  { name: 'Anchorage', country: 'United States', zone: 'America/Anchorage', also: 'alaska' },
  { name: 'Los Angeles', country: 'United States', zone: 'America/Los_Angeles', also: 'la california san francisco seattle las vegas pacific' },
  { name: 'Phoenix', country: 'United States', zone: 'America/Phoenix', also: 'arizona' },
  { name: 'Denver', country: 'United States', zone: 'America/Denver', also: 'mountain colorado' },
  { name: 'Chicago', country: 'United States', zone: 'America/Chicago', also: 'central texas dallas houston' },
  { name: 'New York', country: 'United States', zone: 'America/New_York', also: 'nyc usa us eastern washington boston miami atlanta' },
  { name: 'Toronto', country: 'Canada', zone: 'America/Toronto', also: 'montreal ottawa' },
  { name: 'Vancouver', country: 'Canada', zone: 'America/Vancouver' },
  { name: 'Halifax', country: 'Canada', zone: 'America/Halifax' },
  { name: 'Mexico City', country: 'Mexico', zone: 'America/Mexico_City' },
  { name: 'Cancún', country: 'Mexico', zone: 'America/Cancun', also: 'cancun' },
  { name: 'Bogotá', country: 'Colombia', zone: 'America/Bogota', also: 'bogota' },
  { name: 'Lima', country: 'Peru', zone: 'America/Lima' },
  { name: 'Santiago', country: 'Chile', zone: 'America/Santiago' },
  { name: 'Buenos Aires', country: 'Argentina', zone: 'America/Argentina/Buenos_Aires' },
  { name: 'São Paulo', country: 'Brazil', zone: 'America/Sao_Paulo', also: 'sao paulo rio de janeiro' },
  { name: 'Kingston', country: 'Jamaica', zone: 'America/Jamaica', also: 'jamaica' },
  { name: 'UTC', country: 'Coordinated Universal Time', zone: 'UTC', also: 'gmt zulu' }
]

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Every time zone the system knows (e.g. "Pacific/Chatham"), for places not in the list above. */
function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

/** Places matching what was typed, best first: the well-known list, then any time zone by its name. */
export function findClockPlaces(query: string, limit = 8): ClockPlace[] {
  const q = fold(query.trim())
  if (!q) return []
  const scored: { place: ClockPlace; score: number }[] = []
  for (const place of CLOCK_PLACES) {
    const name = fold(place.name)
    const words = fold(`${place.country} ${place.also ?? ''}`)
    const score = name === q ? 0 : name.startsWith(q) ? 1 : (` ${words} `).includes(` ${q}`) ? 2 : name.includes(q) ? 3 : -1
    if (score >= 0) scored.push({ place, score })
  }
  scored.sort((a, b) => a.score - b.score)
  const out = scored.map((s) => s.place)
  const known = new Set(out.map((p) => p.zone))
  for (const zone of allZones()) {
    if (out.length >= limit * 2) break
    if (known.has(zone)) continue
    const city = fold(cityOfZone(zone))
    if (city.startsWith(q) || fold(zone).includes(q)) {
      out.push({ name: cityOfZone(zone), country: zone.split('/')[0].replace(/_/g, ' '), zone })
      known.add(zone)
    }
  }
  return out.slice(0, limit)
}

/** A new clock id. */
export const clockId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
