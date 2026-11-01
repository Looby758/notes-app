import { create } from 'zustand'
import { isFinished } from '@shared/videoPlayer'
import { openSpecialTab, VIDEO_TAB } from '../lib/editorController'
import { notify } from './notify'

/**
 * The video player's state: the video that's open, and every video you've watched (where you
 * stopped, the sound track, subtitles and speed you picked), so each one carries on where you left
 * it. Kept on this computer only (like Sudoku), not in the notes folder.
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

export const watchedOf = (path: string): Watched | undefined => useVideoPlayer.getState().history.find((h) => h.path === path)

/** Remembers something about a video (where you are, its tracks…), moving it to the top of the list. */
export function remember(path: string, patch: Partial<Omit<Watched, 'path'>>): void {
  useVideoPlayer.setState((s) => {
    const old = s.history.find((h) => h.path === path)
    const next: Watched = { path, name: nameOf(path), at: 0, duration: null, ...old, ...patch, watched: Date.now() }
    if (patch.at !== undefined && isFinished(patch.at, next.duration)) next.at = 0
    return { history: [next, ...s.history.filter((h) => h.path !== path)].slice(0, MAX_HISTORY) }
  })
}

export const forgetVideo = (path: string): void => useVideoPlayer.setState((s) => ({ history: s.history.filter((h) => h.path !== path) }))
