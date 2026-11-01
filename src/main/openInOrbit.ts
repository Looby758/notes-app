import { app, ipcMain, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'fs'
import { isAbsolute } from 'path'
export { pathsFromArgv } from '@shared/openInOrbit'

/**
 * "Open in Orbit" from File Explorer's right-click menu (Windows: the installer adds it, and it
 * starts Orbit with `--open-in-orbit <file>`) or Finder's Open With (Mac: the open-file event).
 * Files that come in before the window is ready wait until it asks for them.
 */

const waiting: string[] = []
/** The window that has asked for its files (so it's listening). */
let listening: number | null = null
let windowOf: () => BrowserWindow | null = () => null
let show: () => void = () => undefined

/** Hands a file to the window to open (or keeps it until the window is ready). */
export function openInOrbit(path: string): void {
  try {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) return
  } catch {
    return
  }
  const win = windowOf()
  if (app.isReady()) show()
  if (win && !win.isDestroyed() && win.webContents.id === listening) win.webContents.send('orbit:open-path', path)
  else waiting.push(path)
}

/** `main`: the main window now; `showMain`: brings it up. Call once at start-up. */
export function setupOpenInOrbit(main: () => BrowserWindow | null, showMain: () => void): void {
  windowOf = main
  show = showMain
  ipcMain.handle('orbit:takeOpened', (e) => {
    listening = e.sender.id
    return waiting.splice(0)
  })
}
