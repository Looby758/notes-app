import { app, ipcMain, type WebContents } from 'electron'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, rmSync } from 'fs'
import { readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { partArgs } from '@shared/soundLink'
import { SOUND_MAX_BYTES } from '@shared/soundboard'
import { ffmpegPath } from './ffmpeg'
import { downloadSoundTo } from './videoDownload'
import { addSoundFile } from './soundboard'
import { isAppPage } from './studio'
import { logError } from './log'

/**
 * The soundboard's "From a link" (shared/soundLink.ts): the video downloader fetches just the
 * sound of a YouTube, TikTok… link into a temporary folder, the window shows it as a waveform to
 * pick the part from, and ffmpeg cuts that part into an MP3 that becomes a button. The download is
 * thrown away afterwards; only the button's own copy is kept (in the soundboard folder).
 */

interface Fetched {
  dir: string
  file: string
  title: string
}

const tempFolder = (): string => join(app.getPath('temp'), 'orbit-sound-links')
const fetched = new Map<string, Fetched>()
const cancels = new Map<string, () => void>()

/** A downloaded sound bigger than this isn't sent to the window (about an hour and a half of MP3). */
const MAX_SOURCE_BYTES = 150 * 1024 * 1024

async function fetchSound(sender: WebContents, id: string, link: string): Promise<{ title: string; bytes: Uint8Array; name: string }> {
  // Only one at a time: a new link replaces the one being picked from.
  for (const old of [...fetched.keys()]) forget(old)
  const dir = join(tempFolder(), id)
  const job = downloadSoundTo(link, dir, (done) => !sender.isDestroyed() && sender.send('soundLink:progress', id, done))
  cancels.set(id, job.cancel)
  try {
    const { file, title } = await job.done
    const size = (await stat(file)).size
    if (size > MAX_SOURCE_BYTES) throw new Error('That video is too long to pick a sound from. Try a shorter clip of it.')
    fetched.set(id, { dir, file, title })
    return { title, bytes: new Uint8Array(await readFile(file)), name: file.slice(dir.length + 1) }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  } finally {
    cancels.delete(id)
  }
}

function forget(id: string): void {
  cancels.get(id)?.()
  cancels.delete(id)
  const f = fetched.get(id)
  fetched.delete(id)
  if (f) void rm(f.dir, { recursive: true, force: true }).catch(() => undefined)
}

function runFfmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath()
  if (!existsSync(binary)) return Promise.reject(new Error('The video add-on (ffmpeg) isn’t downloaded yet.'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true })
    let log = ''
    child.stderr.on('data', (chunk: Buffer) => (log = (log + chunk.toString()).slice(-4000)))
    child.on('error', () => reject(new Error('The video add-on (ffmpeg) couldn’t start.')))
    child.on('close', (code) => {
      if (code === 0) return resolve()
      logError('sound from a link ffmpeg', new Error(log.split('\n').slice(-6).join('\n')))
      reject(new Error('The sound couldn’t be cut.'))
    })
  })
}

/** Cuts the picked part into an MP3 and adds it to the board as a button. */
async function makeButton(id: string, start: number, end: number, name: string): Promise<ReturnType<typeof addSoundFile>> {
  const f = fetched.get(id)
  if (!f || !existsSync(f.file)) throw new Error('That sound isn’t downloaded any more. Paste the link again.')
  const s = Math.max(0, Number(start) || 0)
  const e = Math.max(s + 0.1, Number(end) || 0)
  const out = join(f.dir, `${randomUUID().slice(0, 8)}.mp3`)
  try {
    await runFfmpeg(partArgs(f.file, s, e, out))
    if ((await stat(out)).size > SOUND_MAX_BYTES) throw new Error('That part is too long for a button. Pick a shorter part.')
    const res = addSoundFile(out, String(name ?? '').trim() || f.title)
    if (res.skipped.length) throw new Error(`It couldn’t be added: ${res.skipped.join(', ')}`)
    return res
  } finally {
    await rm(out, { force: true }).catch(() => undefined)
  }
}

export function setupSoundFromLink(): void {
  ipcMain.handle('soundLink:fetch', (e, id: string, link: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    if (typeof id !== 'string' || !/^[\w-]{4,40}$/.test(id)) throw new Error('Not allowed')
    return fetchSound(e.sender, id, String(link ?? ''))
  })
  ipcMain.handle('soundLink:make', (e, id: string, start: number, end: number, name: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    return makeButton(String(id), start, end, name)
  })
  ipcMain.handle('soundLink:forget', (_e, id: string) => forget(String(id)))
  try {
    rmSync(tempFolder(), { recursive: true, force: true })
  } catch {
    // Still in use; the system clears its temporary folder anyway.
  }
  app.on('will-quit', () => {
    for (const id of [...fetched.keys(), ...cancels.keys()]) forget(id)
  })
}
