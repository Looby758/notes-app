/**
 * Orbit Music's own data for your music files: playlists, liked songs, star ratings, play counts and
 * what you've played. It's one small file, orbit-music.json, kept in the music folder next to the
 * songs (so with the folder in Google Drive, the Orbit Music phone app sees the same playlists).
 * Playlists never copy or move files: each is just a list of songs, by their path in the folder.
 *
 * Changes are made as small steps (`MusicEdit`) applied to the file as it is on disk right then, so
 * a change made on the phone a moment ago isn't overwritten by the computer, or the other way round.
 */

import type { LocalSong } from './localMusic'

export const MUSIC_DATA_FILE = 'orbit-music.json'

export interface MusicPlaylist {
  id: string
  name: string
  /** Song paths in the music folder, in order (a song can be in more than once). */
  songs: string[]
  created: number
  updated: number
}

export interface SongStats {
  plays: number
  lastPlayed?: number
}

export interface MusicData {
  version: 1
  playlists: MusicPlaylist[]
  /** Song path → when you liked it. */
  liked: Record<string, number>
  /** Song path → 1 to 5 stars. */
  ratings: Record<string, number>
  stats: Record<string, SongStats>
  /** What you played, newest last (only the most recent are kept). */
  history: { path: string; at: number }[]
  /** Song path → your own tags ("gym", "chill"…). */
  tags: Record<string, string[]>
}

/** How many plays the history keeps. */
export const HISTORY_LIMIT = 2000

export const emptyMusicData = (): MusicData => ({ version: 1, playlists: [], liked: {}, ratings: {}, stats: {}, history: [], tags: {} })

export type MusicEdit =
  | { kind: 'createPlaylist'; id: string; name: string; songs?: string[]; at: number }
  | { kind: 'renamePlaylist'; id: string; name: string; at: number }
  | { kind: 'deletePlaylist'; id: string }
  /** Puts back a deleted playlist where it was (undo). */
  | { kind: 'restorePlaylist'; playlist: MusicPlaylist; position: number }
  | { kind: 'addToPlaylist'; id: string; songs: string[]; at: number }
  /** Takes out the songs at these positions. */
  | { kind: 'removeFromPlaylist'; id: string; positions: number[]; at: number }
  /** Replaces the whole list (reordering, undo). */
  | { kind: 'setPlaylistSongs'; id: string; songs: string[]; at: number }
  | { kind: 'like'; paths: string[]; liked: boolean; at: number }
  | { kind: 'rate'; path: string; stars: number }
  | { kind: 'played'; path: string; at: number }
  /** Adds a tag to the songs, or takes it off. */
  | { kind: 'tag'; paths: string[]; tag: string; on: boolean }
  /** Files that moved (tidying, finding a missing song, keeping one of two copies): old path → new path. */
  | { kind: 'renamePaths'; map: Record<string, string> }
  /** Songs deleted from your music: out of every playlist, and their likes, ratings, plays and tags. */
  | { kind: 'forgetSongs'; paths: string[] }

/** A tag as it's kept: trimmed, lower case, one space between words. */
export const cleanTag = (tag: string): string => tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Reads the file's contents, keeping what makes sense and dropping anything broken. */
export function normalizeMusicData(raw: unknown): MusicData {
  const out = emptyMusicData()
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.playlists)) {
    for (const p of raw.playlists) {
      if (!isRecord(p) || !str(p.id) || !str(p.name)) continue
      out.playlists.push({
        id: p.id,
        name: p.name,
        songs: Array.isArray(p.songs) ? p.songs.filter(str) : [],
        created: num(p.created) ? p.created : 0,
        updated: num(p.updated) ? p.updated : 0
      })
    }
  }
  if (isRecord(raw.liked)) for (const [k, v] of Object.entries(raw.liked)) if (num(v)) out.liked[k] = v
  if (isRecord(raw.ratings)) for (const [k, v] of Object.entries(raw.ratings)) if (num(v) && v >= 1 && v <= 5) out.ratings[k] = Math.round(v)
  if (isRecord(raw.stats)) {
    for (const [k, v] of Object.entries(raw.stats)) {
      if (isRecord(v) && num(v.plays)) out.stats[k] = { plays: v.plays, ...(num(v.lastPlayed) ? { lastPlayed: v.lastPlayed } : {}) }
    }
  }
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) if (isRecord(h) && str(h.path) && num(h.at)) out.history.push({ path: h.path, at: h.at })
    out.history = out.history.slice(-HISTORY_LIMIT)
  }
  if (isRecord(raw.tags)) {
    for (const [k, v] of Object.entries(raw.tags)) {
      const list = Array.isArray(v) ? [...new Set(v.filter(str).map(cleanTag).filter(Boolean))] : []
      if (list.length) out.tags[k] = list
    }
  }
  return out
}

