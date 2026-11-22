/**
 * The key remapper: the parts that are plain logic (no Electron, no helpers), so they can be tested.
 *
 * A remap turns one key on your keyboard into another key, a shortcut (Ctrl+Z, say), or nothing.
 * Remaps live in sets: "Everywhere" always applies, and a set for a game (or any app) applies while
 * that app is in front, on top of Everywhere (the game's remap wins when both change the same key).
 *
 * Keys are kept by their place on the keyboard (KeyboardEvent.code, like the macro recorder), and
 * each computer turns them into its own key numbers.
 *
 * Nothing here ever turns remaps off for a game or server: that's only ever up to you.
 */

import { macKey, windowsKey } from './mouseShare'
import { keyLabel } from './macros'
import { normalizeAccelerator } from './soundboard'

export type RemapMod = 'Control' | 'Alt' | 'Shift' | 'Super'
export const REMAP_MODS: readonly RemapMod[] = ['Control', 'Alt', 'Shift', 'Super']

export type RemapTarget = { kind: 'key'; code: string } | { kind: 'shortcut'; mods: RemapMod[]; code: string } | { kind: 'off' }

export interface RemapRule {
  id: string
  /** The key you press (KeyboardEvent.code). */
  from: string
  to: RemapTarget
  on: boolean
}

export interface RemapSet {
  id: string
  name: string
  /** The app it's for ("javaw", "Minecraft", "RobloxPlayerBeta"); '' for Everywhere. */
  app: string
  on: boolean
  rules: RemapRule[]
}

export interface RemapData {
  /** Every remap at once. Only you switch this: Orbit never does by itself. */
  on: boolean
  /** Turns every remap on or off from anywhere (an Electron accelerator; '' for none). */
  toggleHotkey: string
  sets: RemapSet[]
}

export type RemapOs = 'win' | 'mac'

export const EVERYWHERE_ID = 'everywhere'
export const RULE_LIMIT = 200
export const SET_LIMIT = 100

export const emptyRemaps = (): RemapData => ({
  on: true,
  toggleHotkey: '',
  sets: [{ id: EVERYWHERE_ID, name: 'Everywhere', app: '', on: true, rules: [] }]
})

// ---------- Tidying what was saved (or sent by the page) ----------

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const isCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{1,30}$/.test(v)

export function cleanTarget(raw: unknown): RemapTarget | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (t.kind === 'off') return { kind: 'off' }
  if (!isCode(t.code)) return null
  if (t.kind === 'key') return { kind: 'key', code: t.code }
  if (t.kind === 'shortcut') {
    const given = Array.isArray(t.mods) ? t.mods : []
    const mods = REMAP_MODS.filter((m) => given.includes(m))
    return { kind: 'shortcut', mods, code: t.code }
  }
  return null
}

export function cleanRule(raw: unknown): RemapRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const to = cleanTarget(r.to)
  if (!isCode(r.from) || !to || !str(r.id)) return null
  return { id: str(r.id, 40), from: r.from, to, on: r.on !== false }
}

/** An app as typed or reported ("C:\\Games\\javaw.exe", "Minecraft.app") becomes the name it's matched by. */
export function appName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(exe|app)$/i, '').trim().slice(0, 100)
}

export function cleanSet(raw: unknown): RemapSet | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const id = str(s.id, 40)
  if (!id) return null
  const everywhere = id === EVERYWHERE_ID
  const app = everywhere ? '' : appName(str(s.app))
  if (!everywhere && !app) return null
  const rules: RemapRule[] = []
  const seen = new Set<string>()
  for (const r of Array.isArray(s.rules) ? s.rules : []) {
    const rule = cleanRule(r)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    rules.push(rule)
    if (rules.length >= RULE_LIMIT) break
  }
  return { id, name: everywhere ? 'Everywhere' : str(s.name, 80).trim() || app, app, on: s.on !== false, rules }
}

