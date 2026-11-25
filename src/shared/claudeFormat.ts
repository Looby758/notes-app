import { countdownStatus, leftText, sortCountdowns, type Countdown } from './countdown'
import type { DmState } from './downloadManager'
import type { DriveSpace, ExplorerEntry } from './explorer'
import type { LocalSong } from './localMusic'
import type { CalEvent } from './types'
import { changeSentence, clockText, clockTitle, differenceText, messageTime, nextChange, offsetMinutes, relativeDay, timeIn, type WorldClock } from './worldClock'
import { formatBytes, formatPercent, formatRate, formatUptime, type TaskGroup, type TaskPerf } from './taskManager'

/**
 * How Orbit's things are written out for Claude Desktop (see renderer/lib/claudeAnswers.ts): plain
 * text, one thing a line, so Claude can read it and pass it on in its own words.
 */

const p2 = (n: number): string => String(n).padStart(2, '0')
const dayOf = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** Megabytes and gigabytes, the way Windows shows them. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

// ---------- Notes ----------

/** A note's name without its folders or ".md". */
export const noteName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

/** Characters a note's name can't have on Windows or a Mac. */
export const cleanNoteName = (name: string): string =>
  name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120) || 'Untitled'

/** A folder as Claude wrote it, made safe: forward slashes, no "..", no leading slash. */
export function cleanFolder(folder: string | undefined): string {
  return (folder ?? '')
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map(cleanNoteName)
    .join('/')
}

/**
 * The note Claude means: its exact path, its path without ".md", or (when only one note has it) its
 * name, ignoring case. Null when there's none, or more than one with that name.
 */
export function findNotePath(paths: readonly string[], want: string): string | null {
  const w = want.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!w) return null
  const lower = w.toLowerCase()
  const withMd = lower.endsWith('.md') ? lower : `${lower}.md`
  const exact = paths.find((p) => p.toLowerCase() === lower || p.toLowerCase() === withMd)
  if (exact) return exact
  const byName = paths.filter((p) => noteName(p).toLowerCase() === noteName(lower))
  return byName.length === 1 ? byName[0] : null
}

/** Whether `path` is the note or folder `within` (a folder path, or a note's path), or inside it. */
export const isInside = (path: string, within: string): boolean => {
  const w = cleanFolder(within).toLowerCase()
  const p = path.toLowerCase()
  return !w || p === w || p === `${w}.md` || p.startsWith(`${w}/`)
}

// ---------- Calendar ----------

export interface CalendarLine {
  date: string
  start?: string
  end?: string
  title: string
  /** Where it's from: "Orbit (daily note)", "Google: Family", "Due" … */
  from: string
  done?: boolean
}

/** Events from connected calendars as lines (timed ones in this computer's time). */
export function eventLines(events: readonly CalEvent[]): CalendarLine[] {
  return events.map((e) => {
    if (e.allDay) return { date: e.start.slice(0, 10), title: e.title, from: e.calendarName }
    const s = new Date(e.start)
    const end = new Date(e.end)
    const t = (d: Date): string => `${p2(d.getHours())}:${p2(d.getMinutes())}`
    return { date: dayOf(s), start: t(s), end: dayOf(end) === dayOf(s) ? t(end) : undefined, title: e.title, from: e.calendarName }
  })
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function calendarText(lines: readonly CalendarLine[], from: string, to: string): string {
  const inRange = lines.filter((l) => l.date >= from && l.date <= to)
  if (!inRange.length) return `Nothing on between ${from} and ${to}.`
  const sorted = [...inRange].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''))
  const out: string[] = []
  let current = ''
  for (const l of sorted) {
    if (l.date !== current) {
      current = l.date
      const d = new Date(`${l.date}T12:00:00`)
      out.push(`${out.length ? '\n' : ''}${WEEKDAY[d.getDay()]} ${l.date}`)
    }
    const when = l.start ? `${l.start}${l.end ? `–${l.end}` : ''}` : 'all day'
    out.push(`  ${when}  ${l.title}${l.done ? ' (done)' : ''}  [${l.from}]`)
  }
  return out.join('\n')
}

