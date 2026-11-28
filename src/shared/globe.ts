/**
 * Survival mode, stage two: the whole globe.
 *
 * The globe itself is mostly empty. Wherever you open an area (anywhere on land), a stretch of
 * country a few miles across is built for that spot: the city itself if it's near a famous one,
 * otherwise made-up towns with local names. Every area with anything in it runs on the same clock,
 * so a group in Georgia and a group in France live through the same days. Groups can set off for
 * somewhere far away; they walk the distance on the globe over the days, and arrive in the area
 * there (built when they get there if nobody has opened it yet).
 *
 * Like the rest of the survival sim, it's seeded and deterministic, and a snapshot of the globe can
 * be restored to rewind.
 */

import { cultureOf, type CultureId } from './cultures'
import { CITIES, type City } from './globeCities'
import { LAND } from './globeLand'
import {
  DAY,
  MAP_H,
  MAP_W,
  START_DAY,
  bringInGroup,
  createSurvivalWorld,
  membersOf,
  readyToLeave,
  sendAway,
  snapshotSurvival,
  stepSurvival,
  takeOutGroup,
  upgradeSurvival,
  type Group,
  type Person,
  type SurvivalWorld,
  type WorldLog
} from './survival'

// ---------- geography ----------

const R_EARTH = 6371
const rad = (d: number): number => (d * Math.PI) / 180
const deg = (r: number): number => (r * 180) / Math.PI

/** Distance between two points on the globe, in km. */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** The direction from one point to another, in degrees clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** The point a fraction `t` of the way along the great circle between two points. */
export function along(lat1: number, lon1: number, lat2: number, lon2: number, t: number): { lat: number; lon: number } {
  const p1 = [Math.cos(rad(lat1)) * Math.cos(rad(lon1)), Math.cos(rad(lat1)) * Math.sin(rad(lon1)), Math.sin(rad(lat1))]
  const p2 = [Math.cos(rad(lat2)) * Math.cos(rad(lon2)), Math.cos(rad(lat2)) * Math.sin(rad(lon2)), Math.sin(rad(lat2))]
  const dot = Math.min(1, Math.max(-1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]))
  const w = Math.acos(dot)
  if (w < 1e-9) return { lat: lat1, lon: lon1 }
  const a = Math.sin((1 - t) * w) / Math.sin(w)
  const b = Math.sin(t * w) / Math.sin(w)
  const x = a * p1[0] + b * p2[0]
  const y = a * p1[1] + b * p2[1]
  const z = a * p1[2] + b * p2[2]
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) }
}

interface Outline {
  pts: number[]
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

let outlines: Outline[] | null = null
function landOutlines(): Outline[] {
  if (outlines) return outlines
  outlines = LAND.map((pts) => {
    let minLon = 180
    let maxLon = -180
    let minLat = 90
    let maxLat = -90
    for (let i = 0; i < pts.length; i += 2) {
      minLon = Math.min(minLon, pts[i])
      maxLon = Math.max(maxLon, pts[i])
      minLat = Math.min(minLat, pts[i + 1])
      maxLat = Math.max(maxLat, pts[i + 1])
    }
    return { pts, minLon, maxLon, minLat, maxLat }
  })
  return outlines
}

/** Whether a point is on land (roughly: coastlines are simplified to about a third of a degree). */
export function isLand(lat: number, lon: number): boolean {
  for (const o of landOutlines()) {
    if (lat < o.minLat || lat > o.maxLat || lon < o.minLon || lon > o.maxLon) continue
    let inside = false
    const p = o.pts
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i]
      const yi = p[i + 1]
      const xj = p[j]
      const yj = p[j + 1]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return true
  }
  return false
}

export function nearestCity(lat: number, lon: number): { city: City; km: number } {
  let best = CITIES[0]
  let km = Infinity
  for (const c of CITIES) {
    const d = kmBetween(lat, lon, c.lat, c.lon)
    if (d < km) {
      km = d
      best = c
    }
  }
  return { city: best, km }
}

/** Within this many km of a famous city, an area is the city itself. */
export const CITY_KM = 25
/** An area covers about this many km across. Opening a spot closer than this to an area uses that area. */
export const AREA_KM = 12
/** How far a group walks in a day, in km, carrying everything they own. */
export const WALK_KM_PER_DAY = 25

// ---------- the globe ----------

export interface Area {
  id: number
  name: string
  lat: number
  lon: number
  culture: CultureId
  world: SurvivalWorld
}

