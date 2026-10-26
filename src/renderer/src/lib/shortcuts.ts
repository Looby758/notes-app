/**
 * Keyboard shortcuts as text like "Ctrl+Shift+K". One canonical form is used everywhere,
 * so comparing, showing and storing them is simple: modifiers in the order Ctrl, Alt, Shift,
 * then the key ("A", "5", "F2", "\\", "=", "Enter", "Up", "Plus"…).
 */

import { IS_MAC } from '@shared/platform'

const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const

const NAMED_CODES: Record<string, string> = {
  Backslash: '\\',
  IntlBackslash: '\\',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-'
}

const KEY_ALIASES: Record<string, string> = {
  '+': 'Plus',
  ' ': 'Space',
  esc: 'Escape',
  return: 'Enter',
  del: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  control: 'Ctrl',
  ctl: 'Ctrl'
}

function canonicalKey(key: string): string {
  if (!key) return ''
  const alias = KEY_ALIASES[key.toLowerCase()] ?? KEY_ALIASES[key]
  if (alias) return alias
  if (key.length === 1) return key.toUpperCase()
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase()
  return key[0].toUpperCase() + key.slice(1)
}

/** "shift+ctrl+k" → "Ctrl+Shift+K". Returns '' for nothing usable. */
export function normalizeShortcut(shortcut: string): string {
  // Split on "+" but keep a trailing "+" as the key itself ("Ctrl++").
  const parts = shortcut.trim().split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  const key = canonicalKey(parts.pop()!)
  const mods = new Set(parts.map((p) => canonicalKey(p)))
  if (MODIFIERS.includes(key as (typeof MODIFIERS)[number])) return ''
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+')
}

/** The shortcut a key press represents, or null while only modifier keys are held. */
export function shortcutFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null
  let key: string
  const code = e.code ?? ''
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^(Digit|Numpad)\d$/.test(code)) key = code.slice(-1)
  else if (/^F\d{1,2}$/.test(code)) key = code
  else if (NAMED_CODES[code]) key = NAMED_CODES[code]
  else key = canonicalKey(e.key ?? '')
  // Some synthetic or unusual key events carry no key name at all.
  if (!key || key === 'Unidentified') return null
  return normalizeShortcut([e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+').replace(/\+\+$/, '+Plus'))
}

export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const pressed = shortcutFromEvent(e)
  return pressed !== null && pressed === normalizeShortcut(shortcut)
}

/** "Ctrl+Shift+X" → CodeMirror's "Mod-Shift-x" (Mod is Ctrl on Windows and ⌘ on a Mac). */
export function toCodeMirrorKey(shortcut: string): string {
  const parts = normalizeShortcut(shortcut).split('+').map((p) => (p === 'Ctrl' ? 'Mod' : p))
  const key = parts.pop()!
  const cmKey =
    key === 'Plus' ? '+' : key === 'Up' ? 'ArrowUp' : key === 'Down' ? 'ArrowDown' : key === 'Left' ? 'ArrowLeft' : key === 'Right' ? 'ArrowRight' : key === 'Space' ? 'Space' : key.length === 1 ? key.toLowerCase() : key
  return [...parts, cmKey].join('-')
}

/** Shortcuts used by more than one command: shortcut → command ids. */
export function findConflicts(assigned: Record<string, string | null>): Map<string, string[]> {
  const byShortcut = new Map<string, string[]>()
  for (const [id, shortcut] of Object.entries(assigned)) {
    if (!shortcut) continue
    const key = normalizeShortcut(shortcut)
    byShortcut.set(key, [...(byShortcut.get(key) ?? []), id])
  }
  return new Map([...byShortcut].filter(([, ids]) => ids.length > 1))
}

/** Shortcuts the app can't take over (the system or the editor use them). On a Mac, Ctrl is ⌘. */
export const RESERVED_SHORTCUTS = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+F', 'Alt+F4', 'Escape', 'Enter', 'Tab', 'Backspace', 'Delete',
  ...(IS_MAC ? ['Ctrl+Q', 'Ctrl+H', 'Ctrl+M', 'Ctrl+Shift+Z', 'Ctrl+Alt+H'] : [])
])
