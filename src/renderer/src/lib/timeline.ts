import { compareEpisodes, findEpisodes, normalizeEpisode, parseEpisode } from './episodes'
import { markerText } from './script'

/**
 * The story timeline: what happened, to whom, and when, for planning videos about a story told
 * out of order (flashbacks, things only mentioned, the show and the comics disagreeing).
 *
 * Every entry has two times:
 *  - when it happened in the story: an era (pre-outbreak, the prison, Alexandria…) plus an optional
 *    rough time ("Day 3", "winter"), and its place among the other entries in that era (you put
 *    them in order by dragging; exact dates are rarely known);
 *  - where it was told or shown: the show episode or comic issue, and the time in the episode.
 *
 * Kept in .notesapp/timeline.json so it follows your notes. Fields this Orbit doesn't know are kept.
 */

export type Telling = 'shown' | 'told' | 'flashback'
export const TELLINGS: { id: Telling; label: string; hint: string }[] = [
  { id: 'shown', label: 'Shown', hint: 'Happens on screen or on the page, as it happens' },
  { id: 'told', label: 'Told', hint: 'Someone talks about it; never shown' },
  { id: 'flashback', label: 'Flashback', hint: 'Shown later, looking back' }
]

export type Medium = 'show' | 'comic'

export interface Era {
  id: string
  name: string
}

export interface TimelineEntry {
  id: string
  /** What happened. */
  text: string
  characters: string[]
  era: string
  /** Its place within the era (lower first). */
  order: number
  /** Rough time in the story, if known: "Day 3", "about 18 months in". */
  when: string
  medium: Medium
  /** "S4E9" or "Issue 115". */
  episode: string
  /** Where in the episode: "12:30". */
  at: string
  telling: Telling
  /** Quick-captured and not tidied yet. */
  inbox: boolean
  created: number
  updated: number
  [more: string]: unknown
}

export interface TimelineData {
  eras: Era[]
  entries: TimelineEntry[]
}

export const DEFAULT_ERAS: Era[] = [
  { id: 'pre', name: 'Before the outbreak' },
  { id: 'early', name: 'Early outbreak' },
  { id: 'atlanta', name: 'Atlanta camp' },
  { id: 'farm', name: 'The farm' },
  { id: 'prison', name: 'The prison' },
  { id: 'terminus', name: 'Terminus and the road' },
  { id: 'alexandria', name: 'Alexandria' },
  { id: 'saviors', name: 'War with the Saviors' },
  { id: 'jump', name: 'Time jump' },
  { id: 'whisperers', name: 'The Whisperers' },
  { id: 'commonwealth', name: 'The Commonwealth' },
  { id: 'after', name: 'After' }
]

export const emptyTimeline = (): TimelineData => ({ eras: DEFAULT_ERAS.map((e) => ({ ...e })), entries: [] })

export const newTimelineId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** "12:30", "1:02:05" or "" (anything else is dropped). */
export function cleanAt(v: string): string {
  const t = v.trim()
  return /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(t) ? t : ''
}

function readEntry(raw: unknown, eras: Set<string>, fallbackEra: string): TimelineEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const episode = normalizeEpisode(str(r.episode, 40)) ?? ''
  const medium: Medium = r.medium === 'comic' || r.medium === 'show' ? r.medium : parseEpisode(episode)?.kind === 'comic' ? 'comic' : 'show'
  return {
    ...r,
    id: r.id,
    text: str(r.text, 4000),
    characters: Array.isArray(r.characters) ? [...new Set(r.characters.filter((c): c is string => typeof c === 'string').map((c) => c.trim().slice(0, 60)).filter(Boolean))] : [],
    era: typeof r.era === 'string' && eras.has(r.era) ? r.era : fallbackEra,
    order: num(r.order, 0),
    when: str(r.when, 120),
    medium,
    episode,
    at: cleanAt(str(r.at, 12)),
    telling: r.telling === 'told' || r.telling === 'flashback' ? r.telling : 'shown',
    inbox: r.inbox === true,
    created: num(r.created, 0),
    updated: num(r.updated, num(r.created, 0))
  }
}

export function readTimeline(text: string | null): TimelineData {
  if (!text) return emptyTimeline()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyTimeline()
  }
  if (!raw || typeof raw !== 'object') return emptyTimeline()
  const r = raw as Record<string, unknown>
  const seenEra = new Set<string>()
  const eras = (Array.isArray(r.eras) ? r.eras : [])
    .map((e): Era | null => (e && typeof e === 'object' && typeof (e as Era).id === 'string' && (e as Era).id ? { id: (e as Era).id, name: str((e as Era).name, 80) || 'Untitled era' } : null))
    .filter((e): e is Era => !!e && !seenEra.has(e.id) && !!seenEra.add(e.id))
  const allEras = eras.length ? eras : emptyTimeline().eras
  const ids = new Set(allEras.map((e) => e.id))
  const seen = new Set<string>()
  const entries = (Array.isArray(r.entries) ? r.entries : [])
    .map((e) => readEntry(e, ids, allEras[0].id))
    .filter((e): e is TimelineEntry => !!e && !seen.has(e.id) && !!seen.add(e.id))
  return { eras: allEras, entries }
}

