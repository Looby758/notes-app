import { app, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { icoFromImage } from './appIcon'
import { logError } from './log'
import { TEST_COPY } from './testCopy'
import { SNIP_DELAY_FLAG, SNIP_DELAYS, SNIP_PICTURE_FLAG, SNIP_TEXT_FLAG } from '@shared/snipLaunch'

/**
 * Snipping from the Windows taskbar, without opening Orbit's window:
 *
 * - "Orbit Snip" in the Start menu, with its own icon. Pinned to the taskbar it's a one-click
 *   button: click, drag a box, and the picture is on the clipboard to paste anywhere.
 * - Orbit's own taskbar button (right-click it, or drag up on it) lists "Snip a picture" and
 *   "Snip text".
 * - The tray icon's menu has both too, and clicking the tray icon can snip (Settings).
 *
 * Each starts Orbit with a flag (shared/snipLaunch.ts). If Orbit's already running, that copy
 * hands the flag over and closes, so the snip opens straight away.
 */

const SHORTCUT_NAME = TEST_COPY ? 'Orbit Snip (test copy).lnk' : 'Orbit Snip.lnk'
/** Its own id, so pinning it gives it its own taskbar button rather than joining Orbit's. */
const SHORTCUT_APP_ID = TEST_COPY ? 'com.notesapp.desktop.testcopy.snip' : 'com.notesapp.desktop.snip'
const SNIP_PNG = join(__dirname, '../../build/snip.png')

/** How to start this Orbit with a flag (in development the program is electron.exe plus the app's folder). */
function launchArgs(flag: string): string {
  return app.isPackaged ? flag : `"${app.getAppPath()}" ${flag}`
}

const shortcutFile = (): string => join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_NAME)

/** The snip icon as an .ico (made once, in the app's data folder), or Orbit's own icon if that fails. */
function snipIcon(): string {
  try {
    const image = nativeImage.createFromPath(SNIP_PNG)
    if (image.isEmpty()) return process.execPath
    const dir = join(app.getPath('userData'), 'app-icons')
    const file = join(dir, 'snip-1.ico')
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, icoFromImage(image))
    }
    return file
  } catch (err) {
    logError('snip icon', err)
    return process.execPath
  }
}

/** Orbit's taskbar button's jump list: right-click it (or drag up on it) to snip. */
function setJumpList(icon: string): void {
  const ok = app.setUserTasks([
    {
      program: process.execPath,
      arguments: launchArgs(SNIP_PICTURE_FLAG),
      title: 'Snip a picture',
      description: 'Drag a box round anything on screen and it’s copied, ready to paste anywhere.',
      iconPath: icon,
      iconIndex: 0
    },
    // After a few seconds, so you can hover over something (open a menu, show a tooltip) first.
    ...SNIP_DELAYS.map((s) => ({
      program: process.execPath,
      arguments: launchArgs(`${SNIP_DELAY_FLAG}=${s}`),
      title: `Snip in ${s} seconds`,
      description: `Waits ${s} seconds, so you can hover over something, then freezes the screen for you to drag a box.`,
      iconPath: icon,
      iconIndex: 0
    })),
    {
      program: process.execPath,
      arguments: launchArgs(SNIP_TEXT_FLAG),
      title: 'Snip text',
      description: 'Drag a box round some text to copy, save, search or translate it.',
      iconPath: icon,
      iconIndex: 0
    }
  ])
  if (!ok) logError('snip jump list', 'Windows didn’t take the taskbar tasks')
}

/**
 * The "Orbit Snip" Start menu shortcut, made (or put right) each start. Only the installed app
 * makes it: in development it would point at electron.exe.
 */
function ensureShortcut(icon: string): string | null {
  if (!app.isPackaged && !process.env.NOTES_TEST_SHORTCUTS) return null
  const file = shortcutFile()
  const want = {
    target: process.execPath,
    args: launchArgs(SNIP_PICTURE_FLAG),
    cwd: join(process.execPath, '..'),
    description: 'Snip part of the screen with Orbit: drag a box and it’s copied, ready to paste anywhere.',
    icon,
    iconIndex: 0,
    appUserModelId: SHORTCUT_APP_ID
  }
  try {
    if (existsSync(file)) {
      const have = shell.readShortcutLink(file)
      if (have.target === want.target && have.args === want.args && have.icon === want.icon && have.appUserModelId === want.appUserModelId) return file
    }
    mkdirSync(join(file, '..'), { recursive: true })
    return shell.writeShortcutLink(file, existsSync(file) ? 'replace' : 'create', want) ? file : null
  } catch (err) {
    logError('Orbit Snip shortcut', err)
    return null
  }
}

let shortcut: string | null = null

export function setupSnipTaskbar(): void {
  ipcMain.handle('snip:taskbar', () => ({ available: process.platform === 'win32', shortcut: !!shortcut }))
  // Shows "Orbit Snip" in File Explorer, where right-click → Pin to taskbar works too.
  ipcMain.handle('snip:showShortcut', () => {
    if (shortcut && existsSync(shortcut)) shell.showItemInFolder(shortcut)
  })
  if (process.platform !== 'win32') return
  const icon = snipIcon()
  setJumpList(icon)
  shortcut = ensureShortcut(icon)
}