export function cleanRemaps(raw: unknown): RemapData {
  const out = emptyRemaps()
  if (!raw || typeof raw !== 'object') return out
  const d = raw as Record<string, unknown>
  const sets: RemapSet[] = []
  const ids = new Set<string>()
  for (const s of Array.isArray(d.sets) ? d.sets : []) {
    const set = cleanSet(s)
    if (!set || ids.has(set.id)) continue
    ids.add(set.id)
    sets.push(set)
    if (sets.length >= SET_LIMIT) break
  }
  // Everywhere is always there, and always first.
  const everywhere = sets.find((s) => s.id === EVERYWHERE_ID) ?? out.sets[0]
  return {
    on: d.on !== false,
    toggleHotkey: typeof d.toggleHotkey === 'string' ? normalizeAccelerator(d.toggleHotkey) : '',
    sets: [everywhere, ...sets.filter((s) => s.id !== EVERYWHERE_ID)]
  }
}

// ---------- Which remaps apply ----------

/** The app in front, as the helper reports it: its program's name and (on a Mac) the name it shows. */
export interface FrontApp {
  name: string
  title?: string
}

const lower = (s: string): string => s.toLowerCase()

/** Whether a set is for this app (by program name or shown name, any case). */
export function setMatches(set: RemapSet, front: FrontApp | null): boolean {
  if (!set.app) return true
  if (!front) return false
  const want = lower(appName(set.app))
  return [front.name, front.title ?? ''].some((n) => n && lower(appName(n)) === want)
}

/**
 * The remaps that apply with this app in front: Everywhere, then the app's own sets on top (a
 * game's remap for a key replaces Everywhere's). Switched-off sets and remaps are left out; so is
 * everything when remapping is off.
 */
export function activeRules(data: RemapData, front: FrontApp | null): Map<string, RemapTarget> {
  const out = new Map<string, RemapTarget>()
  if (!data.on) return out
  const ordered = [...data.sets.filter((s) => !s.app), ...data.sets.filter((s) => s.app)]
  for (const set of ordered) {
    if (!set.on || !setMatches(set, front)) continue
    for (const r of set.rules) if (r.on && r.from) out.set(r.from, r.to)
  }
  return out
}

/** Two remaps in one set for the same key: the later one wins, so say so. */
export function duplicateKeys(set: RemapSet): Set<string> {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const r of set.rules) {
    if (!r.on) continue
    if (seen.has(r.from)) dup.add(r.from)
    seen.add(r.from)
  }
  return dup
}

// ---------- For people ----------

const MOD_LABEL: Record<RemapOs, Record<RemapMod, string>> = {
  win: { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' },
  mac: { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' }
}

/** A key's name, the way this computer's keyboard says it. */
export function remapKeyLabel(code: string, os: RemapOs): string {
  if (os === 'mac') {
    const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code)
    if (side) {
      const names: Record<string, string> = { Shift: 'Shift', Control: 'Control', Alt: 'Option', Meta: 'Command' }
      return `${side[2]} ${names[side[1]]}`
    }
    if (code === 'Backspace') return 'Delete'
    if (code === 'Delete') return 'Forward Delete'
  }
  if (code === 'CapsLock') return 'Caps Lock'
  return keyLabel(code)
}

export function targetLabel(t: RemapTarget, os: RemapOs): string {
  if (t.kind === 'off') return 'Nothing (key off)'
  if (t.kind === 'key') return remapKeyLabel(t.code, os)
  const mods = t.mods.map((m) => MOD_LABEL[os][m])
  return os === 'mac' ? `${mods.join('')}${remapKeyLabel(t.code, os)}` : [...mods, remapKeyLabel(t.code, os)].join('+')
}

/** A shortcut from a key press on the page. Null for a modifier on its own. */
export function shortcutFromEvent(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): RemapTarget | null {
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code) || !isCode(e.code)) return null
  const mods: RemapMod[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  return mods.length ? { kind: 'shortcut', mods, code: e.code } : { kind: 'key', code: e.code }
}

