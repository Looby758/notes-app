import { app, ipcMain, net, session, type WebContents } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, utimesSync } from 'fs'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { VideoDownload, VideoDownloaderState, VideoDownloadRequest } from '@shared/types'
import { WEB_PARTITION } from '@shared/web'
import {
  checksumFor,
  cookiesFile,
  downloadArgs,
  explainDownloadError,
  isYouTube,
  parseVideoLink,
  readLine,
  siteName,
  YTDLP_ASSETS,
  type DownloadQuality
} from '@shared/videoDownload'
import { downloadFfmpeg, ffmpegPath, ffmpegState, onFfmpegState } from './ffmpeg'
import type { Vault } from './vault'
import { logError } from './log'

/**
 * The video downloader: paste a YouTube, X, Instagram, TikTok… link and the video lands in the
 * attachments folder. The downloading is done by yt-dlp (a free, open-source downloader that keeps
 * up with these sites), fetched only when you ask, into Orbit's own folder, its SHA-256 checked
 * against the release's list. It updates itself now and then, since the sites change often.
 * ffmpeg (ffmpeg.ts) joins the HD picture and sound, which big sites send separately.
 */

const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const ASSET = YTDLP_ASSETS[`${process.platform}-${process.arch}`]
/** How old yt-dlp can get before it's asked to update itself (sites change, and it keeps up). */
const UPDATE_AFTER_MS = 3 * 86_400_000

const toolDir = (): string => join(app.getPath('userData'), 'yt-dlp')
const toolPath = (): string => join(toolDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const jobsFolder = (): string => join(app.getPath('temp'), 'orbit-video-downloads')

let fetching: { progress: number; error?: string; done?: Promise<void> } | null = null
let updated: Promise<void> | null = null
const watchers = new Set<WebContents>()

const jobs: VideoDownload[] = []
const running = new Map<number, ChildProcess>()
let nextId = 1

function state(): VideoDownloaderState {
  const ffmpeg = ffmpegState()
  const base = { ffmpeg: ffmpeg.state, ffmpegProgress: ffmpeg.progress }
  if (!ASSET) return { ...base, state: 'unsupported' }
  if (fetching && !fetching.error) return { ...base, state: 'downloading', progress: fetching.progress }
  if (existsSync(toolPath())) return { ...base, state: 'ready', error: ffmpeg.error }
  return { ...base, state: 'missing', error: fetching?.error ?? ffmpeg.error }
}

function send(channel: string, value: unknown): void {
  for (const wc of watchers) if (!wc.isDestroyed()) wc.send(channel, value)
}
const tellState = (): void => send('vdl:state', state())
let jobsTimer: ReturnType<typeof setTimeout> | null = null
/** The list goes to the window at most a few times a second (progress lines come much faster). */
function tellJobs(now = false): void {
  if (now) {
    if (jobsTimer) clearTimeout(jobsTimer)
    jobsTimer = null
    send('vdl:jobs', jobs)
  } else {
    jobsTimer ??= setTimeout(() => tellJobs(true), 250)
  }
}

function watch(wc: WebContents): void {
  if (watchers.has(wc)) return
  watchers.add(wc)
  wc.once('destroyed', () => watchers.delete(wc))
}

/** Asks Apple Silicon to run it: signed "ad hoc", like Orbit itself and ffmpeg. */
const signForMac = (): Promise<void> =>
  process.platform === 'darwin' ? new Promise<void>((resolve) => execFile('codesign', ['--force', '--sign', '-', toolPath()], () => resolve())) : Promise.resolve()

async function fetchTool(): Promise<void> {
  mkdirSync(toolDir(), { recursive: true })
  const tmp = `${toolPath()}.part`
  try {
    const sums = await net.fetch(`${RELEASE}/SHA2-256SUMS`)
    if (!sums.ok) throw new Error(`The download didn’t work (${sums.status}).`)
    const expected = checksumFor(await sums.text(), ASSET)
    if (!expected) throw new Error('The downloader isn’t available for this kind of computer right now.')
    const res = await net.fetch(`${RELEASE}/${ASSET}`)
    if (!res.ok || !res.body) throw new Error(`The download didn’t work (${res.status}).`)
    const total = Number(res.headers.get('content-length')) || 35_000_000
    const hash = createHash('sha256')
    let got = 0
    let lastSent = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk)
        got += chunk.length
        const progress = Math.min(1, got / total)
        if (fetching && progress - lastSent > 0.01) {
          fetching.progress = progress
          lastSent = progress
          tellState()
        }
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))
    if (hash.digest('hex') !== expected) throw new Error('The download was damaged or changed, so it wasn’t used. Try again.')
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    renameSync(tmp, toolPath())
    await signForMac()
    updated = Promise.resolve()
    fetching = null
  } catch (err) {
    rmSync(tmp, { force: true })
    fetching = { progress: 0, error: err instanceof Error ? err.message : String(err) }
    logError('video downloader download', err)
  } finally {
    tellState()
  }
}

