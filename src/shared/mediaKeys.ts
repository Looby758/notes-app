import type { MusicAction, MusicState } from './spotify'

/**
 * The keyboard's media keys (play/pause, next, previous) for Orbit's music player.
 *
 * Orbit only takes the keys over while your own music is playing in it, or was a little while ago
 * (so pressing play again after a pause still works). The rest of the time they're left for Spotify,
 * a browser or whatever else is playing, so Orbit being open never steals them.
 */

/** How long after the music stops Orbit keeps the keys. */
export const MEDIA_KEYS_HOLD_MS = 10 * 60 * 1000

/** The keys, as Electron names them, and what each does in the player. */
export const MEDIA_KEYS: readonly { accelerator: string; action: MusicAction }[] = [
  { accelerator: 'MediaPlayPause', action: 'toggle' },
  { accelerator: 'MediaNextTrack', action: 'next' },
  { accelerator: 'MediaPreviousTrack', action: 'previous' },
  { accelerator: 'MediaStop', action: 'pause' }
]

/** Whether the music player is playing your own music right now. */
export const playingOwnMusic = (state: MusicState | null | undefined): boolean => state?.source === 'local' && !!state.track && state.playing

/**
 * Whether Orbit should have the media keys. `lastPlayed` is when your own music was last seen
 * playing (0 for never: a song loaded paused when Orbit opens doesn't count until you play it).
 */
export function holdMediaKeys(state: MusicState | null | undefined, lastPlayed: number, now: number): boolean {
  if (state?.source !== 'local' || !state.track) return false
  if (state.playing) return true
  return lastPlayed > 0 && now - lastPlayed < MEDIA_KEYS_HOLD_MS
}

/** Some systems report one press twice (the key itself and the system's media controls); this many ms apart counts as one. */
export const MEDIA_KEY_REPEAT_MS = 250
