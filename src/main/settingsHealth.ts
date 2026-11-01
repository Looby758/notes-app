import { app, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { brokenCopyName, checkSettingsText, SETTINGS_FILES, type BrokenSettingsFile } from '@shared/settingsHealth'
import { notesSince, type ReleaseNotes } from '@shared/whatsNew'
import { settingsFile } from './settings'

/**
 * Two things Orbit checks when it opens:
 * - settings files that are damaged or locked to an older copy of the app, each with its own reset;
 * - whether this computer has seen what's new in this version yet.
 */

const dir = (): string => app.getPath('userData')

/** Parts that can forget what they loaded without Orbit restarting. Anything else restarts Orbit after a reset. */
const resetHooks = new Map<string, () => void>()
export function onSettingsReset(file: string, reset: () => void): void {
  resetHooks.set(file, reset)
}

export function checkSettingsFiles(): BrokenSettingsFile[] {
  const canUnlock = safeStorage.isEncryptionAvailable()
  const unlock = (text: string): void => {
    safeStorage.decryptString(Buffer.from(text, 'base64'))
  }
  const broken: BrokenSettingsFile[] = []
  for (const info of SETTINGS_FILES) {
    const path = join(dir(), info.file)
    if (!existsSync(path)) continue
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const problem = checkSettingsText(info, text, canUnlock ? unlock : undefined)
    if (problem) broken.push(problem)
  }
  return broken
}

/** Moves the file aside (kept as a .broken copy) so that part starts fresh. Returns whether Orbit restarts. */
export function resetSettingsFile(file: string): { restarting: boolean } {
  const info = SETTINGS_FILES.find((f) => f.file === file)
  if (!info) throw new Error('That isn’t one of Orbit’s settings files.')
  const path = join(dir(), info.file)
  if (existsSync(path)) renameSync(path, join(dir(), brokenCopyName(info.file, new Date())))
  const hook = resetHooks.get(info.file)
  if (hook) {
    hook()
    return { restarting: false }
  }
  // Everything else remembers what it loaded, so start again with a clean slate.
  setTimeout(() => {
    app.relaunch()
    app.quit()
  }, 300)
  return { restarting: true }
}

// ---------- what's new ----------

interface Seen {
  /** The newest version this computer has shown "What's new" for. Kept per computer, never synced. */
  version: string
}
const seenFile = (): string => join(dir(), 'whats-new.json')

function readSeen(): string | null {
  try {
    const v = (JSON.parse(readFileSync(seenFile(), 'utf8')) as Seen).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

function writeSeen(version: string): void {
  try {
    writeFileSync(seenFile(), JSON.stringify({ version } satisfies Seen, null, 2), 'utf8')
  } catch {
    // Not worth failing over: the pop-up would just show again next time.
  }
}

/** The notes to show now, if Orbit was updated since this computer last opened it. */
export function pendingWhatsNew(): ReleaseNotes[] {
  const current = app.getVersion()
  let seen = readSeen()
  if (!seen) {
    // A fresh install has nothing to catch up on. Someone already using Orbit (settings exist) is
    // seeing this pop-up for the first time, so show what's in this version.
    if (!existsSync(settingsFile())) {
      writeSeen(current)
      return []
    }
    seen = '0.0.0'
    return notesSince(seen, current).slice(0, 1)
  }
  return notesSince(seen, current)
}

export function setupSettingsHealth(): void {
  ipcMain.handle('settingsHealth:check', () => checkSettingsFiles())
  ipcMain.handle('settingsHealth:reset', (_e, file: string) => resetSettingsFile(String(file)))
  ipcMain.handle('whatsNew:pending', () => (app.isPackaged || process.env.NOTES_WHATS_NEW ? pendingWhatsNew() : []))
  ipcMain.handle('whatsNew:all', () => notesSince('0.0.0', app.getVersion()))
  ipcMain.handle('whatsNew:seen', () => writeSeen(app.getVersion()))
}
