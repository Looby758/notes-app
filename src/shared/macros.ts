/**
 * The macro recorder and auto-clicker: the parts that are plain logic (no Electron, no helpers),
 * so they can be tested.
 *
 * The whole point is that a macro plays back exactly as it was done. So every key and button is
 * recorded as two moments, when it went down and when it came up (a key held for 1.25 s is held for
 * 1.25 s again), and every movement of the mouse with its own time. Times are in milliseconds with
 * microsecond detail, taken by the helper the moment Windows or macOS reports the input, and the
 * helper (not Electron) plays them back against a high-resolution clock, so nothing drifts: event
 * 5,000 is due at start + its own time, never "the last one plus a gap".
 *
 * Nothing here ever turns macros off for a game or server: that's up to you.
 */

import { codeFromMac, codeFromWindows, macKey, windowsKey } from './mouseShare'
import { NAMED, normalizeAccelerator } from './soundboard'

/** Mouse buttons as in MouseEvent.button: left, middle, right, back, forward. */
export type MacroButton = 0 | 1 | 2 | 3 | 4

export type MacroEvent =
  /** A key went down (kd), came up (ku), or repeated while held (kr, the computer's own key repeat). `sc` is the Windows scan code. */
  | { t: number; k: 'kd' | 'ku' | 'kr'; code: string; sc?: number }
  | { t: number; k: 'bd' | 'bu'; b: MacroButton }
  /** The pointer moved to x, y (screen pixels). `h` means the pointer was hidden, i.e. a game had the mouse. */
  | { t: number; k: 'mm'; x: number; y: number; h?: 1 }
  /** Raw mouse movement (what games read for the camera), in mouse counts. */
  | { t: number; k: 'mr'; dx: number; dy: number }
  /** The wheel, in notches (positive is up / right). */
  | { t: number; k: 'wh'; dx: number; dy: number }

export type MacroOs = 'win' | 'mac'

/**
 * How the mouse is played back.
 * - auto: where the pointer was, except while a game had the mouse (pointer hidden), where the
 *   raw movement is played instead so the camera turns the same.
 * - positions: always where the pointer was (desktop, menus).
 * - raw: always the raw movement (a game's camera).
 * - none: keys, clicks and the wheel only; the mouse isn't moved.
 */
export type MacroMouseMode = 'auto' | 'positions' | 'raw' | 'none'
export const MOUSE_MODES: { id: MacroMouseMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automatic', hint: 'Pointer positions on the desktop and in menus, the game’s own mouse movement while a game has the mouse (camera turns the same).' },
  { id: 'positions', label: 'Pointer positions', hint: 'Puts the pointer exactly where it was. Best for the desktop, menus and inventories.' },
  { id: 'raw', label: 'Game camera', hint: 'Plays the mouse movement itself, the way games read it, so the camera turns by the same amount.' },
  { id: 'none', label: 'Don’t move the mouse', hint: 'Keys, clicks and scrolling only.' }
]

export type MacroRepeat = 'once' | 'times' | 'forever'

export interface Macro {
  id: string
  name: string
  created: number
  /** Which computer recorded it (pointer positions belong to that computer's screens). */
  os: MacroOs
  events: MacroEvent[]
  /** How long one go lasts in ms: from the start to when you stopped recording, so a repeat waits as long as you did. */
  length: number
  /** Play / stop hotkey for this macro (Electron accelerator) or ''. */
  hotkey: string
  repeat: MacroRepeat
  /** How many times, for repeat 'times'. */
  times: number
  /** 1 is as recorded; 2 is twice as fast. */
  speed: number
  mouse: MacroMouseMode
}

export type ClickerWhat = 'left' | 'right' | 'middle' | 'key'
export type ClickerStop = 'never' | 'clicks' | 'seconds'

