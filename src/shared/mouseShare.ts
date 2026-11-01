/**
 * One mouse, two computers: the parts that are plain logic (no Electron, no network), so they can
 * be tested. Where the other computer sits, finding the shared screen edge, where the pointer comes
 * in on the other side, and which key is which on Windows and on a Mac.
 */

/** Where the other computer is, seen from this one. */
export type ShareSide = 'left' | 'right' | 'above' | 'below'
export type ShareOs = 'win' | 'mac'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Point {
  x: number
  y: number
}

export const SHARE_SIDES: ShareSide[] = ['left', 'right', 'above', 'below']

export const oppositeSide = (side: ShareSide): ShareSide =>
  side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'above' ? 'below' : 'above'

const horizontal = (side: ShareSide): boolean => side === 'left' || side === 'right'

/**
 * The outer edge of all this computer's screens on one side: the line it's on, and the screens that
 * touch it (with two screens side by side, only the far one has the right-hand edge).
 */
export function outerEdge(displays: Rect[], side: ShareSide): { line: number; touching: Rect[]; from: number; to: number } {
  if (displays.length === 0) return { line: 0, touching: [], from: 0, to: 0 }
  const edgeOf = (d: Rect): number =>
    side === 'left' ? d.x : side === 'right' ? d.x + d.width : side === 'above' ? d.y : d.y + d.height
  const pick = side === 'left' || side === 'above' ? Math.min : Math.max
  const line = pick(...displays.map(edgeOf))
  const touching = displays.filter((d) => edgeOf(d) === line)
  const starts = touching.map((d) => (horizontal(side) ? d.y : d.x))
  const ends = touching.map((d) => (horizontal(side) ? d.y + d.height : d.x + d.width))
  return { line, touching, from: Math.min(...starts), to: Math.max(...ends) }
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/**
 * Whether the pointer is pressed against the edge the other computer is on. Returns how far along
 * that edge it is (0 to 1: top to bottom, or left to right), or null when it isn't there.
 */
export function edgeHit(point: Point, displays: Rect[], side: ShareSide): number | null {
  const edge = outerEdge(displays, side)
  if (!edge.touching.length) return null
  const along = horizontal(side) ? point.y : point.x
  const onTouching = edge.touching.some((d) =>
    horizontal(side) ? point.y >= d.y && point.y < d.y + d.height : point.x >= d.x && point.x < d.x + d.width
  )
  if (!onTouching) return null
  const across = horizontal(side) ? point.x : point.y
  // The pointer can't go past the last pixel, so "at the edge" is the last pixel on the right/bottom.
  const at = side === 'left' || side === 'above' ? across <= edge.line : across >= edge.line - 1
  if (!at) return null
  return edge.to > edge.from ? clamp01((along - edge.from) / (edge.to - edge.from)) : 0.5
}

/**
 * Where the pointer comes in when it arrives from the computer on `from`: on that edge, `fraction`
 * of the way along it, a couple of pixels in so it doesn't bounce straight back.
 */
export function entryPoint(displays: Rect[], from: ShareSide, fraction: number): Point {
  const edge = outerEdge(displays, from)
  const along = edge.from + clamp01(fraction) * Math.max(0, edge.to - edge.from - 1)
  const inset = 3
  const across = from === 'left' || from === 'above' ? edge.line + inset : edge.line - 1 - inset
  return clampToDisplays(horizontal(from) ? { x: across, y: along } : { x: along, y: across }, displays)
}

/** Keeps a point on one of the screens (the nearest one if it's off them all). */
export function clampToDisplays(p: Point, displays: Rect[]): Point {
  if (displays.length === 0) return p
  let best: Point = p
  let bestDistance = Infinity
  for (const d of displays) {
    const x = Math.max(d.x, Math.min(d.x + d.width - 1, p.x))
    const y = Math.max(d.y, Math.min(d.y + d.height - 1, p.y))
    const dist = (x - p.x) ** 2 + (y - p.y) ** 2
    if (dist === 0) return p
    if (dist < bestDistance) {
      bestDistance = dist
      best = { x, y }
    }
  }
  return best
}

/**
 * The pointer on the computer being controlled, moved by (dx, dy). It goes back to the computer on
 * `home` when it's pushed past the edge on that side: `back` is then how far along the edge it was.
 */
export function movePointer(from: Point, dx: number, dy: number, displays: Rect[], home: ShareSide): { point: Point; back: number | null } {
  const next = { x: from.x + dx, y: from.y + dy }
  const edge = outerEdge(displays, home)
  const past =
    home === 'left' ? next.x < edge.line : home === 'right' ? next.x > edge.line - 1 : home === 'above' ? next.y < edge.line : next.y > edge.line - 1
  if (past && edge.touching.length) {
    const along = horizontal(home) ? from.y : from.x
    if (along >= edge.from && along < edge.to) {
      return { point: clampToDisplays(next, displays), back: edge.to > edge.from ? clamp01((along - edge.from) / (edge.to - edge.from)) : 0.5 }
    }
  }
  return { point: clampToDisplays(next, displays), back: null }
}

/** The 6-digit code both computers show while pairing, worked out from the pairing's handshake. */
export function pairingCode(digest: Uint8Array): string {
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
  return String(n % 1_000_000).padStart(6, '0')
}

/** A computer's name for the list: "Harrys-MacBook-Air.local" → "Harrys MacBook Air". */
export function deviceName(hostname: string): string {
  const name = hostname.replace(/\.(local|lan|home)$/i, '').replace(/[-_]+/g, ' ').trim()
  return (name || 'Computer').slice(0, 60)
}

// ---------- Keys ----------
// Keys travel by their physical position (KeyboardEvent.code), and each computer types them with
// its own key numbers, so the letter that comes out follows that computer's keyboard layout.

const WIN_VK: Record<string, number> = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Pause: 0x13, CapsLock: 0x14, Escape: 0x1b, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e, MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f, NumpadEnter: 0x0d,
  NumLock: 0x90, ScrollLock: 0x91, ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3, AltLeft: 0xa4, AltRight: 0xa5,
  AudioVolumeMute: 0xad, AudioVolumeDown: 0xae, AudioVolumeUp: 0xaf, MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
  Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, Backquote: 0xc0,
  BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde, IntlBackslash: 0xe2
}
for (let i = 0; i < 26; i++) WIN_VK[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i
for (let i = 0; i < 10; i++) {
  WIN_VK[`Digit${i}`] = 0x30 + i
  WIN_VK[`Numpad${i}`] = 0x60 + i
}
for (let i = 1; i <= 24; i++) WIN_VK[`F${i}`] = 0x6f + i

/** Keys Windows needs the "extended" flag for (the arrows and the block above them, right Ctrl/Alt…). */
const WIN_EXTENDED = new Set([
  'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete', 'PrintScreen',
  'MetaLeft', 'MetaRight', 'ContextMenu', 'NumpadDivide', 'NumpadEnter', 'NumLock', 'ControlRight', 'AltRight',
  'AudioVolumeMute', 'AudioVolumeDown', 'AudioVolumeUp', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaStop', 'MediaPlayPause'
])

/** Mac key numbers (kVK_…). Print Screen, Scroll Lock and Pause become F13, F14 and F15, as on Apple keyboards. */
const MAC_KEY: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, IntlBackslash: 10, KeyB: 11,
  KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22,
  Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
  BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42,
  Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Escape: 53,
  MetaRight: 54, MetaLeft: 55, ShiftLeft: 56, CapsLock: 57, AltLeft: 58, ControlLeft: 59, ShiftRight: 60, AltRight: 61,
  ControlRight: 62, F17: 64, NumpadDecimal: 65, NumpadMultiply: 67, NumpadAdd: 69, NumLock: 71, AudioVolumeUp: 72,
  AudioVolumeDown: 73, AudioVolumeMute: 74, NumpadDivide: 75, NumpadEnter: 76, NumpadSubtract: 78, F18: 79, F19: 80,
  NumpadEqual: 81, Numpad0: 82, Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86, Numpad5: 87, Numpad6: 88, Numpad7: 89,
  F20: 90, Numpad8: 91, Numpad9: 92, IntlYen: 93, IntlRo: 94, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103,
  F13: 105, PrintScreen: 105, F16: 106, F14: 107, ScrollLock: 107, F10: 109, ContextMenu: 110, F12: 111, F15: 113, Pause: 113,
  Insert: 114, Home: 115, PageUp: 116, Delete: 117, F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122, ArrowLeft: 123,
  ArrowRight: 124, ArrowDown: 125, ArrowUp: 126
}

