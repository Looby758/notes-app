import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, shell } from 'electron'
import { randomInt, randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, open, readdir, rename, rm, stat, statfs, truncate, writeFile, type FileHandle } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { hostname, userInfo } from 'os'
import {
  CODE_LIFETIME_MS,
  MAX_BAD_TRIES,
  bytesDone,
  codeText,
  freeName,
  makeCode,
  parseCode,
  readManifest,
  safeRelPath,
  sendTitle,
  settle,
  validPosition,
  type FileSendState,
  type FsSignal,
  type Manifest,
  type Position,
  type SendCode,
  type SendFile,
  type Transfer
} from '@shared/fileSend'
import { codeKey, seal, unseal } from './fileSendCrypto'
import { logError } from './log'
import * as drive from './driveShare'
import { TOKEN_PAGE, decryptKey, setRelaySecrets, setUpServer, turnOnRelay, type SetupStep } from './fileSendSetup'

/**
 * The big file sender. Send: pick files or a folder, get a code. Receive: type the code, see who
 * it's from and how big, Accept, and it's saved where you choose.
 *
 * This side (main) does the meeting on the intro server (server/file-sender), locks the setting-up
 * messages with the code (fileSendCrypto.ts), and reads and writes the files. The connection
 * itself is WebRTC in the main window (renderer lib/fileSendEngine.ts), which asks for each piece
 * to send and hands over each piece received. Unfinished sends carry on where they stopped, even
 * after Orbit closes; the computer is kept awake while one is going.
 */

/**
 * The intro server everyone's Orbit uses, once it's set up (server/file-sender/README.md). Put the
 * address here before making a release, so friends don't have to paste it; Settings can override it.
 */
export const DEFAULT_SERVER = ''

interface Stored extends Transfer {
  /** Sender: the file on this computer for each file in the manifest. */
  sources?: string[]
  /** The code (the sender shows it; the receiver keeps it to reconnect). */
  secret?: SendCode
  badTries?: number
  /** The receiver pressed Accept (so after a drop it starts again by itself). */
  accepted?: boolean
}

interface Saved {
  server?: string
  relay?: boolean
  /** Set up from here: the Cloudflare key (encrypted) and account, to turn the relay on later. */
  cloudflare?: { key: string; account: string }
  transfers: Stored[]
}

const FILE = (): string => join(app.getPath('userData'), 'file-sender.json')
const ACTIVE = new Set<Transfer['status']>(['waiting', 'connecting', 'asking', 'sending', 'reconnecting'])

let saved: Saved | null = null

function load(): Saved {
  if (saved) return saved
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8')) as Saved
    saved = { server: raw.server, transfers: Array.isArray(raw.transfers) ? raw.transfers : [] }
  } catch {
    saved = { transfers: [] }
  }
  // Orbit closed part-way: they carry on when you press Carry on (or say they've run out).
  for (const t of saved.transfers) {
    if (!ACTIVE.has(t.status)) continue
    if (t.direction === 'send' && !t.accepted && t.expires && t.expires < Date.now()) {
      t.status = 'failed'
      t.error = 'Nobody used the code within an hour.'
    } else if (t.direction === 'send' && !t.accepted) {
      // A code nobody has used yet: just wait for them again.
      t.status = 'waiting'
    } else {
      t.status = 'paused'
    }
    t.speed = undefined
  }
  return saved
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function save(now = false): void {
  clearTimeout(saveTimer)
  const write = (): void => {
    try {
      const s = load()
      const tmp = `${FILE()}.tmp`
      writeFileSync(tmp, JSON.stringify(s), 'utf8')
      renameSync(tmp, FILE())
    } catch (err) {
      logError('file sender save', err)
    }
  }
  if (now) write()
  else saveTimer = setTimeout(write, 1000)
}

export const serverAddress = (): string => (load().server ?? DEFAULT_SERVER).replace(/\/+$/, '')

const find = (id: string): Stored => {
  const t = load().transfers.find((x) => x.id === id)
  if (!t) throw new Error('That send isn’t here any more.')
  return t
}

