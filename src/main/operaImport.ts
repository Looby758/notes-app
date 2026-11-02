import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { createDecipheriv, pbkdf2Sync } from 'crypto'
import { existsSync, promises as fs, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import initSqlJs, { type Database } from 'sql.js'
import {
  chromiumTime,
  HISTORY_LIMIT,
  hostOf,
  loginsFromCsv,
  parseChromiumBookmarks,
  type HistoryEntry,
  type ImportedBookmark,
  type ImportedLogin
} from '@shared/browser'
import type { OperaImportResult } from '@shared/types'
import { getBookmarks, getHistory, setBookmarks, setHistory } from './browserData'
import { logError } from './log'
import { findMissingFavicons, rememberFavicon } from './favicons'

/**
 * A one-time move from Opera GX: its bookmarks and history come into Orbit's browser, and its saved
 * logins go to Orbit's Passwords (the window saves them there, since only it holds the unlocked
 * vault). Opera GX keeps these in its profile folder: bookmarks as JSON, history and logins in
 * SQLite databases (read here with sql.js), the passwords encrypted with a key the system protects
 * (Windows' data protection, or the Mac Keychain's "Opera Safe Storage").
 *
 * Passwords that newer Chromium browsers lock to their own app ("v20") can't be read by anything
 * else; for those, export a passwords CSV from Opera GX and import that instead.
 */

const run = promisify(execFile)

/** Where Opera GX keeps your profile on this computer (the first that exists). */
function profileFolders(): string[] {
  if (process.platform === 'win32') {
    const base = join(app.getPath('appData'), 'Opera Software', 'Opera GX Stable')
    return [join(base, 'Default'), base]
  }
  if (process.platform === 'darwin') {
    const base = join(homedir(), 'Library', 'Application Support', 'com.operasoftware.OperaGX')
    return [join(base, 'Default'), base]
  }
  return [join(homedir(), '.config', 'opera-gx'), join(homedir(), '.config', 'opera')]
}

export function findOperaProfile(): { profile: string; root: string } | null {
  // The folder with the bookmarks first, then one with anything Opera keeps.
  const candidates = profileFolders()
  const withBookmarks = candidates.find((f) => existsSync(join(f, 'Bookmarks')))
  for (const folder of withBookmarks ? [withBookmarks] : candidates) {
    if (existsSync(join(folder, 'Bookmarks')) || existsSync(join(folder, 'History')) || existsSync(join(folder, 'Login Data'))) {
      // Local State (with the passwords' key) is in the folder above a "Default" profile.
      const root = folder.endsWith('Default') ? join(folder, '..') : folder
      return { profile: folder, root }
    }
  }
  return null
}

let sql: Awaited<ReturnType<typeof initSqlJs>> | null = null

/** Opens a copy of one of Opera's databases (it keeps the real one locked while it's open). */
async function openDatabase(path: string): Promise<Database> {
  if (!sql) {
    const wasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    sql = await initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
  }
  let data: Buffer
  try {
    data = await fs.readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EBUSY' || (err as NodeJS.ErrnoException).code === 'EPERM') {
      throw new Error('Opera GX is using it. Close Opera GX and try again.')
    }
    throw err
  }
  return new sql.Database(data)
}

function rows(db: Database, query: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const statement = db.prepare(query)
  try {
    while (statement.step()) out.push(statement.getAsObject())
  } finally {
    statement.free()
  }
  return out
}

// ---------- bookmarks and history ----------

