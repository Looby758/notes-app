import { describe, expect, it } from 'vitest'
import { buildExtras, levelOf, levelOfTotals, petLevel, profileView, rarityOf, viewItems } from './skyblockProfile'
import type { SbData } from './skyblockGoals'

const constants = {
  leveling: { leveling_caps: { farming: 50, combat: 60 }, catacombs: [50, 75, 110], runecrafting_xp: [50], social: [50] },
  pets: { pet_levels: [100, 110, 120, 130, 145], pet_rarity_offset: { COMMON: 0, RARE: 2 }, custom_pet_leveling: {} },
  misc: { talisman_upgrades: { ZOMBIE_TALISMAN: ['ZOMBIE_RING'], ZOMBIE_RING: ['ZOMBIE_ARTIFACT'], SPEED_TALISMAN: ['SPEED_RING'] }, ignored_talisman: ['IGNORED_ONE'] },
  bestiary: { brackets: { '1': [10, 20, 50] }, hub: { name: '§aHub', mobs: [{ name: '§cZombie', mobs: ['zombie_1', 'zombie_5'], cap: 20, bracket: 1 }] } },
  garden: { garden_exp: [0, 70, 70], crop_milestones: { WHEAT: [30, 50] } },
  fairy_souls: { 'Max Souls': 250 },
  trophyfish: { BLOBFISH: [1] }
}
const acc = (id: string, rarity: string): unknown => ({ internalname: id, lore: ['', `§l${rarity} ACCESSORY`] })
const itemFiles = [acc('ZOMBIE_TALISMAN', 'COMMON'), acc('ZOMBIE_RING', 'UNCOMMON'), acc('ZOMBIE_ARTIFACT', 'RARE'), acc('SPEED_TALISMAN', 'COMMON'), acc('SPEED_RING', 'UNCOMMON'), acc('BAT_TALISMAN', 'RARE'), acc('IGNORED_ONE', 'COMMON')]
const data: SbData = {
  at: 1,
  items: {},
  collections: { WHEAT: { name: 'Wheat', group: 'Farming', tiers: [50, 100] } },
  skillXp: [50, 125, 200],
  slayerXp: { zombie: [5, 15, 200] },
  hotmXp: [0, 3000, 9000],
  extras: buildExtras(constants, itemFiles)
}

describe('levels', () => {
  it('works out level and progress from per-level steps', () => {
    expect(levelOf(175, [50, 125, 200])).toMatchObject({ level: 2, into: 0, needed: 200, progress: 0 })
    expect(levelOf(275, [50, 125, 200])).toMatchObject({ level: 2, into: 100, progress: 0.5 })
    expect(levelOf(9999, [50, 125, 200], 2)).toMatchObject({ level: 2, max: 2, progress: 1 })
    expect(levelOfTotals(10, [5, 15, 200])).toMatchObject({ level: 1, into: 5, needed: 10, progress: 0.5 })
  })

  it('reads rarity from the last lore line', () => {
    expect(rarityOf(['§7Hi', '', '§6§lLEGENDARY SWORD'])).toBe('LEGENDARY')
    expect(rarityOf(['§c§l§ka§r §c§lVERY SPECIAL ACCESSORY §c§l§ka'])).toBe('VERY SPECIAL')
    expect(rarityOf(['nothing'])).toBe('')
  })

  it('levels pets by rarity, starting at 1', () => {
    expect(petLevel('BEE', 'COMMON', 0, data.extras!).level).toBe(1)
    expect(petLevel('BEE', 'COMMON', 210, data.extras!).level).toBe(3)
    // Rare starts two steps further along the table.
    expect(petLevel('BEE', 'RARE', 250, data.extras!).level).toBe(3)
  })
})

