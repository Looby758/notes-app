import type { LocalSong } from './localMusic'
import type { ThemeColors } from './themes'

/**
 * The thinking behind some of Claude Desktop's bigger tools (main/claudeTools.ts): free time for
 * planning a week, the music DJ and mood picks, a theme from one colour, and tidying data for Claude.
 */

// ---------- free time ----------

export interface Busy {
  date: string
  start: string
  end?: string
}

export interface FreeSlot {
  date: string
  start: string
  end: string
  minutes: number
}

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toTime = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The gaps of at least `minMinutes` between `dayStart` and `dayEnd` on each day, around what's on. Events with no end take an hour. */
export function freeSlots(busy: Busy[], days: string[], dayStart: string, dayEnd: string, minMinutes: number): FreeSlot[] {
  const out: FreeSlot[] = []
  const from = toMin(dayStart)
  const to = toMin(dayEnd)
  for (const date of days) {
    const taken = busy
      .filter((b) => b.date === date)
      .map((b) => [toMin(b.start), b.end && toMin(b.end) > toMin(b.start) ? toMin(b.end) : toMin(b.start) + 60] as const)
      .sort((a, b) => a[0] - b[0])
    let at = from
    for (const [s, e] of taken) {
      if (s - at >= minMinutes && s > at) out.push({ date, start: toTime(at), end: toTime(Math.min(s, to)), minutes: Math.min(s, to) - at })
      at = Math.max(at, e)
      if (at >= to) break
    }
    if (to - at >= minMinutes) out.push({ date, start: toTime(at), end: toTime(to), minutes: to - at })
  }
  return out.filter((s) => s.minutes >= minMinutes)
}

// ---------- music ----------

const norm = (s: string | undefined): string => (s ?? '').toLowerCase().trim()
const artistsOf = (s: LocalSong): string[] => s.artist.split(/\s*(?:,|&|feat\.?|ft\.?|\bx\b)\s*/i).map(norm).filter(Boolean)

export interface DjInput {
  /** Each playlist's song paths. */
  playlists: string[][]
  /** Played lately (left out), and already playing or queued (left out too). */
  avoid: Set<string>
  liked: Set<string>
  ratings: Record<string, number>
  count: number
  /** 0 to 1; Math.random outside tests. */
  rand: () => number
}

/**
 * Songs to play after `current`, like a DJ: the same artists and genre, songs that sit in the same
 * playlists, liked and highly rated ones, with no more than two by one artist and a little chance
 * so it isn't the same every time.
 */
export function djPicks(current: LocalSong | null, songs: LocalSong[], o: DjInput): LocalSong[] {
  const curArtists = new Set(current ? artistsOf(current) : [])
  const curGenre = norm(current?.genre)
  const together = new Set<string>()
  if (current) for (const list of o.playlists) if (list.includes(current.path)) for (const p of list) together.add(p)
  const scored = songs
    .filter((s) => s.path !== current?.path && !o.avoid.has(s.path))
    .map((s) => {
      let score = o.rand() * 1.5
      if (artistsOf(s).some((a) => curArtists.has(a))) score += 3
      if (curGenre && norm(s.genre) === curGenre) score += 2
      if (together.has(s.path)) score += 2
      if (o.liked.has(s.path)) score += 1
      score += ((o.ratings[s.path] ?? 3) - 3) * 0.5
      return { s, score }
    })
    .sort((a, b) => b.score - a.score)
  const perArtist = new Map<string, number>()
  const out: LocalSong[] = []
  for (const { s } of scored) {
    const a = artistsOf(s)[0] ?? ''
    if ((perArtist.get(a) ?? 0) >= 2) continue
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1)
    out.push(s)
    if (out.length >= o.count) break
  }
  return out
}

export interface SongFilter {
  genres?: string[]
  artists?: string[]
  tags?: string[]
  /** Words in the title, album, genre or artist. */
  words?: string[]
}

