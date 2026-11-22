/**
 * Searching every song there is, not only yours: Apple's free iTunes Search API (no account or key
 * needed) for the songs, and YouTube's search page for each song's video. main/songSearch.ts asks
 * them; these are the plain parts, so they can be tested.
 */

export interface FoundTrack {
  id: string
  title: string
  artist: string
  album: string
  /** e.g. "2007". */
  year: string
  genre: string
  durationMs: number
  /** Album picture (https), 300px. */
  art?: string
  /** A 30-second sample (https). */
  preview?: string
}

export const itunesSearchUrl = (query: string, limit = 40): string =>
  `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(query.trim())}`

/** iTunes's answer as songs (anything that isn't a song is skipped). */
export function parseItunes(json: unknown): FoundTrack[] {
  const results = (json as { results?: unknown[] } | null)?.results
  if (!Array.isArray(results)) return []
  const out: FoundTrack[] = []
  const seen = new Set<string>()
  for (const r of results as Record<string, unknown>[]) {
    if (!r || r.kind !== 'song' || typeof r.trackName !== 'string') continue
    const id = String(r.trackId ?? `${r.artistName}-${r.trackName}`)
    if (seen.has(id)) continue
    seen.add(id)
    const art = typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.') : undefined
    out.push({
      id,
      title: r.trackName,
      artist: typeof r.artistName === 'string' ? r.artistName : '',
      album: typeof r.collectionName === 'string' ? r.collectionName : '',
      year: typeof r.releaseDate === 'string' ? r.releaseDate.slice(0, 4) : '',
      genre: typeof r.primaryGenreName === 'string' ? r.primaryGenreName : '',
      durationMs: typeof r.trackTimeMillis === 'number' ? r.trackTimeMillis : 0,
      art: art?.startsWith('https://') ? art : undefined,
      preview: typeof r.previewUrl === 'string' && r.previewUrl.startsWith('https://') ? r.previewUrl : undefined
    })
  }
  return out
}

export const deezerSearchUrl = (query: string, limit = 40): string => `https://api.deezer.com/search?limit=${limit}&q=${encodeURIComponent(query.trim())}`

/**
 * Deezer's answer as songs. Deezer's free search (no key) has songs Apple's search leaves out, such as
 * Bad Bunny's "DÁKITI" or Childish Gambino's "Lithonia", but no year or genre.
 */
export function parseDeezer(json: unknown): FoundTrack[] {
  const results = (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(results)) return []
  const https = (v: unknown): string | undefined => (typeof v === 'string' && v.startsWith('https://') ? v : undefined)
  const out: FoundTrack[] = []
  for (const r of results as Record<string, unknown>[]) {
    if (!r || (r.type !== undefined && r.type !== 'track') || typeof r.title !== 'string') continue
    const artist = r.artist as { name?: unknown } | undefined
    const album = r.album as { title?: unknown; cover_big?: unknown; cover_medium?: unknown } | undefined
    out.push({
      id: `dz-${String(r.id ?? `${artist?.name}-${r.title}`)}`,
      title: r.title,
      artist: typeof artist?.name === 'string' ? artist.name : '',
      album: typeof album?.title === 'string' ? album.title : '',
      year: '',
      genre: '',
      durationMs: typeof r.duration === 'number' ? r.duration * 1000 : 0,
      art: https(album?.cover_big) ?? https(album?.cover_medium),
      preview: https(r.preview)
    })
  }
  return out
}

/**
 * Both catalogues' answers as one list: Deezer's first (it's ordered by how popular a song is, so the
 * original comes before covers), then Apple's. A song in both appears once, with Apple's year and genre.
 */
export function mergeSearches(deezer: FoundTrack[], itunes: FoundTrack[]): FoundTrack[] {
  const byKey = new Map<string, FoundTrack>()
  const out: FoundTrack[] = []
  const add = (t: FoundTrack): void => {
    const key = songKey(t.artist, t.title)
    const had = byKey.get(key)
    if (!had) {
      byKey.set(key, t)
      out.push(t)
    } else {
      had.year ||= t.year
      had.genre ||= t.genre
      had.art ||= t.art
      had.preview ||= t.preview
    }
  }
  deezer.forEach((t) => add({ ...t }))
  itunes.forEach((t) => add({ ...t }))
  return out
}

/** What to type into YouTube to find a song's video. */
export const youtubeQuery = (artist: string, title: string): string => `${artist} ${title}`.replace(/\s+/g, ' ').trim()

/** The first video on a YouTube search results page (its HTML), or null. */
export function firstVideoId(html: string): string | null {
  return /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null
}

export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '')

/** A key that matches the same song in your library despite small differences ("(Remastered)", "The …"). */
export const songKey = (artist: string, title: string): string => `${fold(artist)}|${fold(title)}`

const NOISE = /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|clip|music video|full song|explicit|soundtrack|ost|from|theme)\b[^)\]]*)[)\]]/gi

/** A video's title as a song: "Artist - Title (Official Video)" → Artist, Title. */
export function songFromVideoTitle(videoTitle: string): { artist: string; title: string } {
  const clean = videoTitle
    .replace(NOISE, '')
    .replace(/\s*\|\s*.*$/, '')
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = clean.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  return { artist: '', title: clean }
}

/** Whether a catalogue song is the one a video is of (titles match; artists too when known). */
export function sameSong(found: { artist: string; title: string }, want: { artist: string; title: string }): boolean {
  const ft = fold(found.title)
  const wt = fold(want.title)
  if (!ft || !wt || !(ft.includes(wt) || wt.includes(ft))) return false
  if (!want.artist) return true
  const fa = fold(found.artist)
  const wa = fold(want.artist)
  return !!fa && !!wa && (fa.includes(wa) || wa.includes(fa))
}

const HINT_SKIP = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'music', 'soundtrack', 'from', 'the', 'feat', 'and', 'with', 'ost', 'version', 'theme', 'full', 'song', 'visualizer', 'visualiser'])

/** Words in the video's title besides the song's own name ("Alan Wake 2 Soundtrack" → alan, wake). */
function hintWords(videoTitle: string, title: string): string[] {
  const own = new Set(title.toLowerCase().split(/[^a-z0-9]+/))
  return [...new Set(videoTitle.toLowerCase().split(/[^a-z0-9]+/))].filter((w) => w.length >= 3 && !own.has(w) && !HINT_SKIP.has(w))
}

/**
 * The catalogue song a video is of, or null when it can't be told. With the artist in the video's
 * title, a song by that artist wins. Otherwise the other words in the video's title (like a game or
 * film's name) have to show up in the song's artist or album, so a cover by someone else with the
 * same title isn't picked.
 */
export function catalogueMatch(found: FoundTrack[], videoTitle: string): FoundTrack | null {
  const want = songFromVideoTitle(videoTitle)
  const exact = want.artist ? found.find((t) => sameSong(t, want)) : undefined
  if (exact) return exact
  // No artist, or one the catalogue doesn't know ("Alan Wake 2 OST"): go by the other words.
  const hints = hintWords(videoTitle, want.title)
  const titleOnly = { artist: '', title: want.title }
  let best: FoundTrack | null = null
  let bestScore = 0
  for (const t of found) {
    if (!sameSong(t, titleOnly)) continue
    const where = `${t.artist} ${t.album}`.toLowerCase()
    const score = hints.filter((w) => where.includes(w)).length
    // Most of the other words have to be there: "The Walking Dead: The Ones Who Live" isn't "The Walking Dead: Dead City".
    if (score < Math.ceil(hints.length * 0.6)) continue
    if (score > bestScore) {
      best = t
      bestScore = score
    }
  }
  return best
}
