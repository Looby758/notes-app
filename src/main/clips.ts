import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, net, Notification, safeStorage, screen, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { Readable } from 'stream'
import { acceleratorLabel, SYSTEM_NAME } from '@shared/platform'
import {
  clipArgs,
  clipFileName,
  clipLength,
  cleanWebhookUrl,
  concatList,
  DISCORD_LIMIT,
  discordPayload,
  isClipFile,
  parseRange,
  type ClipExport,
  type DiscordHook
} from '@shared/clips'
import type { ClipInfo } from '@shared/types'
import { ffmpegPath } from './ffmpeg'
import { parseTime } from './videoArgs'
import { defaultRecordingsFolder, isAppPage } from './studio'
import { logError } from './log'

/**
 * Instant replay and the clip editor, main-process side. The renderer keeps the replay buffer
 * (lib/replay.ts); here the system-wide key is listened for, the buffer's pieces are joined into
 * one video with ffmpeg (no re-encoding, so it takes a moment even mid-game), clips are trimmed
 * and captioned, and sent to Discord through a webhook you saved.
 *
 * Only videos in the recordings folder (the Studio's) can be read, played, changed or sent.
 */

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
}
let hooks: Hooks
let registered = ''
let shortcutError: string | undefined
/** The recordings folder the clip editor last listed; vault://clips/<name> plays from it. */
let clipsFolder = ''

const folderOf = (folder: unknown): string => (typeof folder === 'string' && folder && isAbsolute(folder) ? resolve(folder) : defaultRecordingsFolder())

/** A video in the recordings folder, or an error: nothing outside it is touched. */
function clipPath(folder: unknown, path: unknown): string {
  const dir = folderOf(folder)
  const full = typeof path === 'string' ? resolve(path) : ''
  if (!full || dirname(full) !== dir || !isClipFile(basename(full)) || !existsSync(full)) throw new Error('That video isn’t in your recordings folder any more.')
  return full
}

/** For vault://clips/<name>: a video in the folder the clip editor is showing. */
export function clipFile(name: string): string | null {
  if (!clipsFolder || !name || name.includes('/') || name.includes('\\') || !isClipFile(name)) return null
  const full = join(clipsFolder, name)
  return existsSync(full) ? full : null
}

const VIDEO_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }

/**
 * Serves vault://clips/<name>, answering "Range" requests itself so the player can jump to any
 * moment (dragging the trim handles). Readable by the page (CORS), so a frame can be the picture
 * when dragging a clip out.
 */
export function clipResponse(request: Request, name: string): Response {
  const full = clipFile(name)
  if (!full) return new Response('Not allowed', { status: 403 })
  const size = statSync(full).size
  const range = parseRange(request.headers.get('Range'), size)
  const headers = new Headers({
    'Content-Type': VIDEO_TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  })
  if (range === 'bad') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  headers.set('Content-Length', String(end - start + 1))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const body = size ? (Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream) : null
  return new Response(body, { status: range ? 206 : 200, headers })
}

/** A free file name in a folder: "Clip … (2).mp4" when "Clip ….mp4" is taken. */
function freeName(dir: string, name: string): string {
  let path = join(dir, name)
  for (let n = 2; existsSync(path); n++) path = join(dir, name.replace(/(\.\w+)$/, ` (${n})$1`))
  return path
}

// ---------- the shortcut ----------

/** (Re)registers the system-wide "save replay" shortcut ('' = none, e.g. while replay is off). */
export function applyReplayShortcut(accel: string): void {
  if (registered === accel) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  shortcutError = undefined
  if (!accel) return
  try {
    if (globalShortcut.register(accel, saveReplayNow)) registered = accel
    else shortcutError = `${acceleratorLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick a different shortcut.`
  } catch {
    shortcutError = `${acceleratorLabel(accel)} can't be used as a shortcut.`
  }
}

/** Asks the main window (which holds the replay buffer) to save it. */
function saveReplayNow(): void {
  const main = hooks?.getMain()
  if (main && !main.isDestroyed()) main.webContents.send('replay:save')
}

// ---------- ffmpeg ----------

let running: ChildProcess | null = null