describe('profileView', () => {
  const nbtOf = (list: unknown[]): string => JSON.stringify({ i: list })
  const slot = (id: string, name: string, rarity: string, kind = 'ACCESSORY'): unknown => ({ Count: 1, id: 'minecraft:stone', tag: { ExtraAttributes: { id }, display: { Name: name, Lore: ['', `§l${rarity} ${kind}`] } } })
  const decode = (s: string): unknown => JSON.parse(s)
  const me = {
    player_data: { experience: { SKILL_FARMING: 175, SKILL_COMBAT: 50 }, crafted_generators: ['WHEAT_1', 'WHEAT_3'] },
    leveling: { experience: 1250 },
    currencies: { coin_purse: 100, essence: { WITHER: { current: 5 } } },
    collection: { WHEAT: 60 },
    slayer: { slayer_bosses: { zombie: { xp: 20, boss_kills_tier_0: 3 } } },
    inventory: {
      inv_contents: { data: nbtOf([slot('BAT_TALISMAN', '§9Bat Talisman', 'RARE'), null]) },
      inv_armor: { data: nbtOf([slot('BOOTS', '§fBoots', 'COMMON', 'BOOTS'), null, null, slot('HAT', '§fHat', 'COMMON', 'HELMET')]) },
      bag_contents: { talisman_bag: { data: nbtOf([slot('ZOMBIE_RING', '§aZombie Ring', 'UNCOMMON'), slot('ZOMBIE_TALISMAN', '§fZombie Talisman', 'COMMON')]) } }
    },
    bestiary: { kills: { zombie_1: 15, zombie_5: 10 } },
    pets_data: { pets: [{ type: 'BEE', tier: 'RARE', exp: 250, active: true }] }
  }
  const body = { profiles: [{ profile_id: 'p', cute_name: 'Mango', game_mode: 'ironman', selected: true, members: { abc: me, other: { player_data: { crafted_generators: ['WHEAT_2', 'SNOW_1'] } } } }] }

  it('reads levels, gear, accessories, pets, collections, minions and bestiary', () => {
    const v = profileView(body, 'abc', '', 1, data, decode, { garden: { garden: { garden_experience: 140, resources_collected: { WHEAT: 40 } } } })!
    expect(v.skyblockLevel).toEqual({ level: 12, progress: 0.5 })
    expect(v.skills?.find((s) => s.id === 'farming')).toMatchObject({ level: 2, max: 3 })
    expect(v.slayers.find((s) => s.id === 'zombie')).toMatchObject({ level: { level: 2 }, kills: [3, 0, 0, 0, 0] })
    expect(v.gear?.armor.map((a) => a?.id ?? null)).toEqual(['HAT', null, null, 'BOOTS'])
    // The ring covers the talisman, so only the ring and the bat count; the artifact is missing, the speed family's lowest is missing.
    expect(v.accessories?.magicalPower).toBe(5 + 8)
    expect(v.accessories?.missing.map((m) => m.id)).toEqual(['SPEED_TALISMAN', 'ZOMBIE_ARTIFACT'])
    expect(v.pets[0]).toMatchObject({ name: 'Bee', active: true, level: { level: 3 } })
    expect(v.collections?.[0]).toMatchObject({ group: 'Farming', items: [{ id: 'WHEAT', count: 60, tier: 1, next: 100 }] })
    expect(v.minions).toEqual([
      { id: 'SNOW', name: 'Snow Minion', tiers: [1], highest: 1 },
      { id: 'WHEAT', name: 'Wheat Minion', tiers: [1, 2, 3], highest: 3 }
    ])
    expect(v.craftedMinions).toBe(4)
    expect(v.bestiary).toEqual([{ island: 'Hub', mobs: [{ name: 'Zombie', kills: 25, tier: 2, maxTier: 2 }] }])
    expect(v.garden?.level.level).toBe(3)
    expect(v.garden?.crops[0]).toMatchObject({ id: 'WHEAT', milestone: { level: 1 } })
    expect(v.essence).toEqual([{ id: 'Wither', amount: 5 }])
    expect(v.fairySouls.max).toBe(250)
    expect(v.coopMembers).toBe(1)
  })

  it('names the API settings that are off', () => {
    const v = profileView({ profiles: [{ profile_id: 'p', members: { abc: {} } }] }, 'abc', '', 1, data, decode)!
    expect(v.hidden.join(' ')).toMatch(/Skills API/)
    expect(v.hidden.join(' ')).toMatch(/Inventory API/)
    expect(v.hidden.join(' ')).toMatch(/Collections API/)
    expect(v.gear).toBeNull()
  })

  it('keeps empty slots so wardrobe and grids line up', () => {
    expect(viewItems({ i: [null, {}, { Count: 2, tag: { ExtraAttributes: { id: 'X' } } }] }).map((i) => i?.id ?? null)).toEqual([null, null, 'X'])
  })
})
