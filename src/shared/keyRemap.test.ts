import { describe, expect, it } from 'vitest'
import {
  activeRules,
  appName,
  cleanRemaps,
  duplicateKeys,
  emptyRemaps,
  EVERYWHERE_ID,
  hidUsage,
  hidutilArg,
  macPlan,
  ruleProblem,
  setMatches,
  shortcutFromEvent,
  targetLabel,
  windowsRemapLines,
  winKeyId,
  winTarget,
  type RemapData,
  type RemapTarget
} from './keyRemap'

const data = (over: Partial<RemapData> = {}): RemapData => ({
  on: true,
  toggleHotkey: '',
  sets: [
    {
      id: EVERYWHERE_ID,
      name: 'Everywhere',
      app: '',
      on: true,
      rules: [
        { id: 'a', from: 'CapsLock', to: { kind: 'key', code: 'Escape' }, on: true },
        { id: 'b', from: 'F1', to: { kind: 'off' }, on: true }
      ]
    },
    {
      id: 'mc',
      name: 'Minecraft',
      app: 'javaw.exe',
      on: true,
      rules: [
        { id: 'c', from: 'CapsLock', to: { kind: 'key', code: 'ShiftLeft' }, on: true },
        { id: 'd', from: 'KeyQ', to: { kind: 'shortcut', mods: ['Control'], code: 'KeyZ' }, on: true },
        { id: 'e', from: 'KeyR', to: { kind: 'key', code: 'KeyT' }, on: false }
      ]
    }
  ],
  ...over
})

describe('cleanRemaps', () => {
  it('always has Everywhere first, and drops junk', () => {
    const d = cleanRemaps({
      sets: [
        { id: 'x', name: 'Game', app: 'C:\\Games\\game.exe', rules: [{ id: 'r', from: 'KeyA', to: { kind: 'key', code: 'KeyB' } }, { id: 'bad', from: '', to: { kind: 'key', code: 'KeyB' } }] },
        { id: 'y', app: '' },
        'nonsense'
      ]
    })
    expect(d.sets.map((s) => s.id)).toEqual([EVERYWHERE_ID, 'x'])
    expect(d.sets[1].app).toBe('game')
    expect(d.sets[1].rules).toHaveLength(1)
    expect(d.on).toBe(true)
  })
  it('keeps shortcut modifiers in a fixed order', () => {
    const d = cleanRemaps({ sets: [{ id: EVERYWHERE_ID, rules: [{ id: 'r', from: 'KeyA', to: { kind: 'shortcut', mods: ['Shift', 'Control', 'Nope'], code: 'KeyZ' } }] }] })
    expect(d.sets[0].rules[0].to).toEqual({ kind: 'shortcut', mods: ['Control', 'Shift'], code: 'KeyZ' })
  })
  it('starts empty from nothing', () => {
    expect(cleanRemaps(null)).toEqual(emptyRemaps())
  })
})

describe('which remaps apply', () => {
  it('uses Everywhere when no game set matches', () => {
    const r = activeRules(data(), { name: 'chrome' })
    expect(r.get('CapsLock')).toEqual({ kind: 'key', code: 'Escape' })
    expect(r.has('KeyQ')).toBe(false)
  })
  it('puts the game set on top of Everywhere, by program name in any case', () => {
    const r = activeRules(data(), { name: 'JAVAW' })
    expect(r.get('CapsLock')).toEqual({ kind: 'key', code: 'ShiftLeft' })
    expect(r.get('F1')).toEqual({ kind: 'off' })
    expect(r.get('KeyQ')?.kind).toBe('shortcut')
    expect(r.has('KeyR')).toBe(false)
  })
  it('matches a Mac app by the name it shows too', () => {
    const d = data()
    d.sets[1].app = 'Minecraft'
    expect(setMatches(d.sets[1], { name: 'java', title: 'Minecraft' })).toBe(true)
    expect(setMatches(d.sets[1], { name: 'java', title: 'Safari' })).toBe(false)
  })
  it('applies nothing when remapping is switched off', () => {
    expect(activeRules(data({ on: false }), { name: 'javaw' }).size).toBe(0)
  })
  it('skips a switched-off game set', () => {
    const d = data()
    d.sets[1].on = false
    expect(activeRules(d, { name: 'javaw' }).get('CapsLock')).toEqual({ kind: 'key', code: 'Escape' })
  })
  it('spots a key remapped twice in one set', () => {
    const d = data()
    d.sets[0].rules.push({ id: 'z', from: 'CapsLock', to: { kind: 'off' }, on: true })
    expect([...duplicateKeys(d.sets[0])]).toEqual(['CapsLock'])
  })
})

describe('app names', () => {
  it('turns paths and extensions into the plain name', () => {
    expect(appName('C:\\Program Files\\Roblox\\RobloxPlayerBeta.exe')).toBe('RobloxPlayerBeta')
    expect(appName('/Applications/Minecraft.app')).toBe('Minecraft')
    expect(appName('  javaw  ')).toBe('javaw')
  })
})

