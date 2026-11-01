import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { activeThemeId, getTheme } from '@shared/themes'
import type { Prefs } from '@shared/prefs'
import { cornerOf, offerPopout, restorePlace, type SavedPlace } from '@shared/discord'
import { ROBLOX_DOWNLOAD } from '@shared/games'
import { loadSettings, saveSettings } from './settings'
import { onDiscordChannel } from './discord'
import { openPopout } from './popout'
import { isAppPage } from './studio'

/**
 * The Discord voice pop-out: a window of its own for while you're in a voice call, meant to sit on
 * a second screen (it doesn't float over games). The page is components/Discord/VoicePopout.tsx.
 * It opens on the same screen, at the same size and place, every time.
 *
 * Also the small note in the corner when you join a call ("Pop out the call?"). It never takes the
 * focus, needs no answer, and goes away by itself after a few seconds. Nothing pops out by itself.
 */

let win: BrowserWindow | null = null
let toast: BrowserWindow | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined
let toastHovered = false
let prefs: () => Prefs

const DEFAULT_SIZE = { width: 400, height: 760 }
const TOAST_SIZE = { width: 320, height: 76 }
/** How long the corner note stays when it's left alone. */
const TOAST_MS = 7000

const displays = (): { id: number; workArea: Electron.Rectangle }[] => screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }))

/** Where it was left, or (first time) the right-hand edge of a second screen if there is one. */
function startBounds(): Electron.Rectangle {
  const saved = loadSettings().discordPopoutWindow
  const placed = restorePlace(saved, displays())
  if (placed) return placed
  const primary = screen.getPrimaryDisplay()
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id) ?? primary
  const a = other.workArea
  const width = Math.min(saved?.width ?? DEFAULT_SIZE.width, a.width)
  const height = Math.min(saved?.height ?? DEFAULT_SIZE.height, a.height)
  return { x: a.x + a.width - width - 24, y: a.y + Math.max(0, Math.round((a.height - height) / 2)), width, height }
}

function remember(w: BrowserWindow): void {
  if (w.isDestroyed() || w.isMinimized()) return
  const maximized = w.isMaximized()
  const b = maximized ? w.getNormalBounds() : w.getBounds()
  const d = screen.getDisplayMatching(b)
  const place: SavedPlace = { ...b, maximized, displayId: d.id, offsetX: b.x - d.workArea.x, offsetY: b.y - d.workArea.y }
  saveSettings({ discordPopoutWindow: place })
}

function tellOpen(open: boolean): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== win) w.webContents.send('discord-popout:open-changed', open)
}

function loadPage(w: BrowserWindow, hash: string): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

const webPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
})

function create(): BrowserWindow {
  const { colors } = getTheme(activeThemeId(prefs(), nativeTheme.shouldUseDarkColors))
  const w = new BrowserWindow({
    ...startBounds(),
    minWidth: 300,
    minHeight: 360,
    show: false,
    frame: false,
    backgroundColor: colors.bg,
    title: 'Discord voice',
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: webPreferences()
  })
  // The mic level, the call timer and the clip buffer keep going while you're in a game.
  w.webContents.setBackgroundThrottling(false)
  if (loadSettings().discordPopoutWindow?.maximized) w.maximize()

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const later = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => remember(w), 400)
  }
  w.on('move', later)
  w.on('resize', later)
  w.on('maximize', later)
  w.on('unmaximize', later)
  w.on('close', () => {
    clearTimeout(saveTimer)
    remember(w)
  })
  w.on('closed', () => {
    win = null
    tellOpen(false)
  })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    w.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') w.webContents.toggleDevTools()
    })
  }
  w.once('ready-to-show', () => w.show())
  loadPage(w, 'discord-popout')
  return w
}

/** Opens the Discord voice pop-out, or brings it back. */
export function openDiscordPopout(): void {
  closeToast()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = create()
  tellOpen(true)
}

const isOpen = (): boolean => !!win && !win.isDestroyed()

/** Closes along with the notes window. */
export function closeDiscordPopout(): void {
  closeToast()
  if (win && !win.isDestroyed()) win.close()
  win = null
}

// ---------------------------------------------------------------------------------------------
// The corner note

function closeToast(): void {
  clearTimeout(toastTimer)
  toastHovered = false
  if (toast && !toast.isDestroyed()) toast.close()
  toast = null
}

function startToastTimer(): void {
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastHovered ? startToastTimer() : closeToast()), TOAST_MS)
}

/** The screen the note goes on: the pop-out's screen (the second screen, away from the game), else the main one. */
function toastBounds(): Electron.Rectangle {
  const saved = loadSettings().discordPopoutWindow
  const d = (saved && screen.getAllDisplays().find((x) => x.id === saved.displayId)) || (saved && screen.getDisplayMatching(saved)) || screen.getPrimaryDisplay()
  return cornerOf(d.workArea, TOAST_SIZE.width, TOAST_SIZE.height)
}

function showToast(): void {
  closeToast()
  const { colors } = getTheme(activeThemeId(prefs(), nativeTheme.shouldUseDarkColors))
  const t = new BrowserWindow({
    ...toastBounds(),
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never takes the focus from the game or Discord; it can still be clicked.
    focusable: false,
    backgroundColor: colors.bg,
    title: 'Pop out the call?',
    webPreferences: webPreferences()
  })
  t.setAlwaysOnTop(true, 'floating')
  t.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  t.once('ready-to-show', () => {
    if (t.isDestroyed()) return
    t.showInactive()
    startToastTimer()
  })
  t.on('closed', () => {
    if (toast === t) toast = null
  })
  toast = t
  loadPage(t, 'discord-toast')
}

const fromToast = (e: Electron.IpcMainInvokeEvent): boolean => !!toast && !toast.isDestroyed() && e.sender === toast.webContents && isAppPage(e.sender)
const fromPopout = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => (win && !win.isDestroyed() && e.sender === win.webContents && isAppPage(e.sender) ? win : null)

export function setupDiscordPopout(getPrefs: () => Prefs): void {
  prefs = getPrefs
  ipcMain.handle('discord-popout:open', () => openDiscordPopout())
  ipcMain.handle('discord-popout:is-open', () => isOpen())
  ipcMain.handle('discord-popout:close', (e) => fromPopout(e)?.close())
  ipcMain.handle('discord-popout:minimize', (e) => fromPopout(e)?.minimize())
  // Watch a stream in Orbit: the floating pop-out shows Discord's window (or its popped-out stream).
  ipcMain.handle('discord-popout:watch', () => openPopout('discord'))
  ipcMain.handle('discord-popout:roblox-download', () => shell.openExternal(ROBLOX_DOWNLOAD))
  ipcMain.handle('discord-toast:answer', (e, popOut: unknown) => {
    if (!fromToast(e)) return
    closeToast()
    if (popOut === true) openDiscordPopout()
  })
  ipcMain.handle('discord-toast:hover', (e, over: unknown) => {
    if (fromToast(e)) toastHovered = over === true
  })

  onDiscordChannel((before, after, firstLook) => {
    if (!after) closeToast()
    else if (offerPopout(before, after, firstLook, prefs().discordPopoutPrompt, isOpen())) showToast()
  })
}
