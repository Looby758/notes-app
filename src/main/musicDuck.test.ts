import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscordStatus, VoiceMember } from '@shared/discord'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'

// The window messages, Discord's status and the volume mixer are stand-ins; the dipping is real.
const sent: number[] = []
let listener: ((s: DiscordStatus) => void) | null = null
let spotifyVolume = 80
const sets: number[] = []

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_c: string, level: number) => sent.push(level) } }] }
}))
vi.mock('./discord', () => ({
  discordStatus: () => ({ me: { id: 'me', name: 'Me' }, deaf: false, channel: null }),
  onDiscordStatus: (l: (s: DiscordStatus) => void) => {
    listener = l
    return () => undefined
  }
}))
vi.mock('./mixer', () => ({
  mixerState: async () => ({ apps: [{ id: 'win:spotify.exe', name: 'Spotify', kind: 'app', volume: spotifyVolume, muted: false }] }),
  mixerSet: async (_id: string, v: number) => {
    spotifyVolume = v
    sets.push(v)
    return true
  }
}))
vi.mock('./log', () => ({ logError: vi.fn() }))

const member = (id: string, speaking: boolean): VoiceMember =>
  ({ id, name: id, avatar: null, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, speaking, bot: false, volume: 100, localMute: false, streaming: false, video: false }) as VoiceMember
const call = (samTalking: boolean): DiscordStatus =>
  ({ me: { id: 'me', name: 'Me' }, deaf: false, channel: { id: 'c', name: 'General', server: null, joinedAt: 0, members: [member('me', false), member('sam', samTalking)] } }) as unknown as DiscordStatus

let prefs: Prefs = { ...DEFAULT_PREFS }

describe('music dipping', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    sent.length = 0
    sets.length = 0
    spotifyVolume = 80
    prefs = { ...DEFAULT_PREFS, duckLevel: 0.3 }
    vi.resetModules()
    const { setupMusicDuck } = await import('./musicDuck')
    setupMusicDuck(() => prefs)
  })
  afterEach(() => vi.useRealTimers())

  it('dips Spotify and Orbit’s music while a friend talks, then brings them back', async () => {
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    expect(sent).toEqual([0.3])
    expect(spotifyVolume).toBe(24)
    expect(sets.length).toBeGreaterThan(1) // a fade, not a jump

    listener!(call(false))
    await vi.advanceTimersByTimeAsync(800)
    expect(spotifyVolume).toBe(24) // still waiting: they may only be between words
    await vi.advanceTimersByTimeAsync(2500)
    expect(sent).toEqual([0.3, 1])
    expect(spotifyVolume).toBe(80)
  })

  it('stays down if they start talking again within the pause', async () => {
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    listener!(call(false))
    await vi.advanceTimersByTimeAsync(700)
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(3000)
    expect(sent).toEqual([0.3])
    expect(spotifyVolume).toBe(24)
  })

  it('keeps a Spotify volume you changed while it was dipped', async () => {
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    spotifyVolume = 55
    listener!(call(false))
    await vi.advanceTimersByTimeAsync(3000)
    expect(spotifyVolume).toBe(55)
  })

  it('dips again from the right volume if they talk while it is coming back up', async () => {
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    listener!(call(false))
    await vi.advanceTimersByTimeAsync(1200 + 300) // part way back up
    expect(spotifyVolume).toBeGreaterThan(24)
    expect(spotifyVolume).toBeLessThan(80)
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    expect(spotifyVolume).toBe(24)
    listener!(call(false))
    await vi.advanceTimersByTimeAsync(3000)
    expect(spotifyVolume).toBe(80)
  })

  it('comes straight back up when you leave the call, and does nothing when turned off', async () => {
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    listener!({ ...call(false), channel: null })
    await vi.advanceTimersByTimeAsync(1100)
    expect(spotifyVolume).toBe(80)

    prefs = { ...prefs, duckMusic: false }
    sent.length = 0
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    expect(sent).toEqual([])
    expect(spotifyVolume).toBe(80)
  })

  it('leaves Spotify alone when only Orbit’s music is picked', async () => {
    prefs = { ...prefs, duckSpotify: false }
    listener!(call(true))
    await vi.advanceTimersByTimeAsync(600)
    expect(sent).toEqual([0.3])
    expect(spotifyVolume).toBe(80)
  })
})
