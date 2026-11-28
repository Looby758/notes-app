/**
 * Evolution Lab: the simulation itself, with no drawing in it, so it can be tested and run anywhere.
 *
 * You decide everything about a world (its size, how fast plants grow, how harsh it is, walls and
 * special areas) and every species in it (what it eats, who it hunts, how big and fast it starts).
 * Nothing about how a creature behaves is written by hand: each one has a small brain (a few dozen
 * numbers) that turns what it senses into which way to turn and how fast to go. Those numbers start
 * out random, so the first generation mostly wanders. The ones that happen to find food live long
 * enough to have babies, and the babies get their parent's genes and brain with small random
 * changes. Over the generations, trial and error is all that makes them better.
 *
 * Everything runs off a seeded random number generator kept in the world, so the same world and
 * seed always play out the same way, and a saved copy of the world (`snapshot`) can be restored to
 * rewind.
 */

// ---------- setup: what you decide ----------

export type ZoneKind = 'wall' | 'fertile' | 'barren' | 'danger'

export interface Zone {
  id: string
  kind: ZoneKind
  x: number
  y: number
  w: number
  h: number
}

/** The numbers a species starts with. Every creature carries its own copy, which mutates. */
export interface Traits {
  /** Body size: bigger can eat smaller and stores more energy, but costs more to run. */
  size: number
  /** Top speed: faster catches and escapes, but moving fast burns energy. */
  speed: number
  /** How far it can see food, prey and danger. Seeing further costs a little energy. */
  sight: number
  /** How many babies at once. More babies means each one starts with less energy. */
  litter: number
}

export type TraitKey = keyof Traits

export interface SpeciesSetup {
  id: string
  name: string
  /** A #rrggbb colour. */
  color: string
  /** How many are put in the world at the start. */
  start: number
  eatsPlants: boolean
  /** The ids of the species it hunts. */
  hunts: string[]
  /** Prey it catches turns into one of its own (walkers), instead of being eaten. */
  infects: boolean
  /** Whether it has babies. A species that only infects can be set not to. */
  breeds: boolean
  /** How long one lives, in steps (60 steps is about a second at normal speed). */
  lifespan: number
  traits: Traits
}

export interface Conditions {
  width: number
  height: number
  /** New plants per step across the whole world (fewer in barren areas, more in fertile ones). */
  plantGrowth: number
  /** Energy one plant gives. */
  plantEnergy: number
  /** The most plants the world can hold at once. */
  maxPlants: number
  /** The chance each gene changes when a baby is born, from 0 to 1. */
  mutationRate: number
  /** How big those changes are, from 0 to 1. */
  mutationSize: number
  /** How harsh the world is: everything's energy use is multiplied by this. */
  harshness: number
  /** The most creatures alive at once, so the PC doesn't grind to a halt. */
  maxCreatures: number
  /** Whether going off one edge brings you back on the other, or the edges are walls. */
  wrap: boolean
  seed: number
}

export interface Setup {
  conditions: Conditions
  species: SpeciesSetup[]
  zones: Zone[]
}

// ---------- the world: what happens ----------

export interface Creature {
  id: number
  species: string
  x: number
  y: number
  angle: number
  energy: number
  age: number
  /** 0 for the first creatures, then one more than its parent. */
  generation: number
  parent: number | null
  traits: Traits
  /** The brain's weights (BRAIN_WEIGHTS numbers). */
  brain: number[]
  /** How hard it's moving right now, 0 to 1 (for drawing). */
  throttle: number
  babies: number
  kills: number
  /** Where it was born. Nothing makes it stay there, but its brain can learn to. */
  homeX: number
  homeY: number
  /** Meals it was close enough to take and chose to leave. */
  spared: number
}

export interface Plant {
  x: number
  y: number
}

export interface WorldEvent {
  tick: number
  kind: 'extinct' | 'record' | 'infected' | 'start'
  species: string
  text: string
}

export interface World {
  tick: number
  nextId: number
  rng: number
  creatures: Creature[]
  plants: Plant[]
  /** Records so far, per species (for "new record" events). */
  best: Record<string, { generation: number; population: number }>
  /** Species that have died out (so it's only said once). */
  extinct: string[]
  events: WorldEvent[]
}

// ---------- the brain ----------

/** What a creature senses, each from -1 to 1 (angles) or 0 to 1 (closeness, energy). */
export const BRAIN_INPUTS = [
  'Food direction',
  'Food closeness',
  'Prey direction',
  'Prey closeness',
  'Danger direction',
  'Danger closeness',
  'Wall ahead',
  'Energy',
  'Food around',
  'Prey around',
  'Home direction',
  'Far from home',
  'Always on'
] as const
export const BRAIN_HIDDEN = 6
/** Eat: above halfway it takes a meal it's touching, below it leaves it. Nothing says when to hold back. */
export const BRAIN_OUTPUTS = ['Turn', 'Speed', 'Eat'] as const
export const BRAIN_WEIGHTS = BRAIN_INPUTS.length * BRAIN_HIDDEN + BRAIN_HIDDEN * BRAIN_OUTPUTS.length

