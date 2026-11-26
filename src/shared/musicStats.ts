/**
 * Listening stats for your own music: how much you played in a week, month or year (or ever), your
 * top songs, artists and albums, and a chart of when. Everything comes from orbit-music.json
 * (shared/musicLibrary.ts), so plays on the phone app and every computer count:
 * - weeks (and the days in a chart) come from the history of your latest plays;
 * - months and years from the plays kept by month;
 * - all time from each song's play count.
 * Time listened is worked out from the songs' lengths (a play counts after 30 seconds, so it's
 * roughly how long you'd have listened to the whole song).
 */

import { guessFromName, type LocalSong } from './localMusic'
import { HISTORY_LIMIT, monthKey, songsByPath, type MusicData } from './musicLibrary'

export type StatsPeriod = 'week' | 'month' | 'year' | 'all'

export interface PeriodRange {
  start: number
  end: number
  /** "This week", "October 2026", "2025"… */
  label: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3))
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The span of time `offset` periods before the current one (0 is this week/month/year). `weekStart`
 * is 0 for Sunday, 1 for Monday.
 */
export function periodRange(kind: StatsPeriod, offset: number, now: number, weekStart = 1): PeriodRange {
  const d = new Date(now)
  const back = Math.max(0, Math.floor(offset))
  if (kind === 'week') {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    day.setDate(day.getDate() - ((day.getDay() - weekStart + 7) % 7) - back * 7)
    const end = new Date(day)
    end.setDate(end.getDate() + 7)
    const last = new Date(end)
    last.setDate(last.getDate() - 1)
    const label = back === 0 ? 'This week' : back === 1 ? 'Last week' : `${day.getDate()} ${SHORT_MONTHS[day.getMonth()]} – ${last.getDate()} ${SHORT_MONTHS[last.getMonth()]}`
    return { start: day.getTime(), end: end.getTime(), label }
  }
  if (kind === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth() - back, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
    return { start: start.getTime(), end: end.getTime(), label: back === 0 ? 'This month' : `${MONTHS[start.getMonth()]} ${start.getFullYear()}` }
  }
  if (kind === 'year') {
    const year = d.getFullYear() - back
    return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime(), label: back === 0 ? 'This year' : String(year) }
  }
  return { start: 0, end: Number.MAX_SAFE_INTEGER, label: 'All time' }
}

export interface StatSong {
  path: string
  title: string
  artist: string
  album: string
  /** The song, if it's still in your music. */
  song?: LocalSong
  plays: number
  ms: number
}

export interface StatGroup {
  name: string
  /** For an album, its artist. */
  sub?: string
  /** A song in it with a cover. */
  art?: string
  plays: number
  ms: number
}

export interface ChartBar {
  label: string
  plays: number
}

export interface ListeningStats {
  range: PeriodRange
  plays: number
  ms: number
  songs: number
  artists: number
  topSongs: StatSong[]
  topArtists: StatGroup[]
  topAlbums: StatGroup[]
  chart: ChartBar[]
  /** The chart is missing days from before the oldest play the history still has. */
  chartPartial: boolean
  /** Whether going further back can find anything. */
  hasEarlier: boolean
}

/** Every play in the history between two times, counted by song. */
function countHistory(data: MusicData, start: number, end: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (const h of data.history) if (h.at >= start && h.at < end) counts.set(h.path, (counts.get(h.path) ?? 0) + 1)
  return counts
}

function countMonths(data: MusicData, keys: (key: string) => boolean): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [month, songs] of Object.entries(data.months ?? {})) {
    if (!keys(month)) continue
    for (const [path, n] of Object.entries(songs)) counts.set(path, (counts.get(path) ?? 0) + n)
  }
  return counts
}

/** The oldest play the history still knows about (the history only keeps the latest HISTORY_LIMIT). */
function historyStart(data: MusicData): number {
  if (data.history.length < HISTORY_LIMIT) return 0
  return data.history[0]?.at ?? 0
}

