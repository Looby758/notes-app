import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { IS_MAC, SYSTEM_NAME } from '@shared/platform'
import { hotkeyLabel, normalizeAccelerator } from '@shared/soundboard'
import {
  cleanSaved,
  clampLevel,
  defaultHotkeys,
  inputChoices,
  inputName,
  inputFromReply,
  nextLevel,
  parseCapabilities,
  parseM1ddcList,
  parseNumber,
  VCP,
  type Capabilities,
  type Level,
  type Monitor,
  type MonitorAction,
  type MonitorInfoState,
  type MonitorSaved,
  type MonitorSetting,
  type MonitorsStatus,
  type MonitorTarget
} from '@shared/monitors'
import { logError } from './log'

/**
 * Screen controls: brightness, contrast and input switching, sent down the cable over DDC/CI so
 * it's the monitor's own setting that changes (like its buttons), not a dimmed picture. Nothing is
 * installed on Windows: a PowerShell helper calls dxva2 (the Windows monitor API) and stays running
 * while Orbit is open. On a Mac it uses the free m1ddc tool (brew install m1ddc), when it's there.
 * Hotkeys work system-wide, in games too.
 */

const WIN_HELPER = String.raw`
$src = @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class OrbitDdc {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct PHYSICAL_MONITOR { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct MONITORINFOEX { public int cbSize; public RECT mon; public RECT work; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string device; }
  public delegate bool EnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, EnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX info);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint n, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitor(IntPtr h);
  [DllImport("dxva2.dll")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, out uint type, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint value);
  [DllImport("dxva2.dll")] static extern bool GetCapabilitiesStringLength(IntPtr h, out uint len);
  [DllImport("dxva2.dll")] static extern bool CapabilitiesRequestAndCapabilitiesReply(IntPtr h, [Out] byte[] buf, uint len);
  static List<IntPtr> handles = new List<IntPtr>();
  static string Esc(string s) { var b = new StringBuilder(); foreach (char c in s ?? "") { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < ' ') b.Append(' '); else b.Append(c); } return b.ToString(); }
  public static string Scan() {
    foreach (var h in handles) DestroyPhysicalMonitor(h);
    handles.Clear();
    var items = new List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data) {
      var info = new MONITORINFOEX(); info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      GetMonitorInfo(hMon, ref info);
      uint n;
      if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out n) || n == 0) return true;
      var arr = new PHYSICAL_MONITOR[n];
      if (!GetPhysicalMonitorsFromHMONITOR(hMon, n, arr)) return true;
      for (int i = 0; i < n; i++) {
        handles.Add(arr[i].h);
        items.Add("{\"index\":" + (handles.Count - 1) + ",\"device\":\"" + Esc(info.device) + "\",\"sub\":" + i + ",\"desc\":\"" + Esc(arr[i].desc) + "\",\"primary\":" + ((info.flags & 1) != 0 ? "true" : "false") + ",\"x\":" + info.mon.l + "}");
      }
      return true;
    }, IntPtr.Zero);
    return "[" + string.Join(",", items) + "]";
  }
  static bool Ok(int i) { return i >= 0 && i < handles.Count; }
  public static string Get(int i, byte code) {
    uint type, cur, max;
    if (!Ok(i) || !GetVCPFeatureAndVCPFeatureReply(handles[i], code, out type, out cur, out max)) return "{\"ok\":false}";
    return "{\"ok\":true,\"value\":" + cur + ",\"max\":" + max + "}";
  }
  public static string Set(int i, byte code, uint value) {
    return "{\"ok\":" + (Ok(i) && SetVCPFeature(handles[i], code, value) ? "true" : "false") + "}";
  }
  public static string Caps(int i) {
    uint len;
    if (!Ok(i) || !GetCapabilitiesStringLength(handles[i], out len) || len == 0) return "{\"ok\":false}";
    var buf = new byte[len];
    if (!CapabilitiesRequestAndCapabilitiesReply(handles[i], buf, len)) return "{\"ok\":false}";
    return "{\"ok\":true,\"caps\":\"" + Esc(Encoding.ASCII.GetString(buf).TrimEnd('\0')) + "\"}";
  }
}
'@
Add-Type -TypeDefinition $src
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  $out = '{"ok":false}'
  try {
    switch ($p[1]) {
      'scan' { $out = [OrbitDdc]::Scan() }
      'get' { $out = [OrbitDdc]::Get([int]$p[2], [byte]$p[3]) }
      'set' { $out = [OrbitDdc]::Set([int]$p[2], [byte]$p[3], [uint32]$p[4]) }
      'caps' { $out = [OrbitDdc]::Caps([int]$p[2]) }
    }
  } catch { }
  [Console]::Out.WriteLine($p[0] + ' ' + $out)
  [Console]::Out.Flush()
}
`

