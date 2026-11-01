import { app, BrowserWindow, clipboard, ipcMain, nativeImage, Notification, screen, shell, type WebContents } from 'electron'
import { createSocket, type Socket as UdpSocket } from 'dgram'
import { createServer, connect as tcpConnect, type Server, type Socket } from 'net'
import { createHash, randomBytes } from 'crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { hostname, networkInterfaces } from 'os'
import { basename, dirname, extname, join, relative } from 'path'
import { IS_MAC } from '@shared/platform'
import {
  deviceName,
  edgeHit,
  entryPoint,
  isKnownKey,
  movePointer,
  oppositeSide,
  pairingCode,
  safeRelativePath,
  SHARE_SIDES,
  swapCtrlCmd,
  type Point,
  type Rect,
  type ShareButton,
  type ShareMessage,
  type ShareOs
} from '@shared/mouseShare'
import type { ShareInputEvent, ShareSaved, ShareStatus } from '@shared/types'
import { deriveKeys, frame, FrameReader, Line, newHandshake, type Handshake } from './shareCrypto'
import { inputAllowed, leftButtonDown, movePointerTo, pressButton, pressKey, releaseAll, scroll, setSwapCtrlCmd, stopShareInput } from './shareInput'
import { loadRenderer } from './capture'
import { loadSettings, saveSettings } from './settings'
import { logError } from './log'

/**
 * One mouse, two computers (a Windows PC and a MacBook, both running Orbit). Push the pointer off
 * the edge of one screen and it carries on onto the other computer's screen, with the keyboard;
 * push it back and it comes home. Copy on one, paste on the other. Drag a file to the edge and drop
 * it on the strip that appears, and it lands in the other computer's Downloads.
 *
 * How it works:
 * - The two find each other on the Wi-Fi (a small "I'm here" broadcast) and pair once by checking
 *   the same 6-digit code shows on both screens. After that they connect by themselves, over an
 *   encrypted line (see shareCrypto.ts).
 * - The computer with the mouse watches the pointer. When it's pressed against the shared edge, an
 *   invisible full-screen window takes the mouse and keyboard ("pointer lock"), and everything you
 *   do in it is sent across. The other computer does it (see shareInput.ts) and watches for the
 *   pointer coming back over its edge.
 * - The clipboard is passed over each time the pointer crosses, so whatever you copied on one is
 *   ready to paste on the other.
 */

const UDP_PORT = 47820
const TCP_PORT = 47821
const MAX_PNG = 10 * 1024 * 1024
const CHUNK = 64 * 1024

interface Hello {
  t: 'hello'
  v: 1
  id: string
  name: string
  os: ShareOs
  pub: string
  pair?: boolean
}

interface Nearby {
  id: string
  name: string
  os: ShareOs
  host: string
  port: number
  seen: number
}

let getMainWindow: () => BrowserWindow | null = () => null
let isSecret: (text: string) => boolean = () => false
let saved: ShareSaved
let server: Server | null = null
let udp: UdpSocket | null = null
let beaconTimer: ReturnType<typeof setInterval> | undefined
let watchTimer: ReturnType<typeof setInterval> | undefined
let reconnectTimer: ReturnType<typeof setInterval> | undefined
let listenPort = TCP_PORT
let listening = false
const nearby = new Map<string, Nearby>()
let live: Conn | null = null
let pairing: { conn: Conn; code: string; weOk: boolean; theyOk: boolean; timer: ReturnType<typeof setTimeout> } | null = null
let connecting = false
let lastError = ''

/** Where the mouse is being used: on this computer, or on the other one. */
let using: 'here' | 'there' = 'here'
/** This computer is being driven by the other one. */
let controlled = false
let pointer: Point = { x: 0, y: 0 }
let lastSetAt = 0
let takeoverTimer: ReturnType<typeof setInterval> | undefined
/** The edge must be let go of (pointer moved away) before it works again: stops bouncing back and forth. */
let armed = true
let checkingEdge = false
let lastF = 0.5
let pending = { dx: 0, dy: 0 }
let flushTimer: ReturnType<typeof setTimeout> | undefined
let lockTimer: ReturnType<typeof setTimeout> | undefined
let lastClipSig = ''

let captureWin: BrowserWindow | null = null
let dropWin: BrowserWindow | null = null
let dropShown: { f: number; since: number; poll?: ReturnType<typeof setInterval> } | null = null

// ---------- Saved settings ----------

function defaults(): ShareSaved {
  return { enabled: false, id: randomBytes(12).toString('base64url'), side: IS_MAC ? 'left' : 'right', swapCtrlCmd: true, shareClipboard: true, speed: 1 }
}

function load(): ShareSaved {
  const raw = loadSettings().mouseShare
  const d = defaults()
  if (!raw || typeof raw !== 'object') return d
  return {
    enabled: raw.enabled === true,
    id: typeof raw.id === 'string' && raw.id.length >= 8 ? raw.id : d.id,
    peer:
      raw.peer && typeof raw.peer.id === 'string' && typeof raw.peer.secret === 'string'
        ? { id: raw.peer.id, name: String(raw.peer.name ?? 'Computer'), os: raw.peer.os === 'mac' ? 'mac' : 'win', secret: raw.peer.secret, host: raw.peer.host, port: raw.peer.port }
        : undefined,
    side: SHARE_SIDES.includes(raw.side) ? raw.side : d.side,
    swapCtrlCmd: raw.swapCtrlCmd !== false,
    shareClipboard: raw.shareClipboard !== false,
    speed: typeof raw.speed === 'number' && raw.speed >= 0.25 && raw.speed <= 4 ? raw.speed : 1,
    paused: raw.paused === true,
    manualHost: typeof raw.manualHost === 'string' ? raw.manualHost.slice(0, 100) : undefined
  }
}

