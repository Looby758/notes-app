import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  acceleratorCodes,
  cleanClicker,
  cleanMacro,
  cleanMacros,
  clickerCommand,
  DEFAULT_HOTKEYS,
  emptyMacros,
  macKeyFor,
  MACRO_LIMIT,
  macroView,
  playbackScript,
  tidyRecording,
  windowsHotkey,
  winKeyFor,
  type Macro,
  type MacroActivity,
  type MacroHotkeys,
  type MacroOs,
  type MacrosData,
  type MacroStatus,
  type PlayReport
} from '@shared/macros'
import { hotkeyLabel, normalizeAccelerator } from '@shared/soundboard'
import { IS_MAC, SYSTEM_NAME } from '@shared/platform'
import { logError } from './log'
import { addonOn, onAddonsChanged } from './addonGate'
import { accessibilityHelp, inputAllowed } from './shareInput'
import { onRemapsChanged, remappedKeyIds } from './keyRemap'

/**
 * The macro recorder and auto-clicker (main-process side). The timing is all done by a helper
 * process, never by Electron's timers:
 *
 * - Windows: a PowerShell helper with a small C# program. It records with the system's low-level
 *   keyboard and mouse hooks plus raw mouse input (what games read), stamping each one with the
 *   high-resolution clock the moment Windows reports it, and plays back with SendInput against the
 *   same clock (sleeping until just before each event, then waiting out the last fraction of a
 *   millisecond). Keys are sent by scan code, which games read.
 * - Mac: a JavaScript-for-Automation helper. It records with a global event monitor (each event
 *   carries macOS's own timestamp) and posts Quartz events to play. Needs Orbit allowed under
 *   Privacy & Security → Accessibility.
 *
 * Every event is due at start + its own time, so nothing drifts however long a macro is or however
 * many times it repeats. After each play the helper reports how late the events were.
 *
 * Orbit never turns macros off by itself for any game or server.
 */

const OS: MacroOs = IS_MAC ? 'mac' : 'win'
const SUPPORTED = process.platform === 'win32' || process.platform === 'darwin'

const folder = (): string => join(app.getPath('userData'), 'macros')
const dataFile = (): string => join(folder(), 'macros.json')

let data: MacrosData = emptyMacros()
let activity: MacroActivity = { kind: 'idle' }
let lastPlay: PlayReport | null = null
let lastError: string | null = null
const hotkeyErrors: Record<string, string> = {}

function load(): void {
  try {
    data = cleanMacros(JSON.parse(readFileSync(dataFile(), 'utf8')))
  } catch {
    data = emptyMacros()
  }
}