/** Keys you can pick from a list (for keys you can't press here: F13–F24, media keys…). */
export const PICKABLE_KEYS: readonly string[] = (() => {
  const keys: string[] = []
  for (let i = 0; i < 26; i++) keys.push(`Key${String.fromCharCode(65 + i)}`)
  for (let i = 0; i < 10; i++) keys.push(`Digit${i}`)
  for (let i = 1; i <= 24; i++) keys.push(`F${i}`)
  keys.push(
    'Escape', 'Tab', 'CapsLock', 'Space', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu',
    'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'IntlBackslash',
    'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
    'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter', 'NumLock',
    'PrintScreen', 'ScrollLock', 'Pause',
    'AudioVolumeMute', 'AudioVolumeDown', 'AudioVolumeUp', 'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaStop'
  )
  return keys
})()

// ---------- Windows: what the helper is told ----------

/** A key as the Windows helper matches it: its number, plus 256 when it's an "extended" key (Right Ctrl, the arrows…). */
export function winKeyId(code: string): number | null {
  const k = windowsKey(code)
  return k ? k.vk | (k.extended ? 0x100 : 0) : null
}

const winSend = (code: string): string | null => {
  const k = windowsKey(code)
  return k ? `${k.vk}.${k.extended ? 1 : 0}` : null
}

const MOD_CODE: Record<RemapMod, string> = { Control: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Super: 'MetaLeft' }

/** What to press for a remap, as the Windows helper reads it: "x" (nothing), "k vk.ext", or "s vk.ext vk.ext …" (modifiers first). */
export function winTarget(t: RemapTarget): string | null {
  if (t.kind === 'off') return 'x'
  const key = winSend(t.code)
  if (!key) return null
  if (t.kind === 'key') return `k ${key}`
  const mods = t.mods.map((m) => winSend(MOD_CODE[m])!)
  return `s ${[...mods, key].join(' ')}`
}

/** Escapes an app name for the helper's space-separated lines ('*' means Everywhere). */
const appToken = (app: string): string => (app ? encodeURIComponent(lower(appName(app))) : '*')

/**
 * Everything the Windows helper needs, worked out here: one table for Everywhere ("*") and one per
 * app (Everywhere plus that app's sets on top), so the helper can switch the moment you change
 * window, without asking Orbit. Lines: "begin", "r <app> <from id> <target>"…, "commit".
 */
export function windowsRemapLines(data: RemapData): string[] {
  const apps = new Map<string, FrontApp>()
  for (const s of data.sets) if (s.app && s.on) apps.set(appToken(s.app), { name: s.app })
  const tables: [string, Map<string, RemapTarget>][] = [['*', activeRules(data, null)]]
  for (const [token, front] of apps) tables.push([token, activeRules(data, front)])
  const lines = ['begin']
  for (const [token, rules] of tables) {
    // An app's table is there even when empty, so a game set with everything switched off still counts.
    lines.push(`t ${token}`)
    for (const [from, to] of rules) {
      const id = winKeyId(from)
      const target = winTarget(to)
      if (id === null || target === null) continue
      lines.push(`r ${token} ${id} ${target}`)
    }
  }
  lines.push('commit')
  return lines
}

// ---------- Mac: hidutil and the shortcut keys ----------