function save(patch: Partial<ShareSaved>): void {
  saved = { ...saved, ...patch }
  saveSettings({ mouseShare: saved })
  setSwapCtrlCmd(saved.swapCtrlCmd)
  announce()
}

const thisName = (): string => deviceName(hostname())
const thisOs: ShareOs = IS_MAC ? 'mac' : 'win'

export function shareStatus(): ShareStatus {
  const now = Date.now()
  return {
    enabled: saved.enabled,
    name: thisName(),
    os: thisOs,
    paired: saved.peer ? { name: saved.peer.name, os: saved.peer.os } : null,
    connected: !!live?.ready,
    side: saved.side,
    swapCtrlCmd: saved.swapCtrlCmd,
    shareClipboard: saved.shareClipboard,
    speed: saved.speed,
    paused: saved.paused === true,
    manualHost: saved.manualHost ?? '',
    nearby: [...nearby.values()].filter((n) => now - n.seen < 10_000 && n.id !== saved.peer?.id).map(({ id, name, os }) => ({ id, name, os })),
    pairing: pairing ? { name: pairing.conn.peer?.name ?? 'Computer', code: pairing.code, weConfirmed: pairing.weOk } : null,
    using: controlled ? 'controlled' : using,
    accessibility: inputAllowed(false),
    error: lastError
  }
}

let announceTimer: ReturnType<typeof setTimeout> | undefined
function announce(): void {
  clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('share:status', shareStatus())
  }, 30)
}

function fail(message: string): void {
  lastError = message
  announce()
}

// ---------- The connection ----------

class Conn {
  private reader = new FrameReader()
  private hs: Handshake = newHandshake()
  private line: Line | null = null
  peer: Hello | null = null
  ready = false
  closed = false
  lastHeard = Date.now()
  private pingTimer: ReturnType<typeof setInterval>

  constructor(
    readonly socket: Socket,
    readonly initiator: boolean,
    public pair: boolean,
    private onReady: (c: Conn) => void,
    private onMessage: (c: Conn, m: ShareMessage) => void,
    private onClose: (c: Conn) => void
  ) {
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 10_000)
    socket.on('data', (d: Buffer) => {
      try {
        for (const f of this.reader.push(d)) this.frame(f)
      } catch (err) {
        logError('mouse sharing', err)
        this.close()
      }
    })
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
    // Nothing heard for a while: the other computer went to sleep or left the network.
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastHeard > 15_000) return this.close()
      if (this.ready) this.send({ t: 'ping' })
    }, 5_000)
    // A connection that never finishes saying hello is dropped.
    setTimeout(() => !this.ready && this.close(), 10_000)
    if (initiator) this.sayHello()
  }

  private sayHello(): void {
    const hello: Hello = { t: 'hello', v: 1, id: saved.id, name: thisName(), os: thisOs, pub: this.hs.publicKey.toString('base64'), pair: this.pair || undefined }
    this.socket.write(frame(Buffer.from(JSON.stringify(hello))))
  }

  private frame(f: Buffer): void {
    this.lastHeard = Date.now()
    if (!this.peer) {
      const hello = JSON.parse(f.toString('utf8')) as Hello
      if (hello.t !== 'hello' || hello.v !== 1 || typeof hello.id !== 'string' || typeof hello.pub !== 'string' || hello.id === saved.id) return this.close()
      hello.name = deviceName(String(hello.name ?? ''))
      hello.os = hello.os === 'mac' ? 'mac' : 'win'
      if (!this.initiator) this.pair = hello.pair === true
      // The computer that was connected to decides whether to talk at all.
      if (!this.initiator && !accepts(hello, this)) return this.close()
      this.peer = hello
      if (!this.initiator) this.sayHello()
      const secret = this.pair ? null : Buffer.from(saved.peer?.secret ?? '', 'base64')
      if (!this.pair && (!secret || secret.length !== 32 || saved.peer?.id !== hello.id)) return this.close()
      const keys = deriveKeys(this.hs, Buffer.from(hello.pub, 'base64'), this.initiator, secret)
      this.line = new Line(keys)
      this.pairSecret = keys.pairSecret.toString('base64')
      this.code = pairingCode(keys.transcript)
      this.send({ t: 'ready' })
      return
    }
    if (!this.line) return
    // Fails (and drops the line) if it wasn't sealed with this line's keys: wrong or old pairing.
    const message = JSON.parse(this.line.open(f).toString('utf8')) as ShareMessage
    if (message.t === 'ready') {
      if (!this.ready) {
        this.ready = true
        this.onReady(this)
      }
      return
    }
    if (message.t === 'ping' || !this.ready) return
    this.onMessage(this, message)
  }

  pairSecret = ''
  code = ''

  send(m: ShareMessage): void {
    if (this.closed || !this.line) return
    this.socket.write(frame(this.line.seal(Buffer.from(JSON.stringify(m)))))
  }

  /** Waits while lots is queued up to go (big files), so mouse moves don't wait behind it. */
  async roomToSend(): Promise<void> {
    while (!this.closed && this.socket.writableLength > 256 * 1024) await new Promise((r) => setTimeout(r, 5))
    if (this.closed) throw new Error('The other computer went away.')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.pingTimer)
    // end() first, so a last message (like "the codes match") still gets there.
    this.socket.end()
    setTimeout(() => this.socket.destroy(), 1000)
    this.onClose(this)
  }
}

