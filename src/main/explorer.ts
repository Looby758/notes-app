import { app, ipcMain, shell } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { open, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve } from 'path'
import { isHiddenName, isStreamable, previewKind, TEXT_PREVIEW_BYTES, type ExplorerEntry, type ExplorerPlace } from '@shared/explorer'
import { IS_MAC } from '@shared/platform'

/**
 * The file explorer tab's side of things: the places to start from, folder listings, text
 * previews and opening files. Pictures, video, sound and PDFs are previewed through
 * vault://explore/… (see explorerFile). Nothing here changes or deletes a file.
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
}