/** What the page sees (without the secret bits). */
function publicOf(t: Stored): Transfer {
  const { sources: _s, secret: _c, badTries: _b, accepted: _a, ...rest } = t
  void _s
  void _c
  void _b
  void _a
  return rest
}

export function state(): FileSendState {
  return {
    server: serverAddress(),
    ownServer: !!load().cloudflare,
    relay: !!load().relay,
    setupSteps,
    transfers: load().transfers.map(publicOf),
    drive: drive.shares(),
    driveAccess: drive.access()
  }
}

let broadcastTimer: ReturnType<typeof setTimeout> | undefined
function broadcast(now = false): void {
  const send = (): void => {
    broadcastTimer = undefined
    const s = state()
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('fsend:state', s)
    keepAwake()
  }
  if (now) {
    clearTimeout(broadcastTimer)
    send()
  } else if (!broadcastTimer) broadcastTimer = setTimeout(send, 250)
}

function changed(t: Stored, patch: Partial<Stored>, now = false): void {
  Object.assign(t, patch)
  save(now)
  broadcast(now)
}

/** Tells the main window's WebRTC side about something from the room. */
function toEngine(event: { id: string; kind: 'peer' | 'signal' | 'gone' | 'stop'; ice?: RTCIceServer[]; signal?: FsSignal }): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('fsend:event', event)
}

// ---------- Keeping the computer awake ----------