// ---------------------------------------------------------------------------------------------
// Talking to the screens

interface Screen {
  id: string
  name: string
  primary: boolean
  /** Windows: the helper's handle number. Mac: m1ddc's display number. */
  handle: number
}

let helper: ChildProcessWithoutNullStreams | null = null
let nextRequest = 1
const waiting = new Map<number, (text: string) => void>()

function startHelper(): ChildProcessWithoutNullStreams {
  const child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')], {
    windowsHide: true
  })
  let buffer = ''
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString('utf8')
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      const space = line.indexOf(' ')
      const done = waiting.get(Number(line.slice(0, space)))
      if (done) {
        waiting.delete(Number(line.slice(0, space)))
        done(line.slice(space + 1))
      }
    }
  })
  child.stderr.on('data', (d: Buffer) => logError('screen controls', new Error(d.toString().trim())))
  child.on('error', (err) => logError('screen controls', err))
  child.on('exit', () => {
    if (helper === child) helper = null
    for (const done of waiting.values()) done('{"ok":false}')
    waiting.clear()
  })
  return child
}

/** One request to the Windows helper; resolves to its JSON reply, or null. */
function ask<T>(command: string, timeout = 8000): Promise<T | null> {
  helper ??= startHelper()
  const id = nextRequest++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(null)
    }, timeout)
    waiting.set(id, (text) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(text) as T)
      } catch {
        resolve(null)
      }
    })
    helper!.stdin.write(`${id} ${command}\n`)
  })
}

const run = promisify(execFile)
const M1DDC_PLACES = ['/opt/homebrew/bin/m1ddc', '/usr/local/bin/m1ddc']
const m1ddc = (): string | null => M1DDC_PLACES.find((p) => existsSync(p)) ?? null

async function m1(args: string[]): Promise<string | null> {
  const tool = m1ddc()
  if (!tool) return null
  try {
    return (await run(tool, args, { timeout: 8000 })).stdout
  } catch {
    return null
  }
}

const M1_NAMES: Record<MonitorSetting, string> = { brightness: 'luminance', contrast: 'contrast', input: 'input' }

async function readSetting(s: Screen, setting: MonitorSetting): Promise<Level | null> {
  if (IS_MAC) {
    const [value, max] = await Promise.all([m1(['display', String(s.handle), 'get', M1_NAMES[setting]]), setting === 'input' ? '255' : m1(['display', String(s.handle), 'max', M1_NAMES[setting]])])
    const v = value === null ? null : parseNumber(value)
    if (v === null) return null
    return { value: v, max: (max && parseNumber(max)) || 100 }
  }
  const r = await ask<{ ok: boolean; value?: number; max?: number }>(`get ${s.handle} ${VCP[setting]}`)
  return r?.ok ? { value: r.value ?? 0, max: r.max ?? 100 } : null
}

async function writeSetting(s: Screen, setting: MonitorSetting, value: number): Promise<boolean> {
  if (IS_MAC) return (await m1(['display', String(s.handle), 'set', M1_NAMES[setting], String(value)])) !== null
  return (await ask<{ ok: boolean }>(`set ${s.handle} ${VCP[setting]} ${value}`))?.ok === true
}

// ---------------------------------------------------------------------------------------------
// What's plugged in

let screens: Screen[] = []
let state: MonitorInfoState = { list: [] }
const capsCache = new Map<string, Capabilities | null>()
/** The latest levels we know, so hotkeys don't have to ask the screen first. */
const levels = new Map<string, Level>()

