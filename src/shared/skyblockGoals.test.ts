import { describe, expect, it } from 'vitest'
import { gzipSync, gunzipSync } from 'zlib'
import {
  buildCollections,
  buildItems,
  checkRequirement,
  countNbtItems,
  fromRoman,
  keyWarning,
  learnRates,
  levelFromSteps,
  orderGoals,
  parseRequirements,
  planGoals,
  profileData,
  readNbt,
  searchItems,
  type SbData,
  type SbProfileData
} from './skyblockGoals'

const files = [
  { internalname: 'ENDER_PEARL', displayname: '§fEnder Pearl' },
  { internalname: 'ENCHANTED_ENDER_PEARL', displayname: '§aEnchanted Ender Pearl', crafttext: 'Requires: Ender Pearl II', recipe: { A1: '', A2: 'ENDER_PEARL:4', A3: '', B1: 'ENDER_PEARL:4', B2: 'ENDER_PEARL:4', B3: 'ENDER_PEARL:4', C1: '', C2: 'ENDER_PEARL:4', C3: '' } },
  { internalname: 'ABSOLUTE_ENDER_PEARL', displayname: '§9Absolute Ender Pearl', crafttext: 'Requires: Ender Pearl VII', recipe: { A1: 'ENCHANTED_ENDER_PEARL:16', A2: 'ENCHANTED_ENDER_PEARL:16', A3: 'ENCHANTED_ENDER_PEARL:16', B1: 'ENCHANTED_ENDER_PEARL:16', B2: 'ENCHANTED_ENDER_PEARL:16' } },
  { internalname: 'BLADE', displayname: '§6Big Blade', crafttext: 'Requires: Enderman Slayer 3', recipe: { A1: 'ABSOLUTE_ENDER_PEARL:1', B1: 'STICK:1', C1: 'JUDGEMENT_CORE:1' } },
  { internalname: 'STICK', displayname: '§fStick', recipe: { A1: 'WOOD:1', B1: 'WOOD:1', count: 4 } },
  { internalname: 'WOOD', displayname: '§fOak Wood Planks', recipe: { A1: 'LOG:1', count: 4 } },
  { internalname: 'LOG', displayname: '§fOak Log' },
  { internalname: 'JUDGEMENT_CORE', displayname: '§6Judgement Core' },
  { internalname: 'REFINED_THING', displayname: '§5Refined Thing', recipes: [{ type: 'forge', inputs: ['ENDER_PEARL:10'], count: 1, duration: 3600 }] },
  { internalname: 'ZEALOT_MONSTER', displayname: '§dZealot §7(§cMonster§7)', recipes: [{ type: 'drops', name: '§dZealot', drops: [{ id: 'ENDER_PEARL:4', chance: '100%' }, { id: 'JUDGEMENT_CORE', chance: '0.1%' }] }] },
  { internalname: 'PEARL_DEALER_NPC', displayname: '§9Pearl Dealer (NPC)', recipes: [{ type: 'npc_shop', cost: ['SKYBLOCK_COIN:50'], result: 'ENDER_PEARL:1' }] },
  { internalname: 'ENDERMAN_GENERATOR_1', displayname: '§9Enderman Minion I', recipe: { A1: 'ENDER_PEARL:8', B2: 'WOOD_SWORD:1' } },
  { internalname: 'ULTIMATE_THING;1', displayname: '§dEnchanted Book' }
]

const collectionsBody = {
  collections: {
    COMBAT: { items: { ENDER_PEARL: { name: 'Ender Pearl', tiers: [{ tier: 2, amountRequired: 250 }, { tier: 1, amountRequired: 50 }, { tier: 3, amountRequired: 1000 }, { tier: 4, amountRequired: 2500 }, { tier: 5, amountRequired: 5000 }, { tier: 6, amountRequired: 10000 }, { tier: 7, amountRequired: 15000 }] } } },
    FORAGING: { items: { LOG: { name: 'Oak Log', tiers: [{ tier: 1, amountRequired: 50 }] } } }
  }
}

const data: SbData = {
  at: 1,
  items: buildItems(files),
  collections: buildCollections(collectionsBody),
  skillXp: [50, 125, 200],
  slayerXp: { enderman: [10, 30, 250, 1500] },
  hotmXp: [0, 3000, 9000]
}

