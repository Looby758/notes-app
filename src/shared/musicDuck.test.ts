import { describe, expect, it } from 'vitest'
import { duckedVolume, fadeSteps, friendsTalking, shouldRestore, spotifyId } from './musicDuck'
import type { VoiceMember } from './discord'

const member = (id: string, patch: Partial<VoiceMember> = {}): VoiceMember => ({
  id,
  name: id,
  avatar: null,
  selfMute: false,
  selfDeaf: false,
  serverMute: false,
  serverDeaf: false,
  speaking: false,
  bot: false,
  volume: 100,
  localMute: false,
  streaming: false,
  video: false,
  ...patch
})

const status = (members: VoiceMember[], deaf = false) =>
  ({ me: { id: 'me', name: 'Me' }, deaf, channel: { id: 'c', name: 'General', server: 'S', joinedAt: 0, members } }) as unknown as Parameters<typeof friendsTalking>[0]

describe('who is talking', () => {
  it('dips for a friend talking', () => {
    expect(friendsTalking(status([member('me'), member('sam', { speaking: true })]))).toBe(true)
  })
  it('not for you, a bot, someone you muted, or nobody', () => {
    expect(friendsTalking(status([member('me', { speaking: true }), member('sam')]))).toBe(false)
    expect(friendsTalking(status([member('me'), member('jukebox', { speaking: true, bot: true })]))).toBe(false)
    expect(friendsTalking(status([member('me'), member('loud', { speaking: true, localMute: true })]))).toBe(false)
    expect(friendsTalking(status([]))).toBe(false)
  })
  it('dips for you too when that is on', () => {
    expect(friendsTalking(status([member('me', { speaking: true }), member('sam')]), true)).toBe(true)
    expect(friendsTalking(status([member('me', { speaking: true })], true), true)).toBe(false)
  })
  it('not while deafened or out of a call', () => {
    expect(friendsTalking(status([member('sam', { speaking: true })], true))).toBe(false)
    expect(friendsTalking({ me: null, deaf: false, channel: null })).toBe(false)
  })
})

describe('Spotify', () => {
  it('finds its slider on Windows and a Mac', () => {
    expect(spotifyId([{ id: 'master', name: 'Speakers' }, { id: 'win:spotify.exe', name: 'Spotify' }])).toBe('win:spotify.exe')
    expect(spotifyId([{ id: 'mac:music', name: 'Music' }, { id: 'mac:spotify', name: 'Spotify' }])).toBe('mac:spotify')
    expect(spotifyId([{ id: 'win:discord.exe', name: 'Discord' }])).toBeNull()
  })
  it('dips to a share of its volume, never all the way to 0', () => {
    expect(duckedVolume(80, 0.3)).toBe(24)
    expect(duckedVolume(2, 0.1)).toBe(1)
  })
  it('fades in steps that end where asked', () => {
    expect(fadeSteps(80, 24, 4)).toEqual([66, 52, 38, 24])
    expect(fadeSteps(24, 80, 1)).toEqual([80])
  })
  it('keeps a volume you set yourself while it was dipped', () => {
    expect(shouldRestore(24, 24)).toBe(true)
    expect(shouldRestore(60, 24)).toBe(false)
  })
})