export interface ClickerSettings {
  what: ClickerWhat
  /** The key (KeyboardEvent.code) for what 'key'. */
  key: string
  /** Time from one click to the next, in ms (the speed). */
  intervalMs: number
  /** How long each click (or key press) is held down, in ms. */
  holdMs: number
  stop: ClickerStop
  stopAfter: number
  /** Click wherever the pointer is, or always at one spot. */
  where: 'pointer' | 'spot'
  x: number
  y: number
}

export interface MacroHotkeys {
  /** Start / stop recording a new macro. */
  record: string
  /** Play / stop the macro picked on the page. */
  play: string
  /** Start / stop the auto-clicker. */
  clicker: string
}

export interface MacrosData {
  macros: Macro[]
  hotkeys: MacroHotkeys
  clicker: ClickerSettings
  /** The macro the Play hotkey plays. */
  current: string
  /** Leave out the wait before your first key or click. */
  trimStart: boolean
}

export const DEFAULT_HOTKEYS: MacroHotkeys = { record: 'F9', play: 'F10', clicker: 'F6' }

export const DEFAULT_CLICKER: ClickerSettings = {
  what: 'left',
  key: 'KeyE',
  intervalMs: 100,
  holdMs: 20,
  stop: 'never',
  stopAfter: 100,
  where: 'pointer',
  x: 0,
  y: 0
}

/** Fastest the auto-clicker goes: 1,000 clicks a second. */
export const MIN_INTERVAL_MS = 1
export const MAX_INTERVAL_MS = 24 * 3600_000
export const MACRO_LIMIT = 300
export const MAX_SPEED = 10
export const MIN_SPEED = 0.1

export const emptyMacros = (): MacrosData => ({ macros: [], hotkeys: { ...DEFAULT_HOTKEYS }, clicker: { ...DEFAULT_CLICKER }, current: '', trimStart: true })

// ---------- Cleaning saved data ----------

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
/** Microsecond detail is plenty (and keeps the file small). */
export const roundT = (t: number): number => Math.round(t * 1000) / 1000

function cleanEvent(raw: unknown): MacroEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const t = num(e.t, NaN)
  if (!Number.isFinite(t) || t < 0) return null
  switch (e.k) {
    case 'kd':
    case 'ku':
    case 'kr': {
      const code = str(e.code, 40)
      if (!/^[A-Za-z0-9]+$/.test(code)) return null
      const sc = num(e.sc, 0)
      return sc > 0 && sc < 0x10000 ? { t, k: e.k, code, sc: Math.round(sc) } : { t, k: e.k, code }
    }
    case 'bd':
    case 'bu': {
      const b = num(e.b, -1)
      return [0, 1, 2, 3, 4].includes(b) ? { t, k: e.k, b: b as MacroButton } : null
    }
    case 'mm': {
      const x = num(e.x, NaN)
      const y = num(e.y, NaN)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return e.h ? { t, k: 'mm', x, y, h: 1 } : { t, k: 'mm', x, y }
    }
    case 'mr':
    case 'wh':
      return { t, k: e.k, dx: num(e.dx, 0), dy: num(e.dy, 0) }
  }
  return null
}

export function cleanClicker(raw: unknown): ClickerSettings {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_CLICKER
  const intervalMs = clamp(num(c.intervalMs, d.intervalMs), MIN_INTERVAL_MS, MAX_INTERVAL_MS)
  return {
    what: (['left', 'right', 'middle', 'key'] as const).includes(c.what as ClickerWhat) ? (c.what as ClickerWhat) : d.what,
    key: /^[A-Za-z0-9]+$/.test(str(c.key, 40)) ? str(c.key, 40) : d.key,
    intervalMs,
    holdMs: clamp(num(c.holdMs, d.holdMs), 0, MAX_INTERVAL_MS),
    stop: (['never', 'clicks', 'seconds'] as const).includes(c.stop as ClickerStop) ? (c.stop as ClickerStop) : d.stop,
    stopAfter: clamp(Math.round(num(c.stopAfter, d.stopAfter)), 1, 10_000_000),
    where: c.where === 'spot' ? 'spot' : 'pointer',
    x: Math.round(num(c.x, 0)),
    y: Math.round(num(c.y, 0))
  }
}

