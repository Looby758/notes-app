import { app, BrowserWindow, dialog } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { hostname } from 'os'
import { dirname, join } from 'path'
import {
  decideSync,
  folderHashText,
  ORBIT_PARTS,
  readManifest,
  stableJson,
  type Agreed,
  type OrbitManifest,
  type OrbitPart
} from '@shared/orbitSync'
import { logError } from './log'

/**
 * Orbit synced everywhere (see shared/orbitSync.ts). In the notes folder:
 *   .notesapp/orbit/<part>.json   what each part is (a value, or a folder's list of files)
 *   .notesapp/orbit/files/<hash>  the files of folder parts (themes, soundboard), named by contents
 * Google Drive takes these to your other computers. This computer remembers in orbit-sync.json (in
 * its settings folder) what it and the notes folder had when they last agreed, per notes folder.
 */

/** A part synced as one value (settings, Home layout, calendar links). */
interface ValuePart {
  kind: 'value'
  /** This computer's value, or null when there's nothing to share. */
  read(): unknown | null
  /** Takes in another computer's value. */
  write(value: unknown): void
}

/** A part synced as a folder of files (themes, soundboard). */
interface FolderPart {
  kind: 'folder'
  folder(): string
  /** After the folder was replaced: read it again. */
  reload(): void
}

export type PartHandler = ValuePart | FolderPart

let handlers: Partial<Record<OrbitPart, PartHandler>> = {}
let getRoot: () => string | null = () => null
let enabled: () => boolean = () => true
let getWindow: () => BrowserWindow | null = () => null

const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const deviceName = (): string => hostname().replace(/\.local$/i, '') || 'another computer'

// ---- what this computer remembers ----

const stateFile = (): string => join(app.getPath('userData'), 'orbit-sync.json')
let state: Record<string, Partial<Record<OrbitPart, Agreed>>> | null = null

function loadState(): Record<string, Partial<Record<OrbitPart, Agreed>>> {
  if (state) return state
  try {
    state = existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), 'utf8')) : {}
  } catch {
    state = {}
  }
  if (!state || typeof state !== 'object') state = {}
  return state!
}

