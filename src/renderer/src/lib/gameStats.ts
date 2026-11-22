/**
 * Win streaks and best times for the mini games. Each game (and each way of playing it, like
 * Solitaire's draw 1 or draw 3) keeps its own record on this computer only: it's just for fun.
 */

export interface GameRecord {
  played: number
  won: number
  /** Wins in a row, up to the last game. */
  streak: number
  bestStreak: number
  /** Fastest win, in seconds. */
  bestTime?: number
}

export const EMPTY_RECORD: GameRecord = { played: 0, won: 0, streak: 0, bestStreak: 0 }

/** The record after one more game: a loss (or a game you gave up on) ends the streak. */
export function recordGame(rec: GameRecord | undefined, won: boolean, seconds?: number): GameRecord {
  const r = rec ?? EMPTY_RECORD
  if (!won) return { ...r, played: r.played + 1, streak: 0 }
  const streak = r.streak + 1
  const faster = seconds !== undefined && (r.bestTime === undefined || seconds < r.bestTime)
  return {
    played: r.played + 1,
    won: r.won + 1,
    streak,
    bestStreak: Math.max(r.bestStreak, streak),
    bestTime: faster ? seconds : r.bestTime
  }
}

export const winPercent = (r: GameRecord | undefined): number => (r?.played ? Math.round((r.won / r.played) * 100) : 0)

const KEY = 'notesapp.minigames.stats'

export function loadRecords(): Record<string, GameRecord> {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Adds one game to the record called `id` (like "solitaire:1") and returns the new record. */
export function saveGame(id: string, won: boolean, seconds?: number): GameRecord {
  const all = loadRecords()
  const rec = recordGame(all[id], won, seconds)
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all, [id]: rec }))
  } catch {
    // Storage full or blocked: the game still works, the stats just aren't kept.
  }
  return rec
}
