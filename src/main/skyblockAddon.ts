import { BrowserWindow, ipcMain, nativeImage, net, protocol } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { DEFAULT_PACKS, TEXTURE_PACKS, TEXTURES_BASE, type SkyblockAddonState, type TextureMatcher } from '@shared/skyblockTextures'
import { addonDir, addonManifest, addonPath, iconsVersion, onAddonChanged, readJson, setAddonManifest, skyblockAddonReady } from './skyblockAddonFiles'
import { downloadItemList } from './skyblockGoals'
import { logError } from './log'

/**
 * The SkyBlock add-on: everything SkyBlock in Orbit (profile, goal planner, session summaries) is
 * off until you download it, like the offline AI. It brings the NEU item list, and item pictures
 * from skyblock-assets (github.com/skyblockstats/skyblock-assets, MIT): plain Minecraft textures
 * plus the SkyBlock texture packs you pick. Pictures are served to the page as sbtex://tex/<pack>/<file>,
 * and player-head skins as sbtex://skin/<id> (fetched once from Minecraft's skin server and kept).
 */

export const SKYBLOCK_TEX_SCHEME = { scheme: 'sbtex', privileges: { standard: true, secure: true, supportFetchAPI: true } }

const BASE = process.env.NOTES_SKYBLOCK_ASSETS_URL ?? TEXTURES_BASE
const SKINS = process.env.NOTES_SKIN_URL ?? 'https://textures.minecraft.net/texture'
const PARALLEL = 16
const KNOWN = new Set(TEXTURE_PACKS.map((p) => p.id))

let installing: { stage: string; progress: number; packs: string[]; abort: AbortController } | null = null
let lastError = ''

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('skyblockAddon:changed')
}

function folderMb(dir: string): number {
  let bytes = 0
  const walk = (d: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(d, name.name))
      else bytes += statSync(join(d, name.name)).size
    }
  }
  try {
    walk(dir)
  } catch {
    // Gone or half there: count what was seen.
  }
  return Math.round((bytes / 1024 ** 2) * 10) / 10
}

let sizeCache: { at: number; mb: number } | null = null
function state(): SkyblockAddonState {
  const m = addonManifest()
  if (installing) return { state: 'installing', packs: installing.packs, stage: installing.stage, progress: installing.progress, mb: 0, error: '', iconsVersion }
  if (!m) return { state: 'missing', packs: DEFAULT_PACKS, stage: '', progress: 0, mb: 0, error: lastError, iconsVersion }
  if (!sizeCache || sizeCache.at !== m.at) sizeCache = { at: m.at, mb: folderMb(addonDir()) }
  return { state: 'ready', packs: m.packs, stage: '', progress: 1, mb: sizeCache.mb, error: lastError, iconsVersion }
}

async function fetchOk(url: string, signal: AbortSignal, tries = 3): Promise<Buffer | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await net.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
      if (res.status === 404) return null
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      if (signal.aborted) throw new Error('Stopped.')
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)))
  }
  throw new Error('Couldn’t download the SkyBlock pictures from GitHub. Check the internet connection and try again (it carries on where it stopped).')
}

/** A file under BASE, saved under the add-on folder at the same path. Skips files already there. */
async function save(path: string, signal: AbortSignal, keep = false): Promise<boolean> {
  const file = addonPath(...path.split('/'))
  if (keep && existsSync(file)) return true
  const body = await fetchOk(`${BASE}/${path.split('/').map(encodeURIComponent).join('/')}`, signal)
  if (!body) return false
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, body)
  return true
}

