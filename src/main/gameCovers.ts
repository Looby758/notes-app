import { app, ipcMain, net, safeStorage } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  ANIMATED_COVER_QUERY,
  coverLookupFresh,
  matchSgdbGame,
  pickAnimatedCover,
  steamAppId,
  STEAMGRIDDB_API,
  type CoversStatus,
  type SgdbGrid
} from '@shared/games'
import { foundGame } from './games'
import { logError } from './log'

/**
 * Animated covers for the Games page, from SteamGridDB, with your own free API key. The key is
 * stored encrypted (Electron safeStorage, like the AI helper's key) in `game-covers.json`, along
 * with what each lookup found, so each game is only asked about once in a while.
 *
 * Nothing is looked up without a key, and only game names and Steam ids are sent.
 */

interface Stored {
  /** Encrypted. */
  apiKey?: string
  /** Game id → the cover found (null: none), and when it was looked up (ms). */
  covers: Record<string, { url: string | null; checked: number }>
}

let stored: Stored | null = null
const storeFile = (): string => join(app.getPath('userData'), 'game-covers.json')

function load(): Stored {
  if (stored) return stored
  try {
    const s = JSON.parse(readFileSync(storeFile(), 'utf8'))
    stored = { apiKey: typeof s.apiKey === 'string' ? s.apiKey : undefined, covers: s.covers && typeof s.covers === 'object' ? s.covers : {} }
  } catch {
    stored = { covers: {} }
  }
  return stored
}

function save(): void {
  try {
    const file = storeFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(load()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving game covers', err)
  }
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
const decrypt = (text: string): string => safeStorage.decryptString(Buffer.from(text, 'base64'))

function status(): CoversStatus {
  return { hasKey: !!load().apiKey, canEncrypt: safeStorage.isEncryptionAvailable() }
}

class KeyRejected extends Error {}

async function sgdb<T>(key: string, path: string): Promise<T> {
  const res = await net.fetch(STEAMGRIDDB_API + path, { headers: { Authorization: `Bearer ${key}` } })
  if (res.status === 401 || res.status === 403) throw new KeyRejected('SteamGridDB didn’t accept the key.')
  // A game SteamGridDB doesn't know is a 404: simply no cover.
  if (res.status === 404) return [] as T
  if (!res.ok) throw new Error(`SteamGridDB answered ${res.status}`)
  const body = (await res.json()) as { success?: boolean; data?: T }
  return (body.data ?? []) as T
}

/** Looks up one game's animated cover: by Steam id for Steam games, by exact name for the rest. */
async function lookUp(key: string, game: { id: string; name: string }): Promise<string | null> {
  const appId = steamAppId(game.id)
  let path: string
  if (appId) path = `/grids/steam/${appId}?${ANIMATED_COVER_QUERY}`
  else {
    const results = await sgdb<{ id: number; name: string }[]>(key, `/search/autocomplete/${encodeURIComponent(game.name)}`)
    const id = matchSgdbGame(game.name, Array.isArray(results) ? results : [])
    if (id === null) return null
    path = `/grids/game/${id}?${ANIMATED_COVER_QUERY}`
  }
  const grids = await sgdb<SgdbGrid[]>(key, path)
  return pickAnimatedCover(Array.isArray(grids) ? grids : [])
}

/** One lookup at a time per game, even if the page asks again while it's running. */
const pending = new Map<string, Promise<string | null>>()

async function covers(ids: string[]): Promise<Record<string, string>> {
  const s = load()
  if (!s.apiKey || !safeStorage.isEncryptionAvailable()) return {}
  let key: string
  try {
    key = decrypt(s.apiKey)
  } catch {
    return {}
  }
  const now = Date.now()
  const out: Record<string, string> = {}
  const todo: { id: string; name: string }[] = []
  for (const id of ids) {
    const entry = s.covers[id]
    if (coverLookupFresh(entry, now)) {
      if (entry.url) out[id] = entry.url
    } else {
      const game = foundGame(id)
      if (game) todo.push(game)
    }
  }
  let rejected = false
  // A few at a time, to be kind to SteamGridDB.
  for (let i = 0; i < todo.length && !rejected; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (game) => {
        let job = pending.get(game.id)
        if (!job) {
          job = lookUp(key, game)
          pending.set(game.id, job)
        }
        try {
          const url = await job
          s.covers[game.id] = { url, checked: Date.now() }
          if (url) out[game.id] = url
        } catch (err) {
          if (err instanceof KeyRejected) rejected = true
          else logError('looking up a game cover', err)
          // Old answers are still better than none.
          const old = s.covers[game.id]
          if (old?.url) out[game.id] = old.url
        } finally {
          pending.delete(game.id)
        }
      })
    )
  }
  save()
  return out
}

async function setKey(raw: string): Promise<CoversStatus> {
  const key = raw.trim()
  if (!key) throw new Error('Paste your API key first.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the key securely, so it wasn’t saved.')
  try {
    // A small search, just to see the key works.
    await sgdb(key, '/search/autocomplete/portal')
  } catch (err) {
    if (err instanceof KeyRejected) throw new Error('SteamGridDB didn’t accept that key. Check you copied all of it.')
    throw new Error('Couldn’t reach SteamGridDB. Check your internet connection.')
  }
  const s = load()
  s.apiKey = encrypt(key)
  // Games looked up before (without a key, or with another) are asked about again.
  s.covers = {}
  save()
  return status()
}

function clearKey(): CoversStatus {
  const s = load()
  s.apiKey = undefined
  s.covers = {}
  save()
  return status()
}

export function setupGameCovers(): void {
  ipcMain.handle('games:coversStatus', () => status())
  ipcMain.handle('games:setCoversKey', (_e, key: string) => setKey(String(key ?? '')))
  ipcMain.handle('games:clearCoversKey', () => clearKey())
  ipcMain.handle('games:covers', async (_e, ids: unknown) => {
    try {
      return await covers(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 500) : [])
    } catch (err) {
      logError('game covers', err)
      return {}
    }
  })
}