/** Ctrl and ⌘ swap places on the Mac side (when that's on), so Ctrl+C copies on both computers. */
const SWAP: Record<string, string> = { ControlLeft: 'MetaLeft', MetaLeft: 'ControlLeft', ControlRight: 'MetaRight', MetaRight: 'ControlRight' }
export const swapCtrlCmd = (code: string): string => SWAP[code] ?? code

/** The Windows key to press for a key code: its virtual-key number and whether it's an extended key. */
export function windowsKey(code: string): { vk: number; extended: boolean } | null {
  const vk = WIN_VK[code]
  return vk === undefined ? null : { vk, extended: WIN_EXTENDED.has(code) }
}

/** The Mac key number for a key code. */
export function macKey(code: string): number | null {
  const k = MAC_KEY[code]
  return k === undefined ? null : k
}

export const isKnownKey = (code: string): boolean => code in WIN_VK || code in MAC_KEY

/** Mouse buttons by number, as in MouseEvent.button. */
export type ShareButton = 0 | 1 | 2

/** What one computer tells the other once they're connected. */
export type ShareMessage =
  | { t: 'ready' }
  | { t: 'ping' }
  /** The pointer is coming over, `f` of the way along the shared edge. */
  | { t: 'enter'; f: number }
  | { t: 'move'; dx: number; dy: number }
  | { t: 'btn'; b: ShareButton; down: boolean }
  | { t: 'wheel'; dx: number; dy: number }
  | { t: 'key'; code: string; down: boolean }
  /** The pointer went back over the edge (`f` along it), or (no `f`) someone used this computer's own mouse. */
  | { t: 'leave'; f?: number }
  /** The controlling computer stopped (e.g. the "come back" keys): let go of everything. */
  | { t: 'release' }
  | { t: 'clip'; text?: string; html?: string; png?: string }
  /** "You're on my <side>". */
  | { t: 'side'; side: ShareSide }
  | { t: 'pair-ok' }
  | { t: 'unpair' }
  | { t: 'file-start'; id: string; name: string; size: number }
  | { t: 'file-data'; id: string; data: string }
  | { t: 'file-end'; id: string }
  | { t: 'files-done'; count: number; first: string }
  /** A screen session (see screenLink.ts): asked for, set up (WebRTC offer/answer/candidates), used, ended. */
  | { t: 'scr-start'; id: string; mode: 'extend' | 'control' }
  | { t: 'scr-sig'; id: string; data: unknown }
  | { t: 'scr-in'; id: string; e: unknown }
  | { t: 'scr-stop'; id: string; reason?: string }

/** A received file's place under the folder it's saved in: no "..", no drive letters, no odd characters. */
export function safeRelativePath(name: string): string | null {
  const parts = String(name)
    .split(/[\\/]+/)
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim())
    .filter((p) => p && p !== '.' && p !== '..')
  if (parts.length === 0 || parts.length > 40) return null
  return parts.join('/').slice(0, 1000)
}
