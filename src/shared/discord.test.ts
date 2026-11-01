import { describe, expect, it } from 'vitest'
import {
  chatParts,
  decodeFrames,
  discordError,
  encodeFrame,
  ipcPaths,
  memberFrom,
  membersFrom,
  memberState,
  OP,
  removeMember,
  setSpeaking,
  tokenError,
  upsertMember,
  validClientId,
  addCall,
  callClock,
  callLength,
  channelLink,
  clampVolume,
  cleanCalls,
  cornerOf,
  messageFrom,
  messagesFrom,
  offerPopout,
  patchMember,
  peopleList,
  restorePlace,
  upsertMessage,
  CHAT_KEEP,
  type CallRecord
} from './discord'

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


describe('per-person voice', () => {
  it('reads volume, local mute and streaming', () => {
    const m = memberFrom(raw('5', 'Sam', { self_stream: true }, { volume: 150, mute: true }))!
    expect(m).toMatchObject({ volume: 150, localMute: true, streaming: true, video: false })
    expect(memberFrom(raw('6', 'Alex'))!).toMatchObject({ volume: 100, localMute: false, streaming: false })
  })
  it('keeps the volume in 0 to 200', () => {
    expect(clampVolume(250)).toBe(200)
    expect(clampVolume(-4)).toBe(0)
    expect(clampVolume('loud')).toBe(100)
    expect(clampVolume(99.6)).toBe(100)
  })
  it('patches one member', () => {
    const list = membersFrom({ voice_states: [raw('1', 'A'), raw('2', 'B')] })
    const next = patchMember(list, '2', { volume: 40 })
    expect(next.map((m) => m.volume)).toEqual([100, 40])
  })
})

describe('chat', () => {
  const msg = (id: string, at: string, content = 'hi', extra: Record<string, unknown> = {}) => ({
    id,
    content,
    timestamp: at,
    author: { id: '9', username: 'sam', global_name: 'Sam', avatar: null },
    ...extra
  })
  it('reads a message, from GET_CHANNEL or an event', () => {
    expect(messageFrom(msg('1', '2026-11-01T10:00:00Z'))).toMatchObject({ id: '1', author: 'Sam', content: 'hi', attachments: 0 })
    expect(messageFrom({ channel_id: '3', message: msg('2', '2026-11-01T10:00:00Z', 'yo', { attachments: [{}], embeds: [{}] }) })).toMatchObject({ id: '2', attachments: 2 })
    expect(messageFrom({ id: 'x' })).toBeNull()
  })
  it('keeps them in order, replaces edits and keeps only the newest', () => {
    let list = messagesFrom({ messages: [msg('2', '2026-11-01T10:01:00Z'), msg('1', '2026-11-01T10:00:00Z')] })
    expect(list.map((m) => m.id)).toEqual(['1', '2'])
    list = upsertMessage(list, messageFrom(msg('1', '2026-11-01T10:00:00Z', 'edited'))!)
    expect(list[0].content).toBe('edited')
    for (let i = 0; i < CHAT_KEEP + 5; i++) list = upsertMessage(list, messageFrom(msg(`n${i}`, new Date(Date.UTC(2026, 10, 1, 11, i)).toISOString()))!)
    expect(list).toHaveLength(CHAT_KEEP)
    expect(list[list.length - 1].id).toBe(`n${CHAT_KEEP + 4}`)
  })
  it('links to the channel in Discord', () => {
    expect(channelLink('11', '22')).toBe('discord://-/channels/11/22')
    expect(channelLink(null, '22')).toBe('discord://-/channels/@me/22')
    expect(channelLink('x', '22')).toBeNull()
  })
})

