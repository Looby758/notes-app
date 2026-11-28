/**
 * Evolution Lab, survival mode: the simulation itself, with no drawing in it, so it can be tested
 * and run anywhere.
 *
 * It starts about a month into a walker outbreak in a made-up stretch of country outside Atlanta.
 * You place survivor groups, raiders, walkers, herds, supplies and noise wherever you like; the
 * people then run themselves. Each group picks a camp, plans its days, scavenges, eats, sleeps,
 * fights or runs, and learns lessons from what happens to it, good ones and bad ones, which change
 * how it behaves from then on. Each group only knows what its people have seen, and a scout's
 * discoveries only reach the others when the scout gets back.
 *
 * One step is one minute of in-game time, so a day is 1,440 steps. Everything runs off a seeded
 * random number generator kept in the world, so a copy of the world (`snapshotSurvival`) can be
 * restored to rewind.
 */

import { cultureOf, type CultureId } from './cultures'

// ---------- time ----------

export const DAY = 1440
/** Day 1 of the outbreak was about a month before the world starts. */
export const START_DAY = 30
/** The world starts at 8 in the morning. */
const START_MINUTE = 8 * 60
/** Steps a second at 1× speed: one real minute is one in-game day. */
export const SURVIVAL_STEPS_PER_SECOND = DAY / 60

export function minuteOfDay(tick: number): number {
  return (tick + START_MINUTE) % DAY
}

export function dayOf(tick: number): number {
  return START_DAY + Math.floor((tick + START_MINUTE) / DAY)
}

export function clockText(tick: number): string {
  const m = minuteOfDay(tick)
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function partOfDay(tick: number): string {
  const h = minuteOfDay(tick) / 60
  if (h < 5) return 'Night'
  if (h < 7) return 'Dawn'
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  if (h < 20) return 'Evening'
  return 'Night'
}

/** How dark it is, from 0 (full day) to 1 (middle of the night). */
export function darkness(tick: number): number {
  const h = minuteOfDay(tick) / 60
  if (h >= 7 && h <= 19) return 0
  if (h > 19 && h < 21) return (h - 19) / 2
  if (h > 5 && h < 7) return (7 - h) / 2
  return 1
}

function isNight(tick: number): boolean {
  return darkness(tick) > 0.6
}

// ---------- the map ----------

export const MAP_W = 240
export const MAP_H = 160
/** Fog of war is kept in squares of this many tiles. */
export const CELL = 4
export const CELLS_X = MAP_W / CELL
export const CELLS_Y = MAP_H / CELL

export const TILE = { grass: 0, forest: 1, road: 2, lot: 3, field: 4, creek: 5 } as const

export interface Town {
  name: string
  x: number
  y: number
  r: number
}

export interface MapData {
  seed: number
  region: string
  tiles: Uint8Array
  towns: Town[]
  /** Where the main road leaves the map, and where it goes. */
  exits: { x: number; y: number; label: string }[]
  /** Whose names and words the area uses (American by default). */
  culture?: CultureId
}

export type BuildingKind = 'house' | 'store' | 'pharmacy' | 'gas' | 'police' | 'school' | 'church' | 'warehouse' | 'farm' | 'cache'

export interface Supplies {
  food: number
  water: number
  ammo: number
  meds: number
  parts: number
}

export const SUPPLY_KEYS: (keyof Supplies)[] = ['food', 'water', 'ammo', 'meds', 'parts']
export const SUPPLY_LABEL: Record<keyof Supplies, string> = { food: 'food', water: 'water', ammo: 'ammo', meds: 'medicine', parts: 'building materials' }

export interface Building {
  id: number
  kind: BuildingKind
  name: string
  town: string | null
  x: number
  y: number
  w: number
  h: number
  loot: Supplies
  /** How well it's barricaded, 0 to 100. Walkers have to break this down to get in. */
  fort: number
}

export const BUILDING_LABEL: Record<BuildingKind, string> = {
  house: 'House',
  store: 'Grocery store',
  pharmacy: 'Pharmacy',
  gas: 'Gas station',
  police: 'Police station',
  school: 'School',
  church: 'Church',
  warehouse: 'Warehouse',
  farm: 'Farmhouse',
  cache: 'Supply stash'
}

// ---------- people ----------

export type Trait = 'brave' | 'cautious' | 'kind' | 'selfish' | 'loyal' | 'hothead' | 'paranoid' | 'steady' | 'leader' | 'optimist'
export const TRAITS: { id: Trait; label: string; hint: string }[] = [
  { id: 'brave', label: 'Brave', hint: 'Stands and fights when others would run' },
  { id: 'cautious', label: 'Cautious', hint: 'Runs early, likes company on runs' },
  { id: 'kind', label: 'Kind', hint: 'Wants to help strangers, hates putting people down' },
  { id: 'selfish', label: 'Selfish', hint: 'Looks after themself first' },
  { id: 'loyal', label: 'Loyal', hint: 'Sticks by their people no matter what' },
  { id: 'hothead', label: 'Hothead', hint: 'Quick to pull a trigger and pick a fight' },
  { id: 'paranoid', label: 'Paranoid', hint: "Doesn't trust outsiders" },
  { id: 'steady', label: 'Steady', hint: 'Keeps a cool head when things go wrong' },
  { id: 'leader', label: 'Natural leader', hint: 'People listen to them' },
  { id: 'optimist', label: 'Optimist', hint: 'Keeps spirits up' }
]

export type Skill = 'shooting' | 'fighting' | 'medicine' | 'scavenging' | 'building' | 'leadership'
export const SKILLS: { id: Skill; label: string }[] = [
  { id: 'shooting', label: 'Shooting' },
  { id: 'fighting', label: 'Close fighting' },
  { id: 'medicine', label: 'Medicine' },
  { id: 'scavenging', label: 'Scavenging' },
  { id: 'building', label: 'Building' },
  { id: 'leadership', label: 'Leadership' }
]

export type Weapon = 'none' | 'knife' | 'bat' | 'machete' | 'pistol' | 'rifle' | 'shotgun' | 'crossbow'
export const WEAPONS: { id: Weapon; label: string; gun: boolean; melee: number }[] = [
  { id: 'none', label: 'Bare hands', gun: false, melee: 0 },
  { id: 'knife', label: 'Knife', gun: false, melee: 0.1 },
  { id: 'bat', label: 'Bat', gun: false, melee: 0.08 },
  { id: 'machete', label: 'Machete', gun: false, melee: 0.15 },
  { id: 'crossbow', label: 'Crossbow (quiet)', gun: false, melee: 0.1 },
  { id: 'pistol', label: 'Pistol', gun: true, melee: 0.05 },
  { id: 'rifle', label: 'Rifle', gun: true, melee: 0.05 },
  { id: 'shotgun', label: 'Shotgun', gun: true, melee: 0.05 }
]
const weaponInfo = (w: Weapon) => WEAPONS.find((x) => x.id === w) ?? WEAPONS[0]

export type TaskKind = 'camp' | 'sleep' | 'rest' | 'guard' | 'scavenge' | 'explore' | 'fortify' | 'hunt' | 'water' | 'follow' | 'move'

export interface Task {
  kind: TaskKind
  phase: 'go' | 'work' | 'back'
  x: number
  y: number
  building?: number
  /** The step the current work finishes. */
  until?: number
  /** Who they're with (for teams and following the leader). */
  with?: number[]
}

export interface Bite {
  at: number
  limb: 'arm' | 'leg' | 'neck'
  /** The step they'll die and turn, if nothing is done. */
  turnsAt: number
  /** Cutting the limb off only works before this step. */
  cutBy: number
  asked?: boolean
}

export interface LogLine {
  tick: number
  text: string
}

export type Sex = 'f' | 'm'

export interface Person {
  id: number
  name: string
  age: number
  sex: Sex
  /** Their partner's id, if they're together with someone. */
  partner: number | null
  /** Parents, children, brothers and sisters, by id (living or not). */
  family: number[]
  /** Held prisoner: `group` is then the captors, and `from` the group they were taken from. */
  held: { from: number; since: number } | null
  /** Expecting a baby, due at this step (0 if not). */
  dueAt: number
  group: number
  x: number
  y: number
  traits: Trait[]
  skills: Record<Skill, number>
  weapon: Weapon
  ammo: number
  /** 0 to 100. */
  health: number
  /** 0 (full) to 100 (starving). */
  hunger: number
  thirst: number
  fatigue: number
  /** 0 to 100. */
  morale: number
  /** Steps of grief left after losing someone close. */
  grief: number
  bitten: Bite | null
  lostLimb: string | null
  task: Task
  asleep: boolean
  /** Running away until this step. */
  fleeUntil: number
  fleeX: number
  fleeY: number
  /** When they last wrote down that they ran (so the story isn't all running). */
  lastFled: number
  carry: Supplies
  /** How they feel about others, by person id: -100 to 100. */
  rel: Record<number, number>
  kills: number
  joined: number
  log: LogLine[]
  /** What they've found while away, which the rest of the group learns when they get back. */
  pending: { cells: Record<number, number>; buildings: number[]; danger: Record<number, number>; creek?: number }
}

export interface Fallen {
  id: number
  name: string
  group: number
  groupName: string
  tick: number
  cause: string
  log: LogLine[]
  age: number
}

// ---------- groups ----------

export type LessonId = 'pairs' | 'fortify' | 'stockpile' | 'quiet' | 'watch' | 'bitten' | 'distrust' | 'welcome' | 'trigger' | 'hide'

export const LESSONS: Record<LessonId, { title: string; effect: string; good: boolean }> = {
  pairs: { title: 'Never go out alone', effect: 'Scavengers always go out in pairs or more.', good: true },
  fortify: { title: 'Walls keep you alive', effect: 'Spends more time and materials barricading camp.', good: true },
  stockpile: { title: 'Always keep a stockpile', effect: 'Goes after food and water first and keeps days of it spare.', good: true },
  quiet: { title: 'Gunshots bring the dead', effect: 'Fights with blades where it can and keeps camp dark at night.', good: true },
  watch: { title: 'Someone always keeps watch', effect: 'Keeps a guard awake every night.', good: true },
  bitten: { title: "Don't wait on the bitten", effect: 'Cuts off a bitten limb straight away, and puts the dying down before they turn.', good: true },
  distrust: { title: 'Outsiders are a threat', effect: 'Turns strangers away or attacks them. Never lets anyone join.', good: false },
  welcome: { title: 'There is strength in numbers', effect: 'Invites strangers in.', good: true },
  trigger: { title: 'Guns solve problems', effect: 'Reaches for a gun first, which is loud.', good: false },
  hide: { title: "It's not safe out there", effect: 'Sends fewer people out, even when supplies run low.', good: false }
}

export interface Lesson {
  id: LessonId
  tick: number
  why: string
}

export type DecideStyle = 'leader' | 'vote' | 'council'
export const DECIDE_STYLES: { id: DecideStyle; label: string }[] = [
  { id: 'leader', label: 'A leader decides' },
  { id: 'vote', label: 'They vote' },
  { id: 'council', label: 'They talk it over' }
]

export type OrderKind = 'stay' | 'scavenge' | 'explore' | 'move' | 'fortify' | 'hunt' | 'water'

export interface Order {
  kind: OrderKind
  x?: number
  y?: number
  building?: number
}

export type Relation = 'ally' | 'avoid' | 'enemy'

export interface AreaMemory {
  seen: Int32Array
  danger: Uint16Array
  known: Record<number, { tick: number; loot: Supplies | null }>
  creeks: number[]
  camp: number | null
}

export interface Group {
  id: number
  name: string
  color: string
  /** Raiders: they rob or attack anyone they meet. */
  hostile: boolean
  /** Stop and ask you before big choices. */
  ask: boolean
  decide: DecideStyle
  leader: number | null
  camp: number | null
  /** Where they're based: the camp's middle, or where they were placed. */
  homeX: number
  homeY: number
  stash: Supplies
  /** For each fog square, the last step someone in the group saw it, or -1 for never. */
  seen: Int32Array
  /** For each fog square, how many walkers were there when it was last seen. */
  danger: Uint16Array
  /** Buildings the group knows about, with what's left in them if someone has searched it. */
  known: Record<number, { tick: number; loot: Supplies | null }>
  /** Fog squares with a creek (water) in them that the group knows about. */
  creeks: number[]
  lessons: Lesson[]
  met: Record<number, Relation>
  /** The step they last fought each other group. */
  fought: Record<number, number>
  order: Order | null
  /** Heading off the map for somewhere far away: everyone walks to (x, y) at the edge. */
  leaving: { x: number; y: number; to: string; lat?: number; lon?: number } | null
  /** What they knew about other areas they've been in, by area id, for when they go back. */
  away: Record<number, AreaMemory>
  created: number
  peak: number
  alive: boolean
  /** Walkers drawn in by this group's noise lately, to learn from. */
  noiseDrew: number
  noiseWho: string
  gunKillsToday: number
  lossesToday: number
}

// ---------- walkers ----------

export interface Walker {
  id: number
  x: number
  y: number
  tx: number
  ty: number
  /** The person it's chasing. */
  chase: number | null
  herd: number | null
  /** Who it was, if it was someone we knew. */
  was?: string
  /** Busy going somewhere (noise, light, following) until this step. */
  busyUntil: number
}

export interface Herd {
  id: number
  x: number
  y: number
  tx: number
  ty: number
}

export interface Corpse {
  x: number
  y: number
  turnsAt: number
  name: string
  person: number
  group: number
}

export interface Noise {
  x: number
  y: number
  r: number
  until: number
}

/** Two groups fighting it out, in one place, for a while. */
export interface Fight {
  id: number
  a: number
  b: number
  x: number
  y: number
  started: number
  /** It's over by this step at the latest. */
  until: number
  /** Deaths on each side. */
  deadA: number
  deadB: number
  /** People taken prisoner during it. */
  taken: number[]
  /** People who got out of it (ran, or kids sent away). */
  out: number[]
}

/** A shot, drawn for a moment. */
export interface Shot {
  x1: number
  y1: number
  x2: number
  y2: number
  until: number
  hit: boolean
}

export interface WorldLog {
  tick: number
  text: string
  group?: number
  people?: number[]
  /** A big moment worth a pop-up. */
  big?: boolean
}

export interface DecisionOption {
  id: string
  label: string
  hint: string
}

export interface Decision {
  id: number
  group: number
  kind: 'bite' | 'meet' | 'robbed' | 'camp' | 'prisoner'
  title: string
  text: string
  options: DecisionOption[]
  /** What the group would pick on its own. */
  auto: string
  data: Record<string, number | string>
}

export interface SurvivalWorld {
  map: MapData
  tick: number
  rng: number
  nextId: number
  /** 0 (forgiving) to 1 (brutal). */
  harshness: number
  buildings: Building[]
  groups: Group[]
  people: Person[]
  fallen: Fallen[]
  walkers: Walker[]
  herds: Herd[]
  corpses: Corpse[]
  noises: Noise[]
  log: WorldLog[]
  /** Choices waiting for you. The world doesn't move until they're answered. */
  pending: Decision[]
  /** When two groups meet and only one asks you, what the other one already chose ("a:b" → choice). */
  waiting: Record<string, string>
  fights: Fight[]
  shots: Shot[]
}

// ---------- random numbers ----------

function random(w: { rng: number }): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (w: { rng: number }, a: number, b: number): number => a + random(w) * (b - a)
const int = (w: { rng: number }, a: number, b: number): number => Math.floor(between(w, a, b + 1))
const pick = <T>(w: { rng: number }, list: readonly T[]): T => list[Math.floor(random(w) * list.length)]
const chance = (w: { rng: number }, p: number): boolean => random(w) < p
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by)

const FIRST_F = [
  'Maggie', 'Carol', 'Michonne', 'Tara', 'Rosita', 'Sasha', 'Beth', 'Andrea', 'Amy', 'Lori', 'Nora', 'Priya', 'Elena',
  'Hannah', 'Grace', 'Ivy', 'Dana', 'Rhea', 'June', 'Tess', 'Lena', 'Mae', 'Nina', 'Bea', 'Ada', 'Lucy', 'Paige',
  'Wendy', 'Kara', 'Della', 'Sam', 'Rose', 'Clara', 'Josie', 'Maya'
]
const FIRST_M = [
  'Rick', 'Glenn', 'Daryl', 'Abraham', 'Eugene', 'Aaron', 'Tyreese', 'Hershel', 'Dale', 'Shane', 'Morgan', 'Jesus',
  'Ezekiel', 'Jerry', 'Owen', 'Marcus', 'Jamal', 'Luis', 'Theo', 'Caleb', 'Wes', 'Omar', 'Felix', 'Ray', 'Hank', 'Cole',
  'Victor', 'Reggie', 'Darnell', 'Gus', 'Eli', 'Boone', 'Sam', 'Noah', 'Jack'
]
const LAST = [
  'Walsh', 'Dixon', 'Greene', 'Porter', 'Hale', 'Monroe', 'Reyes', 'Tate', 'Brooks', 'Vance', 'Carver', 'Mercer',
  'Holt', 'Bishop', 'Shaw', 'Fuller', 'Pryor', 'Lyle', 'Booker', 'Caine', 'Dunn', 'Ellis', 'Foster', 'Gaines',
  'Harmon', 'Ingram', 'Jett', 'Keller', 'Lowry', 'Mays', 'Nash', 'Odom', 'Pike', 'Quinn', 'Rowe', 'Sutter', 'Toomey'
]
const TOWN_NAMES = ['Harlow Springs', 'Cedar Ford', 'Millbrook', 'Pine Hollow', 'Ashby', 'Wrens Mill', 'Laurel Creek', 'Greer Crossing']
export const GROUP_COLORS = ['#4fd1a5', '#f6ad55', '#63b3ed', '#f687b3', '#b794f4', '#f6e05e', '#68d391', '#fc8181']

// ---------- building the map ----------

function setTile(tiles: Uint8Array, x: number, y: number, t: number): void {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return
  tiles[y * MAP_W + x] = t
}

export function tileAt(map: MapData, x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  if (ix < 0 || iy < 0 || ix >= MAP_W || iy >= MAP_H) return TILE.grass
  return map.tiles[iy * MAP_W + ix]
}

function road(tiles: Uint8Array, ax: number, ay: number, bx: number, by: number, width = 2): void {
  // An L-shaped road: across, then up or down.
  const sx = Math.sign(bx - ax) || 1
  for (let x = ax; x !== bx + sx; x += sx) for (let k = 0; k < width; k++) setTile(tiles, x, ay + k, TILE.road)
  const sy = Math.sign(by - ay) || 1
  for (let y = ay; y !== by + sy; y += sy) for (let k = 0; k < width; k++) setTile(tiles, bx + k, y, TILE.road)
}

function lootFor(w: { rng: number }, kind: BuildingKind, area: number, plenty: number): Supplies {
  const s = (a: number, b: number) => Math.round(between(w, a, b) * plenty)
  const big = Math.max(1, area / 16)
  switch (kind) {
    case 'house':
      return { food: s(0, 6), water: s(0, 5), ammo: chance(w, 0.2) ? s(2, 12) : 0, meds: s(0, 2), parts: s(1, 5) }
    case 'farm':
      return { food: s(3, 14), water: s(2, 8), ammo: chance(w, 0.5) ? s(4, 20) : 0, meds: s(0, 2), parts: s(3, 10) }
    case 'store':
      return { food: s(10, 40) * big, water: s(8, 30) * big, ammo: 0, meds: s(0, 4), parts: s(1, 4) }
    case 'pharmacy':
      return { food: s(1, 6), water: s(2, 8), ammo: 0, meds: s(10, 30), parts: s(0, 2) }
    case 'gas':
      return { food: s(3, 12), water: s(4, 14), ammo: 0, meds: s(0, 2), parts: s(2, 6) }
    case 'police':
      return { food: s(2, 8), water: s(2, 8), ammo: s(30, 120), meds: s(2, 8), parts: s(2, 6) }
    case 'school':
      return { food: s(6, 24), water: s(6, 20), ammo: 0, meds: s(2, 8), parts: s(4, 12) }
    case 'church':
      return { food: s(4, 14), water: s(4, 12), ammo: 0, meds: s(1, 4), parts: s(2, 8) }
    case 'warehouse':
      return { food: s(10, 50), water: s(10, 30), ammo: chance(w, 0.3) ? s(10, 40) : 0, meds: s(0, 6), parts: s(10, 30) }
    case 'cache':
      return { food: 20, water: 20, ammo: 30, meds: 8, parts: 10 }
  }
}

