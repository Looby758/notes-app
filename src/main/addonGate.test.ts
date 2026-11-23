import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A stand-in for Electron's message handling, so the checks can be seen working.
const env = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), listeners: new Map<string, (...args: unknown[]) => void>() }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => env.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => env.listeners.set(channel, fn)
  }
}))

const { addonForChannel, addonOn, addonsMaybeChanged, onAddonsChanged, setupAddonGate, startsCoreOnly } = await import('./addonGate')
const { ipcMain } = await import('electron')
const { ADDON_IDS } = await import('@shared/addons')

let installed: string[] = [...ADDON_IDS]
setupAddonGate(() => installed)

const dirs: string[] = []
afterEach(() => {
  installed = [...ADDON_IDS]
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('add-on messages', () => {
  it('knows which add-on a message belongs to', () => {
    expect(addonForChannel('macros:play')).toBe('macros')
    expect(addonForChannel('skyblockGoals:state')).toBe('skyblock')
    expect(addonForChannel('cal:events')).toBe('calendar')
    expect(addonForChannel('prefs:get')).toBeNull()
    expect(addonForChannel('fs:read')).toBeNull()
  })

  it('only names add-ons that exist', async () => {
    const { ADDON_IDS: ids } = await import('@shared/addons')
    for (const channel of ['skyblock', 'macros', 'keyremap', 'discord', 'fsend', 'explorer', 'cal', 'music', 'dm', 'vdl', 'clips', 'screen', 'cam', 'studio', 'term', 'apps', 'localAi', 'monitors', 'tasks', 'weather', 'video']) {
      expect(ids, channel).toContain(addonForChannel(`${channel}:x`))
    }
  })

  it('turns away a message to an add-on that isn’t added', async () => {
    const play = vi.fn(() => 'played')
    ipcMain.handle('macros:play', play)
    const handler = env.handlers.get('macros:play')!
    expect(await handler({})).toBe('played')
    installed = installed.filter((id) => id !== 'macros')
    expect(() => handler({})).toThrow('Macros isn’t added')
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('ignores one-way messages to an add-on that isn’t added', () => {
    const fn = vi.fn()
    ipcMain.on('skyblock:ping', fn)
    installed = installed.filter((id) => id !== 'skyblock')
    env.listeners.get('skyblock:ping')!({})
    expect(fn).not.toHaveBeenCalled()
  })

  it('leaves core messages alone', () => {
    const fn = vi.fn(() => 'ok')
    ipcMain.handle('prefs:get', fn)
    installed = []
    expect(env.handlers.get('prefs:get')).toBe(fn)
  })
})

describe('removing an add-on', () => {
  it('tells whatever is listening, once', () => {
    const fn = vi.fn()
    const off = onAddonsChanged(fn)
    installed = installed.filter((id) => id !== 'keyremap')
    addonsMaybeChanged()
    addonsMaybeChanged()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(addonOn('keyremap')).toBe(false)
    off()
  })
})

describe('new Orbits', () => {
  it('start with just the core for a brand new notes folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-notes-'))
    dirs.push(dir)
    expect(startsCoreOnly(false, dir)).toBe(true)
  })

  it('keep everything when the notes folder has been used with Orbit, or settings exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-notes-'))
    dirs.push(dir)
    expect(startsCoreOnly(true, dir)).toBe(false)
    mkdirSync(join(dir, '.notesapp'))
    expect(startsCoreOnly(false, dir)).toBe(false)
  })
})
