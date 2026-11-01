import type { Prefs } from './prefs'

/**
 * Orbit synced everywhere: your settings, Home layout, themes, soundboard and calendar links are
 * kept in the notes folder (.notesapp/orbit/), so they follow it to your other computers through
 * Google Drive, like money, passwords, stars and flashcards already do.
 *
 * Each part is synced as a whole. Every computer remembers, for each part, what it had and what
 * the notes folder had when they last agreed. From that it knows which side changed since:
 * - only this computer: its version goes into the notes folder;
 * - only the other computer: its version is taken in here;
 * - both, differently: you're asked which version to keep.
 */

export type OrbitPart = 'themes' | 'settings' | 'home' | 'soundboard' | 'calendar'

/** In the order they're synced: themes first, so settings that pick an imported theme can find it. */
export const ORBIT_PARTS: { id: OrbitPart; label: string }[] = [
  { id: 'themes', label: 'Themes' },
  { id: 'settings', label: 'Settings' },
  { id: 'home', label: 'Home layout' },
  { id: 'soundboard', label: 'Soundboard' },
  { id: 'calendar', label: 'Calendar links' }
]

/** Settings that belong to one computer (its screen, its startup), so each keeps its own. */
export const DEVICE_PREFS: readonly (keyof Prefs)[] = ['zoom', 'launchAtStartup', 'closeToTray', 'syncOrbit']

/** The Home page's layout, synced (and asked about) separately from the rest of Settings. */
export const HOME_PREFS: readonly (keyof Prefs)[] = ['homeOnStart', 'homeOrder', 'homeHidden', 'worldClocks', 'weatherHome']

/** The synced part of preferences: "home" is the Home layout, "settings" everything else shared. */
export function prefsPart(prefs: Prefs, part: 'settings' | 'home'): Partial<Prefs> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(prefs)) {
    const k = key as keyof Prefs
    if (DEVICE_PREFS.includes(k)) continue
    if (HOME_PREFS.includes(k) === (part === 'home')) out[key] = value
  }
  return out as Partial<Prefs>
}

/** Only the keys that part may set: a synced file can't change this computer's own settings. */
export function cleanPrefsPart(raw: unknown, part: 'settings' | 'home'): Partial<Prefs> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key as keyof Prefs
    if (DEVICE_PREFS.includes(k)) continue
    if (HOME_PREFS.includes(k) === (part === 'home')) out[key] = value
  }
  return out as Partial<Prefs>
}

/** JSON with object keys in order, so the same value always gives the same text (and hash). */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const keys = Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`
}

/**
 * What this computer and the notes folder had when they last agreed on a part (hashes; null means
 * the part was empty). Missing: they've never synced this part.
 */
export interface Agreed {
  local: string | null
  remote: string | null
}

export type SyncStep = 'same' | 'push' | 'pull' | 'ask'

/**
 * What to do with one part. `local` is this computer's hash (null: nothing here); `remote` the
 * notes folder's (null: deleted there; undefined: no file yet).
 */
export function decideSync(local: string | null, remote: string | null | undefined, agreed: Agreed | undefined): SyncStep {
  // Nothing in the notes folder yet: put this computer's version there.
  if (remote === undefined) return local === null ? 'same' : 'push'
  if (local === remote) return 'same'
  if (agreed) {
    const here = local !== agreed.local
    const there = remote !== agreed.remote
    if (!here && !there) return 'same'
    if (here && !there) return 'push'
    if (!here && there) return 'pull'
    return 'ask'
  }
  // First time on this computer: if one side is empty, take the other; else ask.
  if (local === null) return 'pull'
  if (remote === null) return 'push'
  return 'ask'
}

/** A part as it's kept in the notes folder (.notesapp/orbit/<part>.json). */
export interface OrbitManifest {
  version: 1
  /** Hash of the value or of the files; null when the part was emptied (e.g. every theme removed). */
  hash: string | null
  /** The computer that last changed it, and when (for the "which version?" question). */
  device: string
  updated: number
  /** Value parts (settings, Home, calendar). */
  value?: unknown
  /** Folder parts (themes, soundboard): each file's path and the hash of its contents (in .notesapp/orbit/files/). */
  files?: Record<string, string>
}

const HASH = /^[a-f0-9]{64}$/

/** A file path inside a synced folder: forward slashes, no "..", nothing hidden or odd. */
export function cleanSyncPath(path: string): string | null {
  if (typeof path !== 'string' || path.length > 240) return null
  const parts = path.split('/')
  if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || /[\\:*?"<>|\u0000-\u001f]/.test(p))) return null
  return parts.join('/')
}

/** Reads a manifest from the notes folder, or null if it's broken (half-synced). */
export function readManifest(raw: unknown): OrbitManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.version !== 1) return null
  if (!(m.hash === null || (typeof m.hash === 'string' && HASH.test(m.hash)))) return null
  if (typeof m.updated !== 'number' || !Number.isFinite(m.updated)) return null
  const out: OrbitManifest = { version: 1, hash: m.hash as string | null, device: typeof m.device === 'string' ? m.device.slice(0, 80) : 'another computer', updated: m.updated }
  if ('value' in m) out.value = m.value
  if (m.files !== undefined) {
    if (!m.files || typeof m.files !== 'object') return null
    const files: Record<string, string> = {}
    for (const [path, hash] of Object.entries(m.files as Record<string, unknown>)) {
      const clean = cleanSyncPath(path)
      if (!clean || typeof hash !== 'string' || !HASH.test(hash)) return null
      files[clean] = hash
    }
    out.files = files
  }
  return out
}

/** The text a folder's hash is made from: each file's path and contents hash, in order. */
export function folderHashText(files: Record<string, string>): string {
  return stableJson(
    Object.keys(files)
      .sort()
      .map((p) => [p, files[p]])
  )
}
