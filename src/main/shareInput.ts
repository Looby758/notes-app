import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { app, screen, systemPreferences } from 'electron'
import { IS_MAC } from '@shared/platform'
import { macKey, swapCtrlCmd, windowsKey, type ShareButton } from '@shared/mouseShare'
import { logError } from './log'
import { loadSettings, saveSettings } from './settings'

/**
 * Moving the pointer, pressing buttons and keys on this computer for the other one (one mouse, two
 * computers). Like the phone touchpad, nothing is installed for it: on Windows a PowerShell helper
 * calls SendInput, and on a Mac a JavaScript-for-Automation helper posts Quartz events (which needs
 * Orbit allowed under Privacy & Security → Accessibility). This helper is separate from the phone's,
 * because it also holds buttons and keys down (for dragging and shortcuts) and answers questions.
 */

const WIN_HELPER = String.raw`
$src = @'
using System; using System.Runtime.InteropServices;
public static class ShareInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Mouse(uint flags, int dx, int dy, int data) { INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = unchecked((uint)data); i.u.mi.dwFlags = flags; Send(i); }
  public static void Move(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = Math.Max(2, GetSystemMetrics(78)), vh = Math.Max(2, GetSystemMetrics(79));
    int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    Mouse(0x0001 | 0x8000 | 0x4000, nx, ny, 0);
  }
  public static void Button(int b, bool down) {
    uint f = b == 0 ? (down ? 0x0002u : 0x0004u) : b == 2 ? (down ? 0x0008u : 0x0010u) : (down ? 0x0020u : 0x0040u);
    Mouse(f, 0, 0, 0);
  }
  public static void Wheel(int dx, int dy) { if (dy != 0) Mouse(0x0800, 0, 0, dy); if (dx != 0) Mouse(0x01000, 0, 0, dx); }
  public static void Key(ushort vk, bool ext, bool down) {
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i.u.ki.dwFlags = (ext ? 0x0001u : 0u) | (down ? 0u : 0x0002u); Send(i);
  }
  public static bool LeftDown() { int vk = GetSystemMetrics(23) != 0 ? 0x02 : 0x01; return (GetAsyncKeyState(vk) & 0x8000) != 0; }
}
'@
Add-Type -TypeDefinition $src
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'm' { [ShareInput]::Move([int]$p[1], [int]$p[2]) }
      'd' { [ShareInput]::Button([int]$p[1], $true) }
      'u' { [ShareInput]::Button([int]$p[1], $false) }
      'w' { [ShareInput]::Wheel([int]$p[1], [int]$p[2]) }
      'k' { [ShareInput]::Key([uint16]$p[1], $p[2] -eq '1', $p[3] -eq '1') }
      'b' { [Console]::Out.WriteLine('b ' + $p[1] + ' ' + $(if ([ShareInput]::LeftDown()) { '1' } else { '0' })); [Console]::Out.Flush() }
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
`

