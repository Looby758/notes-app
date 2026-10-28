/**
 * The music player: Spotify, controlled two ways.
 *
 * - On a Mac, the Spotify app itself (through AppleScript, which macOS lets apps use to control each
 *   other). Nothing to set up and no Premium needed: play/pause, skip, what's playing, and playing a
 *   Spotify link. macOS asks once whether Notes may control Spotify.
 * - Your Spotify account (Spotify's Web API), which adds searching and your playlists, and controls
 *   Spotify on any device (phone, speaker, Windows). Spotify only lets personal apps use it with
 *   Premium, and you make your own free Spotify developer app for it, like the Google sign-in.
 *
 * This file is the part both sides share: the shapes the UI sees, and turning what Spotify says into them.
 */

export interface MusicTrack {
  name: string
  artist: string
  album: string
  /** Album picture (https). */
  art?: string
  /** e.g. spotify:track:… */
  uri?: string
  durationMs: number
}

/** Why nothing's playing, so the player can say what to do about it. */
export type MusicHint =
  /** (Mac) The Spotify app isn't open. */
  | 'not-running'
  /** (Mac) macOS hasn't let Notes control Spotify. */
  | 'automation'
  /** Your account is connected but Spotify isn't open anywhere. */
  | 'no-device'
  /** (Windows) Nothing to control until your account is connected. */
  | 'setup'

export interface MusicState {
  /** What's being controlled: the Spotify app on this Mac, or your account (any device). */
  source: 'app' | 'account' | 'none'
  playing: boolean
  track?: MusicTrack
  positionMs: number
  shuffle?: boolean
  /** 0–100. */
  volume?: number
  /** Where it's playing, for your account ("Kitchen speaker"). */
  device?: string
  hint?: MusicHint
  error?: string
}

export interface MusicStatus {
  /** The Spotify app can be controlled directly (Macs). */
  appControl: boolean
  clientId: string
  connected: boolean
  /** Your Spotify display name. */
  name?: string
  error?: string
  /** Paste this into your Spotify developer app. */
  redirectUri: string
  canEncrypt: boolean
}

export type MusicAction = 'toggle' | 'next' | 'previous' | 'shuffle'

/** A search result or playlist you can play. */
export interface MusicItem {
  kind: 'track' | 'playlist' | 'album'
  name: string
  /** Artist, owner, or number of songs. */
  detail: string
  art?: string
  uri: string
}

export interface MusicSearchResults {
  tracks: MusicItem[]
  playlists: MusicItem[]
  albums: MusicItem[]
}

/** The separator the AppleScript puts between fields (a character no song title has). */
export const APP_FIELD_SEP = '\u001f'

/**
 * A Spotify link or code as a Spotify URI: "https://open.spotify.com/playlist/37i9…?si=…",
 * "open.spotify.com/intl-en/track/…", or "spotify:album:…". Null if it isn't one.
 */
export function spotifyUri(text: string): string | null {
  const t = text.trim()
  const uri = /^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{10,})$/.exec(t)
  if (uri) return `spotify:${uri[1]}:${uri[2]}`
  const link = /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{10,})/i.exec(t)
  return link ? `spotify:${link[1].toLowerCase()}:${link[2]}` : null
}

/** What kind of thing a URI plays. */
export const uriKind = (uri: string): string => uri.split(':')[1] ?? ''

/**
 * What the Mac's Spotify app reported (see APP_STATE_SCRIPT in the main process): "stopped", or
 * state, name, artist, album, artwork, uri, duration (ms), position (ms), shuffling, volume.
 */