// ---------- Countdowns ----------

export function countdownsText(list: readonly Countdown[], now: Date): string {
  if (!list.length) return 'No countdowns yet. They’re made on the Countdowns page.'
  return sortCountdowns(list, now)
    .map((c) => {
      const s = countdownStatus(c, now)
      return `${c.title}: ${leftText(s, !!c.time)} (${c.date}${c.time ? ` ${c.time}` : ''}${c.yearly ? ', every year' : ''}${s.state === 'upcoming' ? `, ${s.days} days` : ''})`
    })
    .join('\n')
}

// ---------- Flashcards ----------

export interface CardWithProgress {
  path: string
  question: string
  answer: string
  /** Missing for a card never reviewed. */
  progress?: { due: string; interval: number; ease: number; streak: number }
}

/** A card they keep getting wrong: reviewed, and its ease has dropped or it's back to the start. */
export const isStruggling = (c: CardWithProgress): boolean => !!c.progress && (c.progress.ease < 2.3 || (c.progress.streak === 0 && c.progress.interval <= 1))

export function flashcardsText(cards: readonly CardWithProgress[], today: string, opts: { struggling?: boolean; limit?: number } = {}): string {
  const list = opts.struggling ? cards.filter(isStruggling) : [...cards]
  if (!list.length) return opts.struggling ? 'No cards they keep getting wrong (or none reviewed yet).' : 'No flashcards found. A flashcard is a line in a note written “Question :: Answer”.'
  const hard = (c: CardWithProgress): number => (isStruggling(c) ? 0 : 1)
  list.sort((a, b) => hard(a) - hard(b) || (a.progress?.ease ?? 9) - (b.progress?.ease ?? 9) || a.path.localeCompare(b.path))
  const due = cards.filter((c) => !c.progress || c.progress.due <= today).length
  const shown = list.slice(0, opts.limit ?? 300)
  const head = `${cards.length} card(s), ${due} due today, ${cards.filter(isStruggling).length} they keep getting wrong.`
  const rows = shown.map((c) => {
    const how = !c.progress ? 'new' : `${isStruggling(c) ? 'keeps getting wrong, ' : ''}known ${c.progress.streak} time(s) in a row, next due ${c.progress.due}`
    return `- ${c.question} :: ${c.answer}  (${c.path}; ${how})`
  })
  return [head, ...rows, shown.length < list.length ? `…and ${list.length - shown.length} more.` : ''].filter(Boolean).join('\n')
}

/** Cards as lines for a note ("Question :: Answer"), with anything that would break the format taken out. */
export function flashcardLines(cards: readonly { question: string; answer: string }[]): string[] {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*::\s*/g, ': ').trim()
  return cards
    .map((c) => ({ q: clean(c.question), a: clean(c.answer) }))
    .filter((c) => c.q && c.a)
    .map((c) => `- ${c.q} :: ${c.a}`)
}

// ---------- Files ----------

export function taggedText(entries: readonly ExplorerEntry[], colour: string, withinDays: number | undefined, now: number): string {
  const since = withinDays ? now - withinDays * 86_400_000 : 0
  const list = entries.filter((e) => e.modified >= since).sort((a, b) => b.modified - a.modified)
  if (!list.length) return withinDays ? `Nothing tagged ${colour} has changed in the last ${withinDays} day(s).` : `Nothing is tagged ${colour}.`
  return list.map((e) => `${e.path}${e.isDir ? ' (folder)' : `, ${sizeText(e.size)}`}, changed ${dayOf(new Date(e.modified))}`).join('\n')
}

export function downloadsText(state: DmState): string {
  if (!state.items.length) return 'Nothing in the download manager.'
  const order = { downloading: 0, queued: 1, paused: 2, failed: 3, done: 4 } as const
  return [...state.items]
    .sort((a, b) => order[a.status] - order[b.status] || b.added - a.added)
    .slice(0, 60)
    .map((i) => {
      const pct = i.progress !== undefined ? Math.round(i.progress * 100) : i.total ? Math.round((i.received / i.total) * 100) : null
      const extra =
        i.status === 'downloading'
          ? `${pct !== null ? `${pct}%` : sizeText(i.received)}${i.speed ? ` at ${sizeText(i.speed)}/s` : ''}${i.stage ? `, ${i.stage}` : ''}`
          : i.status === 'failed'
            ? i.error ?? 'failed'
            : i.status === 'queued' && i.overnight
              ? 'waiting for the overnight hours'
              : i.status === 'done' && i.path
                ? i.path
                : ''
      return `[${i.status}] ${i.name}${extra ? `: ${extra}` : ''}`
    })
    .join('\n')
}

