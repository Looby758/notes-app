import { create } from 'zustand'
import { nextRepeat, type MusicAction, type MusicState, type MusicStatus } from '@shared/spotify'
import { errorMessage } from '../lib/paths'
import { useUI } from './ui'
import { songMarkdown, type SongTarget } from '@shared/songLinks'
import { insertBlockIntoActiveNote } from '../lib/editorController'
import { notify } from './notify'
import { playLocalPath, localNext, localPause, localPrevious, localRepeat, localSeek, localShuffle, localToggle, localVolume, stopLocal } from './localMusic'

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
  /** Your own music files are playing (store/localMusic.ts), not Spotify. */
  local: boolean
  /** The floating mini player is showing (it's sent what's playing). */
  miniOpen: boolean
  /** The sleep timer: pause at a time, or when this song ends. */
  sleep: { until: number } | { song: string } | null
}

const OPEN_KEY = 'musicOpen'
const wasOpen = ((): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
})()

export const useMusic = create<MusicStore>(() => ({ open: wasOpen, state: null, at: 0, status: null, error: null, liked: null, sleep: null, local: false, miniOpen: false }))

export function setMusicOpen(open: boolean): void {
  useMusic.setState({ open, error: null })
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Only a convenience.
  }
  if (open) void refreshMusic()
}

/** Other places showing what's playing (the Home page's box), so it's kept up to date while the player is hidden. */
let watchers = 0

/** Keeps "now playing" fresh until the returned function is called. */
export function watchMusic(): () => void {
  watchers++
  void refreshMusic()
  return () => {
    watchers--
  }
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
  if (asking || useMusic.getState().local) return
  asking = true
  try {
    const state = await window.api.musicNowPlaying()
    // Your own music may have started while Spotify was being asked.
    if (useMusic.getState().local) return
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

/** Your own music's version of each button. */
const LOCAL_ACTIONS: Record<MusicAction, () => unknown> = {
  toggle: localToggle,
  pause: localPause,
  next: localNext,
  previous: localPrevious,
  shuffle: localShuffle,
  repeat: localRepeat
}

export function musicControl(action: MusicAction): Promise<boolean> {
  const { state, at, local } = useMusic.getState()
  if (local) {
    useMusic.setState({ error: null })
    return Promise.resolve(LOCAL_ACTIONS[action]()).then(
      () => true,
      (err) => {
        useMusic.setState({ error: errorMessage(err) })
        return false
      }
    )
  }
  // Show the change straight away.
  if (action === 'pause' && state?.track) {
    useMusic.setState({ state: { ...state, playing: false, positionMs: currentPosition(state, at) }, at: Date.now() })
  }
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
  const { state, local } = useMusic.getState()
  if (local) {
    localSeek(ms)
    return Promise.resolve(true)
  }
  if (state) useMusic.setState({ state: { ...state, positionMs: ms }, at: Date.now() })
  return run(() => window.api.musicSeek(ms))
}

/** Plays something on Spotify (stopping your own music if it's playing). */
export function musicPlay(uri: string, context?: string): Promise<boolean> {
  if (useMusic.getState().local) stopLocal()
  return run(() => window.api.musicPlay(uri, context))
}

export function musicSetVolume(percent: number): Promise<boolean> {
  const { state, local } = useMusic.getState()
  if (local) {
    localVolume(percent)
    return Promise.resolve(true)
  }
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

/** Pauses after `minutes`, or at the end of the song playing ('song'); null turns it off. */
export function setSleepTimer(when: number | 'song' | null): void {
  const uri = useMusic.getState().state?.track?.uri
  if (when === 'song') useMusic.setState({ sleep: uri ? { song: uri } : null })
  else useMusic.setState({ sleep: when ? { until: Date.now() + when * 60_000 } : null })
}

/** How long until the sleep timer pauses the music, in ms (null if it's off or waiting for the song to end). */
export function sleepLeft(now = Date.now()): number | null {
  const { sleep } = useMusic.getState()
  return sleep && 'until' in sleep ? Math.max(0, sleep.until - now) : null
}

function checkSleep(): void {
  const { sleep, state, at } = useMusic.getState()
  if (!sleep) return
  let due = false
  if ('until' in sleep) due = Date.now() >= sleep.until
  else if (state?.track) {
    // Pause just before the song ends so the next one doesn't start (or as soon as it has, if Spotify got there first).
    const left = (state.track.durationMs || Infinity) - currentPosition(state, at)
    due = state.track.uri !== sleep.song || (state.playing && left < 900)
  }
  if (!due) return
  useMusic.setState({ sleep: null })
  void musicControl('pause')
}

/** Keeps the player up to date: often while it (or the Home box) is showing and you're looking (or a sleep timer is waiting), otherwise not at all. */
export function startMusic(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const sleepTimer = setInterval(checkSleep, 400)
  const tick = async (): Promise<void> => {
    const { open, state, sleep, miniOpen } = useMusic.getState()
    if (((open || watchers > 0) && document.visibilityState === 'visible') || sleep || miniOpen) await refreshMusic()
    // The Mac app answers instantly; your account is asked a little less often.
    timer = setTimeout(tick, state?.source === 'account' ? 3000 : 1500)
  }
  void refreshMusicStatus().catch(() => undefined)
  void tick()
  const stopMini = startMini()
  return () => {
    clearTimeout(timer)
    clearInterval(sleepTimer)
    stopMini()
  }
}

// ---------- The floating mini player ----------

export const setMusicMini = (open: boolean): Promise<boolean> => window.api.setMusicMini(open)

/** Sends what's playing to the mini player (and a paired phone's remote), and does what their buttons ask. */
function startMini(): () => void {
  const push = (): void => {
    const { state, at } = useMusic.getState()
    window.api.pushMusicMini({ state, at })
  }
  const offOpen = window.api.onMusicMiniOpen((miniOpen) => {
    useMusic.setState({ miniOpen })
    if (miniOpen) void refreshMusic().then(push)
  })
  const offCommand = window.api.onMusicMiniCommand((command) => {
    if ('seek' in command) void musicSeek(command.seek)
    else void musicControl(command.action)
  })
  const offState = useMusic.subscribe((now, before) => {
    if (now.state !== before.state || now.at !== before.at || (now.miniOpen && !before.miniOpen)) push()
  })
  // It comes back if it was showing when Notes closed.
  void window.api.musicMiniWasOpen().then((was) => was && setMusicMini(true))
  return () => {
    offOpen()
    offCommand()
    offState()
  }
}

// ---------- Songs shared into notes ----------

/** Plays a song card's song, and shows the player. */
export async function playSongTarget(target: SongTarget): Promise<void> {
  setMusicOpen(true)
  if (target.kind === 'spotify') {
    await musicPlay(target.uri)
    return
  }
  try {
    await playLocalPath(target.path)
  } catch (err) {
    useMusic.setState({ error: errorMessage(err) })
  }
}

/** Puts a card for what's playing into the note you're writing; says why not if it can't. */
export function shareSongToNote(): void {
  const track = useMusic.getState().state?.track
  const md = track?.uri ? songMarkdown(track.name, track.artist, track.uri, track.art?.startsWith('https://') ? track.art : undefined) : null
  if (!md) {
    useMusic.setState({ error: 'Play a song first, then add it to a note.' })
    return
  }
  // A blank line after it, so the card shows straight away (the link shows while the cursor's on its line).
  if (!insertBlockIntoActiveNote(`${md}\n`)) useMusic.setState({ error: 'Open a note first, then press this to add the song to it.' })
  else notify(`Added “${track!.name}” to the note.`, 'info')
}