/** Whether to talk to a computer that connected here. */
function accepts(hello: Hello, conn: Conn): boolean {
  if (!saved.enabled) return false
  if (conn.pair) return !pairing
  return saved.peer?.id === hello.id
}

/** Which of two connections to the same computer to keep: the one started by the smaller id, on both sides. */
function startedBy(c: Conn): string {
  return c.initiator ? saved.id : (c.peer?.id ?? '')
}

function connReady(c: Conn): void {
  if (c.pair) {
    lastError = ''
    pairing = {
      conn: c,
      code: c.code,
      weOk: false,
      theyOk: false,
      timer: setTimeout(() => cancelPairing('Pairing took too long. Try again.'), 120_000)
    }
    // Bring Orbit forward on the computer that didn't start it, so the code can be checked there.
    const win = getMainWindow()
    if (!c.initiator && win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('share:openSettings')
    }
    announce()
    return
  }
  if (live && live !== c && live.ready) {
    if (startedBy(live) < startedBy(c)) return c.close()
    const old = live
    live = c
    old.close()
  }
  live = c
  lastError = ''
  if (c.peer && saved.peer) {
    const host = c.socket.remoteAddress?.replace(/^::ffff:/, '')
    const changed = saved.peer.name !== c.peer.name || saved.peer.host !== host
    if (changed) save({ peer: { ...saved.peer, name: c.peer.name, os: c.peer.os, host: host ?? saved.peer.host } })
  }
  // Remind the other computer where it sits, in case it was changed while they were apart.
  c.send({ t: 'side', side: oppositeSide(saved.side) })
  prepareWindows()
  startWatching()
  announce()
  for (const fn of linkListeners) fn(true)
}

function connClosed(c: Conn): void {
  if (pairing?.conn === c) {
    clearTimeout(pairing.timer)
    pairing = null
    if (!saved.peer) fail('The pairing stopped. Try again.')
  }
  if (live === c) {
    live = null
    if (using === 'there') comeHome(undefined, false)
    if (controlled) stopBeingControlled()
    stopWatching()
    abortIncoming()
    destroyWindows()
    for (const fn of linkListeners) fn(false)
  }
  announce()
}

function newConn(socket: Socket, initiator: boolean, pair: boolean): Conn {
  return new Conn(socket, initiator, pair, connReady, onMessage, connClosed)
}

function listen(): void {
  if (server) return
  const s = createServer((socket) => void newConn(socket, false, false))
  s.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && listenPort === TCP_PORT) {
      listenPort = 0
      server = null
      return listen()
    }
    logError('mouse sharing', err)
    fail('Couldn’t start mouse sharing on this network.')
  })
  s.listen(listenPort, '0.0.0.0', () => {
    listenPort = (s.address() as { port: number }).port
    listening = true
    // Say "I'm here" once the port is known (not before, or the other computer dials the wrong one).
    beacon()
  })
  server = s
}

function dial(host: string, port: number, pair: boolean): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host, port, timeout: 4000 })
    socket.once('connect', () => {
      socket.setTimeout(0)
      resolve(newConn(socket, true, pair))
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('timeout'))
    })
    socket.once('error', reject)
  })
}

/** Tries to reach the paired computer (where it was last heard of), if not connected. */
async function reconnect(): Promise<void> {
  if (!saved.enabled || !saved.peer || live || connecting) return
  const seen = nearby.get(saved.peer.id)
  const targets = [seen && { host: seen.host, port: seen.port }, saved.peer.host && { host: saved.peer.host, port: saved.peer.port ?? TCP_PORT }, saved.manualHost && { host: saved.manualHost, port: TCP_PORT }].filter(
    (t): t is { host: string; port: number } => !!t
  )
  if (!targets.length) return
  connecting = true
  try {
    for (const t of targets) {
      try {
        await dial(t.host, t.port, false)
        break
      } catch {
        // Try the next address.
      }
    }
  } finally {
    connecting = false
  }
}

// ---------- Finding each other ----------

function broadcastAddresses(): string[] {
  const out = new Set(['255.255.255.255'])
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'))
    }
  }
  return [...out]
}

function startDiscovery(): void {
  if (udp) return
  const sock = createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('error', (err) => {
    logError('mouse sharing (finding computers)', err)
    sock.close()
    if (udp === sock) udp = null
  })
  sock.on('message', (msg, rinfo) => {
    try {
      const m = JSON.parse(msg.toString('utf8'))
      if (m?.orbit !== 'share' || m.v !== 1 || typeof m.id !== 'string' || m.id === saved.id) return
      const known = nearby.has(m.id)
      nearby.set(m.id, { id: m.id, name: deviceName(String(m.name ?? '')), os: m.os === 'mac' ? 'mac' : 'win', host: rinfo.address, port: Number(m.port) || TCP_PORT, seen: Date.now() })
      if (!known) announce()
      if (m.id === saved.peer?.id && !live) void reconnect()
    } catch {
      // Not ours.
    }
  })
  sock.bind(UDP_PORT, () => {
    sock.setBroadcast(true)
    beacon()
  })
  udp = sock
  beaconTimer = setInterval(beacon, 3000)
  reconnectTimer = setInterval(() => {
    void reconnect()
    // Forget computers that have gone quiet.
    for (const [id, n] of nearby) if (Date.now() - n.seen > 15_000) nearby.delete(id)
  }, 4000)
}

