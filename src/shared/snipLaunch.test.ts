import { describe, expect, it } from 'vitest'
import { cleanSnipDelay, snipDelayFromArgv, snipModeFromArgv } from './snipLaunch'

describe('snipModeFromArgv', () => {
  it('spots the taskbar shortcut and jump list flags', () => {
    expect(snipModeFromArgv(['C:\\Orbit\\Orbit.exe', '--snip'])).toBe('picture')
    expect(snipModeFromArgv(['C:\\Orbit\\Orbit.exe', '--snip-text'])).toBe('text')
    // Development: electron.exe, the app folder, then the flag.
    expect(snipModeFromArgv(['electron.exe', 'C:\\code\\notes-app', '--SNIP'])).toBe('picture')
  })
  it('ignores ordinary launches and the program name', () => {
    expect(snipModeFromArgv(['C:\\Orbit\\Orbit.exe'])).toBeNull()
    expect(snipModeFromArgv(['C:\\Orbit\\Orbit.exe', '--hidden'])).toBeNull()
    expect(snipModeFromArgv(['--snip'])).toBeNull()
    expect(snipModeFromArgv(['Orbit.exe', '--open-in-orbit=C:\\--snip.png'])).toBeNull()
  })
})

import { cleanSnipFolder } from './prefs'
import { snipFileName } from './snipLaunch'

describe('cleanSnipFolder', () => {
  it('keeps full paths and drops anything else', () => {
    expect(cleanSnipFolder('C:\\Users\\me\\Pictures\\Snips')).toBe('C:\\Users\\me\\Pictures\\Snips')
    expect(cleanSnipFolder('  D:/Snips ')).toBe('D:/Snips')
    expect(cleanSnipFolder('\\\\nas\\share')).toBe('\\\\nas\\share')
    expect(cleanSnipFolder('/Users/me/Desktop')).toBe('/Users/me/Desktop')
    expect(cleanSnipFolder('Snips')).toBe('')
    expect(cleanSnipFolder(42)).toBe('')
  })
})

describe('snipFileName', () => {
  it('names a snip after when it was taken, safely for Windows', () => {
    expect(snipFileName(new Date(2026, 10, 22, 9, 5, 7))).toBe('Snip 2026-11-22 09-05-07.png')
    expect(snipFileName(new Date(2026, 10, 22, 9, 5, 7), 2)).toBe('Snip 2026-11-22 09-05-07 (2).png')
  })
})

describe('snip delays', () => {
  it('reads the delay from the jump list flag', () => {
    expect(snipModeFromArgv(['Orbit.exe', '--snip-delay=5'])).toBe('picture')
    expect(snipDelayFromArgv(['Orbit.exe', '--snip-delay=5'])).toBe(5)
    expect(snipDelayFromArgv(['Orbit.exe', '--snip-delay=999'])).toBe(30)
    expect(snipDelayFromArgv(['Orbit.exe', '--snip'])).toBeUndefined()
    expect(snipDelayFromArgv(['--snip-delay=5'])).toBeUndefined()
  })
  it('keeps delays to whole seconds from 0 to 30', () => {
    expect(cleanSnipDelay(3.4)).toBe(3)
    expect(cleanSnipDelay(-2)).toBe(0)
    expect(cleanSnipDelay(45)).toBe(30)
    expect(cleanSnipDelay('7')).toBe(7)
    expect(cleanSnipDelay('soon')).toBe(0)
    expect(cleanSnipDelay(undefined)).toBe(0)
  })
})
