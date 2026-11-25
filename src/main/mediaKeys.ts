import { globalShortcut, systemPreferences } from 'electron'
import { holdMediaKeys, MEDIA_KEY_REPEAT_MS, MEDIA_KEYS, MEDIA_KEYS_HOLD_MS, playingOwnMusic } from '@shared/mediaKeys'
import type { MusicAction } from '@shared/spotify'
import type { MusicMiniState } from '@shared/types'
import { IS_MAC } from '@shared/platform'
import { lastMusic, musicCommand, onMusic } from './musicMini'

/**
 * The keyboard's play/pause, next and previous keys for your own music, even when Orbit isn't the
 * app in front. The notes window also tells the system what's playing (navigator.mediaSession in
 * store/localMusic.ts), which covers the Mac's Now Playing and Windows' media overlay; these
 * system-wide keys make sure the keys themselves reach Orbit, whichever app is in front.
 *
 * They're only held while your own music is playing (or was, a few minutes ago), so Spotify, a
 * browser and other players get them back the rest of the time. On a Mac, catching them needs
 * Accessibility (the same permission macros and the key remapper use); without it the Now Playing
 * route above still works.
 */

/** The keys Orbit has registered now (another app or an Orbit hotkey may already have some). */
const held = new Set<string>()
let lastPlayed = 0
let releaseTimer: ReturnType<typeof setTimeout> | undefined
let lastPress = { action: '' as MusicAction | '', at: 0 }

function press(action: MusicAction): void {
  const now = Date.now()
  if (lastPress.action === action && now - lastPress.at < MEDIA_KEY_REPEAT_MS) return
  lastPress = { action, at: now }
  musicCommand({ action })
}

function hold(): void {
  if (held.size) return
  // Without Accessibility a Mac refuses media keys here; the system's Now Playing controls still reach the player.
  if (IS_MAC && !systemPreferences.isTrustedAccessibilityClient(false)) return
  for (const { accelerator, action } of MEDIA_KEYS) {
    try {
      if (globalShortcut.isRegistered(accelerator)) continue
      if (globalShortcut.register(accelerator, () => press(action))) held.add(accelerator)
    } catch {
      // Not every system has every key.
    }
  }
}

function release(): void {
  for (const accelerator of held) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      // Already gone.
    }
  }
  held.clear()
}

function update(music: MusicMiniState | null): void {
  const state = music?.state
  const now = Date.now()
  if (playingOwnMusic(state)) lastPlayed = now
  clearTimeout(releaseTimer)
  releaseTimer = undefined
  if (!holdMediaKeys(state, lastPlayed, now)) {
    release()
    return
  }
  hold()
  // Paused: let the keys go once the pause has lasted a while.
  if (!state?.playing) releaseTimer = setTimeout(() => update(lastMusic()), Math.max(1000, lastPlayed + MEDIA_KEYS_HOLD_MS - now + 100))
}

export function setupMediaKeys(): void {
  onMusic(update)
}

export function teardownMediaKeys(): void {
  clearTimeout(releaseTimer)
  release()
}
