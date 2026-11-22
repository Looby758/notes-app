import { app, net } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { open, readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { DRIVE_KEEP_DAYS, DRIVE_PIECE, driveReceived, type DriveShare, type FileSendState } from '@shared/fileSend'
import { DRIVE_FILE_SCOPE, authStatus, connect as googleConnect, googleToken } from './calendarSources'
import { logError } from './log'

/**
 * The big file sender's other way: for a friend without Orbit. The files go up to your Google
 * Drive (a folder for several), the link is set to "anyone with the link can view", and you send
 * that link. Orbit takes them off your Drive after a week (or when you press Remove), so they don't
 * fill it up. It only asks Google for access to files Orbit itself makes (drive.file), not the rest
 * of your Drive. Uses the Google sign-in from Settings → Calendar.
 */

// Overridable for tests, which point them at a local fake Google server.
const API = process.env.NOTES_GOOGLE_DRIVE_URL ?? 'https://www.googleapis.com/drive/v3'
const UPLOAD = process.env.NOTES_GOOGLE_DRIVE_UPLOAD_URL ?? 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_TYPE = 'application/vnd.google-apps.folder'

interface Stored extends DriveShare {
  cancelled?: boolean
}

let list: Stored[] | null = null
let onChange: () => void = () => undefined
const FILE = (): string => join(app.getPath('userData'), 'drive-shares.json')

function load(): Stored[] {
  if (list) return list
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8'))
    list = Array.isArray(raw) ? raw : []
  } catch {
    list = []
  }
  for (const s of list!) {
    if (s.status === 'uploading') {
      s.status = 'failed'
      s.error = 'Orbit closed while it was uploading. Try again.'
      s.speed = undefined
    }
  }
  return list!
}

function save(): void {
  try {
    const tmp = `${FILE()}.tmp`
    writeFileSync(tmp, JSON.stringify(load()), 'utf8')
    renameSync(tmp, FILE())
  } catch (err) {
    logError('drive shares save', err)
  }
}

const changed = (): void => {
  save()
  onChange()
}

export const shares = (): DriveShare[] => load().map(({ cancelled: _c, ...s }) => (void _c, s))
export const busy = (): boolean => load().some((s) => s.status === 'uploading')

let scopeKnown: boolean | null = null
export function access(): FileSendState['driveAccess'] {
  const a = authStatus()
  if (!a.configured) return 'setup'
  if (!a.connected) return 'connect'
  return scopeKnown === false ? 'scope' : 'ready'
}

export async function connect(): Promise<void> {
  await googleConnect(false, true)
  scopeKnown = true
  onChange()
}

async function token(): Promise<string> {
  const t = await googleToken(DRIVE_FILE_SCOPE)
  if ('token' in t) {
    scopeKnown = true
    return t.token
  }
  if (t.missing === 'setup') throw new Error('Set up Google in Settings → Calendar first (the same sign-in is used for Drive).')
  if (t.missing === 'scope') {
    scopeKnown = false
    onChange()
    throw new Error('Press “Allow Drive” so Orbit may put files in your Drive.')
  }
  if (t.missing === 'offline') throw new Error(t.error ?? 'Couldn’t reach Google right now.')
  throw new Error(t.error ?? 'Connect your Google account in Settings → Calendar first.')
}

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await net.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 204) return {}
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; details?: { reason?: string }[]; errors?: { reason?: string }[] } }
  if (!res.ok) throw new Error(driveError(res.status, json.error))
  return json
}

function driveError(status: number, error?: { message?: string; errors?: { reason?: string }[] }): string {
  const message = error?.message ?? ''
  const reasons = (error?.errors ?? []).map((e) => e.reason)
  if (/has not been used|is disabled/i.test(message) || reasons.includes('accessNotConfigured')) {
    return 'Switch on the Google Drive API in the Google project you made for your calendar (APIs & Services → Library → Google Drive API → Enable), then try again.'
  }
  if (reasons.includes('storageQuotaExceeded')) return 'Your Google Drive is full.'
  if (status === 401 || status === 403) return 'Google said no. Press “Allow Drive” and try again.'
  return `Google Drive said ${status}${message ? `: ${message}` : ''}.`
}