function beacon(): void {
  if (!udp || !listening) return
  const msg = Buffer.from(JSON.stringify({ orbit: 'share', v: 1, id: saved.id, name: thisName(), os: thisOs, port: listenPort }))
  for (const address of broadcastAddresses()) udp.send(msg, UDP_PORT, address, () => undefined)
}

function stopNetwork(): void {
  clearInterval(beaconTimer)
  clearInterval(reconnectTimer)
  udp?.close()
  udp = null
  server?.close()
  server = null
  listening = false
  listenPort = TCP_PORT
  live?.close()
  if (pairing) cancelPairing('')
  nearby.clear()
}

// ---------- Pairing ----------

async function startPairing(target: { id?: string; host?: string }): Promise<void> {
  if (pairing) throw new Error('Already pairing.')
  lastError = ''
  const n = target.id ? nearby.get(target.id) : undefined
  const host = n?.host ?? target.host?.trim()
  if (!host) throw new Error('That computer isn’t on the network any more.')
  try {
    await dial(host, n?.port ?? TCP_PORT, true)
  } catch {
    throw new Error(`Couldn’t reach ${n?.name ?? host}. Check Orbit is open there with “Share mouse and keyboard” on.`)
  }
}

function confirmPairing(): void {
  if (!pairing) return
  pairing.weOk = true
  pairing.conn.send({ t: 'pair-ok' })
  finishPairing()
  announce()
}

function finishPairing(): void {
  if (!pairing || !pairing.weOk || !pairing.theyOk) return
  const { conn } = pairing
  clearTimeout(pairing.timer)
  pairing = null
  const peer = conn.peer!
  // A new pairing replaces the old one; the line stays open as the live connection, started over.
  live?.close()
  save({ peer: { id: peer.id, name: peer.name, os: peer.os, secret: conn.pairSecret, host: conn.socket.remoteAddress?.replace(/^::ffff:/, ''), port: conn.initiator ? conn.socket.remotePort : undefined } })
  conn.close()
  // The computer that started pairing reconnects now with the saved secret.
  if (conn.initiator) setTimeout(() => void reconnect(), 300)
}

function cancelPairing(message: string): void {
  if (!pairing) return
  const { conn, timer } = pairing
  clearTimeout(timer)
  pairing = null
  conn.close()
  if (message) fail(message)
  announce()
}

function unpair(tell: boolean): void {
  if (tell) live?.send({ t: 'unpair' })
  live?.close()
  save({ peer: undefined })
}

// ---------- Watching the edge (the computer with the mouse) ----------

const displayRects = (): Rect[] => screen.getAllDisplays().map((d) => d.bounds)

function startWatching(): void {
  if (watchTimer) return
  watchTimer = setInterval(watchEdge, 16)
}

function stopWatching(): void {
  clearInterval(watchTimer)
  watchTimer = undefined
}

function watchEdge(): void {
  if (!live?.ready || using !== 'here' || controlled || saved.paused || crossingHeld || checkingEdge || dropShown) return
  const f = edgeHit(screen.getCursorScreenPoint(), displayRects(), saved.side)
  if (f === null) {
    armed = true
    return
  }
  if (!armed) return
  armed = false
  checkingEdge = true
  // Dragging something to the edge: offer the drop strip instead of going over (and a window
  // dragged to the edge stays on this screen).
  void leftButtonDown()
    .then((dragging) => (dragging ? showDrop(f) : goThere(f)))
    .catch((err) => logError('mouse sharing', err))
    .finally(() => (checkingEdge = false))
}

function goThere(f: number): void {
  if (!live?.ready || using === 'there') return
  if (!inputAllowed(true)) return fail('Allow Orbit in System Settings → Privacy & Security → Accessibility, then try again.')
  lastF = f
  syncClipboard()
  using = 'there'
  live.send({ t: 'enter', f })
  showCapture()
  announce()
}

/** The pointer comes back. `f` is where along the edge (to put it there); `tell` lets the other computer know. */
function comeHome(f: number | undefined, tell: boolean): void {
  if (using !== 'there') return
  using = 'here'
  clearTimeout(lockTimer)
  hideCapture()
  flushMoves()
  if (tell) live?.send({ t: 'release' })
  const at = entryPoint(displayRects(), saved.side, f ?? lastF)
  // Without an exact spot, come back a little further in, so it doesn't go straight over again.
  if (f === undefined) {
    const step = 40
    at.x += saved.side === 'left' ? step : saved.side === 'right' ? -step : 0
    at.y += saved.side === 'above' ? step : saved.side === 'below' ? -step : 0
  }
  movePointerTo(at.x, at.y)
  armed = false
  announce()
}

// ---------- The invisible window that takes the mouse while it's on the other computer ----------

const windowPrefs = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
})