/** Runs ffmpeg; `length` (seconds) turns its progress into 0–1. */
function runFfmpeg(args: string[], length: number | null, onProgress?: (done: number) => void): Promise<void> {
  const binary = ffmpegPath()
  if (!existsSync(binary)) return Promise.reject(new Error('Download the video add-on (ffmpeg) first: Settings → Studio.'))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-y', ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { windowsHide: true })
    running = child
    let log = ''
    child.stderr.on('data', (chunk: Buffer) => (log = (log + chunk.toString()).slice(-6000)))
    child.stdout.on('data', (chunk: Buffer) => {
      const m = /out_time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(chunk.toString())
      const at = m && parseTime(m[1])
      if (at && length && onProgress) onProgress(Math.min(0.99, at / length))
    })
    child.on('error', () => reject(new Error('The video add-on (ffmpeg) couldn’t start.')))
    child.on('close', (code, signal) => {
      const cancelled = running !== child
      if (running === child) running = null
      if (code === 0 && !cancelled) return resolvePromise()
      if (!cancelled && !signal) logError('clips ffmpeg', new Error(log.split('\n').slice(-6).join('\n')))
      reject(new Error(cancelled || signal ? 'Stopped.' : /No space left/i.test(log) ? 'There’s no room left on this computer to save it.' : 'The video couldn’t be made.'))
    })
  })
}

// ---------- saving a replay ----------

const tempFolder = (): string => join(app.getPath('temp'), 'orbit-replay')

/**
 * Joins the newest pieces of a buffer into one file in the recordings folder. `kind` 'call' is the
 * Discord voice pop-out's clip button: the same pieces-and-join, but of the call's sound only.
 */
async function saveReplay(folder: unknown, parts: Uint8Array[], ext: string, seconds: number, kind: 'replay' | 'call' = 'replay'): Promise<string> {
  if (!Array.isArray(parts) || !parts.length) throw new Error('There’s nothing recorded yet. Give it a few seconds.')
  const type = ext === 'webm' ? 'webm' : 'mp4'
  const dir = folderOf(folder)
  await mkdir(dir, { recursive: true })
  const out = freeName(dir, clipFileName(kind === 'call' ? 'Call clip' : 'Replay', new Date(), type))
  if (parts.length === 1) {
    // One piece is already a whole video.
    await writeFile(out, Buffer.from(parts[0]))
  } else {
    const work = join(tempFolder(), randomUUID())
    await mkdir(work, { recursive: true })
    try {
      const files: string[] = []
      for (const [i, part] of parts.entries()) {
        const file = join(work, `part-${i}.${type}`)
        await writeFile(file, Buffer.from(part))
        files.push(file)
      }
      const list = join(work, 'list.txt')
      await writeFile(list, concatList(files))
      // The pieces each start on a keyframe, so they're joined as they are: no re-encoding.
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(type === 'mp4' ? ['-movflags', '+faststart'] : []), out], null)
    } catch (err) {
      await rm(out, { force: true })
      throw err
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }
  tellSaved(out, seconds, kind)
  return out
}

const shown = new Set<Notification>()

/** A system notification (you're probably in a game): click it to edit the clip. */
function tellSaved(path: string, seconds: number, kind: 'replay' | 'call'): void {
  if (!Notification.isSupported()) return
  const n =
    kind === 'call'
      ? new Notification({ title: 'Call clip saved', body: `The last ${seconds} seconds of the call. Click to see it in Clips.`, silent: true })
      : new Notification({ title: 'Replay saved', body: `The last ${seconds} seconds. Click to trim it, add a caption or send it to Discord.`, silent: true })
  n.on('click', () => {
    hooks.showMain()
    hooks.getMain()?.webContents.send('clips:open', path)
  })
  n.on('close', () => shown.delete(n))
  shown.add(n)
  n.show()
}

// ---------- the clip editor ----------

async function listClips(folder: unknown): Promise<ClipInfo[]> {
  const dir = folderOf(folder)
  clipsFolder = dir
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const clips: ClipInfo[] = []
  for (const name of names.filter(isClipFile)) {
    try {
      const s = await stat(join(dir, name))
      if (s.isFile()) clips.push({ name, path: join(dir, name), size: s.size, modified: s.mtimeMs })
    } catch {
      // Gone while listing.
    }
  }
  return clips.sort((a, b) => b.modified - a.modified).slice(0, 300)
}