export function parseAppState(output: string): MusicState {
  const fields = output.replace(/\r?\n$/, '').split(APP_FIELD_SEP)
  if (fields.length < 10) return { source: 'app', playing: false, positionMs: 0 }
  const [state, name, artist, album, art, uri, duration, position, shuffle, volume] = fields
  const num = (s: string): number => {
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return {
    source: 'app',
    playing: state === 'playing',
    track: {
      name: name || 'Unknown song',
      artist,
      album,
      art: /^https:\/\//.test(art) ? art : undefined,
      uri: uri || undefined,
      durationMs: Math.round(num(duration))
    },
    positionMs: Math.round(num(position)),
    shuffle: shuffle === 'true',
    volume: Math.round(num(volume))
  }
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The middle-sized picture (Spotify lists them biggest first). */
function picture(images: unknown): string | undefined {
  const list = arr(images).map(obj)
  const pick = list.find((i) => Number(i.width) > 0 && Number(i.width) <= 320) ?? list[0]
  const url = pick ? str(pick.url) : ''
  return url.startsWith('https://') ? url : undefined
}

const names = (artists: unknown): string =>
  arr(artists)
    .map((a) => str(obj(a).name))
    .filter(Boolean)
    .join(', ')

/** GET /me/player from your account (an empty answer means nothing is playing anywhere). */
export function parseAccountState(body: unknown): MusicState {
  const p = obj(body)
  const item = obj(p.item)
  const device = obj(p.device)
  if (!p.item && !p.device) return { source: 'account', playing: false, positionMs: 0, hint: 'no-device' }
  const isEpisode = p.currently_playing_type === 'episode' || item.type === 'episode'
  const album = obj(item.album)
  return {
    source: 'account',
    playing: p.is_playing === true,
    track: p.item
      ? {
          name: str(item.name) || 'Unknown song',
          artist: isEpisode ? str(obj(item.show).name) : names(item.artists),
          album: isEpisode ? '' : str(album.name),
          art: picture(isEpisode ? item.images ?? obj(item.show).images : album.images),
          uri: str(item.uri) || undefined,
          durationMs: Number(item.duration_ms) || 0
        }
      : undefined,
    positionMs: Number(p.progress_ms) || 0,
    shuffle: p.shuffle_state === true,
    volume: typeof device.volume_percent === 'number' ? device.volume_percent : undefined,
    device: str(device.name) || undefined
  }
}

function trackItem(t: Json): MusicItem {
  return { kind: 'track', name: str(t.name), detail: names(t.artists), art: picture(obj(t.album).images), uri: str(t.uri) }
}

function playlistItem(p: Json): MusicItem {
  const count = Number(obj(p.items).total ?? obj(p.tracks).total)
  const owner = str(obj(p.owner).display_name)
  const songs = Number.isFinite(count) ? `${count} ${count === 1 ? 'song' : 'songs'}` : ''
  return { kind: 'playlist', name: str(p.name), detail: [owner, songs].filter(Boolean).join(' · '), art: picture(p.images), uri: str(p.uri) }
}

function albumItem(a: Json): MusicItem {
  return { kind: 'album', name: str(a.name), detail: names(a.artists), art: picture(a.images), uri: str(a.uri) }
}

// Spotify sometimes puts null in place of a result it can't show, so those are skipped.
const usable = (list: unknown): Json[] => arr(list).filter((x) => x && typeof x === 'object' && str((x as Json).uri)) as Json[]

/** GET /search?type=track,playlist,album */
export function parseSearch(body: unknown): MusicSearchResults {
  const b = obj(body)
  return {
    tracks: usable(obj(b.tracks).items).map(trackItem),
    playlists: usable(obj(b.playlists).items).map(playlistItem),
    albums: usable(obj(b.albums).items).map(albumItem)
  }
}

/** GET /me/playlists */
export const parsePlaylists = (body: unknown): MusicItem[] => usable(obj(body).items).map(playlistItem)

/** The body for PUT /me/player/play: a song on its own or within a playlist/album, or a whole playlist/album. */
export function playBody(uri: string, context?: string): Json {
  if (uriKind(uri) === 'track' || uriKind(uri) === 'episode') return context ? { context_uri: context, offset: { uri } } : { uris: [uri] }
  return { context_uri: uri }
}

/** 3:07 */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