function prepareWindows(): void {
  if (!captureWin || captureWin.isDestroyed()) {
    captureWin = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      title: 'Mouse sharing',
      ...(IS_MAC ? { type: 'panel' } : {}),
      webPreferences: windowPrefs()
    })
    captureWin.setAlwaysOnTop(true, 'screen-saver')
    if (IS_MAC) captureWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    captureWin.on('closed', () => (captureWin = null))
    // Clicking away (Alt+Tab, the Windows key) brings the mouse home rather than leaving it stuck.
    captureWin.on('blur', () => using === 'there' && comeHome(undefined, true))
    loadRenderer(captureWin, 'share-capture')
  }
  if (!dropWin || dropWin.isDestroyed()) {
    dropWin = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      title: 'Drop to send',
      ...(IS_MAC ? { type: 'panel' } : {}),
      webPreferences: windowPrefs()
    })
    dropWin.setAlwaysOnTop(true, 'screen-saver')
    if (IS_MAC) dropWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    dropWin.on('closed', () => (dropWin = null))
    loadRenderer(dropWin, 'share-drop')
  }
}

function destroyWindows(): void {
  captureWin?.destroy()
  captureWin = null
  dropWin?.destroy()
  dropWin = null
  dropShown = null
}

function showCapture(): void {
  prepareWindows()
  const win = captureWin!
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds(display.bounds)
  win.webContents.send('share:capture', { name: saved.peer?.name ?? 'the other computer', os: saved.peer?.os ?? 'mac' })
  win.show()
  win.focus()
  if (IS_MAC) app.focus({ steal: true })
  // Pointer lock needs a "user gesture"; this counts as one.
  const lock = (): Promise<unknown> => win.webContents.executeJavaScript('window.__shareLock && window.__shareLock()', true).catch(() => undefined)
  void lock()
  // Windows doesn't always let an app come to the front by itself; a click on the (invisible,
  // on-top) window does it.
  if (!IS_MAC) {
    setTimeout(() => {
      if (using !== 'there' || win.isDestroyed() || win.isFocused()) return
      pressButton(0, true)
      pressButton(0, false)
      setTimeout(() => void lock(), 60)
    }, 150)
  }
  clearTimeout(lockTimer)
  // If the mouse couldn't be taken, don't leave it stranded.
  lockTimer = setTimeout(() => {
    void win.webContents
      .executeJavaScript('!!document.pointerLockElement')
      .then((locked: boolean) => {
        if (!locked && using === 'there') {
          comeHome(undefined, true)
          fail('Orbit couldn’t take the mouse that time. Try again; if it keeps happening, click Orbit first.')
        }
      })
      .catch(() => undefined)
  }, 1200)
}

function hideCapture(): void {
  const win = captureWin
  if (!win || win.isDestroyed()) return
  void win.webContents.executeJavaScript('document.exitPointerLock()').catch(() => undefined)
  win.hide()
}

function flushMoves(): void {
  clearTimeout(flushTimer)
  flushTimer = undefined
  const { dx, dy } = pending
  pending = { dx: 0, dy: 0 }
  if ((dx || dy) && using === 'there') live?.send({ t: 'move', dx: Math.round(dx), dy: Math.round(dy) })
}

/** Something done in the invisible window: send it over. */
function onCaptureInput(e: ShareInputEvent): void {
  if (using !== 'there' || !live?.ready) return
  switch (e.t) {
    case 'move':
      pending.dx += clampN(e.dx, 1000) * saved.speed
      pending.dy += clampN(e.dy, 1000) * saved.speed
      // Mice report up to 1000 times a second: send them a few milliseconds' worth at a time.
      flushTimer ??= setTimeout(flushMoves, 4)
      return
    case 'btn':
      if (![0, 1, 2].includes(e.b)) return
      flushMoves()
      live.send({ t: 'btn', b: e.b, down: e.down === true })
      return
    case 'wheel':
      flushMoves()
      live.send({ t: 'wheel', dx: clampN(e.dx, 5000), dy: clampN(e.dy, 5000) })
      return
    case 'key':
      if (typeof e.code !== 'string' || !isKnownKey(e.code)) return
      // On a Mac, ⌘ goes over as Ctrl (and Ctrl as ⌘) when that's on, so ⌘C copies on the PC.
      live.send({ t: 'key', code: IS_MAC && saved.swapCtrlCmd ? swapCtrlCmd(e.code) : e.code, down: e.down === true })
      return
  }
}

const clampN = (n: unknown, max: number): number => Math.max(-max, Math.min(max, Number(n) || 0))

// ---------- Being controlled (the computer without the mouse) ----------

function startBeingControlled(f: number): void {
  if (!inputAllowed(true)) {
    fail('Allow Orbit in System Settings → Privacy & Security → Accessibility, so the other computer’s mouse can work here.')
    live?.send({ t: 'leave', f })
    return
  }
  controlled = true
  pointer = entryPoint(displayRects(), saved.side, f)
  movePointerTo(pointer.x, pointer.y)
  lastSetAt = Date.now()
  clearInterval(takeoverTimer)
  // Someone picked up this computer's own mouse or trackpad: hand control back to it.
  takeoverTimer = setInterval(() => {
    if (!controlled || dropShown || Date.now() - lastSetAt < 500) return
    const at = screen.getCursorScreenPoint()
    if (Math.hypot(at.x - pointer.x, at.y - pointer.y) > 40) {
      stopBeingControlled()
      syncClipboard()
      live?.send({ t: 'leave' })
    }
  }, 250)
  announce()
}