/** A group on the road between areas. */
export interface Party {
  id: number
  group: Group
  people: Person[]
  from: { lat: number; lon: number; name: string }
  to: { lat: number; lon: number; name: string }
  /** The step they set off on, and the step they'll get there. */
  left: number
  arrives: number
  /** The area they left, so they come back in the right one if they turn round. */
  fromArea: number
}

export interface GlobeLog extends WorldLog {
  area?: number
  lat?: number
  lon?: number
}

export interface Globe {
  seed: number
  harshness: number
  tick: number
  areas: Area[]
  parties: Party[]
  nextArea: number
  log: GlobeLog[]
}

export interface GlobeOptions {
  seed: number
  harshness: number
}

/** The first area is the stretch of country outside Atlanta from stage one. */
export const ATLANTA = { lat: 33.83, lon: -84.62 }

export function createGlobe(opts: GlobeOptions): Globe {
  const g: Globe = { seed: opts.seed | 0, harshness: opts.harshness, tick: 0, areas: [], parties: [], nextArea: 1, log: [] }
  const first = createSurvivalWorld({ seed: opts.seed, harshness: opts.harshness })
  g.areas.push({ id: g.nextArea++, name: 'Outside Atlanta', lat: ATLANTA.lat, lon: ATLANTA.lon, culture: 'us', world: first })
  g.log.push({ tick: 0, text: `Day ${START_DAY} of the outbreak. The world has gone quiet.` })
  return g
}

/** A copy of the globe to rewind to. Maps never change, so they're shared. */
export function snapshotGlobe(g: Globe): Globe {
  return {
    ...g,
    areas: g.areas.map((a) => ({ ...a, world: snapshotSurvival(a.world) })),
    parties: structuredClone(g.parties),
    log: [...g.log]
  }
}

/** Fills in anything a globe saved by an older version doesn't have yet. */
export function upgradeGlobe(g: Globe): Globe {
  g.parties ??= []
  g.log ??= []
  for (const a of g.areas) upgradeSurvival(a.world)
  return g
}

/** Wraps a world saved before the globe existed: it becomes the Atlanta area. */
export function globeFromWorld(w: SurvivalWorld, opts: GlobeOptions): Globe {
  upgradeSurvival(w)
  return {
    seed: opts.seed,
    harshness: w.harshness,
    tick: w.tick,
    areas: [{ id: 1, name: 'Outside Atlanta', lat: ATLANTA.lat, lon: ATLANTA.lon, culture: 'us', world: w }],
    parties: [],
    nextArea: 2,
    log: [{ tick: w.tick, text: 'Carried on from an older save.' }]
  }
}

export const areaById = (g: Globe, id: number): Area | undefined => g.areas.find((a) => a.id === id)

/** The area within reach of a spot, if one's open there. */
export function areaNear(g: Globe, lat: number, lon: number, km = AREA_KM): Area | undefined {
  let best: Area | undefined
  let bd = km
  for (const a of g.areas) {
    const d = kmBetween(lat, lon, a.lat, a.lon)
    if (d < bd) {
      bd = d
      best = a
    }
  }
  return best
}

/** What a spot on the globe would be called, and what it'd be like, before anything's built there. */
export function describeSpot(lat: number, lon: number): { name: string; region: string; culture: CultureId; city: City | null; near: City; km: number } {
  const { city, km } = nearestCity(lat, lon)
  const culture: CultureId = km < 1500 ? city.culture : 'en'
  if (km < CITY_KM) return { name: city.name, region: `${city.name}, ${city.region}`, culture, city, near: city, km }
  const dir = compass(bearing(city.lat, city.lon, lat, lon))
  const name = km < 120 ? `Outside ${city.name}` : `${Math.round(km / 10) * 10} km ${dir} of ${city.name}`
  return { name, region: km < 120 ? `Outside ${city.name}, ${city.region}` : `${name}, ${city.region}`, culture, city: null, near: city, km }
}

function compass(b: number): string {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8]
}

/**
 * Opens (builds) an area at a spot on land, or returns the one already there. Returns null for the
 * sea. Its seed comes from the globe's seed and the spot, so the same place is always the same.
 */
