import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'

/**
 * A test copy: Orbit started from its code (`npm run dev`, or App Studio's Try it on Orbit itself)
 * rather than installed. It keeps its own settings and data in "Orbit Test Copy", so it runs next to
 * your normal Orbit (only one copy of each may run) and never touches your real notes or settings.
 */
export const TEST_COPY = !app.isPackaged

/**
 * Windows groups taskbar buttons by this id: a test copy has its own, so it gets its own button
 * instead of stacking under your real Orbit.
 */
export const WINDOWS_APP_ID = TEST_COPY ? 'com.notesapp.desktop.testcopy' : 'com.notesapp.desktop'

/**
 * App Studio's test copies of Orbit (a pull request's version, in "notes-app-test-copies/<branch>")
 * each get a data folder of their own, so several can run side by side.
 */
const copyOf = (dir: string): string | null => (/-test-copies$/.test(basename(dirname(dir))) ? basename(dir) : null)
const copy = TEST_COPY ? copyOf(app.getAppPath()) : null

export const TEST_COPY_FOLDER = copy ? `Orbit Test Copy (${copy})` : 'Orbit Test Copy'

/** The notes folder your installed Orbit uses, read from its own settings, or null if it can't be found. */
export function realOrbitVault(): string | null {
  for (const folder of ['Notes', 'notesapp']) {
    try {
      const file = join(app.getPath('appData'), folder, 'settings.json')
      if (!existsSync(file)) continue
      const path = (JSON.parse(readFileSync(file, 'utf8')) as { vaultPath?: unknown }).vaultPath
      return typeof path === 'string' && path ? path : null
    } catch {
      return null
    }
  }
  return null
}

/** Whether two folder paths are the same folder (ignoring case on Windows and Mac, and a trailing slash). */
export function sameFolder(a: string, b: string, ignoreCase = process.platform !== 'linux'): boolean {
  const clean = (p: string): string => {
    const r = resolve(p).replace(/[\\/]+$/, '')
    return ignoreCase ? r.toLowerCase() : r
  }
  return clean(a) === clean(b)
}

/**
 * Whether a test copy must only read synced settings from this notes folder: always for your real
 * Orbit's notes folder (or when it can't tell which that is), never for a separate test vault.
 */
export function testCopyReadOnly(root: string | null): boolean {
  if (!TEST_COPY) return false
  const real = realOrbitVault()
  return !root || !real || sameFolder(root, real)
}
