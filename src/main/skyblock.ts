import { app, BrowserWindow, dialog, ipcMain, net, Notification, safeStorage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import {
  anythingChanged,
  chatDrops,
  collectionNames,
  compareSnapshots,
  HYPIXEL_API,
  isMinecraft,
  profileChoices,
  sameNumbers,
  shortNumber,
  snapshotFromProfiles,
  type ProgramInfo,
  type SkyblockProfileChoice,
  type SkyblockSnapshot,
  type SkyblockStatus,
  type SkyblockSummary
} from '@shared/skyblock'
import { logError } from './log'
import { addonOn, onAddonsChanged } from './addonGate'
import { skyblockAddonReady } from './skyblockAddonFiles'

/**
 * SkyBlock session summary. While Orbit is running (even with its window closed) it looks for
 * Minecraft once a minute. When Minecraft opens it takes a copy of your SkyBlock numbers from
 * Hypixel's API; a couple of minutes after Minecraft closes (Hypixel saves your profile when you
 * leave, and its API takes a little while to catch up) it takes another, and the difference is the
 * session card: coins an hour, XP, items collected, and the rare drops from Minecraft's own chat
 * log. Your Hypixel API key is stored encrypted, like the other keys, in `skyblock.json`.
 *
 * Only your Minecraft name goes to Mojang (to find your player id) and your player id to Hypixel.
 */

const API = process.env.NOTES_HYPIXEL_URL ?? HYPIXEL_API
const MOJANG = process.env.NOTES_MOJANG_URL ?? 'https://api.mojang.com'
/** For trying it out without Minecraft: while this file exists, Minecraft counts as open. */
const FAKE_MINECRAFT = process.env.NOTES_SKYBLOCK_FAKE_MINECRAFT ?? ''
const TICK = Number(process.env.NOTES_SKYBLOCK_TICK_MS) || 60_000
/** When to ask Hypixel for the end numbers, after Minecraft closes. */
const FINISH_AFTER = (process.env.NOTES_SKYBLOCK_FINISH_MS ?? '120000,360000').split(',').map(Number)
const KEEP_SESSIONS = 40

interface Pending {
  start: number
  end: number
  startedLate: boolean
  snapshot: SkyblockSnapshot
  /** Read when the session ended, before a new Minecraft could start a fresh log. */
  drops: ReturnType<typeof chatDrops> | null
  /** Which of FINISH_AFTER is next. */
  attempt: number
  /** The summary id once it has been shown. */
  shown?: string
  /** Hypixel couldn't be asked: not before this. */
  retryAt?: number
}

const dueAt = (p: Pending): number => Math.max(p.end + (FINISH_AFTER[p.attempt] ?? 0), p.retryAt ?? 0)

interface Stored {
  /** Encrypted. */
  apiKey?: string
  /** When the key was pasted, for warning before a 3-day developer key runs out. */
  keySavedAt?: number
  /** A Personal key from Hypixel, which doesn't run out. */
  personalKey?: boolean
  player: string
  uuid: string
  profileId: string
  profiles: SkyblockProfileChoice[]
  readLog: boolean
  logFolder: string
  current: { start: number; startedLate: boolean; manual?: boolean; snapshot: SkyblockSnapshot | null } | null
  pending: Pending[]
  sessions: SkyblockSummary[]
  names: Record<string, string>
  namesAt: number
}

const empty = (): Stored => ({ player: '', uuid: '', profileId: '', profiles: [], readLog: true, logFolder: '', current: null, pending: [], sessions: [], names: {}, namesAt: 0 })

let stored: Stored | null = null
let problem = ''
let getMain: () => BrowserWindow | null = () => null
const storeFile = (): string => join(app.getPath('userData'), 'skyblock.json')

function load(): Stored {
  if (stored) return stored
  try {
    stored = { ...empty(), ...JSON.parse(readFileSync(storeFile(), 'utf8')) }
  } catch {
    stored = empty()
  }
  return stored!
}

function save(): void {
  try {
    const file = storeFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(load()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving SkyBlock sessions', err)
  }
}

function key(): string | null {
  const k = load().apiKey
  if (!k) return null
  try {
    return safeStorage.decryptString(Buffer.from(k, 'base64'))
  } catch {
    return null
  }
}

function status(): SkyblockStatus {
  const s = load()
  return {
    hasKey: !!s.apiKey,
    keySavedAt: s.keySavedAt ?? null,
    personalKey: !!s.personalKey,
    canEncrypt: safeStorage.isEncryptionAvailable(),
    player: s.player,
    uuid: s.uuid,
    profileId: s.profileId,
    profiles: s.profiles,
    readLog: s.readLog,
    logFolder: s.logFolder,
    session: s.current ? { start: s.current.start, startedLate: s.current.startedLate } : null,
    finishing: s.pending.some((p) => !p.shown),
    problem
  }
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, ...args)
}

const changed = (): void => broadcast('skyblock:changed')

// ---------- for the goal planner (skyblockGoals.ts) ----------

const profileListeners: ((body: unknown) => void)[] = []
/** Called with every profiles answer from Hypixel, so the goal planner stays fresh without asking again. */
export const onSkyblockProfiles = (fn: (body: unknown) => void): void => void profileListeners.push(fn)

/** The key, who you are and the sessions so far, for the goal planner. */
export function skyblockAccount(): { key: string | null; uuid: string; profileId: string; sessions: SkyblockSummary[]; playing: boolean; keySavedAt: number | null; personalKey: boolean } {
  const s = load()
  return { key: key(), uuid: s.uuid, profileId: s.profileId, sessions: s.sessions, playing: !!s.current, keySavedAt: s.keySavedAt ?? null, personalKey: !!s.personalKey }
}

export const skyblockProblem = (message: string): void => {
  problem = message
  changed()
}

// ---------- Hypixel and Mojang ----------

export class KeyRejected extends Error {}

export async function hypixel(path: string, apiKey: string | null): Promise<unknown> {
  let res: Response
  try {
    res = await net.fetch(API + path, { headers: apiKey ? { 'API-Key': apiKey } : {}, signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new Error('Couldn’t reach Hypixel. Check the internet connection.')
  }
  if (res.status === 403) {
    throw new KeyRejected('Hypixel didn’t accept your API key. Keys from the developer dashboard stop working after 3 days: make a new one (or apply for a Personal key that lasts) and paste it on the Games page → SkyBlock.')
  }
  if (res.status === 429) throw new Error('Hypixel says too many requests right now. Orbit will try again.')
  if (!res.ok) throw new Error(`Hypixel answered ${res.status}. Orbit will try again.`)
  return res.json()
}

async function playerId(name: string): Promise<{ id: string; name: string }> {
  let res: Response
  try {
    res = await net.fetch(`${MOJANG}/users/profiles/minecraft/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Couldn’t reach Mojang to look up your Minecraft name. Check the internet connection.')
  }
  if (res.status === 404 || res.status === 204) throw new Error(`There’s no Minecraft player called “${name}”.`)
  if (!res.ok) throw new Error(`Mojang answered ${res.status} when looking up your name. Try again in a bit.`)
  const body = (await res.json()) as { id?: string; name?: string }
  if (!body.id) throw new Error(`There’s no Minecraft player called “${name}”.`)
  return { id: body.id, name: body.name ?? name }
}

/** Your numbers now, or null (with `problem` set) when Hypixel couldn't be asked. */
async function snapshot(): Promise<SkyblockSnapshot | null> {
  const s = load()
  const k = key()
  if (!k || !s.uuid) return null
  try {
    const body = await hypixel(`/v2/skyblock/profiles?uuid=${s.uuid}`, k)
    const snap = snapshotFromProfiles(body, s.uuid, s.profileId, Date.now())
    for (const fn of profileListeners) fn(body)
    const choices = profileChoices(body)
    if (choices.length) s.profiles = choices
    problem = snap ? '' : 'Hypixel has no SkyBlock profile for you yet.'
    return snap
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err)
    if (!(err instanceof KeyRejected)) logError('asking Hypixel for SkyBlock numbers', err)
    return null
  } finally {
    changed()
  }
}

/** Collection names, from Hypixel (no key needed), refreshed once a week. */
async function refreshNames(): Promise<void> {
  const s = load()
  if (Object.keys(s.names).length && Date.now() - s.namesAt < 7 * 86_400_000) return
  try {
    const names = collectionNames(await hypixel('/v2/resources/skyblock/collections', null))
    if (Object.keys(names).length) {
      s.names = names
      s.namesAt = Date.now()
      save()
    }
  } catch {
    // Made-up names from the ids are fine for now.
  }
}

// ---------- Minecraft's chat log ----------

/** Where the usual Minecraft clients keep latest.log. */
function logCandidates(): string[] {
  const s = load()
  if (s.logFolder) return [join(s.logFolder, 'latest.log')]
  const home = homedir()
  const mc =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), '.minecraft')
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'minecraft')
        : join(home, '.minecraft')
  return [
    join(mc, 'logs', 'latest.log'),
    join(mc, 'logs', 'blclient', 'minecraft', 'latest.log'),
    join(home, '.lunarclient', 'offline', 'multiver', 'logs', 'latest.log'),
    join(home, '.lunarclient', 'offline', '1.8', 'logs', 'latest.log'),
    join(home, '.lunarclient', 'logs', 'game', 'latest.log')
  ]
}

/** The rare drops from the log Minecraft wrote during this session, or null when there isn't one. */
function readDrops(start: number, startedByHand: boolean): ReturnType<typeof chatDrops> | null {
  if (!load().readLog) return []
  const recent = logCandidates()
    .map((path) => {
      try {
        return { path, modified: statSync(path).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((f): f is { path: string; modified: number } => !!f && f.modified >= start - 60_000)
    .sort((a, b) => b.modified - a.modified)[0]
  if (!recent) return null
  try {
    const d = new Date(start)
    // A session started by hand may begin after Minecraft did, so earlier lines are left out.
    return chatDrops(readFileSync(recent.path, 'utf8'), startedByHand ? d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() : null)
  } catch (err) {
    logError(`reading ${basename(recent.path)}`, err)
    return null
  }
}

// ---------- spotting Minecraft ----------

function programs(): Promise<ProgramInfo[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Only Java programs: Minecraft is always javaw/java, whatever the client.
      const cmd = "Get-Process java,javaw -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName + \"`t\" + $_.Path + \"`t\" + $_.MainWindowTitle }"
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 20_000 }, (err, out) => {
        if (err && !out) return resolve([])
        resolve(
          out
            .split(/\r?\n/)
            .filter(Boolean)
            .map((l) => {
              const [name = '', path = '', title = ''] = l.split('\t')
              return { name, path, title }
            })
        )
      })
    } else {
      execFile('ps', ['-axww', '-o', 'args='], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([])
        resolve(
          out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              const path = l.split(/\s+-/)[0].trim()
              return { name: basename(path), path, title: l }
            })
        )
      })
    }
  })
}

