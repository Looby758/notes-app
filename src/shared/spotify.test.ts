import { describe, expect, it } from 'vitest'
import { APP_FIELD_SEP, formatTime, nextRepeat, parseAccountState, parseAppState, parseDevices, parsePlaylists, parseQueue, parseRecent, parseSearch, playBody, spotifyUri } from './spotify'

describe('spotifyUri', () => {
  it('reads share links and URIs', () => {
    expect(spotifyUri('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123')).toBe('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
    expect(spotifyUri('open.spotify.com/intl-en/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('spotify:track:4uLU6hMCjMI75M1A2tKUQC')
    expect(spotifyUri('  spotify:album:1DFixLWuPkv3KT3TnV35m3 ')).toBe('spotify:album:1DFixLWuPkv3KT3TnV35m3')
  })
  it('rejects anything else', () => {
    expect(spotifyUri('https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(spotifyUri('hello')).toBeNull()
    expect(spotifyUri('spotify:track:x" & do shell script "rm')).toBeNull()
  })
})

describe('parseAppState', () => {
  it('reads what the Mac app says', () => {
    const out = ['playing', 'Song', 'Artist', 'Album', 'https://i.scdn.co/image/x', 'spotify:track:abc', '187000', '61500', 'true', '70', 'true'].join(APP_FIELD_SEP) + '\n'
    expect(parseAppState(out)).toEqual({
      source: 'app',
      playing: true,
      track: { name: 'Song', artist: 'Artist', album: 'Album', art: 'https://i.scdn.co/image/x', uri: 'spotify:track:abc', durationMs: 187000 },
      positionMs: 61500,
      shuffle: true,
      repeat: 'context',
      volume: 70
    })
  })
  it('copes with an older answer that has no repeat', () => {
    const out = ['paused', 'Song', 'Artist', 'Album', '', 'spotify:track:abc', '187000', '0', 'false', '70'].join(APP_FIELD_SEP)
    expect(parseAppState(out).repeat).toBe('off')
  })
  it('is empty when stopped', () => {
    expect(parseAppState('stopped\n')).toEqual({ source: 'app', playing: false, positionMs: 0 })
  })
})

describe('parseAccountState', () => {
  it('reads GET /me/player', () => {
    const s = parseAccountState({
      is_playing: false,
      progress_ms: 1000,
      shuffle_state: false,
      device: { name: 'iPhone', volume_percent: 40 },
      item: {
        type: 'track',
        name: 'Song',
        uri: 'spotify:track:abc',
        duration_ms: 200000,
        artists: [{ name: 'A' }, { name: 'B' }],
        album: { name: 'Album', images: [{ url: 'https://big', width: 640 }, { url: 'https://mid', width: 300 }] }
      }
    })
    expect(s).toMatchObject({ source: 'account', playing: false, positionMs: 1000, device: 'iPhone', volume: 40, repeat: 'off' })
    expect(parseAccountState({ device: {}, repeat_state: 'track' }).repeat).toBe('track')
    expect(parseAccountState({ device: {}, repeat_state: 'nonsense' }).repeat).toBe('off')
    expect(s.track).toEqual({ name: 'Song', artist: 'A, B', album: 'Album', art: 'https://mid', uri: 'spotify:track:abc', durationMs: 200000 })
  })
  it('says when nothing is playing anywhere', () => {
    expect(parseAccountState({}).hint).toBe('no-device')
  })
})

describe('search and playlists', () => {
  it('skips the nulls Spotify sometimes returns', () => {
    const r = parseSearch({
      tracks: { items: [{ name: 'T', uri: 'spotify:track:1', artists: [{ name: 'X' }], album: { images: [] } }] },
      playlists: { items: [null, { name: 'P', uri: 'spotify:playlist:2', owner: { display_name: 'Me' }, items: { total: 12 }, images: [] }] },
      albums: { items: [] }
    })
    expect(r.tracks).toEqual([{ kind: 'track', name: 'T', detail: 'X', art: undefined, uri: 'spotify:track:1' }])
    expect(r.playlists[0].detail).toBe('Me · 12 songs')
    expect(parsePlaylists({ items: [{ name: 'Old', uri: 'spotify:playlist:3', tracks: { total: 1 } }] })[0].detail).toBe('1 song')
  })
})

describe('queue, recently played and devices', () => {
  const song = (n: number) => ({ type: 'track', name: `S${n}`, uri: `spotify:track:${n}`, artists: [{ name: 'A' }], album: { images: [] } })
  it('reads GET /me/player/queue', () => {
    const q = parseQueue({
      currently_playing: song(1),
      queue: [song(2), null, { type: 'episode', name: 'Ep', uri: 'spotify:episode:9', show: { name: 'Show', images: [{ url: 'https://show' }] } }]
    })
    expect(q.current?.name).toBe('S1')
    expect(q.next.map((i) => [i.name, i.detail, i.art])).toEqual([
      ['S2', 'A', undefined],
      ['Ep', 'Show', 'https://show']
    ])
    expect(parseQueue({ currently_playing: null, queue: [] })).toEqual({ current: undefined, next: [] })
  })
  it('lists each recently played song once, newest first', () => {
    const r = parseRecent({ items: [{ track: song(1) }, { track: song(2) }, { track: song(1) }, { track: null }] })
    expect(r.map((i) => i.uri)).toEqual(['spotify:track:1', 'spotify:track:2'])
  })
  it('leaves out devices that can’t be controlled', () => {
    const d = parseDevices({
      devices: [
        { id: 'a1', name: 'MacBook', type: 'Computer', is_active: true, volume_percent: 50 },
        { id: 'b2', name: 'Locked', type: 'Speaker', is_restricted: true },
        { id: null, name: 'No id', type: 'Speaker' }
      ]
    })
    expect(d).toEqual([{ id: 'a1', name: 'MacBook', type: 'Computer', active: true, volume: 50 }])
  })
  it('cycles repeat: off, all, this song', () => {
    expect(nextRepeat(undefined)).toBe('context')
    expect(nextRepeat('off')).toBe('context')
    expect(nextRepeat('context')).toBe('track')
    expect(nextRepeat('track')).toBe('off')
  })
})

describe('playBody', () => {
  it('plays songs, playlists and albums', () => {
    expect(playBody('spotify:track:1')).toEqual({ uris: ['spotify:track:1'] })
    expect(playBody('spotify:track:1', 'spotify:album:2')).toEqual({ context_uri: 'spotify:album:2', offset: { uri: 'spotify:track:1' } })
    expect(playBody('spotify:playlist:3')).toEqual({ context_uri: 'spotify:playlist:3' })
  })
})

it('formatTime', () => {
  expect(formatTime(187000)).toBe('3:07')
  expect(formatTime(3725000)).toBe('1:02:05')
})
