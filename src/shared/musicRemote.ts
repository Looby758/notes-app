/**
 * The phone remote for your music: a page on the computer's Wi-Fi address that a phone's browser
 * (or the Orbit Music phone app, which opens it) uses to play, pause, skip, seek, change the volume
 * and pick from Up next. The server is in src/main/musicRemote.ts; these are the pure parts.
 *
 * So the phone app can find the remote, Orbit writes a small file into your music folder,
 * "orbit-remote-<computer>.json", which reaches the phone through Google Drive like orbit-music.json.
 */

import type { MusicAction, MusicState } from './spotify'
import type { MusicMiniCommand, MusicMiniState } from './types'

export interface RemoteSong {
  title: string
  artist: string
  art: string
}

/** What the phone is told (and told again whenever it changes). */
export interface RemoteState {
  type: 'state'
  source: MusicState['source'] | 'none'
  playing: boolean
  title: string
  artist: string
  album: string
  art: string
  /** Where the song is as this is sent; the phone moves the bar on from when it arrives. */
  positionMs: number
  durationMs: number
  volume: number | null
  shuffle: boolean
  repeat: string
  upNext: RemoteSong[]
}

const MUSIC_PREFIX = 'vault://musicart/'

/** A cover the phone can load: Orbit's own covers go through the remote's address, web ones stay as they are. */
export function remoteArt(art: string | undefined, base: string): string {
  if (!art) return ''
  if (art.startsWith('https://')) return art
  if (art.startsWith(MUSIC_PREFIX)) return `${base}/art/${art.slice(MUSIC_PREFIX.length)}`
  return ''
}

/** The song's path in the music folder, from a remote cover address's end ("Albums/Song.mp3"). */
export function artPathFrom(rest: string): string | null {
  const withoutQuery = rest.split('?')[0]
  try {
    const path = decodeURIComponent(withoutQuery)
    return path && !path.includes('\0') ? path : null
  } catch {
    return null
  }
}

export function remoteState(mini: MusicMiniState | null, base: string, now = Date.now()): RemoteState {
  const s = mini?.state
  const t = s?.track
  const duration = t?.durationMs ?? 0
  const moved = s?.playing && mini ? Math.max(0, now - mini.at) : 0
  const position = Math.max(0, (s?.positionMs ?? 0) + moved)
  return {
    type: 'state',
    source: s?.source ?? 'none',
    playing: !!s?.playing,
    title: t?.name ?? '',
    artist: t?.artist ?? '',
    album: t?.album ?? '',
    art: remoteArt(t?.art, base),
    positionMs: duration ? Math.min(duration, position) : position,
    durationMs: duration,
    volume: typeof s?.volume === 'number' ? s.volume : null,
    shuffle: !!s?.shuffle,
    repeat: s?.repeat ?? 'off',
    upNext: (mini?.upNext ?? []).map((u) => ({ title: u.title, artist: u.artist, art: remoteArt(u.art, base) }))
  }
}

const ACTIONS: MusicAction[] = ['toggle', 'next', 'previous', 'shuffle', 'repeat']

/** A button press from the phone, checked; null if it isn't one. */
export function cleanRemoteCommand(raw: unknown): MusicMiniCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.action === 'string' && (ACTIONS as string[]).includes(r.action)) return { action: r.action as MusicAction }
  if (typeof r.seek === 'number' && Number.isFinite(r.seek) && r.seek >= 0) return { seek: Math.round(r.seek) }
  if (typeof r.jump === 'number' && Number.isInteger(r.jump) && r.jump >= 0 && r.jump < 500) return { jump: r.jump }
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) return { volume: Math.round(Math.min(100, Math.max(0, r.volume))) }
  return null
}

// ---------- The file the phone app finds it by ----------

export const REMOTE_FILE_PREFIX = 'orbit-remote-'

/** "orbit-remote-Loobys-PC.json": one per computer, so two computers never write the same file. */
export function remoteFileName(computer: string): string {
  const safe = computer.normalize('NFKD').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'computer'
  return `${REMOTE_FILE_PREFIX}${safe}.json`
}

export const isRemoteFileName = (name: string): boolean => name.startsWith(REMOTE_FILE_PREFIX) && name.endsWith('.json')

export interface RemoteFile {
  /** The computer's name, as the phone app shows it. */
  name: string
  /** The remote page's address on the Wi-Fi. */
  url: string
  /** When Orbit last wrote it (it's written again each time Orbit opens). */
  updated: number
}

export function parseRemoteFile(raw: unknown): RemoteFile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || typeof r.url !== 'string' || typeof r.updated !== 'number') return null
  if (!/^http:\/\/(\d{1,3}\.){3}\d{1,3}:\d{2,5}\/s\/[A-Za-z0-9_-]{22}\/?$/.test(r.url)) return null
  return { name: r.name.slice(0, 80), url: r.url, updated: r.updated }
}