function overlaps(list: Building[], x: number, y: number, w: number, h: number): boolean {
  return list.some((b) => x < b.x + b.w + 1 && x + w + 1 > b.x && y < b.y + b.h + 1 && y + h + 1 > b.y)
}

function areaClear(tiles: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  if (x < 1 || y < 1 || x + w >= MAP_W - 1 || y + h >= MAP_H - 1) return false
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (tiles[j * MAP_W + i] === TILE.road || tiles[j * MAP_W + i] === TILE.creek) return false
  return true
}

export interface SurvivalOptions {
  seed: number
  harshness: number
  /** Where on the globe this area is. Left out, it's the stretch of country outside Atlanta. */
  place?: AreaPlace
}

export interface AreaPlace {
  /** Shown at the top of the map, like "Outside Paris, France". */
  region: string
  culture: CultureId
  /** A famous city the area is in: the biggest town is the city itself. */
  city?: { name: string; size: 1 | 2 | 3 }
  /** Where the highway off the map goes, like "To Lyon". */
  exit: string
  /** Every id in this area starts here, so people and groups stay unique across the globe. */
  idBase: number
  /** The step the area starts on (the globe's clock). */
  tick: number
  /** The first line of its log. */
  intro: string
}

export function createSurvivalWorld(opts: SurvivalOptions): SurvivalWorld {
  const r = { rng: opts.seed | 0 }
  const tiles = new Uint8Array(MAP_W * MAP_H)
  // A month in, most places have already been picked over.
  const plenty = 0.75 - clamp(opts.harshness, 0, 1) * 0.45

  // Woods: overlapping round patches.
  for (let i = 0; i < 46; i++) {
    const cx = between(r, 0, MAP_W)
    const cy = between(r, 0, MAP_H)
    const rad = between(r, 5, 18)
    for (let y = Math.floor(cy - rad); y < cy + rad; y++)
      for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
        const d = dist(x, y, cx, cy) / rad
        if (d < 1 - random(r) * 0.25) setTile(tiles, x, y, TILE.forest)
      }
  }

  // A creek winding from top to bottom: the one place with endless (if dirty) water.
  let cx = between(r, 90, 150)
  for (let y = 0; y < MAP_H; y++) {
    cx += between(r, -1.2, 1.2)
    for (let k = 0; k < 2; k++) setTile(tiles, Math.round(cx) + k, y, TILE.creek)
  }

  // Towns.
  const place = opts.place
  const culture = place ? cultureOf(place.culture) : null
  const names = [...(culture ? culture.towns : TOWN_NAMES)]
  const takeName = () => names.splice(Math.floor(random(r) * names.length), 1)[0]
  const big = place?.city ? 24 + place.city.size * 4 : 24
  const towns: Town[] = [
    { name: place?.city ? place.city.name : takeName(), x: Math.round(between(r, big + 12, big + 30)), y: Math.round(between(r, 35, 55)), r: big },
    { name: takeName(), x: Math.round(between(r, 170, 200)), y: Math.round(between(r, 35, 60)), r: 18 },
    { name: takeName(), x: Math.round(between(r, 100, 140)), y: Math.round(between(r, 110, 128)), r: 16 }
  ]

  // Highways between the towns, and one off the map toward Atlanta.
  road(tiles, towns[0].x, towns[0].y, towns[1].x, towns[1].y, 2)
  road(tiles, towns[1].x, towns[1].y, towns[2].x, towns[2].y, 2)
  road(tiles, towns[2].x, towns[2].y, towns[0].x, towns[0].y, 2)
  const exitY = Math.round(between(r, 70, 100))
  road(tiles, towns[1].x, exitY, MAP_W - 1, exitY, 2)
  road(tiles, towns[1].x, towns[1].y, towns[1].x, exitY, 2)
  const exits = [{ x: MAP_W - 2, y: exitY, label: place ? place.exit : 'To Atlanta' }]

  // Each town: a grid of streets, cleared of trees, with buildings in the blocks.
  const buildings: Building[] = []
  let nextId = (place?.idBase ?? 0) + 1
  const add = (kind: BuildingKind, name: string, town: string | null, x: number, y: number, bw: number, bh: number): Building | null => {
    if (!areaClear(tiles, x, y, bw, bh) || overlaps(buildings, x, y, bw, bh)) return null
    const b: Building = { id: nextId++, kind, name, town, x, y, w: bw, h: bh, loot: lootFor(r, kind, bw * bh, plenty), fort: kind === 'police' ? 15 : 0 }
    for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) setTile(tiles, i, j, TILE.lot)
    buildings.push(b)
    return b
  }
  const surnames = [...(culture ? culture.last : LAST)]
  const word = (kind: Parameters<NonNullable<typeof culture>['building']>[0], t: string): string => culture!.building(kind, t, () => random(r))
  const surname = () => pick(r, surnames)

  towns.forEach((t, ti) => {
    for (let y = t.y - t.r; y < t.y + t.r; y++)
      for (let x = t.x - t.r; x < t.x + t.r; x++) if (dist(x, y, t.x, t.y) < t.r && tiles[y * MAP_W + x] === TILE.forest) setTile(tiles, x, y, TILE.grass)
    const gap = 11
    for (let k = -2; k <= 2; k++) {
      const yy = t.y + k * gap
      const half = Math.round(Math.sqrt(Math.max(0, t.r * t.r - (k * gap) ** 2)))
      if (half > 4) road(tiles, t.x - half, yy, t.x + half, yy, 1)
      const xx = t.x + k * gap
      if (half > 4) road(tiles, xx, t.y - half, xx, t.y + half, 1)
    }
    // The town's main buildings go near the middle; the biggest town gets all of them.
    const specials: [BuildingKind, string, number, number][] = culture
      ? [
          ['store', word('store', t.name), 8, 6],
          ['pharmacy', word('pharmacy', t.name), 5, 4],
          ['police', word('police', t.name), 7, 5],
          ['church', word('church', t.name), 6, 6],
          ['school', word('school', t.name), 10, 7],
          ['warehouse', word('warehouse', t.name), 10, 7]
        ]
      : [
          ['store', `${t.name} Grocery`, 8, 6],
          ['pharmacy', `${t.name} Pharmacy`, 5, 4],
          ['police', `${t.name} Police Station`, 7, 5],
          ['church', `${pick(r, ['First Baptist', 'St. Mark’s', 'Grace Methodist', 'Calvary'])} Church`, 6, 6],
          ['school', `${t.name} ${pick(r, ['High School', 'Elementary', 'Middle School'])}`, 10, 7],
          ['warehouse', `${t.name} ${pick(r, ['Feed & Supply', 'Lumber Yard', 'Distribution Center'])}`, 10, 7]
        ]
    // A big city gets a second set of the big buildings in another part of town.
    if (ti === 0 && place?.city && place.city.size >= 2)
      for (const [kind, , bw, bh] of specials.slice(0, 4)) specials.push([kind, culture ? word(kind as 'store', `${t.name} ${pick(r, ['East', 'West', 'North', 'South'])}`) : `${t.name} ${kind}`, bw, bh])
    const wanted = ti === 0 ? specials : specials.filter((_, i) => i < 4 || chance(r, 0.5))
    for (const [kind, name, bw, bh] of wanted) {
      for (let tries = 0; tries < 60; tries++) {
        const a = random(r) * Math.PI * 2
        const d = between(r, 2, t.r * 0.75)
        if (add(kind, name, t.name, Math.round(t.x + Math.cos(a) * d), Math.round(t.y + Math.sin(a) * d), bw, bh)) break
      }
    }
    const houses = Math.round(t.r * (ti === 0 && place?.city ? 2.6 : 1.6))
    for (let i = 0, tries = 0; i < houses && tries < 600; tries++) {
      const a = random(r) * Math.PI * 2
      const d = Math.sqrt(random(r)) * t.r
      const bw = int(r, 3, 5)
      const bh = int(r, 3, 4)
      if (add('house', culture ? word('house', surname()) : `${surname()} house`, t.name, Math.round(t.x + Math.cos(a) * d), Math.round(t.y + Math.sin(a) * d), bw, bh)) i++
    }
  })

  // Gas stations on the highways, and farms out in the country with fields around them.
  for (let i = 0, tries = 0; i < 3 && tries < 400; tries++) {
    const x = int(r, 10, MAP_W - 10)
    const y = int(r, 10, MAP_H - 10)
    if (tiles[y * MAP_W + x] !== TILE.road) continue
    if (towns.some((t) => dist(x, y, t.x, t.y) < t.r + 6)) continue
    if (add('gas', culture ? word('gas', '') : `${pick(r, ['Route 9', 'Hwy 41', 'Crossroads', 'Old Mill'])} Gas`, null, x + 3, y + 3, 5, 4)) i++
  }
  for (let i = 0, tries = 0; i < 9 && tries < 600; tries++) {
    const x = int(r, 8, MAP_W - 14)
    const y = int(r, 8, MAP_H - 12)
    if (towns.some((t) => dist(x, y, t.x, t.y) < t.r + 8)) continue
    const name = culture ? word('farm', surname()) : `${surname()} farm`
    const fx = x - 6
    const fy = y + 5
    const b = add('farm', name, null, x, y, 5, 4)
    if (!b) continue
    for (let j = fy; j < fy + 8; j++) for (let k = fx; k < fx + 16; k++) if (tiles[j * MAP_W + k] === TILE.grass || tiles[j * MAP_W + k] === TILE.forest) setTile(tiles, k, j, TILE.field)
    // A dirt track to the nearest highway.
    let best = { x, y: y + 2, d: Infinity }
    for (let j = 0; j < MAP_H; j += 2)
      for (let k = 0; k < MAP_W; k += 2)
        if (tiles[j * MAP_W + k] === TILE.road) {
          const d = dist(k, j, x, y)
          if (d < best.d) best = { x: k, y: j, d }
        }
    if (best.d < 60) road(tiles, x + 2, y + 4, best.x, best.y, 1)
    i++
  }

  return {
    map: { seed: opts.seed, region: place ? place.region : 'Outside Atlanta, Georgia', tiles, towns, exits, culture: place?.culture },
    tick: place?.tick ?? 0,
    rng: (opts.seed * 7919 + 17) | 0,
    nextId,
    harshness: clamp(opts.harshness, 0, 1),
    buildings,
    groups: [],
    people: [],
    fallen: [],
    walkers: [],
    herds: [],
    corpses: [],
    noises: [],
    log: [{ tick: place?.tick ?? 0, text: place ? place.intro : `Day ${START_DAY} of the outbreak. The roads outside Atlanta are quiet.` }],
    pending: [],
    waiting: {},
    fights: [],
    shots: []
  }
}

/** A copy of the world to rewind to. The map never changes, so it's shared. */
export function snapshotSurvival(w: SurvivalWorld): SurvivalWorld {
  const { map, ...rest } = w
  return { ...structuredClone(rest), map }
}

/** Fills in anything a world saved by an older version doesn't have yet, so old saves still load. */
export function upgradeSurvival(w: SurvivalWorld): SurvivalWorld {
  w.fights ??= []
  w.shots ??= []
  for (const g of w.groups) {
    g.leaving ??= null
    g.away ??= {}
  }
  for (const f of w.fights) f.out ??= []
  for (const p of w.people) {
    p.sex ??= p.id % 2 ? 'm' : 'f'
    p.partner ??= null
    p.family ??= []
    p.held ??= null
    p.dueAt ??= 0
  }
  return w
}

// ---------- looking things up ----------

export const cellOf = (x: number, y: number): number => clamp(Math.floor(y / CELL), 0, CELLS_Y - 1) * CELLS_X + clamp(Math.floor(x / CELL), 0, CELLS_X - 1)

export function buildingAt(w: SurvivalWorld, x: number, y: number, pad = 0): Building | undefined {
  return w.buildings.find((b) => x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad)
}

export const groupById = (w: SurvivalWorld, id: number): Group | undefined => w.groups.find((g) => g.id === id)
export const personById = (w: SurvivalWorld, id: number): Person | undefined => w.people.find((p) => p.id === id)
const buildingById = (w: SurvivalWorld, id: number | null | undefined): Building | undefined => (id == null ? undefined : w.buildings.find((b) => b.id === id))
/** A group's own people (not counting anyone they're holding prisoner). */
export const membersOf = (w: SurvivalWorld, g: Group): Person[] => w.people.filter((p) => p.group === g.id && !p.held)
/** People a group is holding prisoner. */
export const prisonersOf = (w: SurvivalWorld, g: Group): Person[] => w.people.filter((p) => p.group === g.id && p.held)
export const campOf = (w: SurvivalWorld, g: Group): Building | undefined => buildingById(w, g.camp)
export const hasLesson = (g: Group, id: LessonId): boolean => g.lessons.some((l) => l.id === id)
const has = (p: Person, t: Trait): boolean => p.traits.includes(t)
const isKid = (p: Person): boolean => p.age < 14

function inside(b: Building, x: number, y: number, pad = 0): boolean {
  return x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad
}

function campSpot(w: SurvivalWorld, b: Building): { x: number; y: number } {
  return { x: b.x + 0.5 + random(w) * (b.w - 1), y: b.y + 0.5 + random(w) * (b.h - 1) }
}

export function isAtCamp(w: SurvivalWorld, p: Person): boolean {
  const g = groupById(w, p.group)
  const c = g && campOf(w, g)
  return c ? inside(c, p.x, p.y, 0.5) : !!g && dist(p.x, p.y, g.homeX, g.homeY) < 6
}

/** What a person is doing right now, in words. */
export function doingText(w: SurvivalWorld, p: Person): string {
  if (p.held) return `Held prisoner by ${groupById(w, p.group)?.name ?? 'another group'}`
  const f = fightFor(w, p)
  if (f) return `Fighting ${groupById(w, f.a === p.group ? f.b : f.a)?.name ?? 'another group'}`
  if (p.asleep) return 'Asleep'
  if (p.fleeUntil > w.tick) return 'Running from walkers'
  const b = buildingById(w, p.task.building)
  const where = b ? b.name : 'the area'
  switch (p.task.kind) {
    case 'camp':
      return 'At camp'
    case 'sleep':
      return 'Asleep'
    case 'rest':
      return p.bitten ? 'Bitten, resting' : 'Resting and healing'
    case 'guard':
      return 'Keeping watch'
    case 'fortify':
      return 'Barricading camp'
    case 'follow':
      return 'Moving with the group'
    case 'move': {
      const leaving = groupById(w, p.group)?.leaving
      if (leaving) return p.task.phase === 'work' ? `Waiting at the road out for ${leaving.to}` : `Heading out for ${leaving.to}`
      return `Heading to ${b ? b.name : 'a new camp'}`
    }
    case 'scavenge':
      return p.task.phase === 'go' ? `Heading to ${where}` : p.task.phase === 'work' ? `Searching ${where}` : `Bringing supplies back from ${where}`
    case 'explore':
      return p.task.phase === 'back' ? 'Coming back from scouting' : 'Scouting unknown ground'
    case 'hunt':
      return p.task.phase === 'back' ? 'Coming back from hunting' : 'Hunting in the woods'
    case 'water':
      return p.task.phase === 'back' ? 'Carrying water back' : 'Fetching water from the creek'
  }
}

export function mindText(p: Person): string {
  if (p.bitten) return 'Scared: bitten'
  if (p.grief > 0) return 'Grieving'
  if (p.morale >= 70) return 'Hopeful'
  if (p.morale >= 45) return 'Holding up'
  if (p.morale >= 25) return 'Worn down'
  return 'Breaking'
}

export function healthText(p: Person): string {
  const bits: string[] = []
  if (p.health >= 80) bits.push('Healthy')
  else if (p.health >= 50) bits.push('Hurt')
  else if (p.health >= 25) bits.push('Badly hurt')
  else bits.push('Close to death')
  if (p.lostLimb) bits.push(`lost ${p.lostLimb}`)
  if (p.hunger > 70) bits.push('starving')
  else if (p.hunger > 45) bits.push('hungry')
  if (p.thirst > 70) bits.push('parched')
  else if (p.thirst > 45) bits.push('thirsty')
  if (p.fatigue > 75) bits.push('exhausted')
  return bits.join(', ')
}

// ---------- the story log ----------

const MAX_LOG = 3000
const MAX_PERSON_LOG = 300

function log(w: SurvivalWorld, text: string, opts: { group?: number; people?: Person[]; big?: boolean } = {}): void {
  w.log.push({ tick: w.tick, text, group: opts.group, people: opts.people?.map((p) => p.id), big: opts.big })
  if (w.log.length > MAX_LOG) w.log.splice(0, w.log.length - MAX_LOG)
  for (const p of opts.people ?? []) personLog(w, p, text)
}

function personLog(w: SurvivalWorld, p: Person, text: string): void {
  p.log.push({ tick: w.tick, text })
  if (p.log.length > MAX_PERSON_LOG) p.log.splice(0, p.log.length - MAX_PERSON_LOG)
}