async function minecraftOpen(): Promise<boolean> {
  if (FAKE_MINECRAFT) return existsSync(FAKE_MINECRAFT)
  return (await programs()).some(isMinecraft)
}

// ---------- sessions ----------

let firstTick = true

/** After ending a session by hand while Minecraft is open, the next one waits for Minecraft to close first. */
let waitForClose = false

async function begin(startedLate: boolean, manual = false): Promise<void> {
  const s = load()
  s.current = { start: Date.now(), startedLate, manual, snapshot: null }
  save()
  changed()
  void refreshNames()
  s.current.snapshot = await snapshot()
  save()
}

function end(): void {
  const s = load()
  const cur = s.current
  s.current = null
  if (!cur?.snapshot) {
    // Hypixel couldn't be asked when it began (no internet, or the key had stopped working).
    if (cur) logError('SkyBlock session', 'ended without a starting copy from Hypixel, so there’s no summary')
    save()
    changed()
    return
  }
  const now = Date.now()
  s.pending.push({ start: cur.start, end: now, startedLate: cur.startedLate, snapshot: cur.snapshot, drops: readDrops(cur.start, cur.startedLate), attempt: 0 })
  save()
  changed()
  scheduleFinish()
}

let finishTimer: ReturnType<typeof setTimeout> | null = null

