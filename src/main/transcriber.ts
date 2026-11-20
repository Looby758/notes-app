import { app, BrowserWindow, ipcMain, MessageChannelMain, session, type MessagePortMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  isSilent,
  quietCuts,
  SAMPLE_RATE,
  suggestedTranscribeModel,
  transcribeModelById,
  type SpokenWord,
  type TranscribeProgress,
  type TranscriberState
} from '@shared/transcribe'
import type { TranscribeResult } from '@shared/types'
import { downloadFfmpeg, ffmpegPath, onFfmpegState } from './ffmpeg'
import { logError } from './log'

/**
 * Auto transcripts (see src/shared/transcribe.ts). The sound is read out of the recording with
 * ffmpeg, then handed a couple of minutes at a time to a hidden window that runs Whisper on the
 * graphics card (WebGPU) or, without one, the processor. The window is opened only while it's
 * needed and closed again after a few quiet minutes, so the graphics card is given back.
 *
 * The hidden window has its own session (persist:transcriber) with nothing else in it: it can
 * reach Hugging Face for the model, and nothing of your notes except the sound it's handed.
 */

const PARTITION = 'persist:transcriber'
/** Closed after this long with nothing to do. */
const IDLE_MS = 3 * 60_000

interface Config {
  /** The model downloaded and working. */
  model?: string
  gpu?: boolean
}

const configFile = (): string => join(app.getPath('userData'), 'transcriber.json')
let config: Config | null = null
function loadConfig(): Config {
  if (config) return config
  try {
    config = JSON.parse(readFileSync(configFile(), 'utf8')) as Config
  } catch {
    config = {}
  }
  return config
}
function saveConfig(): void {
  try {
    writeFileSync(configFile(), JSON.stringify(config ?? {}, null, 2), 'utf8')
  } catch (err) {
    logError('transcriber settings', err)
  }
}

let downloading: { progress: number; bytes?: number; model: string } | null = null
let lastError: string | undefined

export function transcriberState(): TranscriberState {
  const c = loadConfig()
  const ffmpeg = existsSync(ffmpegPath())
  if (downloading) return { state: 'downloading', model: downloading.model, progress: downloading.progress, bytes: downloading.bytes, ffmpeg, gpu: c.gpu ?? null, error: lastError }
  return { state: c.model && ffmpeg ? 'ready' : 'missing', model: c.model, ffmpeg, gpu: c.gpu ?? null, error: lastError }
}

/** Every Orbit window except the hidden one. */
function send(channel: string, value: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (w !== worker?.win && !w.isDestroyed()) w.webContents.send(channel, value)
}
const tell = (): void => send('transcribe:state', transcriberState())

// ---------- The hidden window ----------

interface Worker {
  win: BrowserWindow
  port: MessagePortMain
  ready: Promise<void>
  /** The model it has loaded. */
  model?: string
  waiting: Map<number, { resolve: (words: SpokenWord[]) => void; reject: (err: Error) => void }>
  onDownload?: (progress: number, bytes: number) => void
  onLoaded?: { resolve: () => void; reject: (err: Error) => void }
  onGpu?: (gpu: boolean) => void
}

let worker: Worker | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let nextId = 1

function lockDown(): void {
  const s = session.fromPartition(PARTITION)
  // No camera, microphone, notifications or anything else.
  s.setPermissionRequestHandler((_wc, _perm, done) => done(false))
  s.setPermissionCheckHandler(() => false)
}

