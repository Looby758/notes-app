import { describe, expect, it } from 'vitest'
import type { LocalSong } from './localMusic'
import { cleanTitle, findInLibrary, parseSongList, parseSpotifyEmbed, parseSpotifyLink, titleIndex } from './spotifyImport'

const song = (title: string, artist: string): LocalSong => ({ path: `${artist} - ${title}.mp3`, title, artist, album: '', track: 0, durationMs: 0, art: false })

describe('Spotify lists', () => {
  it('reads playlist and album links', () => {
    expect(parseSpotifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({ kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' })
    expect(parseSpotifyLink('https://open.spotify.com/intl-de/album/4OHNH3sDzIxnmUADXzv2kT')).toEqual({ kind: 'album', id: '4OHNH3sDzIxnmUADXzv2kT' })
    expect(parseSpotifyLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')?.kind).toBe('playlist')
    expect(parseSpotifyLink('https://open.spotify.com/track/abc')).toBeNull()
  })

  it('reads the embed page', () => {
    const data = { props: { pageProps: { state: { data: { entity: { name: 'Mix', coverArt: { sources: [{ url: 'https://i.scdn.co/x' }] }, trackList: [{ title: 'DÁKITI', subtitle: 'Bad Bunny, Jhayco', duration: 205000 }] } } } } } }
    const list = parseSpotifyEmbed(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`)
    expect(list).toEqual({ name: 'Mix', art: 'https://i.scdn.co/x', tracks: [{ title: 'DÁKITI', artists: ['Bad Bunny', 'Jhayco'], durationMs: 205000 }], capped: false })
    expect(parseSpotifyEmbed('<html></html>')).toBeNull()
  })

  it('reads an Exportify CSV and plain lines', () => {
    const csv = '"Track URI","Track Name","Artist Name(s)","Album Name","Track Duration (ms)"\n"spotify:track:1","Mr. Brightside","The Killers","Hot Fuss","222973"\n"spotify:track:2","Hello, World","A, B","X","1000"'
    expect(parseSongList(csv).tracks).toEqual([
      { title: 'Mr. Brightside', artists: ['The Killers'], durationMs: 222973 },
      { title: 'Hello, World', artists: ['A', 'B'], durationMs: 1000 }
    ])
    expect(parseSongList('1. Seether - Broken\nNovember Rain').tracks).toEqual([
      { title: 'Broken', artists: ['Seether'], durationMs: 0 },
      { title: 'November Rain', artists: [], durationMs: 0 }
    ])
  })

  it('finds your copy', () => {
    const songs = [song('DÁKITI', 'Bad Bunny & Jhayco'), song('Broken', 'Seether'), song('Mr. Brightside', 'Sydney Rose')]
    const index = titleIndex(songs)
    expect(findInLibrary({ title: 'DÁKITI', artists: ['Bad Bunny', 'Jhayco'], durationMs: 0 }, songs, index)?.artist).toBe('Bad Bunny & Jhayco')
    expect(findInLibrary({ title: 'Broken (feat. Amy Lee)', artists: ['Seether', 'Amy Lee'], durationMs: 0 }, songs, index)?.title).toBe('Broken')
    expect(findInLibrary({ title: 'Mr. Brightside', artists: ['The Killers'], durationMs: 0 }, songs, index)).toBeNull()
    expect(cleanTitle('Let It Be - Remastered 2009')).toBe('Let It Be')
  })
})
