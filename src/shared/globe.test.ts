import { describe, expect, it } from 'vitest'
import { DAY, answerDecision, membersOf, quickStart, randomPeople, spawnGroup } from './survival'
import { allGroups, areaNear, createGlobe, isLand, kmBetween, openArea, pendingCount, sendGroupTo, snapshotGlobe, stepGlobe, type Globe } from './globe'

const run = (g: Globe, steps: number): void => {
  for (let i = 0; i < steps; i++) {
    stepGlobe(g)
    for (const a of g.areas) while (a.world.pending.length) answerDecision(a.world, a.world.pending[0].id)
  }
}

describe('the globe', () => {
  it('knows land from sea', () => {
    expect(isLand(48.86, 2.35)).toBe(true) // Paris
    expect(isLand(33.75, -84.39)).toBe(true) // Atlanta
    expect(isLand(35.68, 139.69)).toBe(true) // Tokyo
    expect(isLand(40, -40)).toBe(false) // the middle of the Atlantic
    expect(isLand(0, -150)).toBe(false) // the Pacific
  })

  it('measures distances roughly right', () => {
    expect(kmBetween(51.51, -0.13, 48.86, 2.35)).toBeGreaterThan(330) // London to Paris, about 344 km
    expect(kmBetween(51.51, -0.13, 48.86, 2.35)).toBeLessThan(360)
  })

  it('starts with the area outside Atlanta, and opens new areas where you click on land', () => {
    const g = createGlobe({ seed: 1, harshness: 0.5 })
    expect(g.areas).toHaveLength(1)
    expect(openArea(g, 40, -40)).toBeNull()
    const paris = openArea(g, 48.87, 2.36)!
    expect(paris.name).toBe('Paris')
    expect(paris.world.map.culture).toBe('fr')
    expect(paris.world.map.towns[0].name).toBe('Paris')
    expect(paris.world.buildings.some((b) => /Pharmacie|Gendarmerie|Supermarché/.test(b.name))).toBe(true)
    // The same spot gives the same area back.
    expect(openArea(g, 48.86, 2.35)).toBe(paris)
    expect(areaNear(g, 48.86, 2.35)).toBe(paris)
    // People placed there get French names.
    const people = randomPeople(paris.world, 6)
    expect(people.some((p) => /Martin|Bernard|Dubois|Durand|Lefebvre|Moreau|Laurent|Girard|Roux|Fournier|Morel|Mercier|Blanc|Garnier|Chevalier|Faure|Rousseau|Lambert|Bonnet|Fontaine|Perrin|Marchand/.test(p.name))).toBe(true)
    // Out in the country, it's named after the nearest city.
    const rural = openArea(g, 47.5, 1.2)!
    expect(rural.world.map.region).toMatch(/km .* of|Outside/)
  })

  it('runs every area on the same clock', () => {
    const g = createGlobe({ seed: 2, harshness: 0.5 })
    quickStart(g.areas[0].world)
    const tokyo = openArea(g, 35.68, 139.69)!
    spawnGroup(tokyo.world, { name: 'Tokyo group', color: '#fff', people: randomPeople(tokyo.world, 3) }, 120, 80)
    run(g, 600)
    expect(g.areas[0].world.tick).toBe(g.tick)
    expect(tokyo.world.tick).toBe(g.tick)
    expect(pendingCount(g)).toBe(0)
    // Ids never clash between areas.
    const ids = g.areas.flatMap((a) => a.world.people.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a group sent far away walks off the map, travels for days and arrives in a new area', () => {
    const g = createGlobe({ seed: 3, harshness: 0.3 })
    const home = g.areas[0]
    const grp = quickStart(home.world)
    grp.stash.food = 200
    grp.stash.water = 200
    const before = membersOf(home.world, grp).length
    sendGroupTo(home, grp, 32.08, -81.09, 'Savannah') // about 400 km: 16 days on foot
    let leftAt = -1
    for (let i = 0; i < DAY * 20 && !g.areas.some((a) => a.name === 'Savannah' && a.world.groups.includes(grp)); i++) {
      run(g, 1)
      if (leftAt < 0 && g.parties.length) leftAt = g.tick
    }
    expect(leftAt).toBeGreaterThan(0)
    const savannah = g.areas.find((a) => a.name === 'Savannah')!
    expect(savannah).toBeDefined()
    expect(savannah.world.groups).toContain(grp)
    expect(membersOf(savannah.world, grp).length).toBeGreaterThan(0)
    expect(membersOf(savannah.world, grp).length).toBeLessThanOrEqual(before)
    expect(home.world.groups).not.toContain(grp)
    expect(allGroups(g).some((x) => x.group === grp && x.area === savannah)).toBe(true)
  })

  it('a copy of the globe rewinds exactly', () => {
    const g = createGlobe({ seed: 4, harshness: 0.5 })
    quickStart(g.areas[0].world)
    const rome = openArea(g, 41.9, 12.5)!
    spawnGroup(rome.world, { name: 'Roma', color: '#fff', people: randomPeople(rome.world, 3) }, 100, 70)
    run(g, 300)
    const copy = snapshotGlobe(g)
    run(g, 400)
    run(copy, 400)
    expect(copy.areas.map((a) => a.world.log.length)).toEqual(g.areas.map((a) => a.world.log.length))
  })
})
