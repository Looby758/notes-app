import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import JSZip from 'jszip'
import { setImportedThemes, type Theme } from '@shared/themes'
import {
  cleanThemePath,
  FONT_TYPES,
  IMPORTED_PREFIX,
  MAX_FILE_BYTES,
  MAX_THEME_BYTES,
  PICTURE_TYPES,
  readThemeManifest,
  THEME_FILE_EXTENSION
} from '@shared/themePack'
import { logError } from './log'

/**
 * Imported themes live in <userData>/themes/<slug>/: a cleaned theme.json and the pictures and
 * fonts it uses. They're served to the app's pages at notestheme://<slug>/<path>.
 */

export const THEME_SCHEME = { scheme: 'notestheme', privileges: { standard: true, secure: true, supportFetchAPI: true } }

export const themesDir = (): string => join(app.getPath('userData'), 'themes')
const slugOf = (id: string): string => id.slice(IMPORTED_PREFIX.length)

let themes: Theme[] = []

/** Reads the imported themes from disk and makes them available (call before reading prefs). */
export function loadImportedThemes(): Theme[] {
  const found: Theme[] = []
  let names: string[] = []
  try {
    names = readdirSync(themesDir())
  } catch {
    // No themes imported yet.
  }
  for (const name of names) {
    const folder = join(themesDir(), name)
    try {
      const raw = JSON.parse(readFileSync(join(folder, 'theme.json'), 'utf8'))
      const result = readThemeManifest(raw, (path) => existsSync(join(folder, path)))
      if ('theme' in result && slugOf(result.theme.id) === name) found.push(result.theme)
    } catch (err) {
      logError(`theme ${name}`, err)
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  themes = found
  setImportedThemes(themes)
  return themes
}

/** The files in a theme file, by their path inside it (with any single top folder taken off). */
async function readThemeFile(file: string): Promise<{ manifest: unknown; files: Map<string, () => Promise<Buffer>> }> {
  if (statSync(file).size > MAX_THEME_BYTES) throw new Error('This theme is too big.')
  const data = readFileSync(file)
  if (extname(file).toLowerCase() === '.json') return { manifest: JSON.parse(data.toString('utf8')), files: new Map() }

  const zip = await JSZip.loadAsync(data)
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const manifestEntry = entries.find((f) => /^([^/]+\/)?theme\.json$/.test(f.name.replace(/\\/g, '/')))
  if (!manifestEntry) throw new Error('This file has no theme.json inside.')
  const top = manifestEntry.name.replace(/\\/g, '/').replace(/theme\.json$/, '')
  const files = new Map<string, () => Promise<Buffer>>()
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/')
    if (!name.startsWith(top)) continue
    const path = cleanThemePath(name.slice(top.length))
    if (path) files.set(path, () => entry.async('nodebuffer'))
  }
  return { manifest: JSON.parse(await manifestEntry.async('string')), files }
}

/** Imports a theme file. Importing a theme with the same id again replaces it. */
export async function importTheme(file: string): Promise<Theme> {
  const { manifest, files } = await readThemeFile(file)
  const result = readThemeManifest(manifest, (path) => files.has(path))
  if ('error' in result) throw new Error(result.error)
  const { theme } = result
  const slug = slugOf(theme.id)

  // Built in a temporary folder, then swapped in, so a failed import never leaves half a theme.
  const target = join(themesDir(), slug)
  const temp = join(themesDir(), `.${slug}-${Date.now()}`)
  mkdirSync(temp, { recursive: true })
  try {
    let total = 0
    for (const path of theme.pack?.files ?? []) {
      const ext = extname(path).toLowerCase()
      if (!PICTURE_TYPES.includes(ext) && !FONT_TYPES.includes(ext)) continue
      const bytes = await files.get(path)!()
      if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} is too big (over ${MAX_FILE_BYTES / 1024 / 1024} MB).`)
      total += bytes.length
      if (total > MAX_THEME_BYTES) throw new Error('This theme is too big.')
      const out = join(temp, ...path.split('/'))
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
    }
    writeFileSync(join(temp, 'theme.json'), JSON.stringify(manifest, null, 2), 'utf8')
    rmSync(target, { recursive: true, force: true })
    renameSync(temp, target)
  } catch (err) {
    rmSync(temp, { recursive: true, force: true })
    throw err
  }
  loadImportedThemes()
  return themes.find((t) => t.id === theme.id) ?? theme
}

/**
 * A theme made by Claude Desktop (make_theme): colours, and a picture behind every page from a
 * file on this computer or a web address. Saved like an imported theme, so it can be removed the same way.
 */
export async function makeTheme(manifest: Record<string, unknown>, picture?: string): Promise<Theme> {
  let bytes: Buffer | null = null
  let ext = ''
  if (picture) {
    if (/^https:\/\//i.test(picture)) {
      const res = await net.fetch(picture)
      if (!res.ok) throw new Error(`Couldn’t download the picture (${res.status}).`)
      const type = (res.headers.get('content-type') ?? '').toLowerCase()
      ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('gif') ? '.gif' : type.includes('jpeg') || type.includes('jpg') ? '.jpg' : extname(new URL(picture).pathname).toLowerCase()
      bytes = Buffer.from(await res.arrayBuffer())
    } else {
      ext = extname(picture).toLowerCase()
      bytes = readFileSync(picture)
    }
    if (!PICTURE_TYPES.includes(ext)) throw new Error('The picture has to be a PNG, JPG, WebP or GIF.')
    if (bytes.length > MAX_FILE_BYTES) throw new Error('That picture is too big (over 25 MB).')
  }
  const file = bytes ? `pictures/background${ext}` : null
  const full = { ...manifest, format: 1, ...(file ? { pictures: { all: { file, position: 'center' } } } : {}) }
  const result = readThemeManifest(full, (path) => path === file)
  if ('error' in result) throw new Error(result.error)
  const slug = slugOf(result.theme.id)
  const target = join(themesDir(), slug)
  const temp = join(themesDir(), `.${slug}-${Date.now()}`)
  mkdirSync(join(temp, 'pictures'), { recursive: true })
  try {
    if (bytes && file) writeFileSync(join(temp, ...file.split('/')), bytes)
    writeFileSync(join(temp, 'theme.json'), JSON.stringify(full, null, 2), 'utf8')
    rmSync(target, { recursive: true, force: true })
    renameSync(temp, target)
  } catch (err) {
    rmSync(temp, { recursive: true, force: true })
    throw err
  }
  loadImportedThemes()
  return themes.find((t) => t.id === result.theme.id) ?? result.theme
}

export function removeTheme(id: string): void {
  if (!id.startsWith(IMPORTED_PREFIX)) return
  const slug = slugOf(id)
  if (!/^[a-z0-9-]+$/.test(slug)) return
  rmSync(join(themesDir(), slug), { recursive: true, force: true })
  loadImportedThemes()
}

/** The file on disk for a theme's file (only pictures and fonts, only inside that theme's folder). */
export function themeFilePath(id: string, path: string): string | null {
  const slug = slugOf(id)
  const clean = cleanThemePath(path)
  if (!/^[a-z0-9-]+$/.test(slug) || !clean) return null
  const folder = resolve(themesDir(), slug)
  const full = resolve(folder, ...clean.split('/'))
  if (!full.startsWith(folder + sep)) return null
  const ext = extname(full).toLowerCase()
  if (!PICTURE_TYPES.includes(ext) && !FONT_TYPES.includes(ext)) return null
  try {
    return statSync(full).isFile() ? full : null
  } catch {
    return null
  }
}

function registerThemeProtocol(): void {
  protocol.handle(THEME_SCHEME.scheme, (request) => {
    const url = new URL(request.url)
    const file = themeFilePath(IMPORTED_PREFIX + url.hostname, decodeURIComponent(url.pathname.slice(1)))
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/**
 * The themes IPC and the notestheme:// protocol. `onChange` runs after a theme is imported or
 * removed (to re-check prefs and tell every window).
 */
export function setupThemes(onChange: (removed?: string) => void): void {
  registerThemeProtocol()
  ipcMain.handle('themes:list', () => themes)
  ipcMain.handle('themes:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Import a theme',
      properties: ['openFile' as const],
      filters: [{ name: 'Theme files', extensions: [THEME_FILE_EXTENSION, 'zip', 'json'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    try {
      const theme = await importTheme(picked.filePaths[0])
      onChange()
      return { theme }
    } catch (err) {
      logError('theme import', err)
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('themes:make', async (_e, manifest: Record<string, unknown>, picture?: string) => {
    const theme = await makeTheme(manifest && typeof manifest === 'object' ? manifest : {}, typeof picture === 'string' && picture ? picture : undefined)
    onChange()
    return theme
  })
  ipcMain.handle('themes:remove', (_e, id: string) => {
    removeTheme(id)
    onChange(id)
  })
}

export function broadcastThemes(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('themes:changed', themes)
}
