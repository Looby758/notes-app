import { app, BrowserWindow, ipcMain, Notification, session, shell } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { copyFile, mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { VideoDownload } from '@shared/types'
import { WEB_PARTITION } from '@shared/web'
import { freeFileName } from '@shared/browser'
import {
  cleanSettings,
  explainStatus,
  fileNameFor,
  isNight,
  isVideoPage,
  moveItem,
  nextNightChange,
  parseLinks,
  pauseForMorning,
  pickNext,
  totalFromRange,
  type DmAddRequest,
  type DmItem,
  type DmSettings,
  type DmState
} from '@shared/downloadManager'
import { defaultDownloadFolder } from './browserData'
import { cancelVideoJob, onVideoJobs, startVideoJob } from './videoDownload'
import { epicDownloads, steamDownloads } from './games'
import { epicProgress, type EpicDownload, type EpicSeen, type SteamDownload } from '@shared/games'
import { countFolder } from './folderSize/count'
import { logError } from './log'
import { addonOn } from './addonGate'

/**
 * The download manager: a queue of downloads that run a few at a time, pause and carry on where
 * they stopped (even after Orbit closes), and can wait for the night. Files are fetched through the
 * web tabs' storage, so a site you're signed in to in Orbit lets you download from it. Video pages
 * (YouTube, TikTok…) go through the video downloader when their turn comes. The list is kept in
 * download-manager.json in the settings folder; half-done files wait in download-manager/.
 */

const listFile = (): string => join(app.getPath('userData'), 'download-manager.json')
const partsDir = (): string => join(app.getPath('userData'), 'download-manager')
const partOf = (id: string): string => join(partsDir(), `${id}.part`)

let items: DmItem[] = []
let settings: DmSettings = cleanSettings(null)
/** The downloads running now: a file's way to stop, or a video's job number. */
const active = new Map<string, { abort?: AbortController; video?: number }>()

// ---------- saving and telling the window ----------

function load(): void {
  try {
    const saved = JSON.parse(readFileSync(listFile(), 'utf8')) as { items?: DmItem[]; settings?: Partial<DmSettings> }
    settings = cleanSettings(saved.settings)
    items = (Array.isArray(saved.items) ? saved.items : [])
      .filter((i) => i && typeof i.id === 'string' && typeof i.url === 'string')
      // Whatever was downloading when Orbit closed carries on.
      .map((i) => ({ ...i, speed: undefined, status: i.status === 'downloading' ? 'queued' : i.status }))
  } catch {
    // Nothing saved yet.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    try {
      writeFileSync(listFile(), JSON.stringify({ settings, items: items.map((i) => ({ ...i, speed: undefined })) }, null, 1))
    } catch (err) {
      logError('download manager save', err)
    }
  }, 500)
}

function state(): DmState {
  const now = new Date()
  return { items, settings, night: isNight(now, settings.nightStart, settings.nightEnd), nextChange: nextNightChange(now, settings), defaultFolder: defaultDownloadFolder() }
}

let tellTimer: ReturnType<typeof setTimeout> | null = null
/** The list goes to the window at most four times a second (progress changes much faster). */
function tell(now = false): void {
  const send = (): void => {
    tellTimer = null
    const s = state()
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('dm:state', s)
  }
  if (now) {
    if (tellTimer) clearTimeout(tellTimer)
    send()
  } else tellTimer ??= setTimeout(send, 250)
}

const changed = (now = true): void => {
  save()
  tell(now)
}

function finishedNote(item: DmItem): void {
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (focused || !Notification.isSupported()) return
  new Notification({ title: 'Download finished', body: item.name, silent: true }).show()
}

// ---------- downloading a file ----------

/** Waits so everything together stays under the speed limit. */
function throttle(): Transform {
  let start = Date.now()
  let sent = 0
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      const limit = settings.speedLimitKb * 1024
      if (!limit) {
        start = Date.now()
        sent = 0
        return done(null, chunk)
      }
      const share = limit / Math.max(1, active.size)
      sent += chunk.length
      const wait = (sent / share) * 1000 - (Date.now() - start)
      if (wait > 5) setTimeout(() => done(null, chunk), Math.min(wait, 2000))
      else done(null, chunk)
    }
  })
}

