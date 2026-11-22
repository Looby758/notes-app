import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  activeRules,
  appName,
  cleanRemaps,
  cleanRule,
  emptyRemaps,
  EVERYWHERE_ID,
  hidutilArg,
  macPlan,
  remapKeyLabel,
  RULE_LIMIT,
  SET_LIMIT,
  windowsRemapLines,
  winKeyId,
  type FrontApp,
  type RemapData,
  type RemapRule,
  type RemapSet,
  type RemapStatus
} from '@shared/keyRemap'
import { acceleratorCodes } from '@shared/macros'
import { hotkeyLabel, normalizeAccelerator } from '@shared/soundboard'
import { IS_MAC, SYSTEM_NAME } from '@shared/platform'
import { logError } from './log'
import { accessibilityHelp, inputAllowed } from './shareInput'

/**
 * The key remapper (main-process side). The remapping itself is done by a helper process, so it's
 * there the moment you press a key, in games too:
 *
 * - Windows: a PowerShell helper with a small C# program, like the macro recorder's. It watches the
 *   keyboard with the system's low-level keyboard hook, holds back a remapped key and presses what
 *   it's remapped to instead (by scan code, which games read). It knows which program is in front
 *   itself, so a game's remaps start the moment you switch to it. Only your real keyboard is
 *   remapped: keys other programs press (and Orbit's macros) are left alone.
 * - Mac: macOS's own key remapping (hidutil), which needs no permission, swapped by Orbit when you
 *   change app. A remap to a shortcut borrows a spare key (F13–F20), and a small helper presses the
 *   shortcut when it sees that key (that part needs Accessibility, like macros).
 *
 * Orbit never turns remaps off by itself for any game or server: only you do (the switch on the
 * page, or your own hotkey).
 */

const SUPPORTED = process.platform === 'win32' || process.platform === 'darwin'

const folder = (): string => join(app.getPath('userData'), 'keyremap')
const dataFile = (): string => join(folder(), 'remaps.json')
/** Mac: marks that Orbit set a hidutil remapping, so it's cleared even after a crash. */
const macMarker = (): string => join(folder(), 'hidutil-set')

let data: RemapData = emptyRemaps()
let front: FrontApp | null = null
let recent: FrontApp[] = []
let hotkeyError: string | null = null
let helperError: string | null = null
/** While the page is picking a key, remaps pause so you can press the real key. */
let holding = false
let holdTimer: NodeJS.Timeout | null = null

function load(): void {
  try {
    data = cleanRemaps(JSON.parse(readFileSync(dataFile(), 'utf8')))
  } catch {
    data = emptyRemaps()
  }
}