async function findScreens(): Promise<{ screens: Screen[]; problem?: string; fix?: string }> {
  if (IS_MAC) {
    if (!m1ddc()) {
      return {
        screens: [],
        problem: 'On a Mac, Orbit uses the free m1ddc tool to talk to monitors. Install it with Homebrew, then press Look again.',
        fix: 'brew install m1ddc'
      }
    }
    const list = parseM1ddcList((await m1(['display', 'list'])) ?? '')
    return { screens: list.map((d, i) => ({ id: d.uuid ? `mac:${d.uuid}` : `mac:${d.index}`, name: d.name, primary: i === 0, handle: d.index })) }
  }
  if (process.platform !== 'win32') return { screens: [], problem: 'Screen controls work on Windows and on a Mac.' }
  const list = await ask<{ index: number; device: string; sub: number; desc: string; primary: boolean; x: number }[]>('scan', 15000)
  if (!list) return { screens: [], problem: 'Windows didn’t answer about your screens. Press Look again.' }
  return {
    screens: [...list]
      .sort((a, b) => a.x - b.x)
      .map((m) => ({ id: `${m.device.replace(/^\\\\\.\\/, '')}:${m.sub}`, name: m.desc, primary: m.primary, handle: m.index }))
  }
}

async function capabilities(s: Screen): Promise<Capabilities | null> {
  if (capsCache.has(s.id)) return capsCache.get(s.id) ?? null
  let caps: Capabilities | null = null
  if (!IS_MAC) {
    const r = await ask<{ ok: boolean; caps?: string }>(`caps ${s.handle}`, 12000)
    if (r?.ok && r.caps) caps = parseCapabilities(r.caps)
  }
  capsCache.set(s.id, caps)
  return caps
}

const keyOf = (id: string, setting: MonitorSetting): string => `${id}|${setting}`

async function describe(s: Screen): Promise<Monitor> {
  const caps = await capabilities(s)
  const brightness = await readSetting(s, 'brightness')
  const contrast = await readSetting(s, 'contrast')
  const inputLevel = await readSetting(s, 'input')
  if (brightness) levels.set(keyOf(s.id, 'brightness'), brightness)
  if (contrast) levels.set(keyOf(s.id, 'contrast'), contrast)
  const input = inputLevel ? inputFromReply(inputLevel.value) || null : null
  const generic = /^(generic|standard|default)\b/i.test(s.name) || !s.name.trim()
  return {
    id: s.id,
    name: saved.names[s.id] || (generic ? caps?.model : s.name) || caps?.model || s.name || 'Screen',
    primary: s.primary,
    controllable: !!(brightness || contrast || inputLevel || caps),
    brightness,
    contrast,
    input,
    inputs: inputChoices(caps, input, saved.inputNames[s.id])
  }
}

let scanning: Promise<MonitorInfoState> | null = null

/** Looks for screens again and reads their settings. */
function rescan(): Promise<MonitorInfoState> {
  scanning ??= (async () => {
    try {
      const found = await findScreens()
      screens = found.screens
      const list: Monitor[] = []
      for (const s of screens) list.push(await describe(s))
      state = { list, problem: found.problem, fix: found.fix }
      if (!found.problem && list.length > 0 && !list.some((m) => m.controllable)) {
        state.problem = 'None of your screens answered. Turn on DDC/CI in the monitor’s own menu (often under Other or System), then press Look again. Laptop screens and some TVs can’t be controlled this way.'
      }
    } catch (err) {
      logError('screen controls', err)
      state = { list: [], problem: 'Couldn’t read your screens.' }
    } finally {
      scanning = null
    }
    broadcast()
    return state
  })()
  return scanning
}

/** Changes one setting; quick slider drags are merged so only the latest value is sent. */
const pending = new Map<string, number>()
const busy = new Set<string>()

async function apply(id: string, setting: MonitorSetting, value: number): Promise<boolean> {
  const s = screens.find((x) => x.id === id)
  if (!s) return false
  const key = keyOf(id, setting)
  pending.set(key, value)
  if (busy.has(key)) return true
  busy.add(key)
  let ok = true
  try {
    while (pending.has(key)) {
      const v = pending.get(key)!
      pending.delete(key)
      ok = await writeSetting(s, setting, v)
      const m = state.list.find((x) => x.id === id)
      if (ok && m) {
        if (setting === 'input') m.input = v
        else {
          const level = { value: v, max: levels.get(key)?.max ?? m[setting]?.max ?? 100 }
          levels.set(key, level)
          m[setting] = level
        }
      }
    }
  } finally {
    busy.delete(key)
  }
  broadcast()
  return ok
}

async function runAction(target: MonitorTarget, action: MonitorAction): Promise<void> {
  if (screens.length === 0) await rescan()
  const ids = target === 'all' ? state.list.filter((m) => m.controllable).map((m) => m.id) : [target]
  await Promise.all(
    ids.map(async (id) => {
      if (action.kind === 'input') return apply(id, 'input', action.value)
      let level = levels.get(keyOf(id, action.kind))
      if (!level) {
        const s = screens.find((x) => x.id === id)
        level = (s && (await readSetting(s, action.kind))) || undefined
        if (!level) return
      }
      return apply(id, action.kind, nextLevel(level, action.mode, action.amount))
    })
  )
}