function stopBeingControlled(): void {
  controlled = false
  heldLeft = false
  clearInterval(takeoverTimer)
  releaseAll()
  hideDrop()
  announce()
}

let heldLeft = false

function controlledMove(dx: number, dy: number): void {
  if (!controlled) return
  const { point, back } = movePointer(pointer, dx, dy, displayRects(), saved.side)
  if (back !== null) {
    // Dragging something back home: show the drop strip here rather than going.
    if (heldLeft) {
      if (!dropShown) showDrop(back)
      return
    }
    stopBeingControlled()
    syncClipboard()
    live?.send({ t: 'leave', f: back })
    return
  }
  pointer = point
  lastSetAt = Date.now()
  movePointerTo(point.x, point.y)
}

function onMessage(c: Conn, m: ShareMessage): void {
  // The pairing line only carries "the codes match".
  if (pairing?.conn === c) {
    if (m.t === 'pair-ok') {
      pairing.theyOk = true
      finishPairing()
      announce()
    }
    return
  }
  if (c !== live) return
  switch (m.t) {
    case 'enter':
      if (using === 'there') comeHome(undefined, false)
      return startBeingControlled(clampN(m.f, 1))
    case 'move':
      return controlledMove(clampN(m.dx, 4000), clampN(m.dy, 4000))
    case 'btn':
      if (!controlled) return
      if (m.b === 0) heldLeft = m.down === true
      pressButton(m.b as ShareButton, m.down === true)
      lastSetAt = Date.now()
      if (m.b === 0 && !m.down && dropShown) setTimeout(() => dropShown && Date.now() - dropShown.since > 200 && hideDrop(), 600)
      return
    case 'wheel':
      if (controlled) scroll(clampN(m.dx, 5000), clampN(m.dy, 5000))
      return
    case 'key':
      if (controlled && typeof m.code === 'string') pressKey(m.code, m.down === true)
      return
    case 'leave':
      return comeHome(typeof m.f === 'number' ? clampN(m.f, 1) : undefined, false)
    case 'release':
      if (controlled) {
        stopBeingControlled()
        syncClipboard()
      }
      return
    case 'clip':
      return receiveClipboard(m)
    case 'side':
      if (SHARE_SIDES.includes(m.side) && m.side !== saved.side) save({ side: m.side })
      return
    case 'unpair':
      return unpair(false)
    case 'file-start':
    case 'file-data':
    case 'file-end':
    case 'files-done':
      // One at a time and in order (each part waits for the disk).
      fileQueue = fileQueue.then(() => receiveFile(m)).catch((err) => logError('mouse sharing (file)', err))
      return
    case 'scr-start':
    case 'scr-sig':
    case 'scr-in':
    case 'scr-stop':
      for (const fn of screenListeners) fn(m)
      return
    case 'pair-ok':
      return
  }
}

// ---------- For the other features that use this link (screens, dropping files) ----------

type ScreenMessage = Extract<ShareMessage, { t: 'scr-start' | 'scr-sig' | 'scr-in' | 'scr-stop' }>
const screenListeners = new Set<(m: ScreenMessage) => void>()
const linkListeners = new Set<(connected: boolean) => void>()

/** Hears screen-session messages from the other computer. */
export function onScreenMessage(fn: (m: ScreenMessage) => void): () => void {
  screenListeners.add(fn)
  return () => screenListeners.delete(fn)
}

/** Hears the link to the other computer coming and going. */
export function onLinkChange(fn: (connected: boolean) => void): () => void {
  linkListeners.add(fn)
  return () => linkListeners.delete(fn)
}

/** Sends a screen-session message to the other computer; false if it isn't connected. */
export function sendScreenMessage(m: ScreenMessage): boolean {
  if (!live?.ready) return false
  live.send(m)
  return true
}

/** The paired computer, while it's connected. */
export function linkedPeer(): { name: string; os: ShareOs } | null {
  return live?.ready && saved.peer ? { name: saved.peer.name, os: saved.peer.os } : null
}

/** Sends files (or folders) to the other computer's Downloads. */
export function sendFilesToPeer(paths: string[]): Promise<void> {
  return sendFiles(paths)
}

/** On a Mac: whether ⌘ and Ctrl swap places going to the PC (the "Swap ⌘ and Ctrl" setting). */
export const swapsCtrlCmd = (): boolean => saved.swapCtrlCmd

let crossingHeld = false
/** Stops the pointer going over the edge for now (while this computer's screen is shown on the other one). */
export function holdCrossing(on: boolean): void {
  crossingHeld = on
  if (on && using === 'there') comeHome(undefined, true)
}

// ---------- Copy and paste ----------

function readClipboard(): { text?: string; html?: string; png?: Buffer; sig: string } {
  const formats = clipboard.availableFormats()
  const text = clipboard.readText()
  const html = formats.some((f) => f.includes('html')) ? clipboard.readHTML() : ''
  const image = formats.some((f) => f.startsWith('image/')) ? clipboard.readImage() : null
  const png = image && !image.isEmpty() ? image.toPNG() : undefined
  const sig = createHash('sha1').update(text).update('\0').update(html).update('\0').update(png ?? Buffer.alloc(0)).digest('hex')
  return { text: text || undefined, html: html || undefined, png, sig }
}