let blocker: number | null = null
function keepAwake(): void {
  const busy = load().transfers.some((t) => t.status === 'sending' || t.status === 'reconnecting' || t.status === 'asking' || t.status === 'connecting') || drive.busy()
  if (busy && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!busy && blocker !== null) {
    powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

// ---------- Speed ----------

const speedSamples = new Map<string, { at: number; done: number }>()
function noteProgress(t: Stored, done: number): void {
  const now = Date.now()
  const last = speedSamples.get(t.id)
  t.done = done
  if (!last) speedSamples.set(t.id, { at: now, done })
  else if (now - last.at >= 1000) {
    const rate = ((done - last.done) * 1000) / (now - last.at)
    t.speed = t.speed ? t.speed * 0.6 + rate * 0.4 : rate
    speedSamples.set(t.id, { at: now, done })
  }
  save()
  broadcast()
}

// ---------- The room on the intro server ----------

interface Room {
  ws: WebSocket | null
  key: Buffer
  stopped: boolean
  retry?: ReturnType<typeof setTimeout>
  tries: number
}

const rooms = new Map<string, Room>()

function closeRoom(id: string): void {
  const r = rooms.get(id)
  if (!r) return
  r.stopped = true
  clearTimeout(r.retry)
  try {
    r.ws?.close()
  } catch {
    // Already closed.
  }
  rooms.delete(id)
}

async function openRoom(t: Stored): Promise<void> {
  const server = serverAddress()
  if (!server) throw new Error('Set up the intro server first (see the box at the top of Big file sender).')
  if (!t.secret) throw new Error('This send has lost its code.')
  closeRoom(t.id)
  const room: Room = { ws: null, key: await codeKey(t.secret), stopped: false, tries: 0 }
  rooms.set(t.id, room)
  connectRoom(t, room)
}

function connectRoom(t: Stored, room: Room): void {
  if (room.stopped) return
  const role = t.direction === 'send' ? 'host' : 'guest'
  const url = `${serverAddress().replace(/^http/, 'ws')}/room/${t.secret!.room}?as=${role}`
  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch (err) {
    changed(t, { status: 'failed', error: `The intro server address doesn’t work (${(err as Error).message}).` }, true)
    return
  }
  room.ws = ws
  const again = (ms: number): void => {
    if (room.stopped || rooms.get(t.id) !== room) return
    clearTimeout(room.retry)
    room.retry = setTimeout(() => connectRoom(t, room), ms)
  }
  ws.onopen = () => {
    room.tries = 0
  }
  ws.onmessage = (e) => {
    const text = typeof e.data === 'string' ? e.data : ''
    if (!text) return
    if (text.startsWith('{')) {
      let sys: { sys?: string; ice?: RTCIceServer[] }
      try {
        sys = JSON.parse(text)
      } catch {
        return
      }
      onSys(t, room, sys)
      return
    }
    const signal = unseal(room.key, text) as FsSignal | null
    if (!signal || typeof signal !== 'object' || typeof (signal as { t?: unknown }).t !== 'string') {
      wrongCode(t)
      return
    }
    toEngine({ id: t.id, kind: 'signal', signal })
  }
  ws.onclose = () => {
    if (room.ws !== ws || room.stopped) return
    room.ws = null
    room.tries += 1
    // The internet dropped, or the server restarted: keep trying, more slowly each time.
    again(Math.min(30_000, 1000 * 2 ** Math.min(room.tries, 5)))
  }
  ws.onerror = () => {
    // onclose follows.
  }
}

function onSys(t: Stored, room: Room, msg: { sys?: string; ice?: RTCIceServer[] }): void {
  switch (msg.sys) {
    case 'alone':
      if (t.direction === 'send' && !t.accepted) changed(t, { status: 'waiting', error: undefined })
      else if (t.status !== 'paused') changed(t, { status: 'reconnecting' })
      break
    case 'peer':
      if (t.status === 'waiting' || t.status === 'reconnecting' || t.status === 'paused') changed(t, { status: t.accepted ? 'reconnecting' : 'connecting', error: undefined })
      toEngine({ id: t.id, kind: 'peer', ice: Array.isArray(msg.ice) ? msg.ice : [] })
      break
    case 'gone':
      // The other one left the intro server. A connection already made carries on without it (and
      // notices by itself if the other computer has really gone); one still being set up starts over.
      if (t.status === 'connecting' && t.direction === 'send') {
        toEngine({ id: t.id, kind: 'gone' })
        changed(t, { status: 'waiting' })
      }
      break
    case 'nohost':
      // The sender's Orbit isn't on (yet). Keep trying.
      changed(t, { status: t.accepted ? 'reconnecting' : 'waiting' })
      room.ws = null
      clearTimeout(room.retry)
      room.retry = setTimeout(() => connectRoom(t, room), 5000)
      break
    case 'taken':
    case 'full':
      if (t.direction === 'receive' && !t.accepted) {
        closeRoom(t.id)
        changed(t, { status: 'failed', error: 'Someone else is already using that code.' }, true)
        return
      }
      // Probably our own last connection, not gone yet: try again shortly.
      room.ws = null
      clearTimeout(room.retry)
      room.retry = setTimeout(() => connectRoom(t, room), 5000)
      break
  }
}

function wrongCode(t: Stored): void {
  if (t.direction === 'receive') {
    closeRoom(t.id)
    toEngine({ id: t.id, kind: 'stop' })
    changed(t, { status: 'failed', error: 'That code doesn’t match. Check it with whoever sent it.' }, true)
    return
  }
  t.badTries = (t.badTries ?? 0) + 1
  if (t.badTries >= MAX_BAD_TRIES && !t.accepted) {
    closeRoom(t.id)
    toEngine({ id: t.id, kind: 'stop' })
    changed(t, { status: 'failed', error: `Someone typed a wrong code ${MAX_BAD_TRIES} times, so this code was stopped to be safe. Send again for a new one.` }, true)
  }
}

function sendSignal(id: string, signal: FsSignal): void {
  const room = rooms.get(id)
  if (!room?.ws || room.ws.readyState !== WebSocket.OPEN) return
  room.ws.send(seal(room.key, signal))
}

// ---------- Sending ----------

const MAX_FILES = 200_000

async function walk(path: string, rel: string, out: { files: SendFile[]; sources: string[] }): Promise<void> {
  const info = await stat(path)
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (!e.isFile() && !e.isDirectory()) continue
      await walk(join(path, e.name), `${rel}/${e.name}`, out)
    }
    return
  }
  if (!info.isFile()) return
  if (out.files.length >= MAX_FILES) throw new Error(`That’s over ${MAX_FILES.toLocaleString()} files. Zip it up first, or send it in parts.`)
  const safe = safeRelPath(rel)
  if (!safe) return
  out.files.push({ path: safe, size: info.size })
  out.sources.push(path)
}

