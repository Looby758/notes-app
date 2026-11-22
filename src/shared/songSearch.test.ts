import { describe, expect, it } from 'vitest'
import { firstVideoId, itunesSearchUrl, parseItunes, songKey, youtubeQuery } from './songSearch'

describe('song search', () => {
  it('builds the iTunes search address', () => {
    expect(itunesSearchUrl(' daft punk & co ')).toBe('https://itunes.apple.com/search?media=music&entity=song&limit=40&term=daft%20punk%20%26%20co')
  })

  it('reads songs from iTunes, skipping anything else and repeats', () => {
    const songs = parseItunes({
      results: [
        { kind: 'song', trackId: 1, trackName: 'One More Time', artistName: 'Daft Punk', collectionName: 'Discovery', releaseDate: '2001-03-12T08:00:00Z', primaryGenreName: 'Electronic', trackTimeMillis: 320357, artworkUrl100: 'https://is1.mzstatic.com/a/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a' },
        { kind: 'song', trackId: 1, trackName: 'One More Time' },
        { kind: 'music-video', trackId: 2, trackName: 'Video' },
        { kind: 'song', trackId: 3, trackName: 'Plain', previewUrl: 'http://insecure' },
        null
      ]
    })
    expect(songs).toHaveLength(2)
    expect(songs[0]).toEqual({ id: '1', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', year: '2001', genre: 'Electronic', durationMs: 320357, art: 'https://is1.mzstatic.com/a/300x300bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/p.m4a' })
    expect(songs[1].preview).toBeUndefined()
    expect(parseItunes('nonsense')).toEqual([])
  })

  it('finds the first video on a YouTube results page', () => {
    expect(firstVideoId('..."videoRenderer":{"videoId":"FGBhQbmPwH8","thumbnail"...')).toBe('FGBhQbmPwH8')
    expect(firstVideoId('{"videoId":"abcdefghijk"}')).toBe('abcdefghijk')
    expect(firstVideoId('<html>nothing</html>')).toBeNull()
    expect(youtubeQuery(' Daft  Punk', 'One More Time ')).toBe('Daft Punk One More Time')
  })

  it('matches your copy despite small differences', () => {
    expect(songKey('The Beatles', 'Let It Be (Remastered 2009)')).toBe(songKey('Beatles', 'Let it be'))
    expect(songKey('Abba', 'SOS')).not.toBe(songKey('Abba', 'Waterloo'))
  })
})
