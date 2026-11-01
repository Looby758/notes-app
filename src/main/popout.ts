import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { activeThemeId, getTheme } from '@shared/themes'
import type { Prefs } from '@shared/prefs'
import { IS_MAC } from '@shared/platform'
import { fitWindow, OPACITY_STEPS } from '@shared/popout'
import { loadSettings, saveSettings } from './settings'
import { captureSources, isAppPage } from './studio'

/**
 * The pop-out window: any app (a game, a video in another player, Discord, a stream, a second
 * screen) shown live in a small window that floats on top of everything, so you can keep an eye on
 * it while you work in something else. The page (components/Popout) captures the app's window the
 * way the Studio does and draws it; this keeps the window on top, its shape matched to the
 * picture, and remembers where you left it and how see-through it was.
 */

let win: BrowserWindow | null = null
let prefs: () => Prefs

const DEFAULT_SIZE = { width: 480, height: 300 }
/** Big enough to pick from the list of windows. */
const PICKER_SIZE = { width: 560, height: 400 }
const MARGIN = 24

function startBounds(): Electron.Rectangle {
  const saved = loadSettings().popoutWindow
  if (saved && saved.x !== undefined && saved.y !== undefined) {
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x! + 60 < a.x + a.width && saved.x! + saved.width - 60 > a.x && saved.y! >= a.y - 10 && saved.y! + 30 < a.y + a.height)
    if (onScreen) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  }
  const { width, height } = saved ?? DEFAULT_SIZE
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return { x: area.x + area.width - width - MARGIN, y: area.y + area.height - height - MARGIN, width, height }
}

const savedOpacity = (): number => {
  const o = loadSettings().popoutOpacity
  return typeof o === 'number' && OPACITY_STEPS.some((s) => Math.abs(s - o) < 0.01) ? o : 1
}

function create(): BrowserWindow {
  const { colors } = getTheme(activeThemeId(prefs(), nativeTheme.shouldUseDarkColors))
  const w = new BrowserWindow({
    ...startBounds(),
    minWidth: 140,
    minHeight: 100,
    show: false,
    frame: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: colors.bg,
    title: 'Pop-out',
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.setAlwaysOnTop(true, 'floating')
  if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setOpacity(savedOpacity())
  // Keeps the picture moving while another app has the focus.
  w.webContents.setBackgroundThrottling(false)

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const remember = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => !w.isDestroyed() && saveSettings({ popoutWindow: w.getBounds() }), 400)
  }
  w.on('move', remember)
  w.on('resize', remember)
  w.on('closed', () => {
    clearTimeout(saveTimer)
    win = null
  })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    w.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') w.webContents.toggleDevTools()
    })
  }
  w.once('ready-to-show', () => w.show())
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#popout`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'popout' })
  return w
}

/** Opens the pop-out window (it starts by asking which app to show), or brings it back. */
export function openPopout(): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = create()
}

/** Closes along with the notes window. */
export function closePopout(): void {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

/** Only the pop-out window's own page may move and shape the pop-out window. */
const fromPopout = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
  const w = BrowserWindow.fromWebContents(e.sender)
  return w && w === win && !w.isDestroyed() && isAppPage(e.sender) ? w : null
}

/** Reshapes the window around its middle, and keeps that shape when you resize it. */
function shape(w: BrowserWindow, aspect: number, size?: { width: number; height: number }): void {
  const now = w.getBounds()
  const area = screen.getDisplayMatching(now).workArea
  const from = size ? { x: now.x + now.width / 2 - size.width / 2, y: now.y + now.height / 2 - size.height / 2, ...size } : now
  w.setAspectRatio(0)
  w.setBounds(fitWindow(from, aspect, area))
  w.setAspectRatio(size ? 0 : aspect)
}

export function setupPopout(getPrefs: () => Prefs): void {
  prefs = getPrefs
  ipcMain.handle('popout:open', () => openPopout())
  ipcMain.handle('popout:sources', (e) => (fromPopout(e) ? captureSources() : []))
  ipcMain.handle('popout:state', (e) => ({ opacity: fromPopout(e) ? savedOpacity() : 1 }))
  // Showing an app: the window takes the picture's shape.
  ipcMain.handle('popout:fit', (e, aspect: number) => {
    const w = fromPopout(e)
    if (w && typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0) shape(w, aspect)
  })
  // Back to the list of windows: room to pick, any shape.
  ipcMain.handle('popout:picker', (e) => {
    const w = fromPopout(e)
    if (!w) return
    const now = w.getBounds()
    if (now.width < PICKER_SIZE.width || now.height < PICKER_SIZE.height) shape(w, PICKER_SIZE.width / PICKER_SIZE.height, PICKER_SIZE)
    else w.setAspectRatio(0)
  })
  ipcMain.handle('popout:opacity', (e, opacity: number) => {
    const w = fromPopout(e)
    if (!w || !OPACITY_STEPS.some((s) => Math.abs(s - opacity) < 0.01)) return
    w.setOpacity(opacity)
    saveSettings({ popoutOpacity: opacity })
  })
  ipcMain.handle('popout:minimize', (e) => fromPopout(e)?.minimize())
  ipcMain.handle('popout:close', (e) => fromPopout(e)?.close())
}
