import { BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'

/**
 * The file-system side of importing notes from other apps: picking the export, listing and reading
 * its files (only inside what you picked), and on a Mac reading Apple Notes straight from the app.
 */

/** Files and folders you picked to import from; reading is only allowed inside these. */
const allowed = new Set<string>()

const isInside = (path: string): boolean =>
  [...allowed].some((root) => {
    const r = relative(root, resolve(path))
    return r === '' || (!r.startsWith('..') && !isAbsolute(r))
  })

const MAX_FILE = 600 * 1024 * 1024

async function listFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await listFiles(root, full, out)
    else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'))
    if (out.length > 50_000) break
  }
  return out
}

/** Apple Notes, read through the Notes app (asks once for permission). Each folder in one go, for speed. */
const APPLE_SCRIPT = `
const app = Application('Notes')
const out = []
for (const account of app.accounts()) {
  for (const folder of account.folders()) {
    const name = folder.name()
    if (/^(Recently Deleted|Nylig slettet|Zuletzt gelöscht)$/i.test(name)) continue
    const notes = folder.notes
    const titles = notes.name(), bodies = notes.body(), created = notes.creationDate(), modified = notes.modificationDate(), locked = notes.passwordProtected()
    for (let i = 0; i < titles.length; i++) {
      out.push({ account: account.name(), folder: name, title: titles[i], html: locked[i] ? '' : bodies[i], created: created[i].toISOString(), modified: modified[i].toISOString(), locked: locked[i] })
    }
  }
}
JSON.stringify(out)
`

export function setupImporter(): void {
  ipcMain.handle('import:pick', async (event, kind: 'file' | 'folder', extensions: string[] = []) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose what to import',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
      filters: kind === 'file' && extensions.length ? [{ name: 'Exports', extensions }] : []
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = result.canceled ? null : result.filePaths[0]
    if (path) allowed.add(resolve(path))
    return path ?? null
  })

  ipcMain.handle('import:list', async (_e, root: string) => {
    if (!isInside(root)) throw new Error('That folder wasn’t chosen for importing.')
    return listFiles(resolve(root))
  })

  ipcMain.handle('import:read', async (_e, path: string) => {
    if (!isInside(path)) throw new Error('That file wasn’t chosen for importing.')
    const stat = await fs.stat(path)
    if (stat.size > MAX_FILE) throw new Error('That file is too big to import (over 600 MB).')
    return new Uint8Array(await fs.readFile(path))
  })

  ipcMain.handle('import:md5', (_e, data: Uint8Array) => createHash('md5').update(data).digest('hex'))

  ipcMain.handle('import:appleNotes', async () => {
    if (process.platform !== 'darwin') throw new Error('Apple Notes can only be imported on a Mac.')
    return new Promise<unknown[]>((res, rej) => {
      execFile('osascript', ['-l', 'JavaScript', '-e', APPLE_SCRIPT], { maxBuffer: 1024 * 1024 * 1024, timeout: 10 * 60_000 }, (err, stdout) => {
        if (err) {
          const denied = /not allowed|-1743|not authori[sz]ed/i.test(String(err.message))
          rej(
            new Error(
              denied
                ? 'Notes isn’t allowed to read Apple Notes. Turn it on in System Settings → Privacy & Security → Automation → Notes, then try again.'
                : `Couldn’t read Apple Notes: ${err.message.split('\n')[0]}`
            )
          )
          return
        }
        try {
          res(JSON.parse(stdout || '[]'))
        } catch {
          rej(new Error('Apple Notes sent back something unexpected.'))
        }
      })
    })
  })
}