function openWorker(): Worker {
  if (worker && !worker.win.isDestroyed()) return worker
  lockDown()
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      preload: join(__dirname, '../preload/transcriber.js'),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // It works while hidden, so it mustn't be slowed down like a background tab.
      backgroundThrottling: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  const { port1, port2 } = new MessageChannelMain()
  let ready!: () => void
  const w: Worker = { win, port: port1, ready: new Promise<void>((r) => (ready = r)), waiting: new Map() }
  port1.on('message', ({ data }) => {
    const msg = data as { type: string; id?: number; words?: SpokenWord[]; error?: string; progress?: number; bytes?: number; gpu?: boolean }
    if (msg.type === 'ready') ready()
    else if (msg.type === 'download') w.onDownload?.(msg.progress ?? 0, msg.bytes ?? 0)
    else if (msg.type === 'loaded') {
      w.onLoaded?.resolve()
      w.onLoaded = undefined
    } else if (msg.type === 'gpu') w.onGpu?.(msg.gpu === true)
    else if (msg.type === 'words' && msg.id) {
      w.waiting.get(msg.id)?.resolve(msg.words ?? [])
      w.waiting.delete(msg.id)
    } else if (msg.type === 'error') {
      const err = new Error(msg.error || 'The transcriber stopped working.')
      if (msg.id && w.waiting.has(msg.id)) {
        w.waiting.get(msg.id)!.reject(err)
        w.waiting.delete(msg.id)
      } else if (w.onLoaded) {
        w.onLoaded.reject(err)
        w.onLoaded = undefined
      }
    }
  })
  port1.start()
  win.webContents.once('did-finish-load', () => win.webContents.postMessage('transcriber:port', null, [port2]))
  win.webContents.on('render-process-gone', () => closeWorker('The transcriber stopped working (it may have run out of memory).'))
  win.on('closed', () => {
    if (worker === w) closeWorker('The transcriber was closed.')
  })
  const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (dev) void win.loadURL(`${dev}/transcriber.html`)
  else void win.loadFile(join(__dirname, '../renderer/transcriber.html'))
  worker = w
  return w
}

function closeWorker(reason = 'Stopped.'): void {
  const w = worker
  worker = null
  if (idle) clearTimeout(idle)
  idle = null
  if (!w) return
  for (const p of w.waiting.values()) p.reject(new Error(reason))
  w.waiting.clear()
  w.onLoaded?.reject(new Error(reason))
  w.port.close()
  if (!w.win.isDestroyed()) w.win.destroy()
}

function idleLater(): void {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => {
    if (!job) closeWorker()
  }, IDLE_MS)
}

/** Opens the hidden window with `model` loaded (downloading it the first time). */
async function loadModel(model: string, onDownload?: (progress: number, bytes: number) => void): Promise<Worker> {
  const w = openWorker()
  if (idle) clearTimeout(idle)
  await w.ready
  if (w.model === model) return w
  w.onDownload = onDownload
  await new Promise<void>((resolve, reject) => {
    w.onLoaded = { resolve, reject }
    w.port.postMessage({ type: 'load', model })
  })
  w.onDownload = undefined
  w.model = model
  return w
}

async function checkGpu(): Promise<boolean> {
  const c = loadConfig()
  if (typeof c.gpu === 'boolean') return c.gpu
  const w = openWorker()
  await w.ready
  const gpu = await new Promise<boolean>((resolve) => {
    w.onGpu = resolve
    w.port.postMessage({ type: 'gpu' })
  })
  c.gpu = gpu
  saveConfig()
  return gpu
}

// ---------- Setting up ----------

let settingUp: Promise<TranscriberState> | null = null

/** Downloads what transcripts need: ffmpeg (if it isn't here yet) and the model. */
function setUp(model?: string): Promise<TranscriberState> {
  settingUp ??= (async () => {
    lastError = undefined
    try {
      const pick = transcribeModelById(model) ?? suggestedTranscribeModel(await checkGpu())
      downloading = { progress: 0, model: pick.id }
      tell()
      const ff = await downloadFfmpeg()
      if (ff.state !== 'ready') throw new Error(ff.state === 'unsupported' ? 'Transcripts need ffmpeg, which isn’t available for this computer.' : ff.error || 'ffmpeg didn’t download.')
      let sent = 0
      await loadModel(pick.id, (progress, bytes) => {
        downloading = { progress, bytes, model: pick.id }
        // About every 1%, not every few kilobytes.
        if (Math.abs(progress - sent) >= 0.01) {
          sent = progress
          tell()
        }
      })
      // The model is kept in the page's own cache; the browser's copy of the download isn't needed.
      await session.fromPartition(PARTITION).clearCache()
      loadConfig().model = pick.id
      saveConfig()
      idleLater()
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      logError('transcriber setup', err)
      closeWorker()
    } finally {
      downloading = null
      settingUp = null
      tell()
    }
    return transcriberState()
  })()
  return settingUp
}

async function remove(): Promise<TranscriberState> {
  cancel()
  closeWorker()
  await session.fromPartition(PARTITION).clearStorageData()
  config = {}
  saveConfig()
  lastError = undefined
  tell()
  return transcriberState()
}

// ---------- Making a transcript ----------

interface Job {
  path: string
  cancelled: boolean
  ffmpeg?: ChildProcess
}
let job: Job | null = null

