import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { activeThemeId, getTheme } from '@shared/themes'
import type { Prefs } from '@shared/prefs'
import { IS_MAC } from '@shared/platform'
import { isYouTubeUrl, YOUTUBE_HOME } from '@shared/youtube'
import { loadSettings, saveSettings } from './settings'

/**
 * The YouTube mini window: a small window that floats over everything else (other apps too), so a
 * video keeps playing in the corner while you work. YouTube itself runs in a walled-off <webview>
 * (browser.ts locks it down), in the same storage as the web tabs, so you stay signed in.
 */

let miniWin: BrowserWindow | null = null
let prefs: () => Prefs

const DEFAULT_SIZE = { width: 480, height: 304 }
const MARGIN = 24

function loadRenderer(win: BrowserWindow): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#youtube`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'youtube' })
}

/** Where the window was left last time, or the bottom right corner of the screen you're on. */
function startBounds(): Electron.Rectangle {
  const saved = loadSettings().youtubeWindow
  if (saved && saved.x !== undefined && saved.y !== undefined) {
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x! + 60 < a.x + a.width && saved.x! + saved.width - 60 > a.x && saved.y! >= a.y - 10 && saved.y! + 30 < a.y + a.height)
    if (onScreen) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  }
  const { width, height } = saved ?? DEFAULT_SIZE
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return { x: area.x + area.width - width - MARGIN, y: area.y + area.height - height - MARGIN, width, height }
}

/** Floats over other windows (and, on a Mac, over full-screen apps and on every desktop) — or not. */
function setPinned(win: BrowserWindow, on: boolean): void {
  win.setAlwaysOnTop(on, 'floating')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true })
}

function createMiniWindow(): BrowserWindow {
  const { colors } = getTheme(activeThemeId(prefs(), nativeTheme.shouldUseDarkColors))
  const settings = loadSettings()
  const win = new BrowserWindow({
    ...startBounds(),
    minWidth: 280,
    minHeight: 190,
    show: false,
    frame: false,
    minimizable: true,
    maximizable: false,
    backgroundColor: colors.bg,
    title: 'YouTube',
    // The installed app uses the icon baked into Notes.exe; while developing, use the source PNG.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  })
  setPinned(win, settings.youtubePinned !== false)

  // Remember where it was put and how big, for next time.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const remember = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen()) saveSettings({ youtubeWindow: win.getBounds() })
    }, 400)
  }
  win.on('move', remember)
  win.on('resize', remember)
  win.on('closed', () => {
    clearTimeout(saveTimer)
    miniWin = null
  })

  // Links that try to open a new window go to your own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  win.once('ready-to-show', () => win.show())
  loadRenderer(win)
  return win
}

/** Opens the mini window (or brings it back), playing `url` if given, otherwise where you left off. */
export function openYouTube(url?: string): void {
  const page = url && isYouTubeUrl(url) ? url : ''
  if (miniWin && !miniWin.isDestroyed()) {
    if (miniWin.isMinimized()) miniWin.restore()
    miniWin.show()
    miniWin.focus()
    if (page) miniWin.webContents.send('youtube:load', page)
    return
  }
  if (page) saveSettings({ youtubeUrl: page })
  miniWin = createMiniWindow()
}

/** Closes the mini window (when the notes window really closes, so Notes can quit). */
export function closeYouTube(): void {
  if (miniWin && !miniWin.isDestroyed()) miniWin.close()
}

/** Pages the mini window shows itself: YouTube, and Google's sign-in on the way there. */
const STAYS_IN_WINDOW = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|google\.com|google\.[a-z]{2,3}(\.[a-z]{2})?)$/i

function staysInWindow(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && STAYS_IN_WINDOW.test(hostname)
  } catch {
    return url === 'about:blank'
  }
}

export function setupYouTube(getPrefs: () => Prefs): void {
  prefs = getPrefs
  // A link out of YouTube (in a video's description, say) opens in your own browser instead.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return
    const inMini = (): boolean => !!miniWin && !miniWin.isDestroyed() && contents.hostWebContents === miniWin.webContents
    const leave = (e: { preventDefault(): void }, url: string): void => {
      if (!inMini() || staysInWindow(url)) return
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
    contents.on('will-navigate', leave)
    contents.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
      if (isMainFrame) leave(e, url)
    })
  })
  ipcMain.handle('youtube:open', (_e, url?: string) => openYouTube(typeof url === 'string' ? url : undefined))
  ipcMain.handle('youtube:state', () => {
    const { youtubeUrl, youtubePinned, youtubeVideoOnly } = loadSettings()
    return {
      url: youtubeUrl && isYouTubeUrl(youtubeUrl) ? youtubeUrl : YOUTUBE_HOME,
      pinned: youtubePinned !== false,
      videoOnly: youtubeVideoOnly !== false
    }
  })
  // What's playing, so closing and reopening carries on from there.
  ipcMain.handle('youtube:remember', (_e, url: string) => {
    if (typeof url === 'string' && isYouTubeUrl(url)) saveSettings({ youtubeUrl: url })
  })
  ipcMain.handle('youtube:pin', (event, on: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win === miniWin) setPinned(win, !!on)
    saveSettings({ youtubePinned: !!on })
  })
  ipcMain.handle('youtube:videoOnly', (_e, on: boolean) => {
    saveSettings({ youtubeVideoOnly: !!on })
  })
  ipcMain.handle('youtube:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('youtube:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win === miniWin) win.close()
  })
}