describe('Windows', () => {
  it('numbers keys with the extended flag', () => {
    expect(winKeyId('KeyA')).toBe(0x41)
    expect(winKeyId('ControlRight')).toBe(0xa3 | 0x100)
    expect(winKeyId('Enter')).toBe(0x0d)
    expect(winKeyId('NumpadEnter')).toBe(0x0d | 0x100)
  })
  it('describes what to press', () => {
    expect(winTarget({ kind: 'off' })).toBe('x')
    expect(winTarget({ kind: 'key', code: 'Escape' })).toBe('k 27.0')
    expect(winTarget({ kind: 'shortcut', mods: ['Control', 'Shift'], code: 'KeyZ' })).toBe('s 162.0 160.0 90.0')
  })
  it('sends a table for Everywhere and one per game', () => {
    const lines = windowsRemapLines(data())
    expect(lines[0]).toBe('begin')
    expect(lines[lines.length - 1]).toBe('commit')
    expect(lines).toContain('t *')
    expect(lines).toContain(`r * ${0x14} k 27.0`)
    expect(lines).toContain(`r * ${0x70} x`)
    expect(lines).toContain('t javaw')
    expect(lines).toContain(`r javaw ${0x14} k 160.0`)
    // The game's table has Everywhere's remaps too.
    expect(lines).toContain(`r javaw ${0x70} x`)
    expect(lines).toContain(`r javaw ${0x51} s 162.0 90.0`)
    expect(lines.some((l) => l.startsWith(`r javaw ${0x52} `))).toBe(false)
  })
  it('escapes app names with spaces', () => {
    const d = data()
    d.sets[1].app = 'My Game'
    expect(windowsRemapLines(d)).toContain('t my%20game')
  })
  it('sends empty tables when switched off', () => {
    expect(windowsRemapLines(data({ on: false })).filter((l) => l.startsWith('r '))).toEqual([])
  })
})

describe('Mac', () => {
  it('uses USB key numbers', () => {
    expect(hidUsage('KeyA')).toBe(0x700000004)
    expect(hidUsage('CapsLock')).toBe(0x700000039)
    expect(hidUsage('Digit0')).toBe(0x700000027)
    expect(hidUsage('F13')).toBe(0x700000068)
    expect(hidUsage('ControlLeft')).toBe(0x7000000e0)
  })
  it('maps keys directly and borrows a spare key for a shortcut', () => {
    const rules = new Map<string, RemapTarget>([
      ['CapsLock', { kind: 'key', code: 'Escape' }],
      ['F1', { kind: 'off' }],
      ['KeyQ', { kind: 'shortcut', mods: ['Super'], code: 'KeyZ' }]
    ])
    const plan = macPlan(rules)
    expect(plan.mapping).toContainEqual({ HIDKeyboardModifierMappingSrc: 0x700000039, HIDKeyboardModifierMappingDst: 0x700000029 })
    // Q becomes F20 (Mac key 90), which presses ⌘Z (55, 6).
    expect(plan.mapping).toContainEqual({ HIDKeyboardModifierMappingSrc: 0x700000014, HIDKeyboardModifierMappingDst: 0x70000006f })
    expect(plan.slots).toEqual({ 90: [55, 6] })
    expect(plan.skipped).toEqual([])
  })
  it("doesn't borrow a spare key you use yourself, and says when it runs out", () => {
    const rules = new Map<string, RemapTarget>([['F20', { kind: 'key', code: 'KeyA' }]])
    for (const k of ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH']) rules.set(k, { kind: 'shortcut', mods: ['Super'], code: 'KeyC' })
    const plan = macPlan(rules)
    expect(Object.keys(plan.slots)).not.toContain('90')
    expect(Object.keys(plan.slots)).toHaveLength(7)
    expect(plan.skipped).toEqual(['KeyH'])
  })
  it('writes hidutil’s argument', () => {
    expect(hidutilArg([{ HIDKeyboardModifierMappingSrc: 0x700000039, HIDKeyboardModifierMappingDst: 0x700000029 }])).toBe(
      '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":0x700000039,"HIDKeyboardModifierMappingDst":0x700000029}]}'
    )
    expect(hidutilArg([])).toBe('{"UserKeyMapping":[]}')
  })
})

describe('for people', () => {
  it('labels targets the way each computer writes them', () => {
    expect(targetLabel({ kind: 'shortcut', mods: ['Control', 'Shift'], code: 'KeyZ' }, 'win')).toBe('Ctrl+Shift+Z')
    expect(targetLabel({ kind: 'shortcut', mods: ['Super'], code: 'KeyZ' }, 'mac')).toBe('⌘Z')
    expect(targetLabel({ kind: 'key', code: 'CapsLock' }, 'win')).toBe('Caps Lock')
    expect(targetLabel({ kind: 'off' }, 'win')).toBe('Nothing (key off)')
  })
  it('reads a shortcut from a key press', () => {
    const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }
    expect(shortcutFromEvent({ ...base, code: 'KeyZ', ctrlKey: true })).toEqual({ kind: 'shortcut', mods: ['Control'], code: 'KeyZ' })
    expect(shortcutFromEvent({ ...base, code: 'KeyZ' })).toEqual({ kind: 'key', code: 'KeyZ' })
    expect(shortcutFromEvent({ ...base, code: 'ControlLeft', ctrlKey: true })).toBeNull()
  })
  it('says when a key can’t be remapped on this computer', () => {
    expect(ruleProblem({ from: 'KeyA', to: { kind: 'key', code: 'KeyB' } }, 'win')).toBeNull()
    expect(ruleProblem({ from: 'Fn', to: { kind: 'key', code: 'KeyB' } }, 'win')).toMatch(/can’t be remapped/)
    expect(ruleProblem({ from: 'KeyA', to: { kind: 'key', code: 'MediaPlayPause' } }, 'mac')).toMatch(/can’t remap to/)
    expect(ruleProblem({ from: 'KeyA', to: { kind: 'off' } }, 'mac')).toBeNull()
  })
})
