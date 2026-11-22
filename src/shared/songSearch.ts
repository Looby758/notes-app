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

/** What to type into YouTube to find a song's video. */
export const youtubeQuery = (artist: string, title: string): string => `${artist} ${title}`.replace(/\s+/g, ' ').trim()

/** The first video on a YouTube search results page (its HTML), or null. */
export function firstVideoId(html: string): string | null {
  return /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? /"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null
}

export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '')

/** A key that matches the same song in your library despite small differences ("(Remastered)", "The …"). */
export const songKey = (artist: string, title: string): string => `${fold(artist)}|${fold(title)}`
