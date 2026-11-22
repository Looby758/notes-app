import { describe, expect, it } from 'vitest'
import type { LocalSong } from './localMusic'
import {
  allTags,
  albumsOf,
  applyMusicEdit,
  artistsOf,
  emptyMusicData,
  HISTORY_LIMIT,
  likedSongs,
  mostPlayed,
  normalizeMusicData,
  queueMove,
  queuePlayNext,
  queueRemove,
  songsByPath,
  sortSongsBy,
  totalLength
} from './musicLibrary'

const song = (path: string, extra: Partial<LocalSong> = {}): LocalSong => ({ path, title: path, artist: 'A', album: 'X', track: 0, durationMs: 60000, art: false, ...extra })

describe('applyMusicEdit', () => {
  it('makes, fills, reorders, renames and deletes a playlist', () => {
    let d = applyMusicEdit(emptyMusicData(), { kind: 'createPlaylist', id: 'p', name: ' Gym ', at: 1 })
    expect(d.playlists).toEqual([{ id: 'p', name: 'Gym', songs: [], created: 1, updated: 1 }])
    d = applyMusicEdit(d, { kind: 'addToPlaylist', id: 'p', songs: ['a.mp3', 'b.mp3', 'a.mp3'], at: 2 })
    expect(d.playlists[0].songs).toEqual(['a.mp3', 'b.mp3', 'a.mp3'])
    d = applyMusicEdit(d, { kind: 'removeFromPlaylist', id: 'p', positions: [0], at: 3 })
    expect(d.playlists[0].songs).toEqual(['b.mp3', 'a.mp3'])
    d = applyMusicEdit(d, { kind: 'renamePlaylist', id: 'p', name: '', at: 4 })
    expect(d.playlists[0].name).toBe('Gym')
    const before = d
    d = applyMusicEdit(d, { kind: 'deletePlaylist', id: 'p' })
    expect(d.playlists).toEqual([])
    d = applyMusicEdit(d, { kind: 'restorePlaylist', playlist: before.playlists[0], position: 0 })
    expect(d.playlists[0].songs).toEqual(['b.mp3', 'a.mp3'])
  })

  it('leaves the data it was given alone', () => {
    const d = emptyMusicData()
    applyMusicEdit(d, { kind: 'like', paths: ['a'], liked: true, at: 5 })
    expect(d.liked).toEqual({})
  })

  it('keeps when a song was first liked, and unlikes', () => {
    let d = applyMusicEdit(emptyMusicData(), { kind: 'like', paths: ['a'], liked: true, at: 5 })
    d = applyMusicEdit(d, { kind: 'like', paths: ['a', 'b'], liked: true, at: 9 })
    expect(d.liked).toEqual({ a: 5, b: 9 })
    d = applyMusicEdit(d, { kind: 'like', paths: ['a'], liked: false, at: 10 })
    expect(d.liked).toEqual({ b: 9 })
  })

  it('counts plays and keeps a limited history', () => {
    let d = emptyMusicData()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) d = applyMusicEdit(d, { kind: 'played', path: 'a', at: i })
    expect(d.stats.a).toEqual({ plays: HISTORY_LIMIT + 5, lastPlayed: HISTORY_LIMIT + 4 })
    expect(d.history).toHaveLength(HISTORY_LIMIT)
  })

  it('rates 1 to 5 stars, and 0 clears it', () => {
    let d = applyMusicEdit(emptyMusicData(), { kind: 'rate', path: 'a', stars: 4 })
    expect(d.ratings).toEqual({ a: 4 })
    d = applyMusicEdit(d, { kind: 'rate', path: 'a', stars: 0 })
    expect(d.ratings).toEqual({})
  })
})

describe('tags and moved files', () => {
  it('tags songs and lists the tags', () => {
    let d = applyMusicEdit(emptyMusicData(), { kind: 'tag', paths: ['a', 'b'], tag: ' Gym ', on: true })
    d = applyMusicEdit(d, { kind: 'tag', paths: ['a'], tag: 'chill', on: true })
    expect(d.tags).toEqual({ a: ['gym', 'chill'], b: ['gym'] })
    expect(allTags(d)).toEqual([{ tag: 'gym', count: 2 }, { tag: 'chill', count: 1 }])
    d = applyMusicEdit(d, { kind: 'tag', paths: ['b'], tag: 'gym', on: false })
    expect(d.tags).toEqual({ a: ['gym', 'chill'] })
  })

  it('moves everything about a song to its new path, merging two copies', () => {
    let d = emptyMusicData()
    d = applyMusicEdit(d, { kind: 'createPlaylist', id: 'p', name: 'P', songs: ['old.mp3', 'x.mp3'], at: 1 })
    d = applyMusicEdit(d, { kind: 'like', paths: ['old.mp3'], liked: true, at: 3 })
    d = applyMusicEdit(d, { kind: 'like', paths: ['new.mp3'], liked: true, at: 2 })
    d = applyMusicEdit(d, { kind: 'played', path: 'old.mp3', at: 5 })
    d = applyMusicEdit(d, { kind: 'played', path: 'new.mp3', at: 4 })
    d = applyMusicEdit(d, { kind: 'rate', path: 'old.mp3', stars: 2 })
    d = applyMusicEdit(d, { kind: 'tag', paths: ['old.mp3'], tag: 'gym', on: true })
    d = applyMusicEdit(d, { kind: 'renamePaths', map: { 'old.mp3': 'new.mp3' } })
    expect(d.playlists[0].songs).toEqual(['new.mp3', 'x.mp3'])
    expect(d.liked).toEqual({ 'new.mp3': 2 })
    expect(d.stats).toEqual({ 'new.mp3': { plays: 2, lastPlayed: 5 } })
    expect(d.ratings).toEqual({ 'new.mp3': 2 })
    expect(d.tags).toEqual({ 'new.mp3': ['gym'] })
    expect(d.history.map((h) => h.path)).toEqual(['new.mp3', 'new.mp3'])
  })
})

