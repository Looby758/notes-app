import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { activeThemeId, getTheme } from '@shared/themes'
import type { Prefs } from '@shared/prefs'
import { IS_MAC } from '@shared/platform'
import type { MusicMiniCommand, MusicMiniState } from '@shared/types'
import { loadSettings, saveSettings } from './settings'

/**
 * The floating mini player: a small window that stays on top of other apps, so you can see the song
 * and skip it while you work in something else. It only shows things and passes on button presses:
 * the music player in the notes window does the work (it's where your own music files play), and
 * sends what's playing here.
 */

let miniWin: BrowserWindow | null = null
let last: MusicMiniState | null = null
let prefs: () => Prefs
let notesWindow: () => BrowserWindow | null

const SIZE = { width: 340, height: 96 }
const MARGIN = 24

function startBounds(): Electron.Rectangle {
  const saved = loadSettings().musicMiniWindow
  if (saved && saved.x !== undefined && saved.y !== undefined) {
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x! + 60 < a.x + a.width && saved.x! + SIZE.width - 60 > a.x && saved.y! >= a.y - 10 && saved.y! + 30 < a.y + a.height)
    if (onScreen) return { x: saved.x, y: saved.y, ...SIZE }
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return { x: area.x + area.width - SIZE.width - MARGIN, y: area.y + MARGIN, ...SIZE }
}

/** Tells the notes window whether the mini player is showing (for its button). */
function announce(open: boolean): void {
  const win = notesWindow()
  if (win && !win.isDestroyed()) win.webContents.send('musicMini:open', open)
}

function create(): BrowserWindow {
  const { colors } = getTheme(activeThemeId(prefs(), nativeTheme.shouldUseDarkColors))
  const win = new BrowserWindow({
    ...startBounds(),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: colors.bg,
    title: 'Music',
    ...(IS_MAC ? { type: 'panel' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  win.on('move', () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => !win.isDestroyed() && saveSettings({ musicMiniWindow: win.getBounds() }), 400)
  })
  win.on('closed', () => {
    clearTimeout(saveTimer)
    miniWin = null
    saveSettings({ musicMiniOpen: false })
    announce(false)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => win.showInactive())
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#music`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'music' })
  return win
}

export function setMusicMini(open: boolean): boolean {
  if (open && !miniWin) {
    miniWin = create()
    saveSettings({ musicMiniOpen: true })
    announce(true)
  } else if (!open && miniWin && !miniWin.isDestroyed()) miniWin.close()
  return open
}

/** Closes the mini player along with the notes window, without forgetting it was open. */
export function closeMusicMini(): void {
  if (!miniWin || miniWin.isDestroyed()) return
  miniWin.removeAllListeners('closed')
  miniWin.close()
  miniWin = null
}

const listeners = new Set<(state: MusicMiniState) => void>()

/** What's playing, as the notes window last said, and news of changes (for the phone remote). */
export const lastMusic = (): MusicMiniState | null => last
export function onMusic(fn: (state: MusicMiniState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Carries out a music button (play/pause, next…) pressed somewhere other than the notes window. */
export function musicCommand(command: MusicMiniCommand): void {
  const win = notesWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send('musicMini:command', command)
}

export function setupMusicMini(getPrefs: () => Prefs, getNotesWindow: () => BrowserWindow | null): void {
  prefs = getPrefs
  notesWindow = getNotesWindow
  ipcMain.handle('musicMini:set', (_e, open: boolean) => setMusicMini(open === true))
  ipcMain.handle('musicMini:isOpen', () => !!miniWin)
  ipcMain.handle('musicMini:wasOpen', () => loadSettings().musicMiniOpen === true)
  // From the notes window: what's playing now.
  ipcMain.on('musicMini:push', (_e, state: MusicMiniState) => {
    last = state
    for (const fn of listeners) fn(state)
    if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('musicMini:state', state)
  })
  ipcMain.handle('musicMini:last', () => last)
  // From the mini player: a button press, carried out by the notes window.
  ipcMain.on('musicMini:command', (_e, command: MusicMiniCommand) => musicCommand(command))
}
