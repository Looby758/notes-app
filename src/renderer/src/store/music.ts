import { create } from 'zustand'
import { nextRepeat, type MusicAction, type MusicState, type MusicStatus } from '@shared/spotify'
import { errorMessage } from '../lib/paths'
import { useUI } from './ui'

/** The music player in the corner: what's playing (asked for every couple of seconds while it's open). */

interface MusicStore {
  open: boolean
  state: MusicState | null
  /** When `state` arrived, so the progress bar can move between updates. */
  at: number
  status: MusicStatus | null
  /** The last button press that didn't work. */
  error: string | null
  /** Whether the song playing is in your Liked Songs (only known with your account connected). */
  liked: { uri: string; liked: boolean } | null
}

const OPEN_KEY = 'musicOpen'
const wasOpen = ((): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
})()

export const useMusic = create<MusicStore>(() => ({ open: wasOpen, state: null, at: 0, status: null, error: null, liked: null }))

export function setMusicOpen(open: boolean): void {
  useMusic.setState({ open, error: null })
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Only a convenience.
  }
  if (open) void refreshMusic()
}

export const toggleMusic = (): void => setMusicOpen(!useMusic.getState().open)

export const openMusicSettings = (): void => useUI.setState({ settingsSection: 'music' })

export async function refreshMusicStatus(): Promise<MusicStatus> {
  const status = await window.api.musicStatus()
  useMusic.setState({ status })
  return status
}

let asking = false
export async function refreshMusic(): Promise<void> {
  if (asking) return
  asking = true
  try {
    const state = await window.api.musicNowPlaying()
    useMusic.setState({ state, at: Date.now() })
    void checkLiked(state.track?.uri)
  } catch (err) {
    useMusic.setState({ state: { source: 'none', playing: false, positionMs: 0, error: errorMessage(err) }, at: Date.now() })
  } finally {
    asking = false
  }
}

/** Asks once per song whether it's liked. */
async function checkLiked(uri: string | undefined): Promise<void> {
  const { liked, status } = useMusic.getState()
  if (!uri || liked?.uri === uri || !status?.connected) return
  useMusic.setState({ liked: { uri, liked: false } })
  try {
    const yes = await window.api.musicIsLiked(uri)
    if (useMusic.getState().liked?.uri === uri) useMusic.setState({ liked: { uri, liked: yes } })
  } catch {
    // The heart just shows as not liked.
  }
}

/** Spotify takes a moment to catch up after a command, so look again shortly after. */
const refreshSoon = (): void => {
  setTimeout(() => void refreshMusic(), 350)
  setTimeout(() => void refreshMusic(), 1200)
}

async function run(job: () => Promise<void>): Promise<boolean> {
  useMusic.setState({ error: null })
  try {
    await job()
    return true
  } catch (err) {
    useMusic.setState({ error: errorMessage(err) })
    return false
  } finally {
    refreshSoon()
  }
}

export function musicControl(action: MusicAction): Promise<boolean> {
  const { state, at } = useMusic.getState()
  // Show the change straight away.
  if (action === 'toggle' && state?.track) {
    useMusic.setState({ state: { ...state, playing: !state.playing, positionMs: currentPosition(state, at) }, at: Date.now() })
  }
  if (action === 'repeat' && state) {
    // The Mac app only has on and off.
    const repeat = state.source === 'app' ? (state.repeat === 'off' ? 'context' : 'off') : nextRepeat(state.repeat)
    useMusic.setState({ state: { ...state, repeat } })
  }
  return run(() => window.api.musicControl(action))
}

export function musicSeek(ms: number): Promise<boolean> {
  const { state } = useMusic.getState()
  if (state) useMusic.setState({ state: { ...state, positionMs: ms }, at: Date.now() })
  return run(() => window.api.musicSeek(ms))
}

export const musicPlay = (uri: string, context?: string): Promise<boolean> => run(() => window.api.musicPlay(uri, context))

export function musicSetVolume(percent: number): Promise<boolean> {
  const { state } = useMusic.getState()
  if (state) useMusic.setState({ state: { ...state, volume: percent } })
  return run(() => window.api.musicSetVolume(percent))
}

/** Likes the song playing, or unlikes it. */
export async function musicToggleLike(): Promise<boolean> {
  const { state, liked } = useMusic.getState()
  const uri = state?.track?.uri
  if (!uri) return false
  const now = !(liked?.uri === uri && liked.liked)
  useMusic.setState({ liked: { uri, liked: now }, error: null })
  try {
    await window.api.musicSetLiked(uri, now)
    return true
  } catch (err) {
    useMusic.setState({ liked: { uri, liked: !now }, error: errorMessage(err) })
    return false
  }
}

export const musicAddToQueue = (uri: string): Promise<boolean> => run(() => window.api.musicAddToQueue(uri))

export const musicTransfer = (deviceId: string): Promise<boolean> => run(() => window.api.musicTransfer(deviceId))

/** Where the song is now, counting the time since Spotify last said. */
export function currentPosition(state: MusicState, at: number, now = Date.now()): number {
  const pos = state.playing ? state.positionMs + (now - at) : state.positionMs
  return Math.min(pos, state.track?.durationMs || pos)
}

/** Keeps the player up to date: often while it's open and you're looking, otherwise not at all. */
export function startMusic(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    const { open, state } = useMusic.getState()
    if (open && document.visibilityState === 'visible') await refreshMusic()
    // The Mac app answers instantly; your account is asked a little less often.
    timer = setTimeout(tick, state?.source === 'account' ? 3000 : 1500)
  }
  void refreshMusicStatus().catch(() => undefined)
  void tick()
  return () => clearTimeout(timer)
}
