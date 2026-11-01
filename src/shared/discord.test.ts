import { describe, expect, it } from 'vitest'
import { decodeFrames, discordError, encodeFrame, ipcPaths, memberFrom, membersFrom, memberState, OP, removeMember, setSpeaking, tokenError, upsertMember, validClientId } from './discord'

const raw = (id: string, name: string, vs: Record<string, boolean> = {}, extra: Record<string, unknown> = {}) => ({
  user: { id, username: name.toLowerCase(), global_name: name, avatar: 'abc123', bot: false },
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, suppress: false, ...vs },
  ...extra
})

describe('discord frames', () => {
  it('round-trips a message', () => {
    const f = encodeFrame(OP.frame, { cmd: 'GET_VOICE_SETTINGS', nonce: 'n' })
    const { frames, rest } = decodeFrames(f)
    expect(frames).toEqual([{ op: 1, data: { cmd: 'GET_VOICE_SETTINGS', nonce: 'n' } }])
    expect(rest.length).toBe(0)
  })

  it('keeps a half-arrived message for later', () => {
    const a = encodeFrame(OP.frame, { a: 1 })
    const b = encodeFrame(OP.ping, { b: 'é' })
    const joined = new Uint8Array(a.length + b.length)
    joined.set(a)
    joined.set(b, a.length)
    const first = decodeFrames(joined.subarray(0, a.length + 5))
    expect(first.frames).toEqual([{ op: 1, data: { a: 1 } }])
    expect(first.rest.length).toBe(5)
    const all = new Uint8Array([...first.rest, ...joined.subarray(a.length + 5)])
    expect(decodeFrames(all).frames).toEqual([{ op: 3, data: { b: 'é' } }])
  })

  it('refuses a silly length', () => {
    const bad = new Uint8Array(8)
    new DataView(bad.buffer).setInt32(4, -1, true)
    expect(() => decodeFrames(bad)).toThrow()
  })
})

describe('discord socket paths', () => {
  it('uses named pipes on Windows', () => {
    const p = ipcPaths('win32', {})
    expect(p[0]).toBe('\\\\?\\pipe\\discord-ipc-0')
    expect(p).toHaveLength(10)
  })
  it('uses the temp folder on Mac', () => {
    const p = ipcPaths('darwin', { TMPDIR: '/var/folders/x/T/' })
    expect(p[0]).toBe('/var/folders/x/T/discord-ipc-0')
    expect(p).toContain('/var/folders/x/T/snap.discord/discord-ipc-3')
  })
})

describe('voice members', () => {
  it('reads a voice state', () => {
    const m = memberFrom(raw('111', 'Looby', { self_mute: true }))!
    expect(m).toMatchObject({ id: '111', name: 'Looby', selfMute: true, selfDeaf: false, serverMute: false })
    expect(m.avatar).toBe('https://cdn.discordapp.com/avatars/111/abc123.png?size=64')
    expect(memberState(m)).toBe('Muted')
  })

  it('prefers the server nickname', () => {
    expect(memberFrom(raw('1', 'Global', {}, { nick: 'Nick' }))!.name).toBe('Nick')
  })

  it('ignores junk', () => {
    expect(memberFrom(null)).toBeNull()
    expect(memberFrom({ user: {} })).toBeNull()
    expect(membersFrom({ voice_states: [null, raw('2', 'Bee'), raw('1', 'Ant')] }).map((m) => m.name)).toEqual(['Ant', 'Bee'])
  })

  it('deafened beats muted, server beats self', () => {
    expect(memberState(memberFrom(raw('1', 'A', { self_mute: true, self_deaf: true }))!)).toBe('Deafened')
    expect(memberState(memberFrom(raw('1', 'A', { suppress: true }))!)).toBe('Server muted')
    expect(memberState(memberFrom(raw('1', 'A'))!)).toBeNull()
  })

  it('keeps who is talking through updates', () => {
    let list = membersFrom({ voice_states: [raw('1', 'A'), raw('2', 'B')] })
    list = setSpeaking(list, '1', true)
    list = upsertMember(list, memberFrom(raw('1', 'A', { self_mute: true }))!)
    expect(list.find((m) => m.id === '1')).toMatchObject({ speaking: true, selfMute: true })
    expect(removeMember(list, '1').map((m) => m.id)).toEqual(['2'])
  })

  it('refuses odd avatar hashes', () => {
    expect(memberFrom({ user: { id: '1', username: 'a', avatar: '../x' } })!.avatar).toBeNull()
  })
})

describe('discord words', () => {
  it('checks application ids', () => {
    expect(validClientId(' 123456789012345678 ')).toBe(true)
    expect(validClientId('abc')).toBe(false)
  })
  it('explains errors', () => {
    expect(discordError(5000, 'Invalid Client ID')).toMatch(/application id/)
    expect(discordError(5003, 'User closed')).toMatch(/turned it down/)
    expect(tokenError(400, { error: 'invalid_client' })).toMatch(/client secret/)
    expect(tokenError(400, { error: 'invalid_grant', error_description: 'Invalid "redirect_uri" in request.' })).toMatch(/localhost/)
  })
})
