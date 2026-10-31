import { app, ipcMain, shell } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { cp, mkdir, open, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import {
  isHiddenName,
  isInside,
  isStreamable,
  nameProblem,
  previewKind,
  SEARCH_LIMIT,
  TEXT_PREVIEW_BYTES,
  uniqueName,
  type ExplorerEntry,
  type ExplorerPlace,
  type PasteMode
} from '@shared/explorer'
import { IS_MAC } from '@shared/platform'

/**
 * The file explorer tab's side of things: the places to start from, folder listings, text
 * previews and opening files. Pictures, video, sound and PDFs are previewed through
 * vault://explore/… (see explorerFile). File actions (new, rename, copy, move) never overwrite
 * anything: a name that's taken gets " (2)". Deleting only ever goes to the Recycle Bin / Bin.
 */

/** Programs and scripts are only ever shown in File Explorer / Finder, never run from here. */
const PROGRAMS = /\.(exe|bat|cmd|com|msi|ps1|vbs|js|lnk|scr|app|command|sh|pkg|workflow|terminal|tool|scpt)$/i

const exists = (p: string): boolean => {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

/** Google Drive for desktop's folder: a drive letter with "My Drive" on Windows, CloudStorage on a Mac. */
function googleDrive(): string | null {
  const home = homedir()
  const candidates: string[] = []
  if (process.platform === 'win32') {
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') candidates.push(`${letter}:\\My Drive`)
  } else if (IS_MAC) {
    const cloud = join(home, 'Library', 'CloudStorage')
    try {
      for (const name of readdirSync(cloud)) {
        if (name.startsWith('GoogleDrive')) candidates.push(join(cloud, name, 'My Drive'), join(cloud, name))
      }
    } catch {
      // No CloudStorage folder: Drive isn't installed.
    }
    candidates.push('/Volumes/GoogleDrive/My Drive')
  }
  candidates.push(join(home, 'Google Drive', 'My Drive'), join(home, 'Google Drive'), join(home, 'My Drive'))
  return candidates.find(exists) ?? null
}

function drives(): ExplorerPlace[] {
  if (process.platform === 'win32') {
    return [...'CDEFGHIJKLMNOPQRSTUVWXYZ']
      .filter((l) => exists(`${l}:\\`))
      .map((l) => ({ id: `drive-${l}`, label: `${l === 'C' ? 'This PC' : 'Drive'} (${l}:)`, path: `${l}:\\`, kind: 'drive' as const }))
  }
  const list: ExplorerPlace[] = [{ id: 'drive-root', label: IS_MAC ? 'Macintosh HD' : 'Computer', path: '/', kind: 'drive' }]
  if (IS_MAC) {
    try {
      for (const name of readdirSync('/Volumes')) {
        if (name !== 'Macintosh HD' && !name.startsWith('.')) list.push({ id: `drive-${name}`, label: name, path: join('/Volumes', name), kind: 'drive' })
      }
    } catch {
      // No other drives.
    }
  }
  return list
}

function places(vaultRoot: string | null): ExplorerPlace[] {
  const folder = (id: ExplorerPlace['kind'], label: string, name: Parameters<typeof app.getPath>[0]): ExplorerPlace | null => {
    try {
      const path = app.getPath(name)
      return exists(path) ? { id, label, path, kind: id } : null
    } catch {
      return null
    }
  }
  const list = [
    folder('home', 'Home', 'home'),
    folder('desktop', 'Desktop', 'desktop'),
    folder('documents', 'Documents', 'documents'),
    folder('downloads', 'Downloads', 'downloads'),
    folder('pictures', 'Pictures', 'pictures'),
    folder('music', 'Music', 'music'),
    folder('videos', IS_MAC ? 'Movies' : 'Videos', 'videos')
  ].filter((p): p is ExplorerPlace => !!p)
  const drive = googleDrive()
  if (drive) list.push({ id: 'google', label: 'Google Drive', path: drive, kind: 'google' })
  if (vaultRoot) list.push({ id: 'notes', label: 'Notes folder', path: vaultRoot, kind: 'notes' })
  // Without its own Documents folder (say), the system hands back the home folder: list each folder once.
  const seen = new Set<string>()
  return [...list, ...drives()].filter((p) => !seen.has(p.path) && !!seen.add(p.path))
}

/** Its path inside the notes folder ("Ideas/Plan.md"), or null when it's outside. */
function inVault(vaultRoot: string | null, full: string): string | null {
  if (!vaultRoot) return null
  const rel = relative(vaultRoot, full)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(/[\\/]/).join('/') : null
}

function checkPath(path: unknown): string {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('That isn’t a place on this computer.')
  return resolve(path)
}

async function entryOf(vaultRoot: string | null, path: string): Promise<ExplorerEntry | null> {
  try {
    const info = await stat(path)
    const name = basename(path)
    return {
      name,
      path,
      isDir: info.isDirectory(),
      size: info.isDirectory() ? 0 : info.size,
      modified: info.mtimeMs,
      hidden: isHiddenName(name),
      vaultPath: inVault(vaultRoot, path)
    }
  } catch {
    return null
  }
}

async function list(vaultRoot: string | null, dir: string): Promise<ExplorerEntry[]> {
  const items = await readdir(dir, { withFileTypes: true })
  const entries = await Promise.all(
    items.map(async (item): Promise<ExplorerEntry | null> => {
      const path = join(dir, item.name)
      try {
        // stat follows shortcuts (symlinks) to what they point at.
        const info = await stat(path)
        return {
          name: item.name,
          path,
          isDir: info.isDirectory(),
          size: info.isDirectory() ? 0 : info.size,
          modified: info.mtimeMs,
          hidden: isHiddenName(item.name),
          vaultPath: inVault(vaultRoot, path)
        }
      } catch {
        // Locked or broken: leave it out.
        return null
      }
    })
  )
  return entries.filter((e): e is ExplorerEntry => !!e)
}

async function readText(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_BYTES)
    const { bytesRead } = await file.read(buffer, 0, TEXT_PREVIEW_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

/** The file a vault://explore/… address asks for, or null if it isn't one that's previewed. */
export function explorerFile(url: URL): string | null {
  const path = decodeURIComponent(url.pathname.slice(1))
  return isAbsolute(path) && isStreamable(path) ? resolve(path) : null
}

const namesIn = async (dir: string): Promise<string[]> => readdir(dir).catch(() => [])

function checkName(name: unknown): string {
  const problem = typeof name === 'string' ? nameProblem(name) : 'That isn’t a name.'
  if (problem) throw new Error(problem)
  return (name as string).trim()
}

/** A new, empty folder or file in `dir`, named so it doesn't clash. Returns its path. */
async function create(dir: string, name: string, kind: 'folder' | 'file'): Promise<string> {
  const path = join(dir, uniqueName(checkName(name), await namesIn(dir), kind === 'folder'))
  if (kind === 'folder') await mkdir(path)
  else await writeFile(path, '', { flag: 'wx' })
  return path
}

async function renameItem(path: string, name: string): Promise<string> {
  const next = join(dirname(path), checkName(name))
  if (next === path) return path
  // Changing only the capitals ("plan" → "Plan") is the same file on Windows and a Mac, so it's allowed.
  if (next.toLowerCase() !== path.toLowerCase() && existsSync(next)) throw new Error(`There's already something called "${basename(next)}" here.`)
  await rename(path, next)
  return next
}

/** Copies or moves each item into `dir`, never over something already there. Returns the new paths. */
async function paste(paths: string[], dir: string, mode: PasteMode): Promise<string[]> {
  const done: string[] = []
  const taken = await namesIn(dir)
  for (const from of paths) {
    const info = await stat(from)
    if (info.isDirectory() && isInside(dir, from)) throw new Error(`"${basename(from)}" can't go inside itself.`)
    // Moving into the folder it's already in does nothing; copying there makes "name (2)".
    if (mode === 'move' && resolve(dirname(from)) === resolve(dir)) continue
    const name = uniqueName(basename(from), taken, info.isDirectory())
    taken.push(name)
    const to = join(dir, name)
    if (mode === 'move') {
      try {
        await rename(from, to)
      } catch (err) {
        // To another drive, a move is a copy and then a delete.
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
        await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
        await rm(from, { recursive: true, force: true })
      }
    } else {
      await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    }
    done.push(to)
  }
  return done
}

/** The folders that are never worth searching through. */
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', 'appdata', 'library', 'windows', 'program files', 'program files (x86)', 'programdata'])

/** Names containing every word typed, anywhere under `dir`. Stops at SEARCH_LIMIT matches or a few seconds. */
async function search(vaultRoot: string | null, dir: string, query: string, showHidden: boolean): Promise<ExplorerEntry[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const found: string[] = []
  const queue = [dir]
  const until = Date.now() + 4000
  while (queue.length && found.length < SEARCH_LIMIT && Date.now() < until) {
    const at = queue.shift()!
    const items = await readdir(at, { withFileTypes: true }).catch(() => [])
    for (const item of items) {
      const hidden = isHiddenName(item.name)
      if (hidden && !showHidden) continue
      const path = join(at, item.name)
      const lower = item.name.toLowerCase()
      if (words.every((w) => lower.includes(w))) found.push(path)
      // Shortcuts to folders aren't followed, so a loop can't trap the search.
      if (item.isDirectory() && !item.isSymbolicLink() && !(at !== dir && SKIP_DIRS.has(lower))) queue.push(path)
      if (found.length >= SEARCH_LIMIT) break
    }
  }
  const entries = await Promise.all(found.map((p) => entryOf(vaultRoot, p)))
  return entries.filter((e): e is ExplorerEntry => !!e)
}

const checkPaths = (paths: unknown): string[] => {
  if (!Array.isArray(paths)) throw new Error('Nothing was picked.')
  return paths.map(checkPath)
}

export function setupExplorer(vaultRoot: () => string | null): void {
  ipcMain.handle('explorer:places', () => places(vaultRoot()))
  ipcMain.handle('explorer:list', (_e, dir: string) => list(vaultRoot(), checkPath(dir)))
  ipcMain.handle('explorer:readText', (_e, path: string) => {
    const full = checkPath(path)
    if (previewKind(full) !== 'text') throw new Error('That file can’t be previewed as text.')
    return readText(full)
  })
  ipcMain.handle('explorer:open', async (_e, path: string) => {
    const full = checkPath(path)
    if (PROGRAMS.test(full)) {
      shell.showItemInFolder(full)
      return
    }
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })
  ipcMain.handle('explorer:reveal', (_e, path: string) => shell.showItemInFolder(checkPath(path)))
  ipcMain.handle('explorer:create', (_e, dir: string, name: string, kind: 'folder' | 'file') => create(checkPath(dir), name, kind === 'folder' ? 'folder' : 'file'))
  ipcMain.handle('explorer:rename', (_e, path: string, name: string) => renameItem(checkPath(path), name))
  ipcMain.handle('explorer:paste', (_e, paths: string[], dir: string, mode: PasteMode) => paste(checkPaths(paths), checkPath(dir), mode === 'move' ? 'move' : 'copy'))
  ipcMain.handle('explorer:trash', async (_e, paths: string[]) => {
    const done: string[] = []
    for (const p of checkPaths(paths)) {
      // The top of a drive can't go in the Bin.
      if (dirname(p) === p) continue
      await shell.trashItem(p)
      done.push(p)
    }
    return done
  })
  ipcMain.handle('explorer:search', (_e, dir: string, query: string, showHidden: boolean) => search(vaultRoot(), checkPath(dir), String(query ?? ''), !!showHidden))
}
