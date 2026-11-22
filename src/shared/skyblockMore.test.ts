import { describe, expect, it } from 'vitest'
import {
  addSnapshot,
  changesBetween,
  craftableNow,
  loreStats,
  mergePrices,
  milestones,
  minionHelper,
  networthOf,
  profileList,
  SB_DAY,
  SB_EPOCH,
  SB_MONTH,
  SB_YEAR,
  skyblockDate,
  snapshotOf,
  statBreakdown,
  thin,
  upcomingEvents,
  type SbSnapshot
} from './skyblockMore'
import type { SbData, SbProfileData } from './skyblockGoals'
import type { SbProfileView, SbViewItem } from './skyblockProfile'

const item = (id: string, name: string, count = 1, lore: string[] = []): SbViewItem => ({ id, name, count, lore, rarity: 'RARE', stars: 0, recomb: false }) as unknown as SbViewItem

const view = (over: Partial<Record<string, unknown>> = {}): SbProfileView =>
  ({
    at: 1000,
    profileId: 'p1',
    profileName: 'Apple',
    mode: 'ironman',
    purse: 1_000_000,
    bank: 500_000,
    skyblockLevel: { level: 100, progress: 0.5 },
    skills: [{ id: 'combat', name: 'Combat', level: 20, progress: 0.25 }],
    skillAverage: 20.25,
    slayers: [{ id: 'zombie', name: 'Revenant Horror', level: { level: 3, progress: 0.1, xp: 1500 } }],
    dungeons: null,
    collections: [{ name: 'Farming', items: [{ id: 'WHEAT', name: 'Wheat', count: 120, tier: 2 }] }],
    accessories: { magicalPower: 50, items: [item('ZOMBIE_RING', 'Zombie Ring'), item('SPEED_TALISMAN', 'Speed Talisman')] },
    pets: [{ neuId: 'BEE;4', type: 'BEE', name: 'Bee', rarity: 'LEGENDARY' }],
    museum: null,
    craftedMinions: 12,
    minions: [{ id: 'COBBLESTONE', highest: 2 }],
    fairySouls: { collected: 40, max: 250 },
    gear: {
      armor: [item('NECRON_HELMET', 'Necron Helmet', 1, ['§7Strength: §c+40', '§7Health: §a+180', '§7Cost: 50'])],
      equipment: [item('MOLTEN_CLOAK', 'Molten Cloak', 1, ['§7Strength: §c+10'])],
      wardrobe: [],
      equipmentSets: [],
      wardrobeEquipped: null,
      inventory: [item('ENCHANTED_DIAMOND', 'Enchanted Diamond', 3), item('UNKNOWN_THING', 'Mystery'), item('ZOMBIE_RING', 'Zombie Ring')],
      enderChest: [],
      backpacks: [],
      vault: [],
      bags: [],
      sacks: [{ id: 'WHEAT', name: 'Wheat', count: 1000 }]
    },
    ...over
  }) as unknown as SbProfileView

describe('prices and networth', () => {
  it('merges lowest BIN and Bazaar prices', () => {
    const p = mergePrices({ NECRON_HELMET: 50_000_000 }, { products: { WHEAT: { quick_status: { sellPrice: 2, buyPrice: 3 } } } })
    expect(p.NECRON_HELMET).toBe(50_000_000)
    expect(p.WHEAT).toBeGreaterThan(0)
  })

  it('adds up coins, items, sacks, accessories and pets, counting carried accessories once', () => {
    const prices = { NECRON_HELMET: 50_000_000, ENCHANTED_DIAMOND: 1000, WHEAT: 2, ZOMBIE_RING: 5000, 'BEE;4': 1_000_000 }
    const nw = networthOf(view(), prices, 7)
    expect(nw.coins).toBe(1_500_000)
    const by = Object.fromEntries(nw.sections.map((s) => [s.id, s.value]))
    expect(by.armor).toBe(50_000_000)
    expect(by.inventory).toBe(3000 + 5000)
    expect(by.sacks).toBe(2000)
    // The Zombie Ring in the inventory isn't counted again in the bag.
    expect(by.accessories).toBeUndefined()
    expect(by.pets).toBe(1_000_000)
    expect(nw.total).toBe(1_500_000 + 50_000_000 + 8000 + 2000 + 1_000_000)
    expect(nw.unpriced).toBeGreaterThan(0)
    expect(nw.pricesAt).toBe(7)
  })
})