const listNames = (people: Person[]): string => {
  const n = people.map((p) => p.name.split(' ')[0])
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

// ---------- making people and groups ----------

export interface PersonDraft {
  name: string
  age: number
  sex: Sex
  traits: Trait[]
  skills: Record<Skill, number>
  weapon: Weapon
}

/** A first name for someone of this sex that nobody in `taken` already has. */
export function firstName(w: { rng: number }, sex: Sex, taken: string[], culture?: CultureId): string {
  const c = culture ? cultureOf(culture) : null
  let name = ''
  for (let i = 0; i < 30; i++) {
    name = pick(w, c ? c.first[sex] : sex === 'f' ? FIRST_F : FIRST_M)
    if (!taken.some((t) => t.split(' ')[0] === name)) break
  }
  return name
}

export function randomPerson(w: { rng: number }, taken: string[] = [], opts: { age?: number; sex?: Sex; surname?: string; culture?: CultureId } = {}): PersonDraft {
  const sex: Sex = opts.sex ?? (chance(w, 0.5) ? 'f' : 'm')
  const name = `${firstName(w, sex, taken, opts.culture)} ${opts.surname ?? pick(w, opts.culture ? cultureOf(opts.culture).last : LAST)}`
  const roll = random(w)
  const age = opts.age ?? (roll < 0.08 ? int(w, 7, 13) : roll < 0.18 ? int(w, 14, 17) : roll < 0.85 ? int(w, 18, 54) : int(w, 55, 75))
  const traits: Trait[] = []
  while (traits.length < 2) {
    const t = pick(w, TRAITS).id
    const clash = (a: Trait, b: Trait) => (traits.includes(a) && t === b) || (traits.includes(b) && t === a)
    if (!traits.includes(t) && !clash('brave', 'cautious') && !clash('kind', 'selfish') && !clash('hothead', 'steady')) traits.push(t)
  }
  const skills = {} as Record<Skill, number>
  for (const s of SKILLS) skills[s.id] = Math.round(clamp(between(w, 0, 7) + (age < 16 ? -2 : 0), 0, 10))
  if (traits.includes('leader')) skills.leadership = Math.max(skills.leadership, int(w, 6, 9))
  // One thing they were good at before all this.
  skills[pick(w, SKILLS).id] = int(w, 6, 9)
  const weapon: Weapon = age < 14 ? 'none' : pick(w, ['knife', 'knife', 'bat', 'machete', 'pistol', 'pistol', 'rifle', 'shotgun', 'crossbow', 'none'] as Weapon[])
  return { name, age, sex, traits, skills, weapon }
}

/** Names already used by anyone in the world, so a new person doesn't share a first name. */
export function takenNames(w: SurvivalWorld): string[] {
  return [...w.people.map((p) => p.name), ...w.fallen.map((p) => p.name)]
}

/**
 * A handful of random people with different first names. Some come as families: a couple who share
 * a surname, and children with a parent's surname.
 */
export function randomPeople(w: SurvivalWorld, n: number): PersonDraft[] {
  const taken = takenNames(w)
  const culture = w.map?.culture
  const out: PersonDraft[] = []
  for (let i = 0; i < n; i++) {
    const adult = out.find((q) => q.age >= 22 && q.age <= 55)
    let p: PersonDraft
    if (adult && i === 1 && chance(w, 0.35)) p = randomPerson(w, taken, { sex: adult.sex === 'f' ? 'm' : 'f', age: clamp(adult.age + int(w, -6, 6), 19, 60), surname: surnameOf(adult), culture })
    else {
      p = randomPerson(w, taken, { culture })
      if (p.age < 16 && adult && chance(w, 0.7)) p.name = `${p.name.split(' ')[0]} ${surnameOf(adult)}`
    }
    taken.push(p.name)
    out.push(p)
  }
  return out
}

const surnameOf = (p: { name: string }): string => p.name.split(' ').slice(1).join(' ')

export interface GroupDraft {
  name: string
  color: string
  people: PersonDraft[]
  hostile?: boolean
  ask?: boolean
  decide?: DecideStyle
}

function newGroup(w: SurvivalWorld, draft: GroupDraft, x: number, y: number): Group {
  const n = draft.people.length
  return {
    id: w.nextId++,
    name: draft.name,
    color: draft.color,
    hostile: !!draft.hostile,
    ask: !!draft.ask,
    decide: draft.decide ?? (draft.people.some((p) => p.traits.includes('leader')) ? 'leader' : 'vote'),
    leader: null,
    camp: null,
    homeX: x,
    homeY: y,
    stash: { food: n * 5, water: n * 4, ammo: 0, meds: 1, parts: 2 },
    seen: new Int32Array(CELLS_X * CELLS_Y).fill(-1),
    danger: new Uint16Array(CELLS_X * CELLS_Y),
    known: {},
    creeks: [],
    lessons: [],
    met: {},
    fought: {},
    order: null,
    leaving: null,
    away: {},
    created: w.tick,
    peak: n,
    alive: true,
    noiseDrew: 0,
    noiseWho: '',
    gunKillsToday: 0,
    lossesToday: 0
  }
}

function newPerson(w: SurvivalWorld, d: PersonDraft, g: Group, x: number, y: number): Person {
  return {
    id: w.nextId++,
    name: d.name.trim() || 'Someone',
    age: d.age,
    sex: d.sex ?? 'f',
    partner: null,
    family: [],
    held: null,
    dueAt: 0,
    group: g.id,
    x,
    y,
    traits: [...d.traits],
    skills: { ...d.skills },
    weapon: d.weapon,
    ammo: weaponInfo(d.weapon).gun ? int(w, 6, 18) : 0,
    health: 100,
    hunger: between(w, 10, 35),
    thirst: between(w, 10, 35),
    fatigue: between(w, 5, 30),
    morale: between(w, 40, 70) + (d.traits.includes('optimist') ? 15 : 0),
    grief: 0,
    bitten: null,
    lostLimb: null,
    task: { kind: 'camp', phase: 'work', x, y },
    asleep: false,
    fleeUntil: 0,
    fleeX: 0,
    fleeY: 0,
    lastFled: -1000,
    carry: { food: 0, water: 0, ammo: 0, meds: 0, parts: 0 },
    rel: {},
    kills: 0,
    joined: w.tick,
    log: [],
    pending: { cells: {}, buildings: [], danger: {} }
  }
}

function pickLeader(w: SurvivalWorld, g: Group): void {
  const ms = membersOf(w, g).filter((p) => !isKid(p))
  if (!ms.length) {
    g.leader = null
    return
  }
  const score = (p: Person) => p.skills.leadership + (has(p, 'leader') ? 4 : 0) + (has(p, 'steady') ? 1 : 0) + p.health / 100
  const best = ms.reduce((a, b) => (score(b) > score(a) ? b : a))
  if (g.leader !== best.id) {
    const before = g.leader != null
    g.leader = best.id
    if (g.decide === 'leader' && before) log(w, `${best.name} now leads ${g.name}.`, { group: g.id, people: [best] })
  }
}

/** Put a group into the world. Returns the group. */
export function spawnGroup(w: SurvivalWorld, draft: GroupDraft, x: number, y: number): Group {
  const g = newGroup(w, draft, x, y)
  w.groups.push(g)
  const people = draft.people.map((d, i) => {
    const a = (i / Math.max(1, draft.people.length)) * Math.PI * 2
    return newPerson(w, d, g, clamp(x + Math.cos(a) * 1.5, 1, MAP_W - 2), clamp(y + Math.sin(a) * 1.5, 1, MAP_H - 2))
  })
  // People who come in together already know each other a bit, and those who share a surname are family.
  for (const p of people) for (const q of people) if (p !== q) p.rel[q.id] = int(w, 5, 35)
  for (const p of people)
    for (const q of people) {
      if (p.id >= q.id || surnameOf(p) !== surnameOf(q)) continue
      if (p.age >= 18 && q.age >= 18 && p.sex !== q.sex && Math.abs(p.age - q.age) <= 15 && p.partner == null && q.partner == null) {
        p.partner = q.id
        q.partner = p.id
        p.rel[q.id] = q.rel[p.id] = int(w, 70, 95)
      } else {
        p.family.push(q.id)
        q.family.push(p.id)
        p.rel[q.id] = q.rel[p.id] = int(w, 55, 90)
      }
    }
  w.people.push(...people)
  pickLeader(w, g)
  const lead = personById(w, g.leader ?? -1)
  const n = people.length
  const who = n === 1 ? `${people[0].name}, alone,` : `${g.name} (${n} people${lead && g.decide === 'leader' ? `, led by ${lead.name}` : ''})`
  const where = nearestPlace(w, x, y)
  log(w, `${who} ${g.hostile ? 'turned up' : 'arrived'} ${where}.`, { group: g.id, people, big: true })
  for (const p of people) personLog(w, p, n === 1 ? 'On their own and looking for somewhere safe.' : `With ${g.name}.`)
  look(w, g, people, true)
  planNow(w, g)
  return g
}

function nearestPlace(w: SurvivalWorld, x: number, y: number): string {
  const b = buildingAt(w, x, y, 2)
  if (b) return `at ${b.name}`
  let best: Town | null = null
  let bd = Infinity
  for (const t of w.map.towns) {
    const d = dist(x, y, t.x, t.y)
    if (d < bd) {
      bd = d
      best = t
    }
  }
  if (!best) return 'in the country'
  if (bd < best.r) return `in ${best.name}`
  const dx = x - best.x
  const dy = y - best.y
  const dir = Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? 'east' : 'west') : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? 'south' : 'north') : `${dy > 0 ? 'south' : 'north'}${dx > 0 ? 'east' : 'west'}`
  return `in the woods ${dir} of ${best.name}`
}

export function spawnWalkers(w: SurvivalWorld, x: number, y: number, count: number, asHerd: boolean): void {
  const herd: Herd | null = asHerd ? { id: w.nextId++, x, y, tx: x, ty: y } : null
  if (herd) w.herds.push(herd)
  const spread = asHerd ? Math.sqrt(count) * 0.9 + 2 : count > 1 ? 10 : 0
  for (let i = 0; i < count; i++) {
    const a = random(w) * Math.PI * 2
    const d = Math.sqrt(random(w)) * spread
    const wx = clamp(x + Math.cos(a) * d, 0.5, MAP_W - 0.5)
    const wy = clamp(y + Math.sin(a) * d, 0.5, MAP_H - 0.5)
    w.walkers.push({ id: w.nextId++, x: wx, y: wy, tx: wx, ty: wy, chase: null, herd: herd?.id ?? null, busyUntil: 0 })
  }
  if (count >= 10) log(w, `${asHerd ? 'A herd of' : ''} ${count} walkers ${asHerd ? 'is moving' : 'are wandering'} ${nearestPlace(w, x, y)}.`.trim())
}

export function spawnSupplies(w: SurvivalWorld, x: number, y: number): Building {
  const b: Building = {
    id: w.nextId++,
    kind: 'cache',
    name: 'Supply stash',
    town: null,
    x: Math.floor(clamp(x - 1, 1, MAP_W - 3)),
    y: Math.floor(clamp(y - 1, 1, MAP_H - 3)),
    w: 2,
    h: 2,
    loot: lootFor(w, 'cache', 4, 1),
    fort: 0
  }
  w.buildings.push(b)
  return b
}

/** A loud noise (a car alarm, a gunshot, a crash). Walkers in range head for it. */
export function makeNoise(w: SurvivalWorld, x: number, y: number, r: number): number {
  w.noises.push({ x, y, r, until: w.tick + 20 })
  let drawn = 0
  for (const z of w.walkers) {
    if (z.chase != null) continue
    const d = dist(z.x, z.y, x, y)
    if (d < r) {
      if (z.busyUntil <= w.tick) drawn++
      z.tx = x + between(w, -3, 3)
      z.ty = y + between(w, -3, 3)
      z.busyUntil = w.tick + 240
    }
  }
  return drawn
}

/** Give a group an order. It takes effect straight away (or at first light if they're asleep). */
export function giveOrder(w: SurvivalWorld, g: Group, order: Order | null): void {
  g.order = order
  if (!order) return
  const what =
    order.kind === 'stay'
      ? 'stay in camp today'
      : order.kind === 'scavenge'
        ? `search ${buildingById(w, order.building)?.name ?? 'a building'}`
        : order.kind === 'explore'
          ? `scout ${nearestPlace(w, order.x ?? 0, order.y ?? 0)}`
          : order.kind === 'move'
            ? `move camp to ${buildingById(w, order.building)?.name ?? 'a new place'}`
            : order.kind === 'fortify'
              ? 'barricade the camp'
              : order.kind === 'hunt'
                ? 'go hunting'
                : 'fetch water'
  log(w, `You told ${g.name} to ${what}.`, { group: g.id })
  if (minuteOfDay(w.tick) >= 6 * 60 && minuteOfDay(w.tick) < 18 * 60) planDay(w, g)
}

// ---------- leaving for somewhere far away (the globe moves them) ----------

/** The group packs up and walks to (x, y) at the edge of the map, to set off for `to`. */
export function sendAway(w: SurvivalWorld, g: Group, x: number, y: number, to: string, dest?: { lat: number; lon: number }): void {
  g.leaving = { x: clamp(x, 1, MAP_W - 2), y: clamp(y, 1, MAP_H - 2), to, ...dest }
  g.order = null
  g.camp = null
  log(w, `${g.name} packed up and set off for ${to}.`, { group: g.id, big: true })
  for (const p of membersOf(w, g)) {
    p.asleep = false
    p.task = { kind: 'move', phase: 'go', x: g.leaving.x + between(w, -1.5, 1.5), y: g.leaving.y + between(w, -1.5, 1.5) }
  }
}

/** Calls off leaving: they go back to looking after themselves here. */
export function stayHere(w: SurvivalWorld, g: Group): void {
  if (!g.leaving) return
  g.leaving = null
  log(w, `${g.name} decided to stay after all.`, { group: g.id })
  planNow(w, g)
}

/** Everyone still with the group has reached the road out. */
export function readyToLeave(w: SurvivalWorld, g: Group): boolean {
  if (!g.leaving || !g.alive) return false
  const ms = membersOf(w, g)
  return ms.length > 0 && ms.every((p) => dist(p.x, p.y, g.leaving!.x, g.leaving!.y) < 4)
}

/** Takes a group (and anyone it's holding) out of this area entirely. */
export function takeOutGroup(w: SurvivalWorld, g: Group): { group: Group; people: Person[] } {
  const people = w.people.filter((p) => p.group === g.id)
  w.people = w.people.filter((p) => p.group !== g.id)
  w.groups = w.groups.filter((x) => x !== g)
  w.pending = w.pending.filter((d) => d.group !== g.id)
  w.fights = w.fights.filter((f) => f.a !== g.id && f.b !== g.id)
  for (const o of w.groups) delete o.met[g.id]
  return { group: g, people }
}

/** Brings a group that's arrived from somewhere else into this area at (x, y). */
export function bringInGroup(w: SurvivalWorld, g: Group, people: Person[], x: number, y: number, from: string): void {
  g.leaving = null
  g.camp = null
  g.order = null
  g.homeX = x
  g.homeY = y
  w.groups.push(g)
  people.forEach((p, i) => {
    const a = (i / Math.max(1, people.length)) * Math.PI * 2
    p.x = clamp(x + Math.cos(a) * 1.5, 1, MAP_W - 2)
    p.y = clamp(y + Math.sin(a) * 1.5, 1, MAP_H - 2)
    p.fleeUntil = 0
    p.asleep = false
    p.task = { kind: 'camp', phase: 'work', x: p.x, y: p.y }
  })
  w.people.push(...people)
  log(w, `${g.name} arrived ${nearestPlace(w, x, y)}, after the long road from ${from}.`, { group: g.id, people, big: true })
  look(w, g, membersOf(w, g), true)
  planNow(w, g)
}

// ---------- sight and knowledge ----------

function sightOf(w: SurvivalWorld, p: Person): number {
  return p.asleep ? 2 : 14 - darkness(w.tick) * 8
}

/** Mark what these people can see. Near camp it goes straight to the group; away, they carry it home. */
function look(w: SurvivalWorld, g: Group, people: Person[], direct = false): void {
  const camp = campOf(w, g)
  for (const p of people) {
    const r = sightOf(w, p)
    const near = direct || (camp ? dist(p.x, p.y, camp.x + camp.w / 2, camp.y + camp.h / 2) < 24 : dist(p.x, p.y, g.homeX, g.homeY) < 24)
    const cr = Math.ceil(r / CELL)
    const pcx = Math.floor(p.x / CELL)
    const pcy = Math.floor(p.y / CELL)
    for (let cy = pcy - cr; cy <= pcy + cr; cy++) {
      if (cy < 0 || cy >= CELLS_Y) continue
      for (let cx = pcx - cr; cx <= pcx + cr; cx++) {
        if (cx < 0 || cx >= CELLS_X) continue
        if (dist((cx + 0.5) * CELL, (cy + 0.5) * CELL, p.x, p.y) > r + CELL * 0.5) continue
        const c = cy * CELLS_X + cx
        if (near) g.seen[c] = w.tick
        else p.pending.cells[c] = w.tick
        // A creek here?
        if (tileAt(w.map, cx * CELL + 1, cy * CELL + 1) === TILE.creek || tileAt(w.map, cx * CELL + 2, cy * CELL + 2) === TILE.creek) {
          if (near) {
            if (!g.creeks.includes(c)) g.creeks.push(c)
          } else p.pending.creek = c
        }
      }
    }
    for (const b of w.buildings) {
      if (g.known[b.id] || dist(b.x + b.w / 2, b.y + b.h / 2, p.x, p.y) > r + 2) continue
      if (near) g.known[b.id] = { tick: w.tick, loot: null }
      else if (!p.pending.buildings.includes(b.id)) p.pending.buildings.push(b.id)
    }
  }
}

function noteDanger(w: SurvivalWorld, g: Group, p: Person, count: number): void {
  const c = cellOf(p.x, p.y)
  const camp = campOf(w, g)
  const near = camp ? dist(p.x, p.y, camp.x, camp.y) < 24 : true
  if (near) g.danger[c] = Math.max(g.danger[c], count)
  else p.pending.danger[c] = Math.max(p.pending.danger[c] ?? 0, count)
}

/** Someone got back to camp: everyone learns what they saw. */
function shareWhatTheySaw(w: SurvivalWorld, g: Group, p: Person): number {
  let fresh = 0
  for (const [k, t] of Object.entries(p.pending.cells)) {
    const c = Number(k)
    if (g.seen[c] < 0) fresh++
    if (t > g.seen[c]) {
      g.seen[c] = t
      g.danger[c] = p.pending.danger[c] ?? 0
    }
  }
  for (const id of p.pending.buildings) if (!g.known[id]) g.known[id] = { tick: w.tick, loot: null }
  if (p.pending.creek != null && !g.creeks.includes(p.pending.creek)) g.creeks.push(p.pending.creek)
  p.pending = { cells: {}, buildings: [], danger: {} }
  return fresh
}

/** How out of date the group's knowledge of a fog square is: 0 fresh, 1 stale, -1 never seen. */
export function staleness(w: SurvivalWorld, g: Group, cell: number): number {
  const t = g.seen[cell]
  if (t < 0) return -1
  return clamp((w.tick - t) / (DAY * 3), 0, 1)
}

// ---------- the daily plan ----------

function canWork(p: Person): boolean {
  return !isKid(p) && !p.held && p.health >= 35 && !p.bitten && p.hunger < 90 && p.thirst < 90
}

const CARRY: Supplies = { food: 10, water: 8, ammo: 40, meds: 5, parts: 6 }

function value(s: Supplies, need: Supplies): number {
  return SUPPLY_KEYS.reduce((sum, k) => sum + Math.min(s[k], CARRY[k] * 2) * need[k], 0)
}

function needs(w: SurvivalWorld, g: Group): Supplies {
  const ms = membersOf(w, g)
  const n = Math.max(1, ms.length)
  const foodDays = g.stash.food / (n * 2)
  const waterDays = g.stash.water / (n * 2)
  const stock = hasLesson(g, 'stockpile') ? 1.6 : 1
  const guns = ms.filter((p) => weaponInfo(p.weapon).gun).length
  return {
    food: (1 + Math.max(0, 5 - foodDays) * 1.2) * stock,
    water: (1 + Math.max(0, 4 - waterDays) * 1.2) * stock,
    ammo: guns ? 0.04 + (g.stash.ammo < guns * 20 ? 0.08 : 0) : 0.01,
    meds: 0.6 + ms.filter((p) => p.health < 60).length * 0.6,
    parts: 0.2 + (hasLesson(g, 'fortify') ? 0.4 : 0)
  }
}

/** What they hope to find in a building they haven't searched, going by what kind of place it is. */
function expected(kind: BuildingKind): Supplies {
  switch (kind) {
    case 'house':
      return { food: 3, water: 2, ammo: 1, meds: 0.5, parts: 3 }
    case 'farm':
      return { food: 8, water: 4, ammo: 5, meds: 0.5, parts: 5 }
    case 'store':
      return { food: 20, water: 15, ammo: 0, meds: 1, parts: 2 }
    case 'pharmacy':
      return { food: 2, water: 3, ammo: 0, meds: 15, parts: 1 }
    case 'gas':
      return { food: 6, water: 7, ammo: 0, meds: 1, parts: 3 }
    case 'police':
      return { food: 4, water: 4, ammo: 50, meds: 4, parts: 3 }
    case 'school':
      return { food: 12, water: 10, ammo: 0, meds: 4, parts: 6 }
    case 'church':
      return { food: 7, water: 6, ammo: 0, meds: 2, parts: 4 }
    case 'warehouse':
      return { food: 20, water: 15, ammo: 5, meds: 2, parts: 15 }
    case 'cache':
      return { food: 10, water: 10, ammo: 10, meds: 3, parts: 3 }
  }
}