export interface Thought {
  inputs: number[]
  hidden: number[]
  outputs: number[]
}

/** Runs a brain: inputs to a hidden layer to turn (-1 to 1), speed (0 to 1) and eat (0 to 1). */
export function think(brain: readonly number[], inputs: readonly number[]): Thought {
  const nIn = BRAIN_INPUTS.length
  const hidden: number[] = []
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = 0
    for (let i = 0; i < nIn; i++) sum += inputs[i] * brain[h * nIn + i]
    hidden.push(Math.tanh(sum))
  }
  const base = nIn * BRAIN_HIDDEN
  const raw: number[] = []
  for (let o = 0; o < BRAIN_OUTPUTS.length; o++) {
    let sum = 0
    for (let h = 0; h < BRAIN_HIDDEN; h++) sum += hidden[h] * brain[base + o * BRAIN_HIDDEN + h]
    raw.push(sum)
  }
  return { inputs: [...inputs], hidden, outputs: [Math.tanh(raw[0]), 1 / (1 + Math.exp(-raw[1])), 1 / (1 + Math.exp(-raw[2]))] }
}

// ---------- the genes ----------

export const TRAITS: { key: TraitKey; label: string; min: number; max: number; step: number; whole?: boolean; hint: string }[] = [
  { key: 'size', label: 'Size', min: 0.4, max: 3, step: 0.05, hint: 'Bigger can eat smaller and holds more energy, but costs more to keep alive.' },
  { key: 'speed', label: 'Speed', min: 0.2, max: 3, step: 0.05, hint: 'Faster catches and escapes, but moving fast burns energy.' },
  { key: 'sight', label: 'Sight', min: 20, max: 250, step: 5, hint: 'How far it sees food, prey and danger. Seeing further costs a little energy.' },
  { key: 'litter', label: 'Babies at once', min: 1, max: 5, step: 1, whole: true, hint: 'More babies, but each starts with less energy.' }
]
const TRAIT_BY_KEY = new Map(TRAITS.map((t) => [t.key, t]))

export function clampTrait(key: TraitKey, value: number): number {
  const t = TRAIT_BY_KEY.get(key)!
  const v = Math.min(t.max, Math.max(t.min, Number.isFinite(value) ? value : t.min))
  return t.whole ? Math.round(v) : v
}

// ---------- random numbers (seeded, kept in the world) ----------

