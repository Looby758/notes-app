import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { systemPreferences } from 'electron'
import { IS_MAC } from '@shared/platform'
import { logError } from './log'

/**
 * The phone as a keyboard and touchpad: moves the pointer, clicks, scrolls and types into whatever
 * app is in front, like a real mouse and keyboard would. Nothing is installed for it: on Windows a
 * PowerShell helper calls SendInput, and on a Mac a JavaScript-for-Automation helper posts Quartz
 * events (which needs Notes allowed under Privacy & Security → Accessibility). The helper starts
 * when the phone first uses it and stays running while Notes is open.
 */

export type PhoneKey = 'enter' | 'backspace' | 'tab' | 'escape' | 'left' | 'right' | 'up' | 'down'

export type PhoneInput =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'click'; button: 'left' | 'right' }
  | { kind: 'scroll'; dy: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: PhoneKey }

const WIN_KEYS: Record<PhoneKey, number> = { enter: 0x0d, backspace: 0x08, tab: 0x09, escape: 0x1b, left: 0x25, up: 0x26, right: 0x27, down: 0x28 }
const MAC_KEYS: Record<PhoneKey, number> = { enter: 36, backspace: 51, tab: 48, escape: 53, left: 123, right: 124, down: 125, up: 126 }

const WIN_HELPER = String.raw`
$src = @'
using System; using System.Runtime.InteropServices;
public static class PhoneInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Mouse(uint flags, int dx, int dy, int data) { INPUT i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = unchecked((uint)data); i.u.mi.dwFlags = flags; Send(i); }
  static void Kbd(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; Send(i); }
  public static void Move(int dx, int dy) { Mouse(0x0001, dx, dy, 0); }
  public static void Click(bool right) { Mouse(right ? 0x0008u : 0x0002u, 0, 0, 0); Mouse(right ? 0x0010u : 0x0004u, 0, 0, 0); }
  public static void Wheel(int d) { Mouse(0x0800, 0, 0, d); }
  public static void Key(ushort vk) { Kbd(vk, 0, 0); Kbd(vk, 0, 0x0002); }
  public static void Text(string s) { foreach (char c in s) { Kbd(0, c, 0x0004); Kbd(0, c, 0x0006); } }
}
'@
Add-Type -TypeDefinition $src
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  switch ($p[0]) {
    'm' { [PhoneInput]::Move([int]$p[1], [int]$p[2]) }
    'c' { [PhoneInput]::Click($p[1] -eq 'right') }
    'w' { [PhoneInput]::Wheel([int]$p[1]) }
    'k' { [PhoneInput]::Key([uint16]$p[1]) }
    't' { [PhoneInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
  }
}
`

// Quartz event numbers (CGEventType), so nothing depends on the bridge knowing the constant names.
const MAC_HELPER = String.raw`
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')
const events = Application('System Events')
function here() { return $.CGEventGetLocation($.CGEventCreate(null)) }
function post(type, at, button) { $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, at, button)) }
function run(p) {
  if (p[0] === 'm') { const at = here(); post(5, $.CGPointMake(at.x + Number(p[1]), at.y + Number(p[2])), 0) }
  else if (p[0] === 'c') { const right = p[1] === 'right'; const at = here(); post(right ? 3 : 1, at, right ? 1 : 0); post(right ? 4 : 2, at, right ? 1 : 0) }
  else if (p[0] === 'w') {
    // A real scroll (pixels; positive scrolls down), or arrow keys where the bridge doesn't have it.
    try { $.CGEventPost(0, $.CGEventCreateScrollWheelEvent2(null, 0, 1, -Number(p[1]), 0, 0)) }
    catch (e) { const lines = Math.max(1, Math.round(Math.abs(Number(p[1])) / 40)); for (let i = 0; i < lines; i++) events.keyCode(Number(p[1]) > 0 ? 125 : 126) }
  }
  else if (p[0] === 'k') events.keyCode(Number(p[1]))
  else if (p[0] === 't') events.keystroke($.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions(p[1], 0), $.NSUTF8StringEncoding).js)
}
const input = $.NSFileHandle.fileHandleWithStandardInput
let buffer = ''
for (;;) {
  const data = input.availableData
  if (data.length === 0) break
  buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl)
    buffer = buffer.slice(nl + 1)
    try { run(line.split(' ')) } catch (e) { console.log(String(e)) }
  }
}
`

let helper: ChildProcessWithoutNullStreams | null = null

function startHelper(): ChildProcessWithoutNullStreams {
  const child = IS_MAC
    ? spawn('osascript', ['-l', 'JavaScript', '-e', MAC_HELPER])
    : spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_HELPER, 'utf16le').toString('base64')], {
        windowsHide: true
      })
  child.stderr.on('data', (d: Buffer) => logError('phone input', new Error(d.toString().trim())))
  child.on('error', (err) => logError('phone input', err))
  child.on('exit', () => {
    if (helper === child) helper = null
  })
  return child
}

/** Whether the phone can control this computer yet; on a Mac, asks for Accessibility the first time. */
export function inputAllowed(): boolean {
  return !IS_MAC || systemPreferences.isTrustedAccessibilityClient(true)
}

export function sendInput(input: PhoneInput): void {
  if (!inputAllowed()) throw new Error('Allow Notes in System Settings → Privacy & Security → Accessibility, then try again.')
  helper ??= startHelper()
  const clamp = (n: number): number => Math.max(-2000, Math.min(2000, Math.round(Number(n) || 0)))
  let line: string
  switch (input.kind) {
    case 'move':
      line = `m ${clamp(input.dx)} ${clamp(input.dy)}`
      break
    case 'click':
      line = `c ${input.button === 'right' ? 'right' : 'left'}`
      break
    case 'scroll':
      // The phone sends pixels, positive to scroll down. Windows wants wheel units (120 a notch), positive for up.
      line = `w ${IS_MAC ? clamp(input.dy) : clamp(-input.dy * 3)}`
      break
    case 'key': {
      const code = (IS_MAC ? MAC_KEYS : WIN_KEYS)[input.key]
      if (code === undefined) return
      line = `k ${code}`
      break
    }
    case 'type':
      if (!input.text) return
      line = `t ${Buffer.from(String(input.text).slice(0, 2000), 'utf8').toString('base64')}`
      break
    default:
      return
  }
  helper.stdin.write(line + '\n')
}

export function stopInput(): void {
  helper?.kill()
  helper = null
}