async function runFile(item: DmItem, abort: AbortController): Promise<void> {
  await mkdir(partsDir(), { recursive: true })
  const part = partOf(item.id)
  let have = existsSync(part) ? (await stat(part)).size : 0
  const headers: Record<string, string> = {}
  if (have) {
    headers.Range = `bytes=${have}-`
    // Only the same version of the file joins on (otherwise the site sends it whole).
    const version = item.etag ?? item.modified
    if (version) headers['If-Range'] = version
  }
  const res = await session.fromPartition(WEB_PARTITION).fetch(item.url, { headers, signal: abort.signal, redirect: 'follow' })
  if (res.status === 416 && have && item.total && have >= item.total) {
    // It had all arrived already.
    await res.body?.cancel().catch(() => undefined)
  } else {
    if (!res.ok || !res.body) throw new Error(explainStatus(res.status))
    const joining = res.status === 206 && have > 0
    if (!joining) have = 0
    const length = Number(res.headers.get('content-length')) || 0
    item.total = joining ? (totalFromRange(res.headers.get('content-range')) ?? have + length) : length
    item.received = have
    item.etag = res.headers.get('etag') ?? undefined
    item.modified = res.headers.get('last-modified') ?? undefined
    item.resumable = joining || /bytes/i.test(res.headers.get('accept-ranges') ?? '')
    if (!have) item.name = fileNameFor(res.url || item.url, res.headers.get('content-disposition'))
    changed()
    let windowStart = Date.now()
    let windowBytes = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        item.received += chunk.length
        windowBytes += chunk.length
        const ms = Date.now() - windowStart
        if (ms >= 1000) {
          const now = (windowBytes * 1000) / ms
          item.speed = item.speed ? item.speed * 0.6 + now * 0.4 : now
          windowStart = Date.now()
          windowBytes = 0
          save()
        }
        tell()
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), throttle(), counter, createWriteStream(part, { flags: joining ? 'a' : 'w' }))
  }
  // Into its folder, under a name that isn't taken.
  await mkdir(item.folder, { recursive: true })
  const name = freeFileName(item.name, (n) => existsSync(join(item.folder, n)))
  const target = join(item.folder, name)
  try {
    await rename(part, target)
  } catch {
    // Another drive: copy it over instead.
    await copyFile(part, target)
    await rm(part, { force: true })
  }
  item.name = name
  item.path = target
  if (!item.total) item.total = item.received
}

function startFile(item: DmItem): void {
  const abort = new AbortController()
  active.set(item.id, { abort })
  item.status = 'downloading'
  item.error = undefined
  item.speed = undefined
  changed()
  runFile(item, abort)
    .then(() => {
      item.status = 'done'
      item.finished = Date.now()
      item.speed = undefined
      finishedNote(item)
    })
    .catch((err) => {
      item.speed = undefined
      // Paused, moved back to the queue or taken off the list: it was stopped on purpose.
      if (abort.signal.aborted) return
      item.status = 'failed'
      item.error = err instanceof Error ? err.message : String(err)
      logError('download manager', err)
    })
    .finally(() => {
      if (active.get(item.id)?.abort === abort) active.delete(item.id)
      changed()
      pump()
    })
}

// ---------- downloading a video ----------

const STAGE_WORDS: Record<VideoDownload['stage'], string> = {
  starting: 'Finding the video…',
  video: 'Downloading the picture',
  sound: 'Downloading the sound',
  joining: 'Putting it together…',
  saving: 'Saving…'
}

function startVideo(item: DmItem): void {
  try {
    const job = startVideoJob({ url: item.url, quality: item.quality ?? '1080', folder: item.folder, manager: true })
    active.set(item.id, { video: job.id })
    item.status = 'downloading'
    item.error = undefined
    item.progress = 0
    item.stage = STAGE_WORDS.starting
  } catch (err) {
    item.status = 'failed'
    item.error = err instanceof Error ? err.message : String(err)
  }
  changed()
}

/** Follows the video downloader's jobs for the videos this queue started. */
function videoJobsChanged(jobs: VideoDownload[]): void {
  let ended = false
  for (const [id, run] of active) {
    if (run.video === undefined) continue
    const item = items.find((i) => i.id === id)
    const job = jobs.find((j) => j.id === run.video)
    if (!item || !job) continue
    if (job.title) item.name = job.title
    item.stage = STAGE_WORDS[job.stage]
    item.progress = job.progress
    if (job.status === 'working') continue
    active.delete(id)
    ended = true
    if (job.status === 'done') {
      item.status = 'done'
      item.finished = Date.now()
      item.path = job.path
      item.total = item.received = job.size ?? 0
      item.progress = 1
      finishedNote(item)
    } else if (job.status === 'failed') {
      item.status = 'failed'
      item.error = job.error
    }
    // 'cancelled' is a pause or a move back to the queue: the item's status was set then.
  }
  if (ended) {
    changed()
    pump()
  } else tell()
}