const newId = (): string => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Adds Opera's bookmarks (each address once); returns how many links were added. */
export function addImportedBookmarks(imported: { bar: ImportedBookmark[]; other: ImportedBookmark[] }): number {
  const all = [...getBookmarks()]
  const have = new Set(all.filter((b) => b.url).map((b) => b.url!.replace(/\/$/, '')))
  let added = 0
  const now = Date.now()
  const addTree = (items: ImportedBookmark[], parent: string): void => {
    for (const item of items) {
      if (item.children) {
        const id = newId()
        all.push({ id, kind: 'folder', title: item.title || 'Folder', parent, created: now })
        addTree(item.children, id)
      } else if (item.url && hostOf(item.url) && !have.has(item.url.replace(/\/$/, ''))) {
        have.add(item.url.replace(/\/$/, ''))
        all.push({ id: newId(), kind: 'link', title: item.title, url: item.url, parent, created: now })
        added++
      }
    }
  }
  // Straight onto the bar and into Other bookmarks, after what's there (Opera's own folders stay folders).
  addTree(imported.bar, 'bar')
  addTree(imported.other, 'other')
  // Folders that ended up empty (everything in them was already bookmarked) aren't kept.
  let changed = true
  let result = all
  while (changed) {
    const used = new Set(result.map((b) => b.parent))
    const next = result.filter((b) => b.kind !== 'folder' || used.has(b.id) || getBookmarks().some((o) => o.id === b.id))
    changed = next.length !== result.length
    result = next
  }
  setBookmarks(result)
  // The bookmarks bar and the Bookmarks panel show them straight away.
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('web:bookmarks-changed', getBookmarks())
  return added
}

/** Opera's own icons for these pages (from its "Favicons" database), the one nearest 32px per site. */
function importIcons(db: Database, urls: Set<string>): number {
  const hosts = new Set([...urls].map((u) => hostOf(u)).filter(Boolean))
  const best = new Map<string, { width: number; data: Uint8Array }>()
  for (const r of rows(db, 'SELECT m.page_url AS page, b.image_data AS data, b.width AS width FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id')) {
    const host = hostOf(String(r.page ?? ''))
    if (!hosts.has(host) || !(r.data instanceof Uint8Array) || !r.data.length) continue
    const width = Number(r.width) || 16
    const have = best.get(host)
    if (!have || Math.abs(width - 32) < Math.abs(have.width - 32)) best.set(host, { width, data: r.data })
  }
  for (const [host, { data }] of best) rememberFavicon(host, `data:image/png;base64,${Buffer.from(data).toString('base64')}`)
  return best.size
}

function importHistory(db: Database): number {
  const found = rows(db, 'SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ' + HISTORY_LIMIT)
  const have = new Map(getHistory().map((e) => [e.url, e]))
  let added = 0
  for (const r of found) {
    const url = String(r.url ?? '')
    if (!hostOf(url) || have.has(url)) continue
    const entry: HistoryEntry = {
      url,
      title: String(r.title ?? ''),
      visited: chromiumTime(Number(r.last_visit_time ?? 0)),
      visits: Number(r.visit_count ?? 1) || 1,
      text: ''
    }
    have.set(url, entry)
    added++
  }
  setHistory([...have.values()].sort((a, b) => b.visited - a.visited).slice(0, HISTORY_LIMIT))
  return added
}

// ---------- saved logins ----------

/** The key Opera encrypted its saved passwords with. */
async function passwordKey(root: string): Promise<{ kind: 'gcm' | 'cbc'; key: Buffer } | null> {
  if (process.platform === 'win32') {
    const state = JSON.parse(await fs.readFile(join(root, 'Local State'), 'utf8')) as { os_crypt?: { encrypted_key?: string } }
    const wrapped = state.os_crypt?.encrypted_key
    if (!wrapped) return null
    // The key is protected by Windows for your account ("DPAPI" in front); Windows unwraps it.
    const blob = Buffer.from(wrapped, 'base64').subarray(5).toString('base64')
    const script =
      'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:ORBIT_BLOB); ' +
      "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))"
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ORBIT_BLOB: blob },
      windowsHide: true,
      timeout: 20000
    })
    return { kind: 'gcm', key: Buffer.from(stdout.trim(), 'base64') }
  }
  if (process.platform === 'darwin') {
    for (const service of ['Opera GX Safe Storage', 'Opera Safe Storage']) {
      try {
        const { stdout } = await run('security', ['find-generic-password', '-w', '-s', service], { timeout: 60000 })
        const secret = stdout.trim()
        if (secret) return { kind: 'cbc', key: pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1') }
      } catch {
        // not under this name (or you said no in the Keychain's question)
      }
    }
  }
  return null
}

