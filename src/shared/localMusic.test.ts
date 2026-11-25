import { describe, expect, it } from 'vitest'
import { duplicateGroups, filterSongs, guessFromName, localArtUrl, localSongUrl, safeName, sortSongs, tidyMoves, tidyPath, type LocalSong } from './localMusic'

const song = (title: string, artist = '', album = '', track = 0): LocalSong => ({ path: `${title}.mp3`, title, artist, album, track, durationMs: 0, art: false })

describe('guessFromName', () => {
  it('reads track numbers and "Artist - Title"', () => {
    expect(guessFromName('Albums/01 - Daft Punk - One More Time.mp3')).toEqual({ track: 1, artist: 'Daft Punk', title: 'One More Time' })
    expect(guessFromName('07. Breathe.flac')).toEqual({ track: 7, artist: '', title: 'Breathe' })
    expect(guessFromName('Just a name.m4a')).toEqual({ track: 0, artist: '', title: 'Just a name' })
  })
})

describe('sortSongs', () => {
  it('goes by artist (ignoring "The"), album, then track', () => {
    const sorted = sortSongs([song('B', 'The Beatles', 'Abbey Road', 2), song('A', 'The Beatles', 'Abbey Road', 1), song('X', 'ABBA', 'Gold', 1), song('Nobody')])
    expect(sorted.map((s) => s.title)).toEqual(['X', 'A', 'B', 'Nobody'])
  })
})

describe('filterSongs', () => {
  it('needs every word, in any of title, artist or album', () => {
    const songs = [song('Dreams', 'Fleetwood Mac', 'Rumours'), song('Dreams', 'The Cranberries', 'Everybody Else')]
    expect(filterSongs(songs, 'dreams rumours').map((s) => s.artist)).toEqual(['Fleetwood Mac'])
    expect(filterSongs(songs, '  ')).toHaveLength(2)
  })
})

it('builds file addresses that survive odd names', () => {
  expect(localSongUrl('Rock & Roll/#1 Hit?.mp3')).toBe('vault://music/Rock%20%26%20Roll/%231%20Hit%3F.mp3')
  expect(localArtUrl('a/b.mp3')).toBe('vault://musicart/a/b.mp3')
})

describe('tidying and duplicates', () => {
  const s = (path: string, extra: Partial<LocalSong> = {}): LocalSong => ({ path, title: 'Song', artist: 'Band', album: 'LP', track: 3, durationMs: 200000, art: false, ...extra })

  it('names files from their details', () => {
    expect(tidyPath(s('x/a.MP3'), 'flat')).toBe('Band - Song.mp3')
    expect(tidyPath(s('a.mp3', { title: 'What?: Yes/No' }), 'folders')).toBe('Band/LP/03 What YesNo.mp3')
    expect(tidyPath(s('a.mp3', { artist: '', album: '' }), 'folders')).toBe('Unknown artist/Song.mp3')
  })

  it('only moves what needs it, numbering clashes', () => {
    const moves = tidyMoves([s('Band - Song.mp3'), s('b.mp3'), s('c.mp3', { title: 'Other' })], 'flat')
    expect(moves).toEqual([
      { from: 'b.mp3', to: 'Band - Song (2).mp3' },
      { from: 'c.mp3', to: 'Band - Other.mp3' }
    ])
  })

  it('finds the same song twice', () => {
    const groups = duplicateGroups([s('a.mp3'), s('b.mp3', { title: 'Song (Remastered)', durationMs: 201000 }), s('c.mp3', { durationMs: 260000 }), s('d.mp3', { title: 'Else' })])
    expect(groups.map((g) => g.map((x) => x.path))).toEqual([['a.mp3', 'b.mp3']])
  })

  it('keeps names safe', () => {
    expect(safeName(' con ')).toBe('con_')
    expect(safeName('a<b>c. ')).toBe('abc')
  })
})

describe('accents', () => {
  it('finds songs without typing the accents', () => {
    const songs = [{ path: 'd.mp3', title: 'DÁKITI', artist: 'Bad Bunny & Jhayco', album: '', track: 0, durationMs: 0, art: false }]
    expect(filterSongs(songs, 'dakiti')).toHaveLength(1)
    expect(filterSongs(songs, 'Dákiti bad')).toHaveLength(1)
  })
})
