import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell, systemPreferences, type WebContents } from 'electron'
import { createWriteStream, existsSync, mkdirSync, statSync, type WriteStream } from 'fs'
import { isAbsolute, join } from 'path'
import { IS_MAC } from '@shared/platform'
import { recordingFileName } from '@shared/studio'
import type { StudioCaptureSource } from '@shared/types'
import { logError } from './log'

/**
 * The Studio's main-process side (the scenes, mixing and recording live in the renderer:
 * components/Studio and lib/studio). This lists the screens and windows you can capture, asks
 * macOS for camera/screen access, and writes recordings to disk as they're made, a second at a
 * time, so a long recording never sits in memory.
 */

interface Recording {
  path: string
  out: WriteStream
  failed?: string
}
const recordings = new Map<number, Recording>()
/** Files the Studio made: the only ones "Show in folder" will reveal. */
const made = new Set<string>()
let nextId = 1

export const defaultRecordingsFolder = (): string => join(app.getPath('videos'), 'Orbit Recordings')

/** Only Orbit's own pages (not web pages in the browser tab) get the camera and screen. */
export function isAppPage(wc: WebContents | null | undefined): boolean {
  if (!wc) return false
  const url = wc.getURL()
  const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return url.startsWith('file://') || (!!dev && url.startsWith(dev))
}

async function sources(): Promise<StudioCaptureSource[]> {
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  return list
    .filter((s) => !own.has(s.id) || s.id.startsWith('screen:'))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() }))
}

export function setupStudio(): void {
  ipcMain.handle('studio:sources', (e) => (isAppPage(e.sender) ? sources() : []))

  ipcMain.handle('studio:access', async (_e, what: 'camera' | 'screen') => {
    if (!IS_MAC) return true
    if (what === 'camera') return systemPreferences.askForMediaAccess('camera')
    // macOS can't be asked for screen recording from code: it asks the first time you capture.
    return systemPreferences.getMediaAccessStatus('screen') !== 'denied'
  })

  ipcMain.handle('studio:defaultFolder', () => defaultRecordingsFolder())

  ipcMain.handle('studio:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: 'Save recordings in', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle('studio:start', (e, folder: string | null, ext: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    const dir = folder && isAbsolute(folder) ? folder : defaultRecordingsFolder()
    mkdirSync(dir, { recursive: true })
    if (!statSync(dir).isDirectory()) throw new Error('That recordings folder isn’t a folder.')
    let path = join(dir, recordingFileName(new Date(), ext === 'webm' ? 'webm' : 'mp4'))
    for (let n = 2; existsSync(path); n++) path = path.replace(/( \(\d+\))?\.(\w+)$/, ` (${n}).$2`)
    const out = createWriteStream(path)
    const id = nextId++
    const rec: Recording = { path, out }
    out.on('error', (err) => {
      rec.failed = err.message
      logError('studio recording', err)
    })
    recordings.set(id, rec)
    made.add(path)
    // Keep drawing and recording while the window is minimised or behind others.
    e.sender.setBackgroundThrottling(false)
    return { id, path }
  })

  ipcMain.handle('studio:chunk', (_e, id: number, data: Uint8Array) => {
    const rec = recordings.get(id)
    if (!rec) return { ok: false, error: 'That recording has stopped.' }
    if (rec.failed) return { ok: false, error: rec.failed }
    rec.out.write(Buffer.from(data))
    return { ok: true }
  })

  ipcMain.handle('studio:stop', async (e, id: number) => {
    const rec = recordings.get(id)
    recordings.delete(id)
    if (!recordings.size) e.sender.setBackgroundThrottling(true)
    if (!rec) return null
    await new Promise<void>((resolve) => rec.out.end(resolve))
    return rec.path
  })

  ipcMain.handle('studio:reveal', (_e, path: string) => {
    if (made.has(path) && existsSync(path)) shell.showItemInFolder(path)
    else void shell.openPath(defaultRecordingsFolder())
  })
  ipcMain.handle('studio:openFolder', (_e, folder: string | null) => {
    const dir = folder && isAbsolute(folder) && existsSync(folder) && statSync(folder).isDirectory() ? folder : defaultRecordingsFolder()
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
}