describe('history', () => {
  const snap = (at: number, over: Partial<SbSnapshot> = {}): SbSnapshot => ({ ...snapshotOf(view(), at), ...over })

  it('keeps one point per play session and skips repeats', () => {
    let h: SbSnapshot[] = []
    h = addSnapshot(h, snap(0))
    h = addSnapshot(h, snap(60_000))
    expect(h).toHaveLength(1)
    h = addSnapshot(h, snap(2 * 60_000, { level: 100.6 }))
    h = addSnapshot(h, snap(3 * 60_000, { level: 100.7 }))
    // The newest moves along inside the gap.
    expect(h.map((s) => s.level)).toEqual([100.5, 100.7])
    h = addSnapshot(h, snap(3 * 3_600_000, { level: 101.2 }))
    expect(h).toHaveLength(3)
  })

  it('lists what changed, and milestones for whole levels', () => {
    const a = snap(0)
    const b = snap(1, {
      level: 101.1,
      skills: { combat: 21.5 },
      collections: { WHEAT: [500, 3] },
      accessories: [...a.accessories, 'BAT_TALISMAN'],
      coins: a.coins + 5000
    })
    const c = changesBetween(a, b, { WHEAT: 'Wheat', BAT_TALISMAN: 'Bat Talisman' })
    expect(c.map((x) => x.kind)).toEqual(['level', 'skill', 'collection', 'coins', 'accessory'])
    expect(c.find((x) => x.kind === 'skill')?.levels).toBe(1)
    const m = milestones([a, b], { WHEAT: 'Wheat', BAT_TALISMAN: 'Bat Talisman' }).map((x) => x.text)
    expect(m).toContain('Reached SkyBlock level 101')
    expect(m).toContain('Combat 21')
    expect(m).toContain('Wheat collection tier 3')
    expect(m).toContain('New accessory: Bat Talisman')
  })

  it('thins long histories but keeps both ends', () => {
    const list = Array.from({ length: 1000 }, (_, i) => ({ at: i }))
    const t = thin(list, 50)
    expect(t).toHaveLength(50)
    expect(t[0].at).toBe(0)
    expect(t[49].at).toBe(999)
  })
})

describe('helpers', () => {
  const data = {
    at: 1,
    collections: {},
    items: {
      ENCHANTED_WHEAT: { id: 'ENCHANTED_WHEAT', name: 'Enchanted Wheat', color: 'a', craft: { inputs: [['WHEAT', 160]], count: 1 } },
      FARM_SUIT: {
        id: 'FARM_SUIT',
        name: 'Farm Suit',
        color: '9',
        craft: {
          inputs: [
            ['HAY_BLOCK', 24],
            ['WHEAT', 1]
          ],
          count: 1
        }
      },
      COBBLESTONE_GENERATOR_1: { id: 'COBBLESTONE_GENERATOR_1', name: 'Cobblestone Minion I', color: '9' },
      COBBLESTONE_GENERATOR_2: { id: 'COBBLESTONE_GENERATOR_2', name: 'Cobblestone Minion II', color: '9' },
      COBBLESTONE_GENERATOR_3: {
        id: 'COBBLESTONE_GENERATOR_3',
        name: 'Cobblestone Minion III',
        color: '9',
        craft: {
          inputs: [
            ['COBBLESTONE', 128],
            ['COBBLESTONE_GENERATOR_2', 1]
          ],
          count: 1
        }
      }
    }
  } as unknown as SbData

  it('finds what you can craft now, leaving out compressing', () => {
    expect(craftableNow(data, { WHEAT: 1000, HAY_BLOCK: 50 })).toEqual([{ id: 'FARM_SUIT', name: 'Farm Suit', color: '9', times: 2 }])
    expect(craftableNow(data, { WHEAT: 1000 })).toEqual([])
  })

  it('shows the next minion tier against what you have', () => {
    const [m] = minionHelper(view(), data, { COBBLESTONE: 64 })
    expect(m).toMatchObject({ type: 'COBBLESTONE', tier: 2, maxTier: 3, next: 'COBBLESTONE_GENERATOR_3', ready: false, progress: 0.5 })
    expect(m.needs).toEqual([{ id: 'COBBLESTONE', name: 'Cobblestone', need: 128, have: 64 }])
    expect(minionHelper(view(), data, { COBBLESTONE: 500 })[0].ready).toBe(true)
  })
})

describe('minion requirements', () => {
  const data = {
    at: 1,
    collections: { RED_SAND: { name: 'Red Sand', group: 'Mining', tiers: [100, 500] } },
    items: {
      RED_SAND_GENERATOR_1: { id: 'RED_SAND_GENERATOR_1', name: 'Red Sand Minion I', color: '9' },
      RED_SAND_GENERATOR_2: {
        id: 'RED_SAND_GENERATOR_2',
        name: 'Red Sand Minion II',
        color: '9',
        req: 'Red Sand I & 3,000 Barbarian Reputation',
        craft: {
          inputs: [
            ['RED_SAND', 10],
            ['RED_SAND_GENERATOR_1', 1]
          ],
          count: 1
        }
      }
    }
  } as unknown as SbData
  const v = view({ minions: [{ id: 'RED_SAND', highest: 1 }] })
  const profile = (rep: number) => ({ collections: { RED_SAND: 200 }, unlockedTiers: { RED_SAND: 1 }, reputation: { mages: 0, barbarians: rep } }) as unknown as SbProfileData

  it('locks the next tier until you have the reputation', () => {
    const [m] = minionHelper(v, data, { RED_SAND: 50 }, profile(1200))
    expect(m.ready).toBe(false)
    expect(m.requires.map((r) => [r.label, r.met])).toEqual([
      ['Red Sand I collection', true],
      ['3,000 Barbarian reputation', false]
    ])
    expect(m.requires[1].detail).toContain('1,800 to go')
    expect(minionHelper(v, data, { RED_SAND: 50 }, profile(3500))[0].ready).toBe(true)
  })
})

