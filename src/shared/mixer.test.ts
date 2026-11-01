import { describe, expect, it } from 'vitest'
import { appKey, clampVolume, friendlyName, groupSessions, macState, type RawSession } from './mixer'

const session = (s: Partial<RawSession>): RawSession => ({
  pid: 1,
  exe: '',
  proc: '',
  desc: '',
  display: '',
  title: '',
  vol: 1,
  mute: false,
  peak: 0,
  sys: false,
  ...s
})

describe('friendlyName', () => {
  it('uses short names for well-known apps', () => {
    expect(friendlyName(session({ proc: 'Discord', desc: 'Discord' }))).toBe('Discord')
    expect(friendlyName(session({ proc: 'chrome', desc: 'Google Chrome' }))).toBe('Chrome')
  })

  it('uses the window title for Java games like Minecraft', () => {
    expect(friendlyName(session({ proc: 'javaw', desc: 'Java(TM) Platform SE binary', title: 'Minecraft 1.8.9' }))).toBe('Minecraft 1.8.9')
    expect(friendlyName(session({ proc: 'javaw', desc: 'Java(TM) Platform SE binary' }))).toBe('Javaw')
  })

  it('prefers the sound’s own name, then the description, then the process', () => {
    expect(friendlyName(session({ proc: 'game', display: 'Cool Game', desc: 'Engine' }))).toBe('Cool Game')
    expect(friendlyName(session({ proc: 'game', display: '@%SystemRoot%\\x.dll,-1', desc: 'Cool Game' }))).toBe('Cool Game')
    expect(friendlyName(session({ proc: 'game' }))).toBe('Game')
    expect(friendlyName(session({ sys: true }))).toBe('System sounds')
  })
})

describe('groupSessions', () => {
  it('makes one slider per program, with every session as a target', () => {
    const g = groupSessions({
      ok: true,
      master: { name: 'Speakers', vol: 0.5, mute: false, peak: 0.2 },
      sessions: [
        session({ pid: 10, exe: 'C:\\Apps\\Discord.exe', proc: 'Discord', vol: 0.4, peak: 0.1 }),
        session({ pid: 11, exe: 'C:\\Apps\\Discord.exe', proc: 'Discord', vol: 0.6, peak: 0.3 }),
        session({ pid: 20, exe: 'C:\\Spotify\\Spotify.exe', proc: 'Spotify', mute: true }),
        session({ pid: 0, sys: true, vol: 1 })
      ]
    })
    expect(g.apps.map((a) => a.id)).toEqual(['master', 'win:discord.exe', 'win:spotify.exe', 'system'])
    expect(g.apps[0]).toMatchObject({ name: 'Everything', volume: 50, level: 20 })
    expect(g.apps[1]).toMatchObject({ name: 'Discord', volume: 60, level: 30, muted: false })
    expect(g.apps[2]).toMatchObject({ name: 'Spotify', muted: true })
    expect(g.targets['win:discord.exe']).toEqual(['10', '11'])
    expect(g.targets.system).toEqual(['sys'])
    expect(g.targets.master).toEqual(['master'])
    expect(g.exes['win:spotify.exe']).toBe('C:\\Spotify\\Spotify.exe')
  })

  it('picks up a window title from a later session', () => {
    const g = groupSessions({
      ok: true,
      master: null,
      sessions: [session({ pid: 1, proc: 'javaw', exe: 'C:\\j\\javaw.exe' }), session({ pid: 2, proc: 'javaw', exe: 'C:\\j\\javaw.exe', title: 'Minecraft' })]
    })
    expect(g.apps.map((a) => a.name)).toEqual(['Minecraft'])
  })

  it('keys apps without a path by process name', () => {
    expect(appKey(session({ proc: 'Game' }))).toBe('win:game.exe')
  })
})

describe('macState', () => {
  it('shows the Mac’s volume and the apps that allow it, remembering muted ones', () => {
    const s = macState({ master: { vol: 40, mute: false }, apps: [{ id: 'mac:spotify', vol: 0 }, { id: 'mac:music', vol: 70 }, { id: 'mac:other', vol: 5 }] }, { 'mac:spotify': 55 })
    expect(s.apps).toEqual([
      { id: 'master', name: 'Everything', kind: 'master', volume: 40, muted: false },
      { id: 'mac:spotify', name: 'Spotify', kind: 'app', volume: 55, muted: true },
      { id: 'mac:music', name: 'Music', kind: 'app', volume: 70, muted: false }
    ])
    expect(s.problem).toBeUndefined()
  })

  it('explains when the output has no volume', () => {
    expect(macState({ master: { vol: null, mute: false }, apps: [] }, {}).problem).toMatch(/HDMI/)
  })
})

it('clampVolume keeps volumes whole and in range', () => {
  expect(clampVolume(120)).toBe(100)
  expect(clampVolume(-3)).toBe(0)
  expect(clampVolume('42.6')).toBe(43)
  expect(clampVolume(NaN)).toBe(0)
})