// Quartz event and field numbers, so nothing depends on the bridge knowing the constant names.
const MAC_HELPER = String.raw`
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')
const out = $.NSFileHandle.fileHandleWithStandardOutput
function say(s) { out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)) }
const MOD = { 56: 0x20000, 60: 0x20000, 59: 0x40000, 62: 0x40000, 58: 0x80000, 61: 0x80000, 55: 0x100000, 54: 0x100000 }
const heldMods = {}
let caps = false
const held = { 0: false, 1: false, 2: false }
let at = null
let lastDown = { b: -1, t: 0, x: 0, y: 0, n: 0 }
function flags() { let f = caps ? 0x10000 : 0; for (const k in heldMods) if (heldMods[k]) f |= MOD[k]; return f }
function here() { return $.CGEventGetLocation($.CGEventCreate(null)) }
// Our buttons: 0 left, 1 middle, 2 right. Quartz's: 0 left, 1 right, 2 middle.
const QB = { 0: 0, 1: 2, 2: 1 }
function mouse(type, point, button, clicks) {
  const e = $.CGEventCreateMouseEvent(null, type, point, button)
  if (clicks) $.CGEventSetIntegerValueField(e, 1, clicks)
  $.CGEventSetFlags(e, flags())
  $.CGEventPost(0, e)
}
function run(p) {
  if (p[0] === 'm') {
    const point = $.CGPointMake(Number(p[1]), Number(p[2]))
    const type = held[0] ? 6 : held[2] ? 7 : held[1] ? 27 : 5
    const button = held[0] ? 0 : held[2] ? 1 : held[1] ? 2 : 0
    const e = $.CGEventCreateMouseEvent(null, type, point, button)
    if (at) { $.CGEventSetIntegerValueField(e, 4, Math.round(point.x - at.x)); $.CGEventSetIntegerValueField(e, 5, Math.round(point.y - at.y)) }
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
    at = { x: point.x, y: point.y }
  } else if (p[0] === 'd' || p[0] === 'u') {
    const b = Number(p[1]); const down = p[0] === 'd'
    const point = here(); const now = Date.now()
    if (down) {
      const again = lastDown.b === b && now - lastDown.t < 450 && Math.abs(point.x - lastDown.x) < 6 && Math.abs(point.y - lastDown.y) < 6
      lastDown = { b, t: now, x: point.x, y: point.y, n: again ? lastDown.n + 1 : 1 }
    }
    held[b] = down
    const type = b === 0 ? (down ? 1 : 2) : b === 2 ? (down ? 3 : 4) : (down ? 25 : 26)
    mouse(type, point, QB[b], lastDown.b === b ? lastDown.n : 1)
  } else if (p[0] === 'w') {
    const e = $.CGEventCreateScrollWheelEvent2(null, 0, 2, -Number(p[2]), -Number(p[1]), 0)
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  } else if (p[0] === 'k') {
    const code = Number(p[1]); const down = p[2] === '1'
    if (code in MOD) heldMods[code] = down
    if (code === 57 && down) caps = !caps
    const e = $.CGEventCreateKeyboardEvent(null, code, down)
    $.CGEventSetFlags(e, flags())
    $.CGEventPost(0, e)
  } else if (p[0] === 'b') {
    say('b ' + p[1] + ' ' + ($.CGEventSourceButtonState(0, 0) ? '1' : '0'))
  }
}
const input = $.NSFileHandle.fileHandleWithStandardInput
let buffer = ''
for (;;) {
  const data = input.availableData
  if (data.length === 0) break
  buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
  const lines = buffer.split('\n')
  buffer = lines.pop()
  for (let i = 0; i < lines.length; i++) {
    // Only the last of a run of moves matters (they're positions), so a backlog never builds up.
    if (lines[i][0] === 'm' && i + 1 < lines.length && lines[i + 1][0] === 'm') continue
    try { run(lines[i].split(' ')) } catch (e) { console.log(String(e)) }
  }
}
`

let helper: ChildProcessWithoutNullStreams | null = null
const waiting = new Map<number, (down: boolean) => void>()
let nextQuestion = 1
const heldKeys = new Set<string>()
const heldButtons = new Set<ShareButton>()
let swap = true

function startHelper(): ChildProcessWithoutNullStreams {
  const child = IS_MAC
    ? spawn('osascript', ['-l', 'JavaScript', '-e', MAC_HELPER])
    : spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')], {
        windowsHide: true
      })
  let out = ''
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString()
    let nl
    while ((nl = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, nl).trim()
      out = out.slice(nl + 1)
      const [kind, id, value] = line.split(' ')
      if (kind === 'b') {
        waiting.get(Number(id))?.(value === '1')
        waiting.delete(Number(id))
      }
    }
  })
  child.stderr.on('data', (d: Buffer) => logError('mouse sharing input', new Error(d.toString().trim())))
  child.on('error', (err) => logError('mouse sharing input', err))
  // If the helper couldn't start (or stopped), writing to it mustn't bring Orbit down.
  child.stdin.on('error', (err) => logError('mouse sharing input', err))
  child.on('exit', () => {
    if (helper === child) helper = null
    for (const w of waiting.values()) w(false)
    waiting.clear()
  })
  return child
}

function write(line: string): void {
  helper ??= startHelper()
  helper.stdin.write(line + '\n')
}

// ---------- Mac Accessibility ----------
//
// Orbit is signed "ad hoc" (no paid Apple certificate), so to macOS every update is a different
// app. The Accessibility list keeps showing Orbit switched on, but that entry belongs to the old
// copy and does nothing for this one. Asking again just shows macOS's prompt over and over (it
// used to, every time the pointer reached the edge), so: macOS's prompt at most once per version,
// and after that Orbit explains the real fix (remove Orbit from the list and add it again).

let askedThisRun = false

const accessNotes = (): { workedIn?: string; askedIn?: string } => loadSettings().accessibility ?? {}

function trusted(): boolean {
  const ok = systemPreferences.isTrustedAccessibilityClient(false)
  if (ok && accessNotes().workedIn !== app.getVersion()) saveSettings({ accessibility: { ...accessNotes(), workedIn: app.getVersion() } })
  return ok
}

/**
 * Accessibility is off, but it isn't the first time: it worked in an older version (so this is an
 * update), or macOS's prompt was already shown for this version and it's still off.
 */
