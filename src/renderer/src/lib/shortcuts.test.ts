import { describe, expect, it } from 'vitest'
import { findConflicts, normalizeShortcut, shortcutFromEvent, toCodeMirrorKey } from './shortcuts'

const ev = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: false
})

describe('normalizeShortcut', () => {
  it('orders modifiers and capitalises keys', () => {
    expect(normalizeShortcut('shift+ctrl+k')).toBe('Ctrl+Shift+K')
    expect(normalizeShortcut('ctrl+alt+f2')).toBe('Ctrl+Alt+F2')
    expect(normalizeShortcut('Ctrl+\\')).toBe('Ctrl+\\')
    expect(normalizeShortcut('Ctrl++')).toBe('Ctrl+Plus')
    expect(normalizeShortcut('Ctrl+=')).toBe('Ctrl+=')
  })

  it('rejects modifier-only shortcuts', () => {
    expect(normalizeShortcut('Ctrl+Shift')).toBe('')
    expect(normalizeShortcut('')).toBe('')
  })
})

describe('shortcutFromEvent', () => {
  // Windows rules (on a Mac, Ctrl means ⌘; see below).
  it('uses the physical key so Shift does not change the letter', () => {
    expect(shortcutFromEvent(ev('K', 'KeyK', { ctrl: true, shift: true }), false)).toBe('Ctrl+Shift+K')
    expect(shortcutFromEvent(ev('+', 'Equal', { ctrl: true, shift: true }), false)).toBe('Ctrl+Shift+=')
    expect(shortcutFromEvent(ev('!', 'Digit1', { ctrl: true, shift: true }), false)).toBe('Ctrl+Shift+1')
  })

  it('names special keys', () => {
    expect(shortcutFromEvent(ev('\\', 'Backslash', { ctrl: true }), false)).toBe('Ctrl+\\')
    expect(shortcutFromEvent(ev('ArrowLeft', 'ArrowLeft', { alt: true }), false)).toBe('Alt+Left')
    expect(shortcutFromEvent(ev('Tab', 'Tab', { ctrl: true }), false)).toBe('Ctrl+Tab')
    expect(shortcutFromEvent(ev(',', 'Comma', { ctrl: true }), false)).toBe('Ctrl+,')
  })

  it("leaves the Mac's Control-key text editing alone (Ctrl means ⌘ there)", () => {
    const cmd = (key: string, code: string) => ({ ...ev(key, code), metaKey: true })
    expect(shortcutFromEvent(cmd('n', 'KeyN'), true)).toBe('Ctrl+N')
    expect(shortcutFromEvent(ev('n', 'KeyN', { ctrl: true }), true)).toBeNull()
    expect(shortcutFromEvent(ev('k', 'KeyK', { ctrl: true }), true)).toBeNull()
    expect(shortcutFromEvent(ev('Tab', 'Tab', { ctrl: true }), true)).toBe('Ctrl+Tab')
    expect(shortcutFromEvent(ev('n', 'KeyN', { ctrl: true }), false)).toBe('Ctrl+N')
  })

  it('ignores modifier-only presses', () => {
    expect(shortcutFromEvent(ev('Control', 'ControlLeft', { ctrl: true }))).toBeNull()
  })
})

describe('toCodeMirrorKey', () => {
  it('converts to CodeMirror key names', () => {
    expect(toCodeMirrorKey('Ctrl+Shift+X')).toBe('Mod-Shift-x')
    expect(toCodeMirrorKey('Alt+Up')).toBe('Alt-ArrowUp')
  })
})

describe('findConflicts', () => {
  it('reports shortcuts shared by several commands', () => {
    const conflicts = findConflicts({ a: 'Ctrl+K', b: 'ctrl+k', c: 'Ctrl+J', d: null })
    expect([...conflicts]).toEqual([['Ctrl+K', ['a', 'b']]])
  })
})