const profile = (over: Partial<SbProfileData> = {}): SbProfileData => ({
  at: 1,
  profileName: 'Mango',
  mode: 'ironman',
  owned: {},
  collections: { ENDER_PEARL: 3000 },
  unlockedTiers: { ENDER_PEARL: 4 },
  skills: {},
  slayer: { enderman: 100 },
  hotmXp: 0,
  hidden: [],
  ...over
})

describe('buildItems', () => {
  it('reads recipes, forge, requirements, drops, NPC shops and minions', () => {
    const pearl = data.items.ENDER_PEARL
    expect(pearl.name).toBe('Ender Pearl')
    expect(pearl.drops).toEqual([{ mob: 'Zealot', chance: '100%' }])
    expect(pearl.shops).toEqual([{ npc: 'Pearl Dealer', cost: [['SKYBLOCK_COIN', 50]], count: 1 }])
    expect(pearl.minion).toBe(true)
    expect(data.items.ENCHANTED_ENDER_PEARL.craft).toEqual({ inputs: [['ENDER_PEARL', 20]], count: 1 })
    expect(data.items.ENCHANTED_ENDER_PEARL.req).toBe('Ender Pearl II')
    expect(data.items.STICK.craft?.count).toBe(4)
    expect(data.items.REFINED_THING.forge).toEqual({ inputs: [['ENDER_PEARL', 10]], count: 1, seconds: 3600 })
    expect(data.items.ABSOLUTE_ENDER_PEARL.color).toBe('9')
    expect(data.collections.ENDER_PEARL.tiers.slice(0, 3)).toEqual([50, 250, 1000])
  })
})

describe('requirements', () => {
  it('parses collections, slayers, HotM and things Orbit can’t check', () => {
    expect(parseRequirements('Ender Pearl VII', data.collections)).toEqual([{ kind: 'collection', id: 'ENDER_PEARL', name: 'Ender Pearl', tier: 7 }])
    expect(parseRequirements('Enderman Slayer 7', data.collections)).toEqual([{ kind: 'slayer', boss: 'enderman', name: 'Enderman Slayer', level: 7 }])
    expect(parseRequirements('Gemstone X & HotM 5', data.collections)).toEqual([{ kind: 'other', text: 'Gemstone X' }, { kind: 'hotm', level: 5 }])
    expect(parseRequirements('Heart of the Mountain Tier 7', data.collections)).toEqual([{ kind: 'hotm', level: 7 }])
    expect(parseRequirements('Combat Skill 24', data.collections)).toEqual([{ kind: 'skill', skill: 'combat', level: 24 }])
    expect(fromRoman('IX')).toBe(9)
  })

  it('says how far off you are', () => {
    const c = checkRequirement({ kind: 'collection', id: 'ENDER_PEARL', name: 'Ender Pearl', tier: 7 }, data, profile())
    expect(c.met).toBe(false)
    expect(c.detail).toBe('You’re at IV, 12,000 more to collect.'.replace('’', "'"))
    expect(checkRequirement({ kind: 'collection', id: 'ENDER_PEARL', name: 'Ender Pearl', tier: 2 }, data, profile()).met).toBe(true)
    const s = checkRequirement({ kind: 'slayer', boss: 'enderman', name: 'Enderman Slayer', level: 4 }, data, profile())
    expect(s).toMatchObject({ met: false, detail: "You're level 2, 1,400 slayer XP to go." })
    expect(checkRequirement({ kind: 'hotm', level: 2 }, data, profile({ hotmXp: 3000 })).met).toBe(true)
    expect(checkRequirement({ kind: 'collection', id: 'ENDER_PEARL', name: 'Ender Pearl', tier: 2 }, data, profile({ collections: null, unlockedTiers: {} })).met).toBeNull()
    expect(levelFromSteps(175, [50, 125, 200])).toBe(2)
  })
})