function save(): void {
  mkdirSync(folder(), { recursive: true })
  const tmp = `${dataFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, dataFile())
}

function problem(): string | null {
  // Failsafe: without the Macros add-on nothing records, plays or clicks.
  if (!addonOn('macros')) return 'Macros isn’t added. Add it in Settings → Add-ons.'
  if (!SUPPORTED) return 'Macros and the auto-clicker work on Windows and on a Mac.'
  if (IS_MAC && !inputAllowed(false)) return accessibilityHelp()
  return null
}

function status(): MacroStatus {
  return {
    data: { ...data, macros: data.macros.map(macroView) },
    activity,
    problem: problem(),
    hotkeyErrors: { ...hotkeyErrors },
    lastPlay,
    error: lastError
  }
}

function broadcast(): void {
  const s = status()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('macros:changed', s)
}

/** Live counts (events recorded, clicks) change fast: tell the windows a few times a second at most. */
let liveTimer: NodeJS.Timeout | null = null
function broadcastSoon(): void {
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    liveTimer = null
    broadcast()
  }, 250)
}

function changed(): MacroStatus {
  save()
  applyHotkeys()
  broadcast()
  return status()
}

// ---------- The helpers ----------

const WIN_HELPER = String.raw`
$src = @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class OrbitMacro {
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct KBDLL { public uint vk, scan, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSLL { public POINT pt; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort page, usage; public uint flags; public IntPtr target; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] static extern bool GetClipCursor(out RECT r);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint n, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr h, uint command, IntPtr data, ref uint size, uint headerSize);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
  [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);

  // ---------- Saying things back to Orbit (one writer, so lines never mix) ----------
  static readonly BlockingCollection<string> outbox = new BlockingCollection<string>();
  internal static void Say(string s) { outbox.Add(s); }
  static void Writer() {
    var o = Console.Out;
    foreach (var line in outbox.GetConsumingEnumerable()) { o.WriteLine(line); if (outbox.Count == 0) o.Flush(); }
  }
  static readonly double perMs = Stopwatch.Frequency / 1000.0;
  static string N(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }

  public static void Init() {
    // Real pixels everywhere (otherwise a scaled screen gets the wrong positions).
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
    var w = new Thread(Writer); w.IsBackground = true; w.Start();
    // Compile the sending and timing code now, so the first event of the first play isn't late.
    foreach (var name in new string[] { "Key", "Button", "MoveTo", "Mouse", "Send", "WaitUntil", "ReleaseAll", "OnRaw", "KbProc", "MsProc", "WatchProc", "ModBit", "T" }) {
      var m = typeof(OrbitMacro).GetMethod(name, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
      if (m != null) System.Runtime.CompilerServices.RuntimeHelpers.PrepareMethod(m.MethodHandle);
    }
    Say("ready");
  }

  public static void Command(string line) {
    string[] p = line.Split(' ');
    switch (p[0]) {
      case "rec": StartRecording(p.Length > 1 ? p[1] : "", p.Length > 2 ? p[2] : ""); break;
      case "recskip": SetSkip(p.Length > 1 ? p[1] : ""); break;
      case "recstop": StopRecording(); break;
      // play <run> <path> / click <run> <args…>: the run number comes back on everything it says.
      case "play": { int sp = line.IndexOf(' ', 5); Play(p[1], line.Substring(sp + 1)); break; }
      case "click": { var q = new List<string>(p); q.RemoveAt(1); Click(p[1], q.ToArray()); break; }
      case "stop": StopWorker(); break;
      case "keys": SetHotkeys(p.Length > 1 ? p[1] : ""); break;
    }
  }

  // ---------- Hotkeys ----------
  // Watched here too (not only by Electron), because Windows' own hotkeys don't fire while a
  // modifier is held down, and a macro holding Shift or Ctrl would then make Stop impossible.
  // This looks at the real keyboard only: keys Orbit is pressing never count.
  static volatile uint[] hkVk = new uint[0];
  static volatile int[] hkMods = new int[0];
  static int physMods;
  static readonly HashSet<uint> hkSwallow = new HashSet<uint>();
  static readonly HashSet<uint> physDown = new HashSet<uint>();
  static readonly HookProc watchProc = WatchProc;
  static Thread watchThread;

  static void SetHotkeys(string list) {
    var vks = new List<uint>(); var mods = new List<int>();
    foreach (var item in list.Split(',')) {
      var kv = item.Split(':'); uint vk; int m;
      if (kv.Length == 2 && uint.TryParse(kv[0], out vk) && int.TryParse(kv[1], out m)) { vks.Add(vk); mods.Add(m); }
    }
    hkMods = mods.ToArray(); hkVk = vks.ToArray();
    if (watchThread == null && vks.Count > 0) {
      watchThread = new Thread(() => {
        try {
          IntPtr h = SetWindowsHookEx(13, watchProc, GetModuleHandle(null), 0);
          if (h == IntPtr.Zero) Say("note hotkey watch " + Marshal.GetLastWin32Error());
          MSG msg;
          while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        } catch (Exception e) { Say("note hotkey watch " + e.Message); }
      });
      watchThread.IsBackground = true;
      watchThread.Priority = ThreadPriority.Highest;
      watchThread.Start();
    }
  }

  static int ModBit(uint vk) {
    if (vk == 0xA2 || vk == 0xA3 || vk == 0x11) return 1;
    if (vk == 0xA4 || vk == 0xA5 || vk == 0x12) return 2;
    if (vk == 0xA0 || vk == 0xA1 || vk == 0x10) return 4;
    if (vk == 0x5B || vk == 0x5C) return 8;
    return 0;
  }

  static IntPtr WatchProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      var k = (KBDLL)Marshal.PtrToStructure(l, typeof(KBDLL));
      if ((k.flags & 0x10) == 0) {
        bool up = (k.flags & 0x80) != 0;
        int bit = ModBit(k.vk);
        if (bit != 0) {
          // Both sides count: only clear the bit when neither is down.
          if (up) physDown.Remove(k.vk); else physDown.Add(k.vk);
          physMods = 0;
          foreach (var d in physDown) physMods |= ModBit(d);
        } else if (up) {
          bool swallow = hkSwallow.Remove(k.vk);
          physDown.Remove(k.vk);
          if (swallow) return new IntPtr(1);
        } else {
          bool repeat = physDown.Contains(k.vk);
          physDown.Add(k.vk);
          uint[] vks = hkVk; int[] mods = hkMods;
          for (int i = 0; i < vks.Length; i++) {
            if (vks[i] == k.vk && mods[i] == physMods) {
              if (!repeat) Say("hk " + i);
              hkSwallow.Add(k.vk);
              return new IntPtr(1);
            }
          }
        }
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  public static void Shutdown() { StopWorker(); if (recThread != null) StopRecording(); }

  // ---------- Recording ----------
  static Thread recThread;
  static uint recThreadId;
  static long recStart;
  static IntPtr kbHook = IntPtr.Zero, msHook = IntPtr.Zero;
  static readonly HookProc kbProc = KbProc, msProc = MsProc;
  static readonly HashSet<uint> ignore = new HashSet<uint>();
  static readonly HashSet<uint> keysDown = new HashSet<uint>();
  static RawSink sink;
  // Keys the key remapper is remapping right now: from your real keyboard they're skipped, and what
  // the remapper pressed instead (marked with its sign) is recorded, so a macro plays what you got.
  static volatile HashSet<uint> skip = new HashSet<uint>();
  static readonly IntPtr RemapMark = new IntPtr(0x4F524254);
  static void SetSkip(string list) {
    var s = new HashSet<uint>();
    foreach (var item in list.Split(',')) { uint v; if (uint.TryParse(item, out v)) s.Add(v); }
    skip = s;
  }

  static string T(long now) { return N((now - recStart) / perMs); }

  // A game has the mouse when it hides the pointer or keeps it inside its window.
  static bool GameHasMouse() {
    var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (GetCursorInfo(ref ci) && ((ci.flags & 1) == 0 || ci.hCursor == IntPtr.Zero)) return true;
    RECT r;
    if (GetClipCursor(out r)) {
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
      if (r.left > vx || r.top > vy || r.right < vx + vw || r.bottom < vy + vh) return true;
    }
    return false;
  }

  static void StartRecording(string ignoreList, string skipList) {
    if (recThread != null) return;
    SetSkip(skipList);
    ignore.Clear(); keysDown.Clear();
    foreach (var s in ignoreList.Split(',')) { uint v; if (uint.TryParse(s, out v)) ignore.Add(v); }
    var ready = new ManualResetEvent(false);
    recThread = new Thread(() => { try { Record(ready); } catch (Exception e) { Say("err " + e.Message); ready.Set(); } });
    recThread.IsBackground = true;
    recThread.Priority = ThreadPriority.Highest;
    recThread.Start();
    ready.WaitOne(3000);
    Say("recording");
  }

  static void Record(ManualResetEvent ready) {
      recThreadId = GetCurrentThreadId();
      recStart = Stopwatch.GetTimestamp();
      POINT p; GetCursorPos(out p);
      Say("p 0 " + p.x + " " + p.y + " " + (GameHasMouse() ? 1 : 0));
      IntPtr mod = GetModuleHandle(null);
      kbHook = SetWindowsHookEx(13, kbProc, mod, 0);
      msHook = SetWindowsHookEx(14, msProc, mod, 0);
      if (kbHook == IntPtr.Zero || msHook == IntPtr.Zero) Say("err Windows wouldn't let Orbit see the keyboard and mouse (" + Marshal.GetLastWin32Error() + ").");
      try { sink = new RawSink(); } catch (Exception e) { sink = null; Say("note " + e.Message); }
      ready.Set();
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
      if (kbHook != IntPtr.Zero) UnhookWindowsHookEx(kbHook);
      if (msHook != IntPtr.Zero) UnhookWindowsHookEx(msHook);
      kbHook = IntPtr.Zero; msHook = IntPtr.Zero;
      if (sink != null) { try { sink.Close(); } catch { } sink = null; }
  }

  static void StopRecording() {
    long now = Stopwatch.GetTimestamp();
    if (recThread == null) { Say("recdone 0"); return; }
    PostThreadMessage(recThreadId, 0x0012, IntPtr.Zero, IntPtr.Zero);
    recThread.Join(3000);
    recThread = null;
    Say("recdone " + T(now));
  }

  static IntPtr KbProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      long now = Stopwatch.GetTimestamp();
      var k = (KBDLL)Marshal.PtrToStructure(l, typeof(KBDLL));
      // 0x10: typed by a program (Orbit itself while playing), not by you; except the key remapper's.
      bool injected = (k.flags & 0x10) != 0, ext = (k.flags & 1) != 0;
      uint id = k.vk | (ext ? 0x100u : 0u);
      if (injected ? k.extra == RemapMark : !skip.Contains(id)) {
        bool up = (k.flags & 0x80) != 0;
        if (ignore.Contains(k.vk)) { if (!up) Say("h " + T(now)); }
        else {
          string kind;
          if (up) { kind = "ku"; keysDown.Remove(id); }
          else if (keysDown.Contains(id)) kind = "kr";
          else { kind = "kd"; keysDown.Add(id); }
          Say(kind + " " + T(now) + " " + k.vk + " " + k.scan + " " + (ext ? 1 : 0));
        }
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static IntPtr MsProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      long now = Stopwatch.GetTimestamp();
      var m = (MSLL)Marshal.PtrToStructure(l, typeof(MSLL));
      if ((m.flags & 3) == 0) {
        string t = T(now);
        switch (w.ToInt32()) {
          case 0x200: Say("mm " + t + " " + m.pt.x + " " + m.pt.y + " " + (GameHasMouse() ? 1 : 0)); break;
          case 0x201: Say("bd " + t + " 0"); break;
          case 0x202: Say("bu " + t + " 0"); break;
          case 0x204: Say("bd " + t + " 2"); break;
          case 0x205: Say("bu " + t + " 2"); break;
          case 0x207: Say("bd " + t + " 1"); break;
          case 0x208: Say("bu " + t + " 1"); break;
          case 0x20B: Say("bd " + t + " " + ((m.data >> 16) == 2 ? 4 : 3)); break;
          case 0x20C: Say("bu " + t + " " + ((m.data >> 16) == 2 ? 4 : 3)); break;
          case 0x20A: Say("wh " + t + " 0 " + N((short)(m.data >> 16) / 120.0)); break;
          case 0x20E: Say("wh " + t + " " + N((short)(m.data >> 16) / 120.0) + " 0"); break;
        }
      }
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  // Raw mouse movement (what games read for the camera), from a hidden window.
  static readonly int rawHeader = 8 + 2 * IntPtr.Size;
  static readonly IntPtr rawBuf = Marshal.AllocHGlobal(1024);
  internal static void OnRaw(IntPtr h) {
    long now = Stopwatch.GetTimestamp();
    uint size = 1024;
    if (GetRawInputData(h, 0x10000003, rawBuf, ref size, (uint)rawHeader) == uint.MaxValue) return;
    if (Marshal.ReadInt32(rawBuf, 0) != 0) return;
    // No device: sent by a program (Orbit itself while playing).
    if (Marshal.ReadIntPtr(rawBuf, 8) == IntPtr.Zero) return;
    if ((Marshal.ReadInt16(rawBuf, rawHeader) & 1) != 0) return;
    int dx = Marshal.ReadInt32(rawBuf, rawHeader + 12), dy = Marshal.ReadInt32(rawBuf, rawHeader + 16);
    if (dx != 0 || dy != 0) Say("mr " + T(now) + " " + dx + " " + dy);
  }

  class RawSink : NativeWindow {
    public RawSink() {
      CreateHandle(new CreateParams());
      var d = new RAWINPUTDEVICE[1];
      d[0].page = 1; d[0].usage = 2; d[0].flags = 0x100; d[0].target = Handle;
      if (!RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))) throw new Exception("raw mouse input is off (" + Marshal.GetLastWin32Error() + ")");
    }
    public void Close() {
      var d = new RAWINPUTDEVICE[1];
      d[0].page = 1; d[0].usage = 2; d[0].flags = 1; d[0].target = IntPtr.Zero;
      RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
      DestroyHandle();
    }
    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x00FF) OnRaw(m.LParam);
      base.WndProc(ref m);
    }
  }

  // ---------- Sending input ----------
  static readonly HashSet<string> heldKeys = new HashSet<string>();
  static readonly HashSet<int> heldButtons = new HashSet<int>();

  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Mouse(uint flags, int dx, int dy, int data) {
    INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = unchecked((uint)data); i.u.mi.dwFlags = flags; Send(i);
  }
  static void MoveTo(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
    // The middle of the pixel, so rounding can't land on its neighbour.
    int nx = (int)Math.Min(65535.0, ((x - vx) * 65536.0 + 32768.0) / vw), ny = (int)Math.Min(65535.0, ((y - vy) * 65536.0 + 32768.0) / vh);
    Mouse(0x0001 | 0x8000 | 0x4000, nx, ny, 0);
  }
  static void Button(int b, bool down) {
    uint f; int data = 0;
    if (b == 0) f = down ? 0x0002u : 0x0004u;
    else if (b == 2) f = down ? 0x0008u : 0x0010u;
    else if (b == 1) f = down ? 0x0020u : 0x0040u;
    else { f = down ? 0x0080u : 0x0100u; data = b == 4 ? 2 : 1; }
    Mouse(f, 0, 0, data);
    if (down) heldButtons.Add(b); else heldButtons.Remove(b);
  }
  static void Key(int vk, int scan, bool ext, bool up) {
    if (scan == 0) scan = (int)MapVirtualKey((uint)vk, 0);
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = (ushort)vk; i.u.ki.wScan = (ushort)scan;
    // By scan code (the physical key), which is what games read.
    i.u.ki.dwFlags = (scan != 0 ? 0x0008u : 0u) | (ext ? 0x0001u : 0u) | (up ? 0x0002u : 0u);
    Send(i);
    string id = vk + " " + scan + " " + (ext ? 1 : 0);
    if (up) heldKeys.Remove(id); else heldKeys.Add(id);
  }
  static void ReleaseAll() {
    foreach (var k in new List<string>(heldKeys)) { var p = k.Split(' '); Key(int.Parse(p[0]), int.Parse(p[1]), p[2] == "1", true); }
    foreach (var b in new List<int>(heldButtons)) Button(b, false);
  }

  // ---------- Timing ----------
  static volatile bool stopNow;
  static Thread worker;

  // Sleeps until just before the moment, then waits out the rest, so it's on time to a fraction of a millisecond.
  static bool WaitUntil(long target) {
    while (true) {
      if (stopNow) return false;
      long left = target - Stopwatch.GetTimestamp();
      if (left <= 0) return true;
      double ms = left / perMs;
      if (ms > 3) Thread.Sleep((int)Math.Min(20, ms - 2));
      else if (ms > 0.3) Thread.Sleep(0);
      else Thread.SpinWait(10);
    }
  }

  static void StopWorker() {
    if (worker == null) return;
    stopNow = true;
    worker.Join(5000);
    worker = null;
    stopNow = false;
  }

  static void StartWorker(ThreadStart run) {
    StopWorker();
    // Nothing that goes wrong in a run may take the helper down (keys could be left held).
    worker = new Thread(() => { try { run(); } catch (Exception e) { Say("err " + e.Message); } });
    worker.IsBackground = true;
    worker.Priority = ThreadPriority.Highest;
    worker.Start();
  }

  class Ev { public double t; public char op; public int dir; public int a, b, c; public double fx, fy; }

  static void Play(string run, string path) {
    string[] lines = File.ReadAllLines(path);
    try { File.Delete(path); } catch { }
    string[] head = lines[0].Split(' ');
    double len = double.Parse(head[1], CultureInfo.InvariantCulture);
    int loops = int.Parse(head[3]);
    var evs = new List<Ev>();
    for (int n = 1; n < lines.Length; n++) {
      string[] p = lines[n].Split(' ');
      if (p.Length < 3) continue;
      var e = new Ev(); e.t = double.Parse(p[0], CultureInfo.InvariantCulture); e.op = p[1][0];
      if (e.op == 'K') { e.dir = p[2] == "down" ? 0 : p[2] == "up" ? 1 : 2; e.a = int.Parse(p[3]); e.b = int.Parse(p[4]); e.c = int.Parse(p[5]); }
      else if (e.op == 'B') { e.dir = p[2] == "down" ? 0 : 1; e.a = int.Parse(p[3]); }
      else { e.fx = double.Parse(p[2], CultureInfo.InvariantCulture); e.fy = double.Parse(p[3], CultureInfo.InvariantCulture); }
      evs.Add(e);
    }
    StartWorker(() => {
      timeBeginPeriod(1);
      long start = Stopwatch.GetTimestamp();
      double worst = 0, total = 0; long count = 0; bool stopped = false;
      try {
        for (int loop = 0; loops == 0 || loop < loops; loop++) {
          Say("loop " + run + " " + (loop + 1));
          double from = loop * len;
          foreach (var e in evs) {
            long target = start + (long)((from + e.t) * perMs);
            if (!WaitUntil(target)) { stopped = true; break; }
            double late = (Stopwatch.GetTimestamp() - target) / perMs;
            if (late > worst) worst = late;
            total += late; count++;
            switch (e.op) {
              case 'K': Key(e.a, e.b, e.c == 1, e.dir == 1); break;
              case 'B': Button(e.a, e.dir == 0); break;
              case 'M': MoveTo((int)e.fx, (int)e.fy); break;
              case 'R': Mouse(0x0001, (int)e.fx, (int)e.fy, 0); break;
              case 'W':
                if (e.fy != 0) Mouse(0x0800, 0, 0, (int)Math.Round(e.fy * 120));
                if (e.fx != 0) Mouse(0x01000, 0, 0, (int)Math.Round(e.fx * 120));
                break;
            }
          }
          if (stopped) break;
          // Wait out the rest of this go, the pause after your last input included (it's part of the macro too).
          if (!WaitUntil(start + (long)((from + len) * perMs))) { stopped = true; break; }
        }
      } finally { ReleaseAll(); timeEndPeriod(1); }
      Say("played " + run + " " + (stopped ? 1 : 0) + " " + count + " " + N(worst) + " " + N(count > 0 ? total / count : 0));
    });
  }

  // click <b|k> <a> <b> <c> <interval> <hold> <count> <duration> <x|-> <y|->
  static void Click(string run, string[] p) {
    bool isKey = p[1] == "k";
    int a = int.Parse(p[2]), b = int.Parse(p[3]), c = int.Parse(p[4]);
    double interval = double.Parse(p[5], CultureInfo.InvariantCulture), hold = double.Parse(p[6], CultureInfo.InvariantCulture);
    long count = long.Parse(p[7]);
    double duration = double.Parse(p[8], CultureInfo.InvariantCulture);
    bool spot = p[9] != "-";
    int x = spot ? int.Parse(p[9]) : 0, y = spot ? int.Parse(p[10]) : 0;
    StartWorker(() => {
      timeBeginPeriod(1);
      long start = Stopwatch.GetTimestamp(), told = start;
      long n = 0; double worst = 0, total = 0; bool stopped = false;
      try {
        while (true) {
          if (count > 0 && n >= count) break;
          double at = n * interval;
          if (duration > 0 && at >= duration) break;
          long target = start + (long)(at * perMs);
          if (!WaitUntil(target)) { stopped = true; break; }
          double late = (Stopwatch.GetTimestamp() - target) / perMs;
          if (late > worst) worst = late;
          total += late;
          if (spot) MoveTo(x, y);
          if (isKey) Key(a, b, c == 1, false); else Button(a, true);
          bool held = hold <= 0 || WaitUntil(start + (long)((at + hold) * perMs));
          if (isKey) Key(a, b, c == 1, true); else Button(a, false);
          n++;
          if (!held) { stopped = true; break; }
          long now = Stopwatch.GetTimestamp();
          if (now - told > 250 * perMs) { Say("clicks " + run + " " + n); told = now; }
        }
      } finally { ReleaseAll(); timeEndPeriod(1); }
      Say("clicked " + run + " " + (stopped ? 1 : 0) + " " + n + " " + N(worst) + " " + N(n > 0 ? total / n : 0));
    });
  }
}
'@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms
[OrbitMacro]::Init()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { [OrbitMacro]::Command($line) } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
[OrbitMacro]::Shutdown()
`

/** Mac: records until the stop file appears. Each event has macOS's own timestamp. */
const MAC_RECORDER = String.raw`
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')
function run(argv) {
  const stopFile = argv[1]
  const ignore = {}
  String(argv[0] || '').split(',').filter((k) => k && k !== '-').forEach((k) => { ignore[Number(k)] = true })
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  const say = (s) => out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
  const fm = $.NSFileManager.defaultManager
  $.NSApplication.sharedApplication
  const start = $.NSProcessInfo.processInfo.systemUptime
  const T = (ts) => ((ts - start) * 1000).toFixed(3)
  const loc = $.CGEventGetLocation($.CGEventCreate(null))
  say('p 0 ' + Math.round(loc.x) + ' ' + Math.round(loc.y) + ' 0')
  // Which side's Shift, Ctrl, Alt or Cmd is down (the device flags), by key number.
  const SIDE = { 56: 0x2, 60: 0x4, 59: 0x1, 62: 0x2000, 58: 0x20, 61: 0x40, 55: 0x8, 54: 0x10, 63: 0x800000 }
  const OTHER = { 2: 3, 3: 2 }
  const handle = (e) => {
    const type = Number(e.type)
    const t = T(Number(e.timestamp))
    if (type === 10 || type === 11) {
      const k = Number(e.keyCode)
      if (ignore[k]) { if (type === 10 && !e.isARepeat) say('h ' + t); return }
      say((type === 10 ? (e.isARepeat ? 'kr' : 'kd') : 'ku') + ' ' + t + ' ' + k)
    } else if (type === 12) {
      const k = Number(e.keyCode)
      if (k === 57) { say('kd ' + t + ' 57'); say('ku ' + t + ' 57'); return }
      if (!(k in SIDE)) return
      if (ignore[k]) return
      say(((Number(e.modifierFlags) & SIDE[k]) !== 0 ? 'kd ' : 'ku ') + t + ' ' + k)
    } else if (type === 1 || type === 2) say((type === 1 ? 'bd ' : 'bu ') + t + ' 0')
    else if (type === 3 || type === 4) say((type === 3 ? 'bd ' : 'bu ') + t + ' 2')
    else if (type === 25 || type === 26) {
      const n = Number(e.buttonNumber)
      say((type === 25 ? 'bd ' : 'bu ') + t + ' ' + (n === 2 ? 1 : OTHER[n] !== undefined ? n : 1))
    } else if (type === 5 || type === 6 || type === 7 || type === 27) {
      const p = $.CGEventGetLocation(e.CGEvent)
      say('mm ' + t + ' ' + Math.round(p.x) + ' ' + Math.round(p.y) + ' 0')
      const dx = Math.round(Number(e.deltaX)), dy = Math.round(Number(e.deltaY))
      if (dx || dy) say('mr ' + t + ' ' + dx + ' ' + dy)
    } else if (type === 22) {
      const dx = Number(e.deltaX), dy = Number(e.deltaY)
      if (dx || dy) say('wh ' + t + ' ' + dx.toFixed(3) + ' ' + dy.toFixed(3))
    }
  }
  let mask = 0
  ;[1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 22, 25, 26, 27].forEach((n) => { mask += Math.pow(2, n) })
  $.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler(mask, (e) => { try { handle(e) } catch (err) { say('note ' + err) } })
  say('recording')
  while (!fm.fileExistsAtPath(stopFile)) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.002))
  say('recdone ' + T($.NSProcessInfo.processInfo.systemUptime))
}
`

/** Mac: plays a script (or runs the auto-clicker) until done or the stop file appears. */
const MAC_PLAYER = String.raw`
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')
function run(argv) {
  const mode = argv[0], arg = argv[1], run = argv[2], stopFile = argv[3]
  const out = $.NSFileHandle.fileHandleWithStandardOutput
  const say = (s) => out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding))
  const fm = $.NSFileManager.defaultManager
  const now = () => $.NSProcessInfo.processInfo.systemUptime * 1000
  let stopped = false, checked = 0
  const stopAsked = () => {
    const n = now()
    if (n - checked > 4) { checked = n; if (fm.fileExistsAtPath(stopFile)) stopped = true }
    return stopped
  }
  const waitUntil = (target) => {
    for (;;) {
      if (stopAsked()) return false
      const left = target - now()
      if (left <= 0) return true
      if (left > 3) $.NSThread.sleepForTimeInterval(Math.min(20, left - 2) / 1000)
    }
  }
  const SIDE = { 56: 0x20000, 60: 0x20000, 59: 0x40000, 62: 0x40000, 58: 0x80000, 61: 0x80000, 55: 0x100000, 54: 0x100000 }
  const heldKeys = {}, held = { 0: false, 1: false, 2: false, 3: false, 4: false }
  const flags = () => { let f = 0; for (const k in heldKeys) if (heldKeys[k] && SIDE[k]) f |= SIDE[k]; return f }
  const here = () => $.CGEventGetLocation($.CGEventCreate(null))
  // Ours: 0 left, 1 middle, 2 right, 3 back, 4 forward. Quartz's: 0 left, 1 right, 2 middle, 3, 4.
  const QB = { 0: 0, 1: 2, 2: 1, 3: 3, 4: 4 }
  const key = (code, down, repeat) => {
    if (!repeat) heldKeys[code] = down
    const e = $.CGEventCreateKeyboardEvent(null, code, down)
    if (repeat) $.CGEventSetIntegerValueField(e, 8, 1)
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  }
  const button = (b, down) => {
    held[b] = down
    const type = b === 0 ? (down ? 1 : 2) : b === 2 ? (down ? 3 : 4) : (down ? 25 : 26)
    const e = $.CGEventCreateMouseEvent(null, type, here(), QB[b])
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  }
  const moveTo = (x, y, dx, dy) => {
    const type = held[0] ? 6 : held[2] ? 7 : (held[1] || held[3] || held[4]) ? 27 : 5
    const b = held[0] ? 0 : held[2] ? 1 : 2
    const e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), b)
    $.CGEventSetIntegerValueField(e, 4, Math.round(dx))
    $.CGEventSetIntegerValueField(e, 5, Math.round(dy))
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  }
  const releaseAll = () => {
    for (const k in heldKeys) if (heldKeys[k]) key(Number(k), false, false)
    for (const b in held) if (held[b]) button(Number(b), false)
  }
  const fmt = (n) => n.toFixed(3)
  if (mode === 'play') {
    const text = $.NSString.stringWithContentsOfFileEncodingError(arg, $.NSUTF8StringEncoding, null).js
    const lines = text.split('\n').filter((l) => l.length)
    const head = lines[0].split(' ')
    const len = Number(head[1]), loops = Number(head[3])
    const evs = lines.slice(1).map((l) => l.split(' '))
    const start = now()
    let worst = 0, total = 0, count = 0
    try {
      for (let loop = 0; loops === 0 || loop < loops; loop++) {
        say('loop ' + run + ' ' + (loop + 1))
        const from = loop * len
        for (const p of evs) {
          const target = start + from + Number(p[0])
          if (!waitUntil(target)) break
          const late = now() - target
          if (late > worst) worst = late
          total += late; count++
          if (p[1] === 'K') key(Number(p[3]), p[2] !== 'up', p[2] === 'rep')
          else if (p[1] === 'B') button(Number(p[3]), p[2] === 'down')
          else if (p[1] === 'M') { const h = here(); moveTo(Number(p[2]), Number(p[3]), Number(p[2]) - h.x, Number(p[3]) - h.y) }
          else if (p[1] === 'R') { const h = here(); moveTo(h.x + Number(p[2]), h.y + Number(p[3]), Number(p[2]), Number(p[3])) }
          else if (p[1] === 'W') {
            const dy = Math.round(Number(p[3])), dx = Math.round(Number(p[2]))
            if (dx || dy) { const e = $.CGEventCreateScrollWheelEvent2(null, 1, 2, dy, dx, 0); $.CGEventSetFlags(e, flags()); $.CGEventPost(0, e) }
          }
        }
        if (stopped) break
        if (!waitUntil(start + from + len)) break
      }
    } finally { releaseAll() }
    say('played ' + run + ' ' + (stopped ? 1 : 0) + ' ' + count + ' ' + fmt(worst) + ' ' + fmt(count ? total / count : 0))
  } else {
    const p = arg.split(' ')
    const isKey = p[1] === 'k', a = Number(p[2])
    const interval = Number(p[5]), hold = Number(p[6]), count = Number(p[7]), duration = Number(p[8])
    const spot = p[9] !== '-', x = Number(p[9]), y = Number(p[10])
    const start = now()
    let told = start, n = 0, worst = 0, total = 0
    try {
      for (;;) {
        if (count > 0 && n >= count) break
        const at = n * interval
        if (duration > 0 && at >= duration) break
        const target = start + at
        if (!waitUntil(target)) break
        const late = now() - target
        if (late > worst) worst = late
        total += late
        if (spot) { const h = here(); moveTo(x, y, x - h.x, y - h.y) }
        if (isKey) key(a, true, false); else button(a, true)
        const ok = hold <= 0 || waitUntil(start + at + hold)
        if (isKey) key(a, false, false); else button(a, false)
        n++
        if (!ok) break
        if (now() - told > 250) { say('clicks ' + run + ' ' + n); told = now() }
      }
    } finally { releaseAll() }
    say('clicked ' + run + ' ' + (stopped ? 1 : 0) + ' ' + n + ' ' + fmt(worst) + ' ' + fmt(n ? total / n : 0))
  }
}
`

type LineHandler = (line: string) => void

/** Windows: one helper that stays running (it takes a moment to start, so it's started early). */
let winHelper: ChildProcessWithoutNullStreams | null = null
/** Mac: the recorder and the player are separate runs, stopped with a stop file. */
let macRun: { child: ChildProcessWithoutNullStreams; stopFile: string } | null = null

function readLines(child: ChildProcessWithoutNullStreams, onLine: LineHandler, label: string): void {
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
  child.stderr.on('data', (d: Buffer) => logError(label, new Error(d.toString().trim())))
  child.on('error', (err) => logError(label, err))
  child.stdin.on('error', (err) => logError(label, err))
}

/**
 * The helper is too long to pass on the command line (Windows allows 32,767 characters), so it's
 * written to a script file next to Orbit's settings (not in the synced macros folder) and run from there.
 */
function helperScript(): string {
  const file = join(app.getPath('userData'), 'macro-helper.ps1')
  // With a byte-order mark, so Windows PowerShell reads it as UTF-8.
  const text = '\ufeff' + WIN_HELPER
  let current = ''
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // Not written yet.
  }
  if (current !== text) writeFileSync(file, text, 'utf8')
  return file
}

/** Sends a line to the Windows helper, starting it if needed. False if it couldn't be started. */
function winWrite(line: string): boolean {
  if (!winHelper) {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript()], { windowsHide: true })
    } catch (err) {
      logError('macros', err)
      lastError = `Orbit couldn’t start the part that records and presses keys (${err instanceof Error ? err.message : String(err)}).`
      if (activity.kind !== 'idle') activity = { kind: 'idle' }
      broadcast()
      return false
    }
    readLines(child, onHelperLine, 'macros')
    child.on('exit', () => {
      if (winHelper === child) winHelper = null
      helperGone()
    })
    winHelper = child
    // A new helper needs the hotkeys to watch (after a crash, say).
    if (!line.startsWith('keys ')) queueMicrotask(applyHotkeys)
  }
  winHelper.stdin.write(line + '\n')
  return true
}

const stopFilePath = (): string => join(tmpdir(), `orbit-macro-stop-${process.pid}-${randomUUID().slice(0, 8)}`)

function macStart(script: string, args: string[]): void {
  macStop()
  const stopFile = stopFilePath()
  // The stop file always comes last.
  const child = spawn('osascript', ['-l', 'JavaScript', '-e', script, ...args.map((a) => a || '-'), stopFile])
  readLines(child, onHelperLine, 'macros')
  child.on('exit', () => {
    try {
      unlinkSync(stopFile)
    } catch {
      // Never made.
    }
    if (macRun?.child === child) {
      macRun = null
      helperGone()
    }
  })
  macRun = { child, stopFile }
}

function macStop(): void {
  if (!macRun) return
  try {
    writeFileSync(macRun.stopFile, 'stop')
  } catch (err) {
    logError('macros', err)
    macRun.child.kill()
  }
}

/** The helper stopped by itself (or crashed) while busy: nothing is going on any more. */
function helperGone(): void {
  if (activity.kind === 'recording') finishRecording(Date.now() - activity.since)
  else if (activity.kind !== 'idle') {
    activity = { kind: 'idle' }
    broadcast()
  }
}

// ---------- Recording ----------

let recLines: string[] = []

/** Every hotkey's main key, as this computer's key numbers: left out of recordings. */
function hotkeyKeys(): number[] {
  const accels = [data.hotkeys.record, data.hotkeys.play, data.hotkeys.clicker, ...data.macros.map((m) => m.hotkey)].filter(Boolean)
  const out = new Set<number>()
  for (const a of accels) {
    const { key } = acceleratorCodes(a)
    if (!key) continue
    const n = IS_MAC ? macKeyFor(key) : winKeyFor(key)?.vk
    if (n !== null && n !== undefined) out.add(n)
  }
  return [...out]
}

function startRecording(): void {
  const why = problem() ?? (IS_MAC && !inputAllowed(true) ? accessibilityHelp() : null)
  if (why) {
    lastError = why
    broadcast()
    return
  }
  stopAll()
  recLines = []
  lastError = null
  activity = { kind: 'recording', since: Date.now(), events: 0 }
  const ignore = hotkeyKeys().join(',')
  if (IS_MAC) macStart(MAC_RECORDER, [ignore])
  else winWrite(`rec ${ignore || '-'} ${remappedKeyIds().join(',') || '-'}`)
  broadcast()
}

function stopRecording(): void {
  if (activity.kind !== 'recording') return
  if (IS_MAC) macStop()
  else winWrite('recstop')
}

function finishRecording(stoppedAt: number): void {
  if (activity.kind !== 'recording') return
  activity = { kind: 'idle' }
  const { events, length } = tidyRecording(recLines, {
    os: OS,
    stoppedAt,
    stopMods: acceleratorCodes(data.hotkeys.record).mods,
    trimStart: data.skipLeadingWait
  })
  recLines = []
  const something = events.some((e) => e.k !== 'mm' || e.t > 0)
  if (!something) {
    lastError = 'Nothing was recorded. Press the record hotkey, do what you want repeated, then press it again.'
    broadcast()
    return
  }
  if (data.macros.length >= MACRO_LIMIT) {
    lastError = `You have ${MACRO_LIMIT} macros already. Delete one to keep new recordings.`
    broadcast()
    return
  }
  const taken = new Set(data.macros.map((m) => m.name))
  let n = data.macros.length + 1
  while (taken.has(`Macro ${n}`)) n++
  const macro: Macro = {
    id: randomUUID().slice(0, 12),
    name: `Macro ${n}`,
    created: Date.now(),
    os: OS,
    events,
    length,
    hotkey: '',
    repeat: 'once',
    times: 2,
    speed: 1,
    mouse: 'auto'
  }
  data = { ...data, macros: [macro, ...data.macros], current: macro.id }
  changed()
}

// ---------- Playing and clicking ----------

function play(id: string): void {
  const macro = data.macros.find((m) => m.id === id)
  if (!macro) return
  const why = problem() ?? (IS_MAC && !inputAllowed(true) ? accessibilityHelp() : null)
  if (why) {
    lastError = why
    broadcast()
    return
  }
  stopAll()
  lastError = null
  const script = playbackScript(macro, OS)
  const file = join(tmpdir(), `orbit-macro-${process.pid}-${randomUUID().slice(0, 8)}.txt`)
  writeFileSync(file, script.join('\n'))
  const loops = macro.repeat === 'once' ? 1 : macro.repeat === 'times' ? macro.times : 0
  activity = { kind: 'playing', id, loop: 1, loops, since: Date.now() }
  const run = ++lastRun
  currentRun = run
  runMacro.set(run, id)
  if (IS_MAC) macStart(MAC_PLAYER, ['play', file, String(run)])
  else winWrite(`play ${run} ${file}`)
  broadcast()
}

function startClicker(): void {
  const why = problem() ?? (IS_MAC && !inputAllowed(true) ? accessibilityHelp() : null)
  if (why) {
    lastError = why
    broadcast()
    return
  }
  const cmd = clickerCommand(data.clicker, OS)
  if (!cmd) {
    lastError = 'Pick a key for the auto-clicker to press.'
    broadcast()
    return
  }
  stopAll()
  lastError = null
  activity = { kind: 'clicking', since: Date.now(), clicks: 0 }
  const run = ++lastRun
  currentRun = run
  if (IS_MAC) macStart(MAC_PLAYER, ['click', cmd, String(run)])
  else winWrite(cmd.replace(/^click /, `click ${run} `))
  broadcast()
}

/**
 * Stops playing or clicking (not recording). Held keys and buttons are let go of. The helper is
 * always told, even if Orbit thinks nothing is playing, and the page shows "stopped" straight away:
 * a stop must never depend on Orbit's idea of what's going on being right.
 */
function stopPlaying(): void {
  if (IS_MAC) macStop()
  else if (winHelper) winWrite('stop')
  currentRun = 0
  if (activity.kind === 'playing' || activity.kind === 'clicking') {
    activity = { kind: 'idle' }
    broadcast()
  }
}

function stopAll(): void {
  if (activity.kind === 'recording') stopRecording()
  else stopPlaying()
}

/** Each play or auto-clicker run has a number, so word from an old run (one just stopped) never changes what the page shows for the new one. */
let lastRun = 0
let currentRun = 0
const runMacro = new Map<number, string>()

function onHelperLine(line: string): void {
  const [kind, ...rest] = line.split(' ')
  switch (kind) {
    case 'kd':
    case 'ku':
    case 'kr':
    case 'bd':
    case 'bu':
    case 'mm':
    case 'mr':
    case 'wh':
    case 'p':
    case 'h':
      if (activity.kind === 'recording') {
        recLines.push(line)
        if (kind !== 'p' && kind !== 'h') {
          activity = { ...activity, events: activity.events + 1 }
          broadcastSoon()
        }
      }
      break
    case 'recdone':
      finishRecording(Number(rest[0]) || 0)
      break
    case 'loop':
      if (activity.kind === 'playing' && Number(rest[0]) === currentRun) {
        activity = { ...activity, loop: Number(rest[1]) || 1 }
        broadcast()
      }
      break
    case 'clicks':
      if (activity.kind === 'clicking' && Number(rest[0]) === currentRun) {
        activity = { ...activity, clicks: Number(rest[1]) || 0 }
        broadcastSoon()
      }
      break
    case 'played': {
      const run = Number(rest[0])
      lastPlay = {
        id: runMacro.get(run) ?? '',
        stopped: rest[1] === '1',
        events: Number(rest[2]) || 0,
        worstLateMs: Number(rest[3]) || 0,
        averageLateMs: Number(rest[4]) || 0
      }
      runMacro.delete(run)
      if (run === currentRun) {
        currentRun = 0
        if (activity.kind === 'playing') activity = { kind: 'idle' }
      }
      broadcast()
      break
    }
    case 'clicked':
      if (Number(rest[0]) === currentRun) {
        currentRun = 0
        if (activity.kind === 'clicking') activity = { kind: 'idle' }
        broadcast()
      }
      break
    case 'hk': {
      const action = watched[Number(rest[0])]
      if (action) runHotkey(action)
      break
    }
    case 'err':
      lastError = rest.join(' ')
      broadcast()
      break
    case 'note':
      logError('macros', new Error(rest.join(' ')))
      break
  }
}

// ---------- Hotkeys ----------

type HotkeyAction = { kind: 'record' } | { kind: 'play' } | { kind: 'clicker' } | { kind: 'macro'; id: string }
const registered = new Map<string, HotkeyAction>()
/** Hotkeys only take keys once you've used macros (so F6, F9 and F10 aren't taken from other apps for nothing). */
let used = false

/** When each hotkey last did something: one press can arrive twice (from Windows and from Orbit's own watch), and a held key repeats. */
const lastPress = new Map<string, number>()

function runHotkey(action: HotkeyAction): void {
  if (!addonOn('macros')) return
  const key = errorKey(action)
  const now = Date.now()
  if (now - (lastPress.get(key) ?? 0) < 350) return
  lastPress.set(key, now)
  // While something plays, every macro hotkey stops it: the simplest thing to remember when you need it to stop.
  if (activity.kind === 'playing' || activity.kind === 'clicking') {
    stopPlaying()
    return
  }
  if (action.kind === 'record') {
    if (activity.kind === 'recording') stopRecording()
    else if (activity.kind === 'idle') startRecording()
    return
  }
  if (activity.kind === 'recording') return
  if (action.kind === 'clicker') {
    startClicker()
    return
  }
  const id = action.kind === 'macro' ? action.id : data.current
  if (id) play(id)
}

const errorKey = (a: HotkeyAction): string => (a.kind === 'macro' ? a.id : a.kind)

function wantedHotkeys(): Map<string, HotkeyAction> {
  const out = new Map<string, HotkeyAction>()
  if (!used || !SUPPORTED || !addonOn('macros')) return out
  for (const m of data.macros) if (m.hotkey) out.set(m.hotkey, { kind: 'macro', id: m.id })
  const h = data.hotkeys
  if (h.clicker) out.set(h.clicker, { kind: 'clicker' })
  if (h.play) out.set(h.play, { kind: 'play' })
  if (h.record) out.set(h.record, { kind: 'record' })
  return out
}

/** The hotkeys the Windows helper watches for itself, by their place in the list it was sent. */
let watched: HotkeyAction[] = []

function applyHotkeys(): void {
  const wanted = wantedHotkeys()
  if (!IS_MAC && SUPPORTED && (used || winHelper)) {
    const list: string[] = []
    watched = []
    for (const [accel, action] of wanted) {
      const k = windowsHotkey(accel)
      if (!k) continue
      list.push(`${k.vk}:${k.mods}`)
      watched.push(action)
    }
    winWrite(`keys ${list.join(',')}`)
  }
  for (const [accel] of registered) {
    if (!wanted.has(accel)) {
      globalShortcut.unregister(accel)
      registered.delete(accel)
    }
  }
  for (const k of Object.keys(hotkeyErrors)) delete hotkeyErrors[k]
  for (const [accel, action] of wanted) {
    if (registered.has(accel)) {
      registered.set(accel, action)
      continue
    }
    try {
      if (globalShortcut.register(accel, () => runHotkey(registered.get(accel) ?? action))) registered.set(accel, action)
      else hotkeyErrors[errorKey(action)] = `${hotkeyLabel(accel)} is already used by ${SYSTEM_NAME}, another app or another part of Orbit. Pick different keys.`
    } catch {
      hotkeyErrors[errorKey(action)] = `${hotkeyLabel(accel)} can’t be used as a hotkey.`
    }
  }
}

/** A hotkey belongs to one thing: setting it somewhere takes it off anything else here. */
function freeHotkey(accel: string): void {
  if (!accel) return
  const hotkeys = { ...data.hotkeys }
  for (const k of Object.keys(hotkeys) as (keyof MacroHotkeys)[]) if (hotkeys[k] === accel) hotkeys[k] = ''
  data = { ...data, hotkeys, macros: data.macros.map((m) => (m.hotkey === accel ? { ...m, hotkey: '' } : m)) }
}

// ---------- Setup ----------

/** The macros folder, for syncing with your other computers. */
export const macrosFolder = folder

/** The folder was replaced (synced from another computer): read it again. */
export function reloadMacros(): void {
  load()
  used = used || existsSync(dataFile())
  applyHotkeys()
  broadcast()
}

function markUsed(): void {
  if (used) return
  used = true
  if (!existsSync(dataFile())) save()
  applyHotkeys()
  // The Windows helper takes a moment to start: start it now so the first recording isn't late.
  if (!IS_MAC && SUPPORTED) winWrite('ping')
}

export function setupMacros(): void {
  load()
  // Remapped keys are recorded as what they were remapped to (Windows; on a Mac macOS does that already).
  onRemapsChanged(() => {
    if (!IS_MAC && activity.kind === 'recording') winWrite(`recskip ${remappedKeyIds().join(',') || '-'}`)
  })
  used = existsSync(dataFile())
  // Removing the add-on stops anything playing or recording at once, and lets go of its hotkeys.
  onAddonsChanged(() => {
    if (!addonOn('macros')) stopAll()
    applyHotkeys()
    broadcast()
  })
  // Hotkeys (and the helper) after the handlers below, so the page always works even if they fail.
  setTimeout(() => {
    try {
      applyHotkeys()
    } catch (err) {
      logError('macros', err)
    }
  }, 0)

  ipcMain.handle('macros:get', () => {
    markUsed()
    return status()
  })
  ipcMain.handle('macros:record', () => {
    markUsed()
    if (activity.kind === 'recording') stopRecording()
    else startRecording()
    return status()
  })
  ipcMain.handle('macros:play', (_e, id: string) => {
    markUsed()
    if (typeof id === 'string') play(id)
    return status()
  })
  ipcMain.handle('macros:stop', () => {
    stopAll()
    return status()
  })
  ipcMain.handle('macros:clicker', (_e, on: boolean) => {
    markUsed()
    if (on) startClicker()
    else stopPlaying()
    return status()
  })
  ipcMain.handle('macros:update', (_e, id: string, patch: Record<string, unknown>) => {
    const macro = data.macros.find((m) => m.id === id)
    if (!macro || !patch || typeof patch !== 'object') return status()
    const p = patch as Partial<Macro>
    const hotkey = typeof p.hotkey === 'string' ? normalizeAccelerator(p.hotkey) : undefined
    if (hotkey) freeHotkey(hotkey)
    const merged = cleanMacro({
      ...data.macros.find((m) => m.id === id),
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
      ...(hotkey !== undefined ? { hotkey } : {}),
      ...(typeof p.repeat === 'string' ? { repeat: p.repeat } : {}),
      ...(typeof p.times === 'number' ? { times: p.times } : {}),
      ...(typeof p.speed === 'number' ? { speed: p.speed } : {}),
      ...(typeof p.mouse === 'string' ? { mouse: p.mouse } : {})
    })
    if (merged) data = { ...data, macros: data.macros.map((m) => (m.id === id ? merged : m)) }
    return changed()
  })
  ipcMain.handle('macros:remove', (_e, id: string) => {
    if (activity.kind === 'playing' && activity.id === id) stopPlaying()
    const macros = data.macros.filter((m) => m.id !== id)
    data = { ...data, macros, current: data.current === id ? (macros[0]?.id ?? '') : data.current }
    return changed()
  })
  ipcMain.handle('macros:current', (_e, id: string) => {
    if (data.macros.some((m) => m.id === id)) data = { ...data, current: id }
    return changed()
  })
  ipcMain.handle('macros:settings', (_e, patch: Record<string, unknown>) => {
    if (!patch || typeof patch !== 'object') return status()
    if (patch.hotkeys && typeof patch.hotkeys === 'object') {
      const h = patch.hotkeys as Partial<MacroHotkeys>
      for (const k of Object.keys(DEFAULT_HOTKEYS) as (keyof MacroHotkeys)[]) {
        if (typeof h[k] !== 'string') continue
        const accel = normalizeAccelerator(h[k]!)
        freeHotkey(accel)
        data = { ...data, hotkeys: { ...data.hotkeys, [k]: accel } }
      }
    }
    if (patch.clicker && typeof patch.clicker === 'object') data = { ...data, clicker: cleanClicker({ ...data.clicker, ...(patch.clicker as object) }) }
    if (typeof patch.skipLeadingWait === 'boolean') data = { ...data, skipLeadingWait: patch.skipLeadingWait }
    return changed()
  })
  ipcMain.handle('macros:dismiss', () => {
    lastError = null
    lastPlay = null
    broadcast()
  })
  /** Where the pointer is now, in the helper's units (real pixels on Windows, points on a Mac). */
  ipcMain.handle('macros:pointer', () => {
    const p = screen.getCursorScreenPoint()
    return IS_MAC ? p : screen.dipToScreenPoint(p)
  })
}

export function teardownMacros(): void {
  stopAll()
  for (const [accel] of registered) globalShortcut.unregister(accel)
  registered.clear()
  if (winHelper) {
    // Closing its input lets it stop cleanly (and let go of anything it was holding).
    winHelper.stdin.end()
    const child = winHelper
    setTimeout(() => child.kill(), 1500)
    winHelper = null
  }
  if (macRun) macStop()
}