export const timelineJson = (data: TimelineData): string => JSON.stringify({ version: 1, eras: data.eras, entries: data.entries }, null, 2)

/** Entries in story order: by era, then by their place in it. */
export function storyOrder(data: TimelineData, entries = data.entries): TimelineEntry[] {
  const eraIndex = new Map(data.eras.map((e, i) => [e.id, i]))
  return [...entries].sort((a, b) => (eraIndex.get(a.era) ?? 0) - (eraIndex.get(b.era) ?? 0) || a.order - b.order || a.created - b.created)
}

/** Entries in the order they were shown or told: by episode, then time in it. */
export function tellingOrder(entries: TimelineEntry[]): TimelineEntry[] {
  const secs = (at: string): number => at.split(':').reduce((n, p) => n * 60 + Number(p), 0)
  return [...entries].sort((a, b) => {
    if (!a.episode || !b.episode) return a.episode ? -1 : b.episode ? 1 : 0
    return compareEpisodes(a.episode, b.episode) || secs(a.at) - secs(b.at)
  })
}

/** An order number that puts an entry at `index` among `list` (an era's entries in order, without it). */
export function orderAt(list: TimelineEntry[], index: number): number {
  const before = list[index - 1]?.order
  const after = list[index]?.order
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** Every character in the timeline, most entries first. */
export function timelineCharacters(entries: TimelineEntry[]): string[] {
  const counts = new Map<string, { name: string; n: number }>()
  for (const e of entries) {
    for (const c of e.characters) {
      const k = c.toLowerCase()
      const found = counts.get(k)
      if (found) found.n++
      else counts.set(k, { name: c, n: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => c.name)
}

export const hasCharacter = (e: TimelineEntry, name: string): boolean => e.characters.some((c) => c.toLowerCase() === name.toLowerCase())

/** Whether an entry matches a search: every word in its text, characters, episode or rough time. */
export function entryMatches(e: TimelineEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${e.text} ${e.characters.join(' ')} ${e.episode} ${e.when}`.toLowerCase()
  return words.every((w) => {
    const ep = normalizeEpisode(w)
    if (ep) return e.episode === ep || hay.includes(w)
    const season = /^s(\d{1,2})$/.exec(w)
    if (season) return e.episode.startsWith(`S${Number(season[1])}E`) || hay.includes(w)
    return hay.includes(w)
  })
}

/**
 * Quick capture: "S4E9 12:30 Maggie and Glenn find the cell block" → the episode, the time in it,
 * and any characters you've used before that it names, picked out of what you typed.
 */
export function parseCapture(input: string, knownCharacters: string[]): Pick<TimelineEntry, 'text' | 'episode' | 'at' | 'medium' | 'characters' | 'telling'> {
  let text = input.trim()
  const ep = findEpisodes(text)[0]
  const episode = ep?.label ?? ''
  const at = /(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=\s|$|[,.;])/.exec(text)?.[1] ?? ''
  // Take the episode and time off the front ("S4E9 12:30 …"), where they're labels, not part of the sentence.
  for (;;) {
    const m = /^(S\d{1,2}\s?E\d{1,3}|(?:Issue|TWD)\s*#?\s*\d{1,4}|(?:\d{1,2}:)?\d{1,2}:\d{2})[\s,:–-]+/i.exec(text)
    if (!m) break
    text = text.slice(m[0].length)
  }
  const lower = ` ${text.toLowerCase()} `
  const characters = knownCharacters.filter((c) => new RegExp(`[^\\p{L}]${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'u').test(lower))
  const telling: Telling = /\bflashback\b/i.test(text) ? 'flashback' : /\b(tells?|told|says|said|mentions?|talks about)\b/i.test(text) ? 'told' : 'shown'
  return { text, episode, at, medium: parseEpisode(episode)?.kind === 'comic' ? 'comic' : 'show', characters, telling }
}

/** Where an entry is from, for a Source marker or a label: "S4E9 at 12:30, flashback". */
export function sourceLabel(e: Pick<TimelineEntry, 'episode' | 'at' | 'telling' | 'medium'>): string {
  const where = e.episode ? `${e.episode}${e.at ? ` at ${e.at}` : ''}` : e.medium === 'comic' ? 'the comics' : ''
  const how = e.telling === 'shown' ? '' : e.telling === 'told' ? 'told' : 'flashback'
  return [where, how].filter(Boolean).join(', ')
}

/** What an entry becomes when dragged into a script: the story, then a Source marker saying where it's from. */
export function entryScriptText(e: TimelineEntry): string {
  const source = sourceLabel(e)
  const story = e.text.trim().replace(/\s*\n\s*/g, ' ')
  return source ? `${story} ${markerText('SOURCE', source)}` : story
}