/** Downloads (or tops up) the add-on with these SkyBlock packs, best first. */
async function install(packsIn: string[]): Promise<void> {
  if (installing) return
  const packs = [...new Set(packsIn.filter((p) => KNOWN.has(p)))]
  const abort = new AbortController()
  const signal = abort.signal
  installing = { stage: 'Getting the picture lists…', progress: 0, packs, abort }
  lastError = ''
  broadcast()
  const step = (stage: string, progress: number): void => {
    if (!installing) return
    installing.stage = stage
    installing.progress = progress
    broadcast()
  }
  try {
    mkdirSync(addonDir(), { recursive: true })
    const all = [...packs, 'vanilla']
    for (const f of ['data/minecraft_ids.json', 'data/vanilla_damages.json', ...all.map((p) => `matchers/${p}.json`)]) {
      if (!(await save(f, signal))) throw new Error(`GitHub doesn’t have ${f} any more. Orbit needs an update for the SkyBlock pictures.`)
    }

    // The item list next (recipes, accessories, levels), so the planner works even before every picture is in.
    step('Downloading the item list…', 0.03)
    await downloadItemList(signal)

    // Then every picture the packs' matchers point at (worn-armour textures aren't needed).
    const files: string[] = []
    for (const p of all) {
      const list = readJson<{ matchers?: TextureMatcher[] }>(addonPath('matchers', `${p}.json`), {}).matchers ?? []
      const names = new Set(list.filter((m) => m?.m && m.m.t !== 'armor' && typeof m.t === 'string' && /^[\w-]+$/.test(m.t)).map((m) => m.t))
      for (const n of names) files.push(`textures/${p}/${n}.png`)
    }
    let done = 0
    const queue = files.slice()
    const worker = async (): Promise<void> => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await save(f, signal, true)
        done++
        if (done % 25 === 0 || done === files.length)
          step(`Downloading pictures… ${done.toLocaleString('en-GB')} of ${files.length.toLocaleString('en-GB')}`, 0.15 + 0.85 * (done / files.length))
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))

    // Packs you no longer use are deleted.
    try {
      for (const d of readdirSync(addonPath('textures'))) if (!all.includes(d)) rmSync(addonPath('textures', d), { recursive: true, force: true })
    } catch {
      // Nothing to tidy.
    }
    installing = null
    setAddonManifest({ version: 1, packs, at: Date.now(), bytes: 0 })
  } catch (err) {
    lastError = signal.aborted ? '' : err instanceof Error ? err.message : String(err)
    if (!signal.aborted) logError('downloading the SkyBlock add-on', err)
  } finally {
    installing = null
    broadcast()
  }
}

function remove(): void {
  installing?.abort.abort()
  setAddonManifest(null)
  rmSync(addonDir(), { recursive: true, force: true })
  // The item list goes too; your goals, key and session cards stay for if you get it again.
  rmSync(join(addonDir(), '..', 'skyblock-items.json'), { force: true })
  lastError = ''
  broadcast()
}

// ---------- pictures for the page ----------

const skinJobs = new Map<string, Promise<boolean>>()
async function skinFile(hash: string): Promise<string | null> {
  const file = addonPath('skins', `${hash}.png`)
  if (existsSync(file)) return file
  let job = skinJobs.get(hash)
  if (!job) {
    job = (async () => {
      try {
        const res = await net.fetch(`${SKINS}/${hash}`, { signal: AbortSignal.timeout(20_000) })
        if (!res.ok) return false
        mkdirSync(addonPath('skins'), { recursive: true })
        writeFileSync(file, legacyHat(Buffer.from(await res.arrayBuffer())))
        return true
      } catch {
        return false
      } finally {
        skinJobs.delete(hash)
      }
    })()
    skinJobs.set(hash, job)
  }
  return (await job) ? file : null
}

/**
 * Old 64×32 skins often fill the hat layer with solid black, which Minecraft ignores. Do the same:
 * when the whole hat area is solid, make it see-through.
 */
function legacyHat(png: Buffer): Buffer {
  try {
    const img = nativeImage.createFromBuffer(png)
    const { width, height } = img.getSize()
    if (width !== 64 || height !== 32) return png
    const px = img.toBitmap()
    const at = (x: number, y: number): number => (y * width + x) * 4 + 3
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) if (px[at(x, y)] !== 255) return png
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) px[at(x, y)] = 0
    return nativeImage.createFromBitmap(px, { width, height }).toPNG()
  } catch {
    return png
  }
}

function registerProtocol(): void {
  protocol.handle('sbtex', async (req) => {
    const notFound = (): Response => new Response('', { status: 404 })
    if (!skyblockAddonReady()) return notFound()
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return notFound()
    }
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
    let file: string | null = null
    if (url.host === 'tex' && parts.length === 2 && /^[a-z_+]+$/.test(parts[0]) && /^[\w-]+\.png$/.test(parts[1])) file = addonPath('textures', parts[0], parts[1])
    else if (url.host === 'skin' && parts.length === 1 && /^[0-9a-f]{20,80}$/i.test(parts[0])) file = await skinFile(parts[0].toLowerCase())
    if (!file || !existsSync(file)) return notFound()
    const res = await net.fetch(pathToFileURL(file).toString())
    return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=31536000' } })
  })
}

export function setupSkyblockAddon(): void {
  registerProtocol()
  onAddonChanged(broadcast)
  ipcMain.handle('skyblockAddon:state', () => state())
  ipcMain.handle('skyblockAddon:install', async (_e, packs: string[]) => {
    await install(Array.isArray(packs) ? packs.map(String) : DEFAULT_PACKS)
    return state()
  })
  ipcMain.handle('skyblockAddon:cancel', () => {
    installing?.abort.abort()
    return state()
  })
  ipcMain.handle('skyblockAddon:remove', () => {
    remove()
    return state()
  })
}
