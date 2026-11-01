import { app, BrowserWindow, ipcMain, net } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { createHash, type Hash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { totalmem } from 'os'
import { join } from 'path'
import { Readable, Transform, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  cleanReply,
  hfFileInfo,
  LOCAL_CONTEXT_TOKENS,
  localModelById,
  pickFromReleases,
  sha256Of,
  suggestedModel,
  type EngineKind,
  type GithubRelease,
  type HfFile,
} from '@shared/localAi'
import type { LocalAiState } from '@shared/types'
import { gameRunning, onGameRunning } from './games'
import { logError } from './log'

/**
 * The offline AI. Nothing of it comes with Orbit: when you ask (Settings → AI helper, or the
 * launcher), it downloads
 *  - llama.cpp's `llama-server` (github.com/ggml-org/llama.cpp, the latest release, MIT licence):
 *    the CUDA build for NVIDIA cards on Windows, Vulkan for other cards, Metal on Apple Silicon;
 *  - one model file from Hugging Face (Qwen3, Apache 2.0).
 * Both are checked against the SHA-256 their site publishes before they're used, and kept in
 * Orbit's own folder (local-ai), so Remove gets rid of all of it.
 *
 * The model is loaded into the graphics card only when something asks it a question, unloaded
 * again after a few quiet minutes, and (unless you switch it off) unloaded while a game is
 * running, so games get the whole card. It listens on 127.0.0.1 only.
 */

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const SUPPORTED = (IS_WIN && process.arch === 'x64') || (IS_MAC && process.arch === 'arm64')

// The newest few releases: "latest" is a numbered version with no builds in it, and the builds come
// in the nightly "b1234" releases (the newest can still be uploading, so it looks further back).
const RELEASE_API = process.env.NOTES_LLAMA_RELEASE_URL || 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15'
const HF = 'https://huggingface.co'
/** Unloaded after this long without a question. */
const IDLE_MS = 10 * 60_000

interface Config {
  model?: string
  engine?: EngineKind
  /** Where llama-server is, inside the engine folder. */
  server?: string
  release?: string
  unloadForGames: boolean
}

const dir = (): string => join(app.getPath('userData'), 'local-ai')
const engineDir = (): string => join(dir(), 'engine')
const modelsDir = (): string => join(dir(), 'models')
const configFile = (): string => join(app.getPath('userData'), 'local-ai.json')

let config: Config | null = null
function loadConfig(): Config {
  if (config) return config
  try {
    config = { unloadForGames: true, ...(JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<Config>) }
  } catch {
    config = { unloadForGames: true }
  }
  return config
}
function saveConfig(): void {
  const tmp = `${configFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  renameSync(tmp, configFile())
}

const modelPath = (): string | null => {
  const m = localModelById(loadConfig().model)
  return m ? join(modelsDir(), m.file) : null
}
const serverPath = (): string | null => {
  const s = loadConfig().server
  return s ? join(engineDir(), s) : null
}

export function localAiInstalled(): boolean {
  const m = modelPath()
  const s = serverPath()
  return !!m && !!s && existsSync(m) && existsSync(s)
}

// ---------- the graphics card ----------

let gpu: { name: string; memoryGb: number } | null | undefined
let nvidia = false

async function findGpu(): Promise<{ name: string; memoryGb: number } | null> {
  if (gpu !== undefined) return gpu
  if (IS_MAC) {
    gpu = { name: 'Apple Silicon', memoryGb: Math.round(totalmem() / 1024 ** 3) }
    return gpu
  }
  if (!IS_WIN) return (gpu = null)
  gpu = await new Promise<{ name: string; memoryGb: number } | null>((resolve) =>
    execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 10_000 }, (err, out) => {
      const m = !err && /^(.+?),\s*(\d+)/m.exec(out)
      if (m) {
        nvidia = true
        resolve({ name: m[1].trim(), memoryGb: Math.round(+m[2] / 1024) })
      } else resolve(null)
    })
  )
  return gpu
}

// ---------- state ----------

let download: { stage: 'engine' | 'model'; progress: number; bytes: number; error?: string; abort: AbortController; done?: Promise<void> } | null = null
let lastError: string | undefined

export function localAiState(): LocalAiState {
  const c = loadConfig()
  const base = {
    loaded: !!server?.ready,
    loading: !!server && !server.ready,
    gamePaused: paused,
    unloadForGames: c.unloadForGames,
    gpu: gpu ?? null,
    suggested: suggestedModel(gpu?.memoryGb ?? null, IS_MAC).id,
    model: c.model,
    engine: c.engine
  }
  if (!SUPPORTED) return { ...base, state: 'unsupported' }
  if (download && !download.error) return { ...base, state: 'downloading', stage: download.stage, progress: download.progress, bytes: download.bytes, model: wanted ?? c.model }
  if (localAiInstalled()) return { ...base, state: 'ready', error: lastError }
  return { ...base, state: 'missing', error: download?.error ?? lastError }
}

function tell(): void {
  const state = localAiState()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('localAi:state', state)
}

// ---------- downloading ----------

class Stopped extends Error {}

/** Downloads a file, checking its size and SHA-256; carries on from a .part left by an earlier try. */
async function fetchFile(url: string, dest: string, expect: { size: number; sha256: string }, signal: AbortSignal, onBytes: (got: number) => void): Promise<void> {
  const part = `${dest}.part`
  let have = existsSync(part) ? statSync(part).size : 0
  if (have > expect.size) {
    rmSync(part, { force: true })
    have = 0
  }
  let hash: Hash = createHash('sha256')
  if (have) {
    const h = hash
    await pipeline(createReadStream(part), new Writable({ write: (chunk: Buffer, _e, cb) => (h.update(chunk), cb()) }))
  }
  if (have < expect.size) {
    const res = await net.fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal })
    if (res.status === 200 && have) {
      // The server started from the beginning again.
      have = 0
      hash = createHash('sha256')
    } else if (!res.ok || !res.body) throw new Error(`The download didn’t work (${res.status}).`)
    if (!res.body) throw new Error('The download didn’t work.')
    let got = have
    const h = hash
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        h.update(chunk)
        got += chunk.length
        onBytes(got)
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(part, { flags: have ? 'a' : 'w' }))
  }
  if (statSync(part).size !== expect.size || hash.digest('hex') !== expect.sha256) {
    rmSync(part, { force: true })
    throw new Error('The download was damaged or changed, so it wasn’t used. Try again.')
  }
  renameSync(part, dest)
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Orbit' }, signal })
  if (!res.ok) throw new Error(`Couldn’t look up the download (${res.status}). Check your internet connection and try again.`)
  return (await res.json()) as T
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(`Couldn’t unpack the AI engine. ${String(stderr || err.message).slice(0, 200)}`)) : resolve()
    )
  )
}

/** Unpacks a .zip or .tar.gz with the system's own tools (Windows 10+ has tar, which reads zips too). */
async function extract(file: string, into: string): Promise<void> {
  mkdirSync(into, { recursive: true })
  if (IS_WIN) return run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', into])
  if (file.endsWith('.zip')) return run('ditto', ['-x', '-k', file, into])
  return run('tar', ['-xzf', file, '-C', into])
}

/** Where llama-server ended up in an unpacked build (some builds keep it in a folder). */
function findServer(root: string, depth = 0): string | null {
  const name = IS_WIN ? 'llama-server.exe' : 'llama-server'
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  if (entries.includes(name)) return join(root, name)
  if (depth > 3) return null
  for (const e of entries) {
    const p = join(root, e)
    try {
      if (statSync(p).isDirectory()) {
        const found = findServer(p, depth + 1)
        if (found) return found
      }
    } catch {
      // skip it
    }
  }
  return null
}

async function signForMac(folder: string): Promise<void> {
  if (!IS_MAC) return
  // Apple Silicon only runs signed programs: sign the engine "ad hoc", like Orbit itself.
  for (const f of readdirSync(folder)) {
    if (f === 'llama-server' || f.endsWith('.dylib')) {
      await new Promise<void>((resolve) => execFile('codesign', ['--force', '--sign', '-', join(folder, f)], () => resolve()))
    }
  }
}

let wanted: string | undefined

async function install(modelId: string, abort: AbortController): Promise<void> {
  const model = localModelById(modelId)
  if (!model) throw new Error('That model isn’t one Orbit knows.')
  const signal = abort.signal
  const c = loadConfig()
  await findGpu()
  mkdirSync(dir(), { recursive: true })

  // 1. The engine (skipped if it's already here).
  if (!serverPath() || !existsSync(serverPath()!)) {
    download!.stage = 'engine'
    tell()
    const releases = await getJson<GithubRelease[] | GithubRelease>(RELEASE_API, signal)
    const found = pickFromReleases(Array.isArray(releases) ? releases : [releases], { platform: process.platform, arch: process.arch, nvidia })
    if (!found) throw new Error('Couldn’t find an AI engine for this computer in the recent llama.cpp releases. Try again later.')
    const { release, pick } = found
    const files = [pick.engine, ...(pick.runtime ? [pick.runtime] : [])]
    const total = files.reduce((n, f) => n + f.size, 0)
    let before = 0
    const tmp = join(dir(), 'downloads')
    mkdirSync(tmp, { recursive: true })
    rmSync(engineDir(), { recursive: true, force: true })
    let serverAt: string | null = null
    for (const f of files) {
      const sha256 = sha256Of(f.digest)
      if (!sha256) throw new Error('GitHub didn’t say what the AI engine download should contain, so it wasn’t downloaded.')
      const dest = join(tmp, f.name)
      if (!existsSync(dest)) {
        await fetchFile(f.url, dest, { size: f.size, sha256 }, signal, (got) => {
          download!.progress = (before + got) / total
          download!.bytes = total
          tellSoon()
        })
      }
      before += f.size
      // The CUDA runtime goes next to llama-server, where Windows looks for it.
      const into = f === pick.engine ? engineDir() : serverAt ? join(serverAt, '..') : engineDir()
      await extract(dest, into)
      if (f === pick.engine) {
        serverAt = findServer(engineDir())
        if (!serverAt) throw new Error('The AI engine download didn’t have llama-server in it.')
      }
    }
    await signForMac(join(serverAt!, '..'))
    c.server = serverAt!.slice(engineDir().length + 1)
    c.engine = pick.kind
    c.release = release.tag_name
    saveConfig()
    rmSync(tmp, { recursive: true, force: true })
  }

  // 2. The model.
  download!.stage = 'model'
  download!.progress = 0
  tell()
  const dest = join(modelsDir(), model.file)
  if (!existsSync(dest)) {
    const list = await getJson<HfFile[]>(`${HF}/api/models/${model.repo}/tree/main`, signal)
    const info = hfFileInfo(list, model.file)
    if (!info) throw new Error('Couldn’t find the model on Hugging Face. Try again later.')
    mkdirSync(modelsDir(), { recursive: true })
    await fetchFile(`${HF}/${model.repo}/resolve/main/${model.file}`, dest, info, signal, (got) => {
      download!.progress = got / info.size
      download!.bytes = info.size
      tellSoon()
    })
  }
  // Switching model: the old one goes.
  const old = localModelById(c.model)
  if (old && old.id !== model.id) {
    await stopServer()
    rmSync(join(modelsDir(), old.file), { force: true })
  }
  c.model = model.id
  saveConfig()
}

let tellTimer: ReturnType<typeof setTimeout> | null = null
function tellSoon(): void {
  if (tellTimer) return
  tellTimer = setTimeout(() => {
    tellTimer = null
    tell()
  }, 250)
}

export async function installLocalAi(modelId: string): Promise<LocalAiState> {
  if (!SUPPORTED) return localAiState()
  if (!download?.done || download.error) {
    const abort = new AbortController()
    lastError = undefined
    wanted = modelId
    const d: NonNullable<typeof download> = { stage: 'engine', progress: 0, bytes: 0, abort }
    download = d
    d.done = install(modelId, abort).then(
      () => {
        download = null
        wanted = undefined
      },
      (err) => {
        const stopped = abort.signal.aborted || err instanceof Stopped
        d.error = stopped ? 'Download paused. Press Download to carry on where it stopped.' : err instanceof Error ? err.message : String(err)
        wanted = undefined
        if (!stopped) logError('offline AI download', err)
      }
    )
    tell()
  }
  await download.done
  tell()
  return localAiState()
}

export function cancelLocalAi(): void {
  download?.abort.abort()
}

export async function removeLocalAi(): Promise<LocalAiState> {
  cancelLocalAi()
  await download?.done
  await stopServer()
  rmSync(dir(), { recursive: true, force: true })
  const c = loadConfig()
  config = { unloadForGames: c.unloadForGames }
  saveConfig()
  download = null
  lastError = undefined
  tell()
  return localAiState()
}

// ---------- running it ----------

interface Server {
  proc: ChildProcess
  port: number
  ready: boolean
  starting: Promise<void>
  log: string
}

let server: Server | null = null
let paused = false
let busy = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
const inflight = new Set<AbortController>()

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function startServer(): Promise<Server> {
  if (server) {
    await server.starting
    return server
  }
  const exe = serverPath()
  const model = modelPath()
  if (!exe || !model || !existsSync(exe) || !existsSync(model)) throw new Error('The offline AI isn’t downloaded yet. Get it in Settings → AI helper.')
  const port = await freePort()
  const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-ngl', '999', '-c', String(LOCAL_CONTEXT_TOKENS), '--jinja']
  const proc = spawn(exe, args, { cwd: join(exe, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const s: Server = { proc, port, ready: false, starting: Promise.resolve(), log: '' }
  const keep = (b: Buffer): void => {
    s.log = (s.log + b.toString()).slice(-4000)
  }
  proc.stdout?.on('data', keep)
  proc.stderr?.on('data', keep)
  let exited = false
  proc.on('exit', () => {
    exited = true
    if (server === s) {
      server = null
      tell()
    }
  })
  proc.on('error', (err) => {
    keep(Buffer.from(err.message))
    exited = true
  })
  server = s
  tell()
  s.starting = (async () => {
    // Loading a big model into the card can take a minute the first time.
    const until = Date.now() + 4 * 60_000
    while (Date.now() < until) {
      if (exited) break
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) {
          s.ready = true
          tell()
          return
        }
      } catch {
        // not listening yet
      }
      await wait(500)
    }
    logError('offline AI start', s.log)
    if (server === s) server = null
    proc.kill()
    tell()
    const memory = /out of memory|failed to allocate|cudaMalloc/i.test(s.log)
    throw new Error(
      memory
        ? 'The graphics card ran out of memory loading the offline AI. Close a game or other big app and try again, or pick the Quick model in Settings.'
        : 'The offline AI didn’t start. Try again, or remove it and download it again in Settings → AI helper.'
    )
  })()
  await s.starting
  return s
}

export async function stopServer(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  for (const a of inflight) a.abort()
  const s = server
  server = null
  if (!s) return
  await new Promise<void>((resolve) => {
    if (s.proc.exitCode !== null) return resolve()
    const t = setTimeout(() => {
      s.proc.kill('SIGKILL')
      resolve()
    }, 5000)
    s.proc.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
    s.proc.kill()
  })
  tell()
}

function idleLater(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (!busy) void stopServer()
  }, IDLE_MS)
}

export class GameRunningError extends Error {
  constructor() {
    super('A game is running, so the offline AI is switched off to keep your graphics card free for it. It’s back when the game closes.')
  }
}

export interface LocalMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** One answer from the offline AI. Loads it first if needed. */
export async function localComplete(messages: LocalMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  if (!localAiInstalled()) throw new Error('The offline AI isn’t downloaded yet. Get it in Settings → AI helper.')
  if (loadConfig().unloadForGames && (paused || gameRunning())) throw new GameRunningError()
  busy++
  const abort = new AbortController()
  inflight.add(abort)
  try {
    const s = await startServer()
    const timeout = setTimeout(() => abort.abort(), 5 * 60_000)
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          max_tokens: opts.maxTokens ?? 1500,
          temperature: opts.temperature ?? 0.3,
          stream: false,
          // Qwen3 answers straight away instead of thinking out loud first.
          chat_template_kwargs: { enable_thinking: false }
        }),
        signal: abort.signal
      })
    } catch (err) {
      if (paused) throw new GameRunningError()
      if (abort.signal.aborted) throw new Error('The offline AI took too long. Try a shorter question.')
      throw err
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (/context|too long|exceeds/i.test(body)) throw new Error('That was too much for the offline AI to read at once. Try a shorter question or note.')
      throw new Error(`The offline AI had a problem (${res.status}). Try again.`)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = cleanReply(data.choices?.[0]?.message?.content ?? '').text
    if (!text) throw new Error('The offline AI didn’t send anything back. Try again.')
    return data.choices![0].message!.content!
  } finally {
    inflight.delete(abort)
    busy--
    if (!busy) idleLater()
  }
}

export function setupLocalAi(): void {
  ipcMain.handle('localAi:state', async () => {
    await findGpu()
    return localAiState()
  })
  ipcMain.handle('localAi:install', (_e, model: string) => installLocalAi(String(model)))
  ipcMain.handle('localAi:cancel', () => cancelLocalAi())
  ipcMain.handle('localAi:remove', () => removeLocalAi())
  ipcMain.handle('localAi:unload', () => stopServer())
  ipcMain.handle('localAi:setUnloadForGames', (_e, on: boolean) => {
    loadConfig().unloadForGames = on === true
    saveConfig()
    if (on && gameRunning()) {
      paused = true
      void stopServer()
    } else if (!on) paused = false
    tell()
    return localAiState()
  })

  onGameRunning((playing) => {
    if (!loadConfig().unloadForGames) return
    paused = playing
    if (playing) void stopServer()
    tell()
  })

  app.on('will-quit', () => {
    server?.proc.kill()
  })
}