/** The recording's sound as 16 kHz mono samples, read with ffmpeg. */
function readSound(file: string, j: Job, progress: (done: number) => void): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { windowsHide: true })
    j.ffmpeg = child
    const parts: Buffer[] = []
    let length = 0
    let duration: number | null = null
    let log = ''
    child.stdout.on('data', (b: Buffer) => {
      parts.push(b)
      length += b.length
      if (duration) progress(Math.min(1, length / 4 / SAMPLE_RATE / duration))
    })
    child.stderr.on('data', (b: Buffer) => {
      log = (log + b.toString()).slice(-6000)
      if (duration === null) {
        const m = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log)
        if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3]
      }
    })
    child.on('error', () => reject(new Error('ffmpeg couldn’t start.')))
    child.on('close', (code) => {
      j.ffmpeg = undefined
      if (j.cancelled) return reject(new Error('Stopped.'))
      if (code !== 0) {
        if (/does not contain any stream|Output file #0 does not contain/i.test(log)) return reject(new Error('This recording has no sound in it.'))
        logError('transcriber ffmpeg', new Error(log.slice(-1500)))
        return reject(new Error('Orbit couldn’t read the sound in this recording.'))
      }
      // Copied into a buffer of its own: a Float32Array has to start on a 4-byte boundary.
      const bytes = new Uint8Array(length - (length % 4))
      let at = 0
      for (const p of parts) {
        const take = Math.min(p.length, bytes.length - at)
        bytes.set(p.subarray(0, take), at)
        at += take
      }
      resolve(new Float32Array(bytes.buffer))
    })
  })
}


async function transcribe(rel: string, abs: (rel: string) => string): Promise<TranscribeResult> {
  if (job) throw new Error('Orbit is already making a transcript. Wait for it to finish, or stop it.')
  const c = loadConfig()
  if (!c.model || !existsSync(ffmpegPath())) throw new Error('Set up transcripts first (it’s a one-time download).')
  const file = abs(rel)
  if (!existsSync(file)) throw new Error('That recording isn’t in your notes folder any more.')
  const stat = statSync(file)
  const j: Job = { path: rel, cancelled: false }
  job = j
  const progress = (p: Omit<TranscribeProgress, 'path'>): void => send('transcribe:progress', { path: rel, ...p })
  try {
    progress({ stage: 'reading', progress: 0 })
    const model = c.model
    const [samples, w] = await Promise.all([readSound(file, j, (done) => progress({ stage: 'reading', progress: done })), loadModel(model)])
    const length = samples.length / SAMPLE_RATE
    const cuts = quietCuts(samples)
    const words: SpokenWord[] = []
    for (let i = 0; i < cuts.length; i++) {
      if (j.cancelled) throw new Error('Stopped.')
      progress({ stage: 'listening', progress: i / cuts.length, at: cuts[i] / SAMPLE_RATE, length })
      const piece = samples.subarray(cuts[i], cuts[i + 1] ?? samples.length)
      if (isSilent(piece)) continue
      const id = nextId++
      const got = await new Promise<SpokenWord[]>((resolve, reject) => {
        w.waiting.set(id, { resolve, reject })
        // Copied, so only this piece is sent rather than the whole recording.
        w.port.postMessage({ type: 'run', id, samples: piece.slice(), offset: cuts[i] / SAMPLE_RATE })
      })
      words.push(...got)
    }
    progress({ stage: 'listening', progress: 1, at: length, length })
    return { words, length, model, fileTime: stat.mtimeMs, fileSize: stat.size }
  } catch (err) {
    if (j.cancelled) throw new Error('Stopped.')
    throw err
  } finally {
    job = null
    idleLater()
  }
}

function cancel(): void {
  if (!job) return
  job.cancelled = true
  job.ffmpeg?.kill()
  // Whisper can't be stopped part way through a piece, so the window is closed instead.
  closeWorker('Stopped.')
}

export function setupTranscriber(abs: (rel: string) => string): void {
  ipcMain.handle('transcribe:state', () => transcriberState())
  ipcMain.handle('transcribe:setup', (_e, model?: string) => setUp(typeof model === 'string' ? model : undefined))
  ipcMain.handle('transcribe:run', (_e, path: string) => transcribe(String(path), abs))
  ipcMain.handle('transcribe:cancel', () => cancel())
  ipcMain.handle('transcribe:remove', () => remove())
  onFfmpegState(() => tell())
  app.on('will-quit', () => {
    cancel()
    closeWorker()
  })
}