// ---------- the queue ----------

/** Stops a running download, leaving what's arrived so it can carry on. */
function stop(item: DmItem, status: DmItem['status']): void {
  const run = active.get(item.id)
  active.delete(item.id)
  item.status = status
  item.speed = undefined
  if (run?.abort) run.abort.abort()
  if (run?.video !== undefined) cancelVideoJob(run.video)
}

function pump(): void {
  // Queued and overnight downloads only run with the Downloads add-on.
  if (!addonOn('downloads')) return
  const night = isNight(new Date(), settings.nightStart, settings.nightEnd)
  for (const id of pauseForMorning(items, night, settings.pauseAtNightEnd)) {
    const item = items.find((i) => i.id === id)
    // Back in the queue, still overnight: it carries on the next night.
    if (item) stop(item, 'queued')
  }
  for (const id of pickNext(items, settings.atOnce, night)) {
    const item = items.find((i) => i.id === id)
    if (!item) continue
    if (item.kind === 'video') startVideo(item)
    else startFile(item)
  }
  tell(true)
}

const newId = (): string => `dm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function add(req: DmAddRequest): DmItem[] {
  const links = parseLinks((req?.urls ?? []).join('\n'))
  if (!links.length) throw new Error('That doesn’t look like a link. Copy the download’s address and paste it here.')
  const folder = typeof req.folder === 'string' && req.folder ? req.folder : defaultDownloadFolder()
  const videoFolder = typeof req.videoFolder === 'string' ? req.videoFolder.replace(/^\/+|\/+$/g, '') : 'attachments'
  const quality = req.quality === '720' || req.quality === 'audio' ? req.quality : '1080'
  const added = links.map((url): DmItem => {
    const kind = req.kind === 'file' || req.kind === 'video' ? req.kind : isVideoPage(url) ? 'video' : 'file'
    return {
      id: newId(),
      kind,
      url,
      name: kind === 'video' ? url : fileNameFor(url),
      folder: kind === 'video' ? videoFolder : folder,
      ...(kind === 'video' ? { quality } : {}),
      status: 'queued',
      overnight: req.overnight === true,
      received: 0,
      total: 0,
      added: Date.now()
    }
  })
  items = [...items, ...added]
  changed()
  pump()
  return added
}

function forget(item: DmItem): void {
  if (item.status === 'downloading') stop(item, 'paused')
  items = items.filter((i) => i !== item)
  // A moment later, once the stopped download has let go of the file.
  setTimeout(() => void rm(partOf(item.id), { force: true }).catch(() => undefined), 1000)
}

type Action = 'pause' | 'resume' | 'retry' | 'remove' | 'now' | 'tonight' | 'up' | 'down' | 'top'

function act(id: string, action: Action): void {
  const item = items.find((i) => i.id === id)
  if (!item) return
  switch (action) {
    case 'pause':
      if (item.status === 'downloading') stop(item, 'paused')
      else if (item.status === 'queued') item.status = 'paused'
      break
    case 'resume':
      if (item.status === 'paused') item.status = 'queued'
      break
    case 'retry':
      if (item.status !== 'failed') return
      item.status = 'queued'
      item.error = undefined
      break
    case 'remove':
      forget(item)
      break
    case 'now':
      // Starts as soon as there's room, night or not (and goes to the top so it's next).
      item.overnight = false
      if (item.status === 'paused' || item.status === 'failed') item.status = 'queued'
      item.error = undefined
      items = moveItem(items, id, 'top')
      break
    case 'tonight':
      item.overnight = true
      if (item.status === 'downloading' && !isNight(new Date(), settings.nightStart, settings.nightEnd)) stop(item, 'queued')
      if (item.status === 'paused') item.status = 'queued'
      break
    case 'up':
      items = moveItem(items, id, -1)
      break
    case 'down':
      items = moveItem(items, id, 1)
      break
    case 'top':
      items = moveItem(items, id, 'top')
      break
  }
  changed()
  pump()
}

function all(action: 'pause' | 'resume' | 'clear'): void {
  if (action === 'clear') items = items.filter((i) => i.status !== 'done')
  for (const item of items) {
    if (action === 'pause' && item.status === 'downloading') stop(item, 'paused')
    else if (action === 'pause' && item.status === 'queued') item.status = 'paused'
    else if (action === 'resume' && item.status === 'paused') item.status = 'queued'
  }
  changed()
  pump()
}

/** Steam's downloads, with a speed worked out from the last look. */
const lastSteam = new Map<string, { at: number; bytes: number; speed?: number }>()
async function steamNow(): Promise<(SteamDownload & { speed?: number })[]> {
  const now = Date.now()
  const list = await steamDownloads().catch(() => [])
  return list.map((d) => {
    const last = lastSteam.get(d.appId)
    let speed = last?.speed
    if (last && now - last.at > 500 && d.state === 'downloading') {
      const got = d.downloaded - last.bytes
      // Steam writes its manifest now and then, not every second: keep the last speed between writes.
      if (got > 0) speed = (got * 1000) / (now - last.at)
    }
    if (d.state !== 'downloading') speed = undefined
    if (!last || d.downloaded !== last.bytes || d.state !== 'downloading') lastSteam.set(d.appId, { at: now, bytes: d.downloaded, speed })
    return { ...d, speed }
  })
}

/**
 * Epic's downloads. Epic doesn't write its progress down, so each game's folder is measured
 * (no more than every 10 seconds, as big games have a lot of files) and the speed and whether
 * it's going come from how it grows.
 */
const EPIC_MEASURE_MS = 10_000
const lastEpic = new Map<string, EpicSeen & { measuring?: boolean }>()
let epicLast: (EpicDownload & { speed?: number })[] = []
async function epicNow(): Promise<(EpicDownload & { speed?: number })[]> {
  const list = await epicDownloads().catch(() => [])
  const now = Date.now()
  for (const key of [...lastEpic.keys()]) if (!list.some((d) => d.appName === key)) lastEpic.delete(key)
  const out = await Promise.all(
    list.map(async (d) => {
      const prev = lastEpic.get(d.appName)
      const shown = epicLast.find((e) => e.appName === d.appName)
      if (prev && (prev.measuring || now - prev.at < EPIC_MEASURE_MS) && shown) return { ...shown, name: d.name, kind: d.kind, total: d.total }
      if (prev) prev.measuring = true
      const size = await countFolder(d.kind === 'install' ? d.installLocation : d.stagingLocation, { concurrency: 4 }).catch(() => null)
      const bytes = size?.bytes ?? 0
      const p = epicProgress(prev, bytes, Date.now())
      lastEpic.set(d.appName, p.seen)
      const downloaded = d.total ? Math.min(bytes, d.total) : bytes
      return { appName: d.appName, name: d.name, kind: d.kind, state: p.state, downloaded, total: d.total, speed: p.speed }
    })
  )
  epicLast = out
  return out
}

export function setupDownloadManager(): void {
  load()
  mkdirSync(partsDir(), { recursive: true })
  onVideoJobs(videoJobsChanged)
  ipcMain.handle('dm:state', () => state())
  ipcMain.handle('dm:steam', () => steamNow())
  // Steam asks which drive and confirms (Orbit can't press Steam's buttons for you).
  ipcMain.handle('dm:steamInstall', (_e, appId: string) => (/^\d+$/.test(String(appId)) ? shell.openExternal(`steam://install/${appId}`) : undefined))
  ipcMain.handle('dm:steamOpen', () => shell.openExternal('steam://open/downloads'))
  ipcMain.handle('dm:epic', () => epicNow())
  // Epic's downloads are paused, reordered and cancelled in the launcher itself.
  ipcMain.handle('dm:epicOpen', () => shell.openExternal('com.epicgames.launcher://store/library'))
  ipcMain.handle('dm:add', (_e, req: DmAddRequest) => add(req))
  ipcMain.handle('dm:act', (_e, id: string, action: Action) => act(String(id), action))
  ipcMain.handle('dm:all', (_e, action: 'pause' | 'resume' | 'clear') => all(action))
  ipcMain.handle('dm:settings', (_e, patch: Partial<DmSettings>) => {
    settings = cleanSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) })
    changed()
    pump()
    return state()
  })
  // The night starting or ending, checked every half minute.
  setInterval(pump, 30_000).unref?.()
  // Videos that were queued when Orbit closed start over (the video downloader can't carry on).
  setTimeout(pump, 3000)
  app.on('will-quit', () => {
    for (const item of items) if (item.status === 'downloading') stop(item, 'queued')
    if (saveTimer) clearTimeout(saveTimer)
    try {
      writeFileSync(listFile(), JSON.stringify({ settings, items: items.map((i) => ({ ...i, speed: undefined })) }, null, 1))
    } catch {
      // nothing more to do
    }
  })
}
