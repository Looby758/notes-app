/**
 * Recommended songs from your own music, worked out from how you listen: what you play (recent plays
 * count most), what you like and rate, your tags, and which songs you tend to play one after another.
 * Everything comes from orbit-music.json (shared/musicLibrary.ts), so plays on the phone count too.
 * Nothing leaves the computer and no other service is needed; the picks are always songs already in
 * your music folder (ones you haven't played much, ones you loved and haven't played lately, new ones).
 *
 * - `recommendSongs`: the Recommended list, with a short reason for each song.
 * - `songsLike`: a "song radio": songs that go with one song, for Play songs like this and the
 *   suggestions under Up next.
 */

import type { LocalSong } from './localMusic'
import type { MusicData } from './musicLibrary'

export interface Recommendation {
  song: LocalSong
  /** "Because you play a lot of Daft Punk", "Often played with “One More Time”"… */
  reason: string
}

const DAY = 86_400_000
/** Plays this many days ago count half as much as one today. */
const HALF_LIFE_DAYS = 30
/** Two plays this close together count as one listening session. */
const SESSION_GAP = 30 * 60_000

const keyOf = (s: string | undefined): string => (s ?? '').trim().toLowerCase()
const artistKey = (s: LocalSong): string => keyOf(s.artist) || 'unknown artist'
const albumKey = (s: LocalSong): string => (s.album ? `${keyOf(s.album)}\u0000${keyOf(s.artist)}` : '')
const genresOf = (s: LocalSong): string[] => (s.genre ?? '').split(/[;,/]/).map(keyOf).filter(Boolean)

/** A small random number maker that gives the same numbers for the same seed (so a list stays put until you ask for new picks). */
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

interface Taste {
  /** How much you like each song you've listened to (path → weight, more is better). */
  song: Map<string, number>
  artist: Map<string, number>
  album: Map<string, number>
  genre: Map<string, number>
  tag: Map<string, number>
  /** Songs played in the same sitting: path → path → how often. */
  together: Map<string, Map<string, number>>
  /** Plays per song in the last week, so songs on repeat right now aren't recommended again. */
  lastWeek: Map<string, number>
}

/** Divides every value by the biggest, so they're all 0 to 1. */
function normalise(map: Map<string, number>): Map<string, number> {
  let max = 0
  for (const v of map.values()) if (v > max) max = v
  if (max <= 0) return new Map()
  return new Map([...map].map(([k, v]) => [k, Math.max(0, v) / max]))
}

const add = (map: Map<string, number>, key: string, n: number): void => {
  if (key) map.set(key, (map.get(key) ?? 0) + n)
}

function learnTaste(data: MusicData, byPath: Map<string, LocalSong>, now: number): Taste {
  const song = new Map<string, number>()
  const lastWeek = new Map<string, number>()
  for (const h of data.history) {
    const age = Math.max(0, now - h.at) / DAY
    add(song, h.path, Math.pow(0.5, age / HALF_LIFE_DAYS))
    if (age < 7) add(lastWeek, h.path, 1)
  }
  // Play counts go back further than the history does; they count a little, so old favourites still matter.
  for (const [path, s] of Object.entries(data.stats)) add(song, path, Math.log1p(s.plays) * 0.4)
  for (const path of Object.keys(data.liked)) add(song, path, 3)
  for (const [path, stars] of Object.entries(data.ratings)) add(song, path, (stars - 3) * 1.5)

  const artist = new Map<string, number>()
  const album = new Map<string, number>()
  const genre = new Map<string, number>()
  const tag = new Map<string, number>()
  for (const [path, w] of song) {
    const s = byPath.get(path)
    if (!s || w <= 0) continue
    add(artist, artistKey(s), w)
    add(album, albumKey(s), w)
    for (const g of genresOf(s)) add(genre, g, w)
    for (const t of data.tags[path] ?? []) add(tag, t, w)
  }

  const together = new Map<string, Map<string, number>>()
  const link = (a: string, b: string, n: number): void => {
    if (a === b) return
    let m = together.get(a)
    if (!m) together.set(a, (m = new Map()))
    m.set(b, (m.get(b) ?? 0) + n)
  }
  const h = data.history
  for (let i = 0; i < h.length; i++) {
    // The next few songs in the same sitting, the very next one counting most.
    for (let j = i + 1; j < Math.min(h.length, i + 4); j++) {
      if (h[j].at - h[j - 1].at > SESSION_GAP) break
      const n = 1 / (j - i)
      link(h[i].path, h[j].path, n)
      link(h[j].path, h[i].path, n)
    }
  }

  return { song, artist: normalise(artist), album: normalise(album), genre: normalise(genre), tag: normalise(tag), together, lastWeek }
}

