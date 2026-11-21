/**
 * Music dipping: while a friend talks in your Discord call, Spotify and Orbit's own music are
 * turned down, and a moment after everyone stops they come back up. Who's talking comes from
 * Discord's own "speaking" events (the same green rings Orbit's voice page shows). main/musicDuck.ts
 * runs it; these are the plain rules, so they can be tested.
 */

import type { DiscordStatus } from './discord'

/** How long after the last person stops talking the music comes back (so it doesn't pump between words). */
export const DUCK_HOLD_MS = 1200
/** How long the music takes to go down, and to come back up. */
export const DUCK_DOWN_MS = 250
export const DUCK_UP_MS = 900

/**
 * Whether someone other than you is talking in your call. Bots are left out (a music bot isn't
 * someone talking), so are people you've muted for yourself, and nothing dips while you're deafened.
 */
export function friendsTalking(status: Pick<DiscordStatus, 'me' | 'channel' | 'deaf'>): boolean {
  if (!status.channel || status.deaf) return false
  return status.channel.members.some((m) => m.speaking && !m.bot && m.id !== status.me?.id && !m.localMute)
}

/** Spotify's slider in the volume mixer: "Spotify" on Windows, mac:spotify on a Mac. */
export function spotifyId(apps: { id: string; name: string }[]): string | null {
  return apps.find((a) => a.id === 'mac:spotify')?.id ?? apps.find((a) => /^win:spotify(\.exe)?$/i.test(a.id) || /^spotify$/i.test(a.name))?.id ?? null
}

/** The volumes to step through for a fade from one volume (0–100) to another, `steps` of them, ending on `to`. */
export function fadeSteps(from: number, to: number, steps: number): number[] {
  const n = Math.max(1, Math.round(steps))
  return Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * (i + 1)) / n))
}

/** Spotify's dipped volume: its own volume times the level, never 0 (so it doesn't look muted). */
export const duckedVolume = (volume: number, level: number): number => Math.max(1, Math.round(volume * Math.min(1, Math.max(0, level))))

/**
 * Whether to put Spotify back when the talking stops. If you moved its slider yourself while it
 * was dipped (it isn't where Orbit left it), your new volume is kept.
 */
export const shouldRestore = (now: number, setTo: number): boolean => Math.abs(now - setTo) <= 2
