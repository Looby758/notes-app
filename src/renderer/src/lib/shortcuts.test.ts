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
  it('uses the physical key so Shift does not change the letter', () => {
    expect(shortcutFromEvent(ev('K', 'KeyK', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+K')
    expect(shortcutFromEvent(ev('+', 'Equal', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+=')
    expect(shortcutFromEvent(ev('!', 'Digit1', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+1')
  })

  it('names special keys', () => {
    expect(shortcutFromEvent(ev('\\', 'Backslash', { ctrl: true }))).toBe('Ctrl+\\')
    expect(shortcutFromEvent(ev('ArrowLeft', 'ArrowLeft', { alt: true }))).toBe('Alt+Left')
    expect(shortcutFromEvent(ev('Tab', 'Tab', { ctrl: true }))).toBe('Ctrl+Tab')
    expect(shortcutFromEvent(ev(',', 'Comma', { ctrl: true }))).toBe('Ctrl+,')
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