export function cleanMacro(raw: unknown): Macro | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const id = str(m.id, 80)
  if (!id) return null
  const events = (Array.isArray(m.events) ? m.events : []).map(cleanEvent).filter((e): e is MacroEvent => !!e)
  events.sort((a, b) => a.t - b.t)
  const last = events.length ? events[events.length - 1].t : 0
  return {
    id,
    name: str(m.name, 80).trim() || 'Macro',
    created: num(m.created, 0),
    os: m.os === 'mac' ? 'mac' : 'win',
    events,
    length: Math.max(last, num(m.length, last)),
    hotkey: normalizeAccelerator(str(m.hotkey, 60)),
    repeat: (['once', 'times', 'forever'] as const).includes(m.repeat as MacroRepeat) ? (m.repeat as MacroRepeat) : 'once',
    times: clamp(Math.round(num(m.times, 2)), 1, 100_000),
    speed: clamp(num(m.speed, 1), MIN_SPEED, MAX_SPEED),
    mouse: MOUSE_MODES.some((x) => x.id === m.mouse) ? (m.mouse as MacroMouseMode) : 'auto'
  }
}

export function cleanMacros(raw: unknown): MacrosData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = new Set<string>()
  const macros = (Array.isArray(d.macros) ? d.macros : [])
    .map(cleanMacro)
    .filter((m): m is Macro => !!m && !seen.has(m.id) && !!seen.add(m.id))
    .slice(0, MACRO_LIMIT)
  const h = (d.hotkeys && typeof d.hotkeys === 'object' ? d.hotkeys : {}) as Record<string, unknown>
  const hk = (v: unknown, fallback: string): string => (typeof v === 'string' ? normalizeAccelerator(v) : fallback)
  const current = str(d.current, 80)
  return {
    macros,
    hotkeys: { record: hk(h.record, DEFAULT_HOTKEYS.record), play: hk(h.play, DEFAULT_HOTKEYS.play), clicker: hk(h.clicker, DEFAULT_HOTKEYS.clicker) },
    clicker: cleanClicker(d.clicker),
    current: macros.some((m) => m.id === current) ? current : (macros[0]?.id ?? ''),
    trimStart: d.trimStart !== false
  }
}

// ---------- Hotkeys ----------

/**
 * The key codes a hotkey uses: its main key, and the modifier keys (both sides). The recorder
 * leaves the main key out of a recording, so pressing the stop key doesn't end up in the macro.
 */
export function acceleratorCodes(accel: string): { key: string | null; mods: string[] } {
  const parts = normalizeAccelerator(accel).split('+').filter(Boolean)
  if (parts.length === 0) return { key: null, mods: [] }
  const last = parts.pop()!
  const MOD_CODES: Record<string, string[]> = {
    Control: ['ControlLeft', 'ControlRight'],
    Alt: ['AltLeft', 'AltRight'],
    Shift: ['ShiftLeft', 'ShiftRight'],
    Super: ['MetaLeft', 'MetaRight']
  }
  const mods = parts.flatMap((p) => MOD_CODES[p] ?? [])
  let key: string | null = null
  if (/^[A-Z]$/.test(last)) key = `Key${last}`
  else if (/^[0-9]$/.test(last)) key = `Digit${last}`
  else if (/^F\d{1,2}$/.test(last)) key = last
  else if (/^num\d$/.test(last)) key = `Numpad${last.slice(3)}`
  else key = Object.entries(NAMED).find(([, name]) => name === last)?.[0] ?? null
  return { key, mods }
}

/**
 * A hotkey as the Windows helper watches for it: the key's number and which modifiers must be
 * held (1 Ctrl, 2 Alt, 4 Shift, 8 Win), exactly.
 */
