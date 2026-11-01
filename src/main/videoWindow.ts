import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { isAbsolute, join } from 'path'
import { isVideoFile } from '@shared/videoPlayer'
import { releaseFiles } from './fileLocks'
import { isAppPage } from './studio'
import { loadSettings, saveSettings } from './settings'

/**
 * The video player in a window of its own ("Pop out"), so a video can go full screen on one screen
 * (or sit beside Orbit at any size) while you carry on using Orbit. Picture in picture can't go full
 * screen; this can. It's the same player as the tab, loaded with #video.
 */

let videoWin: BrowserWindow | null = null
/** The video the window is showing. */
let current: string | null = null
let notesWindow: () => BrowserWindow | null

const SIZE = { width: 960, height: 560 }

function startBounds(): Electron.Rectangle {
  const saved = loadSettings().videoWindow
  if (saved && saved.x !== undefined && saved.y !== undefined && saved.width && saved.height) {
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x! + 60 < a.x + a.width && saved.x! + saved.width! - 60 > a.x && saved.y! >= a.y - 10 && saved.y! + 30 < a.y + a.height)
    if (onScreen) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  }
  // Starts on the screen the notes window isn't on, when there are two (the usual reason to pop out).
  const notes = notesWindow()?.getBounds()
  const notesScreen = notes ? screen.getDisplayMatching(notes) : screen.getPrimaryDisplay()
  const other = screen.getAllDisplays().find((d) => d.id !== notesScreen.id) ?? notesScreen
  const a = other.workArea
  const width = Math.min(SIZE.width, a.width - 40)
  const height = Math.min(SIZE.height, a.height - 40)
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height }
}

function create(): BrowserWindow {
  const win = new BrowserWindow({
    ...startBounds(),
    show: false,
    minWidth: 320,
    minHeight: 200,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Video',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const remember = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => !win.isDestroyed() && !win.isFullScreen() && saveSettings({ videoWindow: win.getNormalBounds() }), 400)
  }
  win.on('move', remember)
  win.on('resize', remember)
  win.on('closed', () => {
    clearTimeout(saveTimer)
    videoWin = null
    // The window's gone, so nothing in it can still be reading the video.
    if (current) void releaseFiles(current)
    current = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#video`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'video' })
  return win
}

/** Plays `path` in the video window (opening it if it isn't already). */
export function popOutVideo(path: string): void {
  current = path
  if (videoWin && !videoWin.isDestroyed()) {
    videoWin.webContents.send('videoWindow:play', path)
    if (videoWin.isMinimized()) videoWin.restore()
    videoWin.focus()
    return
  }
  videoWin = create()
}

/** Closes the video window along with the notes window. */
export function closeVideoWindow(): void {
  if (videoWin && !videoWin.isDestroyed()) videoWin.close()
}

export function setupVideoWindow(getNotesWindow: () => BrowserWindow | null): void {
  notesWindow = getNotesWindow
  ipcMain.handle('videoWindow:open', (e, path: unknown) => {
    if (!isAppPage(e.sender) || typeof path !== 'string' || !isAbsolute(path) || !isVideoFile(path)) return
    popOutVideo(path)
  })
  // The window asking which video to show (as it starts).
  ipcMain.handle('videoWindow:current', () => current)
  // The window playing something else (a video dropped on it, or picked).
  ipcMain.on('videoWindow:showing', (e, path: unknown) => {
    if (videoWin && e.sender === videoWin.webContents) current = typeof path === 'string' ? path : null
  })
  // "Back into Orbit": the notes window carries on with the video, and this window closes.
  ipcMain.handle('videoWindow:popIn', async (e, path: unknown) => {
    if (!videoWin || e.sender !== videoWin.webContents) return
    const notes = notesWindow()
    // Everything this window was reading stops first, so the notes window starts afresh.
    if (current) await releaseFiles(current)
    current = null
    videoWin?.close()
    if (typeof path === 'string' && notes && !notes.isDestroyed()) {
      notes.webContents.send('videoWindow:popIn', path)
      if (notes.isMinimized()) notes.restore()
      notes.focus()
    }
  })
}
