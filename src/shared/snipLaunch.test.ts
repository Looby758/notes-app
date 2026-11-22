import { describe, expect, it } from 'vitest'
import { snipModeFromArgv } from './snipLaunch'

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