/** Takes the best-scored songs in order, with no more than `perArtist` by any one artist so the list isn't all one artist. */
function pickVaried<T extends { song: LocalSong; score: number }>(scored: T[], limit: number, perArtist: number): T[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const out: T[] = []
  const left: T[] = []
  const count = new Map<string, number>()
  for (const s of sorted) {
    if (out.length >= limit) break
    const a = artistKey(s.song)
    const n = count.get(a) ?? 0
    if (n >= perArtist) {
      left.push(s)
      continue
    }
    count.set(a, n + 1)
    out.push(s)
  }
  // A small library with few artists: fill up with the rest.
  for (const s of left) {
    if (out.length >= limit) break
    out.push(s)
  }
  return out
}

export interface RecommendOptions {
  now: number
  /** Change it for a fresh set of picks. */
  seed?: number
  limit?: number
}

/** Songs from your music you'd probably like to hear now, best first, each with a reason. */
export function recommendSongs(data: MusicData, songs: LocalSong[], { now, seed = 1, limit = 50 }: RecommendOptions): Recommendation[] {
  if (!songs.length) return []
  const byPath = new Map(songs.map((s) => [s.path, s]))
  const taste = learnTaste(data, byPath, now)
  const random = seeded(seed)

  // The songs you're most into, to find songs played alongside them.
  const favourites = [...taste.song].filter(([p, w]) => w > 0 && byPath.has(p)).sort((a, b) => b[1] - a[1]).slice(0, 40)
  /** Song → how much it's played alongside your favourites, and the favourite it's played with most. */
  const together = new Map<string, { n: number; with: string; best: number }>()
  for (const [path, w] of favourites) {
    for (const [other, n] of taste.together.get(path) ?? []) {
      const score = n * w
      const had = together.get(other)
      if (!had) together.set(other, { n: score, with: path, best: score })
      else {
        had.n += score
        if (score > had.best) Object.assign(had, { with: path, best: score })
      }
    }
  }
  const togetherMax = Math.max(0, ...[...together.values()].map((t) => t.n))
  const hasTaste = favourites.length > 0

  const scored: { song: LocalSong; score: number; reason: string }[] = []
  for (const s of songs) {
    const rating = data.ratings[s.path] ?? 0
    if (rating && rating <= 2) continue
    const stats = data.stats[s.path]
    const plays = stats?.plays ?? 0
    const last = stats?.lastPlayed ?? 0
    const daysSince = last ? (now - last) / DAY : Infinity
    if (daysSince < 2 || (taste.lastWeek.get(s.path) ?? 0) >= 3) continue

    const parts: { n: number; reason: string }[] = []
    const artistW = taste.artist.get(artistKey(s)) ?? 0
    if (artistW) parts.push({ n: artistW * 0.9, reason: `Because you play a lot of ${s.artist || 'this artist'}` })
    const albumW = taste.album.get(albumKey(s)) ?? 0
    if (albumW) parts.push({ n: albumW * 0.4, reason: `From ${s.album}, an album you play` })
    const genreW = Math.max(0, ...genresOf(s).map((g) => taste.genre.get(g) ?? 0))
    if (genreW) parts.push({ n: genreW * 0.5, reason: `More ${s.genre?.split(/[;,/]/)[0].trim()}, which you listen to a lot` })
    const tags = data.tags[s.path] ?? []
    const tagW = Math.max(0, ...tags.map((t) => taste.tag.get(t) ?? 0))
    if (tagW) parts.push({ n: tagW * 0.4, reason: `Tagged “${tags.find((t) => taste.tag.get(t) === tagW)}”, like songs you love` })
    const tog = together.get(s.path)
    if (tog && togetherMax > 0) {
      const withSong = byPath.get(tog.with)
      parts.push({ n: (tog.n / togetherMax) * 1.1, reason: withSong ? `Often played with “${withSong.title}”` : 'Often played with songs you love' })
    }

    // Songs you loved and haven't heard in a while.
    const own = taste.song.get(s.path) ?? 0
    const loved = s.path in data.liked || rating >= 4 || plays >= 8
    if (loved && daysSince > 30) parts.push({ n: 1 + Math.min(0.4, own / 20), reason: 'You loved this, and haven’t played it lately' })
    // New in your music and not played yet.
    if (!plays && s.added && now - s.added < 21 * DAY) parts.push({ n: 0.45, reason: 'New in your music' })

    let score = parts.reduce((t, p) => t + p.n, 0)
    let reason = parts.sort((a, b) => b.n - a.n)[0]?.reason
    if (!hasTaste || !reason) {
      // Nothing to go on yet: a few songs to try, new ones first.
      score += 0.05 + (s.added ? Math.max(0, 1 - (now - s.added) / (90 * DAY)) * 0.1 : 0)
      reason ??= hasTaste ? 'Something different to try' : 'Something to try'
    }
    // Songs played a lot recently, or never, are nudged down a little or up a little so it isn't all the same favourites.
    if (daysSince < 14) score *= 0.5
    if (!plays) score *= 1.15
    else if (plays > 20 && daysSince < 30) score *= 0.7
    // A little shuffle, so Refresh gives a new set and close calls change.
    score *= 0.8 + random() * 0.4
    scored.push({ song: s, score, reason })
  }
  return pickVaried(scored, limit, 3).map(({ song, reason }) => ({ song, reason }))
}

