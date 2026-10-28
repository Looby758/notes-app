import { app, net, safeStorage, shell } from 'electron'
import { execFile } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { IS_MAC } from '@shared/platform'
import {
  APP_FIELD_SEP,
  parseAccountState,
  moveBody,
  nextRepeat,
  parseAppState,
  parseDevices,
  parsePlaylist,
  parsePlaylists,
  parsePlaylistSongs,
  parseQueue,
  parseRecent,
  parseSearch,
  playBody,
  playlistId,
  type MusicAction,
  type MusicDevice,
  type MusicItem,
  type MusicQueue,
  type MusicSearchResults,
  type MusicState,
  type MusicStatus
} from '@shared/spotify'

/**
 * Spotify for the music player (see shared/spotify.ts for the two ways it's controlled).
 *
 * Your account: you make a free developer app on Spotify's site and paste its client ID. Signing in
 * is the standard desktop flow (PKCE, so there's no secret): your browser opens Spotify's page, you
 * agree, and Spotify sends a one-time code to a fixed address on this computer, which you register in
 * the developer app. The sign-in is stored encrypted (safeStorage), in spotify.json in the settings folder.
 */

const PORT = 43117
export const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
const SCOPE = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  // For making and editing playlists (asked for now so you only connect again once).
  'playlist-modify-private',
  'playlist-modify-public'
].join(' ')
// Overridable for tests, which point these at a local fake Spotify.
const AUTH_URL = process.env.NOTES_SPOTIFY_AUTH_URL ?? 'https://accounts.spotify.com/authorize'
const TOKEN_URL = process.env.NOTES_SPOTIFY_TOKEN_URL ?? 'https://accounts.spotify.com/api/token'
const API_URL = process.env.NOTES_SPOTIFY_API_URL ?? 'https://api.spotify.com/v1'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

interface Stored {
  clientId: string
  /** Encrypted. */
  refreshToken?: string
  name?: string
  /** Your Spotify user id, to tell which playlists are yours. */
  userId?: string
  /** What Spotify let Notes do (space-separated), to spot sign-ins from before Notes asked for more. */
  scope?: string
}

let stored: Stored | null = null
let accessToken: { token: string; expires: number } | null = null
let accountError: string | undefined

const file = (): string => join(app.getPath('userData'), 'spotify.json')

function load(): Stored {
  if (stored) return stored
  try {
    stored = { clientId: '', ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    stored = { clientId: '' }
  }
  return stored!
}

function save(): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8')
  renameSync(tmp, file())
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
const decrypt = (text: string): string => safeStorage.decryptString(Buffer.from(text, 'base64'))

export function status(): MusicStatus {
  const s = load()
  return {
    appControl: IS_MAC,
    clientId: s.clientId,
    connected: !!s.refreshToken,
    name: s.name,
    needsReconnect: !!s.refreshToken && s.scope !== undefined && SCOPE.split(' ').some((x) => !s.scope!.split(' ').includes(x)),
    error: accountError,
    redirectUri: REDIRECT_URI,
    canEncrypt: safeStorage.isEncryptionAvailable()
  }
}

export function setClient(clientId: string): MusicStatus {
  const s = load()
  const id = clientId.trim()
  if (id && !/^[0-9a-f]{32}$/i.test(id)) throw new Error('That doesn’t look like a Spotify client ID (it’s 32 letters and numbers, from your app’s Settings page).')
  if (id !== s.clientId) {
    s.refreshToken = undefined
    s.name = undefined
    s.scope = undefined
    accessToken = null
    accountError = undefined
  }
  s.clientId = id
  save()
  return status()
}

// ---------- The Spotify app on a Mac ----------

function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        // -1743: you said no (or haven't been asked yet) in Privacy & Security → Automation.
        const e = new Error(/-1743|not authori[sz]ed/i.test(stderr) ? 'automation' : stderr.trim() || err.message)
        reject(e)
      } else resolve(stdout)
    })
  })
}

/** Checked first and on its own: a script that talks to Spotify would open it (or fail if it isn't installed). */
const appRunning = async (): Promise<boolean> =>
  IS_MAC && (await osascript('application id "com.spotify.client" is running').then((out) => out.trim() === 'true', () => false))

