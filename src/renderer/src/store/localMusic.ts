import { create } from 'zustand'
import { localArtUrl, localSongUrl, type LocalLibrary, type LocalSong } from '@shared/localMusic'
import { nextRepeat, type MusicRepeat, type MusicState } from '@shared/spotify'
import { errorMessage } from '../lib/paths'
import { useMusic } from './music'

/**
 * Playing your own music files, in the app itself (an <audio> element). While one is loaded the player
 * shows it instead of Spotify: store/music.ts sends play/pause, skip and the rest here.
 */

interface LocalStore {
  library: LocalLibrary | null
  loading: boolean
  error: string | null
  /** What's playing, in order (shuffled when shuffle is on), and where we are in it. */
  queue: LocalSong[]
  index: number
  shuffle: boolean
  repeat: MusicRepeat
}

export const useLocalMusic = create<LocalStore>(() => ({ library: null, loading: false, error: null, queue: [], index: 0, shuffle: false, repeat: 'off' }))

const VOLUME_KEY = 'localMusicVolume'
let audio: HTMLAudioElement | null = null
/** The order you picked, kept so turning shuffle off goes back to it. */
let ordered: LocalSong[] = []

export async function loadLocalLibrary(fresh = false, choose = false): Promise<void> {
  useLocalMusic.setState({ loading: true, error: null })
  try {
    const library = choose ? await window.api.localMusicChooseFolder() : await window.api.localMusicLibrary(fresh)
    useLocalMusic.setState({ library })
  } catch (err) {
    useLocalMusic.setState({ error: errorMessage(err) })
  } finally {
    useLocalMusic.setState({ loading: false })
  }
}

export const localUri = (song: LocalSong): string => `local:${song.path}`

const current = (): LocalSong | undefined => {
  const { queue, index } = useLocalMusic.getState()
  return queue[index]
}

function player(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'auto'
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v)) audio.volume = Math.min(1, Math.max(0, v / 100))
  } catch {
    // Only a convenience.
  }
  for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'volumechange']) audio.addEventListener(event, publish)
  // Often enough for the progress bar to stay right after a seek; it moves smoothly in between on its own.
  audio.addEventListener('timeupdate', () => {
    const { state, at } = useMusic.getState()
    if (state?.source === 'local' && Math.abs(state.positionMs + (Date.now() - at) - audio!.currentTime * 1000) > 400) publish()
  })
  audio.addEventListener('ended', () => void songEnded())
  audio.addEventListener('error', () => {
    const song = current()
    if (song) useMusic.setState({ error: `Couldn’t play “${song.title}”. The file may have moved, or it’s in a format this computer can’t play.` })
  })
  return audio
}

/** Tells the player (and the system's media controls) what's playing now. */
function publish(): void {
  const song = current()
  if (!song || !audio || !useMusic.getState().local) return
  const { shuffle, repeat } = useLocalMusic.getState()
  const art = song.art ? localArtUrl(song.path) : undefined
  const state: MusicState = {
    source: 'local',
    playing: !audio.paused,
    track: {
      name: song.title,
      artist: song.artist,
      album: song.album,
      art,
      uri: localUri(song),
      durationMs: Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : song.durationMs
    },
    positionMs: Math.round(audio.currentTime * 1000),
    shuffle,
    repeat,
    volume: Math.round(audio.volume * 100)
  }
  useMusic.setState({ state, at: Date.now() })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: song.album, artwork: art ? [{ src: art }] : [] })
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'
  }
}

async function start(index: number): Promise<void> {
  const { queue } = useLocalMusic.getState()
  const song = queue[index]
  if (!song) return
  useLocalMusic.setState({ index })
  const a = player()
  a.src = localSongUrl(song.path)
  useMusic.setState({ local: true, error: null })
  publish()
  try {
    await a.play()
  } catch (err) {
    // A newer song was picked before this one started; that's fine.
    if ((err as Error).name !== 'AbortError') useMusic.setState({ error: errorMessage(err) })
  }
}