describe('stats', () => {
  it('reads stat lines from descriptions, leaving out costs', () => {
    expect(loreStats(['§7Strength: §c+40', '§7Crit Damage: §c+12%', '§7Cost: 50', '§7Health: §a+1,200'])).toEqual({ Strength: 40, 'Crit Damage': 12, Health: 1200 })
  })

  it('adds stats up by where they come from', () => {
    const v = view()
    const lines = statBreakdown([
      { source: 'Armour', items: v.gear!.armor },
      { source: 'Equipment', items: v.gear!.equipment }
    ])
    expect(lines.map((l) => l.stat)).toEqual(['Health', 'Strength'])
    const str = lines.find((l) => l.stat === 'Strength')!
    expect(str.total).toBe(50)
    expect(str.from.map((f) => [f.source, f.value])).toEqual([
      ['Armour', 40],
      ['Equipment', 10]
    ])
  })
})

describe('calendar', () => {
  it('works out the SkyBlock date', () => {
    expect(skyblockDate(SB_EPOCH)).toMatchObject({ year: 1, month: 1, day: 1, hour: 0 })
    expect(skyblockDate(SB_EPOCH + 2 * SB_YEAR + 3 * SB_MONTH + 4 * SB_DAY + SB_DAY / 2)).toMatchObject({ year: 3, month: 4, day: 5, hour: 12 })
  })

  it('lists upcoming events in time order, live ones first', () => {
    const now = SB_EPOCH + 100 * SB_YEAR + 3 * SB_MONTH + 1 * SB_DAY // Year 101, Summer 2: the Traveling Zoo is on.
    const ev = upcomingEvents(now, 20)
    expect(ev[0]).toMatchObject({ name: 'Traveling Zoo', live: true })
    const later = ev.filter((e) => !e.live).map((e) => e.start)
    expect(later).toEqual([...later].sort((a, b) => a - b))
    expect(ev.some((e) => e.name === 'Dark Auction')).toBe(true)
  })
})

describe('profiles', () => {
  it('lists every profile with your level on it, the one you are on first', () => {
    const body = {
      profiles: [
        { profile_id: 'a', cute_name: 'Apple', game_mode: 'ironman', members: { me: { leveling: { experience: 15000 } } } },
        { profile_id: 'b', cute_name: 'Banana', selected: true, members: { me: { leveling: { experience: 900 } }, friend: {} } }
      ]
    }
    expect(profileList(body, 'me')).toEqual([
      { id: 'b', name: 'Banana', mode: '', selected: true, level: 9, members: 2 },
      { id: 'a', name: 'Apple', mode: 'ironman', selected: false, level: 150, members: 1 }
    ])
  })
})

describe('item ids', () => {
  it('turns rune sack ids into NEU ones', async () => {
    const { neuId } = await import('./skyblockGoals')
    expect(neuId('RUNE_MUSIC_1')).toBe('MUSIC_RUNE;1')
    expect(neuId('RUNE_ZOMBIE_SLAYER_3')).toBe('ZOMBIE_SLAYER_RUNE;3')
    expect(neuId('INK_SACK:4')).toBe('INK_SACK-4')
  })

  it('draws new-style vanilla models as the old item', async () => {
    const { modernVanilla } = await import('./skyblockTextures')
    expect(modernVanilla('minecraft:music_disc_chirp', {}, {})).toEqual({ id: 'record_chirp', damage: 0 })
    expect(modernVanilla('minecraft:crafter', {}, {})).toEqual({ id: 'dropper', damage: 0 })
    expect(modernVanilla('minecraft:player_head', {}, {})).toBeNull()
    expect(modernVanilla('hypixel_skyblock:item/foo', {}, {})).toBeNull()
  })
})

describe('misc stats', () => {
  it('groups stats and turns numbered repeats into one table', async () => {
    const { groupStats } = await import('./skyblockMore')
    const g = groupStats([
      { key: 'highest_damage', value: 5 },
      { key: 'candy_collected.green_candy', value: 2944 },
      { key: 'candy_collected.spooky_festival_222.green_candy', value: 21 },
      { key: 'candy_collected.spooky_festival_222.total', value: 36 },
      { key: 'candy_collected.spooky_festival_222.purple_candy', value: 15 },
      { key: 'candy_collected.spooky_festival_276.green_candy', value: 3 },
      { key: 'candy_collected.spooky_festival_276.total', value: 4 }
    ])
    expect(g.map((x) => x.name)).toEqual(['General', 'Candy Collected'])
    const candy = g[1]
    expect(candy.rows).toEqual([{ key: 'candy_collected.green_candy', label: 'Green Candy', value: 2944 }])
    expect(candy.series).toEqual([
      {
        name: 'Spooky Festival',
        columns: ['Green Candy', 'Purple Candy', 'Total'],
        rows: [
          { label: '276', values: [3, null, 4] },
          { label: '222', values: [21, 15, 36] }
        ]
      }
    ])
  })
})