function dangerNear(g: Group, x: number, y: number): number {
  const c0 = cellOf(x, y)
  const cx = c0 % CELLS_X
  const cy = Math.floor(c0 / CELLS_X)
  let d = 0
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) if (i >= 0 && j >= 0 && i < CELLS_X && j < CELLS_Y) d += g.danger[j * CELLS_X + i]
  return d
}

function otherCamps(w: SurvivalWorld, g: Group): Set<number> {
  return new Set(w.groups.filter((o) => o.alive && o.id !== g.id && o.camp != null).map((o) => o.camp as number))
}

function scavengeTargets(w: SurvivalWorld, g: Group, fromX: number, fromY: number): { b: Building; score: number }[] {
  const need = needs(w, g)
  const taken = otherCamps(w, g)
  const out: { b: Building; score: number }[] = []
  for (const [k, info] of Object.entries(g.known)) {
    const b = buildingById(w, Number(k))
    if (!b || b.id === g.camp || taken.has(b.id)) continue
    const v = value(info.loot ?? expected(b.kind), need)
    if (v < 3) continue
    const d = dist(fromX, fromY, b.x, b.y)
    if (d > 150) continue
    const score = v / (1 + d / 35) - dangerNear(g, b.x, b.y) * (hasLesson(g, 'hide') ? 4 : 1.5)
    out.push({ b, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

function exploreTarget(w: SurvivalWorld, g: Group, fromX: number, fromY: number, near?: { x: number; y: number }): { x: number; y: number } {
  let best = { x: fromX, y: fromY, s: -Infinity }
  for (let i = 0; i < 60; i++) {
    const c = Math.floor(random(w) * CELLS_X * CELLS_Y)
    const x = (c % CELLS_X) * CELL + CELL / 2
    const y = Math.floor(c / CELLS_X) * CELL + CELL / 2
    const d = dist(x, y, fromX, fromY)
    if (near && dist(x, y, near.x, near.y) > 20) continue
    if (d > 110 || d < 12) continue
    const st = staleness(w, g, c)
    let s = (st < 0 ? 3 : st * 1.5) - d / 40 - dangerNear(g, x, y) * 0.5
    if (tileAt(w.map, x, y) === TILE.road || tileAt(w.map, x, y) === TILE.lot) s += 1
    s += random(w) * 0.5
    if (s > best.s) best = { x, y, s }
  }
  if (best.s === -Infinity) return { x: clamp(fromX + between(w, -40, 40), 4, MAP_W - 4), y: clamp(fromY + between(w, -40, 40), 4, MAP_H - 4) }
  return best
}

function campScore(w: SurvivalWorld, g: Group, b: Building): number {
  const base: Record<BuildingKind, number> = { school: 30, church: 24, police: 30, warehouse: 26, farm: 24, house: 6, store: 14, pharmacy: 8, gas: 6, cache: -100 }
  const size = Math.min(b.w * b.h, 80) * 0.4
  const n = membersOf(w, g).length
  const room = b.w * b.h >= n * 2 ? 0 : -15
  const isolated = w.map.towns.every((t) => dist(b.x, b.y, t.x, t.y) > t.r * 0.6) ? 6 : 0
  const creek = g.creeks.some((c) => dist((c % CELLS_X) * CELL, Math.floor(c / CELLS_X) * CELL, b.x, b.y) < 40) ? 6 : 0
  return base[b.kind] + size + room + isolated + creek + b.fort * 0.2 - dangerNear(g, b.x, b.y) * 2 - dist(b.x, b.y, g.homeX, g.homeY) / 25
}

function campCandidates(w: SurvivalWorld, g: Group): { b: Building; score: number }[] {
  const taken = otherCamps(w, g)
  return Object.keys(g.known)
    .map((k) => buildingById(w, Number(k)))
    .filter((b): b is Building => !!b && !taken.has(b.id) && b.kind !== 'cache' && b.w * b.h >= 9)
    .map((b) => ({ b, score: campScore(w, g, b) }))
    .sort((a, b) => b.score - a.score)
}

function setCamp(w: SurvivalWorld, g: Group, b: Building, why: string): void {
  const old = campOf(w, g)
  g.camp = b.id
  g.homeX = b.x + b.w / 2
  g.homeY = b.y + b.h / 2
  const ms = membersOf(w, g)
  log(w, old ? `${g.name} moved camp from ${old.name} to ${b.name}. ${why}` : `${g.name} set up camp at ${b.name}. ${why}`, { group: g.id, people: ms, big: true })
  for (const p of ms) {
    if (p.bitten || p.health < 35 || p.task.kind === 'follow' || p.task.kind === 'camp' || p.task.kind === 'move' || p.task.kind === 'sleep') {
      const s = campSpot(w, b)
      p.task = { kind: 'move', phase: 'go', x: s.x, y: s.y, building: b.id }
    }
  }
}

function whoDecided(w: SurvivalWorld, g: Group): string {
  const lead = personById(w, g.leader ?? -1)
  if (g.decide === 'leader' && lead) return `${lead.name.split(' ')[0]} decided`
  if (g.decide === 'vote') return 'The group voted'
  return 'They talked it over and agreed'
}

/** No camp yet, or it's daytime and they've nothing to do: work out a plan now. */
function planNow(w: SurvivalWorld, g: Group): void {
  const m = minuteOfDay(w.tick)
  if (m >= 6 * 60 && m < 17 * 60) planDay(w, g)
  else if (!g.camp) chooseCamp(w, g)
}

function chooseCamp(w: SurvivalWorld, g: Group): boolean {
  const options = campCandidates(w, g).filter((o) => o.score > 4)
  if (!options.length) return false
  if (g.ask && !g.hostile) {
    if (w.pending.some((d) => d.group === g.id && d.kind === 'camp')) return true
    const top = options.slice(0, 3)
    w.pending.push({
      id: w.nextId++,
      group: g.id,
      kind: 'camp',
      title: `Where should ${g.name} make camp?`,
      text: `They've found a few places that could work.`,
      options: [...top.map((o) => ({ id: String(o.b.id), label: o.b.name, hint: `${BUILDING_LABEL[o.b.kind]}${o.b.town ? ` in ${o.b.town}` : ''}` })), { id: 'none', label: 'Keep looking', hint: 'Carry on scouting for somewhere better' }],
      auto: String(top[0].b.id),
      data: {}
    })
    return true
  }
  setCamp(w, g, options[0].b, options[0].b.kind === 'house' ? 'It will do for now.' : `A ${BUILDING_LABEL[options[0].b.kind].toLowerCase()} seemed the safest bet.`)
  return true
}

function planDay(w: SurvivalWorld, g: Group): void {
  const ms = membersOf(w, g)
  if (!ms.length) return
  pickLeader(w, g)
  if (g.leaving) {
    // Moving on: everyone heads for the road out.
    for (const p of ms) {
      p.asleep = false
      if (p.task.kind !== 'move') p.task = { kind: 'move', phase: 'go', x: g.leaving.x + between(w, -1.5, 1.5), y: g.leaving.y + between(w, -1.5, 1.5) }
    }
    return
  }
  const order = g.order
  g.order = null

  if (order?.kind === 'move') {
    const b = buildingById(w, order.building)
    if (b) {
      // Moving day: everyone packs up and goes.
      setCamp(w, g, b, 'You told them to.')
      for (const p of ms) {
        const spot = campSpot(w, b)
        p.asleep = false
        p.task = { kind: 'move', phase: 'go', x: spot.x, y: spot.y, building: b.id }
        if (!canWork(p)) p.task = { kind: 'rest', phase: 'go', x: spot.x, y: spot.y, building: b.id }
      }
      return
    }
  }

  let camp = campOf(w, g)
  if (!camp) {
    if (chooseCamp(w, g) && g.camp) camp = campOf(w, g)
  }
  for (const p of ms) {
    p.asleep = false
  }
  const able = ms.filter(canWork)
  for (const p of ms) if (!canWork(p)) setHome(w, p, 'rest')

  if (!camp) {
    // On the move: the leader scouts and everyone follows.
    const lead = personById(w, g.leader ?? -1) ?? able[0] ?? ms[0]
    const t = order?.kind === 'explore' && order.x != null ? { x: order.x, y: order.y ?? 0 } : exploreTarget(w, g, lead.x, lead.y)
    lead.task = { kind: 'explore', phase: 'go', x: t.x, y: t.y }
    for (const p of ms) if (p !== lead) p.task = { kind: 'follow', phase: 'go', x: lead.x, y: lead.y, with: [lead.id] }
    if (w.pending.every((d) => d.group !== g.id)) log(w, `${g.name} has nowhere to stay yet. ${lead.name.split(' ')[0]} is leading them on to look for somewhere.`, { group: g.id })
    return
  }

  const cx = camp.x + camp.w / 2
  const cy = camp.y + camp.h / 2
  const n = ms.length
  const foodDays = g.stash.food / (n * 2)
  const waterDays = g.stash.water / (n * 2)
  const pool = [...able].sort((a, b) => b.skills.scavenging - a.skills.scavenging)
  const take = (fn?: (p: Person) => number): Person | undefined => {
    if (!pool.length) return undefined
    const i = fn ? pool.reduce((bi, p, j) => (fn(p) > fn(pool[bi]) ? j : bi), 0) : 0
    return pool.splice(i, 1)[0]
  }
  const lines: string[] = []

  if (order?.kind === 'stay') {
    for (const p of pool) setHome(w, p, 'camp')
    log(w, `${g.name} is staying in today, like you asked.`, { group: g.id })
    return
  }

  // Someone always keeps watch, if they've learned to, or there are enough of them.
  const guards: Person[] = []
  if (hasLesson(g, 'watch') || n >= 5) {
    const gd = take((p) => p.skills.shooting + p.skills.fighting + (has(p, 'loyal') ? 2 : 0) - p.skills.scavenging)
    if (gd) guards.push(gd)
  }
  for (const p of guards) setHome(w, p, 'guard')
  if (guards.length) lines.push(`${listNames(guards)} will keep watch`)

  // Barricades.
  const fortifiers: Person[] = []
  const wantFort = order?.kind === 'fortify' ? pool.length : camp.fort < 90 && g.stash.parts >= 2 ? (hasLesson(g, 'fortify') ? 2 : camp.fort < 40 ? 1 : 0) : 0
  for (let i = 0; i < wantFort; i++) {
    const p = take((q) => q.skills.building)
    if (p) fortifiers.push(p)
  }
  for (const p of fortifiers) {
    const s = campSpot(w, camp)
    p.task = { kind: 'fortify', phase: 'work', x: s.x, y: s.y, until: w.tick + 600 }
  }
  if (fortifiers.length) lines.push(`${listNames(fortifiers)} will shore up ${camp.name}`)

  // Ordered jobs first.
  const teamSize = (): number => (hasLesson(g, 'pairs') ? (pool.length >= 3 && n >= 8 ? 3 : 2) : 1)
  const sendTeam = (kind: TaskKind, size: number, x: number, y: number, b?: Building, work = 60): Person[] => {
    const team: Person[] = []
    for (let i = 0; i < size; i++) {
      const p = take(kind === 'hunt' ? (q) => q.skills.shooting + q.skills.fighting : undefined)
      if (p) team.push(p)
    }
    // Cautious people take someone along if they can.
    if (team.length === 1 && has(team[0], 'cautious') && pool.length) team.push(take() as Person)
    for (const p of team) p.task = { kind, phase: 'go', x: x + between(w, -0.8, 0.8), y: y + between(w, -0.8, 0.8), building: b?.id, until: work, with: team.filter((q) => q !== p).map((q) => q.id) }
    return team
  }

  if (order?.kind === 'scavenge') {
    const b = buildingById(w, order.building)
    if (b) {
      const t = sendTeam('scavenge', Math.max(2, teamSize()), b.x + b.w / 2, b.y + b.h / 2, b, 60 + b.w * b.h)
      if (t.length) lines.push(`${listNames(t)} will search ${b.name}, like you asked`)
    }
  }
  if (order?.kind === 'explore' && order.x != null) {
    const t = sendTeam('explore', Math.max(1, teamSize()), order.x, order.y ?? 0)
    if (t.length) lines.push(`${listNames(t)} will scout where you pointed`)
  }
  if (order?.kind === 'hunt' || (foodDays < 3 && pool.length >= 2 && chance(w, 0.6))) {
    const woods = nearestTile(w, cx, cy, TILE.forest, 50)
    if (woods) {
      const t = sendTeam('hunt', order?.kind === 'hunt' ? 2 : 1, woods.x, woods.y, undefined, 180)
      if (t.length) lines.push(`${listNames(t)} will hunt in the woods`)
    }
  }
  if (order?.kind === 'water' || (waterDays < 2.5 && g.creeks.length && pool.length >= 1)) {
    const c = g.creeks.reduce((a, b) => (cellDist(b, cx, cy) < cellDist(a, cx, cy) ? b : a))
    const t = sendTeam('water', 1, (c % CELLS_X) * CELL + 1, Math.floor(c / CELLS_X) * CELL + 1, undefined, 40)
    if (t.length) lines.push(`${listNames(t)} will fetch water from the creek`)
  }

  // Raiders go looking for people to rob: any camp they've seen, they head for.
  if (g.hostile && pool.length >= 2) {
    const prey = w.groups
      .filter((o) => o.alive && o.id !== g.id && !o.hostile && o.camp != null)
      .map((o) => campOf(w, o) as Building)
      .filter((b) => g.seen[cellOf(b.x, b.y)] >= 0)
      .sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy))[0]
    if (prey && chance(w, 0.6)) {
      const t = sendTeam('explore', pool.length - (pool.length > 3 ? 1 : 0), prey.x + prey.w / 2, prey.y + prey.h + 2, undefined, 90)
      if (t.length) lines.push(`${listNames(t)} will pay a visit to the people at ${prey.name}`)
    }
  }

  // Scared groups send fewer people out, even when they shouldn't.
  let runs = Infinity
  if (hasLesson(g, 'hide')) runs = foodDays < 1.5 || waterDays < 1.5 ? 1 : 0
  const targets = scavengeTargets(w, g, cx, cy)
  let ti = 0
  while (pool.length && runs > 0) {
    const size = teamSize()
    if (pool.length < size && size > 1 && hasLesson(g, 'pairs')) break
    let tgt = targets[ti++]
    while (tgt && w.people.some((q) => q.group === g.id && q.task.kind === 'scavenge' && q.task.building === tgt?.b.id && !pool.includes(q))) tgt = targets[ti++]
    if (tgt && tgt.score > 1.2) {
      const b = tgt.b
      const t = sendTeam('scavenge', size, b.x + b.w / 2, b.y + b.h / 2, b, 45 + b.w * b.h) // bigger places take longer
      if (t.length) lines.push(`${listNames(t)} will search ${b.name}`)
    } else {
      const ex = exploreTarget(w, g, cx, cy)
      const t = sendTeam('explore', size, ex.x, ex.y)
      if (t.length) lines.push(`${listNames(t)} will scout ${nearestPlace(w, ex.x, ex.y).replace(/^at /, 'around ')}`)
    }
    runs--
  }
  for (const p of pool) setHome(w, p, 'camp')
  if (pool.length && lines.length) lines.push(`${listNames(pool)} will stay at camp`)
  else if (pool.length) lines.push('Everyone stays at camp')

  const kids = ms.filter(isKid)
  for (const k of kids) setHome(w, k, 'camp')
  log(w, `Plan for Day ${dayOf(w.tick)}: ${whoDecided(w, g)}. ${lines.join('. ')}.`, { group: g.id })
}

function cellDist(c: number, x: number, y: number): number {
  return dist((c % CELLS_X) * CELL, Math.floor(c / CELLS_X) * CELL, x, y)
}

function nearestTile(w: SurvivalWorld, x: number, y: number, t: number, max: number): { x: number; y: number } | null {
  for (let r = 4; r <= max; r += 3) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r
      const tx = x + Math.cos(a) * r
      const ty = y + Math.sin(a) * r
      if (tx > 1 && ty > 1 && tx < MAP_W - 1 && ty < MAP_H - 1 && tileAt(w.map, tx, ty) === t) return { x: tx, y: ty }
    }
  }
  return null
}

function setHome(w: SurvivalWorld, p: Person, kind: 'camp' | 'rest' | 'guard' | 'sleep'): void {
  const g = groupById(w, p.group)
  const camp = g && campOf(w, g)
  const s = camp ? campSpot(w, camp) : { x: (g?.homeX ?? p.x) + between(w, -2, 2), y: (g?.homeY ?? p.y) + between(w, -2, 2) }
  p.task = { kind, phase: 'work', x: s.x, y: s.y }
}

// ---------- needs ----------

function eat(w: SurvivalWorld, g: Group, p: Person): void {
  const fromCarry = p.carry.food > 0
  if (p.hunger > 25 && (fromCarry || (isAtCamp(w, p) && g.stash.food > 0))) {
    if (fromCarry) p.carry.food--
    else g.stash.food--
    p.hunger = Math.max(0, p.hunger - 38)
  }
  const fromCarryW = p.carry.water > 0
  if (p.thirst > 25 && (fromCarryW || (isAtCamp(w, p) && g.stash.water > 0))) {
    if (fromCarryW) p.carry.water--
    else g.stash.water--
    p.thirst = Math.max(0, p.thirst - 45)
  }
}

function needsTick(w: SurvivalWorld, g: Group, p: Person): void {
  const harsh = 0.7 + w.harshness * 0.6
  p.hunger = Math.min(100, p.hunger + (100 / (4 * DAY)) * harsh)
  p.thirst = Math.min(100, p.thirst + (100 / (2.2 * DAY)) * harsh)
  if (p.asleep) p.fatigue = Math.max(0, p.fatigue - 100 / (7 * 60))
  else p.fatigue = Math.min(100, p.fatigue + (p.fleeUntil > w.tick ? 0.25 : 100 / (18 * 60)))
  if ((p.hunger > 60 || p.thirst > 60) && !p.held) eat(w, g, p)
  if (p.hunger >= 100) p.health -= 0.012 * harsh
  if (p.thirst >= 100) p.health -= 0.03 * harsh
  if (p.hunger < 70 && p.thirst < 70 && !p.bitten && p.health < 100) p.health = Math.min(100, p.health + (p.asleep ? 0.012 : 0.005))
  if (p.grief > 0) p.grief--
  // Morale drifts back toward how things are going.
  const target = 55 + (has(p, 'optimist') ? 15 : 0) - (p.hunger > 60 ? 20 : 0) - (p.thirst > 60 ? 20 : 0) - (p.grief > 0 ? 25 : 0) - (p.health < 50 ? 10 : 0)
  p.morale += (target - p.morale) * 0.0008
}

// ---------- people moving and acting ----------

const NO_WALKERS: Walker[] = []

class Grid {
  cells = new Map<number, Walker[]>()
  static S = 8
  constructor(walkers: Walker[]) {
    for (const z of walkers) {
      const k = Math.floor(z.y / Grid.S) * 64 + Math.floor(z.x / Grid.S)
      const list = this.cells.get(k)
      if (list) list.push(z)
      else this.cells.set(k, [z])
    }
  }
  near(x: number, y: number, r: number, out: Walker[]): Walker[] {
    out.length = 0
    const x0 = Math.floor((x - r) / Grid.S)
    const x1 = Math.floor((x + r) / Grid.S)
    const y0 = Math.floor((y - r) / Grid.S)
    const y1 = Math.floor((y + r) / Grid.S)
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const list = this.cells.get(j * 64 + i)
        if (!list) continue
        for (const z of list) if (dist(z.x, z.y, x, y) <= r) out.push(z)
      }
    return out.length ? out : NO_WALKERS
  }
}

