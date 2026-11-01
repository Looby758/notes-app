/**
 * "What's this song?": Orbit listens to what's playing on the computer (a video, a game, a stream)
 * for a few seconds and asks AudD (audd.io, a song-recognition service) what it is. The answer
 * comes with the song's Spotify link when Spotify has it, so it can go straight into a playlist.
 */

/** A song Orbit recognised. */
export interface FoundSong {
  title: string
  artist: string
  album?: string
  /** "2019-05-03" (or just a year). */
  released?: string
  /** Album picture. */
  art?: string
  /** spotify:track:… when Spotify has it. */
  spotifyUri?: string
  /** A page about the song (AudD's lis.tn link, which has links to every music app). */
  link?: string
  /** Where in the song the clip was, e.g. "01:23". */
  timecode?: string
  /** When it was found (ms since 1970). */
  at: number
}

export interface SongIdStatus {
  /** Your AudD key is saved (without one AudD only allows a few songs a day). */
  hasKey: boolean
  canEncrypt: boolean
  /** The system-wide shortcut, as shown to you ('' when off or it couldn't be set). */
  shortcut: string
  shortcutError?: string
}

/** How long to listen. AudD needs about 5 seconds; 10 copes with talking over the music. */
export const LISTEN_SECONDS = 10
/** The clip is sent as mono WAV at this rate: plenty for recognition, small to upload (~440 KB). */
export const CLIP_RATE = 22050
/** How many found songs are kept (newest first). */
export const HISTORY_MAX = 30

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** AudD's error codes that mean something to you, in plain words. */
function auddError(code: number, message: string | undefined): string {
  if (code === 900 || code === 901) return 'AudD needs a key for more songs today. Add your free AudD key in Settings → Music → What’s this song?'
  if (code === 902) return 'Your AudD key has run out of songs this month. Check your plan at dashboard.audd.io.'
  if (code === 300 || code === 400 || code === 500) return 'AudD couldn’t read the sound clip. Try again.'
  return message ? `AudD: ${message}` : 'AudD couldn’t recognise songs right now. Try again in a bit.'
}

/**
 * Reads AudD's answer: the song, null when nothing matched (no music, or a song it doesn't know),
 * or throws with a readable reason.
 */
export function parseAudd(body: unknown, at: number = Date.now()): FoundSong | null {
  const b = obj(body)
  if (b.status === 'error') {
    const e = obj(b.error)
    throw new Error(auddError(Number(e.error_code), str(e.error_message)))
  }
  if (b.status !== 'success') throw new Error('AudD sent back something Orbit didn’t understand. Try again.')
  const r = obj(b.result)
  const title = str(r.title)
  if (!title) return null
  const spotify = obj(r.spotify)
  const id = str(spotify.id)
  const uri = str(spotify.uri) ?? (id ? `spotify:track:${id}` : undefined)
  const images = Array.isArray(obj(spotify.album).images) ? (obj(spotify.album).images as unknown[]) : []
  const apple = obj(obj(r.apple_music).artwork)
  const appleArt = str(apple.url)?.replace('{w}', '300').replace('{h}', '300')
  return {
    title,
    artist: str(r.artist) ?? 'Unknown artist',
    album: str(r.album),
    released: str(r.release_date),
    art: str(obj(images[0]).url) ?? appleArt,
    spotifyUri: uri && /^spotify:track:[A-Za-z0-9]+$/.test(uri) ? uri : undefined,
    link: str(r.song_link),
    timecode: str(r.timecode),
    at
  }
}

/** A Spotify search for the song, when AudD didn't know its Spotify link. */
export function spotifyQuery(song: Pick<FoundSong, 'title' | 'artist'>): string {
  const clean = (s: string): string => s.replace(/"/g, '').trim()
  // "(feat. …)" and "- Remastered 2011" make Spotify's search stricter than it needs to be.
  const title = clean(song.title.replace(/\s*[([].*?(feat|ft\.|with|remaster).*?[)\]]/gi, '').replace(/\s+-\s+.*remaster.*$/i, ''))
  const artist = clean(song.artist.split(/\s*(?:,|&|feat\.?|ft\.?|\bx\b)\s*/i)[0] ?? song.artist)
  return artist ? `track:"${title}" artist:"${artist}"` : `track:"${title}"`
}

/** Puts a newly found song at the top of the list (the same song found again moves up, not in twice). */
export function addToHistory(history: FoundSong[], song: FoundSong): FoundSong[] {
  const key = (s: FoundSong): string => s.spotifyUri ?? `${s.title}\u0000${s.artist}`.toLowerCase()
  return [song, ...history.filter((s) => key(s) !== key(song))].slice(0, HISTORY_MAX)
}

/** Reads a saved history, dropping anything broken. */
export function cleanHistory(v: unknown): FoundSong[] {
  if (!Array.isArray(v)) return []
  return v
    .map(obj)
    .filter((s) => str(s.title) && typeof s.at === 'number')
    .map((s) => ({
      title: str(s.title)!,
      artist: str(s.artist) ?? 'Unknown artist',
      album: str(s.album),
      released: str(s.released),
      art: str(s.art)?.startsWith('https://') ? str(s.art) : undefined,
      spotifyUri: /^spotify:track:[A-Za-z0-9]+$/.test(String(s.spotifyUri)) ? String(s.spotifyUri) : undefined,
      link: str(s.link)?.startsWith('https://') ? str(s.link) : undefined,
      timecode: str(s.timecode),
      at: s.at as number
    }))
    .slice(0, HISTORY_MAX)
}

/** Mono 16-bit PCM WAV (the one format every recogniser takes). */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Loudest sample: a clip that's (almost) silent isn't worth sending. */
export function peak(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > p) p = a
  }
  return p
}

/** Below this the clip is treated as silence. */
export const SILENCE = 0.005

/** "Wet Leg · Chaise Longue" style one-liner for notifications. */
export const songLine = (s: Pick<FoundSong, 'title' | 'artist'>): string => `${s.title} · ${s.artist}`

/** A Spotify track link as an open.spotify.com page. */
export function spotifyPage(uri: string): string | undefined {
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri)
  return m ? `https://open.spotify.com/track/${m[1]}` : undefined
}