/** One saved password, or null when it can't be read ("v20": locked to Opera itself). */
export function decryptPassword(blob: Uint8Array, key: { kind: 'gcm' | 'cbc'; key: Buffer }): string | null {
  const data = Buffer.from(blob)
  const version = data.subarray(0, 3).toString('latin1')
  if (version !== 'v10' && version !== 'v11') return null
  try {
    if (key.kind === 'gcm') {
      const nonce = data.subarray(3, 15)
      const tag = data.subarray(data.length - 16)
      const decipher = createDecipheriv('aes-256-gcm', key.key, nonce)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data.subarray(15, data.length - 16)), decipher.final()]).toString('utf8')
    }
    const decipher = createDecipheriv('aes-128-cbc', key.key, Buffer.alloc(16, 0x20))
    return Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

async function importLogins(profile: string, root: string): Promise<{ logins: ImportedLogin[]; locked: number }> {
  const db = await openDatabase(join(profile, 'Login Data'))
  try {
    const found = rows(db, 'SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0')
    if (!found.length) return { logins: [], locked: 0 }
    const key = await passwordKey(root).catch((err) => {
      logError('Opera GX import key', err)
      return null
    })
    const logins: ImportedLogin[] = []
    let locked = 0
    for (const r of found) {
      const blob = r.password_value instanceof Uint8Array ? r.password_value : new Uint8Array()
      const password = key ? decryptPassword(blob, key) : null
      if (password === null) {
        locked++
        continue
      }
      if (password) logins.push({ url: String(r.origin_url ?? ''), username: String(r.username_value ?? ''), password })
    }
    return { logins, locked }
  } finally {
    db.close()
  }
}

export async function importFromOpera(): Promise<OperaImportResult> {
  const where = findOperaProfile()
  const result: OperaImportResult = { profile: where?.profile ?? '', bookmarks: 0, history: 0, logins: [], lockedLogins: 0, problems: [] }
  if (!where) return result
  const { profile, root } = where
  const step = async (what: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work()
    } catch (err) {
      logError(`Opera GX import (${what})`, err)
      result.problems.push(`${what}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  await step('Bookmarks', async () => {
    const file = join(profile, 'Bookmarks')
    if (existsSync(file)) result.bookmarks = addImportedBookmarks(parseChromiumBookmarks(await fs.readFile(file, 'utf8')))
  })
  await step('Site icons', async () => {
    const urls = new Set(getBookmarks().flatMap((b) => (b.url ? [b.url] : [])))
    if (existsSync(join(profile, 'Favicons'))) {
      const db = await openDatabase(join(profile, 'Favicons'))
      try {
        importIcons(db, urls)
      } finally {
        db.close()
      }
    }
    // Any still without one are looked up in the background.
    void findMissingFavicons([...urls])
  })
  await step('History', async () => {
    if (!existsSync(join(profile, 'History'))) return
    const db = await openDatabase(join(profile, 'History'))
    try {
      result.history = importHistory(db)
    } finally {
      db.close()
    }
  })
  await step('Saved logins', async () => {
    if (!existsSync(join(profile, 'Login Data'))) return
    const { logins, locked } = await importLogins(profile, root)
    result.logins = logins
    result.lockedLogins = locked
  })
  return result
}

/** Logins from a passwords CSV you exported (Opera GX: Settings → Passwords → ⋮ → Export passwords). */
async function importCsv(win: BrowserWindow | null): Promise<ImportedLogin[] | null> {
  const options = { title: 'Import passwords', filters: [{ name: 'Passwords CSV', extensions: ['csv'] }], properties: ['openFile' as const] }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return null
  const logins = loginsFromCsv(await fs.readFile(picked.filePaths[0], 'utf8'))
  if (!logins.length) throw new Error('No logins were found in that file. It should be a passwords CSV exported from a browser.')
  return logins
}

export function setupOperaImport(): void {
  ipcMain.handle('web:operaFound', () => !!findOperaProfile())
  ipcMain.handle('web:importOpera', () => importFromOpera())
  ipcMain.handle('web:importCsv', (e) => importCsv(BrowserWindow.fromWebContents(e.sender)))
}