function speedOf(w: SurvivalWorld, p: Person, running: boolean): number {
  const t = tileAt(w.map, p.x, p.y)
  const ground = t === TILE.forest ? 0.6 : t === TILE.road ? 1.15 : t === TILE.creek ? 0.5 : 1
  const body = (p.lostLimb === 'leg' ? 0.55 : 1) * (p.health < 30 ? 0.6 : 1) * (p.fatigue > 80 ? 0.7 : 1) * (p.age > 64 ? 0.8 : p.age < 12 ? 0.85 : 1)
  return (running ? 1.6 : 0.8) * ground * body
}

function moveToward(p: Person, x: number, y: number, step: number): boolean {
  const dx = x - p.x
  const dy = y - p.y
  const d = Math.hypot(dx, dy)
  if (d <= step) {
    p.x = x
    p.y = y
    return true
  }
  p.x = clamp(p.x + (dx / d) * step, 0.5, MAP_W - 0.5)
  p.y = clamp(p.y + (dy / d) * step, 0.5, MAP_H - 0.5)
  return false
}

function goBack(w: SurvivalWorld, p: Person): void {
  const g = groupById(w, p.group)
  const camp = g && campOf(w, g)
  const s = camp ? campSpot(w, camp) : { x: g?.homeX ?? p.x, y: g?.homeY ?? p.y }
  p.task = { ...p.task, phase: 'back', x: s.x, y: s.y }
}

function arriveHome(w: SurvivalWorld, g: Group, p: Person): void {
  const brought = SUPPLY_KEYS.filter((k) => p.carry[k] > 0).map((k) => `${p.carry[k]} ${SUPPLY_LABEL[k]}`)
  for (const k of SUPPLY_KEYS) {
    g.stash[k] += p.carry[k]
    p.carry[k] = 0
  }
  const fresh = shareWhatTheySaw(w, g, p)
  const where = buildingById(w, p.task.building)
  const kind = p.task.kind
  if (brought.length) {
    log(w, `${p.name.split(' ')[0]} got back${where ? ` from ${where.name}` : ''} with ${brought.join(', ')}.`, { group: g.id, people: [p] })
    p.morale = Math.min(100, p.morale + 3)
  } else if (kind === 'explore' && fresh > 0) log(w, `${p.name.split(' ')[0]} got back from scouting and told the others what's out there.`, { group: g.id, people: [p] })
  else if (kind === 'scavenge' && where) log(w, `${p.name.split(' ')[0]} got back from ${where.name} empty-handed.`, { group: g.id, people: [p] })
  // A bitten person getting back: there may still be time to cut the limb off.
  if (p.bitten) biteDecision(w, g, p)
  const m = minuteOfDay(w.tick)
  setHome(w, p, m >= 21 * 60 || m < 6 * 60 ? 'sleep' : 'camp')
  if (p.task.kind === 'sleep') p.asleep = true
  const n = Math.max(1, membersOf(w, g).length)
  const plenty = g.stash.food / (n * 2) > 6 && g.stash.water / (n * 2) > 5
  if (m >= 6 * 60 && m < 13 * 60 && canWork(p) && !p.bitten && !plenty && (p.task.kind === 'scavenge' || p.task.kind === 'explore')) {
    // Back early with daylight left: they'll go out again.
    const t = scavengeTargets(w, g, p.x, p.y).find((o) => !w.people.some((q) => q !== p && q.group === g.id && q.task.building === o.b.id))
    if (t && t.score > 3 && !hasLesson(g, 'pairs') && !hasLesson(g, 'hide')) {
      const b = t.b
      p.task = { kind: 'scavenge', phase: 'go', x: b.x + b.w / 2, y: b.y + b.h / 2, building: b.id, until: 45 + b.w * b.h }
    }
  }
}

function doWork(w: SurvivalWorld, g: Group, p: Person): void {
  const t = p.task
  if (t.until == null) t.until = w.tick + 60
  switch (t.kind) {
    case 'scavenge': {
      if (w.tick < (t.until ?? 0)) return
      const b = buildingById(w, t.building)
      if (b) {
        const skill = 0.55 + p.skills.scavenging * 0.05
        const found: Supplies = { food: 0, water: 0, ammo: 0, meds: 0, parts: 0 }
        for (const k of SUPPLY_KEYS) {
          const room = CARRY[k] - p.carry[k]
          const n = Math.min(room, Math.round(b.loot[k] * skill + (random(w) < 0.3 ? 1 : 0)), b.loot[k])
          found[k] = n
          b.loot[k] -= n
          p.carry[k] += n
        }
        p.skills.scavenging = Math.min(10, p.skills.scavenging + 0.05)
        // Ammo for their own gun goes straight in the gun.
        if (weaponInfo(p.weapon).gun && p.carry.ammo > 0) {
          const take = Math.min(p.carry.ammo, 30 - p.ammo)
          if (take > 0) {
            p.ammo += take
            p.carry.ammo -= take
          }
        }
        g.known[b.id] = { tick: w.tick, loot: { ...b.loot } }
        if (!p.pending.buildings.includes(b.id)) p.pending.buildings.push(b.id)
        // Sometimes they find a better weapon.
        if (p.weapon === 'none' || (p.weapon === 'knife' && chance(w, 0.15))) {
          if (chance(w, b.kind === 'police' ? 0.8 : 0.15)) {
            const wp: Weapon = b.kind === 'police' ? pick(w, ['pistol', 'shotgun', 'rifle'] as Weapon[]) : pick(w, ['bat', 'machete', 'knife', 'pistol'] as Weapon[])
            p.weapon = wp
            if (weaponInfo(wp).gun) p.ammo = Math.max(p.ammo, int(w, 4, 12))
            personLog(w, p, `Found a ${weaponInfo(wp).label.toLowerCase()} at ${b.name}.`)
          }
        }
      }
      goBack(w, p)
      return
    }
    case 'explore': {
      if (w.tick < (t.until ?? 0)) return
      const m = minuteOfDay(w.tick)
      if (m < 14 * 60 && chance(w, 0.6) && g.camp) {
        const ex = exploreTarget(w, g, p.x, p.y)
        p.task = { ...t, phase: 'go', x: ex.x, y: ex.y, until: 30 }
      } else if (g.camp) goBack(w, p)
      else {
        // A group on the move: keep going.
        const ex = exploreTarget(w, g, p.x, p.y)
        p.task = { ...t, phase: 'go', x: ex.x, y: ex.y, until: 20 }
        g.homeX = p.x
        g.homeY = p.y
      }
      return
    }
    case 'hunt': {
      if (w.tick < (t.until ?? 0)) return
      const skill = (p.skills.fighting + p.skills.shooting) / 2
      const got = Math.max(0, Math.round(between(w, -1, 2 + skill * 0.6)))
      p.carry.food += got
      if (got) personLog(w, p, `Caught enough for ${got} meals.`)
      if (weaponInfo(p.weapon).gun && p.weapon !== 'crossbow' && got && !hasLesson(g, 'quiet') && p.ammo > 0) {
        p.ammo--
        raiseNoise(w, g, p, 35)
      }
      goBack(w, p)
      return
    }
    case 'water': {
      if (w.tick < (t.until ?? 0)) return
      p.carry.water = CARRY.water
      goBack(w, p)
      return
    }
    case 'fortify': {
      const camp = campOf(w, g)
      if (!camp || camp.fort >= 100) {
        setHome(w, p, 'camp')
        return
      }
      if (g.stash.parts <= 0) {
        setHome(w, p, 'camp')
        return
      }
      const add = 0.03 + p.skills.building * 0.012
      camp.fort = Math.min(100, camp.fort + add)
      if (Math.floor(camp.fort / 4) !== Math.floor((camp.fort - add) / 4)) g.stash.parts--
      p.skills.building = Math.min(10, p.skills.building + 0.0015)
      if (w.tick % 30 === 0) {
        const s = campSpot(w, camp)
        t.x = s.x
        t.y = s.y
      }
      if (w.tick > (t.until ?? 0)) setHome(w, p, 'camp')
      return
    }
    case 'camp':
    case 'guard':
    case 'rest': {
      // Pottering about camp.
      if (chance(w, 0.01)) {
        const camp = campOf(w, g)
        const s = camp ? campSpot(w, camp) : { x: g.homeX + between(w, -2, 2), y: g.homeY + between(w, -2, 2) }
        t.x = s.x
        t.y = s.y
      }
      return
    }
    default:
      return
  }
}

/** Walkers near someone: fight, shoot, or run. */
function react(w: SurvivalWorld, g: Group, p: Person, near: Walker[]): boolean {
  if (!near.length) return false
  const camp = campOf(w, g)
  const behindWalls = !!camp && camp.fort > 5 && inside(camp, p.x, p.y)
  let closest = near[0]
  let cd = Infinity
  for (const z of near) {
    const d = dist(z.x, z.y, p.x, p.y)
    if (d < cd) {
      cd = d
      closest = z
    }
  }
  if (p.asleep) {
    if (cd < 2.5 || chance(w, 0.05)) {
      p.asleep = false
      personLog(w, p, 'Woke up to walkers.')
    } else return false
  }
  noteDanger(w, g, p, near.length)

  const friends = w.people.filter((q) => q.group === g.id && q !== p && !q.held && !q.asleep && dist(q.x, q.y, p.x, p.y) < 6).length
  const courage = (has(p, 'brave') ? 4 : has(p, 'cautious') ? 1 : 2) + friends * 1.5 + (behindWalls ? 6 : 0) + (p.weapon !== 'none' ? 1 : 0) + (isKid(p) ? -2 : 0)
  const gun = weaponInfo(p.weapon).gun && p.ammo > 0
  const tooMany = near.length > courage && !behindWalls

  if (tooMany || p.health < 25 || isKid(p)) {
    if (p.fleeUntil <= w.tick && w.tick - p.lastFled > 180) {
      personLog(w, p, `Ran from ${near.length} walker${near.length > 1 ? 's' : ''}.`)
      p.lastFled = w.tick
    }
    if (p.fleeUntil <= w.tick) {
      p.fleeUntil = w.tick + 25
    }
    let fx = 0
    let fy = 0
    for (const z of near) {
      const d = Math.max(0.5, dist(z.x, z.y, p.x, p.y))
      fx += (p.x - z.x) / d
      fy += (p.y - z.y) / d
    }
    const l = Math.hypot(fx, fy) || 1
    p.fleeX = clamp(p.x + (fx / l) * 20, 1, MAP_W - 1)
    p.fleeY = clamp(p.y + (fy / l) * 20, 1, MAP_H - 1)
    // Cornered: swing anyway.
    if (cd < 1.1 && chance(w, 0.5)) melee(w, g, p, closest, behindWalls)
    return true
  }

  // Shoot, if it's that kind of person or that kind of group, or there are a lot of them.
  const shootFirst = hasLesson(g, 'trigger') || has(p, 'hothead')
  const quiet = hasLesson(g, 'quiet') && near.length < 5
  if (gun && !quiet && (shootFirst || near.length >= 3 || (cd < 3 && near.length >= 2)) && cd < 12 && w.tick % 2 === 0) {
    p.ammo--
    if (chance(w, 0.3 + p.skills.shooting * 0.055)) killWalker(w, g, p, closest, true)
    p.skills.shooting = Math.min(10, p.skills.shooting + 0.02)
    raiseNoise(w, g, p, 45)
    return true
  }
  if (cd < 1.3) {
    melee(w, g, p, closest, behindWalls)
    return true
  }
  if (behindWalls) return false
  // Step in to fight.
  moveToward(p, closest.x, closest.y, speedOf(w, p, false))
  return true
}

function melee(w: SurvivalWorld, g: Group, p: Person, z: Walker, walls: boolean): void {
  const pChance = 0.08 + p.skills.fighting * 0.025 + weaponInfo(p.weapon).melee + (walls ? 0.2 : 0) - (p.lostLimb === 'arm' ? 0.1 : 0)
  if (chance(w, pChance)) {
    killWalker(w, g, p, z, false)
    p.skills.fighting = Math.min(10, p.skills.fighting + 0.03)
  }
}

function killWalker(w: SurvivalWorld, g: Group, p: Person, z: Walker, gun: boolean): void {
  const i = w.walkers.indexOf(z)
  if (i < 0) return
  w.walkers.splice(i, 1)
  p.kills++
  if (gun) g.gunKillsToday++
  if (z.was) log(w, `${p.name.split(' ')[0]} put down what used to be ${z.was}.`, { group: g.id, people: [p] })
}

function raiseNoise(w: SurvivalWorld, g: Group, p: Person, r: number): void {
  const drawn = makeNoise(w, p.x, p.y, r)
  g.noiseDrew += drawn
  if (!g.noiseWho) g.noiseWho = p.name.split(' ')[0]
}

function personTick(w: SurvivalWorld, g: Group, p: Person, grid: Grid, buf: Walker[]): void {
  needsTick(w, g, p)
  if (p.health <= 0) {
    die(w, p, p.hunger >= 100 ? 'starved' : p.thirst >= 100 ? 'died of thirst' : 'died of their wounds')
    return
  }
  if (p.bitten && w.tick >= p.bitten.turnsAt) {
    die(w, p, 'died from a bite')
    return
  }
  if (p.held) {
    heldTick(w, p)
    return
  }
  if (p.bitten && !p.bitten.asked && w.tick % 10 === 0) {
    biteDecision(w, g, p)
    if (w.pending.length) return
  }
  const fight = w.fights.length && p.fleeUntil <= w.tick ? fightFor(w, p) : undefined
  if (fight) {
    fightTick(w, g, p, fight)
    return
  }

  const sight = Math.min(sightOf(w, p), 9)
  const near = grid.near(p.x, p.y, p.asleep ? 2.5 : sight, buf)
  if (react(w, g, p, near)) {
    if (p.fleeUntil > w.tick) moveToward(p, p.fleeX, p.fleeY, speedOf(w, p, true))
    return
  }
  if (p.fleeUntil > w.tick) {
    if (moveToward(p, p.fleeX, p.fleeY, speedOf(w, p, true))) p.fleeUntil = 0
    return
  }
  if (p.fleeUntil > 0) {
    p.fleeUntil = 0
    // Shaken up: hurt or bitten people head home; others carry on.
    if (p.health < 50 || p.bitten) goBack(w, p)
  }
  if (p.asleep) return

  const t = p.task
  if (t.kind === 'follow') {
    const lead = personById(w, t.with?.[0] ?? -1)
    if (!lead || lead.group !== p.group) {
      setHome(w, p, 'camp')
      return
    }
    const d = dist(p.x, p.y, lead.x, lead.y)
    if (d > 2.5) moveToward(p, lead.x + between(w, -1.5, 1.5), lead.y + between(w, -1.5, 1.5), speedOf(w, p, d > 10))
    return
  }
  if (t.phase === 'go') {
    if (moveToward(p, t.x, t.y, speedOf(w, p, false))) {
      if (t.kind === 'move' && g.leaving) {
        t.phase = 'work'
        return
      }
      if (t.kind === 'move') {
        setHome(w, p, 'camp')
        return
      }
      t.phase = 'work'
      t.until = w.tick + (t.until ?? 60)
    }
    return
  }
  if (t.phase === 'back') {
    if (moveToward(p, t.x, t.y, speedOf(w, p, false))) arriveHome(w, g, p)
    return
  }
  if (g.leaving && t.kind === 'move') return // Waiting at the road out for the others.
  // Working: drift toward the work spot, then do it.
  if (dist(p.x, p.y, t.x, t.y) > 0.3) moveToward(p, t.x, t.y, speedOf(w, p, false) * 0.5)
  doWork(w, g, p)
}

// ---------- bites, death and turning ----------

function bite(w: SurvivalWorld, p: Person): void {
  p.health -= between(w, 8, 20)
  if (p.bitten) return
  const roll = random(w)
  const limb: Bite['limb'] = roll < 0.45 ? 'arm' : roll < 0.8 ? 'leg' : 'neck'
  p.bitten = { at: w.tick, limb, turnsAt: w.tick + int(w, 12 * 60, 30 * 60), cutBy: w.tick + 50 }
  const g = groupById(w, p.group)
  log(w, `${p.name} was bitten on the ${limb}.`, { group: g?.id, people: [p], big: true })
  if (g) {
    const alone = !w.people.some((q) => q.group === g.id && q !== p && !q.held && dist(q.x, q.y, p.x, p.y) < 10)
    if (alone && !isAtCamp(w, p) && !hasLesson(g, 'pairs')) learn(w, g, 'pairs', `${p.name.split(' ')[0]} was bitten out there with nobody to help.`)
    g.lossesToday++
    biteDecision(w, g, p)
  }
}

function biteDecision(w: SurvivalWorld, g: Group, p: Person): void {
  const b = p.bitten
  if (!b || b.asked) return
  const helper = w.people.find((q) => q.group === g.id && q !== p && !q.held && !q.asleep && dist(q.x, q.y, p.x, p.y) < 5 && !isKid(q))
  const inTime = b.limb !== 'neck' && w.tick <= b.cutBy
  const canCut = inTime && !!helper
  if (inTime && !helper) return // Nobody to do it yet. They might get back in time.
  if (!helper && !isAtCamp(w, p)) return // Out there alone: the others find out when they're back.
  b.asked = true
  const medic = membersOf(w, g).reduce((m, q) => Math.max(m, q.skills.medicine), 0)
  if (g.ask) {
    const options: DecisionOption[] = canCut
      ? [
          { id: 'cut', label: `Cut off the ${b.limb}`, hint: `Painful and they might bleed out, but it's the only chance. Best medic skill: ${Math.round(medic)}/10.` },
          { id: 'wait', label: 'Wait and hope', hint: "They'll almost certainly turn in a day or so." },
          { id: 'end', label: 'Put them down now', hint: 'A mercy, before they turn.' }
        ]
      : [
          { id: 'wait', label: 'Let them say goodbye', hint: "They'll die and turn in a day or so. Someone has to be there when it happens." },
          { id: 'end', label: 'Put them down now', hint: 'A mercy, before they turn.' }
        ]
    w.pending.push({
      id: w.nextId++,
      group: g.id,
      kind: 'bite',
      title: `${p.name} has been bitten`,
      text: canCut
        ? `It's on the ${b.limb}. If it comes off in the next few minutes, ${p.name.split(' ')[0]} might live.`
        : b.limb === 'neck'
          ? `It's on the neck. There's nothing anyone can do.`
          : `It's on the ${b.limb}, but it happened too long ago for cutting it off to help.`,
      options,
      auto: canCut && (hasLesson(g, 'bitten') || medic >= 4 || chance(w, 0.5)) ? 'cut' : 'wait',
      data: { person: p.id }
    })
    return
  }
  const auto = canCut && (hasLesson(g, 'bitten') || medic >= 4 || has(helper as Person, 'steady') || has(helper as Person, 'brave') || chance(w, 0.4)) ? 'cut' : 'wait'
  applyBite(w, g, p, auto)
}