/** Passes over what's on the clipboard, if it's changed since last time. */
function syncClipboard(): void {
  if (!saved.shareClipboard || !live?.ready) return
  try {
    const c = readClipboard()
    if (c.sig === lastClipSig) return
    lastClipSig = c.sig
    // A password copied from the vault stays on this computer.
    if (c.text && isSecret(c.text)) return
    if (!c.text && !c.png) return
    live.send({ t: 'clip', text: c.text?.slice(0, 2_000_000), html: c.html?.slice(0, 2_000_000), png: c.png && c.png.length <= MAX_PNG ? c.png.toString('base64') : undefined })
  } catch (err) {
    logError('mouse sharing (clipboard)', err)
  }
}

function receiveClipboard(m: Extract<ShareMessage, { t: 'clip' }>): void {
  if (!saved.shareClipboard) return
  try {
    const data: Electron.Data = {}
    if (typeof m.text === 'string') data.text = m.text
    if (typeof m.html === 'string') data.html = m.html
    if (typeof m.png === 'string') {
      const image = nativeImage.createFromBuffer(Buffer.from(m.png, 'base64'))
      if (!image.isEmpty()) data.image = image
    }
    if (!data.text && !data.image) return
    clipboard.write(data)
    lastClipSig = readClipboard().sig
  } catch (err) {
    logError('mouse sharing (clipboard)', err)
  }
}

// ---------- Dropping files across ----------

function showDrop(f: number): void {
  prepareWindows()
  const win = dropWin!
  const displays = screen.getAllDisplays()
  const near = entryPoint(
    displays.map((d) => d.bounds),
    saved.side,
    f
  )
  const d = screen.getDisplayNearestPoint(near).bounds
  const thick = 150
  const b =
    saved.side === 'left'
      ? { x: d.x, y: d.y, width: thick, height: d.height }
      : saved.side === 'right'
        ? { x: d.x + d.width - thick, y: d.y, width: thick, height: d.height }
        : saved.side === 'above'
          ? { x: d.x, y: d.y, width: d.width, height: thick }
          : { x: d.x, y: d.y + d.height - thick, width: d.width, height: thick }
  win.setBounds(b)
  win.webContents.send('share:drop', { name: saved.peer?.name ?? 'the other computer', side: saved.side })
  win.showInactive()
  dropShown = { f, since: Date.now() }
  // On the computer with the mouse: when the button's let go without a drop, put the strip away.
  if (!controlled) {
    dropShown.poll = setInterval(async () => {
      if (!dropShown || Date.now() - dropShown.since < 300) return
      if (!(await leftButtonDown())) setTimeout(() => dropShown && hideDrop(), 400)
    }, 200)
  }
}

function hideDrop(): void {
  if (dropShown?.poll) clearInterval(dropShown.poll)
  dropShown = null
  if (dropWin && !dropWin.isDestroyed()) dropWin.hide()
}

/** Files dropped on the strip: send them, and the pointer goes over with them. */
function onDropped(paths: string[]): void {
  const f = dropShown?.f ?? lastF
  hideDrop()
  const files = paths.filter((p) => typeof p === 'string' && p).slice(0, 500)
  if (!files.length) return
  void sendFiles(files).catch((err) => {
    logError('mouse sharing (sending files)', err)
    fail(err instanceof Error ? err.message : String(err))
  })
  if (controlled) {
    stopBeingControlled()
    syncClipboard()
    live?.send({ t: 'leave', f })
  } else goThere(f)
}

async function listFiles(path: string, under: string, out: { full: string; name: string; size: number }[]): Promise<void> {
  const info = await stat(path)
  if (info.isFile()) out.push({ full: path, name: under, size: info.size })
  else if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      if (out.length > 5000) return
      await listFiles(join(path, entry), `${under}/${entry}`, out)
    }
  }
}

async function sendFiles(paths: string[]): Promise<void> {
  const c = live
  if (!c?.ready) throw new Error('The other computer isn’t connected.')
  const files: { full: string; name: string; size: number }[] = []
  for (const p of paths) await listFiles(p, basename(p), files)
  if (!files.length) return
  for (const file of files) {
    const id = randomBytes(6).toString('hex')
    c.send({ t: 'file-start', id, name: file.name, size: file.size })
    for await (const chunk of createReadStream(file.full, { highWaterMark: CHUNK })) {
      await c.roomToSend()
      c.send({ t: 'file-data', id, data: (chunk as Buffer).toString('base64') })
    }
    c.send({ t: 'file-end', id })
  }
  c.send({ t: 'files-done', count: files.length, first: files[0].name })
}

interface Incoming {
  path: string
  part: string
  stream: WriteStream
  size: number
  got: number
}
const incoming = new Map<string, Incoming>()
let fileQueue: Promise<void> = Promise.resolve()
/** This batch's top-level names → the names they were saved as (so "photo.png" twice doesn't overwrite). */
const batchTops = new Map<string, string>()
let firstSaved = ''

