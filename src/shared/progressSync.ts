/**
 * Where you're up to in videos and comics, shared between your computers through the notes folder
 * (.notesapp/video-progress.json and .notesapp/comic-progress.json), the same way stars and
 * flashcards follow your notes via Google Drive.
 *
 * Each computer keeps its own copy too (so it still works with no notes folder open). When they
 * meet, the newest change to each video or comic wins, so reading on the MacBook and then on the PC
 * carries on from wherever you were last, whichever computer that was.
 *
 * Files live in different places on each computer, so things are matched by their file name
 * (comics: name and size), not by where they are.
 */

/** One thing's synced state: `value` null means it was cleared ("start again"). */
export interface SyncedEntry<T> {
  updated: number
  value: T | null
}
export type Synced<T> = Record<string, SyncedEntry<T>>

const isEntry = (v: unknown): v is SyncedEntry<unknown> =>
  !!v && typeof v === 'object' && typeof (v as SyncedEntry<unknown>).updated === 'number' && 'value' in (v as object)

/** Reads a synced list from a file's JSON, dropping anything that isn't one. */
export function readSynced<T>(raw: unknown, valid: (v: unknown) => v is T): Synced<T> {
  const out: Synced<T> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEntry(entry) || !Number.isFinite(entry.updated)) continue
    if (entry.value === null || valid(entry.value)) out[key] = { updated: entry.updated, value: entry.value as T | null }
  }
  return out
}

/** Both lists together: for each key, the newer change wins (`a` wins a tie). */
export function mergeSynced<T>(a: Synced<T>, b: Synced<T>): Synced<T> {
  const out: Synced<T> = { ...b }
  for (const [key, entry] of Object.entries(a)) {
    const other = out[key]
    if (!other || entry.updated >= other.updated) out[key] = entry
  }
  return out
}

/** Keeps the `max` most recently changed. */
export function newest<T>(list: Synced<T>, max: number): Synced<T> {
  const keys = Object.keys(list)
  if (keys.length <= max) return list
  const keep = keys.sort((x, y) => list[y].updated - list[x].updated).slice(0, max)
  return Object.fromEntries(keep.map((k) => [k, list[k]]))
}

/** Whether two lists say the same thing (so there's nothing to write). */
export function sameSynced<T>(a: Synced<T>, b: Synced<T>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => b[k] && b[k].updated === a[k].updated && JSON.stringify(b[k].value) === JSON.stringify(a[k].value))
}

// ---- videos ----

/** What's shared about a video. Subtitle files picked by hand aren't: their path is this computer's. */
export interface SyncedVideo {
  name: string
  /** Seconds in (0 once it was watched to the end). */
  at: number
  duration: number | null
  audio?: number
  speed?: number
  subtitleDelay?: number
  /** Only "off" or one of the video's own tracks. */
  subtitles?: { kind: 'off' } | { kind: 'stream'; stream: number }
}

export const VIDEO_SYNC_FILE = 'video-progress.json'
export const COMIC_SYNC_FILE = 'comic-progress.json'
/** Most videos remembered in the shared file. */
export const MAX_SYNCED_VIDEOS = 500

/** A video's key in the shared file: its file name, whichever folder it's in. */
export const videoSyncKey = (path: string): string => path.replace(/^.*[\\/]/, '').toLowerCase()

export const isSyncedVideo = (v: unknown): v is SyncedVideo => {
  const x = v as SyncedVideo
  return !!x && typeof x === 'object' && typeof x.name === 'string' && typeof x.at === 'number' && Number.isFinite(x.at) && (x.duration === null || typeof x.duration === 'number')
}
