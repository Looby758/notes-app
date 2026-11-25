import { app, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { lstat, mkdir, readdir } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'
import {
  appKeys,
  fromInfoPlist,
  fromWindows,
  iconFile,
  isInside,
  isSafeLeftover,
  isSafeRegistryKey,
  matchName,
  ownFolder,
  parseRegQuery,
  pathKey,
  publisherKeys,
  runningFrom,
  splitCommand,
  type AppList,
  type InstalledApp,
  type Leftover,
  type LeftoverKind,
  type LeftoverScan,
  type RemoveResult,
  type RunResult,
  type SafeRules,
  type WinRawApp
} from '@shared/uninstaller'
import { countFolder } from './folderSize/count'
import { loadSettings } from './settings'
import { logError } from './log'

/**
 * The clean uninstaller: removes an app, then finds what it left behind (settings, caches, logs,
 * shortcuts) and, once you've looked at the list and confirmed, moves those to the Recycle Bin /
 * Bin. The matching and safety rules are in shared/uninstaller.ts.
 *
 * - Windows: the apps are the uninstall entries in the registry (what Settings → Apps lists). The
 *   app's own uninstaller is run first (Windows asks for administrator rights when it needs them),
 *   then its leftovers are looked for in Program Files, AppData, ProgramData, the Start menu and
 *   the desktop, plus its settings in the registry under HKEY_CURRENT_USER\Software (saved to a .reg
 *   file before they're removed).
 * - Mac: the apps are the .app bundles in /Applications and ~/Applications (not macOS's own). The
 *   app and its files in ~/Library go to the Bin together.
 */

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const run = promisify(execFile)

/** The last list: each app, and (Windows) how to run its uninstaller and where its icon is. */
let apps = new Map<string, InstalledApp>()
const uninstallCommands = new Map<string, string>()
/** The last few leftover lists, by scanId: only what was shown can be removed. */
const scans = new Map<string, { scan: LeftoverScan; rules: SafeRules }>()
let nextScan = 1

// ---------------------------------------------------------------------------------------------
// The list of apps

const WIN_LIST = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$roots = @(
  @{ p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; s = 'machine' },
  @{ p = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; s = 'machine' },
  @{ p = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; s = 'user' }
)
$list = foreach ($r in $roots) {
  if (-not (Test-Path $r.p)) { continue }
  foreach ($k in Get-ChildItem $r.p -ErrorAction SilentlyContinue) {
    $v = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if (-not $v -or -not $v.DisplayName) { continue }
    @{ k = $k.Name; s = $r.s; n = $v.DisplayName; pub = $v.Publisher; ver = $v.DisplayVersion; loc = $v.InstallLocation; u = $v.UninstallString; sz = $v.EstimatedSize; d = $v.InstallDate; ic = $v.DisplayIcon; sc = $v.SystemComponent; par = $v.ParentKeyName; rt = $v.ReleaseType }
  }
}
ConvertTo-Json -Compress -Depth 3 -InputObject @($list)
`

const encoded = (script: string): string[] => ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]

async function iconOf(file: string | undefined): Promise<string | undefined> {
  if (!file) return undefined
  const img = await app.getFileIcon(file, { size: 'normal' }).catch(() => null)
  return img && !img.isEmpty() ? img.toDataURL() : undefined
}

/** Runs `fn` over `items`, a few at a time. */
async function eachLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

async function windowsApps(): Promise<InstalledApp[]> {
  const { stdout } = await run('powershell.exe', encoded(WIN_LIST), { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 })
  const parsed = JSON.parse(stdout.trim() || '[]') as WinRawApp[] | WinRawApp
  const raw = Array.isArray(parsed) ? parsed : [parsed]
  const list = fromWindows(raw, app.getName())
  const byKey = new Map(raw.map((r) => [r.k, r]))
  uninstallCommands.clear()
  await eachLimited(list, 8, async (a) => {
    const r = byKey.get(a.id)
    if (r?.u) uninstallCommands.set(a.id, r.u)
    a.icon = await iconOf(iconFile(r?.ic))
  })
  return list
}

async function macApps(): Promise<InstalledApp[]> {
  const self = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '')
  const bundles: string[] = []
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const path = join(dir, e.name)
      if (e.name.endsWith('.app')) bundles.push(path)
      // One level of folders ("/Applications/Adobe Photoshop/Adobe Photoshop.app"), not macOS's Utilities.
      else if (e.isDirectory() && e.name !== 'Utilities')
        for (const inner of await readdir(path).catch(() => [] as string[])) if (inner.endsWith('.app')) bundles.push(join(path, inner))
    }
  }
  const found = await eachLimited(bundles, 8, async (path): Promise<InstalledApp | null> => {
    if (path === self) return null
    try {
      const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')], { maxBuffer: 16 * 1024 * 1024 })
      const plist = JSON.parse(stdout) as Record<string, unknown>
      const a = fromInfoPlist(path, plist)
      if (!a || a.bundleId === 'com.notesapp.desktop' || a.name === app.getName()) return null
      const st = await lstat(path).catch(() => null)
      if (st) a.installedAt = new Date(st.birthtimeMs || st.mtimeMs).toISOString().slice(0, 10)
      a.icon = await iconOf(path)
      return a
    } catch {
      return null // Not a whole app (or one macOS won't let us read).
    }
  })
  return found.filter((a): a is InstalledApp => !!a).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function listApps(): Promise<AppList> {
  if (!IS_WIN && !IS_MAC) return { apps: [], problem: 'The uninstaller works on Windows and Mac.' }
  try {
    const list = IS_WIN ? await windowsApps() : await macApps()
    apps = new Map(list.map((a) => [a.id, a]))
    return { apps: list }
  } catch (err) {
    logError('uninstaller', err)
    return { apps: [], problem: `Couldn’t read the list of installed apps: ${(err as Error).message ?? err}` }
  }
}

// ---------------------------------------------------------------------------------------------
// Windows: running the app's own uninstaller

/** A registry key is still there. */
async function keyExists(key: string): Promise<boolean> {
  try {
    await run('reg.exe', ['query', key], { windowsHide: true, timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

/** The app's uninstall entry (Windows) or the app itself (Mac) has gone. */
export async function isGone(id: string): Promise<boolean> {
  if (IS_WIN) return !(await keyExists(id))
  return !existsSync(id)
}

const START_UNINSTALLER = String.raw`
$f = $env:ORBIT_UNINSTALL_FILE
$a = $env:ORBIT_UNINSTALL_ARGS
try {
  if ($a) { $p = Start-Process -FilePath $f -ArgumentList $a -PassThru -ErrorAction Stop }
  else { $p = Start-Process -FilePath $f -PassThru -ErrorAction Stop }
  $p.WaitForExit()
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

/**
 * Runs the app's own uninstaller and waits for it to close. Many hand over to a copy of
 * themselves and close straight away, so `gone` can still be false; the page keeps checking.
 */
export async function runUninstaller(id: string): Promise<RunResult> {
  if (!IS_WIN) return { started: false, gone: false, problem: 'Only Windows apps have their own uninstaller.' }
  const command = uninstallCommands.get(id)
  const parts = command ? splitCommand(command) : null
  if (!parts) return { started: false, gone: false, problem: 'This app didn’t say how to uninstall it.' }
  const outcome = await new Promise<{ code: number | null; err: string }>((resolve) => {
    // The program and its arguments go in as environment values, so nothing in them is read as PowerShell.
    const child = spawn('powershell.exe', encoded(START_UNINSTALLER), {
      windowsHide: true,
      env: { ...process.env, ORBIT_UNINSTALL_FILE: parts.file, ORBIT_UNINSTALL_ARGS: parts.args }
    })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => resolve({ code: 1, err: e.message }))
    child.on('exit', (code) => resolve({ code, err }))
  })
  const gone = await isGone(id)
  if (outcome.code !== 0 && !gone) {
    const text = outcome.err.replace(/#< CLIXML[\s\S]*/, '').trim()
    if (/cancel/i.test(text)) return { started: false, gone, problem: 'The uninstaller was cancelled (Windows asked for permission and it was declined).' }
    return { started: false, gone, problem: text ? `The uninstaller didn’t start: ${text}` : 'The uninstaller didn’t start.' }
  }
  return { started: true, gone }
}

// ---------------------------------------------------------------------------------------------
// Finding what's left

interface Place {
  dir: string
  where: string
  /** Shortcut places: only .lnk and .url files count (and folders of them, in the Start menu). */
  shortcuts?: 'files' | 'files-and-folders'
}

function windowsPlaces(): { places: Place[]; keep: string[] } {
  const env = process.env
  const home = homedir()
  const roaming = env.APPDATA || join(home, 'AppData', 'Roaming')
  const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const programData = env.ProgramData || 'C:\\ProgramData'
  const programFiles = [...new Set([env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((p): p is string => !!p))]
  const startMenus = [join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
  const desktops = [...new Set([app.getPath('desktop'), join(home, 'Desktop'), join(env.PUBLIC || 'C:\\Users\\Public', 'Desktop')])]
  const places: Place[] = [
    ...programFiles.map((dir) => ({ dir, where: 'Program Files' })),
    { dir: join(local, 'Programs'), where: 'Programs' },
    { dir: roaming, where: 'App data' },
    { dir: local, where: 'App data (local)' },
    { dir: join(home, 'AppData', 'LocalLow'), where: 'App data (local)' },
    { dir: programData, where: 'Shared app data' },
    ...startMenus.map((dir) => ({ dir, where: 'Start menu', shortcuts: 'files-and-folders' as const })),
    ...desktops.map((dir) => ({ dir, where: 'Desktop shortcut', shortcuts: 'files' as const }))
  ]
  const keep = [
    home,
    env.SystemRoot || 'C:\\Windows',
    ...programFiles.flatMap((p) => [p, join(p, 'Common Files'), join(p, 'WindowsApps')]),
    join(roaming, 'Microsoft'),
    join(local, 'Microsoft'),
    join(local, 'Packages'),
    join(local, 'Temp'),
    join(programData, 'Microsoft')
  ]
  return { places, keep }
}

function macPlaces(): { places: Place[]; keep: string[] } {
  const lib = join(homedir(), 'Library')
  const at = (sub: string, where: string): Place => ({ dir: join(lib, sub), where })
  const places = [
    at('Application Support', 'App data'),
    at('Caches', 'Caches'),
    at('Preferences', 'Settings'),
    at('Preferences/ByHost', 'Settings'),
    at('Logs', 'Logs'),
    at('Saved Application State', 'Saved windows'),
    at('Containers', 'App data'),
    at('Group Containers', 'Shared app data'),
    at('HTTPStorages', 'Web data'),
    at('WebKit', 'Web data'),
    at('Cookies', 'Cookies'),
    at('LaunchAgents', 'Opens at login'),
    at('Application Scripts', 'Scripts')
  ]
  return { places, keep: [homedir(), lib] }
}

/** What must never be removed, wherever it is: Orbit itself and its data, your notes, the other apps. */
function alwaysKeep(except: InstalledApp): string[] {
  const keep = [app.getPath('userData'), dirname(app.getPath('exe'))]
  if (IS_MAC) keep.push(app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, ''))
  const vault = loadSettings().vaultPath
  if (vault) keep.push(vault)
  for (const other of apps.values()) if (other.id !== except.id && other.location) keep.push(other.location)
  return keep
}

const isShortcut = (name: string): boolean => /\.(lnk|url)$/i.test(name)

async function sizeOf(path: string, isDir: boolean): Promise<number | undefined> {
  if (!isDir) return (await lstat(path).catch(() => null))?.size
  const started = Date.now()
  const size = await countFolder(path, { cancelled: () => Date.now() - started > 8000 }).catch(() => null)
  return size?.bytes
}

/** Registry settings under HKEY_CURRENT_USER\Software named after the app (or Publisher\App). */
async function registryLeftovers(keys: string[], pubKeys: string[]): Promise<string[]> {
  const query = async (key: string): Promise<string[]> => {
    try {
      const { stdout } = await run('reg.exe', ['query', key], { windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 })
      return parseRegQuery(stdout, key)
    } catch {
      return []
    }
  }
  const found: string[] = []
  for (const sub of await query('HKEY_CURRENT_USER\\Software')) {
    const name = sub.slice(sub.lastIndexOf('\\') + 1)
    const m = matchName(name, keys, pubKeys)
    if (m === 'app') found.push(sub)
    else if (m === 'publisher') for (const inner of await query(sub)) if (matchName(inner.slice(inner.lastIndexOf('\\') + 1), keys) === 'app') found.push(inner)
  }
  return found.filter(isSafeRegistryKey)
}

async function isRunning(target: InstalledApp): Promise<boolean> {
  if (!IS_MAC || !target.location) return false
  try {
    const { stdout } = await run('ps', ['-axo', 'comm='], { maxBuffer: 16 * 1024 * 1024 })
    return runningFrom(stdout, target.location)
  } catch {
    return false
  }
}

export async function findLeftovers(id: string): Promise<LeftoverScan> {
  const target = apps.get(id)
  if (!target) throw new Error('That app isn’t in the list any more. Look again.')
  const { places, keep } = IS_WIN ? windowsPlaces() : macPlaces()
  const appRoots = IS_MAC ? ['/Applications', join(homedir(), 'Applications')] : []
  const rules: SafeRules = { roots: [...places.map((p) => p.dir), ...appRoots], keep: [...keep, ...alwaysKeep(target)] }

  let extra: string[] = []
  if (IS_MAC && target.location) {
    // Its program's name too: some keep their files under that ("Code" for Visual Studio Code).
    const exe = await run('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(target.location, 'Contents', 'Info.plist')]).catch(() => null)
    if (exe?.stdout.trim()) extra = [exe.stdout.trim()]
  }
  const keys = appKeys(target, extra)
  const pubKeys = IS_WIN ? publisherKeys(target.publisher).filter((k) => !keys.includes(k)) : []
  const bundleId = IS_MAC ? target.bundleId : undefined

  const found: { path: string; kind: LeftoverKind; where: string; isDir: boolean }[] = []
  const add = (path: string, kind: LeftoverKind, where: string, isDir: boolean): void => {
    if (isSafeLeftover(path, rules) && !found.some((f) => pathKey(f.path) === pathKey(path))) found.push({ path, kind, where, isDir })
  }

  // The app itself (Mac), and the folder a Windows app said it was installed in, if it's still there.
  if (IS_MAC && target.location && existsSync(target.location)) add(target.location, 'app', 'The app', true)
  if (IS_WIN && target.location && ownFolder(target.name, target.location) && existsSync(target.location)) add(target.location, 'folder', 'Install folder', true)

  for (const place of places) {
    const entries = await readdir(place.dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const path = join(place.dir, e.name)
      const dir = e.isDirectory()
      if (place.shortcuts === 'files' && (dir || !isShortcut(e.name))) continue
      if (place.shortcuts === 'files-and-folders' && !dir && !isShortcut(e.name)) continue
      const m = matchName(e.name, keys, pubKeys, bundleId)
      if (m === 'app') add(path, place.shortcuts && !dir ? 'shortcut' : dir ? 'folder' : 'file', place.where, dir)
      else if (m === 'publisher' && dir) {
        // The company's folder: only the app's own folder inside it, never the company's.
        for (const inner of await readdir(path, { withFileTypes: true }).catch(() => [])) {
          if (inner.isSymbolicLink()) continue
          const innerDir = inner.isDirectory()
          if (place.shortcuts && !innerDir && !isShortcut(inner.name)) continue
          if (matchName(inner.name, keys, [], bundleId) === 'app') add(join(path, inner.name), place.shortcuts && !innerDir ? 'shortcut' : innerDir ? 'folder' : 'file', place.where, innerDir)
        }
      }
    }
  }

  // Something inside another found folder goes with it.
  const outer = found.filter((f) => !found.some((g) => g !== f && isInside(f.path, g.path)))
  const items: Leftover[] = await eachLimited(outer, 4, async (f) => ({
    id: '',
    path: f.path,
    kind: f.kind,
    where: f.where,
    size: await sizeOf(f.path, f.isDir)
  }))
  if (IS_WIN) for (const key of await registryLeftovers(keys, pubKeys)) items.push({ id: '', path: key, kind: 'registry', where: 'Settings in the registry' })
  items.forEach((item, i) => (item.id = String(i)))

  const scan: LeftoverScan = { scanId: String(nextScan++), app: target, items, running: await isRunning(target) }
  scans.set(scan.scanId, { scan, rules })
  // Only the last few lists are kept.
  for (const old of [...scans.keys()].slice(0, -5)) scans.delete(old)
  return scan
}

// ---------------------------------------------------------------------------------------------
// Removing

const safeFileName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').trim().slice(0, 80) || 'app'
const stamp = (): string => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')

export async function removeLeftovers(scanId: string, ids: string[]): Promise<RemoveResult> {
  const saved = scans.get(scanId)
  if (!saved) throw new Error('That list is out of date. Look for leftovers again.')
  const { scan, rules } = saved
  const wanted = new Set(ids)
  const chosen = scan.items.filter((i) => wanted.has(i.id))
  const result: RemoveResult = { removed: 0, failed: [] }
  const appItem = chosen.find((i) => i.kind === 'app')
  if (appItem && (await isRunning(scan.app))) {
    result.failed.push(`${scan.app.name} is open. Quit it first, then try again.`)
    return result
  }
  // The app first: if it can't go, its files stay too (it would still be using them).
  const ordered = [...chosen].sort((a, b) => Number(b.kind === 'app') - Number(a.kind === 'app'))
  let backupDir: string | null = null
  for (const item of ordered) {
    if (item.kind === 'registry') {
      if (!isSafeRegistryKey(item.path)) {
        result.failed.push(`${item.path}: left alone (not one of this app’s own settings).`)
        continue
      }
      try {
        if (!backupDir) {
          backupDir = join(app.getPath('userData'), 'Uninstaller backups', `${safeFileName(scan.app.name)} ${stamp()}`)
          await mkdir(backupDir, { recursive: true })
          result.backup = backupDir
        }
        const file = join(backupDir, `${safeFileName(item.path.slice(item.path.indexOf('\\Software\\') + 10))}.reg`)
        await run('reg.exe', ['export', item.path, file, '/y'], { windowsHide: true, timeout: 30_000 })
        await run('reg.exe', ['delete', item.path, '/f'], { windowsHide: true, timeout: 30_000 })
        result.removed++
      } catch (err) {
        result.failed.push(`${item.path}: ${(err as Error).message ?? err}`)
      }
      continue
    }
    // Checked again now, in case anything changed since the list was made.
    const st = await lstat(item.path).catch(() => null)
    if (!st) continue // Already gone (the uninstaller may have got there first).
    if (st.isSymbolicLink() || !isSafeLeftover(item.path, rules)) {
      result.failed.push(`${item.path}: left alone (not somewhere Orbit removes things from).`)
      continue
    }
    try {
      await shell.trashItem(item.path)
      result.removed++
    } catch (err) {
      const why = String((err as Error).message ?? err)
      const admin = /denied|permission|EPERM|EACCES/i.test(why)
      result.failed.push(
        `${item.path}: ${admin ? (IS_WIN ? 'Windows needs administrator rights to move it.' : 'macOS didn’t let Orbit move it (try dragging it to the Bin in Finder).') : why}`
      )
      if (item.kind === 'app') {
        result.failed.push('Its files were left alone because the app itself is still there.')
        return result
      }
    }
  }
  scans.delete(scanId)
  return result
}

/** Mac: asks an open app to quit (it can still ask to save first). */
export async function quitApp(id: string): Promise<boolean> {
  const target = apps.get(id)
  if (!IS_MAC || !target?.bundleId || !/^[\w.-]+$/.test(target.bundleId)) return false
  try {
    await run('osascript', ['-e', `tell application id "${target.bundleId}" to quit`], { timeout: 30_000 })
  } catch {
    return false
  }
  return !(await isRunning(target))
}

export function setupUninstaller(): void {
  ipcMain.handle('uninstall:list', () => listApps())
  ipcMain.handle('uninstall:run', (_e, id: string) => runUninstaller(String(id)))
  ipcMain.handle('uninstall:gone', (_e, id: string) => (apps.has(String(id)) ? isGone(String(id)) : false))
  ipcMain.handle('uninstall:scan', (_e, id: string) => findLeftovers(String(id)))
  ipcMain.handle('uninstall:remove', (_e, scanId: string, ids: string[]) => removeLeftovers(String(scanId), Array.isArray(ids) ? ids.map(String).slice(0, 1000) : []))
  ipcMain.handle('uninstall:quit', (_e, id: string) => quitApp(String(id)))
  ipcMain.handle('uninstall:reveal', (_e, path: string) => {
    // Only something from a list the page was shown.
    for (const { scan } of scans.values())
      if (scan.items.some((i) => i.path === path && i.kind !== 'registry')) {
        shell.showItemInFolder(path)
        return true
      }
    return false
  })
}
