import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell, systemPreferences, type WebContents } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, type WriteStream } from 'fs'
import { readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'
import { IS_MAC } from '@shared/platform'
import { recordingFileName } from '@shared/studio'
import { cleanTrim, cleanedPath, cutArgs, detectArgs, isRecordingExt, keepSegments, keptLength, parseSilences, type TrimSettings } from '@shared/studioAudio'
import { isTakePath, joinArgs, joinedFileName, takeFileName, takesFolderName, type JoinPart } from '@shared/takes'
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

  ipcMain.handle('studio:start', (e, folder: string | null, ext: string, kind?: string, take?: { script?: unknown; index?: unknown; title?: unknown }) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    const base = folder && isAbsolute(folder) ? folder : defaultRecordingsFolder()
    const safeExt = isRecordingExt(ext) ? ext : 'mp4'
    // A take of one section: "<script> sections/02 The prison - take 3.m4a".
    const isTake = kind === 'take' && !!take && typeof take.script === 'string' && typeof take.title === 'string' && Number.isInteger(take.index)
    const dir = isTake ? join(base, takesFolderName(take.script as string)) : base
    mkdirSync(dir, { recursive: true })
    if (!statSync(dir).isDirectory()) throw new Error('That recordings folder isn’t a folder.')
    let path: string
    if (isTake) {
      const index = Math.max(0, Math.min(998, take.index as number))
      let n = 1
      while (existsSync(join(dir, takeFileName(index, take.title as string, n, safeExt)))) n++
      path = join(dir, takeFileName(index, take.title as string, n, safeExt))
    } else {
      path = join(dir, recordingFileName(new Date(), safeExt, kind === 'voiceover' ? 'Voiceover' : 'Recording'))
      for (let n = 2; existsSync(path); n++) path = path.replace(/( \(\d+\))?\.(\w+)$/, ` (${n}).$2`)
    }
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
    const t = cleanTrim(settings)
    const out = cleanedPath(path, t)
    const res = await trimSilences(path, out, t)
    made.add(out)
    return { path: out, ...res }
  })

  // The teleprompter's cue times for a recording, saved beside it (read by the shot list).
  ipcMain.handle('studio:writeCues', async (e, path: string, json: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    if (typeof path !== 'string' || !made.has(path) || typeof json !== 'string' || json.length > 5_000_000) throw new Error('That recording isn’t there any more.')
    JSON.parse(json)
    await writeFile(`${path}.cues.json`, json, 'utf8')
  })

  // A take's sound, to listen back to while you pick the best one.
  ipcMain.handle('studio:readTake', async (e, path: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    if (!ownTake(path)) throw new Error('That take isn’t there any more.')
    if ((await stat(path)).size > 300_000_000) throw new Error('That take is too long to play here.')
    return new Uint8Array(await readFile(path))
  })

  // Joins the takes you picked, in order, into one WAV beside them.
  ipcMain.handle('studio:joinTakes', async (e, parts: unknown, script: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    if (!Array.isArray(parts) || !parts.length || parts.length > 500 || typeof script !== 'string') throw new Error('There are no takes to join.')
    const clean: JoinPart[] = parts.map((p: Partial<JoinPart>) => {
      if (!p || typeof p.path !== 'string' || !ownTake(p.path)) throw new Error('One of the takes isn’t there any more. Record it again, or pick another take.')
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(36_000, v)) : 0)
      return { path: p.path, from: num(p.from), length: num(p.length) }
    })
    const dir = dirname(clean[0].path)
    let n = 1
    while (existsSync(join(dir, joinedFileName(script, n)))) n++
    const out = join(dir, joinedFileName(script, n))
    try {
      const res = await runFfmpeg(joinArgs(clean, out), 'The takes couldn’t be joined.')
      made.add(out)
      return { path: out, length: res.at }
    } catch (err) {
      await rm(out, { force: true })
      throw err
    }
  })

  ipcMain.handle('studio:reveal', (_e, path: string) => {
    if ((made.has(path) || ownTake(path)) && existsSync(path)) shell.showItemInFolder(path)
    else void shell.openPath(defaultRecordingsFolder())
  })
  ipcMain.handle('studio:openFolder', (_e, folder: string | null) => {
    const dir = folder && isAbsolute(folder) && existsSync(folder) && statSync(folder).isDirectory() ? folder : defaultRecordingsFolder()
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
}

/** A take the Studio recorded (this session, or an earlier one: then known by its name and folder). */
function ownTake(path: unknown): path is string {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) return false
  return made.has(path) || (isTakePath(path) && basename(dirname(path)).endsWith(' sections'))
}

const parseTime = (t: string): number => {
  const [h, m, sec] = t.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}

/** Runs ffmpeg once; resolves with what it printed and how far it got (seconds). */
function runFfmpeg(args: string[], failed = 'This recording couldn’t be cleaned up.'): Promise<{ log: string; at: number }> {
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
      reject(new Error(/No space left/i.test(log) ? 'There’s no room left on this computer to save it.' : failed))
    })
  })
}

/**
 * Finds the long pauses, then saves a cleaned copy without them (mouth clicks, hiss and loudness
 * too, as the settings say). Resolves with the length before and after, in seconds.
 */
async function trimSilences(input: string, output: string, settings: TrimSettings): Promise<{ before: number; after: number }> {
  const found = await runFfmpeg(detectArgs(input, settings))
  const d = /Duration: (\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(found.log)
  // Recordings written as they're made may not say how long they are: then how far ffmpeg read is used.
  const before = Math.max(found.at, d ? parseTime(d[1]) : 0)
  const segs = settings.pauses ? keepSegments(parseSilences(found.log, before), before, settings.keep) : null
  try {
    await runFfmpeg(cutArgs(input, output, segs, settings))
  } catch (err) {
    await rm(output, { force: true })
    throw err
  }
  return { before, after: segs ? keptLength(segs) : before }
}