/** The next random number from 0 to 1 (mulberry32), moving the world's generator on. */
export function random(world: World): number {
  let t = (world.rng = (world.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function gaussian(world: World): number {
  const u = Math.max(1e-9, random(world))
  const v = random(world)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---------- body numbers ----------

export const radiusOf = (c: { traits: Traits }): number => 3 + c.traits.size * 4
export const maxEnergyOf = (c: { traits: Traits }): number => 100 * c.traits.size * c.traits.size
const GROWN_UP = 90
const TURN_RATE = 0.16
const MOVE_SCALE = 1.5

/** Energy used in one step: staying alive, moving and seeing, times how harsh the world is. */
export function energyUse(traits: Traits, throttle: number, harshness: number): number {
  const v = traits.speed * throttle * MOVE_SCALE
  const alive = 0.012 * traits.size * traits.size
  const moving = 0.018 * traits.size * v * v
  const seeing = 0.00025 * traits.sight
  return (alive + moving + seeing + 0.006) * harshness
}

// ---------- making worlds ----------

export function zoneAt(zones: readonly Zone[], x: number, y: number): Zone | null {
  // Walls win over everything, then the last zone drawn.
  let found: Zone | null = null
  for (const z of zones) {
    if (x < z.x || y < z.y || x > z.x + z.w || y > z.y + z.h) continue
    if (z.kind === 'wall') return z
    found = z
  }
  return found
}

const isWall = (zones: readonly Zone[], x: number, y: number): boolean => zoneAt(zones, x, y)?.kind === 'wall'

/** How likely a new plant is to take root here, 0 to 1. */
function fertility(zones: readonly Zone[], x: number, y: number): number {
  const z = zoneAt(zones, x, y)
  if (!z) return 0.3
  return z.kind === 'fertile' ? 1 : z.kind === 'danger' ? 0.3 : 0
}

/** A random open spot (not in a wall), or null if it couldn't find one. */
function openSpot(world: World, setup: Setup, near?: { x: number; y: number; r: number }): { x: number; y: number } | null {
  const { width, height } = setup.conditions
  for (let i = 0; i < 40; i++) {
    const x = near ? near.x + (random(world) * 2 - 1) * near.r : random(world) * width
    const y = near ? near.y + (random(world) * 2 - 1) * near.r : random(world) * height
    if (x < 0 || y < 0 || x > width || y > height) continue
    if (!isWall(setup.zones, x, y)) return { x, y }
  }
  return null
}

function randomBrain(world: World): number[] {
  return Array.from({ length: BRAIN_WEIGHTS }, () => gaussian(world) * 0.9)
}

/** Puts `count` new creatures of a species in the world, with random brains (generation 0). */
export function spawn(world: World, setup: Setup, speciesId: string, count: number, near?: { x: number; y: number; r: number }): number {
  const sp = setup.species.find((s) => s.id === speciesId)
  if (!sp) return 0
  let made = 0
  for (let i = 0; i < count && world.creatures.length < setup.conditions.maxCreatures; i++) {
    const spot = openSpot(world, setup, near)
    if (!spot) break
    const traits = { ...sp.traits }
    world.creatures.push({
      id: world.nextId++,
      species: sp.id,
      x: spot.x,
      y: spot.y,
      angle: random(world) * Math.PI * 2,
      energy: maxEnergyOf({ traits }) * 0.6,
      age: Math.floor(random(world) * GROWN_UP),
      generation: 0,
      parent: null,
      traits,
      brain: randomBrain(world),
      throttle: 0,
      babies: 0,
      kills: 0,
      homeX: spot.x,
      homeY: spot.y,
      spared: 0
    })
    made++
  }
  if (made) world.extinct = world.extinct.filter((id) => id !== sp.id)
  return made
}

/** Scatters food: a patch around a point, or across the world. */
export function addPlants(world: World, setup: Setup, count: number, near?: { x: number; y: number; r: number }): void {
  for (let i = 0; i < count && world.plants.length < setup.conditions.maxPlants * 1.5; i++) {
    const spot = openSpot(world, setup, near)
    if (spot) world.plants.push(spot)
  }
}

/** A fresh world from a setup: plants half grown, every species at its starting number. */
export function createWorld(setup: Setup): World {
  const world: World = { tick: 0, nextId: 1, rng: setup.conditions.seed | 0, creatures: [], plants: [], best: {}, extinct: [], events: [] }
  const c = setup.conditions
  let tries = 0
  while (world.plants.length < c.maxPlants * 0.5 && tries++ < c.maxPlants * 20) {
    const x = random(world) * c.width
    const y = random(world) * c.height
    if (random(world) < fertility(setup.zones, x, y)) world.plants.push({ x, y })
  }
  for (const sp of setup.species) spawn(world, setup, sp.id, sp.start)
  world.events.push({ tick: 0, kind: 'start', species: '', text: 'The world begins' })
  return world
}

// ---------- one step ----------

const CELL = 64

/** Buckets things by where they are, so finding what's nearby doesn't mean checking everything. */
class Grid<T extends { x: number; y: number }> {
  cols: number
  rows: number
  cells: T[][]
  constructor(width: number, height: number, items: readonly T[]) {
    this.cols = Math.max(1, Math.ceil(width / CELL))
    this.rows = Math.max(1, Math.ceil(height / CELL))
    this.cells = Array.from({ length: this.cols * this.rows }, () => [])
    for (const it of items) this.cells[this.cellOf(it.x, it.y)].push(it)
  }
  cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)))
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)))
    return cy * this.cols + cx
  }
  /** Calls `fn` for everything within `r` of (x, y), looking across the edges when the world wraps. */
  near(x: number, y: number, r: number, wrap: boolean, fn: (it: T) => void): void {
    const span = Math.ceil(r / CELL)
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    const seen = new Set<number>()
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        let gx = cx + dx
        let gy = cy + dy
        if (wrap) {
          gx = ((gx % this.cols) + this.cols) % this.cols
          gy = ((gy % this.rows) + this.rows) % this.rows
        } else if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) continue
        const idx = gy * this.cols + gx
        if (seen.has(idx)) continue
        seen.add(idx)
        for (const it of this.cells[idx]) fn(it)
      }
    }
  }
}

/** The shortest way from a to b, across the edges when the world wraps. */
function offset(a: number, b: number, size: number, wrap: boolean): number {
  let d = b - a
  if (wrap) {
    if (d > size / 2) d -= size
    else if (d < -size / 2) d += size
  }
  return d
}

/** -1 to 1: how far left (negative) or right (positive) something is from where it's facing. */
function relativeAngle(facing: number, dx: number, dy: number): number {
  let a = Math.atan2(dy, dx) - facing
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a / Math.PI
}

interface Senses {
  inputs: number[]
  plant: Plant | null
  prey: Creature | null
}

interface StepContext {
  setup: Setup
  speciesById: Map<string, SpeciesSetup>
  /** For each species, the species that hunt it. */
  huntedBy: Map<string, Set<string>>
  plants: Grid<Plant>
  creatures: Grid<Creature>
}

function contextFor(world: World, setup: Setup): StepContext {
  const speciesById = new Map(setup.species.map((s) => [s.id, s]))
  const huntedBy = new Map<string, Set<string>>()
  for (const s of setup.species) for (const prey of s.hunts) (huntedBy.get(prey) ?? huntedBy.set(prey, new Set()).get(prey)!).add(s.id)
  const { width, height } = setup.conditions
  return { setup, speciesById, huntedBy, plants: new Grid(width, height, world.plants), creatures: new Grid(width, height, world.creatures) }
}

