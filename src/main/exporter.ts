import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import type { ExportData, SaveFormat } from '@shared/types'
import { convertedPath } from './converter'

/**
 * Export: saving exported files where you choose, and printing pages to PDF (in a hidden window
 * that runs no scripts).
 */

const FILTERS: Record<SaveFormat, Electron.FileFilter> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Word document', extensions: ['docx'] },
  html: { name: 'Web page', extensions: ['html'] },
  md: { name: 'Markdown', extensions: ['md'] },
  txt: { name: 'Text', extensions: ['txt'] },
  jpg: { name: 'JPG picture', extensions: ['jpg', 'jpeg'] },
  png: { name: 'PNG picture', extensions: ['png'] },
  webp: { name: 'WebP picture', extensions: ['webp'] },
  mp3: { name: 'MP3 audio', extensions: ['mp3'] },
  wav: { name: 'WAV audio', extensions: ['wav'] },
  mp4: { name: 'MP4 video', extensions: ['mp4'] },
  mov: { name: 'QuickTime video', extensions: ['mov'] },
  webm: { name: 'WebM video', extensions: ['webm'] },
  gif: { name: 'GIF animation', extensions: ['gif'] }
}

/** The folder you last exported to, so the next export starts there. */
let lastFolder: string | null = null
/** Only files Notes itself exported can be revealed. */
const exported = new Set<string>()

const MAX_CONVERT_BYTES = 500 * 1024 * 1024

/** `name` in `folder`, or "name (2).ext" and so on when that's taken: nothing is ever written over. */
function freeName(folder: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let path = join(folder, name)
  for (let n = 2; existsSync(path); n++) path = join(folder, `${stem} (${n})${ext}`)
  return path
}

/** Writes an exported file: its text or bytes, or a converted video copied from where it waits. */
async function put(path: string, data: ExportData): Promise<void> {
  if (typeof data === 'string') return writeFile(path, data, 'utf8')
  if (data instanceof Uint8Array) return writeFile(path, data)
  const from = convertedPath(data)
  if (!from) throw new Error('The converted file is gone. Convert it again, then save.')
  await copyFile(from, path)
}

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

  ipcMain.handle('export:file', async (event, defaultName: string, format: SaveFormat, data: ExportData) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: join(lastFolder ?? app.getPath('documents'), defaultName),
      filters: [FILTERS[format] ?? FILTERS.pdf]
    })
    if (result.canceled || !result.filePath) return null
    await put(result.filePath, data)
    lastFolder = join(result.filePath, '..')
    exported.add(result.filePath)
    return result.filePath
  })

  ipcMain.handle('export:files', async (event, folderName: string, files: { name: string; data: ExportData }[]) => {
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
      await put(join(folder, safe), f.data)
    }
    lastFolder = parent
    exported.add(folder)
    return folder
  })

  // Claude Desktop's convert_file: reads the file to convert, and saves the result beside it.
  ipcMain.handle('export:readForConvert', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Give the file’s full path.')
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new Error('That file isn’t there.')
    if (info.size > MAX_CONVERT_BYTES) throw new Error('That file is too big to convert here (the most is 500 MB).')
    return new Uint8Array(await readFile(path))
  })
  ipcMain.handle('export:beside', async (_e, original: unknown, name: unknown, data: ExportData) => {
    if (typeof original !== 'string' || !isAbsolute(original) || typeof name !== 'string') throw new Error('No file to save beside.')
    const target = freeName(dirname(original), basename(name).replace(/[\\/:*?"<>|]+/g, '-') || 'converted')
    await put(target, data)
    exported.add(target)
    return target
  })

  ipcMain.handle('export:show', (_e, path: string) => {
    if (exported.has(path)) shell.showItemInFolder(path)
  })
}