/** The data after one change (a new object; `data` is left as it was). */
export function applyMusicEdit(data: MusicData, edit: MusicEdit): MusicData {
  const d: MusicData = { ...data, playlists: data.playlists, liked: data.liked, ratings: data.ratings, stats: data.stats, history: data.history, tags: data.tags ?? {} }
  const updatePlaylist = (id: string, change: (p: MusicPlaylist) => MusicPlaylist): void => {
    d.playlists = data.playlists.map((p) => (p.id === id ? change(p) : p))
  }
  switch (edit.kind) {
    case 'createPlaylist':
      if (data.playlists.some((p) => p.id === edit.id)) return data
      d.playlists = [...data.playlists, { id: edit.id, name: edit.name.trim() || 'New playlist', songs: edit.songs ?? [], created: edit.at, updated: edit.at }]
      break
    case 'renamePlaylist':
      updatePlaylist(edit.id, (p) => ({ ...p, name: edit.name.trim() || p.name, updated: edit.at }))
      break
    case 'deletePlaylist':
      d.playlists = data.playlists.filter((p) => p.id !== edit.id)
      break
    case 'restorePlaylist': {
      if (data.playlists.some((p) => p.id === edit.playlist.id)) return data
      const list = [...data.playlists]
      list.splice(Math.max(0, Math.min(edit.position, list.length)), 0, edit.playlist)
      d.playlists = list
      break
    }
    case 'addToPlaylist':
      updatePlaylist(edit.id, (p) => ({ ...p, songs: [...p.songs, ...edit.songs], updated: edit.at }))
      break
    case 'removeFromPlaylist': {
      const drop = new Set(edit.positions)
      updatePlaylist(edit.id, (p) => ({ ...p, songs: p.songs.filter((_, i) => !drop.has(i)), updated: edit.at }))
      break
    }
    case 'setPlaylistSongs':
      updatePlaylist(edit.id, (p) => ({ ...p, songs: [...edit.songs], updated: edit.at }))
      break
    case 'like': {
      const liked = { ...data.liked }
      for (const path of edit.paths) {
        if (edit.liked) liked[path] ??= edit.at
        else delete liked[path]
      }
      d.liked = liked
      break
    }
    case 'rate': {
      const ratings = { ...data.ratings }
      if (edit.stars >= 1 && edit.stars <= 5) ratings[edit.path] = Math.round(edit.stars)
      else delete ratings[edit.path]
      d.ratings = ratings
      break
    }
    case 'played': {
      const old = data.stats[edit.path]
      d.stats = { ...data.stats, [edit.path]: { plays: (old?.plays ?? 0) + 1, lastPlayed: edit.at } }
      d.history = [...data.history, { path: edit.path, at: edit.at }].slice(-HISTORY_LIMIT)
      break
    }
    case 'tag': {
      const tag = cleanTag(edit.tag)
      if (!tag) return data
      const tags = { ...d.tags }
      for (const path of edit.paths) {
        const now = (tags[path] ?? []).filter((t) => t !== tag)
        if (edit.on) now.push(tag)
        if (now.length) tags[path] = now
        else delete tags[path]
      }
      d.tags = tags
      break
    }
    case 'renamePaths':
      return renamePaths(d, edit.map)
    case 'forgetSongs': {
      const gone = new Set(edit.paths)
      const keep = <T,>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([p]) => !gone.has(p)))
      d.playlists = data.playlists.map((p) => (p.songs.some((s) => gone.has(s)) ? { ...p, songs: p.songs.filter((s) => !gone.has(s)) } : p))
      d.liked = keep(data.liked)
      d.ratings = keep(data.ratings)
      d.stats = keep(data.stats)
      d.tags = keep(d.tags)
      d.history = data.history.filter((h) => !gone.has(h.path))
      break
    }
  }
  return d
}

