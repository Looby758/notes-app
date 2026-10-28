/**
 * Places in notes: a place is a markdown link to Google Maps on a line of its own, e.g.
 *
 *   [📍 Eiffel Tower](https://www.google.com/maps/search/?api=1&query=48.8582602,2.2944991 "Av. Gustave Eiffel, Paris")
 *
 * The link opens Google Maps (no Google account or API key needed); the optional title holds the
 * address. Searching uses OpenStreetMap's free place search, and the small map preview uses
 * OpenStreetMap's map pictures, so nothing needs setting up.
 */

export interface Place {
  name: string
  /** The rest of the address, e.g. "Avenue Gustave Eiffel, Paris, France". */
  address: string
  lat: number
  lon: number
}

/** What a Google Maps link points at: coordinates if it has them, and/or what was searched for. */
export interface MapsTarget {
  lat?: number
  lon?: number
  query?: string
}

const round = (n: number): string => String(Math.round(n * 1e7) / 1e7)

/** A Google Maps link to these coordinates (or to a search, if there are none). */
export function mapsUrl(target: MapsTarget): string {
  const query =
    target.lat !== undefined && target.lon !== undefined ? `${round(target.lat)},${round(target.lon)}` : (target.query ?? '').trim()
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query).replace(/%2C/g, ',')}`
}

/** Square brackets would end the link text early, and quotes the title. */
const linkText = (s: string): string => s.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim()
const linkTitle = (s: string): string => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim()

/** The markdown for a place: a 📍 link that opens Google Maps, with the address as its title. */
export function placeMarkdown(place: Place | { name: string; query: string }): string {
  if ('query' in place) return `[📍 ${linkText(place.name)}](${mapsUrl({ query: place.query })})`
  const title = place.address ? ` "${linkTitle(place.address)}"` : ''
  return `[📍 ${linkText(place.name)}](${mapsUrl(place)}${title})`
}

function coords(text: string | null | undefined): { lat: number; lon: number } | null {
  if (!text) return null
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** True for links to Google Maps, including the short links its Share button makes. */
export function isMapsUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(u.protocol)) return false
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'maps.app.goo.gl') return true
  if (host === 'goo.gl') return u.pathname.startsWith('/maps')
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true
  return /^google\.[a-z.]+$/.test(host) && u.pathname.startsWith('/maps')
}

/** Reads where a Google Maps link points; null if it isn't one. */
export function parseMapsUrl(url: string): MapsTarget | null {
  if (!isMapsUrl(url)) return null
  const u = new URL(url)
  const target: MapsTarget = {}
  // A place page's own pin (…!3d48.85!4d2.29) is more exact than where the map was looking (@48.8,2.2,15z).
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u.pathname + u.search)
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u.pathname)
  const params = ['query', 'q', 'destination', 'll', 'center']
  let found = pin ? coords(`${pin[1]},${pin[2]}`) : null
  for (const key of params) {
    const value = u.searchParams.get(key)
    if (!value) continue
    const c = coords(value)
    if (c) found ??= c
    else if (key !== 'll' && key !== 'center') target.query ??= value.trim()
  }
  found ??= at ? coords(`${at[1]},${at[2]}`) : null
  // /maps/place/Eiffel+Tower/… and /maps/search/pizza/…
  const named = /\/maps\/(?:place|search)\/([^/@]+)/.exec(u.pathname)
  if (named && !target.query) {
    const name = decode(named[1]).trim()
    if (name && !coords(name)) target.query = name
    else if (name) found ??= coords(name)
  }
  if (found) {
    target.lat = found.lat
    target.lon = found.lon
  }
  return target
}

const LINE = /^\s*\[([^\]\n]*)\]\(\s*<?(https?:\/\/[^\s>)]+)>?(?:\s+"([^"\n]*)")?\s*\)\s*$/
const BARE = /^\s*<?(https?:\/\/\S+?)>?\s*$/

/** A line that's only a Google Maps link: what it says, where it points and the address. */
export function parsePlaceLine(line: string): { name: string; url: string; address: string; target: MapsTarget } | null {
  if (!line.includes('http')) return null
  const m = LINE.exec(line)
  const url = m ? m[2] : BARE.exec(line)?.[1]
  if (!url) return null
  const target = parseMapsUrl(url)
  if (!target) return null
  const text = (m?.[1] ?? '').replace(/^\s*📍\s*/u, '').trim()
  return { name: text || target.query || 'Place on Google Maps', url, address: (m?.[3] ?? '').trim(), target }
}

/** One result from OpenStreetMap's place search (Nominatim, format=jsonv2). */
interface NominatimResult {
  lat?: string
  lon?: string
  name?: string
  display_name?: string
}

/** Turns OpenStreetMap's search results into places: the name, then the rest of the address. */
export function placesFromSearch(results: unknown): Place[] {
  if (!Array.isArray(results)) return []
  const out: Place[] = []
  for (const r of results as NominatimResult[]) {
    const lat = Number(r?.lat)
    const lon = Number(r?.lon)
    const full = String(r?.display_name ?? '').trim()
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !full) continue
    const parts = full.split(',').map((p) => p.trim()).filter(Boolean)
    // Unnamed results (like a street address) start with the house number: keep "12, High Street" together.
    let name = String(r?.name ?? '').trim()
    let used = name === parts[0] ? 1 : 0
    if (!name) {
      used = /^\d+\w?$/.test(parts[0] ?? '') && parts[1] ? 2 : 1
      name = parts.slice(0, used).join(' ')
    }
    out.push({ name, address: parts.slice(used).join(', '), lat, lon })
  }
  return out
}

export const TILE_SIZE = 256

/** Which map picture (tile) holds this point at this zoom, and where in it the point is. */
export function tileAt(lat: number, lon: number, zoom: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** zoom
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const rad = (clampedLat * Math.PI) / 180
  // Kept just inside the map, so rounding at its edges can't step off it.
  const inside = (f: number): number => Math.min(Math.max(f, 0), n - 1e-9)
  const fx = inside(((lon + 180) / 360) * n)
  const fy = inside(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  const x = Math.floor(fx)
  const y = Math.floor(fy)
  return { x, y, px: Math.floor((fx - x) * TILE_SIZE), py: Math.floor((fy - y) * TILE_SIZE) }
}
