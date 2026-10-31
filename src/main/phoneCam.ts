import { app, ipcMain, type BrowserWindow } from 'electron'
import { createServer, type Server } from 'https'
import type { IncomingMessage, ServerResponse } from 'http'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IS_MAC } from '@shared/platform'
import { CAM_FPS, CAM_SIZES, HELPER_MSG, helperMessage, isJpeg, queueLayout, type CamQuality } from '@shared/phoneCam'
import type { CamStatus } from '@shared/types'
import { lanAddress, newToken, page } from './phoneLink'
import { phoneCamHtml } from './phoneCamPage'
import { camHelperScript } from './phoneCamHelper'
import { makeCertificate, type Certificate } from './selfSignedCert'
import { loadSettings, saveSettings } from './settings'
import { logError } from './log'

/**
 * The phone as a webcam. Orbit serves a page on the Wi-Fi (over https, which a phone needs before
 * it lets a page use the camera); the phone films and posts frames back; on Windows a helper
 * (phoneCamHelper.ts) turns them into "OBS Virtual Camera", which Discord, Zoom, Teams, the browser
 * and games all list as a webcam. That camera comes from OBS Studio: it needs installing once, but
 * OBS itself never has to be opened.
 *
 * A Mac doesn't need this: it has a camera, and an iPhone already works as one there (Continuity
 * Camera). The link and token are remembered so a page saved to the phone's Home Screen keeps
 * working, and if it was on when Orbit closed, it's on again next time.
 */

const MAX_FRAME = 6 * 1024 * 1024
/** Frames waiting for the helper beyond this are dropped, so the picture never lags. */
const MAX_QUEUED = 1024 * 1024
const PREVIEW_MS = 80
const OBS_CAMERA = 'OBS Virtual Camera'
// DirectShow's list of video capture devices; OBS's camera adds itself here when OBS is installed.
const VIDEO_DEVICES = 'HKCR\\CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance'

let getWindow: () => BrowserWindow | null = () => null
let server: Server | null = null
let port = 0
let token = ''
let on = false
let helper: ChildProcessWithoutNullStreams | null = null
let camera: CamStatus['camera'] = 'off'
let message = ''
let lastFrameAt = 0
let frames = 0
let fps = 0
let preview = false
let lastPreviewAt = 0
let ticker: ReturnType<typeof setInterval> | undefined

const quality = (): CamQuality => (loadSettings().camQuality === 'hd' ? 'hd' : 'sd')
const fill = (): boolean => loadSettings().camFill === true

function status(): CamStatus {
  let url = ''
  if (on && server) {
    try {
      url = `https://${lanAddress()}:${port}/c/${token}`
    } catch {
      url = ''
    }
  }
  return {
    on,
    url,
    phone: on && Date.now() - lastFrameAt < 2500,
    fps,
    camera: IS_MAC ? 'mac' : camera,
    message,
    quality: quality(),
    fill: fill()
  }
}

const push = (): void => getWindow()?.webContents.send('cam:status', status())

// --- The certificate (kept, so the phone only has to accept it once) ---

function certificate(): Certificate {
  const file = join(app.getPath('userData'), 'phone-webcam-cert.json')
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Certificate
      if (saved.key && saved.cert) return saved
    }
  } catch {
    // Unreadable: make a new one.
  }
  let ips: string[] = []
  try {
    ips = [lanAddress()]
  } catch {
    // Not on a network yet; the phone warns either way.
  }
  const made = makeCertificate('Orbit on this computer', ips)
  writeFileSync(file, JSON.stringify(made), { encoding: 'utf8', mode: 0o600 })
  return made
}

// --- The https server the phone talks to ---

function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('Frame too big'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
}

function frame(data: Buffer): void {
  const wasLive = Date.now() - lastFrameAt < 2500
  lastFrameAt = Date.now()
  frames++
  if (helper && camera === 'running' && helper.stdin.writableLength < MAX_QUEUED) helper.stdin.write(helperMessage(HELPER_MSG.frame, data))
  if (preview && lastFrameAt - lastPreviewAt >= PREVIEW_MS) {
    lastPreviewAt = lastFrameAt
    getWindow()?.webContents.send('cam:frame', new Uint8Array(data))
  }
  if (!wasLive) push()
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const match = /^\/c\/([A-Za-z0-9_-]{22})(\/[^?]*)?/.exec(req.url ?? '')
  if (!match || match[1] !== token) return page(res, 404, 'This link has run out', 'Open Phone webcam in Orbit and scan its code again.')
  const rest = match[2] || '/'
  const base = `/c/${token}`
  if (req.method === 'GET' && rest === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return void res.end(phoneCamHtml(base, quality()))
  }
  if (req.method === 'POST' && rest === '/frame') {
    try {
      const data = await body(req, MAX_FRAME)
      if (!on) return json(res, 200, { on: false })
      if (isJpeg(data)) frame(data)
      return json(res, 200, { on: true, quality: quality() })
    } catch {
      return json(res, 400, { error: 'Bad frame' })
    }
  }
  json(res, 404, { error: 'Not found' })
}