export function drivesText(drives: Record<string, DriveSpace | null>): string {
  const rows = Object.entries(drives)
    .filter((e): e is [string, DriveSpace] => !!e[1] && e[1].total > 0)
    .map(([path, d]) => ({ path, d, used: 1 - d.free / d.total }))
    .sort((a, b) => b.used - a.used)
  if (!rows.length) return 'Orbit couldn’t read any drives.'
  return rows.map((r) => `${r.path}: ${sizeText(r.d.free)} free of ${sizeText(r.d.total)} (${Math.round(r.used * 100)}% full${r.used >= 0.9 ? ', nearly full' : ''})`).join('\n')
}

// ---------- Music ----------

/** Songs whose title, artist, album or genre have every word searched for (or, failing that, any). */
export function matchSongs(songs: readonly LocalSong[], search: string): LocalSong[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hay = (s: LocalSong): string => `${s.title} ${s.artist} ${s.album} ${s.genre ?? ''}`.toLowerCase()
  const all = songs.filter((s) => words.every((w) => hay(s).includes(w)))
  return all.length ? all : songs.filter((s) => words.some((w) => w.length > 2 && hay(s).includes(w)))
}

/**
 * The one song Claude means ("Lost Boys", "Lost Boys by Phoebe Bridgers", "Phoebe Bridgers - Lost
 * Boys"). When an artist is given, only that artist's song counts: a song with the same name by
 * someone else is a different song. Null when there's none, or it can't tell which.
 */
export function pickSong(songs: readonly LocalSong[], want: string): LocalSong | null {
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const text = want.trim()
  if (!text) return null
  const artistOk = (song: LocalSong, artist: string): boolean => {
    const a = norm(song.artist)
    const w = norm(artist)
    return !!a && !!w && (a.includes(w) || w.includes(a) || w.split(' ').filter((x) => x.length > 2).every((x) => a.includes(x)))
  }
  const parts = /^(.+?)\s+by\s+(.+)$/i.exec(text) ?? /^(.+?)\s+-\s+(.+)$/.exec(text)
  if (parts) {
    for (const [title, artist] of [
      [parts[1], parts[2]],
      [parts[2], parts[1]]
    ]) {
      const hit = songs.find((s) => norm(s.title) === norm(title) && artistOk(s, artist))
      if (hit) return hit
    }
  }
  // The whole thing as a title ("No One Left To Love", or a title that has " - " in it).
  const titled = songs.filter((s) => norm(s.title) === norm(text))
  if (titled.length === 1 || (titled.length > 1 && titled.every((s) => norm(s.artist) === norm(titled[0].artist)))) return titled[0]
  if (titled.length > 1 || parts) return null
  // Every word somewhere in the title, artist or album, and only one song like that.
  const words = norm(text).split(' ').filter(Boolean)
  const loose = songs.filter((s) => {
    const hay = norm(`${s.title} ${s.artist} ${s.album}`)
    return words.every((w) => hay.includes(w))
  })
  return loose.length === 1 ? loose[0] : null
}

/** Songs as lines for Claude: "Title by Artist (Album, genre)". */
export const songLines = (songs: readonly LocalSong[]): string =>
  songs.map((s) => `${s.title} by ${s.artist || 'unknown artist'}${s.album || s.genre ? ` (${[s.album, s.genre].filter(Boolean).join(', ')})` : ''}`).join('\n')

/** Artists in a list of songs, most songs first, as seeds for suggestions. */
export function artistSeeds(songs: readonly LocalSong[], limit = 8): { name: string; weight: number }[] {
  const counts = new Map<string, number>()
  for (const s of songs) for (const a of s.artist.split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i).filter(Boolean)) counts.set(a, (counts.get(a) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, weight]) => ({ name, weight }))
}