/** Gets yt-dlp (once, however often it's asked for) and ffmpeg alongside it. */
async function getTool(): Promise<VideoDownloaderState> {
  if (!ASSET) return state()
  const ffmpeg = ffmpegState().state === 'missing' ? downloadFfmpeg() : Promise.resolve()
  if (!existsSync(toolPath()) && (!fetching?.done || fetching.error)) {
    fetching = { progress: 0 }
    fetching.done = fetchTool()
    tellState()
  }
  await Promise.all([fetching?.done, ffmpeg])
  return state()
}

/** Once a session, if it's a few days old: yt-dlp updates itself (it checks its own download). */
function updateTool(): Promise<void> {
  updated ??= (async () => {
    try {
      if (Date.now() - statSync(toolPath()).mtimeMs < UPDATE_AFTER_MS) return
      await new Promise<void>((resolve) => {
        const child = execFile(toolPath(), ['--update', '--no-colors'], { timeout: 90_000, windowsHide: true }, () => resolve())
        child.on('error', () => resolve())
      })
      await signForMac()
      const now = new Date()
      utimesSync(toolPath(), now, now)
    } catch (err) {
      logError('video downloader update', err)
    }
  })()
  return updated
}

/** The cookies from Orbit's web tabs for the link's own site, so a site that wants you signed in sees you are. */
async function cookiesFor(url: URL, dir: string): Promise<string | null> {
  // YouTube is left alone: it doesn't need a sign-in for normal videos, and it frowns on signed-in downloading.
  if (isYouTube(url)) return null
  try {
    const text = cookiesFile(await session.fromPartition(WEB_PARTITION).cookies.get({}), url.hostname)
    if (!text) return null
    const file = join(dir, 'cookies.txt')
    await writeFile(file, text, { mode: 0o600 })
    return file
  } catch (err) {
    logError('video downloader cookies', err)
    return null
  }
}

/** The finished file: the biggest one left in the job's folder (not a half-done part). */
async function finishedFile(dir: string): Promise<string | null> {
  let best: { path: string; size: number } | null = null
  for (const name of await readdir(dir)) {
    if (name === 'cookies.txt' || /\.(part|ytdl|temp|tmp)$|\.part-Frag\d+$/i.test(name)) continue
    const path = join(dir, name)
    const s = await stat(path).catch(() => null)
    if (s?.isFile() && (!best || s.size > best.size)) best = { path, size: s.size }
  }
  return best?.path ?? null
}

/** Stopped from the window (status changes outside the download's own code). */
const stopped = (job: VideoDownload): boolean => job.status === 'cancelled'

const update = (job: VideoDownload, patch: Partial<VideoDownload>, now = false): void => {
  Object.assign(job, patch)
  tellJobs(now)
}

function kill(child: ChildProcess): void {
  // On Windows the joining step (ffmpeg) runs under yt-dlp, so the whole tree goes.
  if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined)
  else child.kill()
}

