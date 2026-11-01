import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  boardHotkeys,
  cleanBoard,
  hotkeyLabel,
  hotkeyOwner,
  isVirtualCableInput,
  isVirtualCableOutput,
  nameFromFile,
  normalizeAccelerator,
  pitchShiftSettings
} from './soundboard'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}, k = 'x') => ({
  key: k,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('soundboard hotkeys', () => {
  it('reads key presses as Electron accelerators', () => {
    expect(acceleratorFromEvent(key('Digit1', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+1')
    expect(acceleratorFromEvent(key('Numpad5'))).toBe('num5')
    expect(acceleratorFromEvent(key('F9'))).toBe('F9')
    expect(acceleratorFromEvent(key('F13'))).toBe('F13')
    expect(acceleratorFromEvent(key('KeyK', { shiftKey: true, metaKey: true }))).toBe('Shift+Super+K')
    expect(acceleratorFromEvent(key('NumpadAdd', { ctrlKey: true }))).toBe('Control+numadd')
  })

  it('refuses keys that would stop you typing', () => {
    expect(acceleratorFromEvent(key('KeyA'))).toBeNull()
    expect(acceleratorFromEvent(key('Digit3', { shiftKey: true }))).toBeNull()
    expect(acceleratorFromEvent(key('ShiftLeft', { shiftKey: true }, 'Shift'))).toBeNull()
  })

  it('tidies saved accelerators', () => {
    expect(normalizeAccelerator('Alt+Ctrl+1')).toBe('Control+Alt+1')
    expect(normalizeAccelerator('num7')).toBe('num7')
    expect(normalizeAccelerator('K')).toBe('')
    expect(normalizeAccelerator('Control+Banana')).toBe('')
    expect(normalizeAccelerator('')).toBe('')
  })

  it('labels hotkeys for people', () => {
    expect(hotkeyLabel('Control+Alt+1', false)).toBe('Ctrl+Alt+1')
    expect(hotkeyLabel('num5', false)).toBe('Num 5')
    expect(hotkeyLabel('Super+Shift+F1', false)).toBe('Win+Shift+F1')
    expect(hotkeyLabel('Control+Alt+1', true)).toBe('⌃⌥1')
  })
})

describe('cleanBoard', () => {
  it('keeps good clips and drops broken ones', () => {
    const board = cleanBoard({
      clips: [
        { id: 'a', file: 'a.mp3', name: 'Air horn', hotkey: 'num1', volume: 5 },
        { id: 'b', file: '../evil.mp3', name: 'Bad' },
        { id: 'c', file: 'c.exe', name: 'Not a sound' },
        { id: 'a', file: 'dup.mp3', name: 'Same id' },
        { id: 'd', file: 'd.wav', name: '', hotkey: 'num1' }
      ],
      hotkeys: { stopAll: 'Escape', voiceToggle: 'F8' }
    })
    expect(board.clips.map((c) => c.id)).toEqual(['a', 'd'])
    expect(board.clips[0].volume).toBe(2)
    // Only one thing can have a hotkey.
    expect(board.clips[1].hotkey).toBe('')
    expect(board.clips[1].name).toBe('D')
    expect(board.hotkeys).toEqual({ stopAll: '', voiceToggle: 'F8', muteToggle: '' })
  })

  it('copes with nonsense', () => {
    expect(cleanBoard(null)).toEqual({ clips: [], hotkeys: { stopAll: '', voiceToggle: '', muteToggle: '' } })
    expect(cleanBoard({ clips: 'x' }).clips).toEqual([])
  })

  it('maps hotkeys to what they do and finds who has one', () => {
    const board = cleanBoard({ clips: [{ id: 'a', file: 'a.mp3', name: 'Horn', hotkey: 'F9' }], hotkeys: { stopAll: 'F10' } })
    expect(boardHotkeys(board).get('F9')).toEqual({ kind: 'clip', id: 'a' })
    expect(boardHotkeys(board).get('F10')).toEqual({ kind: 'stopAll' })
    expect(hotkeyOwner(board, 'F9')).toBe('“Horn”')
    expect(hotkeyOwner(board, 'F9', 'a')).toBeNull()
    expect(hotkeyOwner(board, 'F10')).toBe('Stop all sounds')
  })
})

describe('soundboard helpers', () => {
  it('names clips from their files', () => {
    expect(nameFromFile('C:\\Sounds\\air_horn-sound.mp3')).toBe('Air horn sound')
    expect(nameFromFile('/x/.mp3')).toBe('Sound')
  })

  it('spots virtual cables', () => {
    expect(isVirtualCableOutput('CABLE Input (VB-Audio Virtual Cable)')).toBe(true)
    expect(isVirtualCableOutput('BlackHole 2ch')).toBe(true)
    expect(isVirtualCableOutput('Speakers (Realtek(R) Audio)')).toBe(false)
    expect(isVirtualCableInput('CABLE Output (VB-Audio Virtual Cable)')).toBe(true)
    expect(isVirtualCableInput('Microphone (HyperX SoloCast)')).toBe(false)
  })

  it('works out the pitch shifter for a pitch', () => {
    expect(pitchShiftSettings(1.5)).toEqual({ up: true, amount: 1 })
    expect(pitchShiftSettings(0.75)).toEqual({ up: false, amount: 0.5 })
    expect(pitchShiftSettings(1)).toEqual({ up: true, amount: 0 })
  })
})
