import { app, net } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mergePrices, mayorOf, type Prices, type SbFriend, type SbMayor } from '@shared/skyblockMore'
import { skinFromValue } from '@shared/skyblockTextures'
import { logError } from './log'

/**
 * Things the SkyBlock profile needs from outside Hypixel's profile answer: item prices for networth
 * (lowest BIN from Coflnet's NEU-format list, Bazaar from Hypixel), the mayor, Minecraft names and
 * skins for any player, and the players you've looked up or starred (the friends board).
 */

const HYPIXEL = process.env.NOTES_HYPIXEL_URL ?? 'https://api.hypixel.net'
const MOJANG = process.env.NOTES_MOJANG_URL ?? 'https://api.mojang.com'
const MOJANG_SESSION = process.env.NOTES_MOJANG_SESSION_URL ?? 'https://sessionserver.mojang.com'
const LOWEST_BIN = (process.env.NOTES_LOWEST_BIN_URLS ?? 'https://sky.coflnet.com/api/prices/neu,https://lb.tricked.pro/lowestbins').split(',').filter(Boolean)
const PRICES_MAX_AGE = 60 * 60_000
const MAX_RECENT = 20

const file = (name: string): string => join(app.getPath('userData'), name)

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, value: unknown): void {
  try {
    writeFileSync(`${file(name)}.tmp`, JSON.stringify(value), 'utf8')
    renameSync(`${file(name)}.tmp`, file(name))
  } catch (err) {
    logError(`saving ${name}`, err)
  }
}

async function getJson(url: string, timeout = 30_000): Promise<unknown> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

// ---------- prices ----------

let prices: { at: number; prices: Prices } | null = null
let pricesJob: Promise<void> | null = null
const priceListeners: (() => void)[] = []

/** Called when new prices arrive (so networth can be worked out again). */
export const onPricesChanged = (fn: () => void): void => void priceListeners.push(fn)

/** The prices Orbit has (maybe old, maybe none yet), asking for new ones in the background when they're over an hour old. */
export function currentPrices(): { at: number; prices: Prices } | null {
  if (!prices) prices = readJson<{ at: number; prices: Prices } | null>('skyblock-prices.json', null)
  if ((!prices || Date.now() - prices.at > PRICES_MAX_AGE) && !pricesJob) pricesJob = fetchPrices().finally(() => (pricesJob = null))
  return prices
}

async function fetchPrices(): Promise<void> {
  let lowest: unknown = null
  for (const url of LOWEST_BIN) {
    try {
      lowest = await getJson(url)
      break
    } catch {
      // Try the next list.
    }
  }
  let bazaar: unknown = null
  try {
    bazaar = await getJson(`${HYPIXEL}/v2/skyblock/bazaar`)
  } catch {
    // Auction prices alone still give a networth.
  }
  if (!lowest && !bazaar) return
  const merged = mergePrices(lowest, bazaar)
  // Keep the old prices for anything the new lists left out.
  prices = { at: Date.now(), prices: { ...(prices?.prices ?? {}), ...merged } }
  writeJson('skyblock-prices.json', prices)
  for (const fn of priceListeners) fn()
}

// ---------- the mayor ----------

let mayor: { at: number; mayor: SbMayor | null } | null = null

export async function currentMayor(): Promise<SbMayor | null> {
  if (mayor && Date.now() - mayor.at < 20 * 60_000) return mayor.mayor
  try {
    mayor = { at: Date.now(), mayor: mayorOf(await getJson(`${HYPIXEL}/v2/resources/skyblock/election`, 15_000)) }
  } catch {
    mayor = { at: Date.now() - 15 * 60_000, mayor: mayor?.mayor ?? null }
  }
  return mayor.mayor
}

// ---------- Minecraft players ----------

const names = new Map<string, { name: string; skin: string; at: number }>()

/** A Minecraft name to its id ("Notch" → "069a79f4…"). Throws a readable message if there's no such player. */
export async function playerByName(name: string): Promise<{ uuid: string; name: string }> {
  const clean = name.trim()
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) throw new Error('That isn’t a Minecraft name (letters, numbers and _ only, up to 16).')
  let res: Response
  try {
    res = await net.fetch(`${MOJANG}/users/profiles/minecraft/${encodeURIComponent(clean)}`, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Couldn’t reach Mojang to look up that name. Check the internet connection.')
  }
  if (res.status === 404 || res.status === 204) throw new Error(`There’s no Minecraft player called “${clean}”.`)
  if (!res.ok) throw new Error(`Mojang answered ${res.status}. Try again in a bit.`)
  const body = (await res.json()) as { id?: string; name?: string }
  if (!body.id) throw new Error(`There’s no Minecraft player called “${clean}”.`)
  return { uuid: body.id.replace(/-/g, '').toLowerCase(), name: body.name ?? clean }
}

/** A player's name and skin from their id, kept for a day. */
export async function playerById(uuid: string): Promise<{ name: string; skin: string }> {
  const id = uuid.replace(/-/g, '').toLowerCase()
  const known = names.get(id)
  if (known && Date.now() - known.at < 86_400_000) return known
  try {
    const res = await net.fetch(`${MOJANG_SESSION}/session/minecraft/profile/${id}`, { signal: AbortSignal.timeout(15_000) })
    if (res.ok) {
      const body = (await res.json()) as { name?: string; properties?: { name?: string; value?: string }[] }
      const value = body.properties?.find((p) => p.name === 'textures')?.value ?? ''
      const out = { name: body.name ?? '', skin: value ? skinFromValue(value) : '', at: Date.now() }
      names.set(id, out)
      return out
    }
  } catch {
    // Unknown for now.
  }
  return known ?? { name: '', skin: '' }
}

// ---------- players you've looked up ----------

let friends: SbFriend[] | null = null

export function lookedUp(): SbFriend[] {
  if (!friends) friends = readJson<SbFriend[]>('skyblock-players.json', [])
  return friends
}

/** Remembers a look-up (newest first), keeping starred players and the last 20 others. */
export function rememberPlayer(p: Omit<SbFriend, 'starred'> & { starred?: boolean }): void {
  const list = lookedUp()
  const old = list.find((f) => f.uuid === p.uuid)
  const next: SbFriend = { ...p, starred: p.starred ?? old?.starred ?? false, summary: p.summary ?? old?.summary ?? null }
  const rest = list.filter((f) => f.uuid !== p.uuid)
  const starred = rest.filter((f) => f.starred)
  const others = rest.filter((f) => !f.starred)
  friends = [next, ...starred, ...others.slice(0, MAX_RECENT)].sort((a, b) => b.at - a.at)
  writeJson('skyblock-players.json', friends)
}

export function starPlayer(uuid: string, on: boolean): void {
  const f = lookedUp().find((x) => x.uuid === uuid)
  if (!f) return
  f.starred = on
  writeJson('skyblock-players.json', friends)
}

export function forgetPlayer(uuid: string): void {
  friends = lookedUp().filter((f) => f.uuid !== uuid)
  writeJson('skyblock-players.json', friends)
}

// ---------- history ----------

export function readHistory<T>(): Record<string, T[]> {
  return readJson<Record<string, T[]>>('skyblock-history.json', {})
}

export function writeHistory<T>(h: Record<string, T[]>): void {
  writeJson('skyblock-history.json', h)
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
