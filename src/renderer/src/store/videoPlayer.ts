import { create } from 'zustand'
import { isFinished } from '@shared/videoPlayer'
import { isSyncedVideo, MAX_SYNCED_VIDEOS, mergeSynced, newest, readSynced, sameSynced, VIDEO_SYNC_FILE, videoSyncKey, type Synced, type SyncedEntry, type SyncedVideo } from '@shared/progressSync'
import { openSpecialTab, VIDEO_TAB } from '../lib/editorController'
import { notify } from './notify'

/**
 * The video player's state: the video that's open, and every video you've watched (where you
 * stopped, the sound track, subtitles and speed you picked), so each one carries on where you left
 * it. Kept on this computer, and where you're up to is also shared with your other computers
 * through the notes folder (.notesapp/video-progress.json), matched by the video's file name.
 */

/** How subtitles were picked: off, a file, or one of the video's own tracks. */
export type SubtitleChoice = { kind: 'off' } | { kind: 'file'; path: string } | { kind: 'stream'; stream: number }

export interface Watched {
  path: string
  name: string
  /** Seconds in (0 once it was watched to the end). */
  at: number
  duration: number | null
  /** When it was last watched (ms). */
  watched: number
  /** The sound track (position in the video's list). */
  audio?: number
  subtitles?: SubtitleChoice
  speed?: number
  /** Subtitle timing nudge, in seconds. */
  subtitleDelay?: number
}

interface VideoPlayerState {
  /** The video on screen (its full path), or null for the list. */
  current: string | null
  /** Most recently watched first. */
  history: Watched[]
  volume: number
  muted: boolean
}

const KEY = 'orbit.videoPlayer'
const MAX_HISTORY = 200

function load(): Pick<VideoPlayerState, 'current' | 'history' | 'volume' | 'muted'> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VideoPlayerState>
    return {
      current: typeof raw.current === 'string' ? raw.current : null,
      history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.path === 'string') : [],
      volume: typeof raw.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : 1,
      muted: !!raw.muted
    }
  } catch {
    return { current: null, history: [], volume: 1, muted: false }
  }
}

export const useVideoPlayer = create<VideoPlayerState>(() => load())

useVideoPlayer.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ current: s.current, history: s.history, volume: s.volume, muted: s.muted }))
  } catch {
    // Storage full: it still plays, it just won't remember.
  }
})

const nameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/** Opens a video (full path) in the player tab. */
export function openVideo(path: string): void {
  useVideoPlayer.setState({ current: path })
  openSpecialTab(VIDEO_TAB)
}

/** Opens a video from the notes folder (its path in there). */
export function openVaultVideo(path: string): void {
  window.api.videoInVault(path).then(openVideo).catch(notify)
}

/** Back to the list of videos. */
export const closeVideo = (): void => useVideoPlayer.setState({ current: null })

/** What's remembered about a video: from this computer, or else from another one (same file name). */
export function watchedOf(path: string): Watched | undefined {
  const here = useVideoPlayer.getState().history.find((h) => h.path === path)
  if (here) return here
  const there = synced[videoSyncKey(path)]
  if (!there?.value) return undefined
  return { ...there.value, path, name: nameOf(path), watched: there.updated }
}

/** Remembers something about a video (where you are, its tracks…), moving it to the top of the list. */
export function remember(path: string, patch: Partial<Omit<Watched, 'path'>>): void {
  useVideoPlayer.setState((s) => {
    const old = s.history.find((h) => h.path === path)
    const next: Watched = { path, name: nameOf(path), at: 0, duration: null, ...old, ...patch, watched: Date.now() }
    if (patch.at !== undefined && isFinished(patch.at, next.duration)) next.at = 0
    return { history: [next, ...s.history.filter((h) => h.path !== path)].slice(0, MAX_HISTORY) }
  })
  syncSoon()
}

export const forgetVideo = (path: string): void => useVideoPlayer.setState((s) => ({ history: s.history.filter((h) => h.path !== path) }))

// ---- sharing with your other computers ----

/** The shared file as last read (or written), so videos watched elsewhere can carry on here. */
let synced: Synced<SyncedVideo> = {}

function toSynced(w: Watched): SyncedEntry<SyncedVideo> {
  const value: SyncedVideo = { name: w.name, at: w.at, duration: w.duration }
  if (w.audio !== undefined) value.audio = w.audio
  if (w.speed !== undefined) value.speed = w.speed
  if (w.subtitleDelay !== undefined) value.subtitleDelay = w.subtitleDelay
  if (w.subtitles && w.subtitles.kind !== 'file') value.subtitles = w.subtitles
  return { updated: w.watched, value }
}

/** This computer's list, by file name (the most recent wins if two folders have the same name). */
function localSynced(): Synced<SyncedVideo> {
  const out: Synced<SyncedVideo> = {}
  for (const h of useVideoPlayer.getState().history) {
    const key = videoSyncKey(h.path)
    if (!out[key]) out[key] = toSynced(h)
  }
  return out
}

let syncing = false
let syncAgain = false
let syncTimer: ReturnType<typeof setTimeout> | undefined

/** Reads the shared file, takes in anything newer from another computer, and writes back what's newer here. */
export async function syncVideoProgress(): Promise<void> {
  clearTimeout(syncTimer)
  syncTimer = undefined
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  try {
    const raw = await window.api.readAppData(VIDEO_SYNC_FILE)
    const remote = raw ? readSynced(JSON.parse(raw)?.videos, isSyncedVideo) : {}
    const merged = newest(mergeSynced(localSynced(), remote), MAX_SYNCED_VIDEOS)
    synced = merged
    // Videos you've watched here too, but further along on another computer: carry on from there.
    const history = useVideoPlayer.getState().history
    let changed = false
    const next = history.map((h) => {
      const m = merged[videoSyncKey(h.path)]
      if (!m?.value || m.updated <= h.watched) return h
      changed = true
      const { name: _name, subtitles, ...rest } = m.value
      return { ...h, ...rest, ...(subtitles ? { subtitles } : {}), watched: m.updated }
    })
    if (changed) useVideoPlayer.setState({ history: next.sort((a, b) => b.watched - a.watched) })
    if (!sameSynced(merged, remote)) await window.api.writeAppData(VIDEO_SYNC_FILE, JSON.stringify({ videos: merged }))
  } catch {
    // No notes folder open, or the file is half-synced: try again next time.
  } finally {
    syncing = false
    if (syncAgain) {
      syncAgain = false
      void syncVideoProgress()
    }
  }
}

/** Progress changes every few seconds while watching: share it a little after the last one. */
function syncSoon(): void {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void syncVideoProgress(), 3000)
}

/** A different notes folder: start from its shared file. */
export function loadVideoProgress(): void {
  synced = {}
  void syncVideoProgress()
}

// Coming back to the window (maybe after watching on the other computer): pick up where you got to.
if (typeof window !== 'undefined') window.addEventListener('focus', () => void syncVideoProgress())
