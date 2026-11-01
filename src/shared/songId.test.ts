import { describe, expect, it } from 'vitest'
import { addToHistory, cleanHistory, encodeWav, parseAudd, peak, spotifyPage, spotifyQuery, type FoundSong } from './songId'

const song = (title: string, artist: string, extra: Partial<FoundSong> = {}): FoundSong => ({ title, artist, at: 1, ...extra })

describe('parseAudd', () => {
  it('reads a match with its Spotify link and picture', () => {
    const found = parseAudd(
      {
        status: 'success',
        result: {
          artist: 'M83',
          title: 'Midnight City',
          album: 'Hurry Up, We’re Dreaming',
          release_date: '2011-10-18',
          timecode: '01:12',
          song_link: 'https://lis.tn/MidnightCity',
          spotify: { id: '1eyzqe2QqGZUmfcPZtrIyt', album: { images: [{ url: 'https://i.scdn.co/image/a' }] } }
        }
      },
      5
    )
    expect(found).toEqual({
      title: 'Midnight City',
      artist: 'M83',
      album: 'Hurry Up, We’re Dreaming',
      released: '2011-10-18',
      art: 'https://i.scdn.co/image/a',
      spotifyUri: 'spotify:track:1eyzqe2QqGZUmfcPZtrIyt',
      link: 'https://lis.tn/MidnightCity',
      timecode: '01:12',
      at: 5
    })
  })

  it('uses the Apple Music picture when Spotify has none', () => {
    const found = parseAudd({ status: 'success', result: { title: 'X', artist: 'Y', apple_music: { artwork: { url: 'https://a/{w}x{h}.jpg' } } } })
    expect(found?.art).toBe('https://a/300x300.jpg')
    expect(found?.spotifyUri).toBeUndefined()
  })

  it('gives null when nothing matched', () => {
    expect(parseAudd({ status: 'success', result: null })).toBeNull()
  })

  it('explains a missing key or a used-up plan', () => {
    expect(() => parseAudd({ status: 'error', error: { error_code: 901, error_message: 'limit' } })).toThrow(/AudD key/)
    expect(() => parseAudd({ status: 'error', error: { error_code: 902 } })).toThrow(/run out/)
    expect(() => parseAudd({ status: 'error', error: { error_code: 1, error_message: 'odd' } })).toThrow('AudD: odd')
    expect(() => parseAudd('nonsense')).toThrow()
  })
})

describe('spotifyQuery', () => {
  it('drops features and remaster notes, and keeps the main artist', () => {
    expect(spotifyQuery(song('Go Your Own Way - 2004 Remaster', 'Fleetwood Mac'))).toBe('track:"Go Your Own Way" artist:"Fleetwood Mac"')
    expect(spotifyQuery(song('Sicko Mode (feat. Drake)', 'Travis Scott, Drake'))).toBe('track:"Sicko Mode" artist:"Travis Scott"')
  })
})

describe('history', () => {
  it('puts the newest first and doesn’t list a song twice', () => {
    const a = song('A', 'x', { spotifyUri: 'spotify:track:aaa' })
    const b = song('B', 'y')
    const list = addToHistory(addToHistory([], a), b)
    expect(addToHistory(list, { ...a, at: 9 }).map((s) => s.title)).toEqual(['A', 'B'])
  })

  it('drops broken saved entries and unsafe links', () => {
    const list = cleanHistory([{ title: 'A', at: 1, art: 'javascript:alert(1)', spotifyUri: 'spotify:track:abc' }, { at: 2 }, 'x'])
    expect(list).toEqual([{ title: 'A', artist: 'Unknown artist', at: 1, spotifyUri: 'spotify:track:abc', album: undefined, released: undefined, art: undefined, link: undefined, timecode: undefined }])
    expect(cleanHistory(null)).toEqual([])
  })
})

describe('encodeWav', () => {
  it('writes a mono 16-bit header and the samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 22050)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(22050)
    expect(v.getUint32(40, true)).toBe(6)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768])
  })

  it('measures how loud a clip is', () => {
    expect(peak(new Float32Array([0.1, -0.5, 0.2]))).toBe(0.5)
  })
})

it('turns a Spotify song into its web page', () => {
  expect(spotifyPage('spotify:track:abc')).toBe('https://open.spotify.com/track/abc')
  expect(spotifyPage('spotify:album:abc')).toBeUndefined()
})