function sense(c: Creature, ctx: StepContext): Senses {
  const { width, height, wrap } = ctx.setup.conditions
  const sp = ctx.speciesById.get(c.species)
  const sight = c.traits.sight
  const sight2 = sight * sight
  let plant: Plant | null = null
  let plantsSeen = 0
  let preySeen = 0
  let plantD = sight2
  let plantDx = 0
  let plantDy = 0
  if (sp?.eatsPlants) {
    ctx.plants.near(c.x, c.y, sight, wrap, (p) => {
      const dx = offset(c.x, p.x, width, wrap)
      const dy = offset(c.y, p.y, height, wrap)
      const d = dx * dx + dy * dy
      if (d < sight2) plantsSeen++
      if (d < plantD) {
        plantD = d
        plant = p
        plantDx = dx
        plantDy = dy
      }
    })
  }
  const hunts = sp?.hunts ?? []
  const threats = ctx.huntedBy.get(c.species)
  let prey: Creature | null = null
  let preyD = sight2
  let preyDx = 0
  let preyDy = 0
  let threatD = sight2
  let threatDx = 0
  let threatDy = 0
  let threat = false
  if (hunts.length || threats) {
    ctx.creatures.near(c.x, c.y, sight, wrap, (o) => {
      if (o === c || o.energy <= 0) return
      const dx = offset(c.x, o.x, width, wrap)
      const dy = offset(c.y, o.y, height, wrap)
      const d = dx * dx + dy * dy
      if (d < sight2 && hunts.includes(o.species)) preySeen++
      if (d < preyD && hunts.includes(o.species)) {
        preyD = d
        prey = o
        preyDx = dx
        preyDy = dy
      }
      if (d < threatD && threats?.has(o.species)) {
        threatD = d
        threat = true
        threatDx = dx
        threatDy = dy
      }
    })
  }
  // Feel ahead for a wall (or the world's edge when it doesn't wrap).
  let wallAhead = 0
  const reach = Math.min(80, sight * 0.6)
  for (let s = 1; s <= 4; s++) {
    const px = c.x + Math.cos(c.angle) * (reach * s) / 4
    const py = c.y + Math.sin(c.angle) * (reach * s) / 4
    const outside = !wrap && (px < 0 || py < 0 || px > width || py > height)
    if (outside || isWall(ctx.setup.zones, ((px % width) + width) % width, ((py % height) + height) % height)) {
      wallAhead = 1 - (s - 1) / 4
      break
    }
  }
  const close = (d2: number): number => 1 - Math.sqrt(d2) / sight
  const homeDx = offset(c.x, c.homeX ?? c.x, width, wrap)
  const homeDy = offset(c.y, c.homeY ?? c.y, height, wrap)
  const inputs = [
    plant ? relativeAngle(c.angle, plantDx, plantDy) : 0,
    plant ? close(plantD) : 0,
    prey ? relativeAngle(c.angle, preyDx, preyDy) : 0,
    prey ? close(preyD) : 0,
    threat ? relativeAngle(c.angle, threatDx, threatDy) : 0,
    threat ? close(threatD) : 0,
    wallAhead,
    Math.min(1, c.energy / maxEnergyOf(c)),
    Math.min(1, plantsSeen / 10),
    Math.min(1, preySeen / 8),
    homeDx || homeDy ? relativeAngle(c.angle, homeDx, homeDy) : 0,
    Math.min(1, Math.hypot(homeDx, homeDy) / 300),
    1
  ]
  return { inputs, plant, prey }
}

/** What a creature senses and thinks right now (for showing its brain at work). */
export function mindOf(world: World, setup: Setup, id: number): Thought | null {
  const c = world.creatures.find((x) => x.id === id)
  if (!c) return null
  return think(c.brain, sense(c, contextFor(world, setup)).inputs)
}

function mutate(world: World, setup: Setup, traits: Traits, brain: readonly number[]): { traits: Traits; brain: number[] } {
  const { mutationRate, mutationSize } = setup.conditions
  const next = { ...traits }
  for (const t of TRAITS) {
    if (random(world) >= mutationRate) continue
    const change = gaussian(world) * mutationSize * (t.max - t.min) * 0.12
    next[t.key] = clampTrait(t.key, next[t.key] + (t.whole ? Math.sign(change) * Math.max(1, Math.round(Math.abs(change))) : change))
  }
  const nextBrain = brain.map((w) => (random(world) < mutationRate ? Math.max(-4, Math.min(4, w + gaussian(world) * mutationSize * 0.8)) : w))
  return { traits: next, brain: nextBrain }
}

