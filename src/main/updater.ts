import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { UpdateStatus } from '@shared/types'
import { GITHUB_REPO } from '@shared/release'
import { appBundleOf, canReplace, clearQuarantine, download, pickMacZip, releaseFileUrl, startSwap, takeLastResult, unpack } from './macUpdate'

/**
 * Updates come from the project's GitHub Releases. A newer version downloads in the background
 * and installs when you restart (or next quit). On Windows electron-updater does it all; on a Mac
 * its installer needs a paid Apple certificate, so Orbit downloads and swaps itself in instead
 * (macUpdate.ts). If a Mac copy can't replace itself (say it's running from the disk image),
 * Orbit just tells you about the new version and opens its download page.
 */

const MAC = process.platform === 'darwin'
const CHECK_EVERY = 6 * 60 * 60 * 1000
const FIRST_CHECK_AFTER = 15_000

let status: UpdateStatus = { state: 'off', current: app.getVersion() }
let enabled: () => boolean = () => true
let supported = false

// Mac: where updates are unpacked, the app being replaced, the unpacked new copy, and whether
// Restart was pressed (so the new version opens once it's swapped in).
let macWork = ''
let macBundle: string | undefined
let macFresh: string | undefined
let macRelaunch = false
let macSwapStarted = false
let macSelfUpdate = false
let testFeed: string | undefined

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:status', status)
}

/** Short, readable reasons instead of stack traces. */
function friendly(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|net::ERR_/i.test(text)) return 'Couldn’t reach GitHub. Check your internet connection.'
  if (/\b404\b/.test(text)) return 'No releases have been published yet.'
  return text.split('\n')[0].slice(0, 200)
}

/** Mac: downloads the new version's zip for this Mac, unpacks it, and gets it ready to swap in. */
async function macDownload(info: UpdateInfo): Promise<void> {
  const file = pickMacZip(info.files ?? [], process.arch)
  if (!file) {
    set({ state: 'available', version: info.version, manual: true })
    return
  }
  set({ state: 'downloading', version: info.version, percent: 0, manual: false })
  try {
    mkdirSync(macWork, { recursive: true })
    const zip = join(macWork, 'update.zip')
    const url = releaseFileUrl(file.url, info.version, GITHUB_REPO, testFeed)
    await download(url, zip, file.sha512, (percent) => set({ state: 'downloading', percent }), (u) => net.fetch(u))
    macFresh = await unpack(zip, join(macWork, 'new'), info.version)
    set({ state: 'ready', version: info.version, percent: 100 })
    if (process.env['NOTES_UPDATE_TEST_INSTALL']) installMac()
  } catch (err) {
    macFresh = undefined
    set({ state: 'error', error: friendly(err) })
  }
}

/** Mac: quits Orbit; the swap starts as it quits (see setupUpdater), then Orbit opens again. */
function installMac(): void {
  if (!macFresh) return
  macRelaunch = true
  app.quit()
}

async function check(): Promise<UpdateStatus> {
  if (!supported) return status
  // Already downloaded: nothing more to do until you restart.
  if (status.state === 'ready' || status.state === 'downloading') return status
  try {
    const result = await autoUpdater.checkForUpdates()
    // A failed download is reported through the 'error' event; don't also leave it unhandled.
    result?.downloadPromise?.catch(() => undefined)
  } catch (err) {
    set({ state: 'error', error: friendly(err) })
  }
  return status
}

export function setupUpdater(isEnabled: () => boolean): void {
  enabled = isEnabled
  // A test server can stand in for GitHub (NOTES_UPDATE_URL); otherwise only the installed app checks.
  testFeed = process.env['NOTES_UPDATE_URL']
  supported = app.isPackaged || !!testFeed
  if (!supported) status = { ...status, reason: 'Updates are checked in the installed app only.' }
  else status = { ...status, state: 'none' }

  if (MAC && supported) {
    macWork = join(app.getPath('userData'), 'pending-update')
    macBundle = appBundleOf(process.execPath)
    macSelfUpdate = !!macBundle && canReplace(macBundle)
    // Once you've let Orbit open, take away the "downloaded from the internet" mark so macOS
    // doesn't ask again every time.
    if (macBundle) void clearQuarantine(macBundle)
    const last = takeLastResult(macWork)
    // Whatever's left from the last update (the zip, and the folder it was unpacked into).
    rmSync(macWork, { recursive: true, force: true })
    if (last && last !== 'ok') {
      // Offer the download page this time instead of trying (and failing) the same way again.
      macSelfUpdate = false
      status = {
        ...status,
        state: 'error',
        error: `${last} If macOS asked, allow Orbit under System Settings → Privacy & Security → App Management, then check again.`
      }
    }
  }

  autoUpdater.logger = null
  // On a Mac Orbit downloads the update itself (see macDownload).
  autoUpdater.autoDownload = !MAC
  autoUpdater.autoInstallOnAppQuit = !MAC
  if (testFeed) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed })
  }

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('update-available', (info) => {
    if (!MAC) set({ state: 'downloading', version: info.version, percent: 0 })
    else if (macSelfUpdate) void macDownload(info)
    else set({ state: 'available', version: info.version, manual: true })
  })
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => {
    // On a Mac a download in progress is Orbit's own; don't let a late check error hide it.
    if (MAC && (status.state === 'downloading' || status.state === 'ready')) return
    set({ state: 'error', error: friendly(err) })
  })

  // A downloaded Mac update goes in as Orbit quits (whether you pressed Restart or just quit),
  // like it does on Windows.
  app.on('quit', () => {
    if (!MAC || !macFresh || !macBundle || macSwapStarted) return
    macSwapStarted = true
    try {
      startSwap(macWork, macBundle, macFresh, macRelaunch)
    } catch {
      // Nothing more to do while quitting; the update is offered again next time.
    }
  })

  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:install', async () => {
    if (MAC && status.state === 'ready' && macFresh) return installMac()
    if (status.manual || MAC) {
      const tag = status.version ? `tag/v${status.version}` : 'latest'
      await shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/${tag}`)
      return
    }
    // Quits normally (unsaved edits are saved first), installs quietly, and opens Notes again.
    if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
  })

  if (!supported) return
  setTimeout(() => enabled() && check(), FIRST_CHECK_AFTER)
  setInterval(() => enabled() && check(), CHECK_EVERY)
}
