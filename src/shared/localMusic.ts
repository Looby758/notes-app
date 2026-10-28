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
}

export interface LocalLibrary {
  /** The folder, or null if none is chosen (or it's gone). */
  folder: string | null
  songs: LocalSong[]
  /** Stopped at the limit, so some songs aren't listed. */
  truncated?: boolean
}

/** At most this many songs are listed. */
export const LOCAL_LIMIT = 20_000

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
export const localSongUrl = (path: string): string => `vault://music/${encodePath(path)}`
export const localArtUrl = (path: string): string => `vault://musicart/${encodePath(path)}`

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

/** Songs whose title, artist or album has every word you typed. */
export function filterSongs(songs: LocalSong[], query: string): LocalSong[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return songs
  return songs.filter((s) => {
    const text = `${s.title} ${s.artist} ${s.album}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}
