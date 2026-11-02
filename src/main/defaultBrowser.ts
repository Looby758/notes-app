import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { IS_MAC } from '@shared/platform'
import { hostOf, URL_FLAG, urlsFromArgv } from '@shared/browser'
import type { DefaultBrowserState } from '@shared/types'
import { logError } from './log'

/**
 * Orbit as your default browser, so links from Discord, email apps and everything else open in a
 * web tab.
 *
 * Windows doesn't let apps make themselves the default: Orbit registers itself as a browser (for
 * you only, in HKCU, the same keys Chrome and Firefox add) and then opens Windows' Default apps
 * page on Orbit, where you pick it. Links then start Orbit with `--orbit-url=<address>`.
 * The uninstaller removes the keys again (build/installer.nsh).
 *
 * On a Mac, Orbit says it can open web links (electron-builder.yml's protocols) and asks macOS to
 * use it, which shows macOS' own "change your default browser?" question.
 */

const run = promisify(execFile)

const PROG_ID = 'OrbitURL'
const CLIENT_KEY = 'Software\\Clients\\StartMenuInternet\\Orbit'

/** How Windows should start Orbit: the program, and in development the app's folder too. */
function command(): string {
  const exe = `"${process.execPath}"`
  return app.isPackaged ? exe : `${exe} "${app.getAppPath()}"`
}

const regString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The .reg file that registers Orbit as a browser for this Windows user. */
export function registryFile(cmd: string, icon: string): string {
  const open = `${cmd} "${URL_FLAG}=%1"`
  const lines = [
    'Windows Registry Editor Version 5.00',
    '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}]`,
    `@=${regString('Orbit web page')}`,
    `"URL Protocol"=""`,
    `"FriendlyTypeName"=${regString('Orbit web page')}`,
    '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}\\DefaultIcon]`,
    `@=${regString(icon)}`,
    '',
    `[HKEY_CURRENT_USER\\Software\\Classes\\${PROG_ID}\\shell\\open\\command]`,
    `@=${regString(open)}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}]`,
    `@=${regString('Orbit')}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\DefaultIcon]`,
    `@=${regString(icon)}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\shell\\open\\command]`,
    `@=${regString(cmd)}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities]`,
    `"ApplicationName"=${regString('Orbit')}`,
    `"ApplicationDescription"=${regString('Orbit: notes, and a web browser beside them')}`,
    `"ApplicationIcon"=${regString(icon)}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities\\StartMenu]`,
    `"StartMenuInternet"=${regString('Orbit')}`,
    '',
    `[HKEY_CURRENT_USER\\${CLIENT_KEY}\\Capabilities\\URLAssociations]`,
    `"http"=${regString(PROG_ID)}`,
    `"https"=${regString(PROG_ID)}`,
    '',
    `[HKEY_CURRENT_USER\\Software\\RegisteredApplications]`,
    `"Orbit"=${regString(`${CLIENT_KEY}\\Capabilities`)}`,
    ''
  ]
  return lines.join('\r\n')
}

export async function defaultBrowserState(): Promise<DefaultBrowserState> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'], {
        windowsHide: true
      })
      return { supported: true, isDefault: stdout.includes(PROG_ID) }
    } catch {
      return { supported: true, isDefault: false }
    }
  }
  if (IS_MAC) return { supported: true, isDefault: app.isDefaultProtocolClient('https') }
  return { supported: false, isDefault: false }
}

/** Registers Orbit as a browser and takes you to where the system lets you choose it. */
export async function makeDefaultBrowser(): Promise<DefaultBrowserState> {
  if (process.platform === 'win32') {
    const reg = join(app.getPath('temp'), `orbit-browser-${process.pid}.reg`)
    // .reg files are UTF-16 with a byte order mark.
    await fs.writeFile(reg, Buffer.from(`﻿${registryFile(command(), `${process.execPath},0`)}`, 'utf16le'))
    try {
      await run('reg', ['import', reg], { windowsHide: true })
    } finally {
      await fs.rm(reg, { force: true })
    }
    // Windows 11 opens Orbit's own page; older Windows the Default apps list.
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Orbit').catch(() => shell.openExternal('ms-settings:defaultapps'))
  } else if (IS_MAC) {
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
  } else {
    throw new Error('Orbit can be your default browser on Windows and on a Mac.')
  }
  return defaultBrowserState()
}

// ---------- links handed to Orbit ----------

const waiting: string[] = []
let windowOf: () => BrowserWindow | null = () => null
let show: () => void = () => undefined
let listening: number | null = null

/** A link from another app: open it in a web tab (or keep it until the window is ready). */
export function openLinkInOrbit(url: string): void {
  if (!hostOf(url)) return
  const win = windowOf()
  if (app.isReady()) show()
  if (win && !win.isDestroyed() && win.webContents.id === listening) win.webContents.send('web:open', url)
  else waiting.push(url)
}

/** Links on a command line (Windows starts Orbit with them, or a second copy passes them on). */
export function openLinksFromArgv(argv: string[]): void {
  urlsFromArgv(argv).forEach(openLinkInOrbit)
}

/**
 * Opens a web page in your *other* browser. If Orbit is the default browser, the system would just
 * hand it straight back, so Windows uses Edge and a Mac Safari.
 */
export async function openInOtherBrowser(url: string): Promise<void> {
  if (!/^(https?|mailto):/i.test(url)) return
  if (/^https?:/i.test(url) && (await defaultBrowserState().catch(() => ({ isDefault: false }))).isDefault) {
    if (process.platform === 'win32') return shell.openExternal(`microsoft-edge:${url}`)
    if (IS_MAC) {
      await run('open', ['-a', 'Safari', url]).catch((err) => logError('open in Safari', err))
      return
    }
  }
  await shell.openExternal(url)
}

/** Call once at start-up (before the app is ready, so the Mac's first link isn't missed). */
export function setupDefaultBrowser(main: () => BrowserWindow | null, showMain: () => void): void {
  windowOf = main
  show = showMain
  // Mac: a link clicked in another app while Orbit is the default browser.
  app.on('open-url', (e, url) => {
    e.preventDefault()
    openLinkInOrbit(url)
  })
  app.whenReady().then(() => {
    ipcMain.handle('web:takePending', (e) => {
      listening = e.sender.id
      return waiting.splice(0)
    })
    ipcMain.handle('web:defaultBrowser', () => defaultBrowserState())
    ipcMain.handle('web:makeDefault', () => makeDefaultBrowser())
    ipcMain.handle('web:openOutside', (_e, url: string) => openInOtherBrowser(String(url)))
  }, (err) => logError('default browser', err))
}