export function windowsHotkey(accel: string): { vk: number; mods: number } | null {
  const parts = normalizeAccelerator(accel).split('+').filter(Boolean)
  if (!parts.length) return null
  const { key } = acceleratorCodes(accel)
  const vk = key ? windowsKey(key)?.vk : undefined
  if (vk === undefined) return null
  const bits: Record<string, number> = { Control: 1, Alt: 2, Shift: 4, Super: 8 }
  const mods = parts.slice(0, -1).reduce((m, p) => m | (bits[p] ?? 0), 0)
  return { vk, mods }
}

// ---------- Keys on each computer ----------

/** Windows key to press for a code (including "Vk<n>" for keys with no name). */
export function winKeyFor(code: string): { vk: number; extended: boolean } | null {
  const known = windowsKey(code)
  if (known) return known
  const m = /^Vk(\d{1,3})$/.exec(code)
  return m ? { vk: Number(m[1]), extended: false } : null
}

/** Mac key number for a code (including "Mac<n>" for keys with no name). */
export function macKeyFor(code: string): number | null {
  const known = macKey(code)
  if (known !== null) return known
  const m = /^Mac(\d{1,3})$/.exec(code)
  return m ? Number(m[1]) : null
}

/** A key's name for people: "W", "1", "Left Shift", "Space", "Num 5". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  if (/^F\d{1,2}$/.test(code)) return code
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code)
  if (side) {
    const names: Record<string, string> = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Win' }
    return `${side[2]} ${names[side[1]]}`
  }
  const named: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷', NumpadDecimal: 'Num .'
  }
  return named[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export const BUTTON_NAMES = ['Left click', 'Middle click', 'Right click', 'Back button', 'Forward button'] as const

// ---------- Turning what the helper reported into a macro ----------

/**
 * One line from the recording helper: `<kind> <ms> <args…>`.
 * - kd/ku/kr ms vk scan ext (Windows) or kd/ku/kr ms keycode (Mac)
 * - bd/bu ms button
 * - mm ms x y hidden, mr ms dx dy, wh ms dx dy
 * - p 0 x y hidden: where the pointer was when recording started
 * - h ms: the hotkey's key went down (not recorded; the last one is when you stopped)
 */
export type RecordedLine = string

export interface TidyOptions {
  os: MacroOs
  /** When you stopped (ms since recording started), if the helper didn't see the hotkey. */
  stoppedAt: number
  /** Modifier keys of the stop hotkey: pressed at the end only to stop, so not part of the macro. */
  stopMods: string[]
  /** Leave out the wait before the first key or click. */
  trimStart: boolean
}

/** Reads the helper's lines into events. Unknown or broken lines are skipped. */
export function parseRecorded(lines: RecordedLine[], os: MacroOs): { events: MacroEvent[]; start: { x: number; y: number; h: boolean } | null; hotkeyAt: number[] } {
  const events: MacroEvent[] = []
  let start: { x: number; y: number; h: boolean } | null = null
  const hotkeyAt: number[] = []
  for (const line of lines) {
    const p = line.trim().split(' ')
    const t = Number(p[1])
    if (!Number.isFinite(t)) continue
    const n = (i: number): number => Number(p[i])
    switch (p[0]) {
      case 'kd':
      case 'ku':
      case 'kr': {
        if (os === 'win') {
          if (!Number.isFinite(n(2))) continue
          const code = codeFromWindows(n(2), p[4] === '1')
          const sc = n(3)
          events.push(sc > 0 ? { t, k: p[0], code, sc } : { t, k: p[0], code })
        } else {
          if (!Number.isFinite(n(2))) continue
          events.push({ t, k: p[0], code: codeFromMac(n(2)) })
        }
        break
      }
      case 'bd':
      case 'bu':
        if ([0, 1, 2, 3, 4].includes(n(2))) events.push({ t, k: p[0], b: n(2) as MacroButton })
        break
      case 'mm':
        if (Number.isFinite(n(2)) && Number.isFinite(n(3))) events.push(p[4] === '1' ? { t, k: 'mm', x: n(2), y: n(3), h: 1 } : { t, k: 'mm', x: n(2), y: n(3) })
        break
      case 'mr':
      case 'wh':
        if (Number.isFinite(n(2)) && Number.isFinite(n(3))) events.push({ t, k: p[0], dx: n(2), dy: n(3) })
        break
      case 'p':
        if (Number.isFinite(n(2)) && Number.isFinite(n(3))) start = { x: n(2), y: n(3), h: p[4] === '1' }
        break
      case 'h':
        hotkeyAt.push(t)
        break
    }
  }
  events.sort((a, b) => a.t - b.t)
  return { events, start, hotkeyAt }
}