// ---------- world clocks ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Sam (Sydney): Thu 06:05 (Tomorrow), 11 hours ahead, Probably asleep" */
export function clockLine(c: WorldClock, home: string, now: Date, twelve: boolean): string {
  const t = timeIn(c.zone, now)
  const parts = [`${WEEKDAYS[t.weekday]} ${clockText(t, twelve)} (${relativeDay(c.zone, home, now)})`, differenceText(c.zone, home, now)]
  if (c.person) parts.push(messageTime(t).text)
  const change = nextChange(c.zone, now, 30)
  if (change) parts.push(changeSentence(c.zone, change, twelve))
  return `${clockTitle(c)}${c.person ? ` (${c.label})` : ''} [${c.zone}]: ${parts.join(', ')}`
}

export function clocksText(clocks: WorldClock[], home: string, now: Date, twelve: boolean): string {
  const here = timeIn(home, now)
  const lines = [`Here [${home}]: ${WEEKDAYS[here.weekday]} ${clockText(here, twelve)}`]
  if (!clocks.length) lines.push('No world clocks yet.')
  return [...lines, ...clocks.map((c) => clockLine(c, home, now, twelve))].join('\n')
}

/** The moment it's `time` (HH:MM) on `date` (YYYY-MM-DD) on the clocks in `zone`. */
export function wallTimeIn(zone: string, date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let at = guess - offsetMinutes(zone, new Date(guess)) * 60_000
  // Near a clock change the first guess can be an hour out: check it once more.
  const again = guess - offsetMinutes(zone, new Date(at)) * 60_000
  if (again !== at) at = again
  return new Date(at)
}

// ---------- task manager ----------

export type TaskSort = 'cpu' | 'memory' | 'disk' | 'name'

/** The programs running, busiest first: what Claude reads from the task manager. */
export function tasksText(groups: TaskGroup[], sort: TaskSort = 'cpu', limit = 25, search = ''): string {
  const q = search.trim().toLowerCase()
  const list = groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.procs.some((p) => p.window?.toLowerCase().includes(q)))
  const key = (g: TaskGroup): number => (sort === 'memory' ? g.mem : sort === 'disk' ? (g.disk ?? 0) : g.cpu)
  list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : key(b) - key(a)))
  if (!list.length) return q ? `Nothing running matches “${search}”.` : 'Nothing is running (or it couldn’t be read).'
  const lines = list.slice(0, limit).map((g) => {
    const bits = [`CPU ${formatPercent(g.cpu)}`, `memory ${formatBytes(g.mem)}`]
    if (g.disk !== undefined) bits.push(`disk ${formatRate(g.disk)}`)
    if (g.procs.length > 1) bits.push(`${g.procs.length} processes`)
    const kind = g.kind === 'app' ? 'app' : g.kind === 'background' ? 'background' : 'system'
    return `${g.name} (${kind}${g.self ? ', this is Orbit' : ''}): ${bits.join(', ')}`
  })
  return lines.join('\n') + (list.length > limit ? `\n…and ${list.length - limit} more.` : '')
}

export function perfText(p: TaskPerf): string {
  const lines = [`CPU: ${formatPercent(p.cpu)}${p.cpuName ? ` (${p.cpuName}, ${p.cores.length} cores)` : ''}`, `Memory: ${formatBytes(p.memUsed)} of ${formatBytes(p.memTotal)} used (${formatPercent((p.memUsed / Math.max(1, p.memTotal)) * 100)})`]
  if (p.diskRead !== undefined || p.diskWrite !== undefined) lines.push(`Disk: reading ${formatRate(p.diskRead)}, writing ${formatRate(p.diskWrite)}`)
  if (p.netDown !== undefined || p.netUp !== undefined) lines.push(`Network: down ${formatRate(p.netDown)}, up ${formatRate(p.netUp)}`)
  lines.push(`Processes: ${p.processes}`, `On for: ${formatUptime(p.uptime)}`)
  return lines.join('\n')
}