const myName = (): string => {
  try {
    return userInfo().username || hostname()
  } catch {
    return hostname()
  }
}

async function startSend(paths: string[]): Promise<Transfer> {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p)
  if (!list.length) throw new Error('Pick some files or a folder to send.')
  if (!serverAddress()) throw new Error('Set up the intro server first (see the box at the top).')
  const out = { files: [] as SendFile[], sources: [] as string[] }
  const tops = new Set<string>()
  for (const p of list) {
    const name = freeName(basename(p), (n) => tops.has(n.toLowerCase()))
    tops.add(name.toLowerCase())
    await walk(p, name, out)
  }
  if (!out.files.length) throw new Error('There’s nothing in that to send.')
  const manifest: Manifest = { from: myName(), files: out.files, total: out.files.reduce((n, f) => n + f.size, 0) }
  const secret = makeCode(randomInt)
  const now = Date.now()
  const t: Stored = {
    id: randomUUID(),
    direction: 'send',
    code: codeText(secret),
    secret,
    status: 'waiting',
    title: sendTitle(out.files),
    manifest,
    sources: out.sources,
    done: 0,
    total: manifest.total,
    created: now,
    expires: now + CODE_LIFETIME_MS
  }
  load().transfers.unshift(t)
  changed(t, {}, true)
  await openRoom(t)
  return publicOf(t)
}

const reading = new Map<string, { index: number; handle: FileHandle }>()

async function closeReading(id: string): Promise<void> {
  const r = reading.get(id)
  reading.delete(id)
  await r?.handle.close().catch(() => undefined)
}

async function readPiece(id: string, index: number, offset: number, length: number): Promise<Uint8Array> {
  const t = find(id)
  if (t.direction !== 'send' || !t.sources || !t.manifest || !t.accepted) throw new Error('Not sending.')
  const file = t.manifest.files[index]
  if (!file || offset < 0 || offset > file.size) throw new Error('Asked for a piece that isn’t there.')
  const want = Math.max(0, Math.min(length, 1024 * 1024, file.size - offset))
  let r = reading.get(id)
  if (!r || r.index !== index) {
    await closeReading(id)
    try {
      r = { index, handle: await open(t.sources[index], 'r') }
    } catch {
      throw new Error(`${file.path} can’t be opened any more (moved or deleted?).`)
    }
    reading.set(id, r)
  }
  const buf = Buffer.alloc(want)
  const { bytesRead } = await r.handle.read(buf, 0, want, offset)
  if (bytesRead < want) throw new Error(`${file.path} got smaller while sending.`)
  return buf
}

// ---------- Receiving ----------

async function startReceive(input: string): Promise<Transfer> {
  const secret = parseCode(String(input ?? ''))
  if (!secret) throw new Error('That isn’t a code. It looks like 4821-tiger-piano-river.')
  if (!serverAddress()) throw new Error('Set up the intro server first (see the box at the top).')
  const existing = load().transfers.find((t) => t.direction === 'receive' && t.secret && codeText(t.secret) === codeText(secret) && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'failed')
  if (existing) {
    if (!rooms.has(existing.id)) await openRoom(existing)
    return publicOf(existing)
  }
  const t: Stored = {
    id: randomUUID(),
    direction: 'receive',
    secret,
    status: 'connecting',
    title: 'Finding the sender…',
    done: 0,
    total: 0,
    created: Date.now()
  }
  load().transfers.unshift(t)
  changed(t, {}, true)
  await openRoom(t)
  return publicOf(t)
}

