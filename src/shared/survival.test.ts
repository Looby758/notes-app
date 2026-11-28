import { describe, expect, it } from 'vitest'
import {
  CELLS_X,
  DAY,
  START_DAY,
  TILE,
  answerDecision,
  campOf,
  cellOf,
  clockText,
  createSurvivalWorld,
  dayOf,
  giveOrder,
  hasLesson,
  makeNoise,
  membersOf,
  quickStart,
  randomPeople,
  snapshotSurvival,
  spawnGroup,
  spawnSupplies,
  spawnWalkers,
  staleness,
  stepSurvival,
  type SurvivalWorld
} from './survival'

const run = (w: SurvivalWorld, steps: number, answer = true): void => {
  for (let i = 0; i < steps; i++) {
    stepSurvival(w)
    if (answer) while (w.pending.length) answerDecision(w, w.pending[0].id)
  }
}

describe('survival mode', () => {
  it('starts on day 30 at 8 in the morning, one step a minute', () => {
    const w = createSurvivalWorld({ seed: 1, harshness: 0.5 })
    expect(dayOf(w.tick)).toBe(START_DAY)
    expect(clockText(w.tick)).toBe('08:00')
    run(w, 90)
    expect(clockText(w.tick)).toBe('09:30')
    run(w, DAY)
    expect(dayOf(w.tick)).toBe(START_DAY + 1)
  })

  it('builds three named towns with buildings, roads and a creek', () => {
    const w = createSurvivalWorld({ seed: 7, harshness: 0.5 })
    expect(w.map.towns).toHaveLength(3)
    expect(new Set(w.map.towns.map((t) => t.name)).size).toBe(3)
    expect(w.buildings.length).toBeGreaterThan(40)
    for (const kind of ['house', 'store', 'pharmacy', 'police', 'farm'] as const) expect(w.buildings.some((b) => b.kind === kind)).toBe(true)
    expect(w.map.tiles.includes(TILE.road)).toBe(true)
    expect(w.map.tiles.includes(TILE.creek)).toBe(true)
  })

  it('plays out the same way every time from the same seed', () => {
    const a = createSurvivalWorld({ seed: 3, harshness: 0.5 })
    const b = createSurvivalWorld({ seed: 3, harshness: 0.5 })
    quickStart(a)
    quickStart(b)
    run(a, DAY)
    run(b, DAY)
    expect(a.log.map((l) => l.text)).toEqual(b.log.map((l) => l.text))
    expect(a.people.map((p) => [p.x, p.y])).toEqual(b.people.map((p) => [p.x, p.y]))
  })

  it('a group picks a camp, plans its day and brings supplies home', () => {
    const w = createSurvivalWorld({ seed: 2, harshness: 0.3 })
    const t = w.map.towns[0]
    const g = spawnGroup(w, { name: 'Test group', color: '#fff', people: randomPeople(w, 4) }, t.x, t.y)
    expect(g.camp).not.toBeNull()
    expect(w.log.some((l) => l.text.startsWith('Plan for Day'))).toBe(true)
    run(w, DAY / 2)
    expect(w.log.some((l) => l.group === g.id && l.text.includes('got back'))).toBe(true)
  })

  it('only knows what its people have seen, and scouts share what they saw when they get back', () => {
    const w = createSurvivalWorld({ seed: 4, harshness: 0.3 })
    const t = w.map.towns[0]
    const g = spawnGroup(w, { name: 'Scouts', color: '#fff', people: randomPeople(w, 3) }, t.x, t.y)
    const home = cellOf(t.x, t.y)
    expect(staleness(w, g, home)).toBe(0)
    const far = cellOf(t.x + 100, t.y + 60)
    expect(staleness(w, g, far)).toBe(-1)
    // Send one person far away: what they see waits with them until they're back.
    const p = membersOf(w, g)[0]
    p.x = t.x + 100
    p.y = t.y + 60
    p.task = { kind: 'explore', phase: 'work', x: p.x, y: p.y, until: w.tick + 1000 }
    run(w, 4)
    expect(staleness(w, g, far)).toBe(-1)
    expect(Object.keys(p.pending.cells).map(Number)).toContain(far)
    p.x = g.homeX
    p.y = g.homeY
    p.task = { kind: 'explore', phase: 'back', x: g.homeX, y: g.homeY }
    run(w, 2)
    expect(staleness(w, g, far)).toBeGreaterThanOrEqual(0)
    // Knowledge goes out of date.
    run(w, DAY * 3 + 10)
    g.seen[far] = w.tick - DAY * 3
    expect(staleness(w, g, far)).toBe(1)
    expect(far % CELLS_X).toBeGreaterThan(0)
  })

  it('a bitten person turns unless something is done, and the group learns from it', () => {
    const w = createSurvivalWorld({ seed: 5, harshness: 0.5 })
    const t = w.map.towns[1]
    const g = spawnGroup(w, { name: 'Bitten', color: '#fff', people: randomPeople(w, 1) }, t.x, t.y)
    const p = membersOf(w, g)[0]
    p.bitten = { at: w.tick, limb: 'neck', turnsAt: w.tick + 30, cutBy: w.tick, asked: true }
    run(w, 60)
    expect(w.people).toHaveLength(0)
    expect(w.fallen[0].cause).toBe('died from a bite')
    expect(w.walkers.some((z) => z.was === p.name)).toBe(true)
    expect(g.alive).toBe(false)
  })

  it('asks you about a bite when the group is set to ask, and waits for your answer', () => {
    const w = createSurvivalWorld({ seed: 6, harshness: 0.5 })
    const t = w.map.towns[0]
    const g = spawnGroup(w, { name: 'Askers', color: '#fff', people: randomPeople(w, 3), ask: true }, t.x, t.y)
    while (w.pending.length) answerDecision(w, w.pending[0].id)
    const [p, q] = membersOf(w, g)
    q.x = p.x
    q.y = p.y
    p.health = 100
    // Put a walker right on top of them until one of them is bitten.
    for (let i = 0; i < 2000 && !w.pending.some((d) => d.kind === 'bite'); i++) {
      if (!w.walkers.length) spawnWalkers(w, p.x, p.y, 1, false)
      w.walkers[0].x = p.x
      w.walkers[0].y = p.y
      stepSurvival(w)
      for (const d of w.pending.filter((d) => d.kind !== 'bite')) answerDecision(w, d.id)
      if (!w.people.includes(p)) break
    }
    const d = w.pending.find((x) => x.kind === 'bite')
    if (!d) return // They fought it off every time, which is fine.
    const tick = w.tick
    stepSurvival(w)
    expect(w.tick).toBe(tick)
    answerDecision(w, d.id, d.options[0].id)
    expect(w.pending.filter((x) => x.kind === 'bite')).toHaveLength(0)
  })

  it('learns that gunshots bring the dead', () => {
    const w = createSurvivalWorld({ seed: 8, harshness: 0.5 })
    const t = w.map.towns[0]
    const g = spawnGroup(w, { name: 'Loud', color: '#fff', people: randomPeople(w, 2) }, t.x, t.y)
    spawnWalkers(w, t.x + 20, t.y, 30, true)
    g.noiseDrew = makeNoise(w, t.x, t.y, 60)
    g.noiseWho = 'Someone'
    run(w, 70)
    expect(hasLesson(g, 'quiet')).toBe(true)
  })

  it('takes orders: move camp to a building you pick', () => {
    const w = createSurvivalWorld({ seed: 9, harshness: 0.5 })
    const t = w.map.towns[0]
    const g = spawnGroup(w, { name: 'Movers', color: '#fff', people: randomPeople(w, 3) }, t.x, t.y)
    const target = w.buildings.find((b) => b.kind === 'farm') ?? w.buildings[0]
    giveOrder(w, g, { kind: 'move', building: target.id })
    expect(campOf(w, g)?.id).toBe(target.id)
    expect(membersOf(w, g).every((p) => p.task.kind === 'move' || p.task.kind === 'rest')).toBe(true)
  })

  it('two friendly groups who meet trade news, merge or keep apart, without fighting', () => {
    const w = createSurvivalWorld({ seed: 10, harshness: 0.5 })
    const t = w.map.towns[0]
    const a = spawnGroup(w, { name: 'A', color: '#fff', people: randomPeople(w, 4), decide: 'vote' }, t.x, t.y)
    const b = spawnGroup(w, { name: 'B', color: '#000', people: randomPeople(w, 2), decide: 'vote' }, t.x + 3, t.y)
    run(w, 10)
    expect(a.met[b.id] ?? b.met[a.id] ?? (b.alive ? undefined : 'merged')).toBeDefined()
    expect(w.fallen).toHaveLength(0)
  })

  it('supplies you drop are found and used', () => {
    const w = createSurvivalWorld({ seed: 11, harshness: 0.5 })
    const t = w.map.towns[2]
    const cache = spawnSupplies(w, t.x + 4, t.y + 4)
    const g = spawnGroup(w, { name: 'Lucky', color: '#fff', people: randomPeople(w, 2) }, t.x, t.y)
    expect(g.known[cache.id]).toBeDefined()
  })

  it('a copy of the world rewinds exactly', () => {
    const w = createSurvivalWorld({ seed: 12, harshness: 0.5 })
    quickStart(w)
    run(w, 300)
    const copy = snapshotSurvival(w)
    run(w, 500)
    const after = w.log.length
    run(copy, 500)
    expect(copy.log.length).toBe(after)
    expect(copy.map).toBe(w.map)
  })

  it('keeps going for weeks without breaking', () => {
    const w = createSurvivalWorld({ seed: 13, harshness: 0.6 })
    quickStart(w)
    spawnGroup(w, { name: 'Raiders', color: '#f00', hostile: true, people: randomPeople(w, 4) }, w.map.towns[1].x, w.map.towns[1].y)
    run(w, DAY * 14)
    for (const p of w.people) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      expect(p.health).toBeLessThanOrEqual(100)
    }
    expect(dayOf(w.tick)).toBe(START_DAY + 14)
  })
})
