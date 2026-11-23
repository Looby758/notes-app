/**
 * The clean uninstaller (main/uninstaller.ts, components/Uninstaller): which apps are installed,
 * and what an app leaves behind once it's gone. Everything here is plain logic, so it's tested
 * without a Windows or Mac machine (uninstaller.test.ts).
 *
 * The rules that keep it safe:
 * - Only places an app keeps its own files are looked in (see leftoverRoots in main), never the
 *   folders themselves, never a system folder, and never a folder that holds something that must
 *   stay (Orbit's own data, your notes folder, Windows, your home folder…): isSafeLeftover.
 * - A leftover only counts when its name is the app's own name (or a Mac app's bundle ID), never
 *   just a word in it; names that many apps share ("Microsoft", "Google", "Common Files") never
 *   count on their own: matchName.
 * - Nothing is removed until you've seen the list and confirmed, and files go to the Recycle Bin /
 *   Bin, never straight to deletion. Registry settings can't go in the Recycle Bin, so they're
 *   saved to a .reg file first (double-click it to put them back).
 */

export interface InstalledApp {
  /** Windows: the app's uninstall registry key. Mac: where the .app is. */
  id: string
  name: string
  publisher?: string
  version?: string
  /** Bytes, when the system says (Windows' estimate). */
  size?: number
  /** YYYY-MM-DD, when known. */
  installedAt?: string
  /** Windows: the folder it says it's installed in. Mac: the .app itself. */
  location?: string
  /** Mac: e.g. com.spotify.client; leftovers are found by it. */
  bundleId?: string
  /** Installed for everyone on the computer (Windows asks for administrator rights to remove it). */
  forEveryone?: boolean
  /** A data: URL, when there's an icon. */
  icon?: string
}

export interface AppList {
  apps: InstalledApp[]
  /** Why the list couldn't be read (shown instead of it). */
  problem?: string
}

export type LeftoverKind = 'app' | 'folder' | 'file' | 'shortcut' | 'registry'

export interface Leftover {
  id: string
  /** A file or folder path, or a registry key (HKEY_CURRENT_USER\Software\…). */
  path: string
  kind: LeftoverKind
  /** Bytes, when it's been added up. */
  size?: number
  /** Where it was found, in words ("Settings", "Caches", "Start menu"…). */
  where: string
}

export interface LeftoverScan {
  /** Ties a removal to this list: only these items can be removed with it. */
  scanId: string
  app: InstalledApp
  items: Leftover[]
  /** Mac: the app is open, so it has to be quit before it can be moved to the Bin. */
  running?: boolean
}

export interface RunResult {
  /** The uninstaller started (false: it wasn't allowed to, or was cancelled at the Windows prompt). */
  started: boolean
  /** Its uninstall entry has gone, so it's finished. */
  gone: boolean
  problem?: string
}

export interface RemoveResult {
  removed: number
  /** One line for each thing that couldn't be removed. */
  failed: string[]
  /** Where the registry settings were saved before they were removed. */
  backup?: string
}

// ---------------------------------------------------------------------------------------------
// Names