/** The sender's list arrived. Returns where to start if it was already accepted (after a drop). */
async function gotManifest(id: string, raw: unknown): Promise<Position | null> {
  const t = find(id)
  if (t.direction !== 'receive') return null
  const manifest = readManifest(raw)
  if (!manifest) {
    changed(t, { status: 'failed', error: 'The other computer sent something Orbit can’t read. Are you both on the latest Orbit?' }, true)
    return null
  }
  if (t.accepted && t.manifest) {
    // Same send as before? (A different list means a different send with the same code.)
    const same = t.manifest.files.length === manifest.files.length && t.manifest.files.every((f, i) => f.path === manifest.files[i].path && f.size === manifest.files[i].size)
    if (!same) {
      changed(t, { status: 'failed', error: 'The files changed on the other computer. Ask them to send again.' }, true)
      return null
    }
    await closeWriting(id)
    const pos = await resumePoint(t)
    writing.set(id, { pos: { ...pos }, handle: null })
    changed(t, { status: 'sending', peer: manifest.from, done: bytesDone(t.manifest.files, pos), error: undefined }, true)
    return pos
  }
  changed(t, { manifest, peer: manifest.from, title: sendTitle(manifest.files), total: manifest.total, status: 'asking' }, true)
  return null
}

const partOf = (full: string): string => `${full}.orbitpart`

/** Finds how far a receive got from what's on disk, and tidies the half-saved file to match. */
async function resumePoint(t: Stored): Promise<Position> {
  const files = t.manifest!.files
  for (let i = 0; i < files.length; i++) {
    const full = join(t.folder!, t.targets![i])
    const done = await stat(full).catch(() => null)
    if (done && done.size === files[i].size) continue
    const part = await stat(partOf(full)).catch(() => null)
    if (!part) return { index: i, offset: 0 }
    const offset = Math.min(part.size, files[i].size)
    if (part.size !== offset) await truncate(partOf(full), offset)
    return { index: i, offset }
  }
  return { index: files.length, offset: 0 }
}

async function accept(id: string, chooseFolder: boolean): Promise<Position> {
  const t = find(id)
  if (t.direction !== 'receive' || !t.manifest) throw new Error('There’s nothing to accept yet.')
  let folder = t.folder ?? app.getPath('downloads')
  if (chooseFolder) {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Save the files in…', defaultPath: folder, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) throw new Error('cancelled')
    folder = res.filePaths[0]
  }
  await mkdir(folder, { recursive: true })
  if (!t.targets) {
    // Don't overwrite anything already there: "Photos" becomes "Photos (2)".
    const rename = new Map<string, string>()
    for (const f of t.manifest.files) {
      const top = f.path.split('/')[0]
      if (rename.has(top)) continue
      const used = [...rename.values()].map((n) => n.toLowerCase())
      rename.set(top, freeName(top, (n) => used.includes(n.toLowerCase()) || existsSync(join(folder, n)) || existsSync(partOf(join(folder, n)))))
    }
    t.targets = t.manifest.files.map((f) => {
      const [top, ...rest] = f.path.split('/')
      return [rename.get(top)!, ...rest].join('/')
    })
  }
  t.folder = folder
  await closeWriting(id)
  const pos = await resumePoint(t)
  const need = t.manifest.total - bytesDone(t.manifest.files, pos)
  try {
    const fsInfo = await statfs(folder)
    const free = Number(fsInfo.bavail) * Number(fsInfo.bsize)
    // Leave a little room so the computer doesn't fill right up.
    if (free < need + 200 * 1024 * 1024) {
      throw new Error(`Not enough space: this needs ${gb(need)} but there’s only ${gb(free)} free on that drive. Free some up, or pick another folder.`)
    }
  } catch (err) {
    if ((err as Error).message.startsWith('Not enough space')) throw err
    // Couldn't tell: go ahead.
  }
  t.accepted = true
  changed(t, { status: 'sending', done: bytesDone(t.manifest.files, pos), error: undefined }, true)
  writing.set(id, { pos: { ...pos }, handle: null })
  return pos
}