/** USB keyboard numbers (HID usage page 7), which is what macOS's own key remapping (hidutil) uses. */
const HID: Record<string, number> = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f,
  BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38,
  CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c,
  End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53,
  NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58, NumpadDecimal: 0x63,
  IntlBackslash: 0x64, ContextMenu: 0x65, NumpadEqual: 0x67, AudioVolumeMute: 0x7f, AudioVolumeUp: 0x80, AudioVolumeDown: 0x81,
  ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7
}
for (let i = 0; i < 26; i++) HID[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i
for (let i = 1; i <= 9; i++) HID[`Digit${i}`] = 0x1d + i
HID.Digit0 = 0x27
for (let i = 1; i <= 9; i++) HID[`Numpad${i}`] = 0x58 + i
HID.Numpad0 = 0x62
for (let i = 1; i <= 12; i++) HID[`F${i}`] = 0x39 + i
for (let i = 13; i <= 24; i++) HID[`F${i}`] = 0x68 + (i - 13)

export const hidUsage = (code: string): number | null => (code in HID ? 0x700000000 + HID[code] : null)

/**
 * Spare keys a shortcut remap borrows on a Mac: macOS's own remapping can only swap one key for
 * another, so the key becomes one of these, and Orbit's helper presses the shortcut when it sees it.
 */
export const MAC_SLOT_KEYS: readonly string[] = ['F20', 'F19', 'F18', 'F17', 'F16', 'F15', 'F14', 'F13']

/** A key macOS has no key for (so it does nothing): what "off" becomes on a Mac. */
const MAC_OFF = 'F24'

export interface MacPlan {
  /** For `hidutil property --set`. */
  mapping: { HIDKeyboardModifierMappingSrc: number; HIDKeyboardModifierMappingDst: number }[]
  /** Spare key's Mac key number → the Mac key numbers to press (modifiers first). */
  slots: Record<number, number[]>
  /** Shortcut remaps that didn't fit (more than there are spare keys), by the key you press. */
  skipped: string[]
}

/** The Mac plan for the remaps that apply now. */
export function macPlan(rules: Map<string, RemapTarget>): MacPlan {
  const plan: MacPlan = { mapping: [], slots: {}, skipped: [] }
  // Spare keys you use yourself (as a key you press or one a remap gives) aren't borrowed.
  const used = new Set<string>()
  for (const [from, to] of rules) {
    used.add(from)
    if (to.kind !== 'off') used.add(to.code)
  }
  const free = MAC_SLOT_KEYS.filter((k) => !used.has(k))
  for (const [from, to] of rules) {
    const src = hidUsage(from)
    if (src === null) continue
    let dst: number | null = null
    if (to.kind === 'off') dst = hidUsage(MAC_OFF)
    else if (to.kind === 'key') dst = hidUsage(to.code)
    else {
      const keys = [...to.mods.map((m) => macKey(MOD_CODE[m])), macKey(to.code)]
      if (keys.some((k) => k === null)) continue
      const slot = free.shift()
      if (!slot) {
        plan.skipped.push(from)
        continue
      }
      plan.slots[macKey(slot)!] = keys as number[]
      dst = hidUsage(slot)
    }
    if (dst === null || dst === src) continue
    plan.mapping.push({ HIDKeyboardModifierMappingSrc: src, HIDKeyboardModifierMappingDst: dst })
  }
  return plan
}

/** The argument for `hidutil property --set` (the numbers in hex, as hidutil's own examples write them). */
export function hidutilArg(mapping: MacPlan['mapping']): string {
  const items = mapping.map((m) => `{"HIDKeyboardModifierMappingSrc":0x${m.HIDKeyboardModifierMappingSrc.toString(16)},"HIDKeyboardModifierMappingDst":0x${m.HIDKeyboardModifierMappingDst.toString(16)}}`)
  return `{"UserKeyMapping":[${items.join(',')}]}`
}

// ---------- Can this computer do it? ----------

/** Why a remap can't work here (or null if it can). */
export function ruleProblem(rule: Pick<RemapRule, 'from' | 'to'>, os: RemapOs): string | null {
  const name = (c: string): string => remapKeyLabel(c, os)
  if (os === 'win') {
    if (winKeyId(rule.from) === null) return `${name(rule.from)} can’t be remapped on Windows.`
    if (rule.to.kind !== 'off' && winSend(rule.to.code) === null) return `Windows can’t press ${name(rule.to.code)}.`
    return null
  }
  if (hidUsage(rule.from) === null) return `${name(rule.from)} can’t be remapped on a Mac.`
  if (rule.to.kind === 'key' && hidUsage(rule.to.code) === null) return `A Mac can’t remap to ${name(rule.to.code)}.`
  if (rule.to.kind === 'shortcut' && macKey(rule.to.code) === null) return `A Mac can’t press ${name(rule.to.code)}.`
  return null
}

// ---------- Status (main → page) ----------

export interface RemapStatus {
  data: RemapData
  /** The app in front now, if Orbit knows. */
  front: FrontApp | null
  /** Apps that were in front lately (newest first), to make a set for one. */
  recentApps: FrontApp[]
  /** Remaps can't work here at all, and why. */
  problem: string | null
  /** Something to know (a hotkey that's taken, shortcuts needing Accessibility on a Mac…). */
  notes: string[]
  /** Whether the helper that does the remapping is running. */
  running: boolean
}