describe('call timer and history', () => {
  it('shows the timer', () => {
    expect(callClock(0)).toBe('0:00')
    expect(callClock(247_000)).toBe('4:07')
    expect(callClock(3_723_000)).toBe('1:02:03')
  })
  it('says how long a call was', () => {
    expect(callLength(20_000)).toBe('under a minute')
    expect(callLength(25 * 60_000)).toBe('25 min')
    expect(callLength(65 * 60_000)).toBe('1 h 05 min')
  })
  const call = (id: string, start: number, ms: number): CallRecord => ({ id, channel: 'General', server: null, start, end: start + ms, people: ['Sam'] })
  it('keeps calls newest first, leaving out very short ones', () => {
    let list: CallRecord[] = []
    list = addCall(list, call('a', 1000, 60_000))
    list = addCall(list, call('b', 999_999, 2000))
    list = addCall(list, call('c', 500_000, 60_000))
    expect(list.map((c) => c.id)).toEqual(['c', 'a'])
  })
  it('reads a saved history, dropping damaged entries', () => {
    const list = cleanCalls([call('a', 1, 60_000), { id: 'b' }, { ...call('c', 100, 60_000), end: 0 }, 'x', { ...call('d', 5, 60_000), people: ['Al', 3] }])
    expect(list.map((c) => c.id)).toEqual(['d', 'a'])
    expect(list[0].people).toEqual(['Al'])
    expect(cleanCalls(null)).toEqual([])
  })
  it('lists who was there', () => {
    expect(peopleList([])).toBe('Just you')
    expect(peopleList(['Sam'])).toBe('Sam')
    expect(peopleList(['Sam', 'Alex'])).toBe('Sam and Alex')
    expect(peopleList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 others')
  })
})

describe('offering the pop-out', () => {
  it('only on a real join, when it’s on and not already open', () => {
    expect(offerPopout(null, '1', false, true, false)).toBe(true)
    expect(offerPopout(null, '1', true, true, false)).toBe(false)
    expect(offerPopout('2', '1', false, true, false)).toBe(false)
    expect(offerPopout(null, '1', false, false, false)).toBe(false)
    expect(offerPopout(null, '1', false, true, true)).toBe(false)
    expect(offerPopout('1', null, false, true, false)).toBe(false)
  })
})

describe('the pop-out’s place', () => {
  const left = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const right = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
  it('opens exactly where it was left', () => {
    expect(restorePlace({ x: 3900, y: 100, width: 400, height: 760, displayId: 2 }, [left, right])).toEqual({ x: 3900, y: 100, width: 400, height: 760 })
  })
  it('stays on the same screen when the screens were moved around', () => {
    const moved = { id: 2, workArea: { x: -2560, y: 0, width: 2560, height: 1400 } }
    expect(restorePlace({ x: 3900, y: 100, width: 400, height: 760, displayId: 2, offsetX: 1980, offsetY: 100 }, [left, moved])).toEqual({ x: -580, y: 100, width: 400, height: 760 })
  })
  it('gives up when its screen is gone and it’s off every screen', () => {
    expect(restorePlace({ x: 3900, y: 100, width: 400, height: 760, displayId: 2 }, [left])).toBeNull()
    expect(restorePlace(null, [left])).toBeNull()
  })
  it('fits a too-big window on its screen', () => {
    expect(restorePlace({ x: 10, y: 10, width: 3000, height: 2000, displayId: 1 }, [left])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
  })
  it('puts the note in the corner', () => {
    expect(cornerOf(right.workArea, 320, 76)).toEqual({ x: 1920 + 2560 - 336, y: 1400 - 92, width: 320, height: 76 })
  })
})

describe('mentions in the chat', () => {
  const names: Record<string, { name: string; username: string | null }> = { '42': { name: 'Sam', username: 'sam_rblx' } }
  const look = (id: string) => names[id] ?? null
  it('shows @name instead of the number', () => {
    expect(chatParts('hey <@42> and <@!42>!', look)).toEqual([
      { text: 'hey ' },
      { mention: '@Sam', kind: 'user', title: '@sam_rblx' },
      { text: ' and ' },
      { mention: '@Sam', kind: 'user', title: '@sam_rblx' },
      { text: '!' }
    ])
  })
  it('never shows the raw number for someone unknown, a role or a channel', () => {
    const text = chatParts('<@7> <@&8> <#9> <:pog:123> <a:dance:456>', look)
      .map((p) => ('text' in p ? p.text : p.mention))
      .join('')
    expect(text).toBe('@unknown user @role #channel :pog: :dance:')
  })
  it('reads the people a message mentions', () => {
    const m = messageFrom({
      id: '1',
      content: '<@5>',
      timestamp: '2026-11-01T10:00:00Z',
      author: { id: '9', username: 'a' },
      mentions: [{ id: '5', username: 'alex.k', global_name: 'Alex', member: { nick: 'Big Al' } }, { id: '6', username: 'jo' }]
    })!
    expect(m.mentions).toEqual({ '5': { name: 'Big Al', username: 'alex.k' }, '6': { name: 'jo', username: 'jo' } })
  })
  it('leaves plain text alone', () => {
    expect(chatParts('no codes <here>', look)).toEqual([{ text: 'no codes <here>' }])
  })
})