/** Lower case, letters and digits only: "Discord PTB" → "discordptb". */
export const squash = (s: string): string =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Names too general to mean one app: a folder called this is shared by many (or is the system's).
 * Squashed.
 */
const SHARED_NAMES = new Set(
  [
    'Microsoft',
    'Windows',
    'Apple',
    'Google',
    'Mozilla',
    'Adobe',
    'Intel',
    'NVIDIA',
    'NVIDIA Corporation',
    'AMD',
    'Common Files',
    'Programs',
    'Packages',
    'Temp',
    'Tmp',
    'Cache',
    'Caches',
    'Logs',
    'System',
    'Users',
    'Data',
    'Default',
    'Config',
    'Settings',
    'Software',
    'Classes',
    'Policies',
    'WOW6432Node',
    'Wow6432Node',
    'Application',
    'Applications',
    'App',
    'Apps',
    'Update',
    'Updater',
    'Installer',
    'Uninstall',
    'Setup',
    'Desktop',
    'Documents',
    'Downloads',
    'Start Menu',
    'Startup',
    'Accessories',
    'Administrative Tools',
    'Maintenance',
    'System Tools',
    'Windows PowerShell',
    'Windows Kits',
    'WindowsApps',
    'Epic Games',
    'Electron',
    'CrashReports',
    'Crashpad',
    'Orbit',
    'Notes',
    'Notesapp',
    'Library',
    'Preferences',
    'Containers',
    'Group Containers',
    'Program Files',
    'Program Files (x86)',
    'ProgramData',
    'AppData',
    'Local',
    'Roaming',
    'LocalLow',
    'bin',
    'Games',
    'Tools',
    'Utilities'
  ].map(squash)
)

/** A name that's too short or too general to point at one app. */
export const tooGeneral = (key: string): boolean => key.length < 3 || SHARED_NAMES.has(key)

/** "7-Zip 23.01 (x64)" → "7-Zip"; "Zoom Workplace (64-bit)" → "Zoom Workplace". */
export function baseName(name: string): string {
  let s = name.trim()
  for (let i = 0; i < 3; i++) {
    const before = s
    s = s
      .replace(/\s*[([][^)\]]*[)\]]\s*$/, '') // "(x64)", "[en-US]"
      .replace(/\s+(?:v(?:ersion)?\s*)?\d+(?:[.\-_]\d+)*[a-z]?\s*$/i, '') // " 23.01", " v2"
      .replace(/\s*[-–]\s*$/, '')
      .replace(/\s+(?:x64|x86|64-bit|32-bit|amd64|arm64)\s*$/i, '')
      .trim()
    if (s === before) break
  }
  return s || name.trim()
}

/** The names an app's own folders and settings would have, squashed (never a too-general one). */
export function appKeys(app: Pick<InstalledApp, 'name' | 'location' | 'bundleId'>, extra: string[] = []): string[] {
  const keys = new Set<string>()
  const add = (s: string | undefined): void => {
    if (!s) return
    const k = squash(s)
    if (!tooGeneral(k)) keys.add(k)
  }
  add(app.name)
  add(baseName(app.name))
  // The folder it was installed in is usually what it calls itself ("C:\Program Files\Mozilla Firefox"),
  // but only when that's plainly the app's (not "C:\Program Files\JetBrains" for PyCharm).
  if (app.location && ownFolder(app.name, app.location)) add(lastPart(app.location).replace(/\.app$/i, ''))
  for (const e of extra) add(e)
  return [...keys]
}

/**
 * Whether the folder at `location` is the app's own (its name has the app's whole name in it), not
 * a company folder that holds several apps ("Epic Games" for the Epic Games Launcher).
 */
export function ownFolder(name: string, location: string): boolean {
  const folder = squash(lastPart(location).replace(/\.app$/i, ''))
  if (tooGeneral(folder)) return false
  const base = squash(baseName(name))
  return !!base && !tooGeneral(base) && folder.includes(base)
}

/** Publisher names as folders are called: "Spotify AB" → "spotifyab" and "spotify". */
export function publisherKeys(publisher: string | undefined): string[] {
  if (!publisher) return []
  const keys = new Set<string>()
  const full = squash(publisher)
  if (!tooGeneral(full)) keys.add(full)
  const short = squash(publisher.replace(/[,.]?\s+(?:inc|ltd|llc|gmbh|ab|corp|corporation|co|company|limited|s\.?a|b\.?v|software|technologies|games|studios?)\.?$/i, ''))
  if (!tooGeneral(short)) keys.add(short)
  return [...keys]
}

/** True when a bundle ID is in a Mac file name as a whole: "com.x.app.plist", "group.com.x.app", "ABCD123.com.x.app". */
export function hasBundleId(fileName: string, bundleId: string): boolean {
  if (!bundleId || bundleId.split('.').length < 2) return false
  const f = fileName.toLowerCase()
  const b = bundleId.toLowerCase()
  const i = f.indexOf(b)
  if (i < 0) return false
  const before = i === 0 ? '' : f[i - 1]
  const after = f[i + b.length] ?? ''
  // Whole: nothing or a dot either side ("com.x.app" mustn't match "com.x.apple").
  return (before === '' || before === '.') && (after === '' || after === '.')
}

export type Match = 'app' | 'publisher' | null

/**
 * Does a folder or file called `entry` belong to the app? 'app' when its name is the app's own
 * (file extensions like .lnk and .plist ignored), 'publisher' when it's the company's folder (look
 * inside it for the app), otherwise null.
 */
