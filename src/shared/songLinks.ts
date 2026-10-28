import { spotifyUri, uriKind } from './spotify'
import { localArtUrl } from './localMusic'

/**
 * Songs shared into notes: a line that's only a song's link shows as a card you click to play it.
 * Spotify songs, albums and playlists use their open.spotify.com link (so they still work anywhere
 * else); your own music files use mymusic:<path in your music folder>.
 *
 *   [🎵 Midnight City · M83](https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt "https://i.scdn.co/image/…")
 *   [🎵 Dreams · Fleetwood Mac](mymusic:Rumours/02%20Dreams.mp3)
 *
 * The optional "…" after the link is the album picture.
 */

export const LOCAL_SONG_SCHEME = 'mymusic:'

export type SongTarget = { kind: 'spotify'; uri: string } | { kind: 'local'; path: string }

export interface SongCard {
  name: string
  artist: string
  href: string
  art?: string
  target: SongTarget
}

/** What a link plays, if it's a song link. */
export function songTarget(href: string): SongTarget | null {
  if (href.startsWith(LOCAL_SONG_SCHEME)) {
    try {
      const path = decodeURI(href.slice(LOCAL_SONG_SCHEME.length))
      return path && !path.startsWith('/') && !path.split('/').includes('..') ? { kind: 'local', path } : null
    } catch {
      return null
    }
  }
  const uri = spotifyUri(href)
  return uri ? { kind: 'spotify', uri } : null
}

const SPOTIFY_KINDS: Record<string, string> = { track: 'Song', album: 'Album', playlist: 'Playlist', artist: 'Artist', episode: 'Episode', show: 'Podcast' }

/** The markdown for sharing what's playing (`uri` is spotify:… or local:<path>); null if it can't be shared. */
export function songMarkdown(name: string, artist: string, uri: string, art?: string): string | null {
  const clean = (s: string): string => s.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  const text = `🎵 ${[clean(name), clean(artist)].filter(Boolean).join(' · ')}`
  if (uri.startsWith('local:')) return `[${text}](${LOCAL_SONG_SCHEME}${encodeURI(uri.slice('local:'.length)).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
  const m = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/.exec(uri)
  if (!m) return null
  const title = art && /^https:\/\/[^\s"]+$/.test(art) ? ` "${art}"` : ''
  return `[${text}](https://open.spotify.com/${m[1]}/${m[2]}${title})`
}

// [text](href "title") on a line of its own, or just the link.
const LINE = /^\s*(?:[-*+]\s+)?\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$/
const BARE = /^\s*<?((?:https?:\/\/open\.spotify\.com|spotify:|mymusic:)\S+?)>?\s*$/i

/** A line that's only a song link, as a card; null otherwise. */
export function parseSongLine(line: string): SongCard | null {
  if (!/spotify|mymusic:/i.test(line)) return null
  const m = LINE.exec(line)
  const href = m ? m[2] : BARE.exec(line)?.[1]
  if (!href) return null
  const target = songTarget(href)
  if (!target) return null
  const text = (m?.[1] ?? '').replace(/^\s*🎵\s*/u, '').trim()
  const [name, ...rest] = text.split(' · ')
  const title = m?.[3]?.trim()
  const art = target.kind === 'local' ? localArtUrl(target.path) : title && /^https:\/\//.test(title) ? title : undefined
  const fallback = target.kind === 'local' ? (target.path.split('/').pop() ?? target.path).replace(/\.[^.]+$/, '') : `Spotify ${SPOTIFY_KINDS[uriKind(target.uri)]?.toLowerCase() ?? 'link'}`
  return { name: name || fallback, artist: rest.join(' · '), href, art, target }
}