async function unusedName(folder: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`
    try {
      await stat(join(folder, candidate))
    } catch {
      return candidate
    }
  }
  return `${stem} ${Date.now()}${ext}`
}

async function receiveFile(m: Extract<ShareMessage, { t: 'file-start' | 'file-data' | 'file-end' | 'files-done' }>): Promise<void> {
  const folder = app.getPath('downloads')
  if (m.t === 'file-start') {
    const rel = safeRelativePath(m.name)
    if (!rel || incoming.has(m.id)) return
    const [top, ...rest] = rel.split('/')
    let savedTop = batchTops.get(top)
    if (!savedTop) {
      savedTop = await unusedName(folder, top)
      batchTops.set(top, savedTop)
    }
    const path = join(folder, savedTop, ...rest)
    if (relative(folder, path).startsWith('..')) return
    await mkdir(dirname(path), { recursive: true })
    const part = `${path}.orbitpart`
    firstSaved ||= join(folder, savedTop)
    incoming.set(m.id, { path, part, stream: createWriteStream(part), size: Number(m.size) || 0, got: 0 })
    return
  }
  const file = incoming.get((m as { id?: string }).id ?? '')
  if (m.t === 'file-data') {
    if (!file) return
    const data = Buffer.from(m.data, 'base64')
    file.got += data.length
    if (!file.stream.write(data)) await new Promise<void>((r) => file.stream.once('drain', () => r()))
    return
  }
  if (m.t === 'file-end') {
    if (!file) return
    incoming.delete(m.id)
    await new Promise<void>((resolve, reject) => file.stream.end((err?: Error | null) => (err ? reject(err) : resolve())))
    await rename(file.part, file.path)
    return
  }
  // files-done
  const where = firstSaved
  const count = Number(m.count) || 1
  batchTops.clear()
  firstSaved = ''
  const from = saved.peer?.name ?? 'the other computer'
  const title = count === 1 ? `Got ${basename(where)}` : `Got ${count} files`
  const body = `From ${from}, in Downloads. Click to show it.`
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, silent: true })
    n.on('click', () => shell.showItemInFolder(where))
    n.show()
  }
  getMainWindow()?.webContents.send('share:received', { title, path: where })
}

function abortIncoming(): void {
  for (const file of incoming.values()) {
    file.stream.destroy()
    void rm(file.part, { force: true }).catch(() => undefined)
  }
  incoming.clear()
  batchTops.clear()
  firstSaved = ''
}

// ---------- Turning it on and off ----------

function applyEnabled(): void {
  if (saved.enabled) {
    listen()
    startDiscovery()
    void reconnect()
  } else {
    stopNetwork()
    stopWatching()
    destroyWindows()
  }
  announce()
}

/** For the permission check: the invisible window may lock the pointer. */
export function isShareWindow(wc: WebContents | null | undefined): boolean {
  return !!wc && ((!!captureWin && !captureWin.isDestroyed() && captureWin.webContents === wc) || (!!dropWin && !dropWin.isDestroyed() && dropWin.webContents === wc))
}

export function teardownMouseShare(): void {
  if (using === 'there') comeHome(undefined, true)
  if (controlled) stopBeingControlled()
  stopNetwork()
  stopWatching()
  stopShareInput()
}

export function setupMouseShare(mainWindow: () => BrowserWindow | null, secret: (text: string) => boolean): void {
  getMainWindow = mainWindow
  isSecret = secret
  saved = load()
  if (!loadSettings().mouseShare) saveSettings({ mouseShare: saved })
  setSwapCtrlCmd(saved.swapCtrlCmd)

  ipcMain.handle('share:status', () => shareStatus())
  ipcMain.handle('share:set', (_e, patch: Partial<ShareSaved>) => {
    const clean: Partial<ShareSaved> = {}
    if (typeof patch?.enabled === 'boolean') clean.enabled = patch.enabled
    if (typeof patch?.swapCtrlCmd === 'boolean') clean.swapCtrlCmd = patch.swapCtrlCmd
    if (typeof patch?.shareClipboard === 'boolean') clean.shareClipboard = patch.shareClipboard
    if (typeof patch?.paused === 'boolean') clean.paused = patch.paused
    if (typeof patch?.speed === 'number' && patch.speed >= 0.25 && patch.speed <= 4) clean.speed = patch.speed
    if (typeof patch?.manualHost === 'string') clean.manualHost = patch.manualHost.trim().slice(0, 100) || undefined
    if (patch?.side && SHARE_SIDES.includes(patch.side)) {
      clean.side = patch.side
      live?.send({ t: 'side', side: oppositeSide(patch.side) })
    }
    lastError = ''
    const wasEnabled = saved.enabled
    save(clean)
    if (wasEnabled !== saved.enabled) applyEnabled()
    if (clean.enabled && IS_MAC) inputAllowed(true)
    return shareStatus()
  })
  ipcMain.handle('share:pair', (_e, target: { id?: string; host?: string }) => startPairing(target ?? {}))
  ipcMain.handle('share:confirmPairing', () => confirmPairing())
  ipcMain.handle('share:cancelPairing', () => cancelPairing(''))
  ipcMain.handle('share:unpair', () => unpair(true))
  ipcMain.handle('share:askAccessibility', () => inputAllowed(true))
  ipcMain.handle('share:sendFiles', (_e, paths: string[]) => sendFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []))
  ipcMain.on('share:input', (_e, event: ShareInputEvent) => onCaptureInput(event))
  ipcMain.on('share:comeBack', () => comeHome(undefined, true))
  ipcMain.on('share:dropped', (_e, paths: string[]) => onDropped(Array.isArray(paths) ? paths : []))
  ipcMain.on('share:dropCancel', () => hideDrop())

  screen.on('display-metrics-changed', () => (armed = false))
  applyEnabled()
}
