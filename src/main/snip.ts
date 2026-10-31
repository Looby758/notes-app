import { BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron'
import { join } from 'path'
import { hideCaptureWindow, loadRenderer } from './capture'
import { readPrintedText } from './handwriting'
import { logError } from './log'
import { acceleratorLabel, IS_MAC, SYSTEM_NAME } from '@shared/platform'

/**
 * Screen snip: press the shortcut (Alt+Shift+S by default) over any app, drag a box round some
 * text, and Orbit reads it (offline, with the same reader as scanned receipts). Then copy it, save
 * it to today's note, search or translate it, or ask the AI about it.
 *
 * How: a picture of the screen under the pointer is taken first, then shown full screen in a
 * frameless window, so you're really drawing on a still picture of the screen.
 */

let win: BrowserWindow | null = null
let shot: { png: Buffer; scale: number } | null = null
let registered = ''
let shortcutError: string | undefined

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
}
let hooks: Hooks

export async function startSnip(): Promise<void> {
  if (win && !win.isDestroyed()) {
    win.focus()
    return
  }
  hideCaptureWindow()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const scale = display.scaleFactor
  try {
    // Give a just-hidden window a moment to leave the screen.
    await new Promise((r) => setTimeout(r, 120))
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error('no picture')
    shot = { png: source.thumbnail.toPNG(), scale }
  } catch (err) {
    logError('screen snip', err)
    hooks.showMain()
    hooks
      .getMain()
      ?.webContents.send(
        'snip:failed',
        IS_MAC
          ? 'Orbit isn’t allowed to see the screen yet. Turn it on in System Settings → Privacy & Security → Screen Recording, then try again.'
          : 'Couldn’t take a picture of the screen. Try again.'
      )
    return
  }

  win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    title: 'Screen snip',
    ...(IS_MAC ? { type: 'panel' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setBounds(display.bounds)
  win.on('closed', () => {
    win = null
    shot = null
  })
  const w = win
  w.webContents.once('did-finish-load', () => {
    w.show()
    w.focus()
  })
  loadRenderer(w, 'snip')
}

function closeSnip(): void {
  win?.close()
}

/** (Re)registers the system-wide snip shortcut. */
export function applySnipShortcut(accel: string): void {
  if (registered === accel) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  shortcutError = undefined
  if (!accel) return
  try {
    if (globalShortcut.register(accel, () => void startSnip())) registered = accel
    else shortcutError = `${acceleratorLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick a different shortcut.`
  } catch {
    shortcutError = `${acceleratorLabel(accel)} can't be used as a shortcut.`
  }
}

export function setupSnip(h: Hooks): void {
  hooks = h
  ipcMain.handle('snip:start', () => startSnip())
  ipcMain.handle('snip:status', () => ({ shortcut: registered ? acceleratorLabel(registered) : '', error: shortcutError }))
  ipcMain.handle('snip:image', () => (shot ? { png: new Uint8Array(shot.png), scale: shot.scale } : null))
  ipcMain.handle('snip:read', async (_e, png: Uint8Array) => (await readPrintedText(png)).replace(/[ \t]+\n/g, '\n').trim())
  ipcMain.handle('snip:close', () => closeSnip())
  // What to do with the text: done here so it works whether or not Orbit's window is open.
  ipcMain.handle('snip:send', (_e, action: 'copy' | 'note' | 'web' | 'translate' | 'ask', text: string) => {
    const t = String(text).slice(0, 20000)
    closeSnip()
    if (action === 'copy') {
      clipboard.writeText(t)
      return
    }
    hooks.showMain()
    const main = hooks.getMain()
    if (!main || main.isDestroyed()) return
    if (action === 'web') main.webContents.send('web:open', `https://www.google.com/search?q=${encodeURIComponent(t.slice(0, 500))}`)
    else if (action === 'translate') main.webContents.send('web:open', `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(t.slice(0, 4000))}`)
    else main.webContents.send('snip:text', action, t)
  })
}