interface Item {
  path: string
  /** Folders inside the send, joined with /. Empty for files at the top. */
  folder: string
  name: string
  size: number
}

async function collect(paths: string[]): Promise<Item[]> {
  const out: Item[] = []
  const walk = async (path: string, folder: string): Promise<void> => {
    const info = await stat(path)
    if (info.isDirectory()) {
      const inside = folder ? `${folder}/${basename(path)}` : basename(path)
      const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
      for (const e of entries) if (e.isFile() || e.isDirectory()) await walk(join(path, e.name), inside)
    } else if (info.isFile()) {
      out.push({ path, folder, name: basename(path), size: info.size })
    }
    if (out.length > 5000) throw new Error('That’s a lot of files for a Drive link. Zip them up first.')
  }
  for (const p of paths) await walk(p, '')
  return out
}

export async function share(paths: string[]): Promise<DriveShare> {
  if (!paths.length) throw new Error('Pick some files or a folder.')
  await token()
  const items = await collect(paths)
  if (!items.length) throw new Error('There’s nothing in that to send.')
  const total = items.reduce((n, i) => n + i.size, 0)
  const about = await api('GET', '/about?fields=storageQuota(limit,usage)')
  const quota = about.storageQuota as { limit?: string; usage?: string } | undefined
  if (quota?.limit) {
    const free = Number(quota.limit) - Number(quota.usage ?? 0)
    if (free < total) {
      throw new Error(`That’s ${gb(total)} but your Google Drive only has ${gb(Math.max(0, free))} free. Send it with a code instead (no size limit).`)
    }
  }
  const single = items.length === 1 && !items[0].folder
  const title = single ? items[0].name : paths.length === 1 ? basename(paths[0]) : `${basename(paths[0])} and ${paths.length - 1} more`
  const s: Stored = { id: randomUUID(), title, status: 'uploading', done: 0, total, created: Date.now() }
  load().unshift(s)
  changed()
  void upload(s, items, single).catch((err) => {
    if (s.cancelled) return
    s.status = 'failed'
    s.error = (err as Error).message
    s.speed = undefined
    changed()
    // Don't leave half an upload in Drive.
    if (s.driveId) void api('DELETE', `/files/${s.driveId}`).catch(() => undefined)
  })
  return s
}

