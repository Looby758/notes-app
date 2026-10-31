import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { mkdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import type { ConvertedFile, VideoConvertRequest } from '@shared/types'
import { parseTime, videoArgs } from './videoArgs'

/**
 * The file converter's jobs here: reading iPhone photos (HEIC), and videos, which go through the
 * ffmpeg program that comes with the app. The HEIC decoder is loaded the first time it's needed,
 * so it costs nothing until then. Everything else converts in the window.
 */

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void
  free(): void
}
interface Libheif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
}

let libheif: Promise<Libheif> | null = null

async function decodeHeic(data: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => (m.default as () => Libheif)())
  const images = new (await libheif).HeifDecoder().decode(new Uint8Array(data))
  // A HEIC can hold several pictures (bursts, depth maps); the main one is the photo.
  const image = images.find((i) => i.is_primary()) ?? images[0]
  if (!image) throw new Error('This doesn’t look like a HEIC photo.')
  try {
    const width = image.get_width()
    const height = image.get_height()
    const pixels = new Uint8ClampedArray(width * height * 4)
    await new Promise<void>((resolve, reject) =>
      image.display({ data: pixels, width, height }, (result) => (result ? resolve() : reject(new Error('The photo couldn’t be read.'))))
    )
    return { width, height, data: new Uint8Array(pixels.buffer) }
  } finally {
    for (const i of images) i.free()
  }
}

// ---- Videos ----

/** The ffmpeg program bundled with the app (unpacked from the app's archive so it can run). */
function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = (require('ffmpeg-static') as string | null) ?? ''
  return path.replace('app.asar', 'app.asar.unpacked')
}

/** Puts ffmpeg's last few error lines into plain words. */
function explain(log: string): string {
  if (/Invalid data found|could not find codec|moov atom not found/i.test(log)) return 'This video couldn’t be read. It may be damaged, or not finished copying.'
  if (/does not contain any stream|matches no streams|Output file .* does not contain/i.test(log)) return 'This video has no sound to take out.'
  if (/No space left/i.test(log)) return 'There’s no room left on this computer to save the converted video.'
  return 'This video couldn’t be converted.'
}

const tempFolder = (): string => join(app.getPath('temp'), 'orbit-converted')
/** Finished videos waiting to be saved, by their job id. */
const finished = new Map<string, string>()
const running = new Map<number, ChildProcess>()

/** The temporary file for a converted video, for saving it (null if it's gone). */
export function convertedPath(file: ConvertedFile): string | null {
  const path = finished.get(file.converted)
  return path && existsSync(path) ? path : null
}

async function convertVideo(send: (id: number, done: number) => void, req: VideoConvertRequest): Promise<ConvertedFile> {
  if (!req.path || !existsSync(req.path)) throw new Error('This video couldn’t be found on this computer. Save it to a folder first, then add it again.')
  const binary = ffmpegPath()
  if (!binary || !existsSync(binary)) throw new Error('The video converter is missing from this copy of Orbit. Reinstalling Orbit should fix it.')
  await mkdir(tempFolder(), { recursive: true })
  const out = join(tempFolder(), `${process.pid}-${req.id}-${Date.now()}.${req.format}`)
  const args = ['-hide_banner', '-nostdin', '-y', '-i', req.path, ...videoArgs(req.format, req.maxHeight), '-progress', 'pipe:1', '-nostats', out]
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true })
    running.set(req.id, child)
    let duration: number | null = null
    let log = ''
    child.stderr.on('data', (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-8000)
      if (duration === null) {
        const m = /Duration: (\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(log)
        if (m) duration = parseTime(m[1])
      }
    })
    child.stdout.on('data', (chunk: Buffer) => {
      const m = /out_time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(chunk.toString())
      const at = m && parseTime(m[1])
      if (at !== null && at !== undefined && duration) send(req.id, Math.min(0.99, at / duration))
    })
    child.on('error', () => {
      running.delete(req.id)
      reject(new Error('The video converter couldn’t start.'))
    })
    child.on('close', async (code, signal) => {
      const cancelled = running.get(req.id) !== child
      running.delete(req.id)
      if (code !== 0 || cancelled) {
        await rm(out, { force: true })
        return reject(new Error(cancelled || signal ? 'Stopped.' : explain(log)))
      }
      const token = String(req.id)
      const old = finished.get(token)
      if (old && old !== out) await rm(old, { force: true })
      finished.set(token, out)
      resolve({ converted: token, size: (await stat(out)).size })
    })
  })
}

async function cancelVideo(id: number): Promise<void> {
  const child = running.get(id)
  if (child) {
    running.delete(id)
    child.kill()
  }
  const path = finished.get(String(id))
  finished.delete(String(id))
  if (path) await rm(path, { force: true })
}

/** Converted videos are kept only until Orbit closes. */
function clearTemp(): void {
  for (const child of running.values()) child.kill()
  try {
    rmSync(tempFolder(), { recursive: true, force: true })
  } catch {
    // Still in use; the system clears its temporary folder anyway.
  }
}

export function setupConverter(): void {
  ipcMain.handle('convert:heic', (_e, data: Uint8Array) => decodeHeic(data))
  ipcMain.handle('convert:video', (e, req: VideoConvertRequest) =>
    convertVideo((id, done) => !e.sender.isDestroyed() && e.sender.send('convert:video-progress', id, done), req)
  )
  ipcMain.handle('convert:video-cancel', (_e, id: number) => cancelVideo(id))
  clearTemp()
  app.on('will-quit', clearTemp)
}
