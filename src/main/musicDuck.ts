import { app, BrowserWindow } from 'electron'
import type { Prefs } from '@shared/prefs'
import type { DiscordStatus } from '@shared/discord'
import { DUCK_DOWN_MS, DUCK_HOLD_MS, DUCK_UP_MS, duckedVolume, fadeSteps, friendsTalking, shouldRestore, spotifyId } from '@shared/musicDuck'
import { discordStatus, onDiscordStatus } from './discord'
import { mixerSet, mixerState } from './mixer'
import { logError } from './log'

/**
 * Music dipping (shared/musicDuck.ts): while a friend (or you, if that's on) talks in your Discord
 * call, your music goes down, and back up a moment after they stop.
 *
 * - Orbit's own music: the window turns its player down smoothly (store/localMusic.ts), told by
 *   'music:duck' with the level (1 = normal).
 * - Spotify: through the volume mixer. On Windows that's Spotify's own slider in Windows' volume
 *   mixer; on a Mac it's Spotify's volume (macOS has no per-app volume). Its volume before the dip
 *   is remembered and put back, unless you moved it yourself in the meantime.
 */

let getPrefs: () => Prefs
let ducked = false
let releaseTimer: ReturnType<typeof setTimeout> | null = null
/** Spotify's slider and its volume before the dip, and what Orbit set it to. */
let spotify: { id: string; before: number; setTo: number } | null = null
/** Bumped by each dip or rise, so an older fade still running stops. */
let generation = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function tellWindows(level: number): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('music:duck', level)
}

async function fadeSpotify(id: string, from: number, to: number, ms: number, gen: number): Promise<void> {
  const steps = fadeSteps(from, to, Math.max(1, Math.round(ms / 70)))
  for (const v of steps) {
    if (gen !== generation) return
    await mixerSet(id, v, null)
    await sleep(ms / steps.length)
  }
}

async function dip(): Promise<void> {
  const prefs = getPrefs()
  ducked = true
  const gen = ++generation
  if (prefs.duckOrbit) tellWindows(prefs.duckLevel)
  if (!prefs.duckSpotify) return
  try {
    // Already down (they started again while it was coming back up): stay where it was.
    const apps = (await mixerState()).apps
    const id = spotifyId(apps)
    const app = id ? apps.find((a) => a.id === id) : null
    if (!id || !app || app.muted || app.volume <= 1 || gen !== generation) return
    const before = spotify && spotify.id === id ? spotify.before : app.volume
    const setTo = duckedVolume(before, prefs.duckLevel)
    spotify = { id, before, setTo }
    await fadeSpotify(id, app.volume, setTo, DUCK_DOWN_MS, gen)
  } catch (err) {
    logError('music dipping', err)
  }
}

async function rise(): Promise<void> {
  ducked = false
  const gen = ++generation
  tellWindows(1)
  const s = spotify
  if (!s) return
  try {
    const app = (await mixerState()).apps.find((a) => a.id === s.id)
    if (gen !== generation) return
    // You moved Spotify's slider while it was dipped: keep what you chose.
    if (!app || app.muted || !shouldRestore(app.volume, s.setTo)) {
      spotify = null
      return
    }
    await fadeSpotify(s.id, app.volume, s.before, DUCK_UP_MS, gen)
    // (Kept until it's all the way back, so talking again mid-fade dips from the right volume.)
    if (gen === generation) spotify = null
  } catch (err) {
    logError('music dipping', err)
  }
}

function clearRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
}

/** Discord changed (someone started or stopped talking, you joined or left). */
function onStatus(status: DiscordStatus): void {
  const on = getPrefs().duckMusic && (getPrefs().duckSpotify || getPrefs().duckOrbit)
  const talking = on && friendsTalking(status, getPrefs().duckWhenITalk)
  if (talking) {
    clearRelease()
    if (!ducked) void dip()
  } else if (ducked && !releaseTimer) {
    // Left the call or turned off: straight back up. Otherwise after a short pause, so it doesn't pump between words.
    if (!on || !status.channel) void rise()
    else releaseTimer = setTimeout(() => {
      releaseTimer = null
      void rise()
    }, DUCK_HOLD_MS)
  }
}

/** Settings changed: turning it off while dipped brings the music back now; a new level applies to the next dip. */
export function applyDuckPrefs(): void {
  if (!getPrefs) return
  const p = getPrefs()
  if (ducked && (!p.duckMusic || (!p.duckOrbit && !p.duckSpotify))) {
    clearRelease()
    void rise()
  } else if (ducked && p.duckOrbit) tellWindows(p.duckLevel)
  else if (ducked && !p.duckOrbit) tellWindows(1)
}

export function setupMusicDuck(prefs: () => Prefs): void {
  getPrefs = prefs
  onDiscordStatus(onStatus)
  onStatus(discordStatus())
  // Never leave Spotify quiet when Orbit closes mid-dip.
  app.on('will-quit', () => {
    const s = spotify
    clearRelease()
    if (s && ducked) void mixerSet(s.id, s.before, null)
  })
}
