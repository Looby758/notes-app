/**
 * The games launcher's pure parts: reading Steam's and Epic's files, spotting games among Mac
 * apps, and adding up time played. Kept free of Electron and the file system so it can be tested.
 */

export type GameSource = 'steam' | 'epic' | 'app' | 'added'

/** A game as the Games page shows it. */
export interface Game {
  /** "steam:620", "epic:Fortnite", "app:/Applications/Chess.app"… */
  id: string
  name: string
  source: GameSource
  /** Where it's installed (a folder or an app); a program running from in here counts as playing. */
  path: string
  /** Seconds played in all. */
  played: number
  /** Seconds played in the last 7 days (as counted by Notes). */
  playedWeek: number
  /** When it was last played (ms), or null if never. */
  lastPlayed: number | null
  /** It's running right now. */
  running: boolean
  /** A picture for the card: a web address or a data: URL; null to show the icon instead. */
  art: string | null
  /** The app's own icon, as a data: URL. */
  icon: string | null
  hidden: boolean
}

export interface GamesList {
  games: Game[]
  /** Whether Steam is installed (so the page can say why there are no Steam games). */
  steam: boolean
  epic: boolean
}

// ---------- Valve's KeyValues (.vdf / .acf) ----------

export type Vdf = { [key: string]: string | Vdf }

/**
 * Reads Steam's text KeyValues format: `"key" "value"` pairs and `"key" { … }` sections. Keys are
 * lower-cased (Steam isn't consistent about case). Anything it can't make sense of is skipped.
 */
export function parseVdf(text: string): Vdf {
  const tokens: (string | '{' | '}')[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      let s = ''
      i++
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          i += 2
        } else s += text[i++]
      }
      i++
      tokens.push(s)
    } else if (c === '{' || c === '}') {
      tokens.push(c)
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '[') {
      // Platform conditions like [$WIN32]: ignored.
      while (i < n && text[i] !== ']') i++
      i++
    } else if (/\s/.test(c)) {
      i++
    } else {
      let s = ''
      while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++]
      tokens.push(s)
    }
  }
  let pos = 0
  const read = (): Vdf => {
    const out: Vdf = {}
    while (pos < tokens.length) {
      const key = tokens[pos++]
      if (key === '}') break
      if (key === '{') continue
      const value = tokens[pos++]
      if (value === undefined) break
      if (value === '{') out[key.toLowerCase()] = read()
      else if (value !== '}') out[key.toLowerCase()] = value
      else break
    }
    return out
  }
  return read()
}

const section = (v: string | Vdf | undefined): Vdf | null => (v && typeof v === 'object' ? v : null)

/** The folders Steam keeps games in, from steamapps/libraryfolders.vdf (old and new layouts). */
export function steamLibraryFolders(vdfText: string): string[] {
  const root = section(parseVdf(vdfText).libraryfolders)
  if (!root) return []
  const out: string[] = []
  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) continue
    const path = typeof value === 'string' ? value : typeof value.path === 'string' ? value.path : null
    if (path) out.push(path)
  }
  return out
}

export interface SteamApp {
  appId: string
  name: string
  installDir: string
}

// Steam's own runtimes and tools, which aren't games.
const STEAM_NOT_GAMES = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '961940', '1245040', '1580130', '1887720', '2348590', '1826330'])

/** An installed Steam game, from one appmanifest_<id>.acf; null if it isn't a game you can play. */
export function steamAppFromManifest(acfText: string): SteamApp | null {
  const state = section(parseVdf(acfText).appstate)
  if (!state) return null
  const appId = typeof state.appid === 'string' ? state.appid : ''
  const name = typeof state.name === 'string' ? state.name : ''
  const installDir = typeof state.installdir === 'string' ? state.installdir : ''
  if (!/^\d+$/.test(appId) || !name || !installDir) return null
  if (STEAM_NOT_GAMES.has(appId) || /redistributable|steamworks common|steam linux runtime|proton \d|dedicated server|\bsdk\b/i.test(name)) return null
  return { appId, name, installDir }
}

export interface SteamPlaytime {
  /** Minutes played in all. */
  minutes: number
  /** Last played, in seconds since 1970 (0: never). */
  lastPlayed: number
}

/** Time played per game, from userdata/<account>/config/localconfig.vdf. */
export function steamPlaytimes(vdfText: string): Map<string, SteamPlaytime> {
  const out = new Map<string, SteamPlaytime>()
  const store = section(parseVdf(vdfText).userlocalconfigstore)
  const apps = section(section(section(section(store?.software)?.valve)?.steam)?.apps)
  if (!apps) return out
  for (const [id, value] of Object.entries(apps)) {
    const app = section(value)
    if (!app || !/^\d+$/.test(id)) continue
    const minutes = Number(app.playtime) || 0
    const lastPlayed = Number(app.lastplayed) || 0
    if (minutes || lastPlayed) out.set(id, { minutes, lastPlayed })
  }
  return out
}

// ---------- Epic Games ----------

export interface EpicGame {
  appName: string
  name: string
  installLocation: string
  /** The program it starts, inside installLocation. */
  executable: string
  /** For the launch link. */
  namespace: string
  itemId: string
}