/** Moves the world on by one step. `setup` can change between steps (it's yours to change live). */
export function step(world: World, setup: Setup): void {
  const c = setup.conditions
  const { width, height, wrap } = c
  world.tick++

  // Plants grow (a fraction of a plant carries over as a chance).
  let grow = c.plantGrowth
  while (grow > 0 && world.plants.length < c.maxPlants) {
    if (grow < 1 && random(world) >= grow) break
    grow--
    const x = random(world) * width
    const y = random(world) * height
    if (random(world) < fertility(setup.zones, x, y)) world.plants.push({ x, y })
  }

  const ctx = contextFor(world, setup)
  const eaten = new Set<Plant>()
  const born: Creature[] = []
  const infected: { from: Creature; prey: Creature }[] = []

  for (const cr of world.creatures) {
    if (cr.energy <= 0) continue
    const sp = ctx.speciesById.get(cr.species)
    if (!sp) {
      cr.energy = 0
      continue
    }
    const senses = sense(cr, ctx)
    const out = think(cr.brain, senses.inputs).outputs
    const wantsToEat = out[2] >= 0.5
    cr.angle += out[0] * TURN_RATE
    cr.throttle = out[1]
    const v = cr.traits.speed * cr.throttle * MOVE_SCALE
    let nx = cr.x + Math.cos(cr.angle) * v
    let ny = cr.y + Math.sin(cr.angle) * v
    if (wrap) {
      nx = ((nx % width) + width) % width
      ny = ((ny % height) + height) % height
    } else if (nx < 0 || ny < 0 || nx > width || ny > height) {
      nx = Math.min(width, Math.max(0, nx))
      ny = Math.min(height, Math.max(0, ny))
      cr.angle += Math.PI * (0.5 + random(world))
    }
    if (isWall(setup.zones, nx, ny)) {
      cr.angle += Math.PI * (0.5 + random(world))
    } else {
      cr.x = nx
      cr.y = ny
    }

    cr.energy -= energyUse(cr.traits, cr.throttle, c.harshness)
    if (zoneAt(setup.zones, cr.x, cr.y)?.kind === 'danger') cr.energy -= 0.25 * c.harshness
    const max = maxEnergyOf(cr)
    const r = radiusOf(cr)
    const meatAndPlants = sp.eatsPlants && sp.hunts.length > 0

    // Eat a plant it's touching.
    const p = senses.plant as Plant | null
    if (p && !eaten.has(p)) {
      const dx = offset(cr.x, p.x, width, wrap)
      const dy = offset(cr.y, p.y, height, wrap)
      if (dx * dx + dy * dy <= (r + 2) * (r + 2)) {
        if (wantsToEat) {
          eaten.add(p)
          cr.energy += c.plantEnergy * (meatAndPlants ? 0.7 : 1)
        } else if (world.tick % 20 === cr.id % 20) cr.spared++
      }
    }

    // Catch prey it's touching, if it's big enough.
    const prey = senses.prey as Creature | null
    if (prey && prey.energy > 0 && cr.traits.size >= prey.traits.size * 0.7) {
      const dx = offset(cr.x, prey.x, width, wrap)
      const dy = offset(cr.y, prey.y, height, wrap)
      const reach = r + radiusOf(prey)
      if (dx * dx + dy * dy <= reach * reach && !wantsToEat) {
        if (world.tick % 20 === cr.id % 20) cr.spared++
      } else if (dx * dx + dy * dy <= reach * reach) {
        const meal = prey.energy * 0.6 + 25 * prey.traits.size * prey.traits.size
        cr.energy += meal * (meatAndPlants ? 0.7 : 1)
        prey.energy = 0
        cr.kills++
        if (sp.infects) infected.push({ from: cr, prey })
      }
    }
    cr.energy = Math.min(max, cr.energy)
    cr.age++
    if (cr.age > sp.lifespan) cr.energy = 0
    if (cr.energy <= 0) continue

    // Have babies when full enough.
    if (sp.breeds && cr.age > GROWN_UP && cr.energy > max * 0.8 && world.creatures.length + born.length < c.maxCreatures) {
      const litter = Math.max(1, Math.round(cr.traits.litter))
      const share = (cr.energy * 0.55) / litter
      cr.energy *= 0.4
      for (let i = 0; i < litter && world.creatures.length + born.length < c.maxCreatures; i++) {
        const genes = mutate(world, setup, cr.traits, cr.brain)
        born.push({
          id: world.nextId++,
          species: cr.species,
          x: cr.x,
          y: cr.y,
          angle: random(world) * Math.PI * 2,
          energy: Math.min(share, maxEnergyOf(genes)),
          age: 0,
          generation: cr.generation + 1,
          parent: cr.id,
          traits: genes.traits,
          brain: genes.brain,
          throttle: 0,
          babies: 0,
          kills: 0,
          homeX: cr.x,
          homeY: cr.y,
          spared: 0
        })
        cr.babies++
      }
    }
  }

  // The bitten come back as one of the hunters, with the hunter's genes (changed a little).
  for (const { from, prey } of infected) {
    if (world.creatures.length + born.length >= c.maxCreatures) break
    const genes = mutate(world, setup, from.traits, from.brain)
    born.push({
      id: world.nextId++,
      species: from.species,
      x: prey.x,
      y: prey.y,
      angle: random(world) * Math.PI * 2,
      energy: maxEnergyOf(genes) * 0.5,
      age: 0,
      generation: from.generation + 1,
      parent: from.id,
      traits: genes.traits,
      brain: genes.brain,
      throttle: 0,
      babies: 0,
      kills: 0,
      homeX: prey.x,
      homeY: prey.y,
      spared: 0
    })
  }

  if (eaten.size) world.plants = world.plants.filter((p) => !eaten.has(p))
  world.creatures = world.creatures.filter((x) => x.energy > 0)
  world.creatures.push(...born)
  noteEvents(world, setup)
}

