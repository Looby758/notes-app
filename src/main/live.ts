import { app, ipcMain, net, safeStorage, type WebContents } from 'electron'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { ingestUrl, liveBitrate, parseFfmpegStats, type LiveService, type LiveStatus } from '@shared/live'
import { qualityById } from '@shared/studio'
import { IS_MAC } from '@shared/platform'
import { isAppPage } from './studio'
import { logError } from './log'

/**
 * The Studio's "Go live". The renderer records the scene (lib/studio.ts) in small pieces and sends
 * them here; ffmpeg turns them into the H.264/AAC stream that Twitch and YouTube take over RTMP.
 *
 * ffmpeg isn't part of Orbit: it's downloaded only if you ask (a box in the Windows installer, or
 * Settings → Studio), from a fixed release whose SHA-256 is checked before it's used. Stream keys
 * are stored encrypted on this computer (Electron safeStorage, like the AI helper's key) and never
 * go back to the page.
 */

// ---------- ffmpeg ----------

/** Static builds with x264, AAC and RTMP: https://github.com/eugeneware/ffmpeg-static (release b6.0). */
const FFMPEG_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0'
const FFMPEG_BUILDS: Record<string, { sha256: string; bytes: number }> = {
  'win32-x64': { sha256: '450d66226c79405c724e821f291cab0911e934bfa9fa2231adcab587f3e07b50', bytes: 28_894_894 },
  'darwin-arm64': { sha256: '6be74d6f449889c2e87a75873894f8520cad56c08ac76f2a628d85b0519daaca', bytes: 19_253_088 },
  'darwin-x64': { sha256: 'a12354fce7eb62361473bbe10d53a1893695babd35869ec8e92e5dfea8d0440b', bytes: 25_067_704 }
}
const BUILD = `${process.platform}-${process.arch}`

const ffmpegDir = (): string => join(app.getPath('userData'), 'ffmpeg')
const ffmpegPath = (): string => join(ffmpegDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
/** Left by the Windows installer when its "Download ffmpeg" box was ticked (build/installer.nsh). */
const wantedFlag = (): string => join(app.getPath('userData'), 'ffmpeg-wanted')

let download: { progress: number; error?: string } | null = null
const watchers = new Set<WebContents>()

function ffmpegState(): LiveStatus['ffmpeg'] {
  if (download && !download.error) return { state: 'downloading', progress: download.progress }
  if (existsSync(ffmpegPath())) return { state: 'ready' }
  if (!FFMPEG_BUILDS[BUILD]) return { state: 'unsupported' }
  return { state: 'missing', error: download?.error }
}

function broadcast(): void {
  const s = status()
  for (const wc of watchers) if (!wc.isDestroyed()) wc.send('live:status', s)
}

async function downloadFfmpeg(): Promise<void> {
  if (download && !download.error) return
  const build = FFMPEG_BUILDS[BUILD]
  if (!build) throw new Error('Live streaming isn’t available on this kind of computer yet.')
  download = { progress: 0 }
  broadcast()
  const dir = ffmpegDir()
  mkdirSync(dir, { recursive: true })
  const tmp = `${ffmpegPath()}.part`
  try {
    const res = await net.fetch(`${FFMPEG_RELEASE}/ffmpeg-${BUILD}.gz`)
    if (!res.ok || !res.body) throw new Error(`The download didn’t work (${res.status}).`)
    const hash = createHash('sha256')
    let got = 0
    let lastSent = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk)
        got += chunk.length
        const progress = Math.min(1, got / build.bytes)
        if (download && progress - lastSent > 0.01) {
          download.progress = progress
          lastSent = progress
          broadcast()
        }
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createGunzip(), createWriteStream(tmp))
    if (hash.digest('hex') !== build.sha256) throw new Error('The download was damaged or changed, so it wasn’t used. Try again.')
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    renameSync(tmp, ffmpegPath())
    // Apple Silicon only runs signed programs: sign it "ad hoc", like Orbit itself.
    if (IS_MAC) await new Promise<void>((resolve) => execFile('codesign', ['--force', '--sign', '-', ffmpegPath()], () => resolve()))
    rmSync(wantedFlag(), { force: true })
    download = null
  } catch (err) {
    rmSync(tmp, { force: true })
    download = { progress: 0, error: err instanceof Error ? err.message : String(err) }
    logError('ffmpeg download', err)
  } finally {
    broadcast()
  }
}

// ---------- stream keys ----------

interface Stored {
  /** Encrypted, by service. */
  keys?: Partial<Record<LiveService, string>>
  /** Your own server's address (for "Custom"), e.g. rtmp://example.com/live. Not secret. */
  customUrl?: string
  service?: LiveService
}

