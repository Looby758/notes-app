import { app, BrowserWindow, globalShortcut, ipcMain, net, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { acceleratorLabel, SYSTEM_NAME } from '@shared/platform'
import { parseAudd, spotifyQuery, type FoundSong, type SongIdStatus } from '@shared/songId'
import * as spotify from './spotify'
import { logError } from './log'

/**
 * "What's this song?": the clip Orbit recorded goes to AudD (audd.io), which says what song it is.
 * Your AudD key (optional: a few songs a day work without one) is stored encrypted with the
 * system's own protection, like the Spotify sign-in. Also the system-wide shortcut that starts it
 * while you're in a game.
 */

const AUDD_URL = process.env.NOTES_AUDD_URL ?? 'https://api.audd.io/'
/** The most Orbit sends: a 10-second clip is ~440 KB, so anything near this is a mistake. */
const MAX_CLIP_BYTES = 4 * 1024 * 1024

interface Stored {
  /** Encrypted. */
  key?: string
}

let stored: Stored | null = null
let registered = ''
let shortcutError: string | undefined
let getMain: () => BrowserWindow | null = () => null

const file = (): string => join(app.getPath('userData'), 'songid.json')

function load(): Stored {
  if (stored) return stored
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8')) as Stored
  } catch {
    stored = {}
  }
  return stored!
}

function save(): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8')
  renameSync(tmp, file())
}

function key(): string | undefined {
  const k = load().key
  if (!k) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(k, 'base64'))
  } catch {
    return undefined
  }
}

export function status(): SongIdStatus {
  return {
    hasKey: !!load().key,
    canEncrypt: safeStorage.isEncryptionAvailable(),
    shortcut: registered ? acceleratorLabel(registered) : '',
    shortcutError
  }
}

/** Saves your AudD key ('' takes it away). */
export function setKey(value: string): SongIdStatus {
  const s = load()
  const k = value.trim()
  if (!k) delete s.key
  else {
    if (!/^[A-Za-z0-9]{8,128}$/.test(k)) throw new Error('That doesn’t look like an AudD key (it’s a long run of letters and numbers from dashboard.audd.io).')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the key securely, so it wasn’t saved.')
    s.key = safeStorage.encryptString(k).toString('base64')
  }
  save()
  return status()
}

/** A multipart form with the clip (Electron's fetch takes bytes, so it's put together here). */
function form(fields: Record<string, string>, clip: Uint8Array): { body: Buffer; type: string } {
  const boundary = `----orbit${randomBytes(12).toString('hex')}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`))
  parts.push(Buffer.from(clip))
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` }
}

/** Asks AudD what song the clip is (a mono WAV); null when it didn't recognise one. */
export async function identify(clip: Uint8Array): Promise<FoundSong | null> {
  if (!(clip instanceof Uint8Array) || clip.byteLength < 1000) throw new Error('The sound clip was empty. Try again.')
  if (clip.byteLength > MAX_CLIP_BYTES) throw new Error('The sound clip was too big to send.')
  const token = key()
  const { body, type } = form({ return: 'spotify,apple_music', ...(token ? { api_token: token } : {}) }, clip)
  let res: Response
  try {
    res = await net.fetch(AUDD_URL, { method: 'POST', headers: { 'Content-Type': type }, body: new Uint8Array(body), signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    logError('songId', err)
    throw new Error('Couldn’t reach AudD to recognise the song. Check the internet connection.')
  }
  if (!res.ok) throw new Error(`AudD didn’t answer properly (${res.status}). Try again in a bit.`)
  const song = parseAudd(await res.json())
  if (song && !song.spotifyUri) song.spotifyUri = await findOnSpotify(song)
  return song
}

/** AudD didn't know the Spotify link: look it up with your account, if it's connected. */
async function findOnSpotify(song: FoundSong): Promise<string | undefined> {
  if (!spotify.status().connected) return undefined
  try {
    const found = await spotify.search(spotifyQuery(song))
    return found.tracks[0]?.uri
  } catch {
    return undefined
  }
}

/** (Re)registers the system-wide shortcut, which tells the Orbit window to start listening. */
export function applySongIdShortcut(accel: string): void {
  if (registered === accel) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  shortcutError = undefined
  if (!accel) return
  try {
    const start = (): void => {
      const win = getMain()
      if (win && !win.isDestroyed()) win.webContents.send('songId:listen')
    }
    if (globalShortcut.register(accel, start)) registered = accel
    else shortcutError = `${acceleratorLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick a different shortcut.`
  } catch {
    shortcutError = `${acceleratorLabel(accel)} can't be used as a shortcut.`
  }
}

export function setupSongId(hooks: { getMain: () => BrowserWindow | null }): void {
  getMain = hooks.getMain
  ipcMain.handle('songId:status', () => status())
  ipcMain.handle('songId:setKey', (_e, value: string) => setKey(String(value ?? '')))
  ipcMain.handle('songId:identify', (_e, clip: Uint8Array) => identify(clip))
}