function noteEvents(world: World, setup: Setup): void {
  if (world.tick % 30 !== 0) return
  const counts = new Map<string, number>()
  const gens = new Map<string, number>()
  for (const cr of world.creatures) {
    counts.set(cr.species, (counts.get(cr.species) ?? 0) + 1)
    gens.set(cr.species, Math.max(gens.get(cr.species) ?? 0, cr.generation))
  }
  for (const sp of setup.species) {
    const n = counts.get(sp.id) ?? 0
    if (n === 0) {
      if (!world.extinct.includes(sp.id) && world.best[sp.id]) {
        world.extinct.push(sp.id)
        world.events.push({ tick: world.tick, kind: 'extinct', species: sp.id, text: `${sp.name} died out` })
      }
      continue
    }
    const best = (world.best[sp.id] ??= { generation: 0, population: n })
    const gen = gens.get(sp.id) ?? 0
    // Milestones: every 10th generation reached.
    if (Math.floor(gen / 10) > Math.floor(best.generation / 10)) {
      world.events.push({ tick: world.tick, kind: 'record', species: sp.id, text: `${sp.name} reached generation ${Math.floor(gen / 10) * 10}` })
    }
    best.generation = Math.max(best.generation, gen)
    best.population = Math.max(best.population, n)
  }
  if (world.events.length > 300) world.events.splice(0, world.events.length - 300)
}

// ---------- watching it: snapshots and numbers ----------

/** A full copy of the world, to come back to (rewinding). */
export function snapshot(world: World): World {
  return {
    ...world,
    creatures: world.creatures.map((c) => ({ ...c, traits: { ...c.traits }, brain: c.brain.slice() })),
    plants: world.plants.map((p) => ({ ...p })),
    best: Object.fromEntries(Object.entries(world.best).map(([k, v]) => [k, { ...v }])),
    extinct: [...world.extinct],
    events: world.events.map((e) => ({ ...e }))
  }
}

export interface SpeciesSample {
  count: number
  /** The average of each trait across everyone alive. */
  avg: Traits
  /** The furthest generation alive. */
  generation: number
}

export interface Sample {
  tick: number
  plants: number
  species: Record<string, SpeciesSample>
}

/** Counts and averages right now, for the charts. */
export function sample(world: World, setup: Setup): Sample {
  const species: Record<string, SpeciesSample> = {}
  for (const sp of setup.species) species[sp.id] = { count: 0, avg: { size: 0, speed: 0, sight: 0, litter: 0 }, generation: 0 }
  for (const cr of world.creatures) {
    const s = species[cr.species]
    if (!s) continue
    s.count++
    for (const t of TRAITS) s.avg[t.key] += cr.traits[t.key]
    s.generation = Math.max(s.generation, cr.generation)
  }
  for (const s of Object.values(species)) if (s.count) for (const t of TRAITS) s.avg[t.key] /= s.count
  return { tick: world.tick, plants: world.plants.length, species }
}

// ---------- ready-made setups ----------

let idCounter = 0
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

export const DEFAULT_CONDITIONS: Conditions = {
  width: 1200,
  height: 760,
  plantGrowth: 2.5,
  plantEnergy: 30,
  maxPlants: 900,
  mutationRate: 0.12,
  mutationSize: 0.35,
  harshness: 1,
  maxCreatures: 900,
  wrap: true,
  seed: 1
}

export function newSpecies(partial: Partial<SpeciesSetup> = {}): SpeciesSetup {
  return {
    id: newId('sp'),
    name: 'New species',
    color: '#5ea8ff',
    start: 40,
    eatsPlants: true,
    hunts: [],
    infects: false,
    breeds: true,
    lifespan: 3000,
    ...partial,
    traits: { size: 1, speed: 1, sight: 90, litter: 2, ...partial.traits }
  }
}

export interface Preset {
  id: string
  name: string
  blurb: string
  make: () => Setup
}