const keyId = (e: { code: string }): string => e.code
const isInput = (e: MacroEvent): boolean => e.k !== 'mm' && e.k !== 'mr'

/**
 * Makes a clean macro out of a recording:
 * - a key or button already down when recording started (the start hotkey's Ctrl, say) only has
 *   its "up": that's dropped, as are its repeats;
 * - a key still down when you stopped: if it's part of the stop hotkey it's dropped, otherwise it's
 *   let go of at the moment you stopped (so playing never leaves a key stuck);
 * - the wait before your first input can be left out; where the pointer was at the start is kept
 *   (at time 0), so it starts from the same place.
 */
export function tidyRecording(lines: RecordedLine[], opts: TidyOptions): { events: MacroEvent[]; length: number } {
  const { events: raw, start, hotkeyAt } = parseRecorded(lines, opts.os)
  // You stopped when the hotkey went down (the helper saw it to the microsecond), or when you pressed Stop.
  const lastInput = raw.length ? raw[raw.length - 1].t : 0
  const hk = hotkeyAt.filter((t) => t >= lastInput)
  let end = hk.length ? hk[0] : Math.max(opts.stoppedAt, lastInput)
  const stopMods = new Set(opts.stopMods)

  const heldKeys = new Map<string, number>()
  const heldButtons = new Map<MacroButton, number>()
  const keep: (MacroEvent | null)[] = []
  for (const e of raw) {
    if (e.t > end) continue
    if (e.k === 'kd') {
      if (heldKeys.has(keyId(e))) {
        keep.push({ ...e, k: 'kr' })
        continue
      }
      heldKeys.set(keyId(e), keep.length)
    } else if (e.k === 'kr') {
      if (!heldKeys.has(keyId(e))) continue
    } else if (e.k === 'ku') {
      if (!heldKeys.has(keyId(e))) continue
      heldKeys.delete(keyId(e))
    } else if (e.k === 'bd') {
      if (heldButtons.has(e.b)) continue
      heldButtons.set(e.b, keep.length)
    } else if (e.k === 'bu') {
      if (!heldButtons.has(e.b)) continue
      heldButtons.delete(e.b)
    }
    keep.push(e)
  }
  // Still down at the end.
  for (const [code, at] of heldKeys) {
    const pressedLate = stopMods.has(code)
    if (pressedLate) {
      // Drop the press and its repeats: it was only for the stop hotkey.
      for (let i = at; i < keep.length; i++) {
        const e = keep[i]
        if (e && (e.k === 'kd' || e.k === 'kr') && e.code === code) keep[i] = null
      }
    } else keep.push({ t: end, k: 'ku', code })
  }
  for (const [b] of heldButtons) keep.push({ t: end, k: 'bu', b })
  let events = keep.filter((e): e is MacroEvent => !!e)
  events.sort((a, b) => a.t - b.t)

  let offset = 0
  if (opts.trimStart) {
    const first = events.find(isInput) ?? events[0]
    if (first) offset = first.t
  }
  events = events
    .filter((e) => e.t >= offset)
    .map((e) => ({ ...e, t: roundT(e.t - offset) }))
  end = roundT(Math.max(0, end - offset))
  // Where the pointer was at the start (or just before the first kept event), at time 0.
  const before = start ? { x: start.x, y: start.y, h: start.h } : null
  if (opts.trimStart && offset > 0) {
    const lastMove = [...raw].reverse().find((e) => e.k === 'mm' && e.t < offset) as Extract<MacroEvent, { k: 'mm' }> | undefined
    const at = lastMove ? { x: lastMove.x, y: lastMove.y, h: !!lastMove.h } : before
    if (at) events.unshift(at.h ? { t: 0, k: 'mm', x: at.x, y: at.y, h: 1 } : { t: 0, k: 'mm', x: at.x, y: at.y })
  } else if (before) {
    events.unshift(before.h ? { t: 0, k: 'mm', x: before.x, y: before.y, h: 1 } : { t: 0, k: 'mm', x: before.x, y: before.y })
  }
  const last = events.length ? events[events.length - 1].t : 0
  return { events, length: Math.max(end, last) }
}