function chartFor(kind: StatsPeriod, range: PeriodRange, data: MusicData): { bars: ChartBar[]; partial: boolean } {
  if (kind === 'week' || kind === 'month') {
    const bars: ChartBar[] = []
    const day = new Date(range.start)
    const starts: number[] = []
    while (day.getTime() < range.end) {
      starts.push(day.getTime())
      bars.push({ label: kind === 'week' ? DAYS[day.getDay()] : String(day.getDate()), plays: 0 })
      day.setDate(day.getDate() + 1)
    }
    for (const h of data.history) {
      if (h.at < range.start || h.at >= range.end) continue
      let i = starts.length - 1
      while (i > 0 && h.at < starts[i]) i--
      bars[i].plays++
    }
    return { bars, partial: historyStart(data) > range.start }
  }
  if (kind === 'year') {
    const year = new Date(range.start).getFullYear()
    const bars = SHORT_MONTHS.map((label, i) => {
      const songs = data.months?.[`${year}-${String(i + 1).padStart(2, '0')}`] ?? {}
      return { label, plays: Object.values(songs).reduce((t, n) => t + n, 0) }
    })
    return { bars, partial: false }
  }
  const byYear = new Map<string, number>()
  for (const [month, songs] of Object.entries(data.months ?? {})) {
    const year = month.slice(0, 4)
    byYear.set(year, (byYear.get(year) ?? 0) + Object.values(songs).reduce((t, n) => t + n, 0))
  }
  const bars = [...byYear].sort((a, b) => a[0].localeCompare(b[0])).map(([label, plays]) => ({ label, plays }))
  return { bars, partial: false }
}

/** How you listened in one week, month or year (`offset` periods back), or ever. */
export function listeningStats(data: MusicData, songs: LocalSong[], kind: StatsPeriod, offset: number, now: number, weekStart = 1): ListeningStats {
  const range = periodRange(kind, offset, now, weekStart)
  const byPath = songsByPath(songs)
  let counts: Map<string, number>
  if (kind === 'week') counts = countHistory(data, range.start, range.end)
  else if (kind === 'month') {
    const key = monthKey(range.start)
    counts = countMonths(data, (m) => m === key)
  } else if (kind === 'year') {
    const year = String(new Date(range.start).getFullYear())
    counts = countMonths(data, (m) => m.startsWith(`${year}-`))
  } else {
    counts = new Map(Object.entries(data.stats).map(([path, s]) => [path, s.plays]))
    // Months can know of plays the counts don't (another device's play not merged in yet).
    for (const [path, n] of countMonths(data, () => true)) if (n > (counts.get(path) ?? 0)) counts.set(path, n)
  }

  const list: StatSong[] = []
  for (const [path, plays] of counts) {
    if (plays <= 0) continue
    const song = byPath.get(path)
    const guess = song ? null : guessFromName(path)
    list.push({
      path,
      title: song?.title ?? guess!.title,
      artist: song?.artist ?? guess!.artist,
      album: song?.album ?? '',
      song,
      plays,
      ms: (song?.durationMs ?? 0) * plays
    })
  }
  list.sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.title.localeCompare(b.title))

  const group = (keyOf: (s: StatSong) => string | null, nameOf: (s: StatSong) => { name: string; sub?: string }): StatGroup[] => {
    const map = new Map<string, StatGroup>()
    for (const s of list) {
      const key = keyOf(s)
      if (key === null) continue
      let g = map.get(key)
      if (!g) map.set(key, (g = { ...nameOf(s), plays: 0, ms: 0 }))
      g.plays += s.plays
      g.ms += s.ms
      if (!g.art && s.song?.art) g.art = s.path
    }
    return [...map.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.name.localeCompare(b.name))
  }
  const topArtists = group(
    (s) => (s.artist || 'Unknown artist').toLowerCase(),
    (s) => ({ name: s.artist || 'Unknown artist' })
  )
  const topAlbums = group(
    (s) => (s.album ? `${s.album.toLowerCase()}\u0000${s.artist.toLowerCase()}` : null),
    (s) => ({ name: s.album, sub: s.artist })
  )

  const chart = chartFor(kind, range, data)
  const earliest = Math.min(data.history[0]?.at ?? Infinity, ...Object.keys(data.months ?? {}).map((m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).getTime()))
  return {
    range,
    plays: list.reduce((t, s) => t + s.plays, 0),
    ms: list.reduce((t, s) => t + s.ms, 0),
    songs: list.length,
    artists: topArtists.length,
    topSongs: list.slice(0, 50),
    topArtists: topArtists.slice(0, 30),
    topAlbums: topAlbums.slice(0, 30),
    chart: chart.bars,
    chartPartial: chart.partial,
    hasEarlier: kind !== 'all' && Number.isFinite(earliest) && earliest < range.start
  }
}

/** "3 hr 12 min", "45 min", "2 days 4 hr" */
export function listenedFor(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr} hr ${min % 60} min`
  return `${Math.floor(hr / 24)} days ${hr % 24} hr`
}