export function openArea(g: Globe, lat: number, lon: number): Area | null {
  const near = areaNear(g, lat, lon)
  if (near) return near
  if (!isLand(lat, lon)) return null
  const spot = describeSpot(lat, lon)
  // Snap to the city's middle, so everyone who opens "Paris" gets the same Paris.
  if (spot.city) {
    const at = areaNear(g, spot.city.lat, spot.city.lon)
    if (at) return at
    lat = spot.city.lat
    lon = spot.city.lon
  }
  const id = g.nextArea++
  const seed = (g.seed * 31 + Math.round(lat * 100) * 7919 + Math.round(lon * 100) * 104729) | 0
  // The road off the map heads for the nearest other city.
  const other = CITIES.filter((c) => c !== spot.city).reduce((a, c) => (kmBetween(lat, lon, c.lat, c.lon) < kmBetween(lat, lon, a.lat, a.lon) ? c : a))
  const world = createSurvivalWorld({
    seed,
    harshness: g.harshness,
    place: {
      region: spot.region,
      culture: spot.culture,
      city: spot.city ? { name: spot.city.name, size: spot.city.size } : undefined,
      exit: `To ${other.name}`,
      idBase: id * 1_000_000,
      tick: g.tick,
      intro: `Day ${dayOfTick(g.tick)} of the outbreak. ${spot.city ? `${spot.city.name} is` : 'The roads here are'} quiet.`
    }
  })
  const area: Area = { id, name: spot.name, lat, lon, culture: spot.culture, world }
  g.areas.push(area)
  g.log.push({ tick: g.tick, text: `${area.name} opened up on the map.`, area: id, lat, lon })
  return area
}

const dayOfTick = (tick: number): number => START_DAY + Math.floor((tick + 8 * 60) / DAY)

/** Whether an area has anything going on (empty areas aren't stepped, just kept on the same clock). */
const busy = (a: Area): boolean => a.world.groups.some((x) => x.alive) || a.world.walkers.length > 0 || a.world.corpses.length > 0

/** Every decision waiting on you, across the whole globe. */
export function pendingCount(g: Globe): number {
  return g.areas.reduce((n, a) => n + a.world.pending.length, 0)
}

// ---------- groups on the move ----------

