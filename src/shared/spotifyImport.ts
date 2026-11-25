import type { LocalSong } from './localMusic'

/**
 * "From Spotify" on the Music page: a Spotify playlist or album (from its link, or a pasted list)
 * checked against your own music, to see which songs you have and which you still need.
 * A public link is read from Spotify's embed page, which needs no sign-in (it shows the first 100
 * songs). Longer playlists, or Liked Songs, can be pasted as a list instead (for example a CSV
 * from Exportify).
 */

export interface SpotifyTrack {
  title: string
  artists: string[]
  durationMs: number
}

export interface SpotifyList {
  name: string
  /** Cover picture (https). */
  art?: string
  tracks: SpotifyTrack[]
  /** Spotify's embed only shows this many songs. */
  capped?: boolean
}

export const EMBED_LIMIT = 100

/** A Spotify link (or spotify: uri) to a playlist or album. */
export function parseSpotifyLink(text: string): { kind: 'playlist' | 'album'; id: string } | null {
  const t = text.trim()
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{10,40})/.exec(t) ?? /^spotify:(playlist|album):([A-Za-z0-9]{10,40})$/.exec(t)
  return m ? { kind: m[1] as 'playlist' | 'album', id: m[2] } : null
}

export const spotifyEmbedUrl = (link: { kind: string; id: string }): string => `https://open.spotify.com/embed/${link.kind}/${link.id}`

/** The songs on a Spotify embed page (its HTML). */
export function parseSpotifyEmbed(html: string): SpotifyList | null {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  let entity: Record<string, unknown> | undefined
  try {
    entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
  } catch {
    return null
  }
  if (!entity || !Array.isArray(entity.trackList)) return null
  const tracks: SpotifyTrack[] = []
  for (const t of entity.trackList as Record<string, unknown>[]) {
    if (!t || typeof t.title !== 'string') continue
    const artists = typeof t.subtitle === 'string' ? t.subtitle.split(/,\s*| /).map((a) => a.replace(/ /g, ' ').trim()).filter(Boolean) : []
    tracks.push({ title: t.title, artists, durationMs: typeof t.duration === 'number' ? t.duration : 0 })
  }
  const sources = (entity.coverArt as { sources?: { url?: string }[] } | undefined)?.sources
  const art = sources?.find((s) => typeof s.url === 'string' && s.url.startsWith('https://'))?.url
  return { name: typeof entity.name === 'string' ? entity.name : 'Spotify playlist', art, tracks, capped: tracks.length >= EMBED_LIMIT }
}

/** One line of a CSV file, with quoted fields. */
function csvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') (out.push(cur), (cur = ''))
    else cur += c
  }
  out.push(cur)
  return out
}

/**
 * A pasted list of songs: a CSV with "Track Name" and "Artist Name(s)" columns (Exportify's),
 * or one song a line as "Artist - Title".
 */
export function parseSongList(text: string, name = 'Pasted list'): SpotifyList {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const tracks: SpotifyTrack[] = []
  const head = lines[0] ? csvLine(lines[0]).map((h) => h.trim().toLowerCase()) : []
  const ti = head.findIndex((h) => h === 'track name' || h === 'name' || h === 'title')
  const ai = head.findIndex((h) => h.startsWith('artist name') || h === 'artist' || h === 'artists')
  if (ti >= 0 && ai >= 0) {
    const di = head.findIndex((h) => h.startsWith('duration') || h.startsWith('track duration'))
    for (const line of lines.slice(1)) {
      const cells = csvLine(line)
      const title = cells[ti]?.trim()
      if (!title) continue
      tracks.push({ title, artists: (cells[ai] ?? '').split(/\s*[,;]\s*/).filter(Boolean), durationMs: Number(cells[di]) || 0 })
    }
    return { name, tracks }
  }
  for (const line of lines) {
    const clean = line.replace(/^\s*\d+[.)]\s*/, '').trim()
    const parts = clean.split(/\s+[-–—]\s+/)
    if (parts.length >= 2) tracks.push({ title: parts.slice(1).join(' - ').trim(), artists: parts[0].split(/\s*,\s*|\s+&\s+/).filter(Boolean), durationMs: 0 })
    else if (clean) tracks.push({ title: clean, artists: [], durationMs: 0 })
  }
  return { name, tracks }
}

/** A song's title with the extras taken off: "(feat. …)", "[From …]", " - Remastered 2011". */
export const cleanTitle = (title: string): string =>
  title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo|from)\b.*$/i, '')
    .trim() || title

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')

/** Your copy of a Spotify song: the same title, and one of its artists (or a song with no artist written in it). */
export function findInLibrary(track: SpotifyTrack, songs: LocalSong[], index?: Map<string, LocalSong[]>): LocalSong | null {
  const key = fold(cleanTitle(track.title))
  if (!key) return null
  const same = index ? (index.get(key) ?? []) : songs.filter((s) => fold(cleanTitle(s.title)) === key)
  const artists = track.artists.map(fold).filter(Boolean)
  return (
    same.find((s) => {
      const a = fold(s.artist)
      return !!a && artists.some((x) => a.includes(x) || x.includes(a))
    }) ??
    same.find((s) => !s.artist || !artists.length) ??
    null
  )
}

/** Your songs by their folded title, to check a long list quickly. */
export function titleIndex(songs: LocalSong[]): Map<string, LocalSong[]> {
  const map = new Map<string, LocalSong[]>()
  for (const s of songs) {
    const key = fold(cleanTitle(s.title))
    if (key) map.set(key, [...(map.get(key) ?? []), s])
  }
  return map
}