describe('planGoals', () => {
  it('breaks a goal down to raw materials with have and need', () => {
    const [plan] = planGoals([{ id: 'BLADE', amount: 1, pinned: true, added: 1 }], data, profile({ owned: { ENCHANTED_ENDER_PEARL: 30, ENDER_PEARL: 100 } }), { ENDER_PEARL: 1000 })
    const tree = plan.tree!
    expect(tree.crafts).toBe(1)
    const abs = tree.children[0]
    expect(abs.id).toBe('ABSOLUTE_ENDER_PEARL')
    const ench = abs.children[0]
    expect(ench).toMatchObject({ need: 80, have: 30, crafts: 50 })
    expect(ench.children[0]).toMatchObject({ id: 'ENDER_PEARL', need: 1000, have: 100, missing: 900 })
    expect(ench.children[0].tags).toEqual(['collection', 'minion', 'mob', 'npc'])
    // A stick comes in fours from two planks, which come in fours from a log.
    const stick = tree.children[1]
    expect(stick).toMatchObject({ crafts: 1 })
    expect(stick.children[0]).toMatchObject({ id: 'WOOD', need: 2, crafts: 1 })
    expect(stick.children[0].children[0]).toMatchObject({ id: 'LOG', need: 1, missing: 1 })
    expect(plan.raw.map((r) => [r.id, r.missing])).toEqual([['ENDER_PEARL', 900], ['JUDGEMENT_CORE', 1], ['LOG', 1]])
    expect(plan.hoursLeft).toBeCloseTo(0.9)
    expect(plan.noRate).toBe(2)
    expect(plan.progress).toBeGreaterThan(0)
    expect(plan.progress).toBeLessThan(1)
    // Locked: the blade needs Enderman Slayer 3 (100 XP is level 2) and Absolute needs Ender Pearl VII.
    expect(plan.blockers.map((b) => b.check.label).sort()).toEqual(['Ender Pearl VII collection', 'Enderman Slayer 3'])
    expect(plan.blockers.find((b) => b.check.label === 'Enderman Slayer 3')?.for).toEqual(['Big Blade'])
  })

  it('counts shared materials once across goals', () => {
    const owned = { ENDER_PEARL: 30 }
    const [a, b] = planGoals(
      [
        { id: 'ENCHANTED_ENDER_PEARL', amount: 1, pinned: true, added: 1 },
        { id: 'ENCHANTED_ENDER_PEARL', amount: 1, pinned: false, added: 2 }
      ],
      data,
      profile({ owned }),
      {}
    )
    expect(a.tree!.children[0]).toMatchObject({ have: 20, missing: 0 })
    expect(b.tree!.children[0]).toMatchObject({ have: 10, missing: 10 })
    expect(a.progress).toBe(1)
    expect(b.progress).toBeCloseTo(0.5)
  })

  it('is done when you already have it', () => {
    const [p] = planGoals([{ id: 'BLADE', amount: 1, pinned: true, added: 1 }], data, profile({ owned: { BLADE: 1 } }), {})
    expect(p).toMatchObject({ done: true, progress: 1, hoursLeft: 0, blockers: [] })
  })

  it('adds up time in the Forge', () => {
    const [p] = planGoals([{ id: 'REFINED_THING', amount: 2, pinned: true, added: 1 }], data, null, {})
    expect(p.forgeHours).toBe(1)
    expect(p.tree!.crafts).toBe(2)
    expect(p.tree!.tags).toContain('forge')
  })
})

