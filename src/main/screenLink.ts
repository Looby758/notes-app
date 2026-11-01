import { app, BrowserWindow, desktopCapturer, ipcMain, net, screen, shell, systemPreferences, type WebContents } from 'electron'
import { randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { IS_MAC } from '@shared/platform'
import { pickDisplay, pickInstaller, pointOnDisplay, type ScreenInput, type ScreenMode, type ScreenStatus } from '@shared/screenLink'
import { isKnownKey, swapCtrlCmd } from '@shared/mouseShare'
import { holdCrossing, linkedPeer, onLinkChange, onScreenMessage, sendScreenMessage, swapsCtrlCmd } from './mouseShare'
import { inputAllowed, movePointerTo, pressButton, pressKey, releaseAll, scroll } from './shareInput'
import { loadRenderer } from './capture'
import { loadSettings, saveSettings } from './settings'
import { logError } from './log'

/**
 * Screens between the paired PC and Mac, over the mouse-sharing link:
 * - The MacBook as a second screen: the PC shows one of its screens full screen on the Mac. With an
 *   extra screen on the PC (a free virtual-screen driver Orbit can fetch, or a spare monitor) that's
 *   real extra space; with just the one screen, the Mac shows a copy of it.
 * - Control the Mac: the PC opens a window showing the Mac's screen, and the mouse and keyboard in
 *   that window work the Mac.
 *
 * The picture goes straight between the two computers (WebRTC, inside the home network, encrypted).
 * The encrypted mouse-sharing line carries the setting up and the mouse and keys, so only the paired
 * computer can ask for or see a screen.
 */

const VDD_REPO = 'VirtualDrivers/Virtual-Display-Driver'

interface Session {
  id: string
  mode: ScreenMode
  role: 'send' | 'view'
  state: 'starting' | 'live'
  win: BrowserWindow | null
  ready: boolean
  queue: unknown[]
  /** The screen being shown (sending side). */
  display?: Electron.Display
  /** What the hidden sending window records. */
  setup?: { sourceId: string; width: number; height: number }
}

let getMainWindow: () => BrowserWindow | null = () => null
let session: Session | null = null
let lastError = ''
let installing = ''

const extendDisplay = (): string => String(loadSettings().screenLink?.extendDisplay ?? '')

function displays(): ScreenStatus['displays'] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || `Screen ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary
  }))
}

export function screenStatus(): ScreenStatus {
  const peer = linkedPeer()
  return {
    available: !!peer,
    peerName: peer?.name ?? '',
    session: session ? { mode: session.mode, role: session.role, state: session.state } : null,
    displays: displays(),
    extendDisplay: extendDisplay(),
    canExtend: screen.getAllDisplays().length > 1,
    screenAllowed: !IS_MAC || systemPreferences.getMediaAccessStatus('screen') === 'granted',
    installing,
    error: lastError
  }
}

let announceTimer: ReturnType<typeof setTimeout> | undefined
function announce(): void {
  clearTimeout(announceTimer)
  announceTimer = setTimeout(() => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('screen:status', screenStatus())
  }, 30)
}

// ---------- Starting and stopping ----------

/** Starts a session from this computer: show this screen there (extend), or see and use theirs (control). */
function start(mode: ScreenMode): void {
  if (!linkedPeer()) throw new Error('Your other computer isn’t connected. Turn on “Share mouse and keyboard” on both (Settings → Two computers).')
  if (session) stop('', true)
  lastError = ''
  const id = randomBytes(8).toString('hex')
  begin(id, mode, mode === 'extend' ? 'send' : 'view')
  sendScreenMessage({ t: 'scr-start', id, mode })
}

function begin(id: string, mode: ScreenMode, role: 'send' | 'view'): void {
  session = { id, mode, role, state: 'starting', win: null, ready: false, queue: [] }
  holdCrossing(true)
  if (role === 'send') void prepareSending(session)
  else openViewer(session)
  announce()
}

/** Ends the session here; `tell` lets the other computer know too. */
function stop(reason: string, tell: boolean): void {
  const s = session
  if (!s) return
  session = null
  if (tell) sendScreenMessage({ t: 'scr-stop', id: s.id, reason: reason || undefined })
  if (s.role === 'send') releaseAll()
  if (s.win && !s.win.isDestroyed()) s.win.destroy()
  holdCrossing(false)
  if (reason) lastError = reason
  announce()
}

function fail(s: Session, reason: string): void {
  if (session === s) stop(reason, true)
}

// ---------- The computer whose screen is shown ----------

async function prepareSending(s: Session): Promise<void> {
  try {
    if (IS_MAC && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      // Asking for the sources puts Orbit in the Screen Recording list, so it can be turned on.
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined)
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
      return fail(s, 'The Mac needs to let Orbit share its screen: turn Orbit on in System Settings → Privacy & Security → Screen Recording, then try again.')
    }
    // The Mac also needs Accessibility for the PC's mouse and keyboard to work it.
    if (s.mode === 'control' && !inputAllowed(true)) {
      lastError = 'The Mac needs Orbit allowed in System Settings → Privacy & Security → Accessibility for the PC’s mouse and keyboard to work it.'
    }
    const all = screen.getAllDisplays()
    const display =
      s.mode === 'extend'
        ? (pickDisplay(
            all.map((d) => ({ d, id: String(d.id), primary: d.id === screen.getPrimaryDisplay().id })),
            extendDisplay()
          )?.d ?? screen.getPrimaryDisplay())
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    s.display = display
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    const source = sources.find((x) => x.display_id === String(display.id)) ?? sources[0]
    if (!source) return fail(s, 'Couldn’t find a screen to share.')
    if (session !== s) return
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      title: 'Sharing the screen',
      webPreferences: windowPrefs()
    })
    s.win = win
    s.setup = {
      sourceId: source.id,
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
    win.on('closed', () => session === s && stop('', true))
    loadRenderer(win, 'screen-send')
  } catch (err) {
    logError('screen sharing', err)
    fail(s, 'Couldn’t start sharing the screen.')
  }
}

/** The mouse and keys from the window on the other computer. */
function onInput(s: Session, e: ScreenInput): void {
  if (s.role !== 'send' || !s.display || !e || typeof e !== 'object') return
  if (!inputAllowed(false)) return
  switch (e.t) {
    case 'pos': {
      const p = pointOnDisplay(s.display.bounds, Number(e.x), Number(e.y))
      return movePointerTo(p.x, p.y)
    }
    case 'btn':
      if ([0, 1, 2].includes(e.b)) pressButton(e.b, e.down === true)
      return
    case 'wheel':
      return scroll(Number(e.dx) || 0, Number(e.dy) || 0)
    case 'key':
      if (typeof e.code === 'string' && isKnownKey(e.code)) pressKey(e.code, e.down === true)
      return
  }
}

// ---------- The computer showing the other one's screen ----------

function openViewer(s: Session): void {
  const peer = linkedPeer()
  const extend = s.mode === 'extend'
  // The second screen fills the Mac's screen; seeing the Mac from the PC is an ordinary window.
  const at = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds
  const win = new BrowserWindow({
    show: false,
    ...(extend ? { x: at.x, y: at.y, width: at.width, height: at.height, fullscreen: true } : { width: 1280, height: 820, minWidth: 480, minHeight: 320 }),
    backgroundColor: '#000000',
    title: extend ? `Second screen for ${peer?.name ?? 'the PC'}` : `${peer?.name ?? 'Mac'} · Orbit`,
    autoHideMenuBar: true,
    webPreferences: windowPrefs()
  })
  s.win = win
  win.on('closed', () => session === s && stop('', true))
  loadRenderer(win, 'screen-view')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
}

// ---------- Talking to the windows ----------

const windowPrefs = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false
})

const sessionFor = (wc: WebContents): Session | null => (session?.win && !session.win.isDestroyed() && session.win.webContents === wc ? session : null)

/** For the permission check: Orbit's screen windows may record the screen and lock the pointer. */
export function isScreenWindow(wc: WebContents | null | undefined): boolean {
  return !!wc && !!sessionFor(wc)
}

function deliver(s: Session, data: unknown): void {
  if (!s.ready || !s.win || s.win.isDestroyed()) return void s.queue.push(data)
  s.win.webContents.send('screen:signal', data)
}

// ---------- The virtual screen (Windows) ----------

async function installVirtualScreen(): Promise<void> {
  if (IS_MAC || installing) return
  const page = `https://github.com/${VDD_REPO}/releases/latest`
  installing = 'Finding the virtual screen…'
  lastError = ''
  announce()
  try {
    const res = await net.fetch(`https://api.github.com/repos/${VDD_REPO}/releases/latest`, { headers: { Accept: 'application/json', 'User-Agent': 'Orbit' } })
    if (!res.ok) throw new Error(`GitHub said ${res.status}`)
    const release = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] }
    const asset = pickInstaller((release.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url })), process.arch)
    if (!asset) {
      void shell.openExternal(page)
      lastError = 'Couldn’t pick the installer by itself, so its download page is open in your browser.'
      return
    }
    installing = 'Downloading the virtual screen…'
    announce()
    const file = join(app.getPath('temp'), asset.name.replace(/[^\w.-]/g, '_'))
    const download = await net.fetch(asset.url, { headers: { 'User-Agent': 'Orbit' } })
    if (!download.ok || !download.body) throw new Error(`Download failed (${download.status})`)
    await pipeline(Readable.fromWeb(download.body as import('stream/web').ReadableStream), createWriteStream(file))
    installing = 'Waiting for the installer… (Windows asks first)'
    announce()
    const problem = await shell.openPath(file)
    if (problem) throw new Error(problem)
  } catch (err) {
    logError('virtual screen', err)
    void shell.openExternal(page)
    lastError = 'Couldn’t download the virtual screen, so its download page is open in your browser.'
  } finally {
    // The installer runs on its own; the new screen shows up in the list once it's done.
    setTimeout(() => {
      installing = ''
      announce()
    }, 4000)
  }
}