function save(): void {
  mkdirSync(folder(), { recursive: true })
  const tmp = `${dataFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, dataFile())
}

const hasRules = (): boolean => data.sets.some((s) => s.rules.length > 0)

function problem(): string | null {
  if (!SUPPORTED) return 'The key remapper works on Windows and on a Mac.'
  return null
}

function notes(): string[] {
  const out: string[] = []
  if (helperError) out.push(helperError)
  if (hotkeyError) out.push(hotkeyError)
  if (data.toggleHotkey) {
    // On Windows a remapped key never reaches the hotkey, so the hotkey would never fire.
    const { key } = acceleratorCodes(data.toggleHotkey)
    if (key && !IS_MAC && activeRules(data, front).has(key)) out.push(`${hotkeyLabel(data.toggleHotkey)} uses a key you’ve remapped, so it may not work while remaps are on. Pick a different hotkey.`)
  }
  if (IS_MAC) {
    const rules = activeRules(data, front)
    const shortcuts = [...rules.values()].some((t) => t.kind === 'shortcut')
    if (shortcuts && !inputAllowed(false)) out.push(`Remaps to a shortcut need Orbit allowed under Accessibility. ${accessibilityHelp()}`)
    const skipped = macPlan(rules).skipped
    if (skipped.length)
      out.push(`A Mac can do up to 8 remaps to a shortcut at once. These don’t work right now: ${skipped.map((c) => remapKeyLabel(c, 'mac')).join(', ')}.`)
  }
  return out
}

function status(): RemapStatus {
  return {
    data,
    front,
    recentApps: recent,
    problem: problem(),
    notes: notes(),
    running: !!(winHelper || macRun)
  }
}

function broadcast(): void {
  const s = status()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('keyremap:changed', s)
}

/** Others that want to know when the remaps that apply change (the macro recorder). */
const listeners = new Set<() => void>()
export function onRemapsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Windows: the keys (as the helper numbers them) that are remapped right now. The macro recorder
 * skips these from your real keyboard and records what they were remapped to instead.
 */
export function remappedKeyIds(): number[] {
  if (IS_MAC || holding) return []
  const out: number[] = []
  for (const code of activeRules(data, front).keys()) {
    const id = winKeyId(code)
    if (id !== null) out.push(id)
  }
  return out
}

function changed(): RemapStatus {
  save()
  apply()
  broadcast()
  return status()
}

// ---------- Windows helper ----------

const WIN_HELPER = String.raw`
$src = @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class OrbitRemap {
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct KBDLL { public uint vk, scan, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p, uint flags, StringBuilder name, ref uint size);

  // Marks Orbit's own key presses, so the macro recorder can tell them from other programs'.
  static readonly IntPtr Mark = new IntPtr(0x4F524254);

  static readonly BlockingCollection<string> outbox = new BlockingCollection<string>();
  static void Say(string s) { outbox.Add(s); }
  static void Writer() {
    var o = Console.Out;
    foreach (var line in outbox.GetConsumingEnumerable()) { o.WriteLine(line); if (outbox.Count == 0) o.Flush(); }
  }

  // kind 0: nothing, 1: a key, 2: a shortcut (modifiers, then the key).
  class Target { public int kind; public ushort[] vk; public bool[] ext; }
  class Active { public Target t; public List<int> pressed = new List<int>(); }

  static volatile Dictionary<string, Dictionary<uint, Target>> tables = new Dictionary<string, Dictionary<uint, Target>>();
  static Dictionary<string, Dictionary<uint, Target>> building;
  static volatile bool hold;
  static readonly Dictionary<uint, Active> downWith = new Dictionary<uint, Active>();
  static readonly HashSet<uint> physDown = new HashSet<uint>();
  static readonly HashSet<uint> sentDown = new HashSet<uint>();
  static readonly HookProc proc = Proc;

  public static void Init() {
    var w = new Thread(Writer); w.IsBackground = true; w.Start();
    foreach (var name in new string[] { "Proc", "Press", "Release", "Key", "Front" }) {
      var m = typeof(OrbitRemap).GetMethod(name, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
      if (m != null) System.Runtime.CompilerServices.RuntimeHelpers.PrepareMethod(m.MethodHandle);
    }
    var hook = new Thread(() => {
      try {
        IntPtr h = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);
        if (h == IntPtr.Zero) { Say("err Windows wouldn't let Orbit watch the keyboard (" + Marshal.GetLastWin32Error() + ")."); return; }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
      } catch (Exception e) { Say("err " + e.Message); }
    });
    hook.IsBackground = true; hook.Priority = ThreadPriority.Highest; hook.Start();
    var watch = new Thread(() => {
      string told = null;
      for (;;) {
        try { string now = Front(); if (now != told) { told = now; Say("app " + now); } } catch { }
        Thread.Sleep(300);
      }
    });
    watch.IsBackground = true; watch.Start();
    Say("ready");
  }

  public static void Command(string line) {
    string[] p = line.Split(' ');
    switch (p[0]) {
      case "begin": building = new Dictionary<string, Dictionary<uint, Target>>(); break;
      case "t": if (building != null && p.Length > 1) building[Uri.UnescapeDataString(p[1])] = new Dictionary<uint, Target>(); break;
      case "r": {
        if (building == null || p.Length < 4) break;
        Dictionary<uint, Target> table;
        if (!building.TryGetValue(Uri.UnescapeDataString(p[1]), out table)) break;
        uint id; if (!uint.TryParse(p[2], out id)) break;
        var t = new Target();
        t.kind = p[3] == "k" ? 1 : p[3] == "s" ? 2 : 0;
        int n = p.Length - 4;
        t.vk = new ushort[n]; t.ext = new bool[n];
        for (int i = 0; i < n; i++) { var kv = p[4 + i].Split('.'); t.vk[i] = ushort.Parse(kv[0]); t.ext[i] = kv.Length > 1 && kv[1] == "1"; }
        if (t.kind != 0 && n == 0) break;
        table[id] = t;
        break;
      }
      case "commit": if (building != null) { tables = building; building = null; } Say("applied"); break;
      case "hold": hold = p.Length > 1 && p[1] == "1"; break;
    }
  }

  // ---------- Which program is in front ----------
  static readonly object frontLock = new object();
  static IntPtr frontHwnd = IntPtr.Zero;
  static uint frontPid;
  static string frontName = "";

  static string Front() {
    IntPtr h = GetForegroundWindow();
    lock (frontLock) {
      if (h != frontHwnd) {
        frontHwnd = h;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid != frontPid) { frontPid = pid; frontName = NameOf(pid); }
      }
      return frontName;
    }
  }

  static string NameOf(uint pid) {
    if (pid == 0) return "";
    // Query-limited-information works for most programs, even ones running as administrator.
    IntPtr p = OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(1024); uint size = (uint)sb.Capacity;
      return QueryFullProcessImageName(p, 0, sb, ref size) ? Path.GetFileNameWithoutExtension(sb.ToString()) : "";
    } finally { CloseHandle(p); }
  }

  // ---------- The keyboard ----------
  static IntPtr Proc(int code, IntPtr w, IntPtr l) {
    if (code < 0) return CallNextHookEx(IntPtr.Zero, code, w, l);
    var k = (KBDLL)Marshal.PtrToStructure(l, typeof(KBDLL));
    // 0x10: pressed by a program (Orbit itself, a macro, another app), not by you: left alone.
    if ((k.flags & 0x10) != 0) return CallNextHookEx(IntPtr.Zero, code, w, l);
    bool up = (k.flags & 0x80) != 0, ext = (k.flags & 1) != 0;
    uint id = k.vk | (ext ? 0x100u : 0u);
    if (up) physDown.Remove(k.vk);
    Active a;
    // A key keeps what it was remapped to until it comes up, even if you change window or switch remaps off meanwhile.
    if (downWith.TryGetValue(id, out a)) {
      if (up) { downWith.Remove(id); Release(a); } else Repeat(a);
      return new IntPtr(1);
    }
    if (!up && !hold) {
      var all = tables;
      Dictionary<uint, Target> table;
      Target t;
      if ((all.TryGetValue(Front().ToLowerInvariant(), out table) || all.TryGetValue("*", out table)) && table.TryGetValue(id, out t)) {
        a = new Active(); a.t = t; downWith[id] = a; Press(a);
        return new IntPtr(1);
      }
    }
    if (!up) physDown.Add(k.vk);
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static bool ModDown(ushort vk) {
    uint other = vk == 0xA2 ? 0xA3u : vk == 0xA0 ? 0xA1u : vk == 0xA4 ? 0xA5u : vk == 0x5B ? 0x5Cu : vk;
    return physDown.Contains(vk) || physDown.Contains(other) || sentDown.Contains(vk) || sentDown.Contains(other);
  }

  static void Press(Active a) {
    var t = a.t;
    if (t.kind == 0) return;
    int last = t.vk.Length - 1;
    if (t.kind == 2) {
      // A modifier you're already holding stays as it is (and isn't let go of afterwards).
      for (int i = 0; i < last; i++) if (!ModDown(t.vk[i])) { Key(t.vk[i], t.ext[i], false); a.pressed.Add(i); }
    }
    Key(t.vk[last], t.ext[last], false);
  }

  static void Repeat(Active a) {
    var t = a.t;
    if (t.kind == 0) return;
    int last = t.vk.Length - 1;
    Key(t.vk[last], t.ext[last], false);
  }

  static void Release(Active a) {
    var t = a.t;
    if (t.kind == 0) return;
    int last = t.vk.Length - 1;
    Key(t.vk[last], t.ext[last], true);
    for (int i = a.pressed.Count - 1; i >= 0; i--) { int j = a.pressed[i]; Key(t.vk[j], t.ext[j], true); }
  }

  public static void Shutdown() {
    tables = new Dictionary<string, Dictionary<uint, Target>>();
    foreach (var a in new List<Active>(downWith.Values)) Release(a);
    downWith.Clear();
  }

  static void Key(ushort vk, bool ext, bool up) {
    uint scan = MapVirtualKey(vk, 0);
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = (ushort)scan; i.u.ki.extra = Mark;
    // By scan code (the physical key), which is what games read.
    i.u.ki.dwFlags = (scan != 0 ? 0x0008u : 0u) | (ext ? 0x0001u : 0u) | (up ? 0x0002u : 0u);
    SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT)));
    if (up) sentDown.Remove(vk); else sentDown.Add(vk);
  }
}
'@
Add-Type -TypeDefinition $src
[OrbitRemap]::Init()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { [OrbitRemap]::Command($line) } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
[OrbitRemap]::Shutdown()
`

let winHelper: ChildProcessWithoutNullStreams | null = null

function readLines(child: ChildProcessWithoutNullStreams, onLine: (line: string) => void): void {
  let buffer = ''
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString()
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onLine(line)
    }
  })
  child.stderr.on('data', (d: Buffer) => logError('key remapper', new Error(d.toString().trim())))
  child.on('error', (err) => logError('key remapper', err))
  child.stdin.on('error', (err) => logError('key remapper', err))
}

function helperScript(): string {
  const file = join(app.getPath('userData'), 'keyremap-helper.ps1')
  const text = '﻿' + WIN_HELPER
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // Not written yet.
  }
  if (current !== text) writeFileSync(file, text, 'utf8')
  return file
}

/** Crashes in a row: after a few, Orbit stops restarting the helper (and says so) instead of looping. */
let crashes = 0

function startWindows(): void {
  if (winHelper) return
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript()], { windowsHide: true })
  } catch (err) {
    logError('key remapper', err)
    helperError = `Orbit couldn’t start the part that remaps keys (${err instanceof Error ? err.message : String(err)}).`
    return
  }
  readLines(child, onWinLine)
  child.on('exit', () => {
    if (winHelper !== child) return
    winHelper = null
    if (stopping) return
    crashes++
    if (crashes <= 3) setTimeout(() => apply(), 1000 * crashes)
    else helperError = 'The part of Orbit that remaps keys keeps stopping. Restart Orbit to try again.'
    broadcast()
  })
  winHelper = child
  winSend()
}

function winSend(): void {
  if (!winHelper) return
  const lines = [...windowsRemapLines(holding ? { ...data, on: false } : data), `hold ${holding ? 1 : 0}`]
  winHelper.stdin.write(lines.join('\n') + '\n')
}

function onWinLine(line: string): void {
  const [kind, ...rest] = line.split(' ')
  if (kind === 'app') frontChanged({ name: rest.join(' ') })
  else if (kind === 'ready' || kind === 'applied') {
    if (helperError) {
      helperError = null
      broadcast()
    }
    if (kind === 'ready') crashes = 0
  } else if (kind === 'err') {
    helperError = rest.join(' ')
    broadcast()
  }
}

// ---------- Mac helper ----------

/**
 * Mac: reports which app is in front (when it changes), and presses the shortcut for a borrowed
 * spare key. Runs until the stop file appears; reads the spare keys from the config file.
 */
const MAC_HELPER = String.raw`
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')
function run(argv) {
  const configFile = argv[0], stopFile = argv[1]
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  const say = (s) => out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
  const fm = $.NSFileManager.defaultManager
  const ws = $.NSWorkspace.sharedWorkspace
  $.NSApplication.sharedApplication
  let slots = {}, lastConfig = ''
  const readConfig = () => {
    const text = $.NSString.stringWithContentsOfFileEncodingError(configFile, $.NSUTF8StringEncoding, null)
    if (text.isNil()) return
    const js = text.js
    if (js === lastConfig) return
    lastConfig = js
    try { slots = JSON.parse(js).slots || {} } catch (e) { slots = {} }
  }
  const SIDE = { 56: 0x20000, 60: 0x20000, 59: 0x40000, 62: 0x40000, 58: 0x80000, 61: 0x80000, 55: 0x100000, 54: 0x100000 }
  const held = {}
  const flags = () => { let f = 0; for (const k in held) if (held[k] && SIDE[k]) f |= SIDE[k]; return f }
  const key = (code, down, repeat) => {
    if (!repeat) held[code] = down
    const e = $.CGEventCreateKeyboardEvent(null, code, down)
    if (repeat) $.CGEventSetIntegerValueField(e, 8, 1)
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  }
  const active = {}
  const handle = (e) => {
    const type = Number(e.type)
    const code = String(Number(e.keyCode))
    const keys = slots[code]
    if (!keys || !keys.length) return
    const last = keys[keys.length - 1]
    if (type === 10) {
      if (active[code]) { key(last, true, true); return }
      active[code] = true
      for (let i = 0; i < keys.length - 1; i++) key(keys[i], true, false)
      key(last, true, false)
    } else if (type === 11 && active[code]) {
      delete active[code]
      key(last, false, false)
      for (let i = keys.length - 2; i >= 0; i--) key(keys[i], false, false)
    }
  }
  $.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler(Math.pow(2, 10) + Math.pow(2, 11), (e) => { try { handle(e) } catch (err) { say('note ' + err) } })
  let told = null, n = 0
  say('ready')
  while (!fm.fileExistsAtPath(stopFile)) {
    if (n++ % 5 === 0) {
      readConfig()
      const a = ws.frontmostApplication
      if (!a.isNil()) {
        const exe = a.executableURL.isNil() ? '' : a.executableURL.lastPathComponent.js
        const name = a.localizedName.isNil() ? '' : a.localizedName.js
        const now = exe + '\t' + name
        if (now !== told) { told = now; say('app ' + now) }
      }
    }
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05))
  }
}
`

let macRun: { child: ChildProcessWithoutNullStreams; stopFile: string } | null = null
const macConfig = (): string => join(folder(), 'mac-slots.json')
let macApplied: string | null = null

function startMac(): void {
  if (macRun) return
  mkdirSync(folder(), { recursive: true })
  const stopFile = join(tmpdir(), `orbit-keyremap-stop-${process.pid}-${randomUUID().slice(0, 8)}`)
  const child = spawn('osascript', ['-l', 'JavaScript', '-e', MAC_HELPER, macConfig(), stopFile])
  readLines(child, (line) => {
    const [kind, ...rest] = line.split(' ')
    if (kind === 'app') {
      const [name, title] = rest.join(' ').split('\t')
      frontChanged({ name: appName(name ?? ''), title: title ?? '' })
    } else if (kind === 'note') logError('key remapper', new Error(rest.join(' ')))
  })
  child.on('exit', () => {
    try {
      unlinkSync(stopFile)
    } catch {
      // Never made.
    }
    if (macRun?.child !== child) return
    macRun = null
    if (stopping) return
    crashes++
    if (crashes <= 3) setTimeout(() => apply(), 1000 * crashes)
    broadcast()
  })
  macRun = { child, stopFile }
  macApply()
}

/** Puts the remaps for the app in front into macOS (only when they change). */
function macApply(): void {
  const plan = macPlan(holding ? new Map() : activeRules(data, front))
  try {
    writeFileSync(macConfig(), JSON.stringify({ slots: plan.slots }))
  } catch (err) {
    logError('key remapper', err)
  }
  const arg = hidutilArg(plan.mapping)
  if (arg === macApplied) return
  macApplied = arg
  if (plan.mapping.length) {
    try {
      writeFileSync(macMarker(), '1')
    } catch {
      // Only for clearing after a crash.
    }
  }
  execFile('hidutil', ['property', '--set', arg], (err) => {
    if (err) {
      logError('key remapper', err)
      helperError = `macOS didn’t take the remaps (${err.message}).`
      macApplied = null
    } else if (helperError) helperError = null
    broadcast()
  })
}

/** Takes Orbit's remapping out of macOS (when Orbit quits, or after a crash). */
function macClear(): void {
  if (!existsSync(macMarker()) && !macApplied) return
  try {
    execFileSync('hidutil', ['property', '--set', '{"UserKeyMapping":[]}'], { timeout: 3000 })
    unlinkSync(macMarker())
  } catch (err) {
    logError('key remapper', err)
  }
  macApplied = null
}

// ---------- Both ----------

let stopping = false

function frontChanged(app: FrontApp): void {
  const same = front && front.name === app.name && front.title === app.title
  front = app
  if (app.name && !/^(orbit|electron|notesapp)$/i.test(app.name)) recent = [app, ...recent.filter((r) => r.name.toLowerCase() !== app.name.toLowerCase())].slice(0, 12)
  if (same) return
  if (IS_MAC && macRun) macApply()
  for (const fn of listeners) fn()
  broadcast()
}

/** Starts the helper if there's anything to remap (or the page is open), and gives it the remaps. */
let wanted = false
function apply(): void {
  if (!SUPPORTED || stopping) return
  if (!wanted && !hasRules()) return
  if (IS_MAC) {
    if (macRun) macApply()
    else startMac()
  } else {
    if (winHelper) winSend()
    else startWindows()
  }
  applyHotkey()
  for (const fn of listeners) fn()
}

let registered = ''
function applyHotkey(): void {
  const want = SUPPORTED ? data.toggleHotkey : ''
  if (registered === want) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  hotkeyError = null
  if (!want) return
  try {
    if (globalShortcut.register(want, toggleAll)) registered = want
    else hotkeyError = `${hotkeyLabel(want)} is already used by ${SYSTEM_NAME}, another app or another part of Orbit. Pick different keys.`
  } catch {
    hotkeyError = `${hotkeyLabel(want)} can’t be used as a hotkey.`
  }
}

let lastToggle = 0
function toggleAll(): void {
  const now = Date.now()
  if (now - lastToggle < 300) return
  lastToggle = now
  data = { ...data, on: !data.on }
  changed()
}

function setHolding(on: boolean): void {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = null
  if (holding === on) return
  holding = on
  // Never left paused by accident (the page closed mid-pick, say).
  if (on) holdTimer = setTimeout(() => setHolding(false), 30_000)
  if (IS_MAC) {
    if (macRun) macApply()
  } else winSend()
  for (const fn of listeners) fn()
}

const newId = (): string => randomUUID().slice(0, 12)

function updateSet(id: string, fn: (s: RemapSet) => RemapSet): void {
  data = cleanRemaps({ ...data, sets: data.sets.map((s) => (s.id === id ? fn(s) : s)) })
}

// ---------- Setup ----------

/** The folder, for syncing with your other computers. */
export const keyRemapFolder = folder

export function reloadKeyRemaps(): void {
  load()
  apply()
  broadcast()
}

export function setupKeyRemap(): void {
  load()
  if (IS_MAC) macClear()
  // After the handlers below, so the page always works even if the helper fails.
  setTimeout(() => {
    try {
      apply()
    } catch (err) {
      logError('key remapper', err)
    }
  }, 0)

  ipcMain.handle('keyremap:get', () => {
    if (!wanted) {
      wanted = true
      apply()
    }
    return status()
  })
  ipcMain.handle('keyremap:on', (_e, on: boolean) => {
    data = { ...data, on: !!on }
    return changed()
  })
  ipcMain.handle('keyremap:hotkey', (_e, accel: string) => {
    data = { ...data, toggleHotkey: typeof accel === 'string' ? normalizeAccelerator(accel) : '' }
    return changed()
  })
  ipcMain.handle('keyremap:addSet', (_e, app: string, name?: string) => {
    const clean = typeof app === 'string' ? appName(app) : ''
    if (!clean || data.sets.length >= SET_LIMIT) return status()
    const existing = data.sets.find((s) => s.app.toLowerCase() === clean.toLowerCase())
    if (existing) return status()
    const set: RemapSet = { id: newId(), name: (typeof name === 'string' && name.trim()) || clean, app: clean, on: true, rules: [] }
    data = { ...data, sets: [...data.sets, set] }
    return changed()
  })
  ipcMain.handle('keyremap:updateSet', (_e, id: string, patch: Partial<Pick<RemapSet, 'name' | 'app' | 'on'>>) => {
    if (!patch || typeof patch !== 'object') return status()
    updateSet(id, (s) => ({
      ...s,
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      ...(typeof patch.app === 'string' && s.id !== EVERYWHERE_ID && appName(patch.app) ? { app: appName(patch.app) } : {}),
      ...(typeof patch.on === 'boolean' ? { on: patch.on } : {})
    }))
    return changed()
  })
  ipcMain.handle('keyremap:removeSet', (_e, id: string) => {
    if (id === EVERYWHERE_ID) return status()
    data = { ...data, sets: data.sets.filter((s) => s.id !== id) }
    return changed()
  })
  ipcMain.handle('keyremap:saveRule', (_e, setId: string, rule: Partial<RemapRule>) => {
    const set = data.sets.find((s) => s.id === setId)
    if (!set || !rule || typeof rule !== 'object') return status()
    const id = typeof rule.id === 'string' && set.rules.some((r) => r.id === rule.id) ? rule.id : newId()
    const old = set.rules.find((r) => r.id === id)
    const clean = cleanRule({ ...old, ...rule, id })
    if (!clean) return status()
    if (!old && set.rules.length >= RULE_LIMIT) return status()
    updateSet(setId, (s) => ({ ...s, rules: old ? s.rules.map((r) => (r.id === id ? clean : r)) : [...s.rules, clean] }))
    return changed()
  })
  ipcMain.handle('keyremap:removeRule', (_e, setId: string, ruleId: string) => {
    updateSet(setId, (s) => ({ ...s, rules: s.rules.filter((r) => r.id !== ruleId) }))
    return changed()
  })
  ipcMain.handle('keyremap:hold', (_e, on: boolean) => {
    setHolding(!!on)
  })
}

export function teardownKeyRemap(): void {
  stopping = true
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  if (winHelper) {
    // Closing its input lets it finish; it lets go of anything it was holding down as it goes.
    winHelper.stdin.end()
    const child = winHelper
    setTimeout(() => child.kill(), 1000)
    winHelper = null
  }
  if (macRun) {
    try {
      writeFileSync(macRun.stopFile, 'stop')
    } catch {
      macRun.child.kill()
    }
    macRun = null
  }
  if (IS_MAC) macClear()
}