describe('profile and items', () => {
  /** A tiny NBT writer for the test: { i: [ {Count, tag: {ExtraAttributes: {id}}} ] }. */
  function nbtList(items: [string, number][]): string {
    const parts: number[] = []
    const u16 = (n: number): void => void parts.push((n >> 8) & 255, n & 255)
    const i32 = (n: number): void => void parts.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255)
    const name = (s: string): void => {
      const b = Buffer.from(s)
      u16(b.length)
      parts.push(...b)
    }
    parts.push(10)
    name('')
    parts.push(9)
    name('i')
    parts.push(10)
    i32(items.length + 1)
    parts.push(0) // an empty slot
    for (const [id, count] of items) {
      parts.push(1)
      name('Count')
      parts.push(count)
      parts.push(10)
      name('tag')
      parts.push(10)
      name('ExtraAttributes')
      parts.push(8)
      name('id')
      name(id)
      parts.push(0, 0, 0)
    }
    parts.push(0)
    return gzipSync(Buffer.from(parts)).toString('base64')
  }
  const count = (b64: string): Record<string, number> => countNbtItems(readNbt(gunzipSync(Buffer.from(b64, 'base64'))))

  it('reads Hypixel’s packed item lists', () => {
    expect(count(nbtList([['ENDER_PEARL', 16], ['LOG:2', 64], ['ENDER_PEARL', 4]]))).toEqual({ ENDER_PEARL: 20, 'LOG-2': 64 })
  })

  it('adds up inventory, ender chest, backpacks and sacks, and names API settings that are off', () => {
    const body = {
      profiles: [
        {
          profile_id: 'p1',
          cute_name: 'Mango',
          game_mode: 'ironman',
          selected: true,
          members: {
            abc: {
              inventory: {
                inv_contents: { data: nbtList([['ENDER_PEARL', 16]]) },
                ender_chest_contents: { data: nbtList([['ENDER_PEARL', 10]]) },
                backpack_contents: { 0: { data: nbtList([['JUDGEMENT_CORE', 1]]) } },
                sacks_counts: { ENDER_PEARL: 100, 'LOG:2': 5, EMPTY: 0 }
              },
              player_data: { unlocked_coll_tiers: ['ENDER_PEARL_4', 'ENDER_PEARL_2', 'LOG:2_1'] },
              slayer: { slayer_bosses: { enderman: { xp: 250 } } },
              mining_core: { experience: 4000 }
            }
          }
        }
      ]
    }
    const p = profileData(body, 'a-b-c', '', 5, count)!
    expect(p.owned).toEqual({ ENDER_PEARL: 126, JUDGEMENT_CORE: 1, 'LOG-2': 5 })
    expect(p.unlockedTiers).toEqual({ ENDER_PEARL: 4, 'LOG-2': 1 })
    expect(p.slayer).toEqual({ enderman: 250 })
    expect(p.hotmXp).toBe(4000)
    expect(p.collections).toBeNull()
    expect(p.hidden.join(' ')).toMatch(/Collections API is off/)
    expect(p.hidden.join(' ')).toMatch(/Skills API is off/)
    expect(p.hidden.join(' ')).toMatch(/Personal Vault/)
    expect(p.hidden.join(' ')).not.toMatch(/Inventory API/)
  })

  it('says when the inventory API is off', () => {
    const p = profileData({ profiles: [{ profile_id: 'p', members: { abc: { collection: { ENDER_PEARL: 5 } } } }] }, 'abc', '', 1, () => ({}))!
    expect(p.hidden[0]).toMatch(/Inventory API is off/)
    expect(p.collections).toEqual({ ENDER_PEARL: 5 })
  })
})

describe('the rest', () => {
  it('learns rates only from sessions where the collection went up', () => {
    const rates = learnRates([
      { minutes: 60, collected: [{ id: 'ENDER_PEARL', count: 600 }] },
      { minutes: 30, collected: [{ id: 'ENDER_PEARL', count: 300 }, { id: 'LOG:2', count: 2 }] },
      { minutes: 120, collected: [{ id: 'WHEAT', count: 5000 }] },
      { minutes: 2, collected: [{ id: 'SAND', count: 50 }] }
    ])
    expect(rates.ENDER_PEARL).toBe(600)
    expect(rates['LOG-2']).toBe(4)
    expect(rates.WHEAT).toBe(2500)
    expect(rates.SAND).toBeUndefined()
  })

  it('searches by name, skipping mobs, NPCs and enchanted books', () => {
    expect(searchItems(data.items, 'ender pearl').map((i) => i.id)).toEqual(['ENDER_PEARL', 'ABSOLUTE_ENDER_PEARL', 'ENCHANTED_ENDER_PEARL'])
    expect(searchItems(data.items, 'zealot')).toEqual([])
    expect(searchItems(data.items, 'enchanted book')).toEqual([])
  })

  it('warns a day before a developer key runs out', () => {
    const saved = 1_700_000_000_000
    expect(keyWarning(saved, false, saved + 86_400_000)).toBe('')
    expect(keyWarning(saved, false, saved + 2.5 * 86_400_000)).toMatch(/runs out in about 12h/)
    expect(keyWarning(saved, false, saved + 3.1 * 86_400_000)).toMatch(/probably run out/)
    expect(keyWarning(saved, true, saved + 5 * 86_400_000)).toBe('')
    expect(keyWarning(null, false, 5 * 86_400_000)).toBe('')
  })

  it('puts pinned goals first', () => {
    expect(orderGoals([{ id: 'a', amount: 1, pinned: false, added: 1 }, { id: 'b', amount: 1, pinned: true, added: 2 }]).map((g) => g.id)).toEqual(['b', 'a'])
  })
})