export function matchName(entry: string, keys: string[], pubKeys: string[] = [], bundleId?: string): Match {
  if (bundleId && hasBundleId(entry, bundleId)) return 'app'
  const k = squash(entry.replace(/\.(?:lnk|url|plist|savedstate|binarycookies|json|log|ini|cfg)$/i, ''))
  if (!k || tooGeneral(k)) return null
  if (keys.includes(k)) return 'app'
  if (pubKeys.includes(k)) return 'publisher'
  return null
}

// ---------------------------------------------------------------------------------------------
// Paths (written for both kinds, so it's tested here on either)

const isWinPath = (p: string): boolean => /^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\')

function lastPart(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** One way of writing a path, for comparing: Windows ones in lower case with backslashes. */
export function pathKey(p: string): string {
  if (isWinPath(p)) return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return p.replace(/\/+$/, '') || '/'
}

/** `child` is inside `parent` (not the same). */
export function isInside(child: string, parent: string): boolean {
  const c = pathKey(child)
  const p = pathKey(parent)
  const sep = isWinPath(child) ? '\\' : '/'
  return c !== p && c.startsWith(p.endsWith(sep) ? p : p + sep)
}

export interface SafeRules {
  /** The folders leftovers are looked for in: a leftover must be inside one (and isn't one). */
  roots: string[]
  /** Folders that must stay, along with everything that holds them. */
  keep: string[]
}

/**
 * Whether a found path may be removed: it's inside one of the places looked in (not one of them),
 * has no "..", and isn't (and doesn't hold) anything that must stay.
 */
export function isSafeLeftover(path: string, rules: SafeRules): boolean {
  if (!path || /(^|[\\/])\.\.([\\/]|$)/.test(path)) return false
  if (!isWinPath(path) && !path.startsWith('/')) return false
  const key = pathKey(path)
  if (!rules.roots.some((r) => isInside(path, r))) return false
  for (const k of [...rules.keep, ...rules.roots]) {
    const kk = pathKey(k)
    if (key === kk || isInside(k, path)) return false
  }
  return true
}

// ---------------------------------------------------------------------------------------------
// Windows: the installed apps list (from the registry's uninstall entries)

/** One uninstall entry as the PowerShell helper reads it. */
export interface WinRawApp {
  /** The registry key's full name. */
  k: string
  /** 'user' for the current user's own (HKCU), else the whole computer's. */
  s?: string
  n?: string | null
  pub?: string | null
  ver?: string | null
  loc?: string | null
  u?: string | null
  sz?: number | string | null
  d?: string | null
  ic?: string | null
  sc?: number | string | null
  par?: string | null
  rt?: string | null
}

/** "20240131" → "2024-01-31". */
export function installDate(d: string | null | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((d ?? '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
}

/** A DisplayIcon value ("C:\x\app.exe,0" or with quotes) → the file. */
export function iconFile(ic: string | null | undefined): string | undefined {
  if (!ic) return undefined
  const f = ic
    .trim()
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()
  return /^[a-z]:\\/i.test(f) ? f : undefined
}

const UPDATE_NAME = /^(?:(?:security |critical |definition )?update for |hotfix for |service pack )|\bKB\d{6,}\b/i

/**
 * The apps worth showing from the uninstall entries: ones with a name and an uninstaller, without
 * Windows' own parts, updates and pieces of other apps, and without Orbit (it's removed from
 * Settings → Apps, as it can't remove itself while open).
 */
export function fromWindows(raw: WinRawApp[], self = 'Orbit'): InstalledApp[] {
  const seen = new Map<string, InstalledApp>()
  for (const r of raw) {
    const name = (r.n ?? '').trim()
    if (!name || !r.u?.trim()) continue
    if (String(r.sc ?? '') === '1' || r.par) continue
    if (r.rt && /update|hotfix/i.test(r.rt)) continue
    if (UPDATE_NAME.test(name)) continue
    if (name.toLowerCase() === self.toLowerCase()) continue
    const kb = Number(r.sz)
    const app: InstalledApp = {
      id: r.k,
      name,
      publisher: r.pub?.trim() || undefined,
      version: r.ver?.trim() || undefined,
      size: Number.isFinite(kb) && kb > 0 ? kb * 1024 : undefined,
      installedAt: installDate(r.d),
      location: r.loc?.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '') || undefined,
      forEveryone: r.s !== 'user'
    }
    // The same app listed twice (32- and 64-bit keys): keep the first.
    const key = `${name.toLowerCase()}|${app.version ?? ''}`
    if (!seen.has(key)) seen.set(key, app)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Splits an UninstallString into the program and what to pass it: quoted ("C:\x y\un.exe" /S),
 * or not (C:\Program Files\x\uninst.exe /S, spaces and all, up to ".exe"). An MSI's "/I{…}"
 * (which opens the repair screen) becomes "/X{…}" (remove).
 */
export function splitCommand(cmd: string): { file: string; args: string } | null {
  const s = cmd.trim()
  if (!s) return null
  let file: string
  let args: string
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    if (end < 0) return null
    file = s.slice(1, end)
    args = s.slice(end + 1).trim()
  } else {
    const m = /^(.*?\.(?:exe|cmd|bat))(?=\s|$)/i.exec(s)
    if (m) {
      file = m[1]
      args = s.slice(m[1].length).trim()
    } else {
      const space = s.indexOf(' ')
      file = space < 0 ? s : s.slice(0, space)
      args = space < 0 ? '' : s.slice(space + 1).trim()
    }
  }
  if (!file) return null
  if (/(^|\\)msiexec(\.exe)?$/i.test(file)) args = args.replace(/(^|\s)\/I(\s*\{)/i, '$1/X$2')
  return { file, args }
}

/** Keys from `reg query <key>`'s answer: the lines that are subkeys (each a full key name). */
export function parseRegQuery(text: string, under: string): string[] {
  const prefix = under.toLowerCase().replace(/\\+$/, '') + '\\'
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.toLowerCase().startsWith(prefix) && !l.slice(prefix.length).includes('\\') && l.length > prefix.length)
}

/** Only the current user's own settings, one level or two under Software, never the system's. */
export function isSafeRegistryKey(key: string): boolean {
  const m = /^HKEY_CURRENT_USER\\Software\\([^\\]+)(?:\\([^\\]+))?$/i.exec(key)
  if (!m) return false
  const first = squash(m[1])
  if (!first || ['microsoft', 'classes', 'policies', 'wow6432node', 'windows', 'appdatalow', 'clients', 'registeredapplications'].includes(first)) return false
  if (m[2] && tooGeneral(squash(m[2]))) return false
  if (!m[2] && tooGeneral(first)) return false
  return true
}

// ---------------------------------------------------------------------------------------------
// Mac

/** The useful parts of an app's Info.plist (as `plutil -convert json` gives it). */
export function fromInfoPlist(path: string, plist: Record<string, unknown>): InstalledApp | null {
  const str = (k: string): string | undefined => (typeof plist[k] === 'string' && (plist[k] as string).trim()) || undefined
  const bundleId = str('CFBundleIdentifier')
  const name = str('CFBundleDisplayName') ?? str('CFBundleName') ?? lastPart(path).replace(/\.app$/i, '')
  // macOS's own apps (Safari, Mail…) are part of the system and can't be removed.
  if (bundleId && /^com\.apple\./i.test(bundleId)) return null
  return { id: path, name, bundleId, version: str('CFBundleShortVersionString') ?? str('CFBundleVersion'), location: path }
}

/** Which of `ps -axo comm=`'s lines run from inside this .app. */
export function runningFrom(psText: string, appPath: string): boolean {
  const inside = appPath.replace(/\/+$/, '') + '/'
  return psText.split('\n').some((l) => l.trim().startsWith(inside))
}

// ---------------------------------------------------------------------------------------------
// The page

export function searchApps(apps: InstalledApp[], query: string): InstalledApp[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return apps
  return apps.filter((a) => {
    const text = `${a.name} ${a.publisher ?? ''} ${a.version ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

export type AppSort = 'name' | 'size' | 'date'

export function sortApps(apps: InstalledApp[], by: AppSort): InstalledApp[] {
  const byName = (a: InstalledApp, b: InstalledApp): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const list = [...apps]
  if (by === 'size') list.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || byName(a, b))
  else if (by === 'date') list.sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? '') || byName(a, b))
  else list.sort(byName)
  return list
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** The ticked items' total size. */
export function totalSize(items: Leftover[], ticked: Set<string>): number {
  return items.reduce((n, i) => n + (ticked.has(i.id) ? (i.size ?? 0) : 0), 0)
}