function agree(root: string, part: OrbitPart, agreed: Agreed): void {
  const s = loadState()
  s[root] = { ...s[root], [part]: agreed }
  const tmp = `${stateFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  renameSync(tmp, stateFile())
}

// ---- this computer's side ----

/** File hashes by path, size and time changed, so a big soundboard isn't re-read every time. */
const fileHashes = new Map<string, { size: number; mtime: number; hash: string }>()

async function hashFile(full: string): Promise<string> {
  const st = await stat(full)
  const known = fileHashes.get(full)
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known.hash
  const hash = sha(await readFile(full))
  fileHashes.set(full, { size: st.size, mtime: st.mtimeMs, hash })
  return hash
}

/** Every file in a folder (skipping hidden and half-written ones), by forward-slash path. */
async function listFolder(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue
      const full = join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) await walk(full, rel, depth + 1)
      else if (e.isFile()) out[rel] = await hashFile(full)
    }
  }
  await walk(folder, '', 0)
  return out
}

interface Local {
  hash: string | null
  value?: unknown
  files?: Record<string, string>
}

async function readLocal(h: PartHandler): Promise<Local> {
  if (h.kind === 'value') {
    const value = h.read()
    return value === null || value === undefined ? { hash: null } : { hash: sha(stableJson(value)), value }
  }
  const files = await listFolder(h.folder())
  return Object.keys(files).length ? { hash: sha(folderHashText(files)), files } : { hash: null, files }
}

// ---- the notes folder's side ----

const orbitDir = (root: string): string => join(root, '.notesapp', 'orbit')
const manifestFile = (root: string, part: OrbitPart): string => join(orbitDir(root), `${part}.json`)
const blobFile = (root: string, hash: string): string => join(orbitDir(root), 'files', hash)

/** The part's file in the notes folder: undefined if there's none yet, null if it's broken (still syncing). */
async function readRemote(root: string, part: OrbitPart): Promise<OrbitManifest | null | undefined> {
  let text: string
  try {
    text = await readFile(manifestFile(root, part), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
  try {
    return readManifest(JSON.parse(text))
  } catch {
    return null
  }
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Puts this computer's version in the notes folder: files first, then the list that points at them. */
async function push(root: string, part: OrbitPart, h: PartHandler, local: Local): Promise<void> {
  const manifest: OrbitManifest = { version: 1, hash: local.hash, device: deviceName(), updated: Date.now() }
  if (h.kind === 'value') {
    if (local.hash !== null) manifest.value = local.value
  } else {
    manifest.files = local.files ?? {}
    for (const [path, hash] of Object.entries(manifest.files)) {
      const target = blobFile(root, hash)
      if (existsSync(target)) continue
      await mkdir(dirname(target), { recursive: true })
      const tmp = `${target}.${process.pid}.tmp`
      await copyFile(join(h.folder(), ...path.split('/')), tmp)
      if (sha(await readFile(tmp)) !== hash) {
        await rm(tmp, { force: true })
        throw new Error(`${path} changed while syncing`)
      }
      await rename(tmp, target)
    }
  }
  await writeAtomic(manifestFile(root, part), JSON.stringify(manifest, null, 2))
  await tidyFiles(root)
}

/** Takes in the notes folder's version. False if it isn't all there yet (Drive is still downloading). */
async function pull(root: string, h: PartHandler, remote: OrbitManifest): Promise<boolean> {
  if (h.kind === 'value') {
    h.write(remote.hash === null ? null : remote.value)
    return true
  }
  const files = remote.files ?? {}
  const folder = h.folder()
  const temp = `${folder}.sync-tmp`
  await rm(temp, { recursive: true, force: true })
  try {
    await mkdir(temp, { recursive: true })
    for (const [path, hash] of Object.entries(files)) {
      let data: Buffer
      try {
        data = await readFile(blobFile(root, hash))
      } catch {
        return false
      }
      if (sha(data) !== hash) return false
      const out = join(temp, ...path.split('/'))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, data)
    }
    // Swap the folders: keep the old one until the new one is in place.
    const old = `${folder}.sync-old`
    await rm(old, { recursive: true, force: true })
    if (existsSync(folder)) await rename(folder, old)
    await rename(temp, folder)
    await rm(old, { recursive: true, force: true })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
  h.reload()
  return true
}

/** Removes files no part points at any more (a removed theme or sound). */
async function tidyFiles(root: string): Promise<void> {
  const used = new Set<string>()
  for (const { id } of ORBIT_PARTS) {
    const m = await readRemote(root, id).catch(() => null)
    // A broken list might be another computer's newer one, half-downloaded: don't tidy then.
    if (m === null) return
    for (const hash of Object.values(m?.files ?? {})) used.add(hash)
  }
  let names: string[] = []
  try {
    names = await readdir(join(orbitDir(root), 'files'))
  } catch {
    return
  }
  // Only files a while old: another computer may be adding some right now.
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const name of names) {
    if (used.has(name)) continue
    const full = join(orbitDir(root), 'files', name)
    try {
      if ((await stat(full)).mtimeMs < cutoff) await rm(full, { force: true })
    } catch {
      // Already gone.
    }
  }
}

// ---- asking which version to keep ----

/** Questions you put off ("Decide later"), so they aren't asked again until something changes. */
const putOff = new Set<string>()

async function askWhich(label: string, remote: OrbitManifest): Promise<'local' | 'remote' | 'later'> {
  const when = new Date(remote.updated).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const options = {
    type: 'question' as const,
    title: 'Which version do you want to keep?',
    message: `${label} changed on this computer and on ${remote.device}.`,
    detail: `${remote.device} changed it ${when}. Which version should Orbit keep on both computers? The other one is replaced.`,
    buttons: ['Keep this computer’s', `Keep ${remote.device}’s`, 'Decide later'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  }
  const win = getWindow()
  const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 0 ? 'local' : response === 1 ? 'remote' : 'later'
}

// ---- syncing ----

async function syncPart(root: string, part: OrbitPart, label: string, h: PartHandler): Promise<void> {
  const remote = await readRemote(root, part)
  if (remote === null) return // Half-synced: try again next time.
  const local = await readLocal(h)
  const agreed = loadState()[root]?.[part]
  let step = decideSync(local.hash, remote?.hash, agreed)

  if (step === 'ask' && remote) {
    const key = `${root}|${part}|${local.hash}|${remote.hash}`
    if (putOff.has(key)) return
    const choice = await askWhich(label, remote)
    if (choice === 'later') {
      putOff.add(key)
      return
    }
    step = choice === 'local' ? 'push' : 'pull'
  }

  if (step === 'same') {
    const next = { local: local.hash, remote: remote?.hash ?? null }
    if (!agreed || agreed.local !== next.local || agreed.remote !== next.remote) agree(root, part, next)
  } else if (step === 'push') {
    await push(root, part, h, local)
    agree(root, part, { local: local.hash, remote: local.hash })
  } else if (step === 'pull' && remote) {
    if (!(await pull(root, h, remote))) return
    // What it is here once taken in (this version of Orbit may tidy it a little differently).
    agree(root, part, { local: (await readLocal(h)).hash, remote: remote.hash })
  }
}

let running = false
let again = false

/** Syncs every part with the notes folder now. */
export async function syncOrbit(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    const root = getRoot()
    if (!root || !enabled()) return
    for (const { id, label } of ORBIT_PARTS) {
      const h = handlers[id]
      if (!h) continue
      try {
        await syncPart(root, id, label, h)
      } catch (err) {
        logError(`syncing ${label.toLowerCase()}`, err)
      }
    }
  } finally {
    running = false
    if (again) {
      again = false
      void syncOrbit()
    }
  }
}

let soonTimer: NodeJS.Timeout | undefined
/** Something changed here: sync in a moment (after any other changes that come with it). */
export function syncOrbitSoon(): void {
  clearTimeout(soonTimer)
  soonTimer = setTimeout(() => void syncOrbit(), 2000)
  soonTimer.unref?.()
}

/** Starts syncing: now and then, when you come back to Orbit, and soon after changes. */
export function setupOrbitSync(options: {
  root: () => string | null
  enabled: () => boolean
  window: () => BrowserWindow | null
  parts: Partial<Record<OrbitPart, PartHandler>>
}): void {
  getRoot = options.root
  enabled = options.enabled
  getWindow = options.window
  handlers = options.parts
  setInterval(() => void syncOrbit(), 30_000).unref?.()
  app.on('browser-window-focus', () => syncOrbitSoon())
  syncOrbitSoon()
}
