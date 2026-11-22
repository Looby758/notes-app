import { BrowserWindow, ipcMain, nativeImage, net, protocol } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  DEFAULT_PACKS,
  HYPIXEL_PACK,
  hypixelFileName,
  resolveHypixelModels,
  TEXTURE_PACKS,
  TEXTURES_BASE,
  type SkyblockAddonState,
  type TextureMatcher
} from '@shared/skyblockTextures'
import { createHash } from 'crypto'
import JSZip from 'jszip'
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
const HYPIXEL = process.env.NOTES_HYPIXEL_URL ?? 'https://api.hypixel.net'
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

async function fetchOk(url: string, signal: AbortSignal, tries = 3, timeout = 30_000): Promise<Buffer | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await net.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) })
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
    // Hypixel's own pack comes from Hypixel, the rest from skyblock-assets.
    const wantHypixel = packs.includes(HYPIXEL_PACK)
    const all = [...packs.filter((p) => p !== HYPIXEL_PACK), 'vanilla']
    const texEnd = wantHypixel ? 0.8 : 1
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
          step(`Downloading pictures… ${done.toLocaleString('en-GB')} of ${files.length.toLocaleString('en-GB')}`, 0.15 + (texEnd - 0.15) * (done / files.length))
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    if (wantHypixel) await installHypixelPack(signal, (stage, f) => step(stage, texEnd + (1 - texEnd) * f))

    // Packs you no longer use are deleted.
    const keep = wantHypixel ? [...all, HYPIXEL_PACK] : all
    try {
      for (const d of readdirSync(addonPath('textures'))) if (!keep.includes(d)) rmSync(addonPath('textures', d), { recursive: true, force: true })
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

/**
 * Hypixel's own SkyBlock pack, from Hypixel's resources API (the same zip the game loads). Only the
 * item pictures are kept: each item model's texture, saved flat under textures/hypixel/, and a list
 * of item model → picture in matchers/hypixel.json. Skipped when the version on disk is current.
 */
async function installHypixelPack(signal: AbortSignal, step: (stage: string, fraction: number) => void): Promise<void> {
  step('Asking Hypixel for its SkyBlock pack…', 0)
  let list: unknown
  try {
    const res = await net.fetch(`${HYPIXEL}/v2/resources/packs`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
    if (!res.ok) throw new Error(String(res.status))
    list = await res.json()
  } catch {
    if (signal.aborted) throw new Error('Stopped.')
    throw new Error('Couldn’t reach Hypixel to get its SkyBlock pack. Try again, or untick “Hypixel (official)”.')
  }
  const pack = ((list as { packs?: { id?: string; versions?: { packFormat?: number; hash?: string; url?: string }[] }[] })?.packs ?? []).find((p) => p.id === 'SkyBlock')
  const version = [...(pack?.versions ?? [])].filter((v) => typeof v.url === 'string' && /^https?:\/\//.test(v.url)).sort((a, b) => (b.packFormat ?? 0) - (a.packFormat ?? 0))[0]
  if (!version?.url) throw new Error('Hypixel didn’t list a SkyBlock pack to download. Untick “Hypixel (official)” for now.')
  const current = readJson<{ hash?: string; models?: Record<string, string> }>(addonPath('matchers', `${HYPIXEL_PACK}.json`), {})
  if (current.hash && current.hash === version.hash && current.models && existsSync(addonPath('textures', HYPIXEL_PACK))) return

  step('Downloading Hypixel’s SkyBlock pack…', 0.05)
  const body = await fetchOk(version.url, signal, 3, 180_000)
  if (!body) throw new Error('Hypixel’s SkyBlock pack has moved. Try again later, or untick “Hypixel (official)”.')
  if (version.hash && createHash('sha1').update(body).digest('hex') !== version.hash.toLowerCase())
    throw new Error('Hypixel’s SkyBlock pack didn’t download properly (its checksum is wrong). Try again.')

  step('Reading Hypixel’s SkyBlock pack…', 0.6)
  const zip = await JSZip.loadAsync(body)
  const items: Record<string, Record<string, unknown>> = {}
  const models: Record<string, Record<string, unknown>> = {}
  const textures = new Map<string, JSZip.JSZipObject>()
  const jobs: Promise<void>[] = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    const m = /^(?:[^/]+\/)?assets\/hypixel_skyblock\/(items|models|textures)\/(.+)\.(json|png)$/.exec(path)
    if (!m) return
    if (m[1] === 'textures' && m[3] === 'png') textures.set(m[2], entry)
    else if (m[3] === 'json' && m[1] !== 'textures')
      jobs.push(
        entry.async('string').then((t) => {
          try {
            ;(m[1] === 'items' ? items : models)[m[2]] = JSON.parse(t)
          } catch {
            // A broken file shouldn't stop the rest.
          }
        })
      )
  })
  await Promise.all(jobs)
  const byModel = resolveHypixelModels(items, models, (t) => textures.has(t))
  if (Object.keys(byModel).length < 50) throw new Error('Hypixel’s SkyBlock pack looked empty. Orbit may need an update for it.')

  const dir = addonPath('textures', HYPIXEL_PACK)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const needed = [...new Set(Object.values(byModel))]
  let done = 0
  for (const tex of needed) {
    if (signal.aborted) throw new Error('Stopped.')
    const entry = textures.get(tex)
    if (entry) writeFileSync(join(dir, `${hypixelFileName(tex)}.png`), await entry.async('nodebuffer'))
    if (++done % 100 === 0) step(`Saving Hypixel’s pictures… ${done} of ${needed.length}`, 0.7 + 0.3 * (done / needed.length))
  }
  const out = Object.fromEntries(Object.entries(byModel).map(([model, tex]) => [model, hypixelFileName(tex)]))
  mkdirSync(addonPath('matchers'), { recursive: true })
  writeFileSync(addonPath('matchers', `${HYPIXEL_PACK}.json`), JSON.stringify({ hash: version.hash ?? '', models: out }))
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