const APP_STATE_SCRIPT = `tell application id "com.spotify.client"
  set s to player state as text
  if s is "stopped" then return "stopped"
  set t to current track
  set art to ""
  try
    set art to artwork url of t
  end try
  set info to {name of t, artist of t, album of t, art, id of t, (duration of t) as text, player position, shuffling as text, (sound volume) as text, repeating as text}
end tell
set sep to character id ${APP_FIELD_SEP.charCodeAt(0)}
set pos to (round ((item 7 of info) * 1000)) as text
return s & sep & (item 1 of info) & sep & (item 2 of info) & sep & (item 3 of info) & sep & (item 4 of info) & sep & (item 5 of info) & sep & (item 6 of info) & sep & pos & sep & (item 8 of info) & sep & (item 9 of info) & sep & (item 10 of info)`

async function appState(): Promise<MusicState> {
  if (!(await appRunning())) return { source: 'none', playing: false, positionMs: 0, hint: 'not-running' }
  try {
    return parseAppState(await osascript(APP_STATE_SCRIPT))
  } catch (err) {
    if ((err as Error).message === 'automation') return { source: 'none', playing: false, positionMs: 0, hint: 'automation' }
    return { source: 'app', playing: false, positionMs: 0, error: 'Couldn’t read what Spotify is playing.' }
  }
}

const tellApp = (command: string): Promise<string> => osascript(`tell application id "com.spotify.client" to ${command}`)
const quoted = (s: string): string => `"${s.replace(/["\\]/g, '')}"`

/** Opens the Spotify app (wherever it's installed) and waits for it to be ready to take commands. */
async function launchApp(): Promise<boolean> {
  await shell.openExternal('spotify:').catch(() => undefined)
  if (!IS_MAC) return false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await appRunning()) {
      // It reports running a moment before it'll play anything.
      await new Promise((r) => setTimeout(r, 1500))
      return true
    }
  }
  return false
}

/** Opens the Spotify app, or (Mac) the page in System Settings where you let Notes control it. */
export async function open(what: 'app' | 'automation'): Promise<void> {
  if (what === 'automation') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation')
  else await launchApp()
}

// ---------- Your Spotify account ----------

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function postToken(form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error(String(body.error_description ?? body.error ?? `Spotify said ${res.status}`))
    ;(err as Error & { code?: string }).code = String(body.error ?? '')
    throw err
  }
  return body
}

function listenForCode(state: string): Promise<{ server: Server; code: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let deliver: (code: string) => void
    let fail: (err: Error) => void
    const code = new Promise<string>((res, rej) => {
      deliver = res
      fail = rej
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const page = (title: string, text: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,sans-serif;background:#16171d;color:#d7d9e0;display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${text}</p></div>`
        )
      }
      if (url.searchParams.get('state') !== state) {
        page('Something went wrong', 'This sign-in link doesn’t match. Please try connecting again from Notes.')
        fail(new Error('Sign-in was interrupted. Please try again.'))
      } else if (url.searchParams.get('error')) {
        page('Not connected', 'You can close this tab and return to Notes.')
        fail(new Error('Spotify didn’t give access, so nothing was connected.'))
      } else {
        page('Connected to Notes ✓', 'You can close this tab and return to Notes.')
        deliver(url.searchParams.get('code') ?? '')
      }
    })
    server.on('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`Something else on this computer is using port ${PORT}, which Spotify sign-in needs. Close it (or restart) and try again.`) : err)
    )
    server.listen(PORT, '127.0.0.1', () => resolve({ server, code }))
  })
}

export async function connect(): Promise<MusicStatus> {
  const s = load()
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t protect a saved sign-in, so Spotify can’t be connected.')
  if (!s.clientId) throw new Error('Add your Spotify client ID first.')
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))
  const { server, code } = await listenForCode(state)
  try {
    const auth = new URL(AUTH_URL)
    auth.search = new URLSearchParams({
      client_id: s.clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state
    }).toString()
    await shell.openExternal(auth.toString())
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Sign-in timed out. If Spotify said “INVALID_CLIENT: Invalid redirect URI”, check the Redirect URI in your Spotify app matches exactly, then connect again.')),
        SIGN_IN_TIMEOUT_MS
      )
    )
    const authCode = await Promise.race([code, timeout])
    const tokens = await postToken({ grant_type: 'authorization_code', code: authCode, redirect_uri: REDIRECT_URI, client_id: s.clientId, code_verifier: verifier })
    if (typeof tokens.refresh_token !== 'string') throw new Error('Spotify didn’t allow staying signed in. Try connecting again.')
    s.refreshToken = encrypt(tokens.refresh_token)
    s.scope = typeof tokens.scope === 'string' ? tokens.scope : undefined
    accessToken = { token: String(tokens.access_token), expires: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 }
    accountError = undefined
    save()
    const me = await api('/me').catch(() => ({}) as Record<string, unknown>)
    s.name = typeof me.display_name === 'string' ? me.display_name : undefined
    s.userId = typeof me.id === 'string' ? me.id : undefined
    save()
    return status()
  } finally {
    server.close()
  }
}

