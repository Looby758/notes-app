import { describe, expect, it } from 'vitest'
import {
  BRAIN_WEIGHTS,
  PRESETS,
  cleanSetup,
  createWorld,
  energyUse,
  newSpecies,
  sample,
  snapshot,
  step,
  think,
  zoneAt,
  DEFAULT_CONDITIONS,
  type Setup
} from './evolution'

const small = (setup: Setup): Setup => ({ ...setup, conditions: { ...setup.conditions, width: 500, height: 400, maxPlants: 300 } })

describe('the brain', () => {
  it('turns senses into a turn from -1 to 1 and a speed from 0 to 1', () => {
    const brain = Array.from({ length: BRAIN_WEIGHTS }, (_, i) => Math.sin(i) * 3)
    const t = think(brain, [1, 1, -1, 0.5, 0, 0, 1, 0.2, 1])
    expect(t.hidden).toHaveLength(6)
    expect(t.outputs[0]).toBeGreaterThanOrEqual(-1)
    expect(t.outputs[0]).toBeLessThanOrEqual(1)
    expect(t.outputs[1]).toBeGreaterThanOrEqual(0)
    expect(t.outputs[1]).toBeLessThanOrEqual(1)
  })
})

describe('energy', () => {
  it('costs more to be bigger, faster or see further, and more in a harsher world', () => {
    const base = { size: 1, speed: 1, sight: 90, litter: 2 }
    const e = energyUse(base, 1, 1)
    expect(energyUse({ ...base, size: 2 }, 1, 1)).toBeGreaterThan(e)
    expect(energyUse({ ...base, speed: 2 }, 1, 1)).toBeGreaterThan(e)
    expect(energyUse({ ...base, sight: 200 }, 1, 1)).toBeGreaterThan(e)
    expect(energyUse(base, 0, 1)).toBeLessThan(e)
    expect(energyUse(base, 1, 2)).toBeCloseTo(e * 2)
  })
})

describe('worlds', () => {
  it('play out the same way from the same seed', () => {
    const setup = small(PRESETS[0].make())
    const a = createWorld(setup)
    const b = createWorld(setup)
    for (let i = 0; i < 300; i++) {
      step(a, setup)
      step(b, setup)
    }
    expect(a.creatures.map((c) => [c.id, c.x, c.y])).toEqual(b.creatures.map((c) => [c.id, c.x, c.y]))
  })

  it('rewinds: a snapshot carries on exactly as the original did', () => {
    const setup = small(PRESETS[0].make())
    const w = createWorld(setup)
    for (let i = 0; i < 100; i++) step(w, setup)
    const saved = snapshot(w)
    for (let i = 0; i < 100; i++) step(w, setup)
    const again = snapshot(saved)
    for (let i = 0; i < 100; i++) step(again, setup)
    expect(again.tick).toBe(w.tick)
    expect(again.creatures.map((c) => c.id)).toEqual(w.creatures.map((c) => c.id))
    // And stepping the copy didn't touch the snapshot it came from.
    expect(saved.tick).toBe(100)
  })

  it('never puts anything inside a wall', () => {
    const setup = small(PRESETS.find((p) => p.id === 'islands')!.make())
    const w = createWorld(setup)
    for (let i = 0; i < 200; i++) step(w, setup)
    for (const c of w.creatures) expect(zoneAt(setup.zones, c.x, c.y)?.kind).not.toBe('wall')
    for (const p of w.plants) expect(zoneAt(setup.zones, p.x, p.y)?.kind).not.toBe('wall')
  })

  it('babies carry their parent’s genes and are a generation on', () => {
    const grazers = newSpecies({ name: 'G', start: 40 })
    const setup = small({ conditions: { ...DEFAULT_CONDITIONS, plantGrowth: 8, plantEnergy: 80 }, species: [grazers], zones: [] })
    const w = createWorld(setup)
    for (let i = 0; i < 1500; i++) step(w, setup)
    const kids = w.creatures.filter((c) => c.generation > 0)
    expect(kids.length).toBeGreaterThan(0)
    expect(kids.every((c) => c.parent != null)).toBe(true)
  })

  it('a species with nothing to eat dies out, and that gets noted', () => {
    const starving = newSpecies({ name: 'Hungry', start: 20, eatsPlants: false, lifespan: 100000 })
    const setup = small({ conditions: { ...DEFAULT_CONDITIONS, harshness: 5 }, species: [starving], zones: [] })
    const w = createWorld(setup)
    for (let i = 0; i < 3000 && w.creatures.length; i++) step(w, setup)
    for (let i = 0; i < 30; i++) step(w, setup)
    expect(w.creatures).toHaveLength(0)
    expect(w.events.some((e) => e.kind === 'extinct' && e.species === starving.id)).toBe(true)
  })

  it('walkers turn the survivors they catch', () => {
    const setup = small(PRESETS.find((p) => p.id === 'outbreak')!.make())
    const walkers = setup.species.find((s) => s.infects)!
    const w = createWorld(setup)
    const before = w.creatures.filter((c) => c.species === walkers.id).length
    let most = before
    for (let i = 0; i < 1500; i++) {
      step(w, setup)
      most = Math.max(most, w.creatures.filter((c) => c.species === walkers.id).length)
    }
    expect(most).toBeGreaterThan(before)
  })

  it('counts each species for the charts', () => {
    const setup = small(PRESETS[0].make())
    const w = createWorld(setup)
    const s = sample(w, setup)
    for (const sp of setup.species) expect(s.species[sp.id].count).toBe(sp.start)
    expect(s.species[setup.species[0].id].avg.size).toBeCloseTo(setup.species[0].traits.size)
  })
})

describe('saved setups', () => {
  it('come back in one piece', () => {
    const setup = PRESETS.find((p) => p.id === 'outbreak')!.make()
    expect(cleanSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup)
  })

  it('have anything broken put right', () => {
    const s = cleanSetup({ conditions: { width: 'big', harshness: 99 }, species: [{ name: 'X', hunts: ['nobody'], traits: { size: 50 } }], zones: [{ kind: 'lava' }] })
    expect(s.conditions.width).toBe(DEFAULT_CONDITIONS.width)
    expect(s.conditions.harshness).toBe(5)
    expect(s.species[0].hunts).toEqual([])
    expect(s.species[0].traits.size).toBe(3)
    expect(s.zones).toEqual([])
    expect(cleanSetup(null).species).toEqual([])
  })
})