function applyBite(w: SurvivalWorld, g: Group, p: Person, choice: string): void {
  if (!p.bitten) return
  if (choice === 'cut') {
    const ms = membersOf(w, g)
    const medic = ms.reduce((a, q) => (q.skills.medicine > a.skills.medicine && q !== p ? q : a), ms.find((q) => q !== p) ?? p)
    const usedMeds = g.stash.meds > 0
    if (usedMeds) g.stash.meds--
    const odds = 0.45 + medic.skills.medicine * 0.04 + (usedMeds ? 0.1 : 0) - w.harshness * 0.1
    const limb = p.bitten.limb
    if (chance(w, odds)) {
      p.bitten = null
      p.lostLimb = limb
      p.health = 22
      p.morale -= 15
      medic.skills.medicine = Math.min(10, medic.skills.medicine + 0.4)
      log(w, `${medic.name.split(' ')[0]} cut off ${p.name.split(' ')[0]}'s ${limb}. ${p.name.split(' ')[0]} survived.`, { group: g.id, people: [p, medic], big: true })
      p.rel[medic.id] = clamp((p.rel[medic.id] ?? 0) + 30, -100, 100)
      setHome(w, p, 'rest')
    } else {
      log(w, `${medic.name.split(' ')[0]} tried to cut off ${p.name.split(' ')[0]}'s ${limb}, but ${p.name.split(' ')[0]} bled out.`, { group: g.id, people: [p, medic], big: true })
      die(w, p, 'bled out after losing a limb', true)
    }
  } else if (choice === 'end') {
    const by = membersOf(w, g).find((q) => q !== p && !isKid(q))
    log(w, `${by ? by.name.split(' ')[0] : 'The group'} put ${p.name.split(' ')[0]} down before the bite could take them.`, { group: g.id, people: by ? [p, by] : [p], big: true })
    die(w, p, 'was put down after a bite', true)
  } else {
    setHome(w, p, 'rest')
    personLog(w, p, 'Waiting to see what happens.')
  }
}

function die(w: SurvivalWorld, p: Person, cause: string, dealtWith = false): void {
  // A prisoner isn't mourned by the people holding them; their own group (if it's still out there) is told below.
  const home = p.held ? groupById(w, p.held.from) : undefined
  const g = p.held ? undefined : groupById(w, p.group)
  const i = w.people.indexOf(p)
  if (i < 0) return
  w.people.splice(i, 1)
  // Anything they were carrying is dropped where they fell (lost).
  const text = `${p.name} ${cause}.`
  if (!cause.startsWith('bled out') && !cause.startsWith('was put down')) log(w, text, { group: g?.id ?? p.group, people: [p], big: true })
  else personLog(w, p, text)
  w.fallen.push({ id: p.id, name: p.name, group: p.held ? p.held.from : p.group, groupName: (g ?? home)?.name ?? '', tick: w.tick, cause, log: p.log, age: p.age })
  for (const q of w.people) {
    if (q.partner === p.id) q.partner = null
    if (q.family.includes(p.id)) q.family = q.family.filter((id) => id !== p.id)
  }
  if (g) {
    g.lossesToday++
    for (const q of w.people) {
      if (q.group !== g.id) continue
      const close = (q.rel[p.id] ?? 0) > 40
      q.morale = Math.max(0, q.morale - (close ? 22 : 8) * (has(q, 'steady') ? 0.6 : 1))
      if (close) {
        q.grief = Math.max(q.grief, 3 * DAY)
        personLog(w, q, `Lost ${p.name.split(' ')[0]}.`)
      }
      delete q.rel[p.id]
    }
    if (g.leader === p.id) pickLeader(w, g)
    // Lost someone on a run: some groups get scared to go out at all.
    if (!isAtCamp(w, p) && cause !== 'died from a bite' && !hasLesson(g, 'hide') && chance(w, 0.4)) {
      const scared = membersOf(w, g).filter((q) => has(q, 'cautious') || has(q, 'paranoid')).length
      if (scared > 0 || chance(w, 0.3)) learn(w, g, 'hide', `Losing ${p.name.split(' ')[0]} on a run scared them.`)
    }
    if (!membersOf(w, g).length) groupGone(w, g)
  }
  if (!dealtWith) w.corpses.push({ x: p.x, y: p.y, turnsAt: w.tick + int(w, 4, 14), name: p.name, person: p.id, group: p.group })
}

function corpseTick(w: SurvivalWorld): void {
  for (let i = w.corpses.length - 1; i >= 0; i--) {
    const c = w.corpses[i]
    // Someone close and awake deals with the body before it gets up.
    const by = w.people.find((q) => q.group === c.group && !q.asleep && !isKid(q) && dist(q.x, q.y, c.x, c.y) < 7)
    if (by) {
      w.corpses.splice(i, 1)
      log(w, `${by.name.split(' ')[0]} made sure ${c.name.split(' ')[0]} wouldn't come back.`, { group: c.group, people: [by] })
      by.morale -= has(by, 'kind') ? 8 : 3
      continue
    }
    if (w.tick < c.turnsAt) continue
    w.corpses.splice(i, 1)
    w.walkers.push({ id: w.nextId++, x: c.x, y: c.y, tx: c.x, ty: c.y, chase: null, herd: null, was: c.name, busyUntil: 0 })
    log(w, `${c.name} came back as a walker.`, { group: c.group, big: true })
    const g = groupById(w, c.group)
    if (g?.alive) {
      const camp = campOf(w, g)
      if (camp && dist(c.x, c.y, camp.x + camp.w / 2, camp.y + camp.h / 2) < Math.max(camp.w, camp.h) + 3) {
        if (!hasLesson(g, 'bitten')) learn(w, g, 'bitten', `${c.name.split(' ')[0]} turned inside the camp.`)
        if (isNight(w.tick) && !hasLesson(g, 'watch')) learn(w, g, 'watch', `${c.name.split(' ')[0]} turned in the night while everyone slept.`)
      }
    }
  }
}

// ---------- lessons ----------

function learn(w: SurvivalWorld, g: Group, id: LessonId, why: string): void {
  if (hasLesson(g, id)) return
  // Some lessons replace others.
  const undo: Partial<Record<LessonId, LessonId>> = { quiet: 'trigger', trigger: 'quiet', stockpile: 'hide', welcome: 'distrust', distrust: 'welcome' }
  const drop = undo[id]
  if (drop && hasLesson(g, drop)) {
    if (id === 'trigger') return // Once they know gunshots bring the dead, a good day with guns won't change it.
    g.lessons = g.lessons.filter((l) => l.id !== drop)
    log(w, `${g.name} let go of "${LESSONS[drop].title}".`, { group: g.id })
  }
  g.lessons.push({ id, tick: w.tick, why })
  log(w, `${g.name} learned: "${LESSONS[id].title}". ${why}`, { group: g.id, big: true })
}

function dayEnd(w: SurvivalWorld, g: Group): void {
  prisonersDay(w, g)
  if (!g.alive) return
  lifeDay(w, g, g.lossesToday)
  if (!g.alive) return
  // A good day with guns, and nothing bad came of it: a dangerous lesson.
  if (g.gunKillsToday >= 5 && g.lossesToday === 0 && !hasLesson(g, 'quiet')) learn(w, g, 'trigger', `They put down ${g.gunKillsToday} walkers with guns today and nobody got hurt.`)
  g.gunKillsToday = 0
  g.lossesToday = 0
  const ms = membersOf(w, g)
  if (ms.length > g.peak) g.peak = ms.length
  const n = Math.max(1, ms.length)
  if (ms.some((p) => p.hunger > 85 || p.thirst > 85)) learn(w, g, 'stockpile', `They went hungry and thirsty with nothing put by.`)
  if (ms.length) {
    const food = Math.floor(g.stash.food / (n * 2))
    const water = Math.floor(g.stash.water / (n * 2))
    log(w, `Day ${dayOf(w.tick)} for ${g.name}: ${ms.length} ${ms.length === 1 ? 'person' : 'people'}, food for ${food} day${food === 1 ? '' : 's'}, water for ${water}.`, { group: g.id })
  }
  // Getting along, or not.
  for (const p of ms)
    for (const q of ms) {
      if (p === q) continue
      let d = between(w, -1, 3)
      if (has(p, 'selfish') && has(q, 'kind')) d -= 2
      if (has(p, 'hothead') && has(q, 'hothead')) d -= 3
      if (has(p, 'loyal')) d += 1
      if (p.task.with?.includes(q.id)) d += 3
      p.rel[q.id] = clamp((p.rel[q.id] ?? 0) + d, -100, 100)
    }
  // Every few days: is there somewhere better to live?
  const camp = campOf(w, g)
  if (camp && dayOf(w.tick) % 3 === 0) {
    const best = campCandidates(w, g)[0]
    const now = campScore(w, g, camp)
    if (best && best.b.id !== camp.id && best.score > now + 12) {
      if (g.ask && !g.hostile) {
        w.pending.push({
          id: w.nextId++,
          group: g.id,
          kind: 'camp',
          title: `${g.name} wants to move camp`,
          text: `They think ${best.b.name} would be better than ${camp.name}.`,
          options: [
            { id: String(best.b.id), label: `Move to ${best.b.name}`, hint: `${BUILDING_LABEL[best.b.kind]}${best.b.town ? ` in ${best.b.town}` : ''}` },
            { id: 'none', label: `Stay at ${camp.name}`, hint: 'Keep what they have' }
          ],
          auto: String(best.b.id),
          data: {}
        })
      } else setCamp(w, g, best.b, `It's ${ms.length > (camp.w * camp.h) / 2 ? 'roomier' : 'safer'} than ${camp.name}.`)
    }
  }
}

// ---------- life goes on: couples, babies, falling out ----------

/** How long a baby takes, in steps. */
export const PREGNANCY = 270 * DAY

const isAdult = (p: Person): boolean => p.age >= 18

/** Once a day: people pair up, have babies when it's safe, fall out, blame the leader, and sometimes split off. */
function lifeDay(w: SurvivalWorld, g: Group, losses: number): void {
  const ms = membersOf(w, g)
  if (!ms.length) return
  const day = dayOf(w.tick)
  // Birthdays: everyone gets a year older each year.
  if (day > START_DAY && (day - START_DAY) % 365 === 0) for (const p of [...ms, ...prisonersOf(w, g)]) p.age++

  // Pairing up.
  for (const p of ms) {
    if (p.partner != null || !isAdult(p) || p.age > 65) continue
    for (const q of ms) {
      if (q === p || q.partner != null || !isAdult(q) || q.sex === p.sex || p.family.includes(q.id) || Math.abs(p.age - q.age) > 15) continue
      if ((p.rel[q.id] ?? 0) >= 70 && (q.rel[p.id] ?? 0) >= 70 && chance(w, 0.12)) {
        p.partner = q.id
        q.partner = p.id
        log(w, `${p.name.split(' ')[0]} and ${q.name.split(' ')[0]} are together now.`, { group: g.id, people: [p, q], big: true })
        break
      }
    }
  }

  // Babies, when it feels safe enough.
  const camp = campOf(w, g)
  const fedDays = Math.min(g.stash.food, g.stash.water) / (ms.length * 2)
  const safe = !!camp && camp.fort >= 30 && fedDays >= 4 && losses === 0 && !w.fights.some((f) => f.a === g.id || f.b === g.id)
  for (const p of ms) {
    if (p.sex !== 'f') continue
    if (p.dueAt > 0) {
      if (w.tick >= p.dueAt) birth(w, g, p)
      continue
    }
    const partner = p.partner != null ? personById(w, p.partner) : undefined
    if (!safe || !partner || partner.group !== g.id || partner.held || p.age < 18 || p.age > 44 || p.bitten) continue
    if (chance(w, 0.03)) {
      p.dueAt = w.tick + PREGNANCY
      log(w, `${p.name.split(' ')[0]} is pregnant. ${partner.name.split(' ')[0]} is the father.`, { group: g.id, people: [p, partner], big: true })
    }
  }

  // Falling out.
  for (const p of ms)
    for (const q of ms) {
      if (p.id >= q.id || !isAtCamp(w, p) || !isAtCamp(w, q)) continue
      const bad = Math.min(p.rel[q.id] ?? 0, q.rel[p.id] ?? 0)
      if (bad > -30 || !chance(w, 0.15)) continue
      p.morale = Math.max(0, p.morale - 5)
      q.morale = Math.max(0, q.morale - 5)
      p.rel[q.id] = clamp((p.rel[q.id] ?? 0) - 4, -100, 100)
      q.rel[p.id] = clamp((q.rel[p.id] ?? 0) - 4, -100, 100)
      if (has(p, 'hothead') && has(q, 'hothead') && chance(w, 0.3)) {
        p.health -= between(w, 5, 15)
        q.health -= between(w, 5, 15)
        log(w, `${p.name.split(' ')[0]} and ${q.name.split(' ')[0]} came to blows.`, { group: g.id, people: [p, q], big: true })
      } else log(w, `${p.name.split(' ')[0]} and ${q.name.split(' ')[0]} had a bad argument.`, { group: g.id, people: [p, q] })
    }

  // A bad day: some blame whoever's in charge.
  const lead = g.decide === 'leader' ? personById(w, g.leader ?? -1) : undefined
  if (lead && losses > 0)
    for (const p of ms) {
      if (p === lead || has(p, 'loyal') || p.partner === lead.id || p.family.includes(lead.id)) continue
      p.rel[lead.id] = clamp((p.rel[lead.id] ?? 0) - losses * (has(p, 'hothead') || has(p, 'paranoid') ? 12 : 6), -100, 100)
    }

  // Enough of them can't stand the leader: they leave and start their own group.
  if (lead && ms.length >= 6 && !g.hostile) {
    const fed = ms.filter((p) => p !== lead && (p.rel[lead.id] ?? 0) < -40)
    if (fed.length >= 2 && chance(w, 0.35)) splitGroup(w, g, lead, fed)
  }
}

function birth(w: SurvivalWorld, g: Group, mother: Person): void {
  mother.dueAt = 0
  const father = mother.partner != null ? personById(w, mother.partner) : undefined
  const surname = surnameOf(father ?? mother) || surnameOf(mother)
  const draft = randomPerson(w, takenNames(w), { age: 0, surname, culture: w.map.culture })
  draft.traits = draft.traits.slice(0, 2)
  draft.weapon = 'none'
  const baby = newPerson(w, draft, g, mother.x, mother.y)
  baby.family = [mother.id, ...(father ? [father.id] : [])]
  for (const pid of baby.family) {
    const parent = personById(w, pid)
    if (!parent) continue
    parent.family.push(baby.id)
    parent.rel[baby.id] = 95
    baby.rel[parent.id] = 95
    parent.morale = Math.min(100, parent.morale + 25)
  }
  w.people.push(baby)
  setHome(w, baby, 'camp')
  const ms = membersOf(w, g)
  for (const q of ms) if (q !== mother && q !== father) q.morale = Math.min(100, q.morale + 8)
  const medic = ms.reduce((a, q) => Math.max(a, q.skills.medicine), 0)
  const usedMeds = g.stash.meds > 0
  if (usedMeds) g.stash.meds--
  log(w, `${mother.name.split(' ')[0]} had a baby: ${baby.name}.`, { group: g.id, people: [mother, baby], big: true })
  if (chance(w, Math.max(0.01, 0.08 - medic * 0.006 - (usedMeds ? 0.02 : 0)))) die(w, mother, 'died giving birth', false)
}

function splitGroup(w: SurvivalWorld, g: Group, lead: Person, fed: Person[]): void {
  const leaving = new Set(fed)
  // Partners, families and close friends go with them.
  for (const p of membersOf(w, g)) {
    if (p === lead || leaving.has(p)) continue
    const toLeaver = Math.max(...fed.map((q) => p.rel[q.id] ?? 0))
    if (fed.some((q) => q.partner === p.id || q.family.includes(p.id)) || (toLeaver > 50 && toLeaver > (p.rel[lead.id] ?? 0) + 20)) leaving.add(p)
  }
  const out = [...leaving]
  if (out.length >= membersOf(w, g).length) return
  const head = out.reduce((a, b) => (b.skills.leadership > a.skills.leadership ? b : a))
  const color = GROUP_COLORS.find((c) => !w.groups.some((o) => o.alive && o.color === c)) ?? GROUP_COLORS[(w.groups.length + 1) % GROUP_COLORS.length]
  const ng = newGroup(w, { name: `${surnameOf(head) || head.name}'s group`, color, people: [], decide: 'leader', ask: g.ask }, head.x, head.y)
  ng.peak = out.length
  w.groups.push(ng)
  const share = out.length / membersOf(w, g).length
  for (const k of SUPPLY_KEYS) {
    const n = Math.floor(g.stash[k] * share)
    g.stash[k] -= n
    ng.stash[k] = n
  }
  for (const p of out) {
    p.group = ng.id
    p.task = { kind: 'follow', phase: 'work', x: head.x, y: head.y, with: [head.id] }
  }
  head.task = { kind: 'camp', phase: 'work', x: head.x, y: head.y }
  ng.seen.set(g.seen)
  ng.danger.set(g.danger)
  ng.known = { ...g.known }
  ng.creeks = [...g.creeks]
  ng.lessons = g.lessons.map((l) => ({ ...l }))
  g.met[ng.id] = 'avoid'
  ng.met[g.id] = 'avoid'
  pickLeader(w, ng)
  log(w, `${out.length} people had enough of ${lead.name.split(' ')[0]} and left ${g.name}, led by ${head.name}. They're ${ng.name} now.`, { group: g.id, people: out, big: true })
  planNow(w, ng)
}

// ---------- meeting other groups ----------

function encounters(w: SurvivalWorld): void {
  const live = w.groups.filter((g) => g.alive)
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (a.met[b.id] && a.met[b.id] !== 'ally' && !(a.hostile || b.hostile)) continue
      const am = membersOf(w, a)
      const bm = membersOf(w, b)
      let pa: Person | null = null
      let pb: Person | null = null
      outer: for (const p of am)
        for (const q of bm)
          if (dist(p.x, p.y, q.x, q.y) < Math.min(sightOf(w, p), 12)) {
            pa = p
            pb = q
            break outer
          }
      if (!pa || !pb) continue
      if (a.met[b.id] === 'ally') {
        // Old friends: they swap news.
        if (w.tick % 120 === 0) shareKnowledge(a, b)
        continue
      }
      // Enemies who've already fought keep apart for a while.
      if (a.met[b.id] === 'enemy' && w.tick - (a.fought[b.id] ?? -Infinity) < DAY) continue
      meet(w, a, b, pa, pb)
    }
}

function attitude(w: SurvivalWorld, g: Group, other?: Group): 'rob' | 'attack' | 'refuse' | 'talk' | 'invite' {
  if (g.hostile) return 'rob'
  const lead = personById(w, g.leader ?? -1)
  if (hasLesson(g, 'distrust')) return membersOf(w, g).some((p) => has(p, 'hothead')) ? 'attack' : 'refuse'
  if (hasLesson(g, 'welcome') || (lead && has(lead, 'kind'))) return 'invite'
  if (lead && has(lead, 'paranoid')) return 'refuse'
  // A stranger or two on their own: most groups would rather have the extra hands.
  if (other && membersOf(w, other).length <= 2 && membersOf(w, g).length >= 2) return 'invite'
  return 'talk'
}

