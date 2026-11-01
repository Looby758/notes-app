import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { Readable } from 'stream'
import { onRelease, releaseFiles, serveFile } from './fileLocks'
import {
  SUBTITLE_EXTS,
  VIDEO_EXTS,
  isSubtitleFile,
  isVideoFile,
  keyframeArgs,
  matchingSubtitles,
  parseKeyframe,
  parseProbe,
  streamArgs,
  subtitleArgs,
  type VideoInfo
} from '@shared/videoPlayer'
import { ffmpegPath } from './ffmpeg'
import { isAppPage } from './studio'
import { logError } from './log'

/**
 * The video player's main-process side (the page is components/Video, the thinking is
 * shared/video.ts). It reads what's in a video with ffmpeg, serves files the window can play as
 * they are (vault://video/…), streams the rest through ffmpeg as it plays (vault://videostream/…),
 * and reads subtitles: files beside the video, ones you pick, and ones inside the video itself.
 */

/** Largest subtitle file read (real ones are well under 1 MB). */
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024

function videoPath(path: unknown): string {
  if (typeof path !== 'string' || !isAbsolute(path) || !isVideoFile(path)) throw new Error('That isn’t a video file.')
  const full = resolve(path)
  if (!existsSync(full)) throw new Error('This video isn’t there any more. It may have been moved or deleted.')
  return full
}

const hasFfmpeg = (): boolean => existsSync(ffmpegPath())

/** ffmpeg runs reading a video (looking inside it, reading its subtitles), by the video they read. */
const reads = new Map<ChildProcess, string>()

/** Runs ffmpeg on `file` to the end and gives back what it wrote (stdout) and said (stderr). */
function runFfmpeg(file: string, args: string[], timeoutMs = 20_000, maxBytes = 32 * 1024 * 1024): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((done) => {
    const child = execFile(ffmpegPath(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: maxBytes, encoding: 'utf8' }, (error, out, err) => {
      reads.delete(child)
      done({ out: String(out ?? ''), err: String(err ?? ''), code: error ? ((error as { code?: number }).code ?? 1) : 0 })
    })
    reads.set(child, file)
  })
}

/** Subtitle files usually come from Windows: UTF-8, UTF-16, or old Windows-1252. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

async function info(path: string): Promise<VideoInfo> {
  const full = videoPath(path)
  const size = (await stat(full)).size
  const siblings = await readdir(dirname(full)).catch(() => [] as string[])
  const subtitleFiles = matchingSubtitles(basename(full), siblings).map((n) => join(dirname(full), n))
  let probe = null
  if (hasFfmpeg()) {
    // With no output named, ffmpeg describes the file and stops (with an error code, which is fine).
    const { err } = await runFfmpeg(full, ['-hide_banner', '-nostdin', '-i', full], 15_000)
    probe = parseProbe(err)
  }
  return { path: full, name: basename(full), size, probe, subtitleFiles }
}

async function subtitles(path: string, source: { stream?: number; file?: string }): Promise<string> {
  if (typeof source?.file === 'string') {
    const file = resolve(source.file)
    if (!isAbsolute(source.file) || !isSubtitleFile(file)) throw new Error('That isn’t a subtitle file.')
    if (statSync(file).size > MAX_SUBTITLE_BYTES) throw new Error('That subtitle file is too big.')
    return decodeText(await readFile(file))
  }
  const full = videoPath(path)
  if (!hasFfmpeg()) throw new Error('Download the video helper first to use the video’s own subtitles.')
  const stream = Math.floor(Number(source?.stream))
  if (!Number.isFinite(stream) || stream < 0) throw new Error('That subtitle track isn’t in this video.')
  // Reading them means reading through the whole file, which takes a few seconds for a film.
  const { out, err, code } = await runFfmpeg(full, subtitleArgs(full, stream), 120_000)
  if (code !== 0 && !out) {
    logError('video subtitles', err.slice(-500))
    throw new Error('Those subtitles couldn’t be read.')
  }
  return out
}

/** Where a copied (remuxed) stream from `at` really starts: the keyframe just before. */
async function keyframe(path: string, at: number, fileStart: number): Promise<number> {
  const full = videoPath(path)
  if (!hasFfmpeg() || !(at > 0)) return Math.max(0, at || 0)
  const { out } = await runFfmpeg(full, keyframeArgs(full, at), 10_000)
  const k = parseKeyframe(out)
  return k === null ? at : Math.max(0, Math.min(at, k - (Number(fileStart) || 0)))
}

// ---------- serving ----------

