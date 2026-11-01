import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, join } from 'path'
import {
  addPlay,
  epicGameFromManifest,
  epicLaunchUrl,
  isInside,
  macGameFromPlist,
  playedInWeek,
  plistString,
  steamAppFromManifest,
  steamAppId,
  steamCachePaths,
  steamImageUrl,
  type LaunchArt,
  type SteamImage,
  steamLibraryFolders,
  steamPlaytimes,
  type Game,
  type GameSource,
  type GamesList,
  type PlayRecord,
  type SteamPlaytime
} from '@shared/games'
import { IS_MAC } from '@shared/platform'
import { logError } from './log'

/**
 * The games launcher: finds the games installed on this computer (Steam, Epic, and on a Mac any
 * app that says it's a game), starts them, and counts the time they're running while Notes is
 * open. Steam keeps its own count, which is used for Steam games when it's higher.
 */

const IS_WIN = process.platform === 'win32'
const home = homedir()

/** What a scan found, before time played is added. */
interface Found {
  id: string
  name: string
  source: GameSource
  path: string
  /** How to start it: a link (steam://…) or a file to open. */
  launch: { url: string } | { open: string }
  art: string | null
  /** Where to take the icon from (an app), when there's no picture. */
  iconFrom: string | null
  steam?: SteamPlaytime
}

// ---------- what's saved ----------

interface Store {
  /** Apps you added yourself. */
  added: string[]
  hidden: string[]
  play: Record<string, PlayRecord>
}

const storeFile = (): string => join(app.getPath('userData'), 'games.json')
let store: Store | null = null

function loadStore(): Store {
  if (store) return store
  try {
    const s = JSON.parse(readFileSync(storeFile(), 'utf8'))
    store = { added: Array.isArray(s.added) ? s.added : [], hidden: Array.isArray(s.hidden) ? s.hidden : [], play: s.play && typeof s.play === 'object' ? s.play : {} }
  } catch {
    store = { added: [], hidden: [], play: {} }
  }
  return store
}

function saveStore(): void {
  try {
    const file = storeFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(loadStore()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving games', err)
  }
}

// ---------- finding games ----------

const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false)
const list = async (dir: string): Promise<string[]> => readdir(dir).catch(() => [] as string[])

function steamRoots(): string[] {
  if (IS_MAC) return [join(home, 'Library/Application Support/Steam')]
  if (IS_WIN) return ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']
  return [join(home, '.local/share/Steam'), join(home, '.steam/steam')]
}

function epicManifestDirs(): string[] {
  if (IS_MAC) return [join(home, 'Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests')]
  if (IS_WIN) return ['C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests']
  return []
}

/** Steam's own copy of one of a game's pictures, as a data: URL, or null if it hasn't saved one. */
async function steamCached(root: string, appId: string, image: SteamImage): Promise<string | null> {
  const cache = join(root, 'appcache', 'librarycache')
  for (const file of steamCachePaths(cache, appId, image, await list(join(cache, appId)))) {
    try {
      const data = await readFile(file)
      if (data.length) return `data:${image.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${data.toString('base64')}`
    } catch {
      // not this one
    }
  }
  return null
}

/** Steam's own copy of a game's banner, if it has one; otherwise the one on Steam's website. */
async function steamArt(root: string, appId: string): Promise<string> {
  return (await steamCached(root, appId, 'header.jpg')) ?? steamImageUrl(appId, 'header.jpg')
}

/** Where Steam is installed, once a scan has found it. */
let steamRoot: string | null = null

