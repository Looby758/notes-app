import { BrowserWindow, ipcMain, screen } from 'electron'
import { isWebUrl, WEB_PARTITION } from '@shared/web'
import { playVideoFrom } from '@shared/video'
import { blockAds, guardPage } from './browser'
import { isAppPage } from './studio'
import { loadSettings, saveSettings } from './settings'

/**
 * A web tab's page in a window of its own ("Pop out into its own window"), so YouTube (or any site)
 * can go full screen on one screen while you carry on using Orbit on the other. Unlike the YouTube
 * mini window it doesn't float on top or hide the rest of the page: it's an ordinary window with
 * the whole site in it, walled off like the web tabs (same storage, so you stay signed in).
 */

let webWin: BrowserWindow | null = null
let notesWindow: () => BrowserWindow | null

const SIZE = { width: 1280, height: 760 }

function startBounds(): Electron.Rectangle {
  const saved = loadSettings().webWindow
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

/** Where to start the page's video once it's loaded, in seconds (YouTube links carry their own). */
let startAt = 0

function create(): BrowserWindow {
  const win = new BrowserWindow({
    ...startBounds(),
    show: false,
    minWidth: 320,
    minHeight: 200,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Web',
    webPreferences: {
      partition: WEB_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  const page = win.webContents
  // Links that open a new tab go to a web tab in the notes window; sign-in pop-ups work as in the tabs.
  guardPage(page, () => {
    const notes = notesWindow()
    return notes && !notes.isDestroyed() ? notes.webContents : null
  }, { appShortcuts: false })
  blockAds(page)

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const remember = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => !win.isDestroyed() && !win.isFullScreen() && saveSettings({ webWindow: win.getNormalBounds() }), 400)
  }
  win.on('move', remember)
  win.on('resize', remember)
  win.on('closed', () => {
    clearTimeout(saveTimer)
    webWin = null
  })

  // F11 puts the window full screen (and back); Esc leaves it. YouTube's own full-screen button
  // (or double-clicking the video) fills the screen too.
  page.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      e.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false)
    }
  })
  // A video from another site carries on from where it had got to in the tab.
  page.on('did-finish-load', () => {
    if (startAt > 0) page.executeJavaScript(playVideoFrom(startAt), true).catch(() => undefined)
    startAt = 0
  })
  win.once('ready-to-show', () => win.show())
  return win
}

/** Shows `url` in the web window (opening it if it isn't already), its video starting `seconds` in. */
export function popOutWebPage(url: string, seconds = 0): void {
  startAt = Math.max(0, Math.floor(seconds) || 0)
  if (!webWin || webWin.isDestroyed()) webWin = create()
  else {
    if (webWin.isMinimized()) webWin.restore()
    webWin.focus()
  }
  void webWin.loadURL(url).catch(() => undefined)
}

/** Closes the web window along with the notes window. */
export function closeWebWindow(): void {
  if (webWin && !webWin.isDestroyed()) webWin.close()
}

export function setupWebWindow(getNotesWindow: () => BrowserWindow | null): void {
  notesWindow = getNotesWindow
  ipcMain.handle('webWindow:open', (e, url: unknown, seconds: unknown) => {
    if (!isAppPage(e.sender) || typeof url !== 'string' || !isWebUrl(url)) return
    popOutWebPage(url, Number(seconds) || 0)
  })
}