// ---------- Setting up ----------

export function teardownScreenLink(): void {
  stop('', true)
}

export function setupScreenLink(mainWindow: () => BrowserWindow | null): void {
  getMainWindow = mainWindow

  onScreenMessage((m) => {
    switch (m.t) {
      case 'scr-start':
        if (m.mode !== 'extend' && m.mode !== 'control') return
        if (session) stop('', false)
        lastError = ''
        begin(String(m.id), m.mode, m.mode === 'extend' ? 'view' : 'send')
        return
      case 'scr-sig':
        if (session?.id === m.id) deliver(session, m.data)
        return
      case 'scr-in':
        if (session?.id === m.id) onInput(session, m.e as ScreenInput)
        return
      case 'scr-stop':
        if (session?.id === m.id) stop(typeof m.reason === 'string' ? m.reason.slice(0, 300) : '', false)
        return
    }
  })
  onLinkChange((connected) => {
    if (!connected && session) stop('The other computer went away.', false)
    announce()
  })
  screen.on('display-added', announce)
  screen.on('display-removed', announce)

  ipcMain.handle('screen:status', () => screenStatus())
  ipcMain.handle('screen:start', (_e, mode: ScreenMode) => start(mode === 'control' ? 'control' : 'extend'))
  ipcMain.handle('screen:stop', () => stop('', true))
  ipcMain.handle('screen:setDisplay', (_e, id: string) => {
    saveSettings({ screenLink: { extendDisplay: typeof id === 'string' ? id.slice(0, 40) : '' } })
    announce()
  })
  ipcMain.handle('screen:installVirtual', () => installVirtualScreen())
  // The windows: what they're for, then the setting up messages for the other side.
  ipcMain.handle('screen:ready', (e) => {
    const s = sessionFor(e.sender)
    if (!s) return null
    s.ready = true
    setTimeout(() => {
      for (const data of s.queue.splice(0)) deliver(s, data)
    }, 0)
    return { role: s.role, mode: s.mode, peerName: linkedPeer()?.name ?? 'the other computer', peerOs: linkedPeer()?.os ?? 'mac', ...s.setup }
  })
  ipcMain.on('screen:signal', (e, data: unknown) => {
    const s = sessionFor(e.sender)
    if (s) sendScreenMessage({ t: 'scr-sig', id: s.id, data })
  })
  ipcMain.on('screen:live', (e) => {
    const s = sessionFor(e.sender)
    if (!s || s.state === 'live') return
    s.state = 'live'
    announce()
  })
  ipcMain.on('screen:input', (e, input: ScreenInput) => {
    const s = sessionFor(e.sender)
    if (s?.role !== 'view' || !input || typeof input !== 'object') return
    // Typing on the Mac for the PC: ⌘ goes over as Ctrl (so ⌘C copies there), as with mouse sharing.
    const out = IS_MAC && input.t === 'key' && swapsCtrlCmd() ? { ...input, code: swapCtrlCmd(String(input.code)) } : input
    sendScreenMessage({ t: 'scr-in', id: s.id, e: out })
  })
  ipcMain.on('screen:failed', (e, reason: string) => {
    const s = sessionFor(e.sender)
    if (s) fail(s, String(reason).slice(0, 300))
  })
  ipcMain.on('screen:close', (e) => {
    const s = sessionFor(e.sender)
    if (s) stop('', true)
  })
  ipcMain.on('screen:fullscreen', (e) => {
    const s = sessionFor(e.sender)
    if (s?.win && !s.win.isDestroyed()) s.win.setFullScreen(!s.win.isFullScreen())
  })
}
