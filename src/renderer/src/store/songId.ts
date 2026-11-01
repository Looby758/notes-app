import { create } from 'zustand'
import { addToHistory, cleanHistory, encodeWav, LISTEN_SECONDS, CLIP_RATE, peak, SILENCE, songLine, type FoundSong } from '@shared/songId'
import { desktopListenSupported, listen, type ListenSource } from '../lib/songListen'
import { errorMessage } from '../lib/paths'
import { setMusicOpen } from './music'

/** "What's this song?": listening, the answer, and the songs found before (kept on this computer). */

type Phase = 'idle' | 'listening' | 'thinking' | 'found' | 'nothing' | 'error'

interface SongIdStore {
  phase: Phase
  /** When listening started (for the countdown). */
  startedAt: number
  level: number
  song: FoundSong | null
  error: string | null
  history: FoundSong[]
  source: ListenSource
  /** Bumped to ask the music player to show this tab. */
  showAsk: number
}

const HISTORY_KEY = 'orbit.songFinds'
const SOURCE_KEY = 'orbit.songFindSource'

function savedHistory(): FoundSong[] {
  try {
    return cleanHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function savedSource(): ListenSource {
  if (!desktopListenSupported) return 'mic'
  try {
    return localStorage.getItem(SOURCE_KEY) === 'mic' ? 'mic' : 'desktop'
  } catch {
    return 'desktop'
  }
}

export const useSongId = create<SongIdStore>(() => ({
  phase: 'idle',
  startedAt: 0,
  level: 0,
  song: null,
  error: null,
  history: savedHistory(),
  source: savedSource(),
  showAsk: 0
}))

export function setListenSource(source: ListenSource): void {
  const s = desktopListenSupported ? source : 'mic'
  useSongId.setState({ source: s })
  try {
    localStorage.setItem(SOURCE_KEY, s)
  } catch {
    // Only a convenience.
  }
}

function saveHistory(history: FoundSong[]): void {
  useSongId.setState({ history })
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // The list just isn't remembered.
  }
}

export const forgetFoundSong = (song: FoundSong): void => saveHistory(useSongId.getState().history.filter((s) => s !== song))

let stopper: AbortController | null = null

/** Stops listening (nothing is sent). */
export function stopListening(): void {
  stopper?.abort()
}

/** When you're in another app (a game), the answer comes as a system notification too. */
function tellOutside(title: string, body: string): void {
  if (document.hasFocus()) return
  try {
    const n = new Notification(title, { body, silent: true })
    n.onclick = () => window.focus()
  } catch {
    // The answer is still in the music player.
  }
}

/** Listens for a few seconds, then asks AudD what song it is. Pressing it again while listening stops. */
export async function findSong(): Promise<void> {
  const { phase, source } = useSongId.getState()
  if (phase === 'listening') return stopListening()
  if (phase === 'thinking') return
  stopper = new AbortController()
  useSongId.setState({ phase: 'listening', startedAt: Date.now(), level: 0, error: null, song: null })
  try {
    const samples = await listen(source, LISTEN_SECONDS, { signal: stopper.signal, level: (level) => useSongId.setState({ level }) })
    if (peak(samples) < SILENCE) {
      const error =
        source === 'mic'
          ? 'Orbit couldn’t hear anything through the microphone. Turn the music up, or hold the mic closer.'
          : 'Nothing was playing on this computer. Play the video or game sound, then try again.'
      useSongId.setState({ phase: 'error', error })
      tellOutside('What’s this song?', error)
      return
    }
    useSongId.setState({ phase: 'thinking', level: 0 })
    const song = await window.api.songIdIdentify(encodeWav(samples, CLIP_RATE))
    if (!song) {
      useSongId.setState({ phase: 'nothing' })
      tellOutside('What’s this song?', 'Couldn’t tell what song that was. Try again during a louder part, without talking over it.')
      return
    }
    useSongId.setState({ phase: 'found', song })
    saveHistory(addToHistory(useSongId.getState().history, song))
    tellOutside('Found it 🎵', `${songLine(song)}. Open Orbit's music player to add it to a playlist.`)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      useSongId.setState({ phase: 'idle', level: 0 })
      return
    }
    const error = errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    useSongId.setState({ phase: 'error', error, level: 0 })
    tellOutside('What’s this song?', error)
  } finally {
    stopper = null
  }
}

/** Shows the music player on "What's this song?" and starts listening (Ctrl+K and the shortcut). */
export function showAndFindSong(): void {
  setMusicOpen(true)
  useSongId.setState((s) => ({ showAsk: s.showAsk + 1 }))
  void findSong()
}

/** The system-wide shortcut (works while you're in a game): listen without bringing Orbit forward. */
export function watchSongIdShortcut(): () => void {
  return window.api.onSongIdListen(showAndFindSong)
}