export function disconnect(): MusicStatus {
  const s = load()
  s.refreshToken = undefined
  s.name = undefined
  s.scope = undefined
  accessToken = null
  accountError = undefined
  save()
  return status()
}

async function getAccessToken(): Promise<string | null> {
  const s = load()
  if (!s.refreshToken || !s.clientId) return null
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.token
  try {
    const tokens = await postToken({ grant_type: 'refresh_token', refresh_token: decrypt(s.refreshToken), client_id: s.clientId })
    accessToken = { token: String(tokens.access_token), expires: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 }
    // Spotify may hand out a new refresh token; the old one then stops working.
    if (typeof tokens.refresh_token === 'string') s.refreshToken = encrypt(tokens.refresh_token)
    if (typeof tokens.scope === 'string') s.scope = tokens.scope
    if (typeof tokens.refresh_token === 'string' || typeof tokens.scope === 'string') save()
    accountError = undefined
    return accessToken.token
  } catch (err) {
    if ((err as Error & { code?: string }).code === 'invalid_grant' || (err as Error & { code?: string }).code === 'invalid_client') {
      s.refreshToken = undefined
      save()
      accountError = 'Your Spotify sign-in ended. Connect again in Settings → Music.'
    } else {
      accountError = 'Couldn’t reach Spotify right now.'
    }
    return null
  }
}

class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason = ''
  ) {
    super(message)
  }
}

async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const token = await getAccessToken()
  if (!token) throw new Error(accountError ?? 'Connect your Spotify account in Settings → Music first.')
  const res = await net.fetch(API_URL + path, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  if (res.status === 204) return {}
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    // Some player commands answer with plain text.
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { message?: string; reason?: string }
    const reason = err.reason ?? ''
    if (reason === 'NO_ACTIVE_DEVICE' || res.status === 404) throw new SpotifyError('Spotify isn’t open anywhere. Open it on this computer or your phone first.', 404, 'NO_ACTIVE_DEVICE')
    if (reason === 'PREMIUM_REQUIRED' || /premium/i.test(err.message ?? '')) {
      throw new SpotifyError('Spotify only lets Notes control your music with Spotify Premium.', 403, 'PREMIUM_REQUIRED')
    }
    if (res.status === 403 && /scope/i.test(err.message ?? '')) {
      throw new SpotifyError('Notes needs a little more permission for this. Connect Spotify again in Settings → Music (Disconnect, then Connect).', 403)
    }
    if (res.status === 403 && /user.*(not|registered)|developer/i.test(err.message ?? '')) {
      throw new SpotifyError('Spotify says your account isn’t allowed to use your developer app. Add your Spotify email under User Management in the Spotify dashboard.', 403)
    }
    if (res.status === 401) {
      accessToken = null
      throw new SpotifyError('Your Spotify sign-in ended. Connect again in Settings → Music.', 401)
    }
    if (res.status === 429) throw new SpotifyError('Spotify asked Notes to slow down. Try again in a minute.', 429)
    throw new SpotifyError(`Spotify said ${res.status}${err.message ? `: ${err.message}` : ''}`, res.status, reason)
  }
  return body
}

const connected = (): boolean => !!load().refreshToken

async function accountState(): Promise<MusicState> {
  try {
    return parseAccountState(await api('/me/player?additional_types=episode'))
  } catch (err) {
    return { source: 'account', playing: false, positionMs: 0, error: (err as Error).message }
  }
}

// ---------- What the player uses ----------

/** The Mac's Spotify app when it's open, otherwise your account (any device), otherwise what's missing. */
export async function nowPlaying(): Promise<MusicState> {
  if (IS_MAC) {
    const local = await appState()
    // An idle Spotify app here shouldn't hide music playing on your phone.
    if ((local.source === 'app' && (local.track || !connected())) || local.hint === 'automation' || !connected()) return local
  }
  if (connected()) return accountState()
  return { source: 'none', playing: false, positionMs: 0, hint: 'setup' }
}