const gb = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`)

async function upload(s: Stored, items: Item[], single: boolean): Promise<void> {
  // Several files go in a folder of their own (folders inside it too), so it's one link.
  const folders = new Map<string, string>()
  let root: string | undefined
  if (!single) {
    const made = await api('POST', '/files?fields=id', { name: s.title, mimeType: FOLDER_TYPE })
    root = String(made.id)
    s.driveId = root
    changed()
  }
  const folderFor = async (path: string): Promise<string | undefined> => {
    if (!root || !path) return root
    const known = folders.get(path)
    if (known) return known
    const cut = path.lastIndexOf('/')
    const parent = await folderFor(cut > 0 ? path.slice(0, cut) : '')
    const made = await api('POST', '/files?fields=id', { name: path.slice(cut + 1), mimeType: FOLDER_TYPE, parents: [parent] })
    folders.set(path, String(made.id))
    return String(made.id)
  }
  let before = 0
  let last = { at: Date.now(), done: 0 }
  const progress = (done: number): void => {
    s.done = done
    const now = Date.now()
    if (now - last.at >= 1000) {
      const rate = ((done - last.done) * 1000) / (now - last.at)
      s.speed = s.speed ? s.speed * 0.6 + rate * 0.4 : rate
      last = { at: now, done }
      onChange()
    }
  }
  for (const item of items) {
    if (s.cancelled) return
    const parent = await folderFor(item.folder)
    const id = await uploadFile(s, item, parent, (n) => progress(before + n))
    if (single) s.driveId = id
    before += item.size
  }
  if (s.cancelled) return
  await api('POST', `/files/${s.driveId}/permissions`, { role: 'reader', type: 'anyone' })
  const info = await api('GET', `/files/${s.driveId}?fields=webViewLink`)
  Object.assign(s, { status: 'ready', link: String(info.webViewLink ?? ''), done: s.total, speed: undefined, expires: Date.now() + DRIVE_KEEP_DAYS * 86_400_000 })
  changed()
}

async function uploadFile(s: Stored, item: Item, parent: string | undefined, progress: (done: number) => void): Promise<string> {
  const meta = { name: item.name, ...(parent ? { parents: [parent] } : {}) }
  if (item.size === 0) return String((await api('POST', '/files?fields=id', meta)).id)
  const start = await net.fetch(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(item.size)
    },
    body: JSON.stringify(meta)
  })
  if (!start.ok) throw new Error(driveError(start.status, ((await start.json().catch(() => ({}))) as { error?: { message?: string } }).error))
  const session = start.headers.get('location')
  if (!session) throw new Error('Google Drive didn’t start the upload.')
  const handle = await open(item.path, 'r')
  try {
    let offset = 0
    let failures = 0
    const buf = Buffer.alloc(DRIVE_PIECE)
    while (true) {
      if (s.cancelled) throw new Error('cancelled')
      const length = Math.min(DRIVE_PIECE, item.size - offset)
      const { bytesRead } = await handle.read(buf, 0, length, offset)
      if (bytesRead < length) throw new Error(`${item.name} got smaller while uploading.`)
      let res: Response
      try {
        res = await net.fetch(session, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${offset + length - 1}/${item.size}` },
          body: buf.subarray(0, length)
        })
      } catch {
        res = new Response(null, { status: 599 })
      }
      if (res.status === 200 || res.status === 201) {
        progress(item.size)
        return String(((await res.json()) as { id: string }).id)
      }
      if (res.status === 308) {
        offset = driveReceived(res.headers.get('range'))
        failures = 0
        progress(offset)
        continue
      }
      if (res.status === 404 || res.status === 410) throw new Error('Google Drive ended the upload. Try again.')
      // Wobbly internet or Google busy: ask how much it has, wait, and carry on from there.
      failures += 1
      if (failures > 6) throw new Error('Lost the connection to Google Drive. Try again.')
      await new Promise((r) => setTimeout(r, 1000 * 2 ** failures))
      const check = await net.fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${item.size}` } }).catch(() => null)
      if (check?.status === 200 || check?.status === 201) return String(((await check.json()) as { id: string }).id)
      if (check?.status === 308) offset = driveReceived(check.headers.get('range'))
    }
  } finally {
    await handle.close()
  }
}

export async function remove(id: string): Promise<void> {
  const s = load().find((x) => x.id === id)
  if (!s) return
  s.cancelled = s.status === 'uploading'
  if (s.driveId) {
    try {
      await api('DELETE', `/files/${s.driveId}`)
    } catch (err) {
      if (!/404/.test((err as Error).message)) throw err
    }
  }
  Object.assign(s, { status: 'removed', link: undefined, speed: undefined })
  changed()
}

export async function forget(id: string): Promise<void> {
  const s = load().find((x) => x.id === id)
  if (!s) return
  if (s.status === 'uploading' || s.status === 'ready') await remove(id)
  list = load().filter((x) => x.id !== id)
  changed()
}

/** Takes week-old links off Drive. */
async function tidy(): Promise<void> {
  for (const s of load()) {
    if (s.status === 'ready' && s.expires && s.expires < Date.now()) {
      await remove(s.id).catch((err) => logError('drive shares tidy', err))
    }
  }
}

export function setup(changedFn: () => void): void {
  onChange = changedFn
  setTimeout(() => void tidy(), 30_000)
  setInterval(() => void tidy(), 60 * 60_000)
}
