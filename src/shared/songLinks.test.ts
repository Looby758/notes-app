import { describe, expect, it } from 'vitest'
import { parseSongLine, songMarkdown, songTarget } from './songLinks'

describe('song links in notes', () => {
  it('writes and reads back a Spotify song', () => {
    const md = songMarkdown('Midnight City', 'M83', 'spotify:track:1eyzqe2QqGZUmfcPZtrIyt', 'https://i.scdn.co/image/abc')!
    expect(md).toBe('[🎵 Midnight City · M83](https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt "https://i.scdn.co/image/abc")')
    expect(parseSongLine(md)).toEqual({
      name: 'Midnight City',
      artist: 'M83',
      href: 'https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt',
      art: 'https://i.scdn.co/image/abc',
      target: { kind: 'spotify', uri: 'spotify:track:1eyzqe2QqGZUmfcPZtrIyt' }
    })
  })
  it('writes and reads back one of your own files, odd names and all', () => {
    const md = songMarkdown('Song [live]', 'Band (UK)', 'local:Live (2020)/01 Song.mp3')!
    expect(md).toBe('[🎵 Song live · Band (UK)](mymusic:Live%20%282020%29/01%20Song.mp3)')
    const card = parseSongLine(md)!
    expect(card.target).toEqual({ kind: 'local', path: 'Live (2020)/01 Song.mp3' })
    expect(card.art).toBe('vault://musicart/Live%20(2020)/01%20Song.mp3')
  })
  it('makes cards from bare Spotify links too, but not from links in a sentence', () => {
    expect(parseSongLine('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x')?.name).toBe('Spotify playlist')
    expect(parseSongLine('Listen to https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt today')).toBeNull()
    expect(parseSongLine('[Docs](https://example.com)')).toBeNull()
  })
  it('won’t reach outside the music folder', () => {
    expect(songTarget('mymusic:../secret.mp3')).toBeNull()
    expect(songTarget('mymusic:/etc/passwd')).toBeNull()
  })
})