export interface LikeOptions {
  now: number
  seed?: number
  limit?: number
  /** Songs to leave out (already in Up next…). */
  skip?: Set<string>
}

/** Songs that go with one song: same artist or album, same genre or tags, played next to it, a similar year. Doesn't include the song itself. */
export function songsLike(seed: LocalSong, data: MusicData, songs: LocalSong[], { now, seed: randomSeed = 1, limit = 50, skip }: LikeOptions): LocalSong[] {
  const byPath = new Map(songs.map((s) => [s.path, s]))
  const taste = learnTaste(data, byPath, now)
  const random = seeded(randomSeed)
  const near = taste.together.get(seed.path)
  const nearMax = Math.max(0, ...(near?.values() ?? []))
  const seedGenres = new Set(genresOf(seed))
  const seedTags = new Set(data.tags[seed.path] ?? [])
  const seedYear = Number(seed.year) || 0
  const seedArtist = artistKey(seed)
  const seedAlbum = albumKey(seed)
  const songMax = Math.max(0, ...taste.song.values())

  const scored: { song: LocalSong; score: number }[] = []
  for (const s of songs) {
    if (s.path === seed.path || skip?.has(s.path)) continue
    const rating = data.ratings[s.path] ?? 0
    if (rating && rating <= 2) continue
    let score = 0
    if (artistKey(s) === seedArtist && seedArtist !== 'unknown artist') score += 1
    if (seedAlbum && albumKey(s) === seedAlbum) score += 0.3
    if (genresOf(s).some((g) => seedGenres.has(g))) score += 0.8
    score += Math.min(3, (data.tags[s.path] ?? []).filter((t) => seedTags.has(t)).length) * 0.35
    if (near && nearMax > 0) score += ((near.get(s.path) ?? 0) / nearMax) * 1.5
    const year = Number(s.year) || 0
    if (seedYear && year) score += Math.max(0, 1 - Math.abs(year - seedYear) / 10) * 0.25
    // Same artist's other songs and taste in general count via the other artists you play alongside it.
    score += (taste.artist.get(artistKey(s)) ?? 0) * 0.15
    if (songMax > 0) score += Math.max(0, taste.song.get(s.path) ?? 0) / songMax * 0.2
    if (score < 0.3) continue
    score *= 0.85 + random() * 0.3
    scored.push({ song: s, score })
  }
  return pickVaried(scored, limit, 4).map((s) => s.song)
}

/** The artists you play and like most (as they're written in your songs), with how much (0 to 1), for finding new music like theirs. */
export function favouriteArtists(data: MusicData, songs: LocalSong[], now: number, limit = 6): { name: string; weight: number }[] {
  const byPath = new Map(songs.map((s) => [s.path, s]))
  const taste = learnTaste(data, byPath, now)
  const names = new Map<string, string>()
  for (const s of songs) if (s.artist && !names.has(artistKey(s))) names.set(artistKey(s), s.artist)
  return [...taste.artist]
    .filter(([key, w]) => w > 0 && names.has(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, weight]) => ({ name: names.get(key)!, weight }))
}