/** Asks Hypixel for the end numbers of any session that's waiting, when its time comes. */
function scheduleFinish(): void {
  if (finishTimer) clearTimeout(finishTimer)
  finishTimer = null
  // Without the add-on nothing waits to finish (it carries on if it's added again).
  if (!addonOn('skyblock')) return
  const s = load()
  if (!s.pending.length) return
  const due = Math.min(...s.pending.map(dueAt))
  finishTimer = setTimeout(() => void finish().finally(scheduleFinish), Math.max(1000, due - Date.now()))
}

async function finish(): Promise<void> {
  const s = load()
  const now = Date.now()
  for (const p of [...s.pending]) {
    if (now < dueAt(p)) continue
    const after = await snapshot()
    if (!after) {
      // Couldn't ask: try again in a few minutes, for up to a day.
      if (now - p.end > 86_400_000) s.pending = s.pending.filter((x) => x !== p)
      else p.retryAt = now + 5 * 60_000
      continue
    }
    p.retryAt = undefined
    const last = p.attempt >= FINISH_AFTER.length - 1
    p.attempt++
    // Hypixel hasn't saved the session yet: wait for the next try.
    if (sameNumbers(p.snapshot, after) && !last && !p.drops?.length) continue
    const summary = compareSnapshots(p.snapshot, after, { start: p.start, end: p.end, drops: p.drops, names: s.names, startedLate: p.startedLate, logWanted: s.readLog })
    if (last) s.pending = s.pending.filter((x) => x !== p)
    if (!anythingChanged(summary)) {
      if (last && !p.shown) logError('SkyBlock session', 'nothing changed (not SkyBlock, or Hypixel hadn’t saved), so no card')
      continue
    }
    s.sessions = [summary, ...s.sessions.filter((x) => x.id !== summary.id)].slice(0, KEEP_SESSIONS)
    const firstTime = !p.shown
    p.shown = summary.id
    save()
    if (firstTime) show(summary)
    else broadcast('skyblock:updated', summary)
  }
  save()
  changed()
}