const gb = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`)

const writing = new Map<string, { pos: Position; handle: FileHandle | null }>()

async function closeWriting(id: string): Promise<void> {
  const w = writing.get(id)
  writing.delete(id)
  await w?.handle?.close().catch(() => undefined)
}

/** Saves the next piece. Returns how much is saved, and whether that's everything. */
async function writePiece(id: string, data: Uint8Array): Promise<{ done: number; finished: boolean }> {
  const t = find(id)
  const w = writing.get(id)
  if (!w || t.direction !== 'receive' || !t.manifest || !t.targets || !t.folder || t.status === 'cancelled') throw new Error('Not receiving.')
  const files = t.manifest.files
  let data_ = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  await finishSettled(t, w)
  while (data_.length) {
    if (w.pos.index >= files.length) throw new Error('The other computer sent more than it said.')
    const file = files[w.pos.index]
    const full = join(t.folder, t.targets[w.pos.index])
    if (!w.handle) {
      await mkdir(dirname(full), { recursive: true })
      w.handle = await open(partOf(full), w.pos.offset ? 'a' : 'w')
    }
    const take = Math.min(data_.length, file.size - w.pos.offset)
    await w.handle.write(data_.subarray(0, take))
    w.pos.offset += take
    data_ = data_.subarray(take)
    await finishSettled(t, w)
  }
  const done = bytesDone(files, w.pos)
  noteProgress(t, done)
  const finished = w.pos.index >= files.length
  if (finished) {
    await closeWriting(id)
    changed(t, { status: 'done', done: t.total, speed: undefined, finished: Date.now() }, true)
    closeRoom(id)
  }
  return { done, finished }
}

/** Renames finished files from .orbitpart to their real name (and makes empty ones). */
async function finishSettled(t: Stored, w: { pos: Position; handle: FileHandle | null }): Promise<void> {
  const files = t.manifest!.files
  const before = w.pos.index
  const finished = settle(files, w.pos)
  for (const i of finished) {
    const full = join(t.folder!, t.targets![i])
    if (i === before && w.handle) {
      await w.handle.close()
      w.handle = null
    }
    if (files[i].size === 0) {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, '')
      await rm(partOf(full), { force: true })
    } else {
      await rename(partOf(full), full)
    }
  }
}

// ---------- Both ----------

async function cancel(id: string): Promise<void> {
  const t = find(id)
  // Tell the other computer first (over the connection), then leave the intro server.
  toEngine({ id, kind: 'stop' })
  setTimeout(() => closeRoom(id), 1500)
  await closeReading(id)
  await closeWriting(id)
  if (t.status !== 'done') changed(t, { status: 'cancelled', speed: undefined }, true)
  // A receive that's stopped: take away the half-saved file.
  if (t.direction === 'receive' && t.folder && t.targets && t.manifest) {
    for (const target of t.targets) await rm(partOf(join(t.folder, target)), { force: true }).catch(() => undefined)
  }
}

async function forget(id: string): Promise<void> {
  const t = find(id)
  if (ACTIVE.has(t.status) || t.status === 'paused') await cancel(id)
  const s = load()
  s.transfers = s.transfers.filter((x) => x.id !== id)
  speedSamples.delete(id)
  save(true)
  broadcast(true)
}

async function resume(id: string): Promise<void> {
  const t = find(id)
  if (t.status !== 'paused' && t.status !== 'failed' && t.status !== 'waiting') return
  if (t.status === 'failed' && !t.accepted) throw new Error('This one can’t carry on. Send it again.')
  changed(t, { status: t.accepted ? 'reconnecting' : t.direction === 'send' ? 'waiting' : 'connecting', error: undefined }, true)
  await openRoom(t)
}

/** From the WebRTC side: status, route and progress. */
function update(id: string, patch: { status?: Transfer['status']; route?: Transfer['route']; done?: number; error?: string }): void {
  const t = load().transfers.find((x) => x.id === id)
  if (!t) return
  if (t.status === 'cancelled' || t.status === 'done') {
    // Only the reason can still be added ("They stopped sending.").
    if (t.status === 'cancelled' && typeof patch.error === 'string' && !t.error) changed(t, { error: patch.error.slice(0, 300) }, true)
    return
  }
  const next: Partial<Stored> = {}
  if (patch.route) next.route = patch.route
  if (patch.status && ['connecting', 'asking', 'sending', 'reconnecting', 'done', 'failed', 'cancelled'].includes(patch.status)) next.status = patch.status
  if (typeof patch.error === 'string') next.error = patch.error.slice(0, 300)
  if (next.status === 'done') {
    next.done = t.total
    next.speed = undefined
    next.finished = Date.now()
  }
  if (next.status === 'failed' || next.status === 'cancelled') next.speed = undefined
  if (typeof patch.done === 'number' && patch.done >= 0) noteProgress(t, Math.min(patch.done, t.total))
  changed(t, next, !!next.status)
  if (next.status === 'done' || next.status === 'cancelled' || next.status === 'failed') {
    closeRoom(id)
    void closeReading(id)
  }
}

/** Sender: the friend pressed Accept and wants it from here. */
function started(id: string, raw: unknown): Position | null {
  const t = find(id)
  if (t.direction !== 'send' || !t.manifest) return null
  const pos = validPosition(t.manifest.files, raw)
  if (!pos) return null
  t.accepted = true
  changed(t, { status: 'sending', done: bytesDone(t.manifest.files, pos), expires: undefined, error: undefined }, true)
  return pos
}

function declined(id: string): void {
  const t = find(id)
  closeRoom(id)
  changed(t, { status: 'cancelled', error: t.direction === 'send' ? `${t.peer ?? 'They'} said no.` : undefined }, true)
}

async function setServer(address: string): Promise<{ relay: boolean }> {
  const text = String(address ?? '').trim().replace(/\/+$/, '')
  if (!text) {
    load().server = undefined
    save(true)
    broadcast(true)
    return { relay: false }
  }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new Error('That isn’t a web address.')
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('The address has to start with https://')
  let body: { ok?: boolean; app?: string; relay?: boolean }
  try {
    const res = await net.fetch(`${url.origin}${url.pathname.replace(/\/+$/, '')}/health`)
    body = await res.json()
  } catch {
    throw new Error('Couldn’t reach that address. Check it, and that the server is deployed.')
  }
  if (body.app !== 'orbit-file-sender') throw new Error('That address works, but it isn’t the Orbit intro server.')
  load().server = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  load().relay = !!body.relay
  save(true)
  broadcast(true)
  return { relay: !!body.relay }
}

// ---------- Setting up the intro server from here ----------

let setupSteps: SetupStep[] | undefined
/** The Cloudflare key, for this run of Orbit (when the computer can't keep it locked on disk). */
let sessionKey: string | null = null
let settingUp = false

async function setUp(token: string): Promise<{ relay: boolean; relayNote?: string }> {
  if (settingUp) throw new Error('Already setting it up.')
  settingUp = true
  try {
    const r = await setUpServer(token, (steps) => {
      setupSteps = steps
      broadcast(true)
    })
    const s = load()
    s.server = r.address
    s.relay = r.relay
    s.cloudflare = { key: r.savedKey, account: r.account }
    sessionKey = r.token
    save(true)
    broadcast(true)
    return { relay: r.relay, relayNote: r.relayNote }
  } finally {
    settingUp = false
  }
}

/** Turns the relay on for a server set up from here: by itself, or with a TURN key made on Cloudflare's site. */
async function relayOn(keyId?: string, apiToken?: string): Promise<void> {
  const s = load()
  const token = decryptKey(s.cloudflare?.key) ?? sessionKey
  if (!token || !s.cloudflare) throw new Error('This Orbit didn’t set up the intro server, so it can’t change it. Ask whoever did.')
  if (keyId && apiToken) await setRelaySecrets(token, s.cloudflare.account, keyId, apiToken)
  else await turnOnRelay(token, s.cloudflare.account)
  s.relay = true
  save(true)
  broadcast(true)
}


async function pick(kind: 'files' | 'folder'): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    title: kind === 'folder' ? 'Send a folder' : 'Send files',
    properties: (kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections']) as ('openDirectory' | 'openFile' | 'multiSelections')[]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

function reveal(id: string): void {
  const t = find(id)
  if (t.direction === 'receive' && t.folder && t.targets?.length) {
    const first = join(t.folder, t.targets[0].split('/')[0])
    if (existsSync(first)) shell.showItemInFolder(first)
    else void shell.openPath(t.folder)
  } else if (t.sources?.length) shell.showItemInFolder(t.sources[0])
}

/** Sender: an unused code runs out after an hour. */
function expireCodes(): void {
  for (const t of load().transfers) {
    if (t.direction === 'send' && !t.accepted && ACTIVE.has(t.status) && t.expires && t.expires < Date.now()) {
      closeRoom(t.id)
      toEngine({ id: t.id, kind: 'stop' })
      changed(t, { status: 'failed', error: 'Nobody used the code within an hour. Send again for a new one.' }, true)
    }
  }
}

export function setupFileSend(): void {
  drive.setup(() => broadcast())
  ipcMain.handle('fsend:state', () => state())
  ipcMain.handle('fsend:setServer', (_e, address: string) => setServer(address))
  ipcMain.handle('fsend:setUp', (_e, token: string) => setUp(String(token ?? '')))
  ipcMain.handle('fsend:relayOn', (_e, keyId?: string, apiToken?: string) => relayOn(keyId ? String(keyId) : undefined, apiToken ? String(apiToken) : undefined))
  ipcMain.handle('fsend:open', (_e, which: string) => {
    const pages: Record<string, string> = {
      signup: 'https://dash.cloudflare.com/sign-up',
      token: TOKEN_PAGE,
      turn: 'https://dash.cloudflare.com/?to=/:account/realtime/turn'
    }
    if (pages[which]) void shell.openExternal(pages[which])
  })
  ipcMain.handle('fsend:pick', (_e, kind: 'files' | 'folder') => pick(kind === 'folder' ? 'folder' : 'files'))
  ipcMain.handle('fsend:send', (_e, paths: string[]) => startSend(paths))
  ipcMain.handle('fsend:receive', (_e, code: string) => startReceive(code))
  ipcMain.handle('fsend:accept', (_e, id: string, chooseFolder: boolean) => accept(String(id), !!chooseFolder))
  ipcMain.handle('fsend:cancel', (_e, id: string) => cancel(String(id)))
  ipcMain.handle('fsend:forget', (_e, id: string) => forget(String(id)))
  ipcMain.handle('fsend:resume', (_e, id: string) => resume(String(id)))
  ipcMain.handle('fsend:reveal', (_e, id: string) => reveal(String(id)))
  // The WebRTC side.
  ipcMain.handle('fsend:signal', (_e, id: string, signal: FsSignal) => sendSignal(String(id), signal))
  ipcMain.handle('fsend:update', (_e, id: string, patch: Parameters<typeof update>[1]) => update(String(id), patch ?? {}))
  ipcMain.handle('fsend:manifest', (_e, id: string) => {
    const t = find(String(id))
    return t.direction === 'send' ? t.manifest : null
  })
  ipcMain.handle('fsend:gotManifest', (_e, id: string, manifest: unknown) => gotManifest(String(id), manifest))
  ipcMain.handle('fsend:started', (_e, id: string, pos: unknown) => started(String(id), pos))
  ipcMain.handle('fsend:declined', (_e, id: string) => declined(String(id)))
  ipcMain.handle('fsend:read', (_e, id: string, index: number, offset: number, length: number) => readPiece(String(id), Number(index), Number(offset), Number(length)))
  ipcMain.handle('fsend:write', (_e, id: string, data: Uint8Array) => writePiece(String(id), data))
  ipcMain.handle('fsend:drive', (_e, paths: string[]) => drive.share(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []))
  ipcMain.handle('fsend:driveConnect', () => drive.connect())
  ipcMain.handle('fsend:driveRemove', (_e, id: string) => drive.remove(String(id)))
  ipcMain.handle('fsend:driveForget', (_e, id: string) => drive.forget(String(id)))

  // Codes nobody has used yet are waited on again (the friend may type it after a restart).
  for (const t of load().transfers) {
    if (t.direction === 'send' && t.status === 'waiting') void openRoom(t).catch((err) => logError('file sender', err))
  }
  setInterval(expireCodes, 60_000)
  // Progress is saved a second late; don't lose that second when Orbit closes.
  app.on('before-quit', () => save(true))
}