// ---------- What a macro does, for people ----------

export type MacroStep =
  | { kind: 'key'; at: number; held: number | null; code: string; repeats: number }
  | { kind: 'button'; at: number; held: number | null; b: MacroButton }
  | { kind: 'move'; at: number; until: number; count: number; game: boolean }
  | { kind: 'scroll'; at: number; notches: number }

/**
 * The macro as steps: each key and click with how long it was held, runs of mouse movement, and
 * scrolling. A gap of more than 150 ms between movements starts a new run.
 */
export function macroSteps(events: MacroEvent[], limit = 400): { steps: MacroStep[]; more: number } {
  const steps: MacroStep[] = []
  const openKeys = new Map<string, Extract<MacroStep, { kind: 'key' }>>()
  const openButtons = new Map<MacroButton, Extract<MacroStep, { kind: 'button' }>>()
  let move: Extract<MacroStep, { kind: 'move' }> | null = null
  let scroll: Extract<MacroStep, { kind: 'scroll' }> | null = null
  for (const [i, e] of events.entries()) {
    // Where the pointer starts (put there at time 0) isn't something you did.
    if (i === 0 && e.k === 'mm' && e.t === 0) continue
    if (e.k === 'mm' || e.k === 'mr') {
      // Positions and raw movement are two views of the same movement: count the positions, or raw on its own.
      if (move && e.t - move.until <= 150) {
        move.until = e.t
        if (e.k === 'mm') move.count++
        if (e.k === 'mm' && e.h) move.game = true
      } else {
        move = { kind: 'move', at: e.t, until: e.t, count: e.k === 'mm' ? 1 : 0, game: e.k === 'mm' && !!e.h }
        steps.push(move)
      }
      continue
    }
    if (e.k === 'wh') {
      if (scroll && e.t - scroll.at <= 300) scroll.notches += e.dy || e.dx
      else {
        scroll = { kind: 'scroll', at: e.t, notches: e.dy || e.dx }
        steps.push(scroll)
      }
      continue
    }
    move = null
    scroll = null
    if (e.k === 'kd') {
      const s = { kind: 'key' as const, at: e.t, held: null, code: e.code, repeats: 0 }
      openKeys.set(e.code, s)
      steps.push(s)
    } else if (e.k === 'kr') {
      const s = openKeys.get(e.code)
      if (s) s.repeats++
    } else if (e.k === 'ku') {
      const s = openKeys.get(e.code)
      if (s) {
        s.held = roundT(e.t - s.at)
        openKeys.delete(e.code)
      }
    } else if (e.k === 'bd') {
      const s = { kind: 'button' as const, at: e.t, held: null, b: e.b }
      openButtons.set(e.b, s)
      steps.push(s)
    } else if (e.k === 'bu') {
      const s = openButtons.get(e.b)
      if (s) {
        s.held = roundT(e.t - s.at)
        openButtons.delete(e.b)
      }
    }
  }
  // Moves with no positions counted (raw only) still show as one.
  for (const s of steps) if (s.kind === 'move' && s.count === 0) s.count = 1
  return { steps: steps.slice(0, limit), more: Math.max(0, steps.length - limit) }
}