describe('normalizeMusicData', () => {
  it('keeps good parts of a damaged file', () => {
    const d = normalizeMusicData({ playlists: [{ id: 'p', name: 'Ok', songs: ['a', 3] }, { name: 'no id' }], liked: { a: 1, b: 'x' }, ratings: { a: 9, b: 3 }, stats: { a: { plays: 2 } }, history: [{ path: 'a', at: 1 }, 'junk'] })
    expect(d.playlists).toEqual([{ id: 'p', name: 'Ok', songs: ['a'], created: 0, updated: 0 }])
    expect(d.liked).toEqual({ a: 1 })
    expect(d.ratings).toEqual({ b: 3 })
    expect(d.stats).toEqual({ a: { plays: 2 } })
    expect(d.history).toEqual([{ path: 'a', at: 1 }])
    expect(normalizeMusicData('nonsense')).toEqual(emptyMusicData())
  })
})

describe('library views', () => {
  const songs = [
    song('1', { title: 'B', artist: 'The Zeds', album: 'Two', track: 2, art: true }),
    song('2', { title: 'A', artist: 'The Zeds', album: 'Two', track: 1 }),
    song('3', { title: 'C', artist: 'Abba', album: 'One' }),
    song('4', { title: 'D', artist: '', album: '' })
  ]

  it('groups albums in track order, with a cover', () => {
    const albums = albumsOf(songs)
    expect(albums.map((a) => a.name)).toEqual(['One', 'Two'])
    expect(albums[1].songs.map((s) => s.title)).toEqual(['A', 'B'])
    expect(albums[1].art).toBe('1')
  })

  it('lists artists, unknown last', () => {
    expect(artistsOf(songs).map((a) => a.name)).toEqual(['Abba', 'The Zeds', 'Unknown artist'])
  })

  it('sorts by plays, most first', () => {
    const sorted = sortSongsBy(songs, 'plays', true, { '3': { plays: 5 }, '1': { plays: 2 } })
    expect(sorted.map((s) => s.path).slice(0, 2)).toEqual(['3', '1'])
  })

  it('liked songs newest first, and most played', () => {
    const data = { ...emptyMusicData(), liked: { '1': 1, '3': 5, gone: 9 }, stats: { '2': { plays: 1 }, '4': { plays: 3 } } }
    const byPath = songsByPath(songs)
    expect(likedSongs(data, byPath).map((s) => s.path)).toEqual(['3', '1'])
    expect(mostPlayed(songs, data.stats).map((s) => s.path)).toEqual(['4', '2'])
  })

  it('adds up the length', () => {
    expect(totalLength(songs)).toBe('4 min')
    expect(totalLength(Array(75).fill(song('x')))).toBe('1 hr 15 min')
  })
})

describe('Up next', () => {
  it('plays next straight after the song playing', () => {
    expect(queuePlayNext(['a', 'b', 'c'], 0, ['x', 'y'])).toEqual(['a', 'x', 'y', 'b', 'c'])
  })

  it('moves a song and keeps track of the one playing', () => {
    expect(queueMove(['a', 'b', 'c', 'd'], 1, 3, 2)).toEqual({ queue: ['a', 'b', 'd', 'c'], index: 1 })
    expect(queueMove(['a', 'b', 'c', 'd'], 1, 0, 3)).toEqual({ queue: ['b', 'c', 'd', 'a'], index: 0 })
    expect(queueMove(['a', 'b', 'c', 'd'], 2, 3, 0)).toEqual({ queue: ['d', 'a', 'b', 'c'], index: 3 })
  })

  it('removes a song but never the one playing', () => {
    expect(queueRemove(['a', 'b', 'c'], 1, 2)).toEqual({ queue: ['a', 'b'], index: 1 })
    expect(queueRemove(['a', 'b', 'c'], 1, 0)).toEqual({ queue: ['b', 'c'], index: 0 })
    expect(queueRemove(['a', 'b', 'c'], 1, 1)).toEqual({ queue: ['a', 'b', 'c'], index: 1 })
  })
})
