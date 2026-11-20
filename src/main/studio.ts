import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell, systemPreferences, type WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, type WriteStream } from 'fs'
import { rm } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { IS_MAC } from '@shared/platform'
import { recordingFileName } from '@shared/studio'
import { cleanTrim, cutArgs, detectArgs, isRecordingExt, keepSegments, keptLength, parseSilences, trimmedPath, type TrimSettings } from '@shared/studioAudio'
import { ffmpegPath } from './ffmpeg'
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

/** The screens and other apps' windows you can capture (Orbit's own windows left out). */
export async function captureSources(): Promise<StudioCaptureSource[]> {
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  return list
    .filter((s) => !own.has(s.id) || s.id.startsWith('screen:'))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() }))
}

export function setupStudio(): void {
  ipcMain.handle('studio:sources', (e) => (isAppPage(e.sender) ? captureSources() : []))

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

  ipcMain.handle('studio:start', (e, folder: string | null, ext: string, kind?: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    const dir = folder && isAbsolute(folder) ? folder : defaultRecordingsFolder()
    mkdirSync(dir, { recursive: true })
    if (!statSync(dir).isDirectory()) throw new Error('That recordings folder isn’t a folder.')
    let path = join(dir, recordingFileName(new Date(), isRecordingExt(ext) ? ext : 'mp4', kind === 'voiceover' ? 'Voiceover' : 'Recording'))
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

  ipcMain.handle('studio:trim', async (e, path: string, settings: unknown) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    // Only the Studio's own recordings, never any other file on the computer.
    if (typeof path !== 'string' || !made.has(path) || !existsSync(path)) throw new Error('That recording isn’t there any more.')
    const out = trimmedPath(path)
    const res = await trimSilences(path, out, cleanTrim(settings))
    made.add(out)
    return { path: out, ...res }
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

const parseTime = (t: string): number => {
  const [h, m, sec] = t.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}

/** Runs ffmpeg once; resolves with what it printed and how far it got (seconds). */
function runFfmpeg(args: string[]): Promise<{ log: string; at: number }> {
  const binary = ffmpegPath()
  if (!existsSync(binary)) return Promise.reject(new Error('Download the sound and video converter first.'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-y', ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { windowsHide: true })
    let log = ''
    let at = 0
    child.stderr.on('data', (chunk: Buffer) => (log = (log + chunk.toString()).slice(-400_000)))
    child.stdout.on('data', (chunk: Buffer) => {
      for (const m of chunk.toString().matchAll(/out_time_us=(\d+)/g)) at = Math.max(at, Number(m[1]) / 1e6)
    })
    child.on('error', () => reject(new Error('The converter couldn’t start.')))
    child.on('close', (code) => {
      if (code === 0) return resolve({ log, at })
      logError('studio trim', new Error(log.split('\n').slice(-6).join('\n')))
      reject(new Error(/No space left/i.test(log) ? 'There’s no room left on this computer to save it.' : 'The silences couldn’t be trimmed from this recording.'))
    })
  })
}

/** Finds the long pauses, then saves a copy without them. Resolves with the length before and after, in seconds. */
async function trimSilences(input: string, output: string, settings: TrimSettings): Promise<{ before: number; after: number }> {
  const found = await runFfmpeg(detectArgs(input, settings))
  const d = /Duration: (\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(found.log)
  // Recordings written as they're made may not say how long they are: then how far ffmpeg read is used.
  const before = Math.max(found.at, d ? parseTime(d[1]) : 0)
  const segs = keepSegments(parseSilences(found.log, before), before, settings.keep)
  try {
    await runFfmpeg(cutArgs(input, output, segs))
  } catch (err) {
    await rm(output, { force: true })
    throw err
  }
  return { before, after: keptLength(segs) }
}