/** One installed Epic game, from a Manifests/*.item file; null if it isn't one. */
export function epicGameFromManifest(jsonText: string): EpicGame | null {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(jsonText)
  } catch {
    return null
  }
  const str = (k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '')
  const appName = str('AppName')
  const name = str('DisplayName') || appName
  const installLocation = str('InstallLocation')
  if (!appName || !installLocation) return null
  // Add-ons and DLC point at their main game; leave them out.
  if (str('MainGameAppName') && str('MainGameAppName') !== appName) return null
  const categories = Array.isArray(m.AppCategories) ? (m.AppCategories as unknown[]) : []
  if (categories.length && !categories.includes('games')) return null
  return { appName, name, installLocation, executable: str('LaunchExecutable'), namespace: str('CatalogNamespace'), itemId: str('CatalogItemId') }
}

export const epicLaunchUrl = (g: Pick<EpicGame, 'appName' | 'namespace' | 'itemId'>): string =>
  g.namespace && g.itemId
    ? `com.epicgames.launcher://apps/${encodeURIComponent(`${g.namespace}:${g.itemId}:${g.appName}`)}?action=launch&silent=true`
    : `com.epicgames.launcher://apps/${encodeURIComponent(g.appName)}?action=launch&silent=true`

// ---------- Mac apps ----------

/** A value from an XML Info.plist (strings only). */
export function plistString(xml: string, key: string): string | null {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)
  return m ? decodeXml(m[1]).trim() : null
}

const decodeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// Game shops and launchers say they're games too, but they're not what you want on the list.
const LAUNCHERS = /^(com\.valvesoftware\.steam|com\.epicgames\.|com\.blizzard\.|com\.gog\.|com\.ea\.|com\.ubisoft\.|com\.riotgames\.RiotClient|com\.microsoft\.xbox|com\.nvidia\.gfn|com\.apple\.games$)/i

/** If an app's Info.plist says it's a game, its name; otherwise null. */
export function macGameFromPlist(xml: string, fallbackName: string): string | null {
  const category = plistString(xml, 'LSApplicationCategoryType') ?? ''
  if (!/^public\.app-category\.([a-z-]+-)?games$/i.test(category)) return null
  if (LAUNCHERS.test(plistString(xml, 'CFBundleIdentifier') ?? '')) return null
  return plistString(xml, 'CFBundleDisplayName') || plistString(xml, 'CFBundleName') || fallbackName
}

// ---------- Time played ----------

/** What Notes has counted for one game. */
export interface PlayRecord {
  /** Seconds in all. */
  total: number
  /** Last seen running (ms). */
  last: number
  /** Seconds per day, "2026-10-28" → 1800. */
  days: Record<string, number>
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Adds `seconds` of play at time `now`, keeping only the last two months of days. */
export function addPlay(record: PlayRecord | undefined, seconds: number, now: Date): PlayRecord {
  const r: PlayRecord = record ? { ...record, days: { ...record.days } } : { total: 0, last: 0, days: {} }
  const today = dayKey(now)
  r.total += seconds
  r.last = now.getTime()
  r.days[today] = (r.days[today] ?? 0) + seconds
  const oldest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 62))
  for (const d of Object.keys(r.days)) if (d < oldest) delete r.days[d]
  return r
}

/** Seconds played in the 7 days up to and including `now`'s day. */
export function playedInWeek(record: PlayRecord | undefined, now: Date): number {
  if (!record) return 0
  const from = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  const to = dayKey(now)
  return Object.entries(record.days).reduce((sum, [d, s]) => (d >= from && d <= to ? sum + s : sum), 0)
}

/** "2h 15m", "45m", "Under a minute", "Not played yet". */
export function describePlayed(seconds: number): string {
  if (seconds <= 0) return 'Not played yet'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'Under a minute'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`
}

/** "Today", "Yesterday", "3 days ago", "12 Mar", "12 Mar 2024". */
export function describeLastPlayed(when: number | null, now: Date): string {
  if (!when) return 'Never played'
  const then = new Date(when)
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000)
  if (days <= 0) return 'Played today'
  if (days === 1) return 'Played yesterday'
  if (days < 7) return `Played ${days} days ago`
  const sameYear = then.getFullYear() === now.getFullYear()
  return `Played ${then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

export type GameSort = 'recent' | 'most' | 'name'

/** Playing now first, then by the chosen order. */
export function sortGames(games: Game[], by: GameSort): Game[] {
  const byName = (a: Game, b: Game): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  return [...games].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1
    if (by === 'recent') return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || byName(a, b)
    if (by === 'most') return b.played - a.played || byName(a, b)
    return byName(a, b)
  })
}

/** Whether a running program (its full path) belongs to a game installed at `gamePath`. */
export function isInside(programPath: string, gamePath: string, caseInsensitive: boolean): boolean {
  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return caseInsensitive ? s.toLowerCase() : s
  }
  const prog = norm(programPath)
  const game = norm(gamePath)
  return !!game && (prog === game || prog.startsWith(game + '/'))
}
