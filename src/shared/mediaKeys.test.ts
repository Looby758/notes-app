import { describe, expect, it } from 'vitest'
import { holdMediaKeys, MEDIA_KEYS, MEDIA_KEYS_HOLD_MS, playingOwnMusic } from './mediaKeys'
import type { MusicState } from './spotify'

const track = { name: 'Song', artist: 'Artist', album: 'Album', uri: 'local:a.mp3', durationMs: 200000 }
const local = (playing: boolean): MusicState => ({ source: 'local', playing, track, positionMs: 0 })

describe('media keys', () => {
  it('takes the keys while your own music plays', () => {
    expect(holdMediaKeys(local(true), 0, 1000)).toBe(true)
    expect(playingOwnMusic(local(true))).toBe(true)
  })

  it('keeps them for a while after a pause, then lets go', () => {
    const now = 5_000_000
    expect(holdMediaKeys(local(false), now - 60_000, now)).toBe(true)
    expect(holdMediaKeys(local(false), now - MEDIA_KEYS_HOLD_MS - 1, now)).toBe(false)
  })

  it('leaves them alone for a song loaded paused that was never played', () => {
    expect(holdMediaKeys(local(false), 0, 1000)).toBe(false)
  })

  it('leaves them for Spotify and when nothing is loaded', () => {
    expect(holdMediaKeys({ source: 'app', playing: true, track, positionMs: 0 }, 0, 1000)).toBe(false)
    expect(holdMediaKeys({ source: 'account', playing: true, track, positionMs: 0 }, 900, 1000)).toBe(false)
    expect(holdMediaKeys({ source: 'local', playing: true, positionMs: 0 }, 900, 1000)).toBe(false)
    expect(holdMediaKeys(null, 900, 1000)).toBe(false)
  })

  it('maps previous, next and play/pause', () => {
    const byKey = Object.fromEntries(MEDIA_KEYS.map((k) => [k.accelerator, k.action]))
    expect(byKey).toMatchObject({ MediaPlayPause: 'toggle', MediaNextTrack: 'next', MediaPreviousTrack: 'previous' })
  })
})
