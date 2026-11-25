/**
 * New songs for you: songs that aren't in your music yet, from artists like the ones you play most.
 * It uses Deezer's free catalogue, the same one the Music page's Search uses (no account or key):
 * for each of your favourite artists it asks Deezer for similar artists, then for those artists' most
 * popular songs. Only artist names are sent, nothing else about you. main/songSearch.ts does the asking;
 * these are the plain parts, so they can be tested.
 */

import { parseDeezer, songKey, type FoundTrack } from './songSearch'

/** One of your favourite artists, and how much you play them (0 to 1). */
export interface DiscoverSeed {
  name: string
  weight: number
}

export interface DeezerArtist {
  id: number
  name: string
}

/** Songs from Deezer by one artist, and why they're suggested. */
export interface DiscoverGroup {
  /** "Like Daft Punk", "More from Daft Punk". */
  because: string
  /** How strongly it's suggested (more is better). */
  weight: number
  tracks: FoundTrack[]
}

export interface Discovery extends FoundTrack {
  because: string
}

const API = 'https://api.deezer.com'
export const deezerArtistSearchUrl = (name: string): string => `${API}/search/artist?limit=5&q=${encodeURIComponent(name.trim())}`
export const deezerRelatedUrl = (id: number): string => `${API}/artist/${id}/related?limit=20`
export const deezerTopUrl = (id: number, limit = 10): string => `${API}/artist/${id}/top?limit=${limit}`

/** Deezer's list of artists. */
export function parseDeezerArtists(json: unknown): DeezerArtist[] {
  const data = (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out: DeezerArtist[] = []
  for (const a of data as Record<string, unknown>[]) {
    if (a && typeof a.id === 'number' && typeof a.name === 'string') out.push({ id: a.id, name: a.name })
  }
  return out
}

/** Deezer's songs by an artist (its "top" list is songs, like search). */
export const parseDeezerTop = parseDeezer

const artistKey = (name: string): string => songKey(name, '')

/** The Deezer artist with this name (not just the first answer, which can be someone else). */
export function matchArtist(found: DeezerArtist[], name: string): DeezerArtist | null {
  const want = artistKey(name)
  return found.find((a) => artistKey(a.name) === want) ?? null
}

/**
 * The similar artists most worth suggesting: ones similar to several of your favourites (or to the ones
 * you play most) first. Your favourites themselves aren't in the list (they get "More from" instead).
 */
export function rankRelated(lists: { seed: DiscoverSeed; related: DeezerArtist[] }[], limit = 16): { artist: DeezerArtist; score: number; because: string }[] {
  const favourites = new Set(lists.map((l) => artistKey(l.seed.name)))
  const byKey = new Map<string, { artist: DeezerArtist; score: number; best: number; because: string }>()
  for (const { seed, related } of lists) {
    related.forEach((artist, i) => {
      const key = artistKey(artist.name)
      if (!key || favourites.has(key)) return
      // Deezer lists the most similar first.
      const n = seed.weight * (1 - i / (related.length + 5))
      const had = byKey.get(key)
      if (!had) byKey.set(key, { artist, score: n, best: n, because: `Like ${seed.name}` })
      else {
        had.score += n
        if (n > had.best) Object.assign(had, { best: n, because: `Like ${seed.name}` })
      }
    })
  }
  const ranked = [...byKey.values()].sort((a, b) => b.score - a.score)
  // Every favourite gets a few of its own similar artists in, then the best of the rest.
  const picked = new Set<string>()
  for (const { seed } of lists) {
    ranked.filter((r) => r.because === `Like ${seed.name}` && !picked.has(artistKey(r.artist.name))).slice(0, 3).forEach((r) => picked.add(artistKey(r.artist.name)))
  }
  for (const r of ranked) {
    if (picked.size >= Math.max(limit, lists.length * 3)) break
    picked.add(artistKey(r.artist.name))
  }
  return ranked.filter((r) => picked.has(artistKey(r.artist.name))).map(({ artist, score, because }) => ({ artist, score, because }))
}

/** A small random number maker that gives the same numbers for the same seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PickOptions {
  /** songKey() of every song already in your music: those are left out. */
  owned: Set<string>
  /** Change it for a fresh set from the same songs. */
  seed?: number
  limit?: number
  /** At most this many songs by one artist. */
  perArtist?: number
}

/**
 * The new songs to show: none you already have, no song twice (the same song is often on a single and an
 * album), a few per artist, the most strongly suggested artists and their most popular songs first,
 * with a little shuffle so New picks gives a different set.
 */
export function pickDiscoveries(groups: DiscoverGroup[], { owned, seed = 1, limit = 40, perArtist = 2 }: PickOptions): Discovery[] {
  const random = seeded(seed)
  const seen = new Set<string>()
  const scored: { track: Discovery; score: number; artist: string }[] = []
  for (const g of groups) {
    g.tracks.forEach((t, i) => {
      const key = songKey(t.artist, t.title)
      if (owned.has(key) || seen.has(key)) return
      seen.add(key)
      // A song's place in the artist's top list counts for less than how good a match the artist is.
      const score = g.weight * (1 - i / (g.tracks.length + 3) * 0.5) * (0.6 + random() * 0.8)
      scored.push({ track: { ...t, because: g.because }, score, artist: artistKey(t.artist) })
    })
  }
  // Best first, but each time a reason ("Like Daft Punk") is used the rest with it count for less, so
  // the list mixes your favourites rather than filling up with whoever you play most.
  const count = new Map<string, number>()
  const used = new Map<string, number>()
  const out: Discovery[] = []
  const left = scored.filter((s) => s.score > 0)
  while (out.length < limit && left.length) {
    let best = -1
    let bestScore = -Infinity
    for (let i = 0; i < left.length; i++) {
      const s = left[i]
      if ((count.get(s.artist) ?? 0) >= perArtist) continue
      const n = s.score * Math.pow(0.8, used.get(s.track.because) ?? 0)
      if (n > bestScore) {
        best = i
        bestScore = n
      }
    }
    if (best < 0) break
    const [s] = left.splice(best, 1)
    count.set(s.artist, (count.get(s.artist) ?? 0) + 1)
    used.set(s.track.because, (used.get(s.track.because) ?? 0) + 1)
    out.push(s.track)
  }
  return out
}
