import { create } from 'zustand'
import { MINIGAMES_TAB, openSpecialTab } from '../lib/editorController'

/** The games in the Mini games tab (components/MiniGames). */
export type MiniGameId = 'sudoku' | 'minesweeper' | 'nonogram' | 'jigsaw'

export const MINI_GAME_IDS: MiniGameId[] = ['sudoku', 'minesweeper', 'nonogram', 'jigsaw']

const isGame = (v: unknown): v is MiniGameId => typeof v === 'string' && (MINI_GAME_IDS as string[]).includes(v)

interface MiniGamesState {
  /** The game being played (null: the list of games). */
  playing: MiniGameId | null
}

// The game you were playing opens again next time.
const PLAYING_KEY = 'notesapp.minigames.playing'

function loadPlaying(): MiniGameId | null {
  try {
    const v = localStorage.getItem(PLAYING_KEY)
    return isGame(v) ? v : null
  } catch {
    return null
  }
}

export const useMiniGames = create<MiniGamesState>(() => ({ playing: loadPlaying() }))

/** Shows a game in the Mini games tab (null: back to the list). */
export function playMiniGame(id: MiniGameId | null): void {
  try {
    if (id) localStorage.setItem(PLAYING_KEY, id)
    else localStorage.removeItem(PLAYING_KEY)
  } catch {
    // Not remembered; it still opens.
  }
  useMiniGames.setState({ playing: id })
}

/** Opens the Mini games tab, on a game or on the list of games. */
export function openMiniGames(id?: MiniGameId | null): void {
  if (id !== undefined) playMiniGame(id)
  openSpecialTab(MINIGAMES_TAB)
}