/** Live ffmpeg streams, by the page's session id: a new one replaces the old (after a seek). */
const streams = new Map<string, { child: ChildProcess; file: string }>()

/** Waits (briefly) for ffmpeg to really be gone, so the video it was reading is free. */
function ended(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => {
    const t = setTimeout(done, 1500)
    child.once('exit', () => (clearTimeout(t), done()))
  })
}

function stopStream(session: string): Promise<void> {
  const s = streams.get(session)
  if (!s) return Promise.resolve()
  streams.delete(session)
  s.child.kill()
  return ended(s.child)
}

// Closing the player, or deleting or moving the video in Orbit, stops everything reading it.
onRelease(async (test) => {
  const stopping: Promise<void>[] = []
  for (const [session, s] of streams) if (test(s.file)) stopping.push(stopStream(session))
  for (const [child, file] of reads) {
    if (!test(file)) continue
    reads.delete(child)
    child.kill()
    stopping.push(ended(child))
  }
  await Promise.all(stopping)
})

/** The file itself, in pieces as the window asks for them (that's what lets it jump around a film). */
export const fileResponse = (full: string, range: string | null): Response => serveFile(full, range)

/** Answers vault://video/… and vault://videostream/… for the window. */
export async function videoResponse(url: URL, request: Request): Promise<Response> {
  let full: string
  try {
    full = videoPath(decodeURIComponent(url.pathname.slice(1)))
  } catch {
    return new Response('Not allowed', { status: 403 })
  }
  if (url.host === 'video') return fileResponse(full, request.headers.get('range'))

  if (!hasFfmpeg()) return new Response('The video helper isn’t downloaded', { status: 503 })
  const mode = url.searchParams.get('mode') === 'remux' ? 'remux' : 'transcode'
  const start = Number(url.searchParams.get('start')) || 0
  const audio = Number(url.searchParams.get('audio')) || 0
  const session = url.searchParams.get('s') || 'default'
  void stopStream(session)
  const child = spawn(ffmpegPath(), streamArgs(full, { mode, start, audio }), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  streams.set(session, { child, file: full })
  let log = ''
  child.stderr.on('data', (chunk: Buffer) => (log = (log + chunk.toString()).slice(-4000)))
  child.on('close', (code, signal) => {
    if (streams.get(session)?.child === child) streams.delete(session)
    if (code && !signal && log) logError('video stream', log.slice(-600))
  })
  child.on('error', (err) => logError('video stream', err))
  const body = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' } })
}

function stopAll(): void {
  for (const s of streams.values()) s.child.kill()
  streams.clear()
  for (const child of reads.keys()) child.kill()
  reads.clear()
}

export function setupVideoPlayer(vaultRoot: () => string | null): void {
  ipcMain.handle('video:info', (_e, path: string) => info(path))
  ipcMain.handle('video:subtitles', (_e, path: string, source: { stream?: number; file?: string }) => subtitles(path, source))
  ipcMain.handle('video:keyframe', (_e, path: string, at: number, fileStart: number) => keyframe(path, Number(at), Number(fileStart)))
  ipcMain.handle('video:stop', (_e, session: string) => stopStream(String(session)))
  // The player closed (or moved on to another video): let go of this one completely.
  ipcMain.handle('video:release', (_e, path: unknown) => (typeof path === 'string' && isAbsolute(path) ? releaseFiles(path) : undefined))
  // A file in the notes folder, by its path in there.
  ipcMain.handle('video:inVault', (_e, rel: string) => {
    const root = vaultRoot()
    if (!root || typeof rel !== 'string') throw new Error('Open a notes folder first.')
    const full = resolve(root, rel)
    const rel2 = relative(resolve(root), full)
    if (!rel2 || rel2.startsWith('..') || isAbsolute(rel2)) throw new Error('That file isn’t in your notes folder.')
    return full
  })
  ipcMain.handle('video:pick', async (e, kind: 'video' | 'subtitles', near?: string) => {
    if (!isAppPage(e.sender)) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions =
      kind === 'subtitles'
        ? { title: 'Pick subtitles', properties: ['openFile'], defaultPath: typeof near === 'string' && isAbsolute(near) ? dirname(near) : undefined, filters: [{ name: 'Subtitles', extensions: SUBTITLE_EXTS }] }
        : { title: 'Pick a video', properties: ['openFile'], defaultPath: app.getPath('videos'), filters: [{ name: 'Videos', extensions: VIDEO_EXTS }, { name: 'All files', extensions: ['*'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  app.on('will-quit', stopAll)
}