export const PRESETS: Preset[] = [
  {
    id: 'grazers-hunters',
    name: 'Grazers and hunters',
    blurb: 'Plant eaters and the hunters that chase them. Watch an arms race start.',
    make: () => {
      const grazers = newSpecies({ name: 'Grazers', color: '#4ade80', start: 70, traits: { size: 0.9, speed: 1, sight: 80, litter: 2 } })
      const hunters = newSpecies({ name: 'Hunters', color: '#f87171', start: 10, eatsPlants: false, hunts: [grazers.id], lifespan: 3600, traits: { size: 1.3, speed: 1.2, sight: 120, litter: 1 } })
      return { conditions: { ...DEFAULT_CONDITIONS }, species: [grazers, hunters], zones: [] }
    }
  },
  {
    id: 'rooms',
    name: 'Grazers and hunters in rooms',
    blurb: 'The same food chain split into rooms with small doorways. A family that eats its room bare starves; one that leaves some alive might last.',
    make: () => {
      const grazers = newSpecies({ name: 'Grazers', color: '#4ade80', start: 70, traits: { size: 0.9, speed: 1, sight: 80, litter: 2 } })
      const hunters = newSpecies({ name: 'Hunters', color: '#f87171', start: 10, eatsPlants: false, hunts: [grazers.id], lifespan: 3600, traits: { size: 1.3, speed: 1.2, sight: 120, litter: 1 } })
      const W = DEFAULT_CONDITIONS.width
      const H = DEFAULT_CONDITIONS.height
      const cols = 4
      const rows = 3
      const gap = 40
      const t = 12
      const zones: Zone[] = []
      for (let i = 1; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const x = (W * i) / cols - t / 2
          const y0 = (H * j) / rows
          const y1 = (H * (j + 1)) / rows
          const mid = (y0 + y1) / 2
          zones.push({ id: newId('z'), kind: 'wall', x, y: y0, w: t, h: mid - gap / 2 - y0 }, { id: newId('z'), kind: 'wall', x, y: mid + gap / 2, w: t, h: y1 - mid - gap / 2 })
        }
      for (let j = 1; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const y = (H * j) / rows - t / 2
          const x0 = (W * i) / cols
          const x1 = (W * (i + 1)) / cols
          const mid = (x0 + x1) / 2
          zones.push({ id: newId('z'), kind: 'wall', x: x0, y, w: mid - gap / 2 - x0, h: t }, { id: newId('z'), kind: 'wall', x: mid + gap / 2, y, w: x1 - mid - gap / 2, h: t })
        }
      return { conditions: { ...DEFAULT_CONDITIONS, wrap: false }, species: [grazers, hunters], zones }
    }
  },
  {
    id: 'grazers',
    name: 'Just grazers',
    blurb: 'One plant-eating species and nothing else, to see it learn to find food.',
    make: () => ({ conditions: { ...DEFAULT_CONDITIONS }, species: [newSpecies({ name: 'Grazers', color: '#4ade80', start: 80 })], zones: [] })
  },
  {
    id: 'islands',
    name: 'Three islands',
    blurb: 'The same species split by walls onto a lush island, a normal one and a harsh one.',
    make: () => {
      const W = DEFAULT_CONDITIONS.width
      const H = DEFAULT_CONDITIONS.height
      const third = W / 3
      return {
        conditions: { ...DEFAULT_CONDITIONS, wrap: false },
        species: [newSpecies({ name: 'Islanders', color: '#fbbf24', start: 90 })],
        zones: [
          { id: newId('z'), kind: 'wall', x: third - 8, y: 0, w: 16, h: H },
          { id: newId('z'), kind: 'wall', x: third * 2 - 8, y: 0, w: 16, h: H },
          { id: newId('z'), kind: 'fertile', x: 0, y: 0, w: third - 8, h: H },
          { id: newId('z'), kind: 'danger', x: third * 2 + 8, y: 0, w: third - 8, h: H }
        ]
      }
    }
  },
  {
    id: 'outbreak',
    name: 'Walker outbreak',
    blurb: 'Survivors scavenge for food. Walkers are slow, but anyone they catch turns.',
    make: () => {
      const survivors = newSpecies({ name: 'Survivors', color: '#60a5fa', start: 110, traits: { size: 1, speed: 1.2, sight: 120, litter: 1 } })
      const walkers = newSpecies({
        name: 'Walkers',
        color: '#a3a380',
        start: 4,
        eatsPlants: false,
        hunts: [survivors.id],
        infects: true,
        breeds: false,
        lifespan: 2400,
        traits: { size: 1.1, speed: 0.45, sight: 60, litter: 1 }
      })
      const W = DEFAULT_CONDITIONS.width
      const H = DEFAULT_CONDITIONS.height
      return {
        conditions: { ...DEFAULT_CONDITIONS, wrap: false, plantGrowth: 1.6 },
        species: [survivors, walkers],
        zones: [
          // A walled town in the middle with gaps for gates, and farmland around it.
          { id: newId('z'), kind: 'wall', x: W * 0.38, y: H * 0.32, w: W * 0.24, h: 10 },
          { id: newId('z'), kind: 'wall', x: W * 0.38, y: H * 0.68, w: W * 0.1, h: 10 },
          { id: newId('z'), kind: 'wall', x: W * 0.52, y: H * 0.68, w: W * 0.1, h: 10 },
          { id: newId('z'), kind: 'wall', x: W * 0.38, y: H * 0.32, w: 10, h: H * 0.36 },
          { id: newId('z'), kind: 'wall', x: W * 0.62 - 10, y: H * 0.32, w: 10, h: H * 0.36 },
          { id: newId('z'), kind: 'fertile', x: W * 0.05, y: H * 0.05, w: W * 0.22, h: H * 0.3 },
          { id: newId('z'), kind: 'fertile', x: W * 0.73, y: H * 0.65, w: W * 0.22, h: H * 0.3 }
        ]
      }
    }
  },
  {
    id: 'maze',
    name: 'The gauntlet',
    blurb: 'Food only grows at the far end, past walls and a danger strip. Can they learn the way?',
    make: () => {
      const W = DEFAULT_CONDITIONS.width
      const H = DEFAULT_CONDITIONS.height
      return {
        conditions: { ...DEFAULT_CONDITIONS, wrap: false, plantGrowth: 3 },
        species: [newSpecies({ name: 'Runners', color: '#c084fc', start: 80 })],
        zones: [
          { id: newId('z'), kind: 'barren', x: 0, y: 0, w: W * 0.7, h: H },
          { id: newId('z'), kind: 'fertile', x: W * 0.82, y: 0, w: W * 0.18, h: H },
          { id: newId('z'), kind: 'wall', x: W * 0.25, y: 0, w: 14, h: H * 0.65 },
          { id: newId('z'), kind: 'wall', x: W * 0.45, y: H * 0.35, w: 14, h: H * 0.65 },
          { id: newId('z'), kind: 'danger', x: W * 0.62, y: 0, w: W * 0.06, h: H }
        ]
      }
    }
  },
  {
    id: 'blank',
    name: 'Blank world',
    blurb: 'An empty world with nothing in it. Add your own species and draw your own land.',
    make: () => ({ conditions: { ...DEFAULT_CONDITIONS }, species: [], zones: [] })
  }
]

