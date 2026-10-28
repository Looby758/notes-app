import { app, ipcMain, net } from 'electron'
import { placesFromSearch, type Place } from '@shared/places'
import { logError } from './log'

/**
 * Finding places for notes, and the pictures for their small maps. Both come from OpenStreetMap,
 * which is free and needs no account or key, as long as apps say who they are and don't ask too
 * often (at most one search a second).
 */

const userAgent = (): string => `${app.getName()}/${app.getVersion()} (desktop notes app)`

let queue: Promise<unknown> = Promise.resolve()
let lastSearch = 0

async function fetchWithin(url: string, ms: number, accept: string): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ms)
  try {
    return await net.fetch(url, { signal: abort.signal, headers: { 'User-Agent': userAgent(), Accept: accept } })
  } finally {
    clearTimeout(timer)
  }
}

/** Places matching what was typed, best first; throws if the search couldn't be reached. */
function search(query: string): Promise<Place[]> {
  const q = query.trim().slice(0, 200)
  if (!q) return Promise.resolve([])
  // One at a time, a second apart.
  const run = queue.then(async () => {
    const wait = lastSearch + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastSearch = Date.now()
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(app.getLocale())}`
    const res = await fetchWithin(url, 8000, 'application/json')
    if (!res.ok) throw new Error(`The place search answered ${res.status}.`)
    return placesFromSearch(await res.json())
  })
  queue = run.catch(() => undefined)
  return run
}

// Map pictures, kept while the app is open so notes don't fetch the same ones again.
const tiles = new Map<string, Promise<string | null>>()
const MAX_TILES = 400

function tile(z: number, x: number, y: number): Promise<string | null> {
  const n = 2 ** z
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= n || y >= n) return Promise.resolve(null)
  const key = `${z}/${x}/${y}`
  let found = tiles.get(key)
  if (!found) {
    found = fetchWithin(`https://tile.openstreetmap.org/${key}.png`, 10_000, 'image/png')
      .then(async (res) => (res.ok ? `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` : null))
      .catch(() => null)
    // Don't remember failures, so they're tried again next time.
    void found.then((url) => url === null && tiles.delete(key))
    tiles.set(key, found)
    if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value!)
  }
  return found
}

export function setupPlaces(): void {
  ipcMain.handle('places:search', async (_e, query: string) => {
    try {
      return { places: await search(String(query)) }
    } catch (err) {
      logError('place search', err)
      return { places: [], error: "Couldn't reach the place search. Check you're online and try again." }
    }
  })
  ipcMain.handle('places:tile', (_e, z: number, x: number, y: number) => tile(z, x, y))
}
