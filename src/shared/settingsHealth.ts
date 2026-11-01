/**
 * Orbit keeps its settings in small JSON files in its settings folder. If one of them breaks (cut
 * short, edited by hand, or saved by an older copy of the app whose locked sign-ins this copy can't
 * open), Orbit offers to reset just that file instead of you having to find and rename it.
 */

export interface SettingsFileInfo {
  /** The file's name in Orbit's settings folder. */
  file: string
  /** How the reset button names it: "Reset {label}". */
  label: string
  /** Fields holding text locked with the computer's own protection (and anything inside them). */
  secrets?: readonly string[]
}

export const SETTINGS_FILES: readonly SettingsFileInfo[] = [
  { file: 'settings.json', label: 'Orbit settings' },
  { file: 'calendars.json', label: 'calendar settings', secrets: ['clientSecret', 'refreshToken', 'url'] },
  { file: 'calendar-cache.json', label: 'saved calendar events' },
  { file: 'ai.json', label: 'AI settings', secrets: ['apiKey'] },
  { file: 'ai-chats.json', label: 'AI chats' },
  { file: 'local-ai.json', label: 'offline AI settings' },
  { file: 'spotify.json', label: 'Spotify settings', secrets: ['refreshToken'] },
  { file: 'discord.json', label: 'Discord settings', secrets: ['secret', 'access', 'refresh'] },
  { file: 'discord-webhooks.json', label: 'Discord clip links', secrets: ['enc'] },
  { file: 'songid.json', label: '“What’s this song?” settings', secrets: ['key'] },
  { file: 'game-covers.json', label: 'game cover settings', secrets: ['apiKey'] },
  { file: 'games.json', label: 'games list' },
  { file: 'live.json', label: 'streaming settings', secrets: ['keys'] },
  { file: 'weather.json', label: 'weather settings' },
  { file: 'comics.json', label: 'comic shelf' },
  { file: 'local-music.json', label: 'music library settings' },
  { file: 'monitors.json', label: 'Screens settings' },
  { file: 'orbit-sync.json', label: 'sync settings' }
]

export type SettingsProblem = 'unreadable' | 'locked'

export interface BrokenSettingsFile {
  file: string
  label: string
  problem: SettingsProblem
  /** One plain sentence for the pop-up. */
  detail: string
}

/** Every locked value in the file's JSON: strings under a secret field, however deep. */
export function lockedValues(value: unknown, secrets: readonly string[], inside = false): string[] {
  if (typeof value === 'string') return inside && value ? [value] : []
  if (Array.isArray(value)) return value.flatMap((v) => lockedValues(v, secrets, inside))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => lockedValues(v, secrets, inside || secrets.includes(k)))
  }
  return []
}

/**
 * What's wrong with a settings file, if anything. `unlock` opens one locked value and throws if it
 * can't; leave it out when the computer's protection isn't available (nothing can be checked then).
 */
export function checkSettingsText(
  info: SettingsFileInfo,
  text: string,
  unlock?: (locked: string) => void
): BrokenSettingsFile | null {
  if (!text.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      file: info.file,
      label: info.label,
      problem: 'unreadable',
      detail: `Orbit couldn’t read your ${info.label} (${info.file} is damaged), so it’s using the defaults for now.`
    }
  }
  if (!unlock || !info.secrets?.length) return null
  for (const locked of lockedValues(parsed, info.secrets)) {
    try {
      unlock(locked)
    } catch {
      return {
        file: info.file,
        label: info.label,
        problem: 'locked',
        detail: `Your ${info.label} were saved by an older copy of the app, so this copy can’t open the sign-ins and keys in ${info.file}. Resetting lets you sign in again.`
      }
    }
  }
  return null
}

/** The name a reset file is kept under, so nothing is ever thrown away: calendars.json → calendars.broken-2026-11-01-1643.json. */
export function brokenCopyName(file: string, when: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  return file.replace(/\.json$/, '') + `.broken-${stamp}.json`
}
