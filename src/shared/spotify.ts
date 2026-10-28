/**
 * The music player: Spotify, controlled two ways.
 *
 * - On a Mac, the Spotify app itself (through AppleScript, which macOS lets apps use to control each
 *   other). Nothing to set up and no Premium needed: play/pause, skip, what's playing, and playing a
 *   Spotify link. macOS asks once whether Notes may control Spotify.
 * - Your Spotify account (Spotify's Web API), which adds searching and your playlists, and controls
 *   Spotify on any device (phone, speaker, Windows). Spotify only lets personal apps use it with
 *   Premium, and you make your own free Spotify developer app for it, like the Google sign-in. Liking
 *   songs, the queue, recently played and choosing where it plays need it too.
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
  /** What's being controlled: the Spotify app on this Mac, your account (any device), or your own music files. */
  source: 'app' | 'account' | 'local' | 'none'
  playing: boolean
  track?: MusicTrack
  positionMs: number
  shuffle?: boolean
  repeat?: MusicRepeat
  /** 0–100. */
  volume?: number
  /** Where it's playing, for your account ("Kitchen speaker"). */
  device?: string
  hint?: MusicHint
  error?: string
}

/** Off, the whole playlist/album, or just this song (the Mac app only has off and on). */
export type MusicRepeat = 'off' | 'context' | 'track'

export interface MusicStatus {
  /** The Spotify app can be controlled directly (Macs). */
  appControl: boolean
  clientId: string
  connected: boolean
  /** Your Spotify display name. */
  name?: string
  /** Connected before Notes asked for liking songs and recently played: connect again for those. */
  needsReconnect?: boolean
  error?: string
  /** Paste this into your Spotify developer app. */
  redirectUri: string
  canEncrypt: boolean
}

/** `pause` only ever pauses (for the sleep timer), unlike `toggle`. */
export type MusicAction = 'toggle' | 'pause' | 'next' | 'previous' | 'shuffle' | 'repeat'

/** Somewhere your account can play: this computer, your phone, a speaker. */
export interface MusicDevice {
  id: string
  name: string
  /** Computer, Smartphone, Speaker, TV… */
  type: string
  active: boolean
  volume?: number
}

/** What's playing and what plays after it. */
export interface MusicQueue {
  current?: MusicItem
  next: MusicItem[]
}

/** A search result or playlist you can play. */
export interface MusicItem {
  kind: 'track' | 'playlist' | 'album'
  name: string
  /** Artist, owner, or number of songs. */
  detail: string
  art?: string
  uri: string
  /** Playlists: you own it (or it's shared with you to edit), so its songs can be listed and changed. */
  editable?: boolean
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
 * state, name, artist, album, artwork, uri, duration (ms), position (ms), shuffling, volume, repeating.
 */
export function parseAppState(output: string): MusicState {
  const fields = output.replace(/\r?\n$/, '').split(APP_FIELD_SEP)
  if (fields.length < 10) return { source: 'app', playing: false, positionMs: 0 }
  const [state, name, artist, album, art, uri, duration, position, shuffle, volume, repeating] = fields
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
    repeat: repeating === 'true' ? 'context' : 'off',
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
    repeat: p.repeat_state === 'track' || p.repeat_state === 'context' ? (p.repeat_state as MusicRepeat) : 'off',
    volume: typeof device.volume_percent === 'number' ? device.volume_percent : undefined,
    device: str(device.name) || undefined
  }
}

function trackItem(t: Json): MusicItem {
  // Podcast episodes can turn up in the queue and recently played.
  if (t.type === 'episode') return { kind: 'track', name: str(t.name), detail: str(obj(t.show).name), art: picture(t.images ?? obj(t.show).images), uri: str(t.uri) }
  return { kind: 'track', name: str(t.name), detail: names(t.artists), art: picture(obj(t.album).images), uri: str(t.uri) }
}

function playlistItem(p: Json, me?: string): MusicItem {
  const count = Number(obj(p.items).total ?? obj(p.tracks).total)
  const owner = str(obj(p.owner).display_name)
  const songs = Number.isFinite(count) ? `${count} ${count === 1 ? 'song' : 'songs'}` : ''
  const item: MusicItem = { kind: 'playlist', name: str(p.name), detail: [owner, songs].filter(Boolean).join(' · '), art: picture(p.images), uri: str(p.uri) }
  if (me && (str(obj(p.owner).id) === me || p.collaborative === true)) item.editable = true
  return item
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
    playlists: usable(obj(b.playlists).items).map((p) => playlistItem(p)),
    albums: usable(obj(b.albums).items).map(albumItem)
  }
}

/** GET /me/playlists; `me` (your Spotify user id) marks the ones you can edit. */
export const parsePlaylists = (body: unknown, me?: string): MusicItem[] => usable(obj(body).items).map((p) => playlistItem(p, me))

/** A playlist made or renamed in Notes (POST /me/playlists answers with the playlist). */
export const parsePlaylist = (body: unknown, me?: string): MusicItem => playlistItem(obj(body), me)

/** GET /playlists/{id}/items: its songs in order (Spotify now calls each one `item`; it used to be `track`). Local files are left out. */
export function parsePlaylistSongs(body: unknown): MusicItem[] {
  return usable(arr(obj(body).items).map((e) => obj(e).item ?? obj(e).track))
    .filter((t) => !str(t.uri).startsWith('spotify:local:'))
    .map(trackItem)
}

/** The id in spotify:playlist:<id>, or null. */
export function playlistId(uri: string): string | null {
  const m = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(uri)
  return m ? m[1] : null
}

/** The body for PUT /playlists/{id}/items that moves the song at `from` so it ends up at `to`. */
export function moveBody(from: number, to: number): Json {
  return { range_start: from, insert_before: to > from ? to + 1 : to }
}

/** GET /me/player/queue */
export function parseQueue(body: unknown): MusicQueue {
  const b = obj(body)
  const current = usable([b.currently_playing])
  return { current: current.length ? trackItem(current[0]) : undefined, next: usable(b.queue).map(trackItem) }
}

/** GET /me/player/recently-played: newest first, each song once. */
export function parseRecent(body: unknown): MusicItem[] {
  const seen = new Set<string>()
  const items: MusicItem[] = []
  for (const t of usable(arr(obj(body).items).map((i) => obj(i).track))) {
    if (seen.has(str(t.uri))) continue
    seen.add(str(t.uri))
    items.push(trackItem(t))
  }
  return items
}

/** GET /me/player/devices, leaving out ones Spotify won't let anything control. */
export function parseDevices(body: unknown): MusicDevice[] {
  return arr(obj(body).devices)
    .map(obj)
    .filter((d) => str(d.id) && d.is_restricted !== true)
    .map((d) => ({
      id: str(d.id),
      name: str(d.name) || 'Unknown device',
      type: str(d.type),
      active: d.is_active === true,
      volume: typeof d.volume_percent === 'number' ? d.volume_percent : undefined
    }))
}

/** What the repeat button goes to next: off → whole playlist → this song → off. */
export function nextRepeat(now: MusicRepeat | undefined): MusicRepeat {
  return now === 'context' ? 'track' : now === 'track' ? 'off' : 'context'
}

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
