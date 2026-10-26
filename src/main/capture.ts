import type { CaptureRequest } from '@shared/types'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray, nativeTheme } from 'electron'
import { join } from 'path'
import { activeThemeId, getTheme } from '@shared/themes'
import type { Prefs } from '@shared/prefs'
import { acceleratorLabel, IS_MAC, SYSTEM_NAME } from '@shared/platform'

/**
 * Quick capture and the tray. A system-wide shortcut (Win+Shift+N by default) opens a small
 * window over whatever you're doing; what you type is handed to the main window, which saves it
 * (so it respects open notes, templates and unsaved edits). The tray icon keeps Notes running
 * after its window is closed, so the shortcut keeps working.
 */

let tray: Tray | null = null
let captureWin: BrowserWindow | null = null
let registered = ''
let shortcutError: string | undefined
let nextRequest = 1
/** While recording a voice note, clicking elsewhere doesn't put capture away. */
let keepOpen = false
const pending = new Map<number, (result: CaptureResult) => void>()

export interface CaptureResult {
  ok: boolean
  /** Where it was saved, e.g. "Today's note". */
  where?: string
  error?: string
}

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
  prefs: () => Prefs
}
let hooks: Hooks

const ICON = join(__dirname, '../../build/icon.png')
/** A Mac menu bar icon is a black-and-clear 'template' that macOS tints to match the menu bar. */
const MAC_TRAY_ICON = join(__dirname, '../../build/trayTemplate.png')

function loadRenderer(win: BrowserWindow, hash: string): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

/** Readable name for an Electron accelerator ("Super+Shift+N" → "Win+Shift+N", or ⌃⌥Space on a Mac). */
export const shortcutLabel = acceleratorLabel

function createCaptureWindow(): BrowserWindow {
  const { colors } = getTheme(activeThemeId(hooks.prefs(), nativeTheme.shouldUseDarkColors))
  const win = new BrowserWindow({
    width: 560,
    height: 212,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: colors.bg,
    title: 'Quick capture',
    // A Mac 'panel' floats over other apps (even full-screen ones) without bringing the main window along.
    ...(IS_MAC ? { type: 'panel' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Like a launcher: clicking anywhere else puts it away.
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened() && !keepOpen) win.hide()
  })
  win.on('closed', () => (captureWin = null))
  loadRenderer(win, 'capture')
  return win
}

/** Shows quick capture near the top of the screen you're on, ready to type. */
export function openCapture(): void {
  captureWin ??= createCaptureWindow()
  const win = captureWin
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const [w] = win.getSize()
  win.setPosition(Math.round(display.x + (display.width - w) / 2), Math.round(display.y + display.height * 0.22))
  const reveal = (): void => {
    win.show()
    win.focus()
    win.webContents.send('capture:reset')
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
  else reveal()
}

/**
 * Puts quick capture away. On a Mac, if no Notes window is showing, hand the focus back to the
 * app you were in (Windows does that by itself).
 */
function hideCapture(): void {
  keepOpen = false
  captureWin?.hide()
  if (IS_MAC && !BrowserWindow.getAllWindows().some((w) => w.isVisible())) app.hide()
}

/** (Re)registers the system-wide shortcut; remembers if another app already has it. */
export function applyCaptureShortcut(accel: string): void {
  if (registered === accel) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  shortcutError = undefined
  if (!accel) return
  try {
    if (globalShortcut.register(accel, openCapture)) registered = accel
    else shortcutError = `${shortcutLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick a different shortcut.`
  } catch {
    shortcutError = `${shortcutLabel(accel)} can't be used as a shortcut.`
  }
  updateTrayMenu()
}

function updateTrayMenu(): void {
  if (!tray) return
  const shortcut = registered ? `\t${shortcutLabel(registered)}` : ''
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Notes', click: () => hooks.showMain() },
      { label: `Quick capture${shortcut}`, click: openCapture },
      { type: 'separator' },
      { label: 'Quit Notes', click: () => app.quit() }
    ])
  )
}

function createTray(): void {
  let image: Electron.NativeImage
  if (IS_MAC) {
    // trayTemplate@2x.png beside it is picked up automatically for Retina screens.
    image = nativeImage.createFromPath(MAC_TRAY_ICON)
    image.setTemplateImage(true)
  } else {
    image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' })
  }
  tray = new Tray(image)
  tray.setToolTip('Notes')
  tray.on('click', () => hooks.showMain())
  updateTrayMenu()
}

/** Windows: the tray shows the app icon you picked (the Mac menu bar keeps its plain template). */
export function setTrayIcon(image: Electron.NativeImage): void {
  if (IS_MAC || !tray) return
  tray.setImage(image.resize({ width: 16, height: 16, quality: 'best' }))
}

/** The first time the window goes to the tray, say where it went. */
export function noteHiddenToTray(): void {
  // Mac apps routinely keep running with no window, so there's nothing to explain there.
  if (IS_MAC) return
  tray?.displayBalloon({
    iconType: 'info',
    title: 'Notes is still running',
    content: registered
      ? `It's in the tray. Press ${shortcutLabel(registered)} any time to capture a thought.`
      : 'It’s in the tray. Click the icon to open it again, or right-click to quit.'
  })
}

export function setupCapture(h: Hooks): void {
  hooks = h
  createTray()

  ipcMain.handle('capture:open', () => openCapture())
  ipcMain.handle('capture:close', () => hideCapture())
  ipcMain.handle('capture:keepOpen', (_e, on: boolean) => {
    keepOpen = on
  })
  ipcMain.handle('capture:status', () => ({
    shortcut: registered ? shortcutLabel(registered) : '',
    error: shortcutError,
    target: hooks.prefs().captureTarget
  }))

  // The capture window submits text; the main window saves it and reports back.
  ipcMain.handle('capture:submit', async (_e, request: CaptureRequest): Promise<CaptureResult> => {
    const main = hooks.getMain()
    if (!main || main.isDestroyed()) return { ok: false, error: 'Notes isn’t ready yet. Try again in a moment.' }
    const id = nextRequest++
    const result = new Promise<CaptureResult>((resolve) => {
      pending.set(id, resolve)
      setTimeout(() => {
        if (pending.delete(id)) resolve({ ok: false, error: 'Saving took too long. Try again.' })
      }, 8000)
    })
    main.webContents.send('capture:add', id, request)
    const r = await result
    if (r.ok) hideCapture()
    return r
  })
  ipcMain.handle('capture:result', (_e, id: number, result: CaptureResult) => {
    pending.get(id)?.(result)
    pending.delete(id)
  })
}

export function teardownCapture(): void {
  globalShortcut.unregisterAll()
  captureWin?.destroy()
  tray?.destroy()
  tray = null
}