const shuffled = <T,>(list: T[]): T[] => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Plays `songs` from the one at `index` (or a random one, shuffling them, when `index` is 'shuffle'). */
export async function playLocal(songs: LocalSong[], index: number | 'shuffle'): Promise<void> {
  if (!songs.length) return
  ordered = songs
  // Spotify stops so the two don't play over each other.
  const spotify = useMusic.getState()
  if (!spotify.local && spotify.state?.playing) void window.api.musicControl('pause').catch(() => undefined)
  if (index === 'shuffle') {
    useLocalMusic.setState({ shuffle: true, queue: shuffled(songs) })
    return start(0)
  }
  const { shuffle } = useLocalMusic.getState()
  if (shuffle) {
    const first = songs[index]
    useLocalMusic.setState({ queue: [first, ...shuffled(songs.filter((_, i) => i !== index))] })
    return start(0)
  }
  useLocalMusic.setState({ queue: songs })
  return start(index)
}

async function songEnded(): Promise<void> {
  const { repeat, index, queue } = useLocalMusic.getState()
  if (repeat === 'track') {
    player().currentTime = 0
    await player().play()
  } else if (index + 1 < queue.length) await start(index + 1)
  else if (repeat === 'context') await start(0)
  else publish()
}

export function localToggle(): void {
  const a = player()
  if (a.paused) void a.play().catch((err) => useMusic.setState({ error: errorMessage(err) }))
  else a.pause()
}

export const localPause = (): void => audio?.pause()

export async function localNext(): Promise<void> {
  const { index, queue } = useLocalMusic.getState()
  await start(index + 1 < queue.length ? index + 1 : 0)
}

/** Back to the start of the song, or to the one before if it's only just begun. */
export async function localPrevious(): Promise<void> {
  const a = player()
  const { index, queue } = useLocalMusic.getState()
  if (a.currentTime > 3 || index === 0) {
    a.currentTime = 0
    publish()
  } else await start(Math.max(0, Math.min(queue.length - 1, index - 1)))
}

export function localSeek(ms: number): void {
  player().currentTime = Math.max(0, ms / 1000)
}

export function localVolume(percent: number): void {
  player().volume = Math.min(1, Math.max(0, percent / 100))
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.round(percent)))
  } catch {
    // Only a convenience.
  }
}

export function localShuffle(): void {
  const { shuffle, queue, index } = useLocalMusic.getState()
  const song = queue[index]
  if (!shuffle) {
    // Keep the song playing, then the rest in a random order.
    useLocalMusic.setState({ shuffle: true, queue: song ? [song, ...shuffled(queue.filter((_, i) => i !== index))] : shuffled(queue), index: 0 })
  } else {
    const back = song ? ordered.indexOf(song) : 0
    useLocalMusic.setState({ shuffle: false, queue: ordered, index: Math.max(0, back) })
  }
  publish()
}

export function localRepeat(): void {
  useLocalMusic.setState({ repeat: nextRepeat(useLocalMusic.getState().repeat) })
  publish()
}

/** Skips to a song further along the queue. */
export const localJump = (index: number): Promise<void> => start(index)

/** What plays after this song. */
export function localUpNext(): LocalSong[] {
  const { queue, index } = useLocalMusic.getState()
  return queue.slice(index + 1)
}

/** Stops your own music and hands the player back to Spotify. */
export function stopLocal(): void {
  audio?.pause()
  useMusic.setState({ local: false })
}

// The keyboard's play/pause and skip keys (and the system's media controls).
if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', localToggle],
    ['pause', localPause],
    ['nexttrack', () => void localNext()],
    ['previoustrack', () => void localPrevious()]
  ]
  for (const [action, run] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, () => useMusic.getState().local && run())
    } catch {
      // Not every action is supported everywhere.
    }
  }
}