/** "1.250 s", "85.0 ms", "0.40 ms": enough detail to see it's exact. */
export function formatMs(ms: number): string {
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000)
    return `${m} min ${((ms - m * 60_000) / 1000).toFixed(1)} s`
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(3)} s`
  if (ms >= 1) return `${ms.toFixed(1)} ms`
  return `${ms.toFixed(2)} ms`
}

/** What the macro has in it: "12 keys, 3 clicks, mouse". */
export function macroSummary(events: MacroEvent[]): string {
  const keys = events.filter((e) => e.k === 'kd').length
  const clicks = events.filter((e) => e.k === 'bd').length
  const moves = events.some((e) => (e.k === 'mm' && e.t > 0) || e.k === 'mr')
  const scrolls = events.some((e) => e.k === 'wh')
  const parts = [
    keys ? `${keys} key${keys === 1 ? '' : 's'}` : '',
    clicks ? `${clicks} click${clicks === 1 ? '' : 's'}` : '',
    moves ? 'mouse movement' : '',
    scrolls ? 'scrolling' : ''
  ].filter(Boolean)
  return parts.join(', ') || 'Nothing recorded'
}

// ---------- Playing ----------

/**
 * The script the helper plays, one event a line, already sped up or slowed down:
 * `<ms> K <down|up|rep> <key…>`, `<ms> B <down|up> <button>`, `<ms> M x y`, `<ms> R dx dy`, `<ms> W dx dy`.
 * On Windows a key is `vk scan ext`; on a Mac it's the key number. First line: `len <ms> loops <n>` (0 = forever).
 */
export function playbackScript(macro: Pick<Macro, 'events' | 'length' | 'repeat' | 'times' | 'speed' | 'mouse'>, os: MacroOs): string[] {
  const speed = clamp(macro.speed || 1, MIN_SPEED, MAX_SPEED)
  const at = (t: number): string => roundT(t / speed).toString()
  const lines: string[] = []
  let hidden = false
  const mode = macro.mouse
  for (const e of macro.events) {
    switch (e.k) {
      case 'kd':
      case 'ku':
      case 'kr': {
        const dir = e.k === 'kd' ? 'down' : e.k === 'ku' ? 'up' : 'rep'
        if (os === 'win') {
          const k = winKeyFor(e.code)
          if (!k) continue
          lines.push(`${at(e.t)} K ${dir} ${k.vk} ${e.sc ?? 0} ${k.extended ? 1 : 0}`)
        } else {
          const k = macKeyFor(e.code)
          if (k === null) continue
          lines.push(`${at(e.t)} K ${dir} ${k}`)
        }
        break
      }
      case 'bd':
      case 'bu':
        lines.push(`${at(e.t)} B ${e.k === 'bd' ? 'down' : 'up'} ${e.b}`)
        break
      case 'mm':
        hidden = !!e.h
        if (mode === 'positions' || (mode === 'auto' && !hidden)) lines.push(`${at(e.t)} M ${Math.round(e.x)} ${Math.round(e.y)}`)
        break
      case 'mr':
        if (mode === 'raw' || (mode === 'auto' && hidden)) lines.push(`${at(e.t)} R ${Math.round(e.dx)} ${Math.round(e.dy)}`)
        break
      case 'wh':
        lines.push(`${at(e.t)} W ${e.dx} ${e.dy}`)
        break
    }
  }
  const loops = macro.repeat === 'once' ? 1 : macro.repeat === 'times' ? Math.max(1, Math.round(macro.times)) : 0
  // A go can't be shorter than its own events (or zero, which would repeat with no gap forever).
  const last = macro.events.length ? macro.events[macro.events.length - 1].t : 0
  const len = roundT(Math.max(1, macro.length, last) / speed)
  return [`len ${len} loops ${loops}`, ...lines]
}

/** How long playing takes in ms, or null for forever. */
export function playLength(macro: Pick<Macro, 'length' | 'repeat' | 'times' | 'speed'>): number | null {
  if (macro.repeat === 'forever') return null
  const loops = macro.repeat === 'once' ? 1 : Math.max(1, Math.round(macro.times))
  return (macro.length * loops) / clamp(macro.speed || 1, MIN_SPEED, MAX_SPEED)
}

// ---------- Auto-clicker ----------

export const clicksPerSecond = (intervalMs: number): number => 1000 / intervalMs
export const intervalFor = (cps: number): number => clamp(1000 / Math.max(cps, 1e-6), MIN_INTERVAL_MS, MAX_INTERVAL_MS)

/**
 * The clicker's plan, as the helper runs it: click n goes down at exactly start + n × interval and
 * comes up `hold` later. The hold is kept shorter than the interval (a click has to come up before
 * the next can go down).
 */
export function clickerPlan(c: ClickerSettings): { intervalMs: number; holdMs: number; count: number; durationMs: number; problem?: string } {
  const intervalMs = clamp(c.intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS)
  // At least 0.25 ms up between clicks, or the next "down" would land on the last "up".
  const maxHold = Math.max(0, intervalMs - Math.min(0.25, intervalMs / 4))
  const holdMs = clamp(c.holdMs, 0, maxHold)
  const problem = c.holdMs > maxHold ? `Each click can be held for at most ${formatMs(maxHold)} at this speed, so it's held for that.` : undefined
  return {
    intervalMs,
    holdMs,
    count: c.stop === 'clicks' ? c.stopAfter : 0,
    durationMs: c.stop === 'seconds' ? c.stopAfter * 1000 : 0,
    ...(problem ? { problem } : {})
  }
}