function show(summary: SkyblockSummary): void {
  broadcast('skyblock:summary', summary)
  const win = getMain()
  if (win && !win.isDestroyed() && win.isFocused()) return
  if (!Notification.isSupported()) return
  const parts = [summary.coins ? `${shortNumber(summary.coins.perHour)} coins/hour` : '', summary.skills[0] ? `+${shortNumber(summary.skills[0].gained)} ${summary.skills[0].name} XP` : '', summary.drops?.length ? `${summary.drops.length} rare drop${summary.drops.length === 1 ? '' : 's'}` : '']
  const n = new Notification({ title: 'SkyBlock session', body: parts.filter(Boolean).join(' · ') || 'Your session summary is ready.', silent: true })
  n.on('click', () => {
    const w = getMain()
    if (!w || w.isDestroyed()) return
    w.show()
    w.focus()
  })
  n.show()
}

async function tick(): Promise<void> {
  const s = load()
  // Session summaries are part of the SkyBlock add-on: nothing runs unless it's added and downloaded.
  if (!addonOn('skyblock')) return
  if (!s.apiKey || !s.uuid || !skyblockAddonReady()) return
  const open = await minecraftOpen()
  if (!open) waitForClose = false
  if (open && !s.current && !waitForClose) await begin(firstTick)
  else if (s.current && !s.current.snapshot) {
    s.current.snapshot = await snapshot()
    save()
  } else if (!open && s.current && !s.current.manual) end()
  firstTick = false
}

let tickTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTick(ms: number): void {
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = setTimeout(async () => {
    try {
      await tick()
    } catch (err) {
      logError('watching for Minecraft', err)
    }
    scheduleTick(TICK)
  }, ms)
}

// ---------- setup ----------

export function setupSkyblock(opts: { getMain: () => BrowserWindow | null }): void {
  getMain = opts.getMain
  // A session that was waiting when Orbit closed carries on.
  scheduleFinish()
  scheduleTick(15_000)
  onAddonsChanged(() => scheduleFinish())

  ipcMain.handle('skyblock:status', () => status())
  ipcMain.handle('skyblock:sessions', () => load().sessions)

  ipcMain.handle('skyblock:setup', async (_e, input: { key?: string; player: string; personal?: boolean }) => {
    const s = load()
    const name = String(input.player ?? '').trim()
    if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) throw new Error('That doesn’t look like a Minecraft name (2 to 16 letters, numbers or _).')
    const newKey = String(input.key ?? '').trim()
    if (newKey && !/^[0-9a-f-]{32,40}$/i.test(newKey)) throw new Error('That doesn’t look like a Hypixel API key (it looks like 1a2b3c4d-…).')
    const apiKey = newKey || key()
    if (!apiKey) throw new Error('Paste your Hypixel API key first.')
    if (newKey && !safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the key securely, so it wasn’t saved.')
    const player = await playerId(name)
    let body: unknown
    try {
      body = await hypixel(`/v2/skyblock/profiles?uuid=${player.id}`, apiKey)
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err)
      throw err
    }
    const choices = profileChoices(body)
    if (!choices.length) throw new Error(`${player.name} has no SkyBlock profiles yet.`)
    if (newKey) {
      s.apiKey = safeStorage.encryptString(newKey).toString('base64')
      s.keySavedAt = Date.now()
    }
    if (typeof input.personal === 'boolean') s.personalKey = input.personal
    if (s.uuid !== player.id) s.profileId = ''
    s.player = player.name
    s.uuid = player.id
    s.profiles = choices
    problem = ''
    save()
    changed()
    void refreshNames()
    scheduleTick(1000)
    return status()
  })

  ipcMain.handle('skyblock:setProfile', (_e, id: string) => {
    const s = load()
    s.profileId = s.profiles.some((p) => p.id === id) ? id : ''
    save()
    return status()
  })

  ipcMain.handle('skyblock:setPersonalKey', (_e, personal: boolean) => {
    load().personalKey = !!personal
    save()
    changed()
    return status()
  })

  ipcMain.handle('skyblock:setLog', (_e, readLog: boolean, folder?: string) => {
    const s = load()
    s.readLog = !!readLog
    if (typeof folder === 'string') s.logFolder = folder
    save()
    return status()
  })

  ipcMain.handle('skyblock:pickLogFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { title: 'Pick the folder Minecraft keeps latest.log in (its “logs” folder)', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return status()
    load().logFolder = result.filePaths[0]
    save()
    return status()
  })

  ipcMain.handle('skyblock:forget', () => {
    const s = load()
    delete s.apiKey
    delete s.keySavedAt
    s.current = null
    s.pending = []
    problem = ''
    save()
    changed()
    return status()
  })

  /** For when Orbit didn't notice (or you want to time just a part of a session). */
  ipcMain.handle('skyblock:startNow', async () => {
    const s = load()
    if (!s.current) await begin(true, true)
    return status()
  })
  ipcMain.handle('skyblock:endNow', async () => {
    if (!load().current) return status()
    waitForClose = !load().current?.manual || (await minecraftOpen())
    end()
    return status()
  })

  ipcMain.handle('skyblock:deleteSession', (_e, id: string) => {
    const s = load()
    s.sessions = s.sessions.filter((x) => x.id !== id)
    save()
    return s.sessions
  })
}