/** Where a group should walk to leave the map, heading for a far-off spot. */
export function exitToward(area: Area, lat: number, lon: number): { x: number; y: number } {
  const b = rad(bearing(area.lat, area.lon, lat, lon))
  const dx = Math.sin(b)
  const dy = -Math.cos(b)
  // Walk out from the middle until the edge.
  const cx = MAP_W / 2
  const cy = MAP_H / 2
  const t = Math.min(dx ? (dx > 0 ? MAP_W - 2 - cx : cx - 1) / Math.abs(dx) : Infinity, dy ? (dy > 0 ? MAP_H - 2 - cy : cy - 1) / Math.abs(dy) : Infinity)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** Where a group coming from a direction walks onto the map. */
function entryFrom(area: Area, lat: number, lon: number): { x: number; y: number } {
  return exitToward(area, lat, lon)
}

/** Days on the road between two spots, for showing before you send someone. */
export function travelDays(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return kmBetween(lat1, lon1, lat2, lon2) / WALK_KM_PER_DAY
}

/** The groups out on the road right now, with where they are along the way. */
export function partyPosition(g: Globe, p: Party): { lat: number; lon: number; t: number } {
  const t = Math.min(1, Math.max(0, (g.tick - p.left) / Math.max(1, p.arrives - p.left)))
  return { ...along(p.from.lat, p.from.lon, p.to.lat, p.to.lon, t), t }
}

function depart(g: Globe, area: Area, grp: Group): void {
  const to = grp.leaving!
  if (to.lat == null || to.lon == null) return
  const dest = { lat: to.lat, lon: to.lon }
  const { group, people } = takeOutGroup(area.world, grp)
  // Remember what they knew here, in case they come back.
  group.away[area.id] = { seen: group.seen, danger: group.danger, known: group.known, creeks: group.creeks, camp: null }
  const km = kmBetween(area.lat, area.lon, dest.lat, dest.lon)
  const days = km / WALK_KM_PER_DAY
  g.parties.push({
    id: group.id,
    group,
    people,
    from: { lat: area.lat, lon: area.lon, name: area.name },
    to: { lat: dest.lat, lon: dest.lon, name: to.to },
    left: g.tick,
    arrives: g.tick + Math.max(60, Math.round(days * DAY)),
    fromArea: area.id
  })
  g.log.push({ tick: g.tick, text: `${group.name} left ${area.name} on foot for ${to.to}, about ${Math.round(km)} km away.`, group: group.id, lat: area.lat, lon: area.lon })
}

/** Tells a group to set off for a far-off spot on the globe. It walks to the edge of its area first. */
export function sendGroupTo(area: Area, grp: Group, lat: number, lon: number, name: string): void {
  const exit = exitToward(area, lat, lon)
  sendAway(area.world, grp, exit.x, exit.y, name, { lat, lon })
}

function arrive(g: Globe, p: Party): void {
  g.parties = g.parties.filter((x) => x !== p)
  const area = openArea(g, p.to.lat, p.to.lon) ?? areaById(g, p.fromArea)
  if (!area) return
  // Days on the road: what they carried ran down, and it wore on them.
  const days = (p.arrives - p.left) / DAY
  const n = Math.max(1, p.people.length)
  const food = Math.min(p.group.stash.food, Math.round(days * n))
  const water = Math.min(p.group.stash.water, Math.round(days * n))
  p.group.stash.food -= food
  p.group.stash.water -= water
  const short = days * n - Math.min(food, water)
  for (const q of p.people) {
    q.hunger = Math.min(95, q.hunger + (short > 0 ? 40 : 10))
    q.thirst = Math.min(95, q.thirst + (short > 0 ? 40 : 10))
    q.fatigue = Math.min(100, q.fatigue + 30)
    q.age += Math.floor((dayOfTick(g.tick) - START_DAY) / 365) - Math.floor((dayOfTick(p.left) - START_DAY) / 365)
  }
  // Knowledge of this area, if they've been here before.
  const mem = p.group.away[area.id]
  if (mem) {
    p.group.seen = mem.seen
    p.group.danger = mem.danger
    p.group.known = mem.known
    p.group.creeks = mem.creeks
    delete p.group.away[area.id]
  } else {
    p.group.seen = new Int32Array(p.group.seen.length).fill(-1)
    p.group.danger = new Uint16Array(p.group.danger.length)
    p.group.known = {}
    p.group.creeks = []
  }
  const at = entryFrom(area, p.from.lat, p.from.lon)
  bringInGroup(area.world, p.group, p.people, at.x, at.y, p.from.name)
  g.log.push({ tick: g.tick, text: `${p.group.name} reached ${area.name}${short > 0 ? ', hungry and thirsty' : ''}.`, group: p.group.id, area: area.id, lat: area.lat, lon: area.lon })
}

/** Turns a party on the road around, back to where they came from. */
export function turnBack(g: Globe, p: Party): void {
  const here = partyPosition(g, p)
  const back = { ...p.from }
  p.from = { lat: here.lat, lon: here.lon, name: 'the road' }
  p.to = back
  const km = kmBetween(here.lat, here.lon, back.lat, back.lon)
  p.left = g.tick
  p.arrives = g.tick + Math.max(30, Math.round((km / WALK_KM_PER_DAY) * DAY))
  g.log.push({ tick: g.tick, text: `${p.group.name} turned back for ${back.name}.`, group: p.group.id })
}

// ---------- one step (one minute) everywhere ----------

export function stepGlobe(g: Globe): void {
  if (pendingCount(g)) return
  g.tick++
  for (const a of g.areas) {
    const w = a.world
    if (busy(a)) {
      while (w.tick < g.tick - 1) w.tick++ // An area that was empty catches up on the clock.
      stepSurvival(w)
      for (const grp of [...w.groups]) {
        if (grp.leaving && readyToLeave(w, grp)) depart(g, a, grp)
      }
    } else w.tick = g.tick
  }
  for (const p of [...g.parties]) {
    // Everyone on the road dead or gone: nothing arrives.
    if (!p.people.length) g.parties = g.parties.filter((x) => x !== p)
    else if (g.tick >= p.arrives) arrive(g, p)
  }
}

/** Every group anywhere: in an area, or on the road. */
export function allGroups(g: Globe): { group: Group; area: Area | null; party: Party | null; people: number }[] {
  const out: { group: Group; area: Area | null; party: Party | null; people: number }[] = []
  for (const a of g.areas) for (const grp of a.world.groups) if (grp.alive) out.push({ group: grp, area: a, party: null, people: membersOf(a.world, grp).length })
  for (const p of g.parties) out.push({ group: p.group, area: null, party: p, people: p.people.filter((q) => !q.held).length })
  return out
}

export { cultureOf }