// ---------------------------------------------------------------------------------------------
// Your names and hotkeys

const savedFile = (): string => join(app.getPath('userData'), 'monitors.json')
let saved: MonitorSaved = { names: {}, inputNames: {}, hotkeys: [] }

function load(): void {
  try {
    saved = existsSync(savedFile()) ? cleanSaved(JSON.parse(readFileSync(savedFile(), 'utf8'))) : { names: {}, inputNames: {}, hotkeys: defaultHotkeys() }
  } catch {
    saved = { names: {}, inputNames: {}, hotkeys: defaultHotkeys() }
  }
}

function save(): void {
  const tmp = `${savedFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(saved, null, 2), 'utf8')
  renameSync(tmp, savedFile())
}

const registered = new Map<string, string>()
const hotkeyErrors: Record<string, string> = {}

function applyHotkeys(): void {
  for (const accel of registered.keys()) globalShortcut.unregister(accel)
  registered.clear()
  for (const k of Object.keys(hotkeyErrors)) delete hotkeyErrors[k]
  for (const h of saved.hotkeys) {
    const accel = normalizeAccelerator(h.keys)
    if (!accel) continue
    if (registered.has(accel)) {
      hotkeyErrors[h.id] = `${hotkeyLabel(accel)} is already used by another screen hotkey.`
      continue
    }
    try {
      const fire = (): void => {
        const now = saved.hotkeys.find((x) => x.id === registered.get(accel))
        if (now) void runAction(now.monitor, now.action).catch((err) => logError('screen hotkey', err))
      }
      if (globalShortcut.register(accel, fire)) registered.set(accel, h.id)
      else hotkeyErrors[h.id] = `${hotkeyLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick different keys.`
    } catch {
      hotkeyErrors[h.id] = `${hotkeyLabel(accel)} can’t be used as a hotkey.`
    }
  }
}

const status = (): MonitorsStatus => ({ monitors: state, saved, hotkeyErrors: { ...hotkeyErrors } })

function broadcast(): void {
  const s = status()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('monitors:changed', s)
}

function changedSaved(next: unknown): MonitorsStatus {
  saved = cleanSaved(next)
  save()
  applyHotkeys()
  // Names show in the list, so put them in straight away.
  for (const m of state.list) {
    const s = screens.find((x) => x.id === m.id)
    if (saved.names[m.id]) m.name = saved.names[m.id]
    else if (s) m.name = s.name
    m.inputs = m.inputs.map((i) => ({ ...i, label: saved.inputNames[m.id]?.[String(i.value)] || inputName(i.value) }))
  }
  broadcast()
  return status()
}

export function setupMonitors(): void {
  load()
  applyHotkeys()
  ipcMain.handle('monitors:get', async () => {
    if (screens.length === 0 && !state.problem) await rescan()
    return status()
  })
  ipcMain.handle('monitors:rescan', async () => {
    capsCache.clear()
    await rescan()
    return status()
  })
  ipcMain.handle('monitors:set', (_e, id: string, setting: MonitorSetting, value: number) => {
    if (!(setting in VCP)) return false
    const max = setting === 'input' ? 255 : (levels.get(keyOf(String(id), setting))?.max ?? 100)
    return apply(String(id), setting, clampLevel(value, max))
  })
  ipcMain.handle('monitors:action', (_e, target: MonitorTarget, action: MonitorAction) => {
    const clean = cleanSaved({ hotkeys: [{ id: 'x', keys: '', monitor: target, action }] }).hotkeys[0]
    return clean ? runAction(clean.monitor, clean.action) : undefined
  })
  ipcMain.handle('monitors:save', (_e, next: MonitorSaved) => changedSaved(next))
  // A screen plugged in or out: look again once we've looked at all (so nothing starts until it's used).
  let timer: ReturnType<typeof setTimeout> | undefined
  const replugged = (): void => {
    if (!helper && !IS_MAC) return
    clearTimeout(timer)
    timer = setTimeout(() => void rescan(), 2000)
  }
  screen.on('display-added', replugged)
  screen.on('display-removed', replugged)
}

export function teardownMonitors(): void {
  helper?.kill()
  helper = null
}