export async function control(action: MusicAction): Promise<void> {
  if (await appRunning()) {
    const commands: Record<MusicAction, string> = {
      toggle: 'playpause',
      pause: 'pause',
      next: 'next track',
      previous: 'previous track',
      shuffle: 'set shuffling to not shuffling',
      repeat: 'set repeating to not repeating'
    }
    await tellApp(commands[action])
    return
  }
  if (!connected()) {
    if (IS_MAC) throw new Error('Open Spotify first.')
    throw new Error('Connect your Spotify account in Settings → Music first.')
  }
  if (action === 'next') await api('/me/player/next', { method: 'POST' })
  else if (action === 'previous') await api('/me/player/previous', { method: 'POST' })
  else {
    const now = parseAccountState(await api('/me/player'))
    if (action === 'shuffle') await api(`/me/player/shuffle?state=${!now.shuffle}`, { method: 'PUT' })
    else if (action === 'repeat') await api(`/me/player/repeat?state=${nextRepeat(now.repeat)}`, { method: 'PUT' })
    else if (action === 'pause') {
      if (now.playing) await api('/me/player/pause', { method: 'PUT' })
    } else await api(now.playing ? '/me/player/pause' : '/me/player/play', { method: 'PUT' })
  }
}

export async function seek(ms: number): Promise<void> {
  const at = Math.max(0, Math.round(ms))
  if (await appRunning()) await tellApp(`set player position to ${(at / 1000).toFixed(1)}`)
  else if (connected()) await api(`/me/player/seek?position_ms=${at}`, { method: 'PUT' })
}

/** Plays a song, playlist or album; a song can be played within its playlist/album (`context`). */
export async function play(uri: string, context?: string): Promise<void> {
  if (!/^spotify:[a-z]+:[A-Za-z0-9]+$/.test(uri) || (context && !/^spotify:[a-z]+:[A-Za-z0-9]+$/.test(context))) throw new Error('That isn’t a Spotify link.')
  const playInApp = (): Promise<string> => tellApp(context ? `play track ${quoted(uri)} in context ${quoted(context)}` : `play track ${quoted(uri)}`)
  if (await appRunning()) {
    await playInApp()
    return
  }
  if (connected()) {
    try {
      await api('/me/player/play', { method: 'PUT', body: playBody(uri, context) })
      return
    } catch (err) {
      if ((err as SpotifyError).reason !== 'NO_ACTIVE_DEVICE') throw err
      // Spotify's open somewhere but idle: play there.
      const devices = (await api('/me/player/devices')).devices as { id?: string; is_restricted?: boolean }[] | undefined
      const device = (devices ?? []).find((d) => d.id && !d.is_restricted)
      if (device) {
        await api(`/me/player/play?device_id=${encodeURIComponent(device.id!)}`, { method: 'PUT', body: playBody(uri, context) })
        return
      }
      if (!IS_MAC) throw err
    }
  }
  if (IS_MAC) {
    if (!(await launchApp())) throw new Error('Spotify didn’t open. Is the Spotify app installed?')
    await playInApp()
    return
  }
  // Windows without an account: Spotify opens on it, and you press play there.
  await shell.openExternal(uri)
}

export async function search(query: string): Promise<MusicSearchResults> {
  const q = query.trim()
  if (!q) return { tracks: [], playlists: [], albums: [] }
  // Spotify lets personal apps have at most 10 of each.
  return parseSearch(await api(`/search?${new URLSearchParams({ q, type: 'track,playlist,album', limit: '10' })}`))
}

/** Your Spotify user id (asked for once, for sign-ins from before Notes kept it). */
async function myId(): Promise<string | undefined> {
  const s = load()
  if (!s.userId) {
    const me = await api('/me')
    if (typeof me.id === 'string') {
      s.userId = me.id
      save()
    }
  }
  return s.userId
}

export async function playlists(): Promise<MusicItem[]> {
  const me = await myId().catch(() => undefined)
  return parsePlaylists(await api('/me/playlists?limit=50'), me)
}

function idOf(uri: string): string {
  const id = playlistId(uri)
  if (!id) throw new Error('That isn’t one of your playlists.')
  return id
}

/** A playlist's songs, in order (only for playlists you own or can edit, which is all Spotify allows). */
export async function playlistSongs(uri: string): Promise<MusicItem[]> {
  const id = idOf(uri)
  const songs: MusicItem[] = []
  // 50 at a time; a very long playlist stops at 1,000.
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await api(`/playlists/${id}/items?limit=50&offset=${offset}&additional_types=track,episode`)
    songs.push(...parsePlaylistSongs(page))
    if (!page.next) break
  }
  return songs
}