async function exportClip(folder: unknown, req: ClipExport, onProgress: (done: number) => void): Promise<{ path: string; size: number }> {
  const input = clipPath(folder, req.path)
  const dir = dirname(input)
  const work = join(tempFolder(), randomUUID())
  await mkdir(work, { recursive: true })
  const out = freeName(dir, clipFileName('Clip', new Date(), 'mp4'))
  try {
    let caption: string | null = null
    if (req.captionPng && req.captionPng.length) {
      caption = join(work, 'caption.png')
      await writeFile(caption, Buffer.from(req.captionPng))
    }
    const clip = { start: Number(req.start) || 0, end: Number(req.end) || 0, captionPosition: req.captionPosition === 'top' ? 'top' : 'bottom', forDiscord: !!req.forDiscord } as const
    const length = clipLength(clip)
    await runFfmpeg([...clipArgs(input, clip, caption), out], length, onProgress)
    // A clip for Discord that still came out too big is made again with fewer bits.
    if (clip.forDiscord && (await stat(out)).size > DISCORD_LIMIT) {
      await runFfmpeg([...clipArgs(input, clip, caption, 0.75), out], length, onProgress)
    }
    return { path: out, size: (await stat(out)).size }
  } catch (err) {
    await rm(out, { force: true })
    throw err
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

// ---------- Discord ----------

interface SavedHook extends DiscordHook {
  /** The webhook address, encrypted with safeStorage (base64). */
  enc: string
}
const hooksFile = (): string => join(app.getPath('userData'), 'discord-webhooks.json')

function loadHooks(): SavedHook[] {
  try {
    const raw = JSON.parse(readFileSync(hooksFile(), 'utf8')) as unknown
    return Array.isArray(raw) ? raw.filter((h): h is SavedHook => !!h && typeof h.id === 'string' && typeof h.name === 'string' && typeof h.enc === 'string') : []
  } catch {
    return []
  }
}
function saveHooks(list: SavedHook[]): void {
  mkdirSync(dirname(hooksFile()), { recursive: true })
  writeFileSync(hooksFile(), JSON.stringify(list, null, 2))
}
const publicHooks = (): DiscordHook[] => loadHooks().map(({ id, name }) => ({ id, name }))

function addHook(name: unknown, url: unknown): DiscordHook[] {
  const clean = cleanWebhookUrl(String(url ?? ''))
  if (!clean) throw new Error('That isn’t a Discord webhook link. It starts with https://discord.com/api/webhooks/')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the link securely, so it wasn’t saved.')
  const label = String(name ?? '').trim().slice(0, 60) || 'Discord'
  const list = loadHooks()
  list.push({ id: randomUUID(), name: label, enc: safeStorage.encryptString(clean).toString('base64') })
  saveHooks(list)
  return publicHooks()
}

function removeHook(id: unknown): DiscordHook[] {
  saveHooks(loadHooks().filter((h) => h.id !== id))
  return publicHooks()
}

async function sendToDiscord(folder: unknown, hookId: unknown, path: unknown, message: unknown): Promise<void> {
  const hook = loadHooks().find((h) => h.id === hookId)
  if (!hook) throw new Error('That Discord channel isn’t saved any more.')
  const url = cleanWebhookUrl(safeStorage.decryptString(Buffer.from(hook.enc, 'base64')))
  if (!url) throw new Error('That Discord link is damaged. Remove it and add it again.')
  const file = clipPath(folder, path)
  const size = statSync(file).size
  if (size > DISCORD_LIMIT) throw new Error('This video is too big for Discord (10 MB at most). Use “Make it fit Discord” first.')
  const data = await readFile(file)
  const boundary = `----orbit${randomUUID().replace(/-/g, '')}`
  // Plain letters only in the name Discord shows, so the form can't be broken by it.
  const name = basename(file).replace(/[^\w .()-]/g, '_')
  const type = name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${discordPayload(String(message ?? ''))}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  const res = await net.fetch(`${url}?wait=true`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body })
  if (res.ok) return
  if (res.status === 413) throw new Error('Discord said the video is too big for that channel. Use “Make it fit Discord” first.')
  if (res.status === 404 || res.status === 401) throw new Error('That webhook was deleted in Discord. Remove it here and add a new one.')
  if (res.status === 429) throw new Error('Discord says to slow down. Try again in a minute.')
  throw new Error(`Discord didn’t take it (${res.status}).`)
}

// ---------- setup ----------

export function setupClips(h: Hooks): void {
  hooks = h
  const guard = (sender: Electron.WebContents): void => {
    if (!isAppPage(sender)) throw new Error('Not allowed')
  }

  ipcMain.handle('replay:status', () => ({ shortcut: registered ? acceleratorLabel(registered) : '', error: shortcutError }))
  ipcMain.handle('replay:saveNow', () => saveReplayNow())
  // The main screen's capture id: that's the screen a replay records.
  ipcMain.handle('replay:screen', async (e) => {
    guard(e.sender)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    const primary = String(screen.getPrimaryDisplay().id)
    return (sources.find((s) => s.display_id === primary) ?? sources[0])?.id ?? null
  })
  // While the buffer runs, keep it running with the window hidden or behind a game.
  ipcMain.handle('replay:running', (e, on: boolean) => {
    if (isAppPage(e.sender)) e.sender.setBackgroundThrottling(!on)
  })
  ipcMain.handle('replay:save', (e, folder: string | null, parts: Uint8Array[], ext: string, seconds: number, kind?: string) => {
    guard(e.sender)
    return saveReplay(folder, parts, ext, Math.round(Number(seconds) || 30), kind === 'call' ? 'call' : 'replay')
  })

  ipcMain.handle('clips:list', (e, folder: string | null) => {
    guard(e.sender)
    return listClips(folder)
  })
  ipcMain.handle('clips:export', (e, folder: string | null, req: ClipExport) => {
    guard(e.sender)
    return exportClip(folder, req, (done) => !e.sender.isDestroyed() && e.sender.send('clips:progress', done))
  })
  ipcMain.handle('clips:cancel', () => {
    const child = running
    running = null
    child?.kill()
  })
  ipcMain.handle('clips:trash', async (e, folder: string | null, path: string) => {
    guard(e.sender)
    await shell.trashItem(clipPath(folder, path))
  })
  ipcMain.handle('clips:reveal', (e, folder: string | null, path: string) => {
    guard(e.sender)
    shell.showItemInFolder(clipPath(folder, path))
  })
  // Drag a clip out of Orbit into Discord (or anywhere that takes files).
  ipcMain.on('clips:drag', (e, folder: string | null, path: string, icon: string) => {
    try {
      if (!isAppPage(e.sender)) return
      const file = clipPath(folder, path)
      let image = typeof icon === 'string' && icon.startsWith('data:image/') ? nativeImage.createFromDataURL(icon) : nativeImage.createEmpty()
      if (image.isEmpty()) image = nativeImage.createFromDataURL(BLANK_ICON)
      e.sender.startDrag({ file, icon: image })
    } catch (err) {
      logError('clip drag', err)
    }
  })

  ipcMain.handle('discord:hooks', () => publicHooks())
  ipcMain.handle('discord:addHook', (e, name: string, url: string) => {
    guard(e.sender)
    return addHook(name, url)
  })
  ipcMain.handle('discord:removeHook', (e, id: string) => {
    guard(e.sender)
    return removeHook(id)
  })
  ipcMain.handle('discord:send', (e, folder: string | null, hookId: string, path: string, message: string) => {
    guard(e.sender)
    return sendToDiscord(folder, hookId, path, message)
  })

  try {
    rmSync(tempFolder(), { recursive: true, force: true })
  } catch {
    // Still in use; the system clears its temporary folder anyway.
  }
  app.on('will-quit', () => running?.kill())
}

/** A small film-strip square, for dragging when there's no picture of the clip yet. */
const BLANK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAARElEQVR42mOISP30fyAxw6BygJy8BhzTS3zUAaMOGDwOQJakBx51wKgDRh0w6oBRB4w6YNQBg88Boy2iUQeMOmDE9o4B4gCO4quc/NkAAAAASUVORK5CYII='