const storeFile = (): string => join(app.getPath('userData'), 'live.json')
function load(): Stored {
  try {
    return JSON.parse(readFileSync(storeFile(), 'utf8')) as Stored
  } catch {
    return {}
  }
}
function save(s: Stored): void {
  const tmp = `${storeFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, storeFile())
}

// ---------- going live ----------

interface Stream {
  proc: ChildProcessWithoutNullStreams
  key: string
  stopping: boolean
  lastLine: string
  owner: WebContents
}
let live: Stream | null = null

function status(): LiveStatus {
  const s = load()
  return {
    ffmpeg: ffmpegState(),
    keys: { twitch: !!s.keys?.twitch, youtube: !!s.keys?.youtube, custom: !!s.keys?.custom },
    customUrl: s.customUrl ?? '',
    service: s.service ?? 'twitch',
    canEncrypt: safeStorage.isEncryptionAvailable(),
    live: !!live
  }
}

/** Hides the stream key in anything ffmpeg says (it prints the address it's sending to). */
const scrub = (text: string, key: string): string => (key ? text.split(key).join('••••') : text)

function friendlyEnd(line: string, service: LiveService): string {
  if (/Connection refused|Input\/output error|Broken pipe|Connection reset/i.test(line)) {
    return `${service === 'youtube' ? 'YouTube' : service === 'twitch' ? 'Twitch' : 'The server'} closed the connection. Check your stream key is right and still valid.`
  }
  if (/Failed to resolve|Name or service not known|Network is unreachable|getaddrinfo/i.test(line)) return 'Couldn’t reach the streaming server. Check your internet connection.'
  return line || 'The stream stopped.'
}

function startLive(owner: WebContents, service: LiveService, qualityId: string): void {
  if (live) throw new Error('You’re already live.')
  if (!existsSync(ffmpegPath())) throw new Error('Get ffmpeg first (Settings → Studio).')
  const s = load()
  const enc = s.keys?.[service]
  if (!enc) throw new Error('Add your stream key first.')
  const key = safeStorage.decryptString(Buffer.from(enc, 'base64'))
  const url = ingestUrl(service, key, s.customUrl)
  if (!url) throw new Error('Add your server address first (it starts with rtmp:// or rtmps://).')
  const q = qualityById(qualityId)
  const kbps = liveBitrate(q, service)
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-stats',
    '-fflags', '+genpts',
    '-i', 'pipe:0',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-r', String(q.fps),
    '-g', String(q.fps * 2),
    '-b:v', `${kbps}k`,
    '-maxrate', `${kbps}k`,
    '-bufsize', `${kbps * 2}k`,
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'flv',
    url
  ]
  const proc = spawn(ffmpegPath(), args, { windowsHide: true })
  const stream: Stream = { proc, key, stopping: false, lastLine: '', owner }
  live = stream
  let buf = ''
  proc.stderr.on('data', (d: Buffer) => {
    buf += d.toString()
    const parts = buf.split(/[\r\n]+/)
    buf = parts.pop() ?? ''
    for (const raw of parts) {
      const line = scrub(raw.trim(), key)
      if (!line) continue
      const stats = parseFfmpegStats(line)
      if (stats) {
        if (!owner.isDestroyed()) owner.send('live:stats', stats)
      } else stream.lastLine = line
    }
  })
  proc.stdin.on('error', () => undefined)
  proc.on('error', (err) => (stream.lastLine = err.message))
  proc.on('close', (code) => {
    if (live === stream) live = null
    const error = stream.stopping || code === 0 ? undefined : friendlyEnd(stream.lastLine, service)
    if (error) logError('live stream', new Error(error))
    if (!owner.isDestroyed()) owner.send('live:ended', error ?? null)
    broadcast()
  })
  broadcast()
}

function stopLive(): void {
  const s = live
  if (!s) return
  s.stopping = true
  s.proc.stdin.end()
  // ffmpeg finishes sending what it has, then exits; if it doesn't, stop it.
  setTimeout(() => {
    if (s.proc.exitCode === null) s.proc.kill()
  }, 5000)
}

export function setupLive(): void {
  // Ticked in the Windows installer: fetch it in the background now.
  if (existsSync(wantedFlag()) && !existsSync(ffmpegPath())) void downloadFfmpeg()

  ipcMain.handle('live:status', (e) => {
    if (!watchers.has(e.sender)) {
      watchers.add(e.sender)
      e.sender.once('destroyed', () => watchers.delete(e.sender))
    }
    return status()
  })
  ipcMain.handle('live:getFfmpeg', async (e) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    await downloadFfmpeg()
    return status()
  })
  ipcMain.handle('live:removeFfmpeg', () => {
    if (live) throw new Error('Stop the stream first.')
    rmSync(ffmpegDir(), { recursive: true, force: true })
    broadcast()
    return status()
  })
  ipcMain.handle('live:setKey', (_e, service: LiveService, key: string, customUrl?: string) => {
    const s = load()
    if (customUrl !== undefined) {
      const u = customUrl.trim()
      if (u && !/^rtmps?:\/\//i.test(u)) throw new Error('The server address starts with rtmp:// or rtmps://.')
      s.customUrl = u
    }
    const k = key.trim()
    if (k) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the key securely, so it wasn’t saved.')
      s.keys = { ...s.keys, [service]: safeStorage.encryptString(k).toString('base64') }
    }
    save(s)
    broadcast()
    return status()
  })
  ipcMain.handle('live:clearKey', (_e, service: LiveService) => {
    const s = load()
    if (s.keys) delete s.keys[service]
    save(s)
    broadcast()
    return status()
  })
  ipcMain.handle('live:setService', (_e, service: LiveService) => {
    save({ ...load(), service })
    return status()
  })
  ipcMain.handle('live:start', (e, service: LiveService, quality: string) => {
    if (!isAppPage(e.sender)) throw new Error('Not allowed')
    startLive(e.sender, service, quality)
    // Keep sending while the window is minimised.
    e.sender.setBackgroundThrottling(false)
  })
  ipcMain.handle('live:chunk', (_e, data: Uint8Array) => {
    if (!live || live.stopping) return false
    live.proc.stdin.write(Buffer.from(data))
    return true
  })
  ipcMain.handle('live:stop', () => stopLive())
  app.on('before-quit', () => {
    if (live) live.proc.kill()
  })
}