/** The command line for the helper: `click <kind> <a> <b> <c> <interval> <hold> <count> <duration> <x|-> <y|->`. */
export function clickerCommand(c: ClickerSettings, os: MacroOs): string | null {
  const plan = clickerPlan(c)
  let target: string
  if (c.what === 'key') {
    if (os === 'win') {
      const k = winKeyFor(c.key)
      if (!k) return null
      target = `k ${k.vk} 0 ${k.extended ? 1 : 0}`
    } else {
      const k = macKeyFor(c.key)
      if (k === null) return null
      target = `k ${k} 0 0`
    }
  } else target = `b ${c.what === 'left' ? 0 : c.what === 'middle' ? 1 : 2} 0 0`
  const spot = c.where === 'spot' ? `${Math.round(c.x)} ${Math.round(c.y)}` : '- -'
  return `click ${target} ${plan.intervalMs} ${plan.holdMs} ${plan.count} ${plan.durationMs} ${spot}`
}

// ---------- Status (main → window) ----------

export type MacroActivity =
  | { kind: 'idle' }
  | { kind: 'recording'; since: number; events: number }
  | { kind: 'playing'; id: string; loop: number; loops: number; since: number }
  | { kind: 'clicking'; since: number; clicks: number }

/** How exactly the last play went: how late the events were, worst and on average, in ms. */
export interface PlayReport {
  id: string
  events: number
  worstLateMs: number
  averageLateMs: number
  stopped: boolean
}

export interface MacroStatus {
  /** Everything but the macros' raw events (the page gets each macro's steps instead). */
  data: Omit<MacrosData, 'macros'> & { macros: MacroView[] }
  activity: MacroActivity
  /** Can't record or play here, and why (e.g. Accessibility is off on a Mac, or not Windows/Mac). */
  problem: string | null
  hotkeyErrors: Partial<Record<keyof MacroHotkeys | string, string>>
  lastPlay: PlayReport | null
  /** What went wrong last, for a message. */
  error: string | null
}

/** A macro as the page sees it: its steps instead of every raw event (which can be thousands of mouse moves). */
export interface MacroView extends Omit<Macro, 'events'> {
  summary: string
  steps: MacroStep[]
  moreSteps: number
  eventCount: number
}

export function macroView(m: Macro): MacroView {
  const { events, ...rest } = m
  const { steps, more } = macroSteps(events)
  return { ...rest, summary: macroSummary(events), steps, moreSteps: more, eventCount: events.length }
}