/** Moves everything Orbit knows about a song to its new path; two songs becoming one are merged. */
function renamePaths(data: MusicData, map: Record<string, string>): MusicData {
  const to = (p: string): string => map[p] ?? p
  const moved = Object.keys(map).filter((k) => map[k] && map[k] !== k)
  if (!moved.length) return data
  const liked: Record<string, number> = {}
  for (const [p, at] of Object.entries(data.liked)) liked[to(p)] = Math.min(liked[to(p)] ?? at, at)
  const ratings: Record<string, number> = {}
  // A song's own rating wins over the one merged into it.
  for (const [p, n] of Object.entries(data.ratings)) if (!(p in map)) ratings[p] = n
  for (const [p, n] of Object.entries(data.ratings)) if (p in map) ratings[to(p)] ??= n
  const stats: Record<string, SongStats> = {}
  for (const [p, st] of Object.entries(data.stats)) {
    const old = stats[to(p)]
    const lastPlayed = Math.max(old?.lastPlayed ?? 0, st.lastPlayed ?? 0)
    stats[to(p)] = { plays: (old?.plays ?? 0) + st.plays, ...(lastPlayed ? { lastPlayed } : {}) }
  }
  const tags: Record<string, string[]> = {}
  for (const [p, list] of Object.entries(data.tags ?? {})) tags[to(p)] = [...new Set([...(tags[to(p)] ?? []), ...list])]
  return {
    ...data,
    playlists: data.playlists.map((p) => (p.songs.some((s) => s in map) ? { ...p, songs: p.songs.map(to) } : p)),
    liked,
    ratings,
    stats,
    history: data.history.map((h) => (h.path in map ? { ...h, path: to(h.path) } : h)),
    tags
  }
}

/** Every tag you've used, most used first (only on songs in `present`, when given). */
export function allTags(data: MusicData, present?: Set<string>): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const [path, list] of Object.entries(data.tags ?? {})) {
    if (present && !present.has(path)) continue
    for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export const songsWithTag = (songs: LocalSong[], data: MusicData, tag: string): LocalSong[] => songs.filter((s) => data.tags?.[s.path]?.includes(tag))

// ---------- Views of your library ----------

export interface Album {
  key: string
  name: string
  artist: string
  songs: LocalSong[]
  /** A song with a picture, for the cover. */
  art?: string
}

export interface Artist {
  name: string
  songs: LocalSong[]
  albums: number
  art?: string
}

const fold = (s: string): string => s.toLowerCase().replace(/^the\s+/, '')

/** Albums, by name then artist; songs without an album are left out. */
export function albumsOf(songs: LocalSong[]): Album[] {
  const map = new Map<string, Album>()
  for (const s of songs) {
    if (!s.album) continue
    const key = `${s.album.toLowerCase()}\u0000${(s.artist || '').toLowerCase()}`
    let a = map.get(key)
    if (!a) map.set(key, (a = { key, name: s.album, artist: s.artist, songs: [] }))
    a.songs.push(s)
    if (!a.art && s.art) a.art = s.path
  }
  const list = [...map.values()]
  for (const a of list) a.songs.sort((x, y) => x.track - y.track || x.title.localeCompare(y.title))
  return list.sort((x, y) => fold(x.name).localeCompare(fold(y.name)) || fold(x.artist).localeCompare(fold(y.artist)))
}

/** Artists, by name; songs without one go under "Unknown artist". */
export function artistsOf(songs: LocalSong[]): Artist[] {
  const map = new Map<string, Artist>()
  for (const s of songs) {
    const name = s.artist || 'Unknown artist'
    const key = name.toLowerCase()
    let a = map.get(key)
    if (!a) map.set(key, (a = { name, songs: [], albums: 0 }))
    a.songs.push(s)
    if (!a.art && s.art) a.art = s.path
  }
  const list = [...map.values()]
  for (const a of list) a.albums = new Set(a.songs.map((s) => s.album).filter(Boolean)).size
  return list.sort((x, y) => (x.name === 'Unknown artist' ? 1 : y.name === 'Unknown artist' ? -1 : fold(x.name).localeCompare(fold(y.name))))
}

export type SongSort = 'title' | 'artist' | 'album' | 'plays' | 'added' | 'time'

/** Songs sorted by a column; ties fall back to artist, album, track. */
export function sortSongsBy(songs: LocalSong[], by: SongSort, desc: boolean, stats: Record<string, SongStats> = {}): LocalSong[] {
  const base = (a: LocalSong, b: LocalSong): number =>
    fold(a.artist).localeCompare(fold(b.artist)) || fold(a.album).localeCompare(fold(b.album)) || a.track - b.track || fold(a.title).localeCompare(fold(b.title))
  const cmp: Record<SongSort, (a: LocalSong, b: LocalSong) => number> = {
    title: (a, b) => fold(a.title).localeCompare(fold(b.title)),
    artist: (a, b) => fold(a.artist).localeCompare(fold(b.artist)),
    album: (a, b) => fold(a.album).localeCompare(fold(b.album)),
    plays: (a, b) => (stats[a.path]?.plays ?? 0) - (stats[b.path]?.plays ?? 0),
    added: (a, b) => (a.added ?? 0) - (b.added ?? 0),
    time: (a, b) => a.durationMs - b.durationMs
  }
  const sign = desc ? -1 : 1
  return [...songs].sort((a, b) => sign * cmp[by](a, b) || base(a, b))
}

/** Your songs looked up by path (for playlists, liked and history, which store paths). */
export function songsByPath(songs: LocalSong[]): Map<string, LocalSong> {
  return new Map(songs.map((s) => [s.path, s]))
}

/** A playlist's songs that are still in the folder, with where each is in the playlist. */
export function playlistSongs(playlist: MusicPlaylist, byPath: Map<string, LocalSong>): { song: LocalSong | null; path: string; position: number }[] {
  return playlist.songs.map((path, position) => ({ song: byPath.get(path) ?? null, path, position }))
}

/** Liked songs, most recently liked first. */
export function likedSongs(data: MusicData, byPath: Map<string, LocalSong>): LocalSong[] {
  return Object.entries(data.liked)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => byPath.get(path))
    .filter((s): s is LocalSong => !!s)
}