/** Songs that fit a mood (genres, artists, tags or words), shuffled, adding up to about `minutes` (0: all of them). */
export function songsFor(songs: LocalSong[], f: SongFilter, tagsOf: Record<string, string[]>, minutes: number, rand: () => number): LocalSong[] {
  const g = (f.genres ?? []).map(norm).filter(Boolean)
  const a = (f.artists ?? []).map(norm).filter(Boolean)
  const t = (f.tags ?? []).map(norm).filter(Boolean)
  const w = (f.words ?? []).map(norm).filter(Boolean)
  const fits = songs.filter((s) => {
    const genre = norm(s.genre)
    const text = `${norm(s.title)} ${norm(s.album)} ${genre} ${norm(s.artist)}`
    return (
      (g.length && g.some((x) => genre.includes(x))) ||
      (a.length && artistsOf(s).some((x) => a.some((y) => x.includes(y)))) ||
      (t.length && (tagsOf[s.path] ?? []).some((x) => t.includes(norm(x)))) ||
      (w.length && w.some((x) => text.includes(x)))
    )
  })
  const mixed = fits
    .map((s) => ({ s, k: rand() }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.s)
  if (!minutes) return mixed
  const out: LocalSong[] = []
  let total = 0
  for (const s of mixed) {
    if (total >= minutes * 60_000) break
    out.push(s)
    total += s.durationMs || 210_000
  }
  return out
}

/** What's in the music folder, for picking songs by mood: genres, artists and tags with counts. */
export function libraryOverview(songs: LocalSong[], tagsOf: Record<string, string[]>): string {
  const count = (keys: string[]): string =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 60)
      .map(([k, n]) => `${k} (${n})`)
      .join(', ')
  const hours = songs.reduce((t, s) => t + (s.durationMs || 0), 0) / 3_600_000
  return [
    `${songs.length} songs, about ${hours.toFixed(1)} hours.`,
    `Genres: ${count(songs.map((s) => s.genre?.trim()).filter((x): x is string => !!x)) || 'none set'}`,
    `Artists: ${count(songs.map((s) => s.artist.trim()).filter(Boolean))}`,
    `Tags: ${count(Object.values(tagsOf).flat()) || 'none yet'}`
  ].join('\n')
}

// ---------- themes ----------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const rgbToHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
/** `a` moved towards `b` by `t` (0 to 1). */
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t)
}

export const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)

/** A full set of theme colours from one colour ("dark purple"): its shade for the background, and text that reads on it. */
export function themeColours(base: string, light: boolean): ThemeColors {
  const black = '#000000'
  const white = '#ffffff'
  if (light) {
    const bg = mix(white, base, 0.06)
    return {
      bg,
      bgPanel: mix(white, base, 0.1),
      bgRaised: white,
      bgHover: mix(white, base, 0.16),
      bgCode: mix(white, base, 0.12),
      border: mix(white, base, 0.22),
      borderStrong: mix(white, base, 0.35),
      textStrong: mix(black, base, 0.12),
      text: mix(black, base, 0.2),
      textMuted: mix(mix(black, base, 0.3), white, 0.35),
      textFaint: mix(mix(black, base, 0.3), white, 0.55)
    }
  }
  const bg = mix(black, base, 0.16)
  return {
    bg,
    bgPanel: mix(black, base, 0.12),
    bgRaised: mix(black, base, 0.22),
    bgHover: mix(black, base, 0.28),
    bgCode: mix(black, base, 0.1),
    border: mix(black, base, 0.32),
    borderStrong: mix(black, base, 0.45),
    textStrong: mix(white, base, 0.06),
    text: mix(white, base, 0.14),
    textMuted: mix(mix(white, base, 0.2), black, 0.35),
    textFaint: mix(mix(white, base, 0.2), black, 0.55)
  }
}

// ---------- tidying data for Claude ----------

const DROP = /^(skin|avatar|icon|art|cover|picture|image|images|texture|html|png|thumb|thumbnail)$/i

/** JSON for Claude without pictures and other bulk, cut at `max` characters. */
export function compactJson(value: unknown, max = 20_000): string {
  const text = JSON.stringify(
    value,
    (key, v) => {
      if (DROP.test(key)) return undefined
      if (typeof v === 'string' && (v.startsWith('data:') || v.length > 2000)) return undefined
      return v
    },
    0
  )
  if (!text) return 'Nothing.'
  return text.length > max ? `${text.slice(0, max)}… (cut short)` : text
}

/** "- Plants\n  - Roots\n  - Leaves" → a note whose headings make that mind map. */
export function outlineToHeadings(title: string, outline: string): string {
  const lines = outline.split('\n').filter((l) => l.trim())
  const indents = [...new Set(lines.map((l) => /^\s*/.exec(l.replace(/\t/g, '  '))![0].length))].sort((a, b) => a - b)
  const body = lines.map((l) => {
    const depth = indents.indexOf(/^\s*/.exec(l.replace(/\t/g, '  '))![0].length)
    const text = l.trim().replace(/^([-*+]|\d+[.)])\s+/, '')
    return `${'#'.repeat(Math.min(6, depth + 2))} ${text}`
  })
  return `# ${title.trim()}\n\n${body.join('\n\n')}\n`
}
