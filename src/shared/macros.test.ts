import { describe, expect, it } from 'vitest'
import {
  acceleratorCodes,
  cleanMacros,
  windowsHotkey,
  clickerCommand,
  clickerPlan,
  DEFAULT_CLICKER,
  formatMs,
  intervalFor,
  keyLabel,
  macroSteps,
  macroSummary,
  parseRecorded,
  playbackScript,
  playLength,
  tidyRecording,
  type Macro,
  type MacroEvent
} from './macros'
import { codeFromMac, codeFromWindows } from './mouseShare'

const macro = (events: MacroEvent[], extra: Partial<Macro> = {}): Macro => ({
  id: 'm1',
  name: 'Test',
  created: 0,
  os: 'win',
  events,
  length: events.length ? events[events.length - 1].t : 0,
  hotkey: '',
  repeat: 'once',
  times: 1,
  speed: 1,
  mouse: 'auto',
  ...extra
})

describe('keys from Windows and the Mac', () => {
  it('names Windows keys by their place on the keyboard', () => {
    expect(codeFromWindows(0x57, false)).toBe('KeyW')
    expect(codeFromWindows(0xa0, false)).toBe('ShiftLeft')
    expect(codeFromWindows(0x0d, false)).toBe('Enter')
    expect(codeFromWindows(0x0d, true)).toBe('NumpadEnter')
    expect(codeFromWindows(0x11, true)).toBe('ControlRight')
    expect(codeFromWindows(0xff, false)).toBe('Vk255')
  })
  it('names Mac keys', () => {
    expect(codeFromMac(13)).toBe('KeyW')
    expect(codeFromMac(49)).toBe('Space')
    expect(codeFromMac(105)).toBe('F13')
    expect(codeFromMac(200)).toBe('Mac200')
  })
  it('labels keys for people', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ShiftLeft')).toBe('Left Shift')
    expect(keyLabel('Numpad5')).toBe('Num 5')
    expect(keyLabel('Space')).toBe('Space')
  })
})

describe('hotkeys the Windows helper watches', () => {
  it('gives the key number and exactly which modifiers', () => {
    expect(windowsHotkey('F10')).toEqual({ vk: 0x79, mods: 0 })
    expect(windowsHotkey('Control+Alt+1')).toEqual({ vk: 0x31, mods: 3 })
    expect(windowsHotkey('Shift+num5')).toEqual({ vk: 0x65, mods: 4 })
    expect(windowsHotkey('')).toBeNull()
  })
})

