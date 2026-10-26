import { app } from 'electron'
import { existsSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'fs'
import { join } from 'path'
import type { Settings } from '@shared/types'

const defaults: Settings = { vaultPath: null }

export function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: Settings | null = null
/** The last JSON we wrote, so our own saves aren't mistaken for hand edits. */
let lastWritten = ''

// Before the app was named "Notes", settings lived under %APPDATA%\notesapp.
function legacySettingsFile(): string {
  return join(app.getPath('appData'), 'notesapp', 'settings.json')
}

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const file = existsSync(settingsFile()) ? settingsFile() : legacySettingsFile()
    cache = existsSync(file) ? { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) } : { ...defaults }
  } catch {
    cache = { ...defaults }
  }
  return cache!
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...loadSettings(), ...patch }
  // Write to a temp file then rename, so a crash mid-write never corrupts settings.
  const file = settingsFile()
  const tmp = `${file}.tmp`
  lastWritten = JSON.stringify(cache, null, 2)
  writeFileSync(tmp, lastWritten, 'utf8')
  renameSync(tmp, file)
  return cache
}

/** Calls `onChange` when settings.json is edited by hand (or by another copy of the app). */
export function watchSettingsFile(onChange: (settings: Settings) => void): () => void {
  const file = settingsFile()
  const listener = (): void => {
    try {
      const text = readFileSync(file, 'utf8')
      if (text === lastWritten) return
      const parsed = JSON.parse(text)
      lastWritten = text
      cache = { ...defaults, ...parsed }
      onChange(cache!)
    } catch {
      // Half-written or invalid JSON: ignore until it's valid again.
    }
  }
  watchFile(file, { interval: 1000 }, listener)
  return () => unwatchFile(file, listener)
}