async function findSteam(): Promise<{ games: Found[]; installed: boolean }> {
  let root: string | null = null
  for (const r of steamRoots()) if (await exists(join(r, 'steamapps'))) {
    root = r
    break
  }
  steamRoot = root
  if (!root) return { games: [], installed: false }

  // Time played, from each account that's signed in on this computer.
  const playtimes = new Map<string, SteamPlaytime>()
  for (const account of await list(join(root, 'userdata'))) {
    try {
      const text = await readFile(join(root, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8')
      for (const [id, p] of steamPlaytimes(text)) {
        const had = playtimes.get(id)
        playtimes.set(id, had ? { minutes: Math.max(had.minutes, p.minutes), lastPlayed: Math.max(had.lastPlayed, p.lastPlayed) } : p)
      }
    } catch {
      // that account has no settings yet
    }
  }

  const libraries = new Set([root])
  try {
    for (const l of steamLibraryFolders(await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'))) libraries.add(l)
  } catch {
    // only the main library
  }

  const games: Found[] = []
  const seen = new Set<string>()
  for (const lib of libraries) {
    const apps = join(lib, 'steamapps')
    for (const file of await list(apps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue
      try {
        const found = steamAppFromManifest(await readFile(join(apps, file), 'utf8'))
        if (!found || seen.has(found.appId)) continue
        const path = join(apps, 'common', found.installDir)
        if (!(await exists(path))) continue
        seen.add(found.appId)
        games.push({
          id: `steam:${found.appId}`,
          name: found.name,
          source: 'steam',
          path,
          launch: { url: `steam://rungameid/${found.appId}` },
          art: await steamArt(root, found.appId),
          iconFrom: null,
          steam: playtimes.get(found.appId)
        })
      } catch (err) {
        logError(`reading Steam game ${file}`, err)
      }
    }
  }
  return { games, installed: true }
}

/** The .app a Mac game's program sits in, for its icon. */
const appOf = (path: string): string | null => {
  const m = /^(.*?\.app)(\/|$)/i.exec(path)
  return m ? m[1] : null
}

async function findEpic(): Promise<{ games: Found[]; installed: boolean }> {
  const games: Found[] = []
  let installed = false
  for (const dir of epicManifestDirs()) {
    if (!(await exists(dir))) continue
    installed = true
    for (const file of await list(dir)) {
      if (!file.toLowerCase().endsWith('.item')) continue
      try {
        const g = epicGameFromManifest(await readFile(join(dir, file), 'utf8'))
        if (!g || !(await exists(g.installLocation))) continue
        const program = g.executable ? join(g.installLocation, g.executable) : null
        games.push({
          id: `epic:${g.appName}`,
          name: g.name,
          source: 'epic',
          path: g.installLocation,
          launch: { url: epicLaunchUrl(g) },
          art: null,
          iconFrom: program ? (IS_MAC ? appOf(program) : program) : null
        })
      } catch (err) {
        logError(`reading Epic game ${file}`, err)
      }
    }
  }
  return { games, installed }
}

/** An app's Info.plist as XML (Mac apps keep it in Contents/, iPhone and iPad apps one level in). */
async function readPlist(appPath: string): Promise<string | null> {
  for (const p of [join(appPath, 'Contents', 'Info.plist'), join(appPath, 'WrappedBundle', 'Info.plist')]) {
    let data: Buffer
    try {
      data = await readFile(p)
    } catch {
      continue
    }
    if (data.subarray(0, 6).toString() !== 'bplist') return data.toString('utf8')
    // A binary plist: the Mac's own plutil turns it into XML.
    return new Promise((resolve) =>
      execFile('plutil', ['-convert', 'xml1', '-o', '-', p], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? null : out))
    )
  }
  return null
}

/** Apps in the usual places (and one folder down, where some games keep themselves). */
async function macApps(): Promise<string[]> {
  const apps: string[] = []
  const scan = async (dir: string, deeper: boolean): Promise<void> => {
    for (const name of await list(dir)) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      if (name.toLowerCase().endsWith('.app')) apps.push(full)
      else if (deeper && (await stat(full).then((s) => s.isDirectory(), () => false))) await scan(full, false)
    }
  }
  await scan('/Applications', true)
  await scan(join(home, 'Applications'), true)
  await scan('/System/Applications', false)
  return apps
}

async function findMacGames(): Promise<Found[]> {
  if (!IS_MAC) return []
  const apps = await macApps()
  const games: Found[] = []
  // A few at a time, so a big Applications folder doesn't start hundreds of plutils at once.
  for (let i = 0; i < apps.length; i += 8) {
    const batch = await Promise.all(
      apps.slice(i, i + 8).map(async (path) => {
        const plist = await readPlist(path)
        const name = plist && macGameFromPlist(plist, basename(path, '.app'))
        return name ? ({ id: `app:${path}`, name, source: 'app', path, launch: { open: path }, art: null, iconFrom: path } as Found) : null
      })
    )
    for (const g of batch) if (g) games.push(g)
  }
  return games
}

async function addedGame(path: string): Promise<Found | null> {
  if (!(await exists(path))) return null
  let name = basename(path, extname(path))
  if (IS_MAC && path.toLowerCase().endsWith('.app')) {
    const plist = await readPlist(path)
    name = (plist && (plistString(plist, 'CFBundleDisplayName') || plistString(plist, 'CFBundleName'))) || name
  }
  return { id: `added:${path}`, name, source: 'added', path, launch: { open: path }, art: null, iconFrom: path }
}

let found: Found[] = []
let lastScan = 0

/** A game the last scan found, by id (for its animated cover). */
export const foundGame = (id: string): { id: string; name: string } | null => found.find((g) => g.id === id) ?? null
let scanning: Promise<void> | null = null
let installed = { steam: false, epic: false }

function scan(): Promise<void> {
  scanning ??= (async () => {
    try {
      const [steam, epic, mac] = await Promise.all([findSteam(), findEpic(), findMacGames().catch((err) => (logError('finding Mac games', err), []))])
      const added = (await Promise.all(loadStore().added.map(addedGame))).filter((g): g is Found => !!g)
      // The same game can turn up twice (an app you added that's also found): keep the first.
      const byPath = new Set<string>()
      found = [...steam.games, ...epic.games, ...mac, ...added].filter((g) => {
        const key = g.path.toLowerCase()
        if (byPath.has(key)) return false
        byPath.add(key)
        return true
      })
      installed = { steam: steam.installed, epic: epic.installed }
      lastScan = Date.now()
    } finally {
      scanning = null
    }
  })()
  return scanning
}

// ---------- icons ----------

const icons = new Map<string, Promise<string | null>>()

function iconFor(path: string): Promise<string | null> {
  let icon = icons.get(path)
  if (!icon) {
    icon = (async () => {
      try {
        if (IS_MAC || IS_WIN) {
          const thumb = await nativeImage.createThumbnailFromPath(path, { width: 256, height: 256 })
          if (!thumb.isEmpty()) return thumb.toDataURL()
        }
      } catch {
        // fall back to the smaller file icon
      }
      try {
        const small = await app.getFileIcon(path, { size: 'large' })
        return small.isEmpty() ? null : small.toDataURL()
      } catch {
        return null
      }
    })()
    icons.set(path, icon)
  }
  return icon
}

// ---------- spotting what's being played ----------

/** The full paths of the programs running now. */
function runningPrograms(): Promise<string[]> {
  return new Promise((resolve) => {
    const done = (err: Error | null, out: string): void => resolve(err ? [] : out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    if (IS_WIN) {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | ForEach-Object { $_.Path }'], { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, done)
    } else {
      // On a Mac "comm" is the program's full path; elsewhere the command line is closest.
      execFile('ps', ['-axww', '-o', IS_MAC ? 'comm=' : 'args='], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, done)
    }
  })
}

const TICK = 60_000
let running = new Set<string>()
let lastTick = 0

const runningListeners = new Set<(playing: boolean) => void>()

/** Whether a game is running right now (checked once a minute). */
export const gameRunning = (): boolean => running.size > 0

/** Calls back when a game starts (true) or the last one closes (false). */
export function onGameRunning(listener: (playing: boolean) => void): () => void {
  runningListeners.add(listener)
  return () => runningListeners.delete(listener)
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('games:changed')
}

async function tick(): Promise<void> {
  if (Date.now() - lastScan > 30 * 60_000) await scan().catch((err) => logError('finding games', err))
  if (!found.length) return
  const programs = await runningPrograms()
  const now = Date.now()
  // Asleep or busy for a while: count at most two ticks' worth.
  const seconds = lastTick ? Math.round(Math.min(now - lastTick, 2 * TICK) / 1000) : 0
  lastTick = now
  const caseInsensitive = IS_MAC || IS_WIN
  const playing = new Set(found.filter((g) => programs.some((p) => isInside(p, g.path, caseInsensitive))).map((g) => g.id))
  const s = loadStore()
  for (const id of playing) s.play[id] = addPlay(s.play[id], running.has(id) ? seconds : 0, new Date(now))
  const changed = playing.size !== running.size || [...playing].some((id) => !running.has(id))
  const wasPlaying = running.size > 0
  running = playing
  if (wasPlaying !== playing.size > 0) for (const l of runningListeners) l(playing.size > 0)
  if (playing.size) saveStore()
  if (changed || playing.size) broadcast()
}

let timer: ReturnType<typeof setTimeout> | null = null
function scheduleTick(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      await tick()
    } catch (err) {
      logError('counting game time', err)
    }
    scheduleTick(TICK)
  }, ms)
}

// ---------- the page ----------

async function gamesList(rescan: boolean): Promise<GamesList> {
  if (rescan || !lastScan) await scan()
  const s = loadStore()
  const now = new Date()
  const hidden = new Set(s.hidden)
  const games: Game[] = await Promise.all(
    found.map(async (g) => {
      const own = s.play[g.id]
      const played = Math.max(own?.total ?? 0, (g.steam?.minutes ?? 0) * 60)
      const last = Math.max(own?.last ?? 0, (g.steam?.lastPlayed ?? 0) * 1000)
      return {
        id: g.id,
        name: g.name,
        source: g.source,
        path: g.path,
        played,
        playedWeek: playedInWeek(own, now),
        lastPlayed: last || null,
        running: running.has(g.id),
        art: g.art,
        icon: !g.art && g.iconFrom ? await iconFor(g.iconFrom) : null,
        hidden: hidden.has(g.id)
      }
    })
  )
  return { games, ...installed }
}

export function setupGames(): void {
  ipcMain.handle('games:list', async (_e, rescan: boolean) => {
    try {
      return await gamesList(!!rescan)
    } catch (err) {
      logError('listing games', err)
      return { games: [], steam: false, epic: false }
    }
  })

  ipcMain.handle('games:play', async (_e, id: string) => {
    const g = found.find((f) => f.id === id)
    if (!g) return "Couldn't find that game any more. Try Refresh."
    try {
      if ('url' in g.launch) await shell.openExternal(g.launch.url)
      else {
        const error = await shell.openPath(g.launch.open)
        if (error) return error
      }
    } catch (err) {
      logError('starting a game', err)
      return g.source === 'steam' ? "Couldn't open Steam to start it. Is Steam installed?" : g.source === 'epic' ? "Couldn't open the Epic Games Launcher to start it." : "Couldn't start it."
    }
    // Look again soon, so it shows as playing without waiting a whole minute.
    scheduleTick(15_000)
    return null
  })

  // The launch animation's pictures, fetched when you press Play (they're too big to send for every game).
  ipcMain.handle('games:launchArt', async (_e, id: string): Promise<LaunchArt> => {
    const g = found.find((f) => f.id === id)
    const appId = steamAppId(id)
    if (!g || !appId) return { hero: g?.art ?? null, logo: null }
    const [hero, logo] = steamRoot
      ? await Promise.all([steamCached(steamRoot, appId, 'library_hero.jpg'), steamCached(steamRoot, appId, 'logo.png')])
      : [null, null]
    return { hero: hero ?? steamImageUrl(appId, 'library_hero.jpg'), logo: logo ?? steamImageUrl(appId, 'logo.png') }
  })

  ipcMain.handle('games:setHidden', (_e, id: string, hide: boolean) => {
    const s = loadStore()
    s.hidden = s.hidden.filter((h) => h !== id)
    if (hide) s.hidden.push(id)
    saveStore()
  })

  ipcMain.handle('games:add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Add a game',
      buttonLabel: 'Add',
      defaultPath: IS_MAC ? '/Applications' : undefined,
      properties: ['openFile'],
      filters: IS_MAC ? [{ name: 'Apps', extensions: ['app'] }] : IS_WIN ? [{ name: 'Programs', extensions: ['exe', 'lnk', 'url'] }] : []
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = result.canceled ? null : result.filePaths[0]
    if (!path) return null
    const s = loadStore()
    s.hidden = s.hidden.filter((h) => !h.endsWith(`:${path}`))
    if (!found.some((g) => g.path.toLowerCase() === path.toLowerCase())) {
      if (!s.added.includes(path)) s.added.push(path)
    }
    saveStore()
    await scan()
    return found.find((g) => g.path.toLowerCase() === path.toLowerCase())?.id ?? null
  })

  ipcMain.handle('games:remove', async (_e, id: string) => {
    const s = loadStore()
    s.added = s.added.filter((p) => `added:${p}` !== id)
    saveStore()
    found = found.filter((g) => g.id !== id)
  })

  ipcMain.handle('games:reveal', (_e, id: string) => {
    const g = found.find((f) => f.id === id)
    if (g && existsSync(g.path)) shell.showItemInFolder(g.path)
  })

  // Start counting a little after start-up, so finding games doesn't slow Notes opening.
  scheduleTick(20_000)
}
