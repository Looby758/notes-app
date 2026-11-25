import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import JSZip from 'jszip'
import {
  ADDON_PACKAGES,
  ADDON_RELEASE_URL,
  ADDON_SCHEME,
  manifestProblem,
  safePackagePath,
  type AddonFileState,
  type AddonManifest,
  type AddonPackage
} from '@shared/addonPackages'
import { addedAddons, addonOn, onAddonsChanged } from './addonGate'
import { logError } from './log'

/**
 * Add-ons that are separate downloads (shared/addonPackages.ts). Adding one downloads its package
 * from the repository's addons/packages folder, checks its fingerprint, and unpacks it into
 * <user data>/addons/<id>; removing one deletes it. The window loads the add-on's code from
 * orbit-addon://<id>/<file>, which only serves an add-on that's added and fully downloaded.
 *
 * For trying a package before it's uploaded, set ORBIT_ADDON_SOURCE to a folder holding the
 * .orbitaddon files (addons/packages); they're still checked the same way.
 */

export const ADDON_FILES_SCHEME = { scheme: ADDON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }

const addonsDir = (): string => join(app.getPath('userData'), 'addons')
const folderOf = (id: string): string => join(addonsDir(), id)

const states = new Map<string, AddonFileState>()
const running = new Map<string, Promise<void>>()

function readManifest(id: string): AddonManifest | null {
  try {
    return JSON.parse(readFileSync(join(folderOf(id), 'manifest.json'), 'utf8')) as AddonManifest
  } catch {
    return null
  }
}

/** Whether this add-on's current package is downloaded and unpacked. */
export function isDownloaded(id: string): boolean {
  const pkg = ADDON_PACKAGES[id]
  return !!pkg && manifestProblem(readManifest(id), id, pkg) === null
}

function stateOf(id: string): AddonFileState {
  return states.get(id) ?? (isDownloaded(id) ? { state: 'ready' } : { state: 'missing' })
}

export function addonFileStates(): Record<string, AddonFileState> {
  return Object.fromEntries(Object.keys(ADDON_PACKAGES).map((id) => [id, stateOf(id)]))
}

function setState(id: string, state: AddonFileState | null): void {
  if (state) states.set(id, state)
  else states.delete(id)
  const all = addonFileStates()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('addonFiles:changed', all)
}

async function fetchPackage(id: string, pkg: AddonPackage): Promise<Buffer> {
  const local = process.env.ORBIT_ADDON_SOURCE
  if (local) return readFileSync(join(local, pkg.file))
  const res = await net.fetch(ADDON_RELEASE_URL + pkg.file, { headers: { 'User-Agent': 'Orbit' } })
  if (!res.ok || !res.body) throw new Error(`the download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || pkg.size
  const parts: Uint8Array[] = []
  let received = 0
  let shown = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    received += value.length
    if (received > pkg.size * 2) throw new Error('the download is bigger than it should be')
    if (received - shown > 64 * 1024) {
      shown = received
      setState(id, { state: 'downloading', received, total })
    }
  }
  return Buffer.concat(parts)
}

/** Writes a checked package into a new folder next to the final one, then swaps it in. */
async function unpack(id: string, pkg: AddonPackage, data: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(data)
  const manifest = JSON.parse((await zip.file('manifest.json')?.async('string')) ?? 'null')
  const problem = manifestProblem(manifest, id, pkg)
  if (problem) throw new Error(`the download isn’t right: ${problem}`)
  const tmp = join(addonsDir(), `.${id}-${randomBytes(4).toString('hex')}`)
  try {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      if (!safePackagePath(entry.name)) throw new Error(`the download has a file Orbit won’t use (${entry.name})`)
      const out = resolve(tmp, entry.name)
      if (!out.startsWith(tmp + sep)) throw new Error('the download has a file outside its folder')
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, await entry.async('nodebuffer'))
    }
    rmSync(folderOf(id), { recursive: true, force: true })
    renameSync(tmp, folderOf(id))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Downloads an add-on's package if it isn't already (one download per add-on at a time). */
export function downloadAddon(id: string): Promise<void> {
  const pkg = ADDON_PACKAGES[id]
  if (!pkg || isDownloaded(id)) return Promise.resolve()
  const busy = running.get(id)
  if (busy) return busy
  const job = (async () => {
    setState(id, { state: 'downloading', received: 0, total: pkg.size })
    try {
      mkdirSync(addonsDir(), { recursive: true })
      const data = await fetchPackage(id, pkg)
      const sha = createHash('sha256').update(data).digest('hex')
      if (sha !== pkg.sha256) throw new Error('the download isn’t the one this Orbit expects (its fingerprint doesn’t match)')
      await unpack(id, pkg, data)
      // Removed while it downloaded: don't keep it.
      if (!addonOn(id)) removeAddonFiles(id)
      setState(id, null)
    } catch (err) {
      logError(`download add-on ${id}`, err)
      setState(id, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
    } finally {
      running.delete(id)
    }
  })()
  running.set(id, job)
  return job
}

export function removeAddonFiles(id: string): void {
  if (!(id in ADDON_PACKAGES)) return
  try {
    rmSync(folderOf(id), { recursive: true, force: true })
  } catch (err) {
    logError(`remove add-on ${id}`, err)
  }
  if (!running.has(id)) setState(id, null)
}

/** Downloads what's added and missing, and deletes what's no longer added. */
function sync(installed: readonly string[]): void {
  for (const id of Object.keys(ADDON_PACKAGES)) {
    if (installed.includes(id)) {
      if (!isDownloaded(id) && stateOf(id).state !== 'failed') void downloadAddon(id)
    } else if (existsSync(folderOf(id))) removeAddonFiles(id)
  }
}

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

export function setupAddonFiles(): void {
  protocol.handle(ADDON_SCHEME, (request) => {
    const url = new URL(request.url)
    const id = url.host
    const path = decodeURIComponent(url.pathname.slice(1))
    if (!(id in ADDON_PACKAGES) || !addonOn(id) || !isDownloaded(id) || !safePackagePath(path)) return new Response('Not available', { status: 404 })
    const ext = path.slice(path.lastIndexOf('.'))
    try {
      return new Response(readFileSync(join(folderOf(id), path)), { headers: { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  ipcMain.handle('addonFiles:states', () => addonFileStates())
  ipcMain.handle('addonFiles:retry', (_e, id: string) => {
    if (typeof id !== 'string' || !addonOn(id)) return
    states.delete(id)
    return downloadAddon(id)
  })
  onAddonsChanged(sync)
  // At start: an add-on that's added (say, from before it was a download) but not downloaded yet.
  setTimeout(() => sync(addedAddons()), 1500)
}