describe('hotkey keys', () => {
  it('finds the main key and modifier keys of a hotkey', () => {
    expect(acceleratorCodes('F9')).toEqual({ key: 'F9', mods: [] })
    expect(acceleratorCodes('Control+Shift+R')).toEqual({ key: 'KeyR', mods: ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'] })
    expect(acceleratorCodes('num5').key).toBe('Numpad5')
    expect(acceleratorCodes('Control+Up').key).toBe('ArrowUp')
    expect(acceleratorCodes('')).toEqual({ key: null, mods: [] })
  })
})

describe('reading a recording', () => {
  it('keeps the exact down and up times of a held key (to the microsecond)', () => {
    const { events } = parseRecorded(['kd 10.125 87 17 0', 'kr 510.5 87 17 0', 'ku 1260.375 87 17 0'], 'win')
    expect(events).toEqual([
      { t: 10.125, k: 'kd', code: 'KeyW', sc: 17 },
      { t: 510.5, k: 'kr', code: 'KeyW', sc: 17 },
      { t: 1260.375, k: 'ku', code: 'KeyW', sc: 17 }
    ])
  })
  it('reads mouse lines and skips broken ones', () => {
    const { events, start, hotkeyAt } = parseRecorded(['p 0 100 200 0', 'mm 1 101 200 1', 'mr 1.1 3 -2', 'bd 2 0', 'bu 3 0', 'wh 4 0 -1', 'nonsense', 'kd x', 'h 9'], 'win')
    expect(start).toEqual({ x: 100, y: 200, h: false })
    expect(events.map((e) => e.k)).toEqual(['mm', 'mr', 'bd', 'bu', 'wh'])
    expect(events[0]).toEqual({ t: 1, k: 'mm', x: 101, y: 200, h: 1 })
    expect(hotkeyAt).toEqual([9])
  })
})

describe('tidying a recording', () => {
  const opts = { os: 'win' as const, stoppedAt: 5000, stopMods: [], trimStart: false }

  it('keeps held times exactly and ends when the stop hotkey went down', () => {
    const { events, length } = tidyRecording(['p 0 5 5 0', 'kd 100 87 17 0', 'ku 1350 87 17 0', 'h 2000.25'], opts)
    const kd = events.find((e) => e.k === 'kd')!
    const ku = events.find((e) => e.k === 'ku')!
    expect(ku.t - kd.t).toBe(1250)
    expect(length).toBe(2000.25)
    expect(events[0]).toEqual({ t: 0, k: 'mm', x: 5, y: 5 })
  })

  it('drops keys that were already down when recording started', () => {
    const { events } = tidyRecording(['ku 5 162 29 0', 'kd 10 65 30 0', 'ku 20 65 30 0'], opts)
    expect(events.map((e) => `${e.k}:${'code' in e ? e.code : ''}`)).toEqual(['kd:KeyA', 'ku:KeyA'])
  })

  it('drops the stop hotkey’s Ctrl but lets go of other keys still held at the end', () => {
    const { events } = tidyRecording(['kd 10 87 17 0', 'kd 900 162 29 0', 'kr 950 162 29 0', 'h 1000'], { ...opts, stopMods: ['ControlLeft', 'ControlRight'] })
    expect(events.map((e) => `${e.k}:${'code' in e ? e.code : ''}@${e.t}`)).toEqual(['kd:KeyW@10', 'ku:KeyW@1000'])
  })

  it('turns a second "down" while held into a repeat, and lets go of held buttons at the end', () => {
    const { events } = tidyRecording(['kd 1 65 30 0', 'kd 501 65 30 0', 'ku 600 65 30 0', 'bd 700 0'], { ...opts, stoppedAt: 800 })
    expect(events.map((e) => e.k)).toEqual(['kd', 'kr', 'ku', 'bd', 'bu'])
    expect(events[events.length - 1].t).toBe(800)
  })

  it('can leave out the wait before the first input, keeping where the pointer was', () => {
    const { events, length } = tidyRecording(['p 0 1 1 0', 'mm 100 50 60 0', 'kd 400 65 30 0', 'ku 450 65 30 0', 'h 1000'], { ...opts, trimStart: true })
    expect(events[0]).toEqual({ t: 0, k: 'mm', x: 50, y: 60 })
    expect(events.find((e) => e.k === 'kd')!.t).toBe(0)
    expect(events.find((e) => e.k === 'ku')!.t).toBe(50)
    expect(length).toBe(600)
  })
})

describe('waits are kept exactly', () => {
  it('keeps the wait before the first click, between clicks and after the last one', () => {
    const lines = ['p 0 10 10 0', 'bd 5000.25 0', 'bu 5080.5 0', 'bd 10080.5 0', 'bu 10150 0', 'h 13000']
    const { events, length } = tidyRecording(lines, { os: 'win', stoppedAt: 0, stopMods: [], trimStart: false })
    const script = playbackScript(macro(events, { length }), 'win')
    expect(script).toEqual(['len 13000 loops 1', '0 M 10 10', '5000.25 B down 0', '5080.5 B up 0', '10080.5 B down 0', '10150 B up 0'])
  })
})

describe('steps', () => {
  it('shows each key with how long it was held, and runs of movement', () => {
    const events: MacroEvent[] = [
      { t: 0, k: 'mm', x: 0, y: 0 },
      { t: 4, k: 'mm', x: 0, y: 1 },
      { t: 8, k: 'mm', x: 1, y: 0 },
      { t: 16, k: 'mm', x: 2, y: 0, h: 1 },
      { t: 100, k: 'kd', code: 'KeyW' },
      { t: 600, k: 'kr', code: 'KeyW' },
      { t: 1350, k: 'ku', code: 'KeyW' },
      { t: 1400, k: 'bd', b: 0 },
      { t: 1485.5, k: 'bu', b: 0 },
      { t: 1500, k: 'wh', dx: 0, dy: -1 },
      { t: 1550, k: 'wh', dx: 0, dy: -1 }
    ]
    const { steps } = macroSteps(events)
    expect(steps).toEqual([
      { kind: 'move', at: 4, until: 16, count: 3, game: true },
      { kind: 'key', at: 100, held: 1250, code: 'KeyW', repeats: 1 },
      { kind: 'button', at: 1400, held: 85.5, b: 0 },
      { kind: 'scroll', at: 1500, notches: -2 }
    ])
    expect(macroSummary(events)).toBe('1 key, 1 click, mouse movement, scrolling')
  })
  it('formats times with enough detail to see they’re exact', () => {
    expect(formatMs(1250)).toBe('1.250 s')
    expect(formatMs(85.5)).toBe('85.5 ms')
    expect(formatMs(0.4)).toBe('0.40 ms')
    expect(formatMs(61_500)).toBe('1 min 1.5 s')
  })
})

describe('playback script', () => {
  const events: MacroEvent[] = [
    { t: 0, k: 'mm', x: 10, y: 20 },
    { t: 5, k: 'mr', dx: 1, dy: 0 },
    { t: 10, k: 'kd', code: 'KeyW', sc: 17 },
    { t: 20, k: 'mm', x: 11, y: 20, h: 1 },
    { t: 21, k: 'mr', dx: 4, dy: -2 },
    { t: 30, k: 'mm', x: 12, y: 20 },
    { t: 1260, k: 'ku', code: 'KeyW', sc: 17 },
    { t: 1300, k: 'bd', b: 0 },
    { t: 1350, k: 'bu', b: 0 }
  ]

  it('plays positions on the desktop and raw movement while a game has the mouse', () => {
    const script = playbackScript(macro(events, { length: 2000 }), 'win')
    expect(script).toEqual(['len 2000 loops 1', '0 M 10 20', '10 K down 87 17 0', '21 R 4 -2', '30 M 12 20', '1260 K up 87 17 0', '1300 B down 0', '1350 B up 0'])
  })

  it('can play only positions, only raw movement, or no movement', () => {
    const only = (mouse: Macro['mouse']): string[] => playbackScript(macro(events, { mouse }), 'win').filter((l) => / [MR] /.test(l))
    expect(only('positions')).toEqual(['0 M 10 20', '20 M 11 20', '30 M 12 20'])
    expect(only('raw')).toEqual(['5 R 1 0', '21 R 4 -2'])
    expect(only('none')).toEqual([])
  })

  it('speeds up by dividing every time (and the loop length), and repeats', () => {
    const script = playbackScript(macro(events, { length: 2000, speed: 2, repeat: 'times', times: 3 }), 'win')
    expect(script[0]).toBe('len 1000 loops 3')
    expect(script).toContain('630 K up 87 17 0')
    expect(playbackScript(macro(events, { repeat: 'forever' }), 'win')[0]).toBe('len 1350 loops 0')
  })

  it('uses Mac key numbers on a Mac', () => {
    expect(playbackScript(macro([{ t: 0, k: 'kd', code: 'KeyW' }]), 'mac')[1]).toBe('0 K down 13')
  })

  it('knows how long playing takes', () => {
    expect(playLength(macro([], { length: 1000, repeat: 'times', times: 3, speed: 2 }))).toBe(1500)
    expect(playLength(macro([], { repeat: 'forever' }))).toBeNull()
  })
})

describe('auto-clicker', () => {
  it('turns clicks per second into an exact interval', () => {
    expect(intervalFor(20)).toBe(50)
    expect(intervalFor(5000)).toBe(1)
  })
  it('keeps each click shorter than the gap between clicks', () => {
    expect(clickerPlan({ ...DEFAULT_CLICKER, intervalMs: 10, holdMs: 20 }).holdMs).toBe(9.75)
    expect(clickerPlan({ ...DEFAULT_CLICKER, intervalMs: 10, holdMs: 20 }).problem).toBeTruthy()
    expect(clickerPlan({ ...DEFAULT_CLICKER, intervalMs: 100, holdMs: 20 }).problem).toBeUndefined()
  })
  it('builds the helper command', () => {
    expect(clickerCommand({ ...DEFAULT_CLICKER, intervalMs: 50, holdMs: 10, stop: 'clicks', stopAfter: 40 }, 'win')).toBe('click b 0 0 0 50 10 40 0 - -')
    expect(clickerCommand({ ...DEFAULT_CLICKER, what: 'key', key: 'KeyE', stop: 'seconds', stopAfter: 5, where: 'spot', x: 300, y: 400 }, 'win')).toBe(
      'click k 69 0 0 100 20 0 5000 300 400'
    )
    expect(clickerCommand({ ...DEFAULT_CLICKER, what: 'key', key: 'KeyE' }, 'mac')).toBe('click k 14 0 0 100 20 0 0 - -')
  })
})

describe('saved macros', () => {
  it('cleans what was saved and keeps good macros', () => {
    const data = cleanMacros({
      macros: [
        { id: 'a', name: 'Farm', events: [{ t: 5, k: 'kd', code: 'KeyW' }, { t: -1, k: 'kd', code: 'KeyA' }, { t: 1, k: 'bd', b: 9 }], speed: 99, mouse: 'odd' },
        { id: 'a', name: 'Dupe' },
        { name: 'No id' }
      ],
      hotkeys: { record: 'F8', play: '', clicker: 'nonsense' },
      clicker: { intervalMs: 0, what: 'key' }
    })
    expect(data.macros).toHaveLength(1)
    expect(data.macros[0].events).toEqual([{ t: 5, k: 'kd', code: 'KeyW' }])
    expect(data.macros[0].speed).toBe(10)
    expect(data.macros[0].mouse).toBe('auto')
    expect(data.hotkeys).toEqual({ record: 'F8', play: '', clicker: '' })
    expect(data.clicker.intervalMs).toBe(1)
    expect(data.clicker.what).toBe('key')
    expect(data.current).toBe('a')
    expect(cleanMacros(null).hotkeys.record).toBe('F9')
    // Every wait is kept unless you ask; the first version's "on" (saved as trimStart) no longer counts.
    expect(cleanMacros(null).skipLeadingWait).toBe(false)
    expect(cleanMacros({ trimStart: true }).skipLeadingWait).toBe(false)
    expect(cleanMacros({ skipLeadingWait: true }).skipLeadingWait).toBe(true)
  })
})