// ---------- saving setups ----------

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback)

/** A setup read back from a file or storage, with anything missing or broken put right. */
export function cleanSetup(raw: unknown): Setup {
  const r = (raw ?? {}) as Partial<Setup>
  const rc = (r.conditions ?? {}) as Partial<Conditions>
  const d = DEFAULT_CONDITIONS
  const conditions: Conditions = {
    width: num(rc.width, d.width, 300, 4000),
    height: num(rc.height, d.height, 200, 3000),
    plantGrowth: num(rc.plantGrowth, d.plantGrowth, 0, 50),
    plantEnergy: num(rc.plantEnergy, d.plantEnergy, 1, 200),
    maxPlants: num(rc.maxPlants, d.maxPlants, 0, 5000),
    mutationRate: num(rc.mutationRate, d.mutationRate, 0, 1),
    mutationSize: num(rc.mutationSize, d.mutationSize, 0, 1),
    harshness: num(rc.harshness, d.harshness, 0.1, 5),
    maxCreatures: num(rc.maxCreatures, d.maxCreatures, 10, 3000),
    wrap: typeof rc.wrap === 'boolean' ? rc.wrap : d.wrap,
    seed: Math.round(num(rc.seed, d.seed, -2147483648, 2147483647))
  }
  const species = (Array.isArray(r.species) ? r.species : []).map((s: Partial<SpeciesSetup>) => {
    const traits = (s.traits ?? {}) as Partial<Traits>
    return newSpecies({
      id: str(s.id, newId('sp')),
      name: str(s.name, 'Species').slice(0, 40),
      color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#5ea8ff',
      start: Math.round(num(s.start, 30, 0, 1000)),
      eatsPlants: s.eatsPlants !== false,
      hunts: Array.isArray(s.hunts) ? s.hunts.filter((h): h is string => typeof h === 'string') : [],
      infects: s.infects === true,
      breeds: s.breeds !== false,
      lifespan: Math.round(num(s.lifespan, 3000, 100, 100000)),
      traits: {
        size: clampTrait('size', num(traits.size, 1, -1e9, 1e9)),
        speed: clampTrait('speed', num(traits.speed, 1, -1e9, 1e9)),
        sight: clampTrait('sight', num(traits.sight, 90, -1e9, 1e9)),
        litter: clampTrait('litter', num(traits.litter, 2, -1e9, 1e9))
      }
    })
  })
  const ids = new Set(species.map((s) => s.id))
  for (const s of species) s.hunts = s.hunts.filter((h) => ids.has(h))
  const kinds: ZoneKind[] = ['wall', 'fertile', 'barren', 'danger']
  const zones = (Array.isArray(r.zones) ? r.zones : [])
    .filter((z: Partial<Zone>) => kinds.includes(z.kind as ZoneKind))
    .map((z: Partial<Zone>) => ({
      id: str(z.id, newId('z')),
      kind: z.kind as ZoneKind,
      x: num(z.x, 0, -1e5, 1e5),
      y: num(z.y, 0, -1e5, 1e5),
      w: num(z.w, 10, 1, 1e5),
      h: num(z.h, 10, 1, 1e5)
    }))
  return { conditions, species, zones }
}