export function accessibilityStale(): boolean {
  if (!IS_MAC || trusted()) return false
  const { workedIn, askedIn } = accessNotes()
  return (!!workedIn && workedIn !== app.getVersion()) || askedIn === app.getVersion()
}

/**
 * Whether Orbit may move the pointer here. On a Mac, `ask` shows macOS's Accessibility prompt,
 * but only once per version (and never when the permission looks stale): see above.
 * `force` (a button you pressed) shows it regardless.
 */
export function inputAllowed(ask = false, force = false): boolean {
  if (!IS_MAC || trusted()) return true
  if (!ask) return false
  if (!force && (askedThisRun || accessibilityStale())) return false
  askedThisRun = true
  saveSettings({ accessibility: { ...accessNotes(), askedIn: app.getVersion() } })
  return systemPreferences.isTrustedAccessibilityClient(true)
}

/** What to tell you when Accessibility is off. */
export function accessibilityHelp(): string {
  return accessibilityStale()
    ? 'If Orbit already shows as switched on in System Settings → Privacy & Security → Accessibility, macOS is holding that permission for an older copy of Orbit (each update counts as a new app to it), so it does nothing. Select Orbit there, remove it with −, then add it again with + (or press “Fix the permission” in Settings → Mouse sharing).'
    : 'Allow Orbit in System Settings → Privacy & Security → Accessibility, then try again.'
}

/**
 * Clears macOS's Accessibility entry for Orbit (the stale one for an older copy), then shows the
 * prompt so this copy can be added. Only touches Orbit's own entry.
 */
export function resetAccessibility(): Promise<boolean> {
  if (!IS_MAC) return Promise.resolve(true)
  const bundleId = app.isPackaged ? 'com.notesapp.desktop' : ''
  return new Promise((resolve) => {
    if (!bundleId) return resolve(false)
    execFile('/usr/bin/tccutil', ['reset', 'Accessibility', bundleId], (err) => {
      if (err) {
        logError('accessibility reset', err)
        return resolve(false)
      }
      saveSettings({ accessibility: {} })
      askedThisRun = false
      resolve(inputAllowed(true, true))
    })
  })
}

/** Swap Ctrl and ⌘ on a Mac (so Ctrl+C on the PC's keyboard is ⌘C here). */
export function setSwapCtrlCmd(on: boolean): void {
  swap = on
}

/** Puts the pointer at a point in screen coordinates (as Electron's `screen` gives them). */
export function movePointerTo(x: number, y: number): void {
  // Windows wants real pixels; Electron's points are scaled by each screen's zoom.
  const p = IS_MAC ? { x, y } : screen.dipToScreenPoint({ x, y })
  write(`m ${Math.round(p.x)} ${Math.round(p.y)}`)
}

export function pressButton(button: ShareButton, down: boolean): void {
  if (![0, 1, 2].includes(button)) return
  if (down) heldButtons.add(button)
  else heldButtons.delete(button)
  write(`${down ? 'd' : 'u'} ${button}`)
}

/** Scrolls by pixels, positive to scroll down / right (as in a wheel event). */
export function scroll(dx: number, dy: number): void {
  const c = (n: number): number => Math.max(-5000, Math.min(5000, Math.round(Number(n) || 0)))
  // Windows wants wheel units (120 a notch, a notch is ~100px in Chromium) and positive for up.
  if (IS_MAC) write(`w ${c(dx)} ${c(dy)}`)
  else write(`w ${c(dx * 1.2)} ${c(-dy * 1.2)}`)
}

export function pressKey(code: string, down: boolean): void {
  if (IS_MAC) {
    const k = macKey(swap ? swapCtrlCmd(code) : code)
    if (k === null) return
    write(`k ${k} ${down ? 1 : 0}`)
  } else {
    const k = windowsKey(code)
    if (!k) return
    write(`k ${k.vk} ${k.extended ? 1 : 0} ${down ? 1 : 0}`)
  }
  if (down) heldKeys.add(code)
  else heldKeys.delete(code)
}

/** Lets go of every key and button held for the other computer, so nothing is left stuck down. */
export function releaseAll(): void {
  for (const code of [...heldKeys]) pressKey(code, false)
  for (const b of [...heldButtons]) pressButton(b, false)
}

/** Whether the left button is held down right now (someone is dragging something). */
export function leftButtonDown(): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextQuestion++
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(false)
    }, 500)
    waiting.set(id, (down) => {
      clearTimeout(timer)
      resolve(down)
    })
    write(`b ${id}`)
  })
}

export function stopShareInput(): void {
  helper?.kill()
  helper = null
}