async function run(job: VideoDownload, url: URL, folder: string, vault: () => Vault | null): Promise<void> {
  const dir = join(jobsFolder(), `${process.pid}-${job.id}-${Date.now()}`)
  try {
    if (!existsSync(toolPath())) {
      await getTool()
      if (!existsSync(toolPath())) throw new Error(state().error ?? 'The downloader couldn’t be set up.')
    }
    if (ffmpegState().state === 'downloading') await downloadFfmpeg()
    await updateTool()
    if (stopped(job)) return
    await mkdir(dir, { recursive: true })
    const ffmpeg = existsSync(ffmpegPath()) ? ffmpegPath() : null
    const args = downloadArgs({
      url: url.href,
      quality: job.quality,
      outDir: dir,
      ffmpeg,
      cookies: await cookiesFor(url, dir),
      // YouTube's player code needs JavaScript to be read. Orbit can run it itself, as Node.
      jsRuntime: `node:${process.execPath}`
    })
    const log: string[] = []
    let parts = 0
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(toolPath(), args, { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' } })
      running.set(job.id, child)
      let rest = ''
      const onData = (chunk: Buffer): void => {
        const lines = (rest + chunk.toString('utf8')).split(/\r?\n|\r/)
        rest = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          if (!line.startsWith('[orbit]')) log.push(line)
          if (log.length > 60) log.shift()
          const seen = readLine(line)
          if (!seen) continue
          if (seen.kind === 'progress' && seen.done !== null) update(job, { progress: seen.done })
          else if (seen.kind === 'part') {
            parts++
            const stage = job.quality === 'audio' ? 'sound' : parts === 1 ? 'video' : 'sound'
            update(job, { title: job.title ?? seen.title, stage, progress: 0 }, true)
          } else if (seen.kind === 'joining') update(job, { stage: 'joining', progress: undefined }, true)
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('error', reject)
      child.on('close', (c) => resolve(c))
    })
    running.delete(job.id)
    if (stopped(job)) return
    if (code !== 0) throw new Error(explainDownloadError(log.join('\n'), job.site))
    const file = await finishedFile(dir)
    if (!file) throw new Error('The video couldn’t be downloaded.')
    update(job, { stage: 'saving', progress: undefined }, true)
    const v = vault()
    if (!v) throw new Error('Open a notes folder first, so the video has somewhere to go.')
    const name = file.slice(dir.length + 1)
    const path = await v.moveInAttachment(folder, file, name)
    const size = (await stat(v.abs(path)).catch(() => null))?.size
    update(job, { status: 'done', path, size, title: job.title ?? name.replace(/\.\w+$/, ''), progress: 1 }, true)
  } catch (err) {
    running.delete(job.id)
    if (!stopped(job)) update(job, { status: 'failed', error: err instanceof Error ? err.message : String(err) }, true)
    logError('video download', err)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function start(req: VideoDownloadRequest, vault: () => Vault | null): VideoDownload {
  const url = parseVideoLink(String(req?.url ?? ''))
  if (!url) throw new Error('That doesn’t look like a link. Copy the video’s address and paste it here.')
  const quality: DownloadQuality = req.quality === '720' || req.quality === 'audio' ? req.quality : '1080'
  const folder = typeof req.folder === 'string' && req.folder ? req.folder : 'attachments'
  const job: VideoDownload = { id: nextId++, url: url.href, site: siteName(url), quality, status: 'working', stage: 'starting', startedAt: Date.now() }
  jobs.unshift(job)
  // Old finished ones drop off the end.
  for (let i = jobs.length - 1; i >= 0 && jobs.length > 30; i--) if (jobs[i].status !== 'working') jobs.splice(i, 1)
  tellJobs(true)
  void run(job, url, folder, vault)
  return job
}

export function setupVideoDownloader(vault: () => Vault | null): void {
  onFfmpegState(() => tellState())
  ipcMain.handle('vdl:state', (e) => {
    watch(e.sender)
    return state()
  })
  ipcMain.handle('vdl:get', () => getTool())
  ipcMain.handle('vdl:jobs', (e) => {
    watch(e.sender)
    return jobs
  })
  ipcMain.handle('vdl:start', (_e, req: VideoDownloadRequest) => start(req, vault))
  ipcMain.handle('vdl:cancel', (_e, id: number) => {
    const job = jobs.find((j) => j.id === id)
    if (!job || job.status !== 'working') return
    job.status = 'cancelled'
    const child = running.get(id)
    if (child) kill(child)
    tellJobs(true)
  })
  ipcMain.handle('vdl:forget', (_e, id: number) => {
    const i = jobs.findIndex((j) => j.id === id)
    if (i >= 0 && jobs[i].status !== 'working') jobs.splice(i, 1)
    tellJobs(true)
  })
  rmSync(jobsFolder(), { recursive: true, force: true })
  app.on('will-quit', () => {
    for (const child of running.values()) kill(child)
  })
}