function meet(w: SurvivalWorld, a: Group, b: Group, pa: Person, pb: Person): void {
  const where = nearestPlace(w, pa.x, pa.y)
  a.met[b.id] = 'avoid'
  b.met[a.id] = 'avoid'
  log(w, `${a.name} ran into ${b.name} ${where}.`, { group: a.id, people: [pa, pb], big: true })
  w.log[w.log.length - 1].people = [pa.id, pb.id]
  const robber = a.hostile ? a : b.hostile ? b : null
  if (robber && !(a.hostile && b.hostile)) {
    const victim = robber === a ? b : a
    if (victim.ask) {
      w.pending.push({
        id: w.nextId++,
        group: victim.id,
        kind: 'robbed',
        title: `${robber.name} wants ${victim.name}'s supplies`,
        text: `They have ${membersOf(w, robber).length} people and they're armed. ${victim.name} has ${membersOf(w, victim).length}.`,
        options: [
          { id: 'pay', label: 'Hand over supplies', hint: 'Lose half of what they have, but nobody gets hurt.' },
          { id: 'fight', label: 'Fight back', hint: 'People could die on both sides.' }
        ],
        auto: strength(w, victim) > strength(w, robber) * 0.9 || has(personById(w, victim.leader ?? -1) ?? pa, 'hothead') ? 'fight' : 'pay',
        data: { robber: robber.id, victim: victim.id }
      })
    } else {
      const fight = strength(w, victim) > strength(w, robber) * 0.9 || membersOf(w, victim).some((p) => has(p, 'hothead'))
      resolveRobbery(w, robber, victim, fight ? 'fight' : 'pay')
    }
    return
  }
  if (a.hostile && b.hostile) {
    startFight(w, a, b)
    return
  }
  // Two ordinary groups. Each decides how it feels about the other; you decide for groups set to ask.
  for (const [g, other] of [
    [a, b],
    [b, a]
  ] as const) {
    if (g.ask) {
      w.pending.push({
        id: w.nextId++,
        group: g.id,
        kind: 'meet',
        title: `${g.name} met ${other.name}`,
        text: `${other.name} has ${membersOf(w, other).length} people. What should ${g.name} do?`,
        options: [
          { id: 'invite', label: 'Invite them in', hint: 'Join up into one bigger group.' },
          { id: 'talk', label: 'Trade news and part ways', hint: 'Share what each knows about the area, and stay friendly.' },
          { id: 'refuse', label: 'Turn them away', hint: 'Keep their distance.' },
          { id: 'attack', label: 'Attack them', hint: 'Take what they have. People will die.' }
        ],
        auto: attitude(w, g, other),
        data: { a: g.id, b: other.id }
      })
    }
  }
  if (!a.ask && !b.ask) settleMeeting(w, a, b, attitude(w, a, b), attitude(w, b, a))
  else if (!a.ask) w.waiting[a.id + ':' + b.id] = attitude(w, a, b)
  else if (!b.ask) w.waiting[b.id + ':' + a.id] = attitude(w, b, a)
}

function shareKnowledge(a: Group, b: Group): void {
  for (let c = 0; c < a.seen.length; c++) {
    if (b.seen[c] > a.seen[c]) {
      a.seen[c] = b.seen[c]
      a.danger[c] = b.danger[c]
    } else if (a.seen[c] > b.seen[c]) {
      b.seen[c] = a.seen[c]
      b.danger[c] = a.danger[c]
    }
  }
  for (const [k, v] of Object.entries(a.known)) if (!b.known[Number(k)]) b.known[Number(k)] = v
  for (const [k, v] of Object.entries(b.known)) if (!a.known[Number(k)]) a.known[Number(k)] = v
  for (const c of a.creeks) if (!b.creeks.includes(c)) b.creeks.push(c)
  for (const c of b.creeks) if (!a.creeks.includes(c)) a.creeks.push(c)
}

function settleMeeting(w: SurvivalWorld, a: Group, b: Group, sa: string, sb: string): void {
  if (sa === 'attack' || sb === 'attack') {
    const attacker = sa === 'attack' ? a : b
    const other = attacker === a ? b : a
    log(w, `${attacker.name} attacked ${other.name}.`, { group: attacker.id, big: true })
    startFight(w, attacker, other)
    return
  }
  if (sa === 'refuse' || sb === 'refuse') {
    log(w, `${sa === 'refuse' ? a.name : b.name} wanted nothing to do with ${sa === 'refuse' ? b.name : a.name}. They went their separate ways.`, { group: a.id })
    return
  }
  if (sa === 'invite' || sb === 'invite') {
    const an = membersOf(w, a).length
    const bn = membersOf(w, b).length
    // The bigger group takes the smaller one in.
    const host = an === bn ? (sa === 'invite' ? a : b) : an > bn ? a : b
    const guest = host === a ? b : a
    const guestWants = (guest === a ? sa : sb) === 'invite' || membersOf(w, guest).length <= 3 || chance(w, 0.4)
    const hostWants = (host === a ? sa : sb) !== 'refuse'
    if (guestWants && hostWants) {
      merge(w, host, guest)
      return
    }
  }
  a.met[b.id] = 'ally'
  b.met[a.id] = 'ally'
  shareKnowledge(a, b)
  log(w, `${a.name} and ${b.name} traded news about the area and parted as friends.`, { group: a.id })
}

function merge(w: SurvivalWorld, host: Group, guest: Group): void {
  const guests = membersOf(w, guest)
  const hosts = membersOf(w, host)
  for (const p of guests) {
    p.group = host.id
    for (const q of hosts) {
      p.rel[q.id] = int(w, 0, 20)
      q.rel[p.id] = int(w, 0, 20)
    }
    p.morale = Math.min(100, p.morale + 10)
    setHome(w, p, 'camp')
    const camp = campOf(w, host)
    if (camp) {
      const s = campSpot(w, camp)
      p.task = { kind: 'move', phase: 'go', x: s.x, y: s.y, building: camp.id }
    }
  }
  for (const p of prisonersOf(w, guest)) p.group = host.id
  for (const p of w.people) if (p.held?.from === guest.id) p.held.from = host.id
  for (const k of SUPPLY_KEYS) {
    host.stash[k] += guest.stash[k]
    guest.stash[k] = 0
  }
  shareKnowledge(host, guest)
  guest.alive = false
  const n = hosts.length + guests.length
  if (n > host.peak) host.peak = n
  log(w, `${guest.name} joined ${host.name}. They're ${n} strong now.`, { group: host.id, people: [...hosts, ...guests], big: true })
  if (!hasLesson(host, 'welcome') && guests.length >= 2) learn(w, host, 'welcome', `Taking in ${guest.name} made them stronger.`)
  for (const o of w.groups) if (o.met[guest.id]) o.met[host.id] = o.met[host.id] ?? o.met[guest.id]
}

function resolveRobbery(w: SurvivalWorld, robber: Group, victim: Group, choice: string): void {
  robber.met[victim.id] = 'enemy'
  victim.met[robber.id] = 'enemy'
  if (choice === 'pay') {
    const got: string[] = []
    for (const k of SUPPLY_KEYS) {
      const n = Math.floor(victim.stash[k] / 2)
      victim.stash[k] -= n
      robber.stash[k] += n
      if (n) got.push(`${n} ${SUPPLY_LABEL[k]}`)
    }
    log(w, `${victim.name} handed over ${got.length ? got.join(', ') : 'what little they had'} to ${robber.name}.`, { group: victim.id, big: true })
    for (const p of membersOf(w, victim)) p.morale -= 10
    learn(w, victim, 'distrust', `${robber.name} robbed them.`)
  } else {
    log(w, `${victim.name} refused to hand anything over to ${robber.name}.`, { group: victim.id, big: true })
    startFight(w, robber, victim)
  }
}

// ---------- fights between groups ----------

/** How far from the middle of a fight people still count as in it. */
const FIGHT_REACH = 18

/** The fight this person is caught up in, if any. */
export function fightFor(w: SurvivalWorld, p: Person): Fight | undefined {
  if (p.held) return undefined
  for (const f of w.fights) {
    if (f.a !== p.group && f.b !== p.group) continue
    if (f.out.includes(p.id)) continue
    if (dist(p.x, p.y, f.x, f.y) < FIGHT_REACH) return f
  }
  return undefined
}

function fighters(w: SurvivalWorld, f: Fight, group: number): Person[] {
  return w.people.filter((p) => p.group === group && !p.held && !isKid(p) && !f.out.includes(p.id) && dist(p.x, p.y, f.x, f.y) < FIGHT_REACH)
}

function power(people: Person[]): number {
  return people.reduce((s, p) => s + (p.health / 100) * (1 + p.skills.fighting * 0.15 + (weaponInfo(p.weapon).gun && p.ammo > 0 ? 1 + p.skills.shooting * 0.2 : 0)), 0)
}

function strength(w: SurvivalWorld, g: Group): number {
  return power(membersOf(w, g).filter((p) => !isKid(p)))
}

/** Two groups start fighting where they are. It plays out over the next minutes, person by person. */
function startFight(w: SurvivalWorld, a: Group, b: Group): void {
  a.met[b.id] = 'enemy'
  b.met[a.id] = 'enemy'
  a.fought[b.id] = w.tick
  b.fought[a.id] = w.tick
  if (w.fights.some((f) => (f.a === a.id && f.b === b.id) || (f.a === b.id && f.b === a.id))) return
  const am = membersOf(w, a)
  const bm = membersOf(w, b)
  if (!am.length || !bm.length) return
  // It starts where they're closest.
  let best = Infinity
  let cx = am[0].x
  let cy = am[0].y
  for (const p of am)
    for (const q of bm) {
      const d = dist(p.x, p.y, q.x, q.y)
      if (d < best) {
        best = d
        cx = (p.x + q.x) / 2
        cy = (p.y + q.y) / 2
      }
    }
  w.fights.push({ id: w.nextId++, a: a.id, b: b.id, x: cx, y: cy, started: w.tick, until: w.tick + 90, deadA: 0, deadB: 0, taken: [], out: [] })
  for (const p of [...am, ...bm]) if (dist(p.x, p.y, cx, cy) < FIGHT_REACH) p.asleep = false
  makeNoise(w, cx, cy, 30)
}

function runFrom(w: SurvivalWorld, p: Person, x: number, y: number): void {
  const d = Math.max(0.5, dist(p.x, p.y, x, y))
  p.fleeUntil = w.tick + 30
  p.fleeX = clamp(p.x + ((p.x - x) / d) * 22, 1, MAP_W - 1)
  p.fleeY = clamp(p.y + ((p.y - y) / d) * 22, 1, MAP_H - 1)
  if (p.task.kind !== 'rest') goBack(w, p)
}

function fightTick(w: SurvivalWorld, g: Group, p: Person, f: Fight): void {
  // Kids get out of the way. So does anyone badly hurt.
  if (isKid(p) || p.health < 30) {
    f.out.push(p.id)
    if (!isKid(p)) personLog(w, p, 'Got out of the fight, hurt.')
    runFrom(w, p, f.x, f.y)
    return
  }
  const foeGroup = f.a === g.id ? f.b : f.a
  let foe: Person | null = null
  let fd = Infinity
  for (const q of w.people) {
    if (q.group !== foeGroup || q.held || isKid(q) || f.out.includes(q.id)) continue
    const d = dist(p.x, p.y, q.x, q.y)
    if (d < fd) {
      fd = d
      foe = q
    }
  }
  if (!foe || fd > FIGHT_REACH * 1.5) return
  if (p.asleep) p.asleep = false
  const gun = weaponInfo(p.weapon).gun && p.ammo > 0
  if (gun && fd < 11) {
    // Aim, fire, take cover: about one shot every three minutes.
    if ((w.tick + p.id) % 3 !== 0) return
    p.ammo--
    const hit = chance(w, 0.14 + p.skills.shooting * 0.025 - (fd > 7 ? 0.05 : 0) - (has(foe, 'cautious') ? 0.03 : 0))
    w.shots.push({ x1: p.x, y1: p.y, x2: foe.x + (hit ? 0 : between(w, -1.5, 1.5)), y2: foe.y + (hit ? 0 : between(w, -1.5, 1.5)), until: w.tick + 2, hit })
    p.skills.shooting = Math.min(10, p.skills.shooting + 0.03)
    if (hit) wound(w, f, p, foe, chance(w, 0.12) ? 999 : between(w, 20, 55), true)
    return
  }
  if (fd < 1.3) {
    if ((w.tick + p.id) % 2 !== 0) return
    if (chance(w, 0.18 + p.skills.fighting * 0.025 + weaponInfo(p.weapon).melee * 0.5 - (p.lostLimb === 'arm' ? 0.1 : 0))) {
      wound(w, f, p, foe, between(w, 12, 30), false)
      p.skills.fighting = Math.min(10, p.skills.fighting + 0.03)
    }
    return
  }
  // Close in, or edge closer to get a shot.
  moveToward(p, foe.x, foe.y, gun ? speedOf(w, p, false) * 0.5 : speedOf(w, p, true))
}

function wound(w: SurvivalWorld, f: Fight, by: Person, q: Person, dmg: number, gun: boolean): void {
  q.health -= dmg
  q.morale = Math.max(0, q.morale - 4)
  if (q.health <= 0) {
    by.kills++
    if (q.group === f.a) f.deadA++
    else f.deadB++
    const foe = groupById(w, by.group)
    die(w, q, `was killed by ${by.name.split(' ')[0]} of ${foe?.name ?? 'another group'}`)
    return
  }
  // Beaten down, close up: some give up rather than die.
  if (q.health < 25 && (!gun || dist(by.x, by.y, q.x, q.y) < 4) && chance(w, has(q, 'brave') || has(q, 'hothead') ? 0.1 : 0.3)) capture(w, f, by, q)
}

function capture(w: SurvivalWorld, f: Fight | null, by: Person, q: Person): void {
  const captor = groupById(w, by.group)
  const from = groupById(w, q.group)
  if (!captor || !from) return
  q.held = { from: from.id, since: w.tick }
  q.group = captor.id
  q.fleeUntil = 0
  q.asleep = false
  // They lose their weapon and whatever they were carrying.
  if (q.ammo > 0) captor.stash.ammo += q.ammo
  q.ammo = 0
  q.weapon = 'none'
  for (const k of SUPPLY_KEYS) {
    captor.stash[k] += q.carry[k]
    q.carry[k] = 0
  }
  for (const c of membersOf(w, captor)) q.rel[c.id] = Math.min(q.rel[c.id] ?? 0, -30)
  setHome(w, q, 'camp')
  if (f) f.taken.push(q.id)
  log(w, `${q.name} gave up and was taken prisoner by ${captor.name}.`, { group: captor.id, people: [q, by], big: true })
  personLog(w, q, `Taken prisoner by ${captor.name}.`)
  if (from.leader === q.id) pickLeader(w, from)
  if (!membersOf(w, from).length) groupGone(w, from)
}

/** Nobody free is left in a group: it's over, and anyone it was holding gets loose. */
function groupGone(w: SurvivalWorld, g: Group): void {
  if (!g.alive) return
  g.alive = false
  log(w, `${g.name} is gone. Nobody is left.`, { group: g.id, big: true })
  for (const p of prisonersOf(w, g)) release(w, p, `With ${g.name} gone, ${p.name.split(' ')[0]} got loose.`)
}

function fightsTick(w: SurvivalWorld): void {
  for (const f of [...w.fights]) {
    const a = groupById(w, f.a)
    const b = groupById(w, f.b)
    if (!a || !b) {
      w.fights.splice(w.fights.indexOf(f), 1)
      continue
    }
    const fa = fighters(w, f, a.id)
    const fb = fighters(w, f, b.id)
    if (!fa.length || !fb.length || w.tick >= f.until) {
      endFight(w, f, !fa.length && fb.length ? a : !fb.length && fa.length ? b : null)
      continue
    }
    // Gunfire draws the dead in.
    if (w.tick % 10 === 0 && w.shots.length) makeNoise(w, f.x, f.y, 35)
    // The side that's losing badly breaks and runs.
    if (w.tick - f.started > 8 && w.tick % 4 === 0) {
      const pa = power(fa)
      const pb = power(fb)
      const breaks = pa < pb * 0.5 ? a : pb < pa * 0.5 ? b : null
      if (breaks) {
        const runners = breaks === a ? fa : fb
        const chasers = breaks === a ? fb : fa
        for (const p of runners) {
          const near = chasers.find((c) => dist(c.x, c.y, p.x, p.y) < 2.5)
          if (near && (p.health < 40 || p.lostLimb === 'leg') && chance(w, 0.6)) capture(w, f, near, p)
          else {
            f.out.push(p.id)
            runFrom(w, p, f.x, f.y)
          }
        }
        endFight(w, f, breaks)
      }
    }
  }
  w.shots = w.shots.filter((s) => s.until > w.tick)
}

function endFight(w: SurvivalWorld, f: Fight, loser: Group | null): void {
  const i = w.fights.indexOf(f)
  if (i >= 0) w.fights.splice(i, 1)
  const a = groupById(w, f.a)!
  const b = groupById(w, f.b)!
  if (!loser) {
    const pa = power(fighters(w, f, a.id))
    const pb = power(fighters(w, f, b.id))
    if (pa > pb * 1.4) loser = b
    else if (pb > pa * 1.4) loser = a
  }
  const dead = f.deadA + f.deadB
  const toll = `${dead ? `${dead} dead` : 'nobody dead'}${f.taken.length ? `, ${f.taken.length} taken prisoner` : ''}`
  if (!loser) {
    log(w, `${a.name} and ${b.name} broke off their fight (${toll}).`, { group: a.id, big: true })
  } else {
    const winner = loser === a ? b : a
    if (loser.alive) {
      const took: string[] = []
      // Losing near your own camp means they get in and take some of it.
      const camp = campOf(w, loser)
      const atCamp = !!camp && dist(f.x, f.y, camp.x + camp.w / 2, camp.y + camp.h / 2) < 14
      if (atCamp || loser.hostile || winner.hostile)
        for (const k of SUPPLY_KEYS) {
          const n = Math.floor(loser.stash[k] / 3)
          loser.stash[k] -= n
          winner.stash[k] += n
          if (n) took.push(`${n} ${SUPPLY_LABEL[k]}`)
        }
      log(w, `${winner.name} won the fight with ${loser.name} (${toll}).${took.length ? ` They took ${took.join(', ')}.` : ''}`, { group: winner.id, big: true })
      for (const p of membersOf(w, loser)) if (dist(p.x, p.y, f.x, f.y) < FIGHT_REACH && p.task.kind !== 'rest' && p.task.phase !== 'back') goBack(w, p)
    } else log(w, `${winner.name} wiped out ${loser.name}.`, { group: winner.id, big: true })
    for (const p of membersOf(w, winner)) p.morale = Math.min(100, p.morale + 5)
    if (!loser.hostile && loser.alive) learn(w, loser, 'distrust', `${winner.name} attacked them.`)
  }
  // What to do with anyone taken.
  for (const g of [a, b]) {
    const taken = f.taken.map((id) => personById(w, id)).filter((p): p is Person => !!p && !!p.held && p.group === g.id)
    if (taken.length && g.alive) prisonerDecision(w, g, taken)
  }
}

// ---------- prisoners ----------

function prisonerAuto(w: SurvivalWorld, g: Group, from?: Group): string {
  const lead = personById(w, g.leader ?? -1)
  if (g.hostile) return lead && (has(lead, 'paranoid') || has(lead, 'hothead')) ? 'kill' : 'keep'
  if (lead && has(lead, 'kind')) return 'recruit'
  // Raiders let go just come back.
  if (from?.hostile) return lead && has(lead, 'hothead') ? 'kill' : 'keep'
  if (hasLesson(g, 'welcome')) return 'recruit'
  if (hasLesson(g, 'distrust')) return 'keep'
  return 'free'
}