function startServer(): Promise<void> {
  if (server) return Promise.resolve()
  const saved = loadSettings()
  token = saved.camToken ?? newToken()
  return new Promise((resolve, reject) => {
    const { key, cert } = certificate()
    const listen = (wanted: number): void => {
      const s = createServer({ key, cert }, (req, res) => void route(req, res).catch((err) => logError('phone webcam', err)))
      s.keepAliveTimeout = 30_000
      s.on('error', (err: NodeJS.ErrnoException) => {
        if (wanted !== 0 && err.code === 'EADDRINUSE') return listen(0)
        logError('phone webcam', err)
        server = null
        reject(err)
      })
      // A phone that tapped through the warning but sends something odd shouldn't log noise.
      s.on('tlsClientError', () => {})
      s.listen(wanted, '0.0.0.0', () => {
        server = s
        port = (s.address() as { port: number }).port
        saveSettings({ camToken: token, camPort: port })
        resolve()
      })
    }
    listen(saved.camPort ?? 0)
  })
}

function stopServer(): void {
  server?.close()
  server?.closeAllConnections?.()
  server = null
}

// --- The Windows camera ---

/** Whether OBS Studio's camera is installed (it's in the list apps pick webcams from). */
function hasDriver(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('reg', ['query', VIDEO_DEVICES, '/s', '/f', OBS_CAMERA, '/d'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      resolve(!err && stdout.includes(OBS_CAMERA))
    })
  })
}

function startHelper(): void {
  const { width, height } = CAM_SIZES[quality()]
  const file = join(app.getPath('userData'), 'phone-webcam.ps1')
  writeFileSync(file, camHelperScript(width, height, queueLayout(width, height, CAM_FPS), fill()), 'utf8')
  const child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true })
  helper = child
  camera = 'starting'
  message = ''
  let out = ''
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString()
    let nl: number
    while ((nl = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, nl).trim()
      out = out.slice(nl + 1)
      if (helper !== child) continue
      if (line === 'READY') camera = 'running'
      else if (line === 'IN_USE') {
        camera = 'in-use'
        message = 'Something else is already the OBS Virtual Camera. If OBS Studio is open, click Stop Virtual Camera there (or close OBS), then try again.'
      } else if (line.startsWith('ERR ')) {
        camera = 'error'
        message = line.slice(4)
      } else continue
      push()
    }
  })
  let errors = ''
  child.stderr.on('data', (d: Buffer) => (errors += d.toString()))
  child.stdin.on('error', () => {})
  child.on('error', (err) => {
    logError('phone webcam', err)
    if (helper !== child) return
    camera = 'error'
    message = 'Windows PowerShell couldn’t start, so the webcam can’t either.'
    push()
  })
  child.on('exit', (code) => {
    if (helper !== child) return
    helper = null
    if (camera === 'starting' || camera === 'running') {
      if (errors.trim()) logError('phone webcam', new Error(errors.trim().slice(0, 2000)))
      camera = 'error'
      message = `The webcam stopped unexpectedly${code ? ` (code ${code})` : ''}. Turn it off and on again.`
    }
    push()
  })
}

function stopHelper(): void {
  const child = helper
  helper = null
  if (!child) return
  // Closing its input lets it mark the camera stopped (so apps show their own "no camera" picture) and exit.
  child.stdin.end()
  setTimeout(() => {
    if (child.exitCode === null) child.kill()
  }, 3000)
}

async function startCamera(): Promise<void> {
  if (IS_MAC) return
  stopHelper()
  camera = 'starting'
  push()
  const installed = await hasDriver()
  if (!on || helper) return
  if (!installed) {
    camera = 'no-driver'
    message = ''
    return push()
  }
  startHelper()
  push()
}

// --- Turning it on and off ---

async function turnOn(): Promise<CamStatus> {
  if (IS_MAC) return status()
  on = true
  saveSettings({ camOn: true })
  try {
    await startServer()
  } catch (err) {
    on = false
    saveSettings({ camOn: false })
    throw err
  }
  clearInterval(ticker)
  ticker = setInterval(() => {
    fps = frames
    frames = 0
    push()
  }, 1000)
  await startCamera()
  return status()
}

function turnOff(): CamStatus {
  on = false
  saveSettings({ camOn: false })
  clearInterval(ticker)
  ticker = undefined
  fps = 0
  frames = 0
  lastFrameAt = 0
  stopHelper()
  stopServer()
  camera = 'off'
  message = ''
  push()
  return status()
}

export function stopPhoneCam(): void {
  stopHelper()
  stopServer()
}

export function setupPhoneCam(window: () => BrowserWindow | null): void {
  getWindow = window
  ipcMain.handle('cam:status', () => status())
  ipcMain.handle('cam:on', () => turnOn())
  ipcMain.handle('cam:off', () => turnOff())
  ipcMain.handle('cam:retry', async () => {
    if (on) await startCamera()
    return status()
  })
  ipcMain.handle('cam:preview', (_e, want: boolean) => {
    preview = want === true
  })
  ipcMain.handle('cam:set', async (_e, patch: { quality?: CamQuality; fill?: boolean }) => {
    if (patch.fill !== undefined && patch.fill !== fill()) {
      saveSettings({ camFill: patch.fill === true })
      if (helper && camera === 'running') helper.stdin.write(helperMessage(HELPER_MSG.fill, Uint8Array.of(patch.fill ? 1 : 0)))
    }
    if ((patch.quality === 'sd' || patch.quality === 'hd') && patch.quality !== quality()) {
      saveSettings({ camQuality: patch.quality })
      // The camera's size is fixed while it runs, so it starts again at the new size.
      if (on) await startCamera()
    }
    push()
    return status()
  })
  ipcMain.handle('cam:newLink', async () => {
    const was = on
    turnOff()
    saveSettings({ camToken: undefined })
    return was ? turnOn() : status()
  })
  if (loadSettings().camOn && !IS_MAC) turnOn().catch((err) => logError('phone webcam', err))
  app.on('before-quit', stopPhoneCam)
}