/** Makes a new private playlist. */
export async function createPlaylist(name: string): Promise<MusicItem> {
  const n = name.trim()
  if (!n) throw new Error('Give the playlist a name.')
  return parsePlaylist(await api('/me/playlists', { method: 'POST', body: { name: n.slice(0, 100), public: false } }), await myId().catch(() => undefined))
}

export async function renamePlaylist(uri: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) throw new Error('Give the playlist a name.')
  await api(`/playlists/${idOf(uri)}`, { method: 'PUT', body: { name: n.slice(0, 100) } })
}

/** Removes a playlist from your library (for one you made, that's deleting it, as in the Spotify app). */
export async function deletePlaylist(uri: string): Promise<void> {
  idOf(uri)
  await api(`/me/library?${new URLSearchParams({ uris: uri })}`, { method: 'DELETE' })
}

/** Adds songs to the end of a playlist. */
export async function addToPlaylist(uri: string, songs: string[]): Promise<void> {
  const uris = songs.filter((u) => SONG_URI.test(u)).slice(0, 100)
  if (!uris.length) throw new Error('Only songs can be added to a playlist.')
  await api(`/playlists/${idOf(uri)}/items`, { method: 'POST', body: { uris } })
}

/** Takes a song out of a playlist (every time it's in there, which is how Spotify does it). */
export async function removeFromPlaylist(uri: string, song: string): Promise<void> {
  if (!SONG_URI.test(song)) throw new Error('That isn’t a song.')
  await api(`/playlists/${idOf(uri)}/items`, { method: 'DELETE', body: { items: [{ uri: song }] } })
}

/** Moves the song at position `from` to position `to` (both counting from 0). */
export async function moveInPlaylist(uri: string, from: number, to: number): Promise<void> {
  if (![from, to].every((n) => Number.isInteger(n) && n >= 0) || from === to) return
  await api(`/playlists/${idOf(uri)}/items`, { method: 'PUT', body: moveBody(from, to) })
}


/** 0–100, on the Spotify app here or wherever your account is playing. */
export async function setVolume(percent: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(percent)))
  if (await appRunning()) await tellApp(`set sound volume to ${v}`)
  else if (connected()) await api(`/me/player/volume?volume_percent=${v}`, { method: 'PUT' })
  else throw new Error(IS_MAC ? 'Open Spotify first.' : 'Connect your Spotify account in Settings → Music first.')
}

const SONG_URI = /^spotify:(track|episode):[A-Za-z0-9]+$/

/** Whether a song is in your Liked Songs. */
export async function isLiked(uri: string): Promise<boolean> {
  if (!SONG_URI.test(uri) || !connected()) return false
  const body = await api(`/me/library/contains?${new URLSearchParams({ uris: uri })}`)
  // Spotify answers with a list of true/false, one for each link asked about.
  return Array.isArray(body) && body[0] === true
}

/** Adds a song to (or takes it out of) your Liked Songs. */
export async function setLiked(uri: string, liked: boolean): Promise<void> {
  if (!SONG_URI.test(uri)) throw new Error('Only songs can be liked.')
  if (!connected()) throw new Error('Connect your Spotify account in Settings → Music to like songs.')
  await api(`/me/library?${new URLSearchParams({ uris: uri })}`, { method: liked ? 'PUT' : 'DELETE' })
}

export async function queue(): Promise<MusicQueue> {
  return parseQueue(await api('/me/player/queue'))
}

/** Plays a song after the current one. */
export async function addToQueue(uri: string): Promise<void> {
  if (!SONG_URI.test(uri)) throw new Error('Only songs can be added to the queue.')
  await api(`/me/player/queue?${new URLSearchParams({ uri })}`, { method: 'POST' })
}

export async function recent(): Promise<MusicItem[]> {
  return parseRecent(await api('/me/player/recently-played?limit=50'))
}

export async function devices(): Promise<MusicDevice[]> {
  return parseDevices(await api('/me/player/devices'))
}

/** Moves the music to another device and keeps it playing there. */
export async function transfer(deviceId: string): Promise<void> {
  if (!/^[A-Za-z0-9]+$/.test(deviceId)) throw new Error('That device isn’t available.')
  await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } })
}