function prisonerDecision(w: SurvivalWorld, g: Group, taken: Person[]): void {
  const names = taken.map((p) => p.name.split(' ')[0]).join(', ')
  const from = groupById(w, taken[0].held?.from ?? -1)
  const auto = prisonerAuto(w, g, from)
  if (!g.ask) {
    for (const p of taken) applyPrisoner(w, g, p, auto)
    return
  }
  w.pending.push({
    id: w.nextId++,
    group: g.id,
    kind: 'prisoner',
    title: `${g.name} took ${taken.length === 1 ? 'a prisoner' : `${taken.length} prisoners`}`,
    text: `${names}${from ? ` from ${from.name}` : ''}. What happens to ${taken.length === 1 ? 'them' : 'them all'}?`,
    options: [
      { id: 'keep', label: 'Keep them locked up', hint: 'They eat your food and might escape. You can decide later from the group card.' },
      { id: 'recruit', label: 'Ask them to join', hint: "Some will, some won't. Those who won't stay locked up." },
      { id: 'free', label: 'Let them go', hint: 'They go back to their people, if any are left.' },
      { id: 'kill', label: 'Execute them', hint: 'Nobody will forget it.' }
    ],
    auto,
    data: { people: taken.map((p) => p.id).join(',') }
  })
}

function applyPrisoner(w: SurvivalWorld, g: Group, p: Person, choice: string): void {
  if (!p.held || p.group !== g.id) return
  if (choice === 'recruit') recruitPrisoner(w, p)
  else if (choice === 'free') freePrisoner(w, p)
  else if (choice === 'kill') executePrisoner(w, p)
  else personLog(w, p, `Locked up by ${g.name}.`)
}

/** A prisoner goes free: back to their group, or off on their own if it's gone. */
function release(w: SurvivalWorld, p: Person, text: string): void {
  const home = groupById(w, p.held?.from ?? -1)
  p.held = null
  if (home?.alive) {
    p.group = home.id
    for (const q of membersOf(w, home)) q.rel[p.id] = (q.rel[p.id] ?? 20) + 5
    goBack(w, p)
    log(w, `${text} ${p.name.split(' ')[0]} went back to ${home.name}.`, { group: home.id, people: [p], big: true })
    return
  }
  const alone = newGroup(w, { name: `${p.name.split(' ')[0]} (on their own)`, color: GROUP_COLORS[(w.groups.length + 3) % GROUP_COLORS.length], people: [] }, p.x, p.y)
  alone.peak = 1
  alone.stash = { food: 2, water: 2, ammo: 0, meds: 0, parts: 0 }
  w.groups.push(alone)
  p.group = alone.id
  pickLeader(w, alone)
  log(w, `${text} With nowhere to go back to, ${p.name.split(' ')[0]} set off alone.`, { group: alone.id, people: [p], big: true })
  look(w, alone, [p], true)
  planNow(w, alone)
}

export function freePrisoner(w: SurvivalWorld, p: Person): void {
  if (!p.held) return
  const captor = groupById(w, p.group)
  release(w, p, `${captor?.name ?? 'Their captors'} let ${p.name} go.`)
  // Letting people go makes the other side think again.
  const home = groupById(w, p.group)
  if (captor && home && home !== captor && home.met[captor.id] === 'enemy' && !home.hostile && chance(w, 0.5)) {
    home.met[captor.id] = 'avoid'
    captor.met[home.id] = 'avoid'
  }
}

/** Asks a prisoner to join. They might say no. */
export function recruitPrisoner(w: SurvivalWorld, p: Person): boolean {
  const g = groupById(w, p.group)
  if (!p.held || !g) return false
  const home = groupById(w, p.held.from)
  const ms = membersOf(w, g)
  const lead = personById(w, g.leader ?? -1)
  const feel = ms.length ? ms.reduce((s, q) => s + (p.rel[q.id] ?? 0), 0) / ms.length : 0
  const days = (w.tick - p.held.since) / DAY
  const odds =
    0.25 + (home?.alive ? 0 : 0.4) + Math.min(0.2, days * 0.04) + (lead && has(lead, 'kind') ? 0.15 : 0) + (has(p, 'loyal') && home?.alive ? -0.3 : 0) + (home?.hostile && !g.hostile ? 0.15 : 0) + feel / 200
  if (chance(w, odds)) {
    p.held = null
    for (const q of ms) {
      p.rel[q.id] = int(w, 0, 15)
      q.rel[p.id] = int(w, -10, 10)
    }
    setHome(w, p, 'camp')
    log(w, `${p.name} agreed to join ${g.name}.`, { group: g.id, people: [p], big: true })
    return true
  }
  log(w, `${p.name} refused to join ${g.name}.`, { group: g.id, people: [p] })
  return false
}

export function executePrisoner(w: SurvivalWorld, p: Person): void {
  const g = groupById(w, p.group)
  if (!p.held || !g) return
  const home = groupById(w, p.held.from)
  const by = membersOf(w, g).find((q) => has(q, 'hothead') || has(q, 'paranoid')) ?? personById(w, g.leader ?? -1) ?? membersOf(w, g)[0]
  log(w, `${by ? by.name.split(' ')[0] : g.name} executed ${p.name}, a prisoner from ${home?.name ?? 'another group'}.`, { group: g.id, people: by ? [p, by] : [p], big: true })
  for (const q of membersOf(w, g)) if (q !== by) q.morale = Math.max(0, q.morale - (has(q, 'kind') ? 15 : 4))
  if (by) for (const q of membersOf(w, g)) if (q !== by && has(q, 'kind')) q.rel[by.id] = clamp((q.rel[by.id] ?? 0) - 20, -100, 100)
  die(w, p, `was executed by ${g.name}`, true)
  if (home?.alive && !home.hostile) learn(w, home, 'distrust', `${g.name} executed ${p.name.split(' ')[0]}.`)
}

function heldTick(w: SurvivalWorld, p: Person): void {
  const m = minuteOfDay(w.tick)
  p.asleep = m > 22 * 60 || m < 6 * 60
  if (w.tick % 60 === 0) setHome(w, p, 'camp')
  if (dist(p.x, p.y, p.task.x, p.task.y) > 0.3) moveToward(p, p.task.x, p.task.y, speedOf(w, p, false) * 0.8)
}

/** Once a day: prisoners get fed (or don't), try to get away, or worse. */
function prisonersDay(w: SurvivalWorld, g: Group): void {
  const ps = prisonersOf(w, g)
  if (!ps.length) return
  const ms = membersOf(w, g)
  const lead = personById(w, g.leader ?? -1)
  for (const p of ps) {
    if (!p.held) continue
    const days = (w.tick - p.held.since) / DAY
    if (g.hostile && chance(w, lead && (has(lead, 'paranoid') || has(lead, 'hothead')) ? 0.15 : 0.05)) {
      executePrisoner(w, p)
      continue
    }
    const guarded = hasLesson(g, 'watch') ? 0.5 : 1
    const hungry = p.hunger > 70 ? 0.06 : 0
    if (chance(w, (0.05 + hungry + (has(p, 'brave') ? 0.04 : 0)) * guarded)) {
      release(w, p, `${p.name} escaped from ${g.name}.`)
      continue
    }
    // Groups that run themselves make up their minds after a few days.
    if (!g.ask && !g.hostile && days >= 3 && dayOf(w.tick) % 2 === 0) {
      if (!recruitPrisoner(w, p) && days >= 6) freePrisoner(w, p)
    }
  }
  if (ps.length > ms.length && ms.length) for (const q of ms) q.morale = Math.max(0, q.morale - 2)
}

// ---------- answering a decision ----------

export function answerDecision(w: SurvivalWorld, id: number, choice?: string): void {
  const i = w.pending.findIndex((d) => d.id === id)
  if (i < 0) return
  const d = w.pending[i]
  w.pending.splice(i, 1)
  const pick = choice ?? d.auto
  const g = groupById(w, d.group)
  if (!g?.alive) return
  const chosen = d.options.find((o) => o.id === pick)
  if (choice) log(w, `You chose for ${g.name}: ${chosen?.label ?? pick}.`, { group: g.id })
  if (d.kind === 'bite') {
    const p = personById(w, Number(d.data.person))
    if (p) applyBite(w, g, p, pick)
  } else if (d.kind === 'camp') {
    const b = buildingById(w, Number(pick))
    if (b) {
      setCamp(w, g, b, choice ? '' : 'It seemed best.')
      planNow(w, g)
    } else if (!g.camp) planDay(w, g)
  } else if (d.kind === 'robbed') {
    const r = groupById(w, Number(d.data.robber))
    if (r?.alive) resolveRobbery(w, r, g, pick)
  } else if (d.kind === 'meet') {
    const other = groupById(w, Number(d.data.b))
    if (!other?.alive) return
    const key = `${other.id}:${g.id}`
    const otherPending = w.pending.find((x) => x.kind === 'meet' && x.group === other.id && Number(x.data.b) === g.id)
    if (otherPending) {
      w.waiting[`${g.id}:${other.id}`] = pick
      return
    }
    const theirs = w.waiting[key] ?? attitude(w, other, g)
    delete w.waiting[key]
    settleMeeting(w, g, other, pick, theirs)
  } else if (d.kind === 'prisoner') {
    for (const id of String(d.data.people).split(',')) {
      const p = personById(w, Number(id))
      if (p) applyPrisoner(w, g, p, pick)
    }
  }
}

// ---------- walkers ----------

function walkerTick(w: SurvivalWorld, z: Walker, people: Person[], dark: number, herds: Map<number, Herd>, campsWithPeople: Building[]): void {
  // Who can it see?
  const sight = 8 - dark * 3
  let target: Person | null = null
  if (z.chase != null) {
    const p = people.find((q) => q.id === z.chase)
    if (p && dist(p.x, p.y, z.x, z.y) < sight + 4 && !hiddenInCamp(w, p, z)) target = p
    else z.chase = null
  }
  if (!target && w.tick % 3 === z.id % 3) {
    let bd = sight
    for (const p of people) {
      const d = dist(p.x, p.y, z.x, z.y)
      if (d < bd && !hiddenInCamp(w, p, z)) {
        bd = d
        target = p
      }
    }
    if (target) z.chase = target.id
  }
  let tx = z.tx
  let ty = z.ty
  let speed = 0.12
  if (target) {
    tx = target.x
    ty = target.y
    speed = 0.5
    z.tx = tx
    z.ty = ty
    z.busyUntil = w.tick + 60
  } else if (z.busyUntil > w.tick) {
    speed = 0.3
  } else if (z.herd != null && herds.has(z.herd)) {
    const h = herds.get(z.herd) as Herd
    if (dist(z.x, z.y, z.tx, z.ty) < 1.5 || w.tick % 40 === z.id % 40) {
      z.tx = h.x + between(w, -6, 6)
      z.ty = h.y + between(w, -6, 6)
    }
    speed = 0.16
  } else if (dist(z.x, z.y, z.tx, z.ty) < 1 || w.tick % 200 === z.id % 200) {
    // Wandering, or tagging along with another walker that's going somewhere.
    const buddy = w.walkers.find((o) => o !== z && o.busyUntil > w.tick && dist(o.x, o.y, z.x, z.y) < 7)
    if (buddy) {
      z.tx = buddy.tx
      z.ty = buddy.ty
      z.busyUntil = buddy.busyUntil
    } else {
      z.tx = clamp(z.x + between(w, -8, 8), 1, MAP_W - 1)
      z.ty = clamp(z.y + between(w, -8, 8), 1, MAP_H - 1)
    }
  }
  // Camp lights at night draw them in.
  if (!target && dark > 0.6 && w.tick % 30 === z.id % 30) {
    for (const c of campsWithPeople) {
      const g = w.groups.find((x) => x.camp === c.id)
      if (g && !hasLesson(g, 'quiet') && dist(c.x, c.y, z.x, z.y) < 30 && chance(w, 0.08)) {
        z.tx = c.x + c.w / 2
        z.ty = c.y + c.h / 2
        z.busyUntil = w.tick + 200
      }
    }
  }
  const dx = tx - z.x
  const dy = ty - z.y
  const d = Math.hypot(dx, dy)
  if (d > 0.05) {
    const s = Math.min(d, speed * (tileAt(w.map, z.x, z.y) === TILE.forest ? 0.7 : 1))
    const nx = z.x + (dx / d) * s
    const ny = z.y + (dy / d) * s
    // Barricades stop them: they pound on them instead.
    const wall = campsWithPeople.find((c) => c.fort >= 5 && inside(c, nx, ny) && !inside(c, z.x, z.y))
    if (wall && !target && z.busyUntil <= w.tick) {
      // Just wandering: it bumps into the wall and turns away.
      z.tx = clamp(z.x + between(w, -10, 10), 1, MAP_W - 1)
      z.ty = clamp(z.y + between(w, -10, 10), 1, MAP_H - 1)
    } else if (wall) {
      wall.fort = Math.max(0, wall.fort - 0.025 * (0.6 + w.harshness * 0.8))
      if (wall.fort < 5) breach(w, wall)
    } else {
      z.x = clamp(nx, 0.5, MAP_W - 0.5)
      z.y = clamp(ny, 0.5, MAP_H - 0.5)
    }
  }
  // Bite anyone in reach.
  if (target && dist(target.x, target.y, z.x, z.y) < 1.0) {
    const g = groupById(w, target.group)
    const camp = g && campOf(w, g)
    const walled = camp && camp.fort > 0 && inside(camp, target.x, target.y) && !inside(camp, z.x, z.y)
    if (!walled) {
      const odds = (0.035 - target.skills.fighting * 0.0022 + (target.asleep ? 0.05 : 0)) * (0.6 + w.harshness * 0.8)
      if (chance(w, odds)) bite(w, target)
      else if (chance(w, 0.03)) target.health -= between(w, 2, 6)
    }
  }
}

function hiddenInCamp(w: SurvivalWorld, p: Person, z: Walker): boolean {
  const g = groupById(w, p.group)
  const camp = g && campOf(w, g)
  return !!camp && camp.fort > 20 && inside(camp, p.x, p.y) && !inside(camp, z.x, z.y, 1) && dist(p.x, p.y, z.x, z.y) > 2
}

function breach(w: SurvivalWorld, b: Building): void {
  const g = w.groups.find((x) => x.alive && x.camp === b.id)
  if (!g) return
  log(w, `Walkers broke through the barricades at ${b.name}!`, { group: g.id, big: true })
  learn(w, g, 'fortify', `Walkers got through the barricades at ${b.name}.`)
  const ms = membersOf(w, g)
  const watching = ms.some((p) => !p.asleep && p.task.kind === 'guard')
  if (isNight(w.tick) && !watching) learn(w, g, 'watch', 'The walkers got in while everyone was asleep.')
  for (const p of ms) if (p.asleep) p.asleep = false
}

function herdTick(w: SurvivalWorld): void {
  for (const h of w.herds) {
    const members = w.walkers.filter((z) => z.herd === h.id)
    if (!members.length) continue
    h.x = members.reduce((s, z) => s + z.x, 0) / members.length
    h.y = members.reduce((s, z) => s + z.y, 0) / members.length
    // The herd drifts, often along roads.
    if (dist(h.x, h.y, h.tx, h.ty) < 4 || chance(w, 0.02)) {
      for (let i = 0; i < 10; i++) {
        const tx = clamp(h.x + between(w, -40, 40), 4, MAP_W - 4)
        const ty = clamp(h.y + between(w, -40, 40), 4, MAP_H - 4)
        h.tx = tx
        h.ty = ty
        if (tileAt(w.map, tx, ty) === TILE.road) break
      }
    }
    const d = dist(h.x, h.y, h.tx, h.ty)
    if (d > 0.5) {
      h.x += ((h.tx - h.x) / d) * 0.1
      h.y += ((h.ty - h.y) / d) * 0.1
    }
  }
  w.herds = w.herds.filter((h) => w.walkers.some((z) => z.herd === h.id))
}

// ---------- one step (one minute) ----------

export function stepSurvival(w: SurvivalWorld): void {
  if (w.pending.length) return
  w.tick++
  const m = minuteOfDay(w.tick)
  const live = w.groups.filter((g) => g.alive)

  for (const g of live) {
    if (m === 7 * 60) planDay(w, g)
    if (m === 18 * 60 + 30) for (const p of membersOf(w, g)) if (p.task.phase !== 'back' && !isAtCamp(w, p) && p.task.kind !== 'follow' && p.task.kind !== 'move') goBack(w, p)
    if (m === 8 * 60 || m === 19 * 60) {
      for (const p of membersOf(w, g)) if (isAtCamp(w, p)) eat(w, g, p)
      // Prisoners eat if there's enough to go round.
      const ps = prisonersOf(w, g)
      if (ps.length && g.stash.food > membersOf(w, g).length && g.stash.water > membersOf(w, g).length) for (const p of ps) eat(w, g, p)
    }
    if (m === 21 * 60 + 30) {
      // Bed. The guard stays up if they keep watch.
      const ms = membersOf(w, g)
      const watch = hasLesson(g, 'watch') ? ms.filter((p) => !isKid(p) && canWork(p)).sort((a, b) => a.fatigue - b.fatigue)[0] : undefined
      for (const p of ms) {
        if (!isAtCamp(w, p) && g.camp) continue
        if (p === watch) {
          setHome(w, p, 'guard')
          continue
        }
        setHome(w, p, 'sleep')
        p.asleep = true
      }
    }
    if (m === 6 * 60 + 30) for (const p of membersOf(w, g)) if (p.asleep) p.asleep = false
    if (m === 0) dayEnd(w, g)
    // Late back after dark: they sleep when they get in.
    if (m > 21 * 60 + 30 || m < 6 * 60) {
      for (const p of membersOf(w, g)) if (!p.asleep && p.task.kind === 'camp' && isAtCamp(w, p)) p.asleep = true
    }
    if (!g.camp && m % 60 === 0 && m > 7 * 60 && m < 19 * 60) {
      if (chooseCamp(w, g) && g.camp) planNow(w, g)
    }
    // Noise lesson: shots that drew a crowd.
    if (m % 60 === 0) {
      if (g.noiseDrew >= 10 && !hasLesson(g, 'quiet')) learn(w, g, 'quiet', `${g.noiseWho}'s shooting drew ${g.noiseDrew} walkers in.`)
      g.noiseDrew = 0
      g.noiseWho = ''
    }
  }

  const grid = new Grid(w.walkers)
  const buf: Walker[] = []
  for (const p of [...w.people]) {
    if (!w.people.includes(p)) continue
    const g = groupById(w, p.group)
    if (!g) continue
    personTick(w, g, p, grid, buf)
    if (w.pending.length) break
  }
  if (w.fights.length || w.shots.length) fightsTick(w)
  if (w.tick % 4 === 0) for (const g of live) look(w, g, membersOf(w, g))

  const dark = darkness(w.tick)
  const herds = new Map(w.herds.map((h) => [h.id, h]))
  const camps = live.map((g) => campOf(w, g)).filter((b): b is Building => !!b)
  const people = w.people
  for (const z of [...w.walkers]) walkerTick(w, z, people, dark, herds, camps)
  if (w.tick % 10 === 0) herdTick(w)
  corpseTick(w)
  w.noises = w.noises.filter((n) => n.until > w.tick)
  if (w.tick % 5 === 0) encounters(w)
}

// ---------- ready-made starts ----------

export function quickStart(w: SurvivalWorld): Group {
  const t = w.map.towns[0]
  const x = clamp(t.x - t.r - 10, 6, MAP_W - 6)
  const y = clamp(t.y + 6, 6, MAP_H - 6)
  const people = randomPeople(w, 4)
  people[0].traits = ['leader', 'steady']
  people[0].skills.leadership = 8
  const g = spawnGroup(w, { name: 'The Atlanta group', color: GROUP_COLORS[0], people }, x, y)
  spawnWalkers(w, t.x + 8, t.y - 6, 30, false)
  const t2 = w.map.towns[2]
  spawnWalkers(w, (t.x + t2.x) / 2, (t.y + t2.y) / 2 + 10, 60, true)
  return g
}
