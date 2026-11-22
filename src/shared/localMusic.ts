/**
 * Your own music files (MP3, M4A, FLAC…), played by Notes itself with no Spotify needed. You choose
 * a folder (your Music folder to start with); Notes reads the song names and album pictures from the
 * files and plays them through vault://music/<path in the folder>.
 */

export const LOCAL_AUDIO = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus']

export interface LocalSong {
  /** Where it is inside the music folder, with forward slashes ("Albums/Song.mp3"). */
  path: string
  title: string
  artist: string
  album: string
  /** Track number on the album (0 if unknown). */
  track: number
  durationMs: number
  /** The file has an album picture (served from vault://musicart/<path>). */
  art: boolean
  /** When the file was last changed (roughly when it was added), for Recently added. */
  added?: number
  /** e.g. "2007". */
  year?: string
  genre?: string
}

/** Details you can change, written into the file itself. Only the ones given are changed. */
export interface SongTagPatch {
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  track?: number
}

/** Files Orbit can write details and covers into. */
export const TAGGABLE = ['.mp3']
export const canTag = (path: string): boolean => TAGGABLE.some((ext) => path.toLowerCase().endsWith(ext))

export interface LocalLibrary {
  /** The folder, or null if none is chosen (or it's gone). */
  folder: string | null
  songs: LocalSong[]
  /** Stopped at the limit, so some songs aren't listed. */
  truncated?: boolean
  /** A folder you chose, rather than the computer's own Music folder. */
  chosen?: boolean
}

/** At most this many songs are listed. */
export const LOCAL_LIMIT = 20_000

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
export const localSongUrl = (path: string): string => `vault://music/${encodePath(path)}`
/** The song's cover; `version` (when the file changed) makes a new cover show at once rather than the old one kept for a while. */
export const localArtUrl = (path: string, version?: number): string => `vault://musicart/${encodePath(path)}${version ? `?v=${version}` : ''}`

/** What a file's name says when it has no tags: "01 - Artist - Title.mp3" → Artist, Title. */
export function guessFromName(path: string): { title: string; artist: string; track: number } {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
  const num = /^(\d{1,3})[\s.\-_)]+(.+)$/.exec(name)
  const rest = (num ? num[2] : name).trim()
  const parts = rest.split(/\s+[-–]\s+/)
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - '), track: num ? Number(num[1]) : 0 }
  return { artist: '', title: rest || name, track: num ? Number(num[1]) : 0 }
}

/** Artist, then album, then track number, then title, ignoring case and a leading "The". */
export function sortSongs(songs: LocalSong[]): LocalSong[] {
  const key = (s: string): string => s.toLowerCase().replace(/^the\s+/, '')
  return [...songs].sort(
    (a, b) =>
      key(a.artist || '￿').localeCompare(key(b.artist || '￿')) ||
      key(a.album).localeCompare(key(b.album)) ||
      a.track - b.track ||
      key(a.title).localeCompare(key(b.title))
  )
}

/** Songs whose title, artist or album (or anything `extra` adds, like your tags) has every word you typed. */
export function filterSongs(songs: LocalSong[], query: string, extra?: (s: LocalSong) => string): LocalSong[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return songs
  return songs.filter((s) => {
    const text = `${s.title} ${s.artist} ${s.album} ${s.genre ?? ''} ${extra?.(s) ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

/** How Tidy my files names songs: all in one folder, or in Artist / Album folders. */
export type TidyLayout = 'flat' | 'folders'

/** A name that works on Windows, Mac and Google Drive. */
export function safeName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `${clean}_` : clean
}

/** Where Tidy my files would put a song ("Artist - Title.mp3", or "Artist/Album/01 Title.mp3"). */
export function tidyPath(song: LocalSong, layout: TidyLayout): string {
  const ext = (/\.[^./]+$/.exec(song.path)?.[0] ?? '.mp3').toLowerCase()
  const artist = safeName(song.artist) || 'Unknown artist'
  const title = safeName(song.title) || 'Untitled'
  if (layout === 'flat') return `${artist} - ${title}${ext}`
  const album = safeName(song.album)
  const num = song.track > 0 ? `${String(song.track).padStart(2, '0')} ` : ''
  return album ? `${artist}/${album}/${num}${title}${ext}` : `${artist}/${title}${ext}`
}

/** Moves for tidying: only songs not already in place, with clashes numbered ("… (2).mp3"). */
export function tidyMoves(songs: LocalSong[], layout: TidyLayout): { from: string; to: string }[] {
  const taken = new Set(songs.map((s) => s.path.toLowerCase()))
  const moves: { from: string; to: string }[] = []
  for (const s of songs) {
    const want = tidyPath(s, layout)
    if (want.toLowerCase() === s.path.toLowerCase()) continue
    let to = want
    for (let n = 2; taken.has(to.toLowerCase()); n++) to = want.replace(/(\.[^./]+)$/, ` (${n})$1`)
    taken.delete(s.path.toLowerCase())
    taken.add(to.toLowerCase())
    moves.push({ from: s.path, to })
  }
  return moves
}

const foldKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '')

/** The same song more than once: same artist and title (ignoring "(Remastered)" and the like) and nearly the same length. */
export function duplicateGroups(songs: LocalSong[]): LocalSong[][] {
  const byKey = new Map<string, LocalSong[]>()
  for (const s of songs) {
    const key = `${foldKey(s.artist)}|${foldKey(s.title)}`
    if (key === '|') continue
    byKey.set(key, [...(byKey.get(key) ?? []), s])
  }
  const groups: LocalSong[][] = []
  for (const list of byKey.values()) {
    const left = [...list]
    while (left.length > 1) {
      const first = left.shift()!
      const same = left.filter((s) => !first.durationMs || !s.durationMs || Math.abs(s.durationMs - first.durationMs) <= 3000)
      if (same.length) groups.push([first, ...same])
      for (const s of same) left.splice(left.indexOf(s), 1)
    }
  }
  return groups
}
