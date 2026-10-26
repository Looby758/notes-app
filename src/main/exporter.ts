import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'

/**
 * Export: saving exported files where you choose, and printing pages to PDF (in a hidden window
 * that runs no scripts).
 */

type Format = 'pdf' | 'docx' | 'html'

const FILTERS: Record<Format, Electron.FileFilter> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Word document', extensions: ['docx'] },
  html: { name: 'Web page', extensions: ['html'] }
}

/** The folder you last exported to, so the next export starts there. */
let lastFolder: string | null = null
/** Only files Notes itself exported can be revealed. */
const exported = new Set<string>()

const toBytes = (data: Uint8Array | string): Buffer => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data))

async function printToPdf(html: string): Promise<Uint8Array> {
  const file = join(app.getPath('temp'), `notes-export-${process.pid}-${Date.now()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } })
  try {
    await win.loadFile(file)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    return new Uint8Array(pdf)
  } finally {
    win.destroy()
    await rm(file, { force: true })
  }
}

export function setupExport(): void {
  ipcMain.handle('export:pdf', (_e, html: string) => printToPdf(html))

  ipcMain.handle('export:file', async (event, defaultName: string, format: Format, data: Uint8Array | string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: join(lastFolder ?? app.getPath('documents'), defaultName),
      filters: [FILTERS[format]]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, toBytes(data))
    lastFolder = join(result.filePath, '..')
    exported.add(result.filePath)
    return result.filePath
  })

  ipcMain.handle('export:files', async (event, folderName: string, files: { name: string; data: Uint8Array | string }[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: `Choose where to put the “${folderName}” folder`,
      buttonLabel: 'Export here',
      defaultPath: lastFolder ?? app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const parent = result.filePaths[0]
    // A new folder for the files, never mixing them into an existing one.
    let folder = join(parent, folderName)
    for (let n = 2; existsSync(folder); n++) folder = join(parent, `${folderName} (${n})`)
    await mkdir(folder, { recursive: true })
    for (const f of files) {
      // Names come from note titles; keep them to a plain file name.
      const safe = f.name.replace(/[\\/:*?"<>|]+/g, '-')
      await writeFile(join(folder, safe), toBytes(f.data))
    }
    lastFolder = parent
    exported.add(folder)
    return folder
  })

  ipcMain.handle('export:show', (_e, path: string) => {
    if (exported.has(path)) shell.showItemInFolder(path)
  })
}