/** Most played first (only songs played at least once). */
export function mostPlayed(songs: LocalSong[], stats: Record<string, SongStats>, limit = 100): LocalSong[] {
  return songs
    .filter((s) => (stats[s.path]?.plays ?? 0) > 0)
    .sort((a, b) => stats[b.path].plays - stats[a.path].plays || (stats[b.path].lastPlayed ?? 0) - (stats[a.path].lastPlayed ?? 0))
    .slice(0, limit)
}

/** Newest files first. */
export function recentlyAdded(songs: LocalSong[], limit = 100): LocalSong[] {
  return [...songs].sort((a, b) => (b.added ?? 0) - (a.added ?? 0)).slice(0, limit)
}

/** The total length of some songs, as "1 hr 12 min" or "34 min". */
export function totalLength(songs: LocalSong[]): string {
  const min = Math.round(songs.reduce((t, s) => t + s.durationMs, 0) / 60000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} hr ${min % 60} min`
}

// ---------- Up next ----------

/** The queue with `songs` going straight after the one playing. */
export function queuePlayNext<T>(queue: T[], index: number, songs: T[]): T[] {
  return [...queue.slice(0, index + 1), ...songs, ...queue.slice(index + 1)]
}

/** Moves the queue item at `from` to `to` (both positions in the queue); says where the playing song ended up. */
export function queueMove<T>(queue: T[], index: number, from: number, to: number): { queue: T[]; index: number } {
  if (from === to || from < 0 || from >= queue.length || to < 0 || to >= queue.length) return { queue, index }
  const list = [...queue]
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  let at = index
  if (from === index) at = to
  else if (from < index && to >= index) at = index - 1
  else if (from > index && to <= index) at = index + 1
  return { queue: list, index: at }
}

/** Takes the item at `at` out of the queue (not the one playing); says where the playing song is now. */
export function queueRemove<T>(queue: T[], index: number, at: number): { queue: T[]; index: number } {
  if (at === index || at < 0 || at >= queue.length) return { queue, index }
  return { queue: queue.filter((_, i) => i !== at), index: at < index ? index - 1 : index }
}
