import { describe, expect, it } from 'vitest'
import { filterSongs, guessFromName, localArtUrl, localSongUrl, sortSongs, type LocalSong } from './localMusic'

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
