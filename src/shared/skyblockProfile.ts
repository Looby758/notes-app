/**
 * SkyBlock profile page, the pure parts: like SkyCrypt, but only for your own account and kept in
 * Orbit. Reads the profile Hypixel sends (plus the garden and museum answers) into one tidy view:
 * levels, slayers, dungeons, mining, gear with full item details, accessories (and which you're
 * missing), pets, collections, minions, bestiary, garden, rift, trophy fish, Crimson Isle and Kuudra,
 * and the rest of the stats. The level tables and names come from the NEU repo (`SbExtras`).
 *
 * No networth: that's priced from the Auction House and Bazaar, which an ironman doesn't use.
 */

import { neuId, prettyId, stripColors, type SbData } from './skyblockGoals'
import type { ItemIcon } from './skyblockTextures'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : [])
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {})

// ---------- what's needed from the NEU repo ----------

export interface SbBestiaryMob {
  name: string
  /** The kill keys Hypixel uses ("zealot_enderman_55"). */
  ids: string[]
  cap: number
  bracket: number
}

export interface SbExtras {
  /** Skill → highest level. */
  skillCaps: Record<string, number>
  runecraftingXp: number[]
  socialXp: number[]
  catacombsXp: number[]
  petLevels: number[]
  petRarityOffset: Record<string, number>
  /** Pets that level differently (Golden Dragon to 200). */
  petCustom: Record<string, { levels: number[]; maxLevel: number }>
  /** Every accessory, with its rarity. */
  accessories: { id: string; rarity: string }[]
  /** Accessory → the ones it upgrades into. */
  accessoryUpgrades: Record<string, string[]>
  ignoredAccessories: string[]
  bestiary: { island: string; mobs: SbBestiaryMob[] }[]
  bestiaryBrackets: Record<string, number[]>
  gardenXp: number[]
  /** Crop → XP for each milestone. */
  cropMilestones: Record<string, number[]>
  fairySoulsMax: number
  /** Trophy fish ids. */
  trophyFish: string[]
}

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'DIVINE', 'SPECIAL', 'VERY SPECIAL']

/** The rarity on an item's last lore line ("§6§lLEGENDARY ACCESSORY" → LEGENDARY). */
export function rarityOf(lore: readonly string[]): string {
  for (let i = lore.length - 1; i >= Math.max(0, lore.length - 3); i--) {
    const line = stripColors(lore[i] ?? '')
      .replace(/^a\s+/, '')
      .toUpperCase()
    const r = [...RARITIES].sort((a, b) => b.length - a.length).find((x) => line.startsWith(x))
    if (r) return r
  }
  return ''
}

/** The NEU repo's constants (and accessories from its items) into what the profile page needs. */
export function buildExtras(c: Record<string, unknown>, itemFiles: unknown[]): SbExtras {
  const leveling = obj(c.leveling)
  const pets = obj(c.pets)
  const misc = obj(c.misc)
  const bestiary = obj(c.bestiary)
  const garden = obj(c.garden)
  const skillCaps: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(leveling.leveling_caps))) if (num(v) !== null) skillCaps[k.toLowerCase()] = v as number
  const petCustom: SbExtras['petCustom'] = {}
  for (const [k, v] of Object.entries(obj(pets.custom_pet_leveling))) {
    const o = obj(v)
    petCustom[k] = {
      levels: nums(o.pet_levels),
      maxLevel: num(o.max_level) ?? 100
    }
  }
  const accessories: SbExtras['accessories'] = []
  for (const f of itemFiles) {
    if (!isObj(f) || typeof f.internalname !== 'string' || !Array.isArray(f.lore)) continue
    const last = stripColors(String(f.lore[f.lore.length - 1] ?? '')).toUpperCase()
    const display = stripColors(String(f.displayname ?? ''))
    // Hypixel's leftover test items aren't real accessories.
    if (/please ignore|^test\b/i.test(display)) continue
    // Legacy items (like the old Personal Compactor 4000) can't be had any more.
    if (f.lore.some((l) => /Legacy Item/i.test(stripColors(String(l))))) continue
    if (/\b(ACCESSORY|HATCESSORY)\b/.test(last) && !f.internalname.includes(';'))
      accessories.push({
        id: f.internalname,
        rarity: rarityOf(f.lore.map(String))
      })
  }
  const accessoryUpgrades: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj(misc.talisman_upgrades))) if (Array.isArray(v)) accessoryUpgrades[k] = v.map(String)
  const ignored = misc.ignored_talisman
  const islands: SbExtras['bestiary'] = []
  for (const [key, v] of Object.entries(bestiary)) {
    const island = obj(v)
    if (!Array.isArray(island.mobs)) continue
    islands.push({
      island: typeof island.name === 'string' ? stripColors(island.name) : prettyId(key),
      mobs: island.mobs.filter(isObj).map((m) => ({
        name: stripColors(String(m.name ?? '')),
        ids: Array.isArray(m.mobs) ? m.mobs.map(String) : [],
        cap: num(m.cap) ?? 0,
        bracket: num(m.bracket) ?? 1
      }))
    })
  }
  const bestiaryBrackets: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(obj(bestiary.brackets))) bestiaryBrackets[k] = nums(v)
  const cropMilestones: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(obj(garden.crop_milestones))) cropMilestones[k] = nums(v)
  const fairy = obj(c.fairy_souls)
  return {
    skillCaps,
    runecraftingXp: nums(leveling.runecrafting_xp),
    socialXp: nums(leveling.social),
    catacombsXp: nums(leveling.catacombs),
    petLevels: nums(pets.pet_levels),
    petRarityOffset: Object.fromEntries(Object.entries(obj(pets.pet_rarity_offset)).map(([k, v]) => [k, num(v) ?? 0])),
    petCustom,
    accessories,
    accessoryUpgrades,
    ignoredAccessories: Array.isArray(ignored) ? ignored.map(String) : [],
    bestiary: islands,
    bestiaryBrackets,
    gardenXp: nums(garden.garden_exp),
    cropMilestones,
    fairySoulsMax: num(fairy['Max Souls']) ?? 0,
    trophyFish: Object.keys(obj(c.trophyfish))
  }
}

// ---------- levels ----------

export interface Level {
  level: number
  max: number
  xp: number
  /** 0 to 1 towards the next level (1 at max). */
  progress: number
  /** XP into this level, and the XP this level needs. */
  into: number
  needed: number
}

/** A level from XP, where `steps` is the XP each level needs one after another. */
export function levelOf(xp: number, steps: readonly number[], cap = steps.length): Level {
  const max = Math.min(cap, steps.length)
  let level = 0
  let left = Math.max(0, xp)
  while (level < max && left >= steps[level]) {
    left -= steps[level]
    level++
  }
  const needed = level < max ? steps[level] : 0
  return {
    level,
    max,
    xp,
    progress: level >= max ? 1 : needed ? left / needed : 0,
    into: left,
    needed
  }
}

/** A level from XP, where `totals` is the total XP for level 1, 2, 3… (slayers). */
export function levelOfTotals(xp: number, totals: readonly number[]): Level {
  const level = totals.filter((t) => xp >= t).length
  const prev = level ? totals[level - 1] : 0
  const next = totals[level]
  return {
    level,
    max: totals.length,
    xp,
    progress: next === undefined ? 1 : (xp - prev) / (next - prev),
    into: xp - prev,
    needed: next === undefined ? 0 : next - prev
  }
}

// ---------- items ----------

export interface SbViewItem {
  id: string
  /** With Minecraft colour codes, as shown in game. */
  name: string
  lore: string[]
  count: number
  rarity: string
  /** Recombobulated, enchanted, stars… shown as small marks. */
  stars: number
  recomb: boolean
  /** Minecraft item, for an icon: "minecraft:diamond_sword", or the numeric id from 1.8. */
  material: string
  /** Enchanted, so drawn with the shimmer. */
  glint: boolean
  /** Its picture from the SkyBlock add-on's texture packs, or its head skin. */
  icon?: ItemIcon
}

/** Works out an item's picture from its raw slot (Minecraft id, damage and NBT). */
export type SlotIconOf = (slot: Record<string, unknown>) => ItemIcon | undefined

/** An item list ({ i: [...] }) into items, keeping empty slots as null (so wardrobe slots line up). */
export function viewItems(root: unknown, iconOf?: SlotIconOf): (SbViewItem | null)[] {
  const list = isObj(root) && Array.isArray(root.i) ? root.i : []
  return list.map((slot) => {
    if (!isObj(slot) || !isObj(slot.tag)) return null
    const tag = slot.tag
    const extra = obj(tag.ExtraAttributes)
    const display = obj(tag.display)
    const id = typeof extra.id === 'string' ? neuId(extra.id) : ''
    const name = typeof display.Name === 'string' ? display.Name : id ? prettyId(id) : ''
    if (!id && !name) return null
    const lore = Array.isArray(display.Lore) ? display.Lore.map(String) : []
    return {
      id,
      name,
      lore,
      count: Math.max(1, num(slot.Count) ?? 1),
      rarity: rarityOf(lore),
      stars: (num(extra.upgrade_level) ?? num(extra.dungeon_item_level) ?? 0) as number,
      recomb: num(extra.rarity_upgrades) === 1,
      material: String(slot.id ?? ''),
      glint: (isObj(extra.enchantments) && Object.keys(extra.enchantments).length > 0) || (Array.isArray(tag.ench) && tag.ench.length > 0),
      icon: iconOf?.(slot)
    }
  })
}

// ---------- the view ----------

export interface SkillLine extends Level {
  id: string
  name: string
}

export interface SbPet {
  type: string
  name: string
  rarity: string
  level: Level
  active: boolean
  /** The NEU item id for its picture: the pet ("BEE;4") or its skin ("PET_SKIN_…"). */
  neuId: string
  heldItem: string
  heldItemId: string
  candy: number
  skin: string
  uuid?: string
}

export interface SbLoadout {
  slot: number
  name: string
  armorSet: number | null
  equipmentSet: number | null
  /** The pet's uuid (matches SbPet.uuid). */
  pet: string
  power: string
}

export interface SbProfileView {
  at: number
  /** Your Minecraft name and skin id (for the head at the top), filled in by the app. */
  player?: { name: string; skin: string }
  profileId: string
  profileName: string
  mode: string
  /** Everyone else on the profile (co-op), by name if known, else short id. */
  coopMembers: number
  skyblockLevel: { level: number; progress: number }
  purse: number | null
  bank: number | null
  motes: number | null
  essence: { id: string; amount: number }[]
  fairySouls: { collected: number; max: number; exchanges: number }
  skills: SkillLine[] | null
  /** Average of the main skills (no runecrafting, social, carpentry). */
  skillAverage: number | null
  slayers: { id: string; name: string; level: Level; kills: number[] }[]
  dungeons: {
    catacombs: Level
    classes: SkillLine[]
    selected: string
    secrets: number | null
    floors: {
      floor: string
      normal: number
      master: number
      fastest: number | null
      bestScore: number | null
    }[]
  } | null
  mining: {
    hotm: Level
    powder: { kind: string; available: number; spent: number }[]
    ability: string
    commissions: number | null
    crystals: { id: string; state: string; found: number }[]
  } | null
  gear: {
    armor: (SbViewItem | null)[]
    equipment: (SbViewItem | null)[]
    /** Armour sets: the wardrobe (helmet, chestplate, leggings, boots). */
    wardrobe: { slot: number; pieces: (SbViewItem | null)[] }[]
    wardrobeEquipped: number | null
    /** Equipment sets from the Equipment Wardrobe (/eq): necklace, cloak, belt, gloves. */
    equipmentSets: { slot: number; pieces: (SbViewItem | null)[] }[]
    equipmentEquipped: number | null
    /** Loadouts: each names an armour set, an equipment set, a pet and a power stone. */
    loadouts: SbLoadout[]
    inventory: (SbViewItem | null)[]
    enderChest: (SbViewItem | null)[]
    backpacks: { slot: number; items: (SbViewItem | null)[] }[]
    vault: (SbViewItem | null)[]
    bags: { name: string; items: (SbViewItem | null)[] }[]
    sacks: { id: string; name: string; count: number }[]
  } | null
  accessories: {
    items: SbViewItem[]
    magicalPower: number
    highestMagicalPower: number | null
    selectedPower: string
    missing: { id: string; name: string; rarity: string; upgrade: boolean }[]
  } | null
  pets: SbPet[]
  /** Collections by group: Farming, Mining… */
  collections:
    | {
        group: string
        items: {
          id: string
          name: string
          count: number
          tier: number
          maxTier: number
          next: number | null
        }[]
      }[]
    | null
  minions: { id: string; name: string; tiers: number[]; highest: number }[]
  /** Minion slots from the crafted minions isn't knowable without the SkyBlock table, so just the count. */
  craftedMinions: number
  bestiary: {
    island: string
    mobs: { name: string; kills: number; tier: number; maxTier: number }[]
  }[]
  bestiaryMilestone: number | null
  garden: {
    level: Level
    visitors: number
    uniqueVisitors: number
    plots: number
    crops: { id: string; name: string; collected: number; milestone: Level }[]
    upgrades: { id: string; level: number }[]
  } | null
  jacob: {
    medals: Record<string, number>
    contests: number
    perks: Record<string, number>
    personalBests: { crop: string; amount: number }[]
  } | null
  rift: {
    enigmaSouls: number
    timecharms: number
    motes: number | null
    visits: number | null
  } | null
  trophyFish: {
    total: number
    fish: {
      id: string
      name: string
      bronze: number
      silver: number
      gold: number
      diamond: number
      total: number
    }[]
  } | null
  crimson: {
    faction: string
    mage: number
    barbarian: number
    kuudra: { tier: string; completions: number }[]
    dojo: { test: string; points: number }[]
  } | null
  museum: {
    value: number | null
    donated: number
    items: { id: string; name: string }[]
  } | null
  /** Every other number in player_stats, flattened ("kills.zealot_enderman"). */
  stats: { key: string; value: number }[]
  /** Plain sentences about what's missing because an API setting is off. */
  hidden: string[]
  /** What it's worth at Auction House and Bazaar prices (filled in by the app). */
  networth?: import('./skyblockMore').Networth
  /** Each co-op member's share (filled in by the app). */
  coop?: import('./skyblockMore').CoopMember[]
}

const SKILL_ORDER = ['farming', 'mining', 'combat', 'foraging', 'fishing', 'enchanting', 'alchemy', 'taming', 'carpentry', 'runecrafting', 'social', 'hunting']
const AVERAGE_SKILLS = ['farming', 'mining', 'combat', 'foraging', 'fishing', 'enchanting', 'alchemy', 'taming']
const SLAYER_NAMES: Record<string, string> = {
  zombie: 'Revenant Horror',
  spider: 'Tarantula Broodfather',
  wolf: 'Sven Packmaster',
  enderman: 'Voidgloom Seraph',
  blaze: 'Inferno Demonlord',
  vampire: 'Riftstalker Bloodfiend'
}
/** Hypixel's garden crop ids → the NEU repo's milestone names. */
const CROP_KEYS: Record<string, string> = {
  CARROT_ITEM: 'CARROT',
  POTATO_ITEM: 'POTATO',
  'INK_SACK:3': 'COCOA_BEANS',
  MUSHROOM_COLLECTION: 'MUSHROOM',
  NETHER_STALK: 'NETHER_WART',
  DOUBLE_PLANT: 'SUNFLOWER'
}
const MP: Record<string, number> = {
  COMMON: 3,
  UNCOMMON: 5,
  RARE: 8,
  EPIC: 12,
  LEGENDARY: 16,
  MYTHIC: 22,
  DIVINE: 22,
  SPECIAL: 3,
  'VERY SPECIAL': 5
}
const title = (s: string): string =>
  s
    .replace(/(^|[\s_-])(\w)/g, (_m, a: string, b: string) => `${a === '_' || a === '-' ? ' ' : a}${b.toUpperCase()}`)
    .replace(/\s+/g, ' ')
    .trim()

/** Pet level from exp, by rarity (rarer pets start further along the same table). */
export function petLevel(type: string, tier: string, exp: number, x: SbExtras): Level {
  const custom = x.petCustom[type]
  const offset = x.petRarityOffset[tier] ?? 0
  const base = x.petLevels.slice(offset, offset + 99)
  const steps = custom?.levels.length ? [...base, ...custom.levels].slice(0, (custom.maxLevel || 100) - 1) : base
  const l = levelOf(exp, steps)
  // Pets start at level 1.
  return { ...l, level: l.level + 1, max: l.max + 1 }
}

function decodeAll(v: unknown, decode: (b64: string) => unknown, iconOf?: SlotIconOf): (SbViewItem | null)[] {
  if (!isObj(v) || typeof v.data !== 'string' || !v.data) return []
  try {
    return viewItems(decode(v.data), iconOf)
  } catch {
    return []
  }
}

/** One page's numbers for the profile view. `decode` unpacks one of Hypixel's item lists into NBT. */
export function profileView(
  body: unknown,
  uuid: string,
  profileId: string,
  at: number,
  data: SbData,
  decode: (b64: string) => unknown,
  extra: { garden?: unknown; museum?: unknown; iconOf?: SlotIconOf } = {}
): SbProfileView | null {
  const x = data.extras
  if (!x) return null
  const list = (isObj(body) && Array.isArray(body.profiles) ? body.profiles : []).filter(isObj)
  const profile = (profileId && list.find((p) => p.profile_id === profileId)) || list.find((p) => p.selected === true) || list[0]
  if (!profile) return null
  const members = obj(profile.members)
  const myId = uuid.replace(/-/g, '').toLowerCase()
  const me = members[myId]
  if (!isObj(me)) return null
  const hidden: string[] = []
  const pd = obj(me.player_data)
  const currencies = obj(me.currencies)
  const leveling = obj(me.leveling)
  const sbXp = num(leveling.experience) ?? 0
  const itemName = (id: string): string => data.items[id]?.name ?? prettyId(id)

  // Skills
  let skills: SkillLine[] | null = null
  let skillAverage: number | null = null
  if (isObj(pd.experience)) {
    const xpOf = (s: string): number => num(obj(pd.experience)[`SKILL_${s.toUpperCase()}`]) ?? 0
    const jacobPerks = obj(obj(me.jacobs_contest).perks)
    skills = SKILL_ORDER.filter((s) => s !== 'hunting' || `SKILL_HUNTING` in obj(pd.experience)).map((s) => {
      const steps = s === 'runecrafting' ? x.runecraftingXp : s === 'social' ? x.socialXp : data.skillXp
      let cap = x.skillCaps[s] ?? steps.length
      if (s === 'farming') cap = Math.min(60, cap + (num(jacobPerks.farming_level_cap) ?? 0))
      if (s === 'taming') {
        const sacrificed = obj(obj(me.pets_data).pet_care).pet_types_sacrificed
        cap = Math.min(60, 50 + (Array.isArray(sacrificed) ? sacrificed.length : 0))
      }
      return { id: s, name: title(s), ...levelOf(xpOf(s), steps, cap) }
    })
    const main = skills.filter((s) => AVERAGE_SKILLS.includes(s.id))
    skillAverage = main.length ? main.reduce((a, s) => a + s.level + s.progress, 0) / main.length : null
  } else hidden.push('Skills API is off, so skill levels can’t be shown.')

  // Slayers
  const bosses = obj(obj(me.slayer).slayer_bosses)
  const slayers = Object.keys(SLAYER_NAMES).map((id) => {
    const b = obj(bosses[id])
    const kills: number[] = []
    for (let t = 0; t < 5; t++) kills.push(num(b[`boss_kills_tier_${t}`]) ?? 0)
    return {
      id,
      name: SLAYER_NAMES[id],
      level: levelOfTotals(num(b.xp) ?? 0, data.slayerXp[id] ?? []),
      kills
    }
  })

  // Dungeons
  const dg = obj(me.dungeons)
  const types = obj(dg.dungeon_types)
  const cata = obj(types.catacombs)
  const master = obj(types.master_catacombs)
  const floors: NonNullable<SbProfileView['dungeons']>['floors'] = []
  for (let f = 0; f <= 7; f++) {
    const n = num(obj(cata.tier_completions)[f]) ?? 0
    const m = num(obj(master.tier_completions)[f]) ?? 0
    if (!n && !m) continue
    floors.push({
      floor: f === 0 ? 'Entrance' : `Floor ${f}`,
      normal: n,
      master: m,
      fastest: num(obj(cata.fastest_time)[f]),
      bestScore: num(obj(cata.best_score)[f])
    })
  }
  const classes = Object.entries(obj(dg.player_classes)).map(([id, v]) => ({
    id,
    name: title(id),
    ...levelOf(num(obj(v).experience) ?? 0, x.catacombsXp, 50)
  }))
  const dungeons = isObj(me.dungeons)
    ? {
        catacombs: levelOf(num(cata.experience) ?? 0, x.catacombsXp, 50),
        classes,
        selected: typeof dg.selected_dungeon_class === 'string' ? title(dg.selected_dungeon_class) : '',
        secrets: num(dg.secrets),
        floors
      }
    : null

  // Mining
  const mc = obj(me.mining_core)
  const crystals = Object.entries(obj(mc.crystals)).map(([id, v]) => ({
    id: title(id.replace(/_crystal$/, '')),
    state: title(String(obj(v).state ?? '').toLowerCase()),
    found: num(obj(v).total_found) ?? 0
  }))
  const mining = isObj(me.mining_core)
    ? {
        hotm: (() => {
          const l = levelOf(num(mc.experience) ?? 0, data.hotmXp.slice(1), 9)
          return { ...l, level: l.level + 1, max: 10 }
        })(),
        powder: ['mithril', 'gemstone', 'glacite']
          .map((k) => ({
            kind: title(k),
            available: num(mc[`powder_${k}`]) ?? 0,
            spent: num(mc[`powder_spent_${k}`]) ?? 0
          }))
          .filter((p) => p.available || p.spent),
        ability: typeof mc.selected_pickaxe_ability === 'string' ? title(mc.selected_pickaxe_ability) : '',
        commissions: num(obj(me.objectives).completed_commissions) ?? num(obj(obj(me.objectives).tutorial).completed_commissions),
        crystals
      }
    : null

  // Gear
  const inv = isObj(me.inventory) ? me.inventory : null
  let gear: SbProfileView['gear'] = null
  let accessories: SbProfileView['accessories'] = null
  if (inv && isObj(inv.inv_contents)) {
    const wardrobeRaw = decodeAll(inv.wardrobe_contents, decode, extra.iconOf)
    const wardrobe: { slot: number; pieces: (SbViewItem | null)[] }[] = []
    const pages = Math.ceil(wardrobeRaw.length / 36)
    for (let page = 0; page < pages; page++) {
      for (let col = 0; col < 9; col++) {
        const pieces = [0, 1, 2, 3].map((row) => wardrobeRaw[page * 36 + row * 9 + col] ?? null)
        if (pieces.some(Boolean)) wardrobe.push({ slot: page * 9 + col + 1, pieces })
      }
    }
    const backpacks = Object.entries(obj(inv.backpack_contents))
      .map(([slot, v]) => ({
        slot: Number(slot) + 1,
        items: decodeAll(v, decode, extra.iconOf)
      }))
      .sort((a, b) => a.slot - b.slot)
    const bagNames: Record<string, string> = {
      talisman_bag: 'Accessory bag',
      fishing_bag: 'Fishing bag',
      quiver: 'Quiver',
      potion_bag: 'Potion bag',
      sacks_bag: 'Sack of sacks'
    }
    const bags = Object.entries(obj(inv.bag_contents))
      .filter(([k]) => k !== 'talisman_bag')
      .map(([k, v]) => ({
        name: bagNames[k] ?? title(k),
        items: decodeAll(v, decode, extra.iconOf)
      }))
      .filter((b) => b.items.some(Boolean))
    const sacks = Object.entries(obj(inv.sacks_counts))
      .map(([id, n]) => ({
        id: neuId(id),
        name: itemName(neuId(id)),
        count: num(n) ?? 0
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
    const armor = decodeAll(inv.inv_armor, decode, extra.iconOf).reverse()
    const equipment = decodeAll(inv.equipment_contents, decode, extra.iconOf)
    // Since loadouts (July 2026) the wardrobe and the Equipment Wardrobe live under member.loadout:
    // { armor: { equipped_set, "1": { HELMET, CHESTPLATE, LEGGINGS, BOOTS } }, equipment: { equipped_set, "1": { EQUIPMENT_SLOT_1…4 } }, loadouts: { "1": {…} } }.
    const lo = obj(me.loadout)
    const piece = (v: unknown): SbViewItem | null => {
      const packed = typeof v === 'string' ? { data: v } : v
      return decodeAll(packed, decode, extra.iconOf).find(Boolean) ?? null
    }
    const setsOf = (group: unknown, keys: string[]): { slot: number; pieces: (SbViewItem | null)[] }[] =>
      Object.entries(obj(group))
        .filter(([k, v]) => /^\d+$/.test(k) && isObj(v))
        .map(([k, v]) => ({ slot: Number(k), pieces: keys.map((key) => piece((v as Record<string, unknown>)[key])) }))
        .filter((w) => w.pieces.some(Boolean))
    let wardrobeEquipped = num(inv.wardrobe_equipped_slot)
    if (isObj(lo.armor)) {
      const sets = setsOf(lo.armor, ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'])
      // Keep the old wardrobe's sets too, for any slot the loadout data doesn't have.
      wardrobe.splice(0, wardrobe.length, ...sets, ...wardrobe.filter((w) => !sets.some((x) => x.slot === w.slot)))
      wardrobeEquipped = num(lo.armor.equipped_set) ?? wardrobeEquipped
    }
    const equipmentSets = setsOf(lo.equipment, ['EQUIPMENT_SLOT_1', 'EQUIPMENT_SLOT_2', 'EQUIPMENT_SLOT_3', 'EQUIPMENT_SLOT_4'])
    const equipmentEquipped = num(obj(lo.equipment).equipped_set)
    // The set you're wearing isn't in the saved sets (its slot is empty while it's on you), so it's put back in its slot.
    const putBack = (sets: { slot: number; pieces: (SbViewItem | null)[] }[], at: number | null, worn: (SbViewItem | null)[]): void => {
      if (!at || at < 1 || !worn.some(Boolean) || sets.some((w) => w.slot === at)) return
      sets.push({ slot: at, pieces: [0, 1, 2, 3].map((i) => worn[i] ?? null) })
    }
    putBack(wardrobe, wardrobeEquipped, armor)
    putBack(equipmentSets, equipmentEquipped, equipment)
    wardrobe.sort((a, b) => a.slot - b.slot)
    equipmentSets.sort((a, b) => a.slot - b.slot)
    const loadouts: SbLoadout[] = Object.entries(obj(lo.loadouts))
      .filter(([k, v]) => /^\d+$/.test(k) && isObj(v))
      .map(([k, raw]) => {
        const v = raw as Record<string, unknown>
        const set = (n: unknown): number | null => ((num(n) ?? 0) > 0 ? (num(n) as number) : null)
        return {
          slot: Number(k),
          name: typeof v.name === 'string' && v.name.trim() ? v.name : `Loadout ${k}`,
          armorSet: set(v.armor_set_id),
          equipmentSet: set(v.equipment_set_id),
          pet: typeof v.pet === 'string' ? v.pet : '',
          power: typeof v.power_stone === 'string' && v.power_stone ? title(v.power_stone.toLowerCase()) : ''
        }
      })
      .filter((l) => l.armorSet || l.equipmentSet || l.pet || l.power)
      .sort((a, b) => a.slot - b.slot)
    gear = {
      armor,
      equipment,
      wardrobe,
      wardrobeEquipped,
      equipmentSets,
      equipmentEquipped,
      loadouts,
      inventory: decodeAll(inv.inv_contents, decode, extra.iconOf),
      enderChest: decodeAll(inv.ender_chest_contents, decode, extra.iconOf),
      backpacks,
      vault: decodeAll(inv.personal_vault_contents, decode, extra.iconOf),
      bags,
      sacks
    }
    if (!isObj(inv.personal_vault_contents)) hidden.push('Personal Vault API is off, so the vault is empty here.')

    // Accessories: the bag, plus any carried in the inventory.
    const bag = decodeAll(obj(inv.bag_contents).talisman_bag, decode, extra.iconOf).filter((i): i is SbViewItem => !!i)
    const known = new Set(x.accessories.map((a) => a.id))
    const carried = [...gear.inventory, ...gear.enderChest].filter((i): i is SbViewItem => !!i && known.has(i.id))
    const items = [...bag, ...carried]
    const owned = new Set(items.map((i) => i.id))
    // Something you own covers the lower tiers that upgrade into it.
    const covered = new Set(owned)
    let grew = true
    while (grew) {
      grew = false
      for (const [lower, uppers] of Object.entries(x.accessoryUpgrades)) if (!covered.has(lower) && uppers.some((u) => covered.has(u))) ((grew = true), covered.add(lower))
    }
    // Only the best of each family counts towards magical power.
    const counted = new Map<string, SbViewItem>()
    for (const i of items) {
      if ((x.accessoryUpgrades[i.id] ?? []).some((u) => owned.has(u))) continue
      if (!counted.has(i.id)) counted.set(i.id, i)
    }
    let magicalPower = 0
    for (const i of counted.values()) magicalPower += (MP[i.rarity] ?? 0) * (i.id === 'HEGEMONY_ARTIFACT' ? 2 : 1)
    const ignored = new Set(x.ignoredAccessories)
    const isUpgrade = new Set(Object.values(x.accessoryUpgrades).flat())
    const missing = x.accessories
      .filter((a) => !covered.has(a.id) && !ignored.has(a.id))
      // Show the lowest tier of each missing family once.
      .filter((a) => !(isUpgrade.has(a.id) && Object.entries(x.accessoryUpgrades).some(([lower, ups]) => ups.includes(a.id) && !covered.has(lower))))
      .map((a) => ({
        id: a.id,
        name: itemName(a.id),
        rarity: a.rarity,
        upgrade: Object.values(x.accessoryUpgrades).some((ups) => ups.includes(a.id))
      }))
      .sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.name.localeCompare(b.name))
    // The skill compactors (Combat, Farming…) are one accessory for this: suggest one, and none once you have any.
    const compactor = /^PERSONAL_COMPACTOR_[A-Z]+_\d+$/
    const haveCompactor = [...owned].some((id) => id.startsWith('PERSONAL_COMPACTOR'))
    let compactorShown = false
    for (let i = missing.length - 1; i >= 0; i--)
      if (compactor.test(missing[i].id) && (haveCompactor || missing.slice(0, i).some((m) => compactor.test(m.id)))) missing.splice(i, 1)
    for (const m of missing) if (compactor.test(m.id) && !compactorShown) ((compactorShown = true), (m.name = 'Personal Compactor'))
    const abs = obj(me.accessory_bag_storage)
    accessories = {
      items,
      magicalPower,
      highestMagicalPower: num(abs.highest_magical_power),
      selectedPower: typeof abs.selected_power === 'string' ? title(abs.selected_power) : '',
      missing
    }
  } else hidden.push('Inventory API is off, so your gear, inventories and accessories can’t be shown.')

  // Pets
  const PET_TIERS = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']
  const pets: SbPet[] = (Array.isArray(obj(me.pets_data).pets) ? (obj(me.pets_data).pets as unknown[]) : [])
    .filter(isObj)
    .map((p) => {
      const type = String(p.type ?? '')
      const tier = String(p.tier ?? 'COMMON')
      return {
        type,
        name: title(type.toLowerCase()),
        rarity: tier.replace('_', ' '),
        level: petLevel(type, tier, num(p.exp) ?? 0, x),
        active: p.active === true,
        neuId: typeof p.skin === 'string' && p.skin ? `PET_SKIN_${p.skin}` : `${type};${Math.max(0, PET_TIERS.indexOf(tier))}`,
        heldItem: typeof p.heldItem === 'string' ? itemName(p.heldItem) : '',
        heldItemId: typeof p.heldItem === 'string' ? p.heldItem : '',
        candy: num(p.candyUsed) ?? 0,
        skin: typeof p.skin === 'string' ? title(p.skin.toLowerCase()) : '',
        uuid: typeof p.uuid === 'string' ? p.uuid : ''
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || b.level.level - a.level.level)

  // Collections
  let collections: SbProfileView['collections'] = null
  if (isObj(me.collection)) {
    const counts: Record<string, number> = {}
    for (const [k, v] of Object.entries(me.collection)) if (num(v) !== null) counts[neuId(k)] = v as number
    const groups = new Map<string, NonNullable<SbProfileView['collections']>[number]['items']>()
    for (const [id, info] of Object.entries(data.collections)) {
      const count = counts[id] ?? 0
      const tier = info.tiers.filter((t) => count >= t).length
      const g = groups.get(info.group ?? 'Other') ?? []
      g.push({
        id,
        name: info.name,
        count,
        tier,
        maxTier: info.tiers.length,
        next: info.tiers[tier] ?? null
      })
      groups.set(info.group ?? 'Other', g)
    }
    collections = [...groups].map(([group, items]) => ({ group, items }))
  } else hidden.push('Collections API is off, so collections can’t be shown.')

  // Minions (crafted by anyone on the profile)
  const crafted = new Set<string>()
  for (const m of Object.values(members))
    for (const g of Array.isArray(obj(obj(m).player_data).crafted_generators) ? (obj(obj(m).player_data).crafted_generators as unknown[]) : [])
      if (typeof g === 'string') crafted.add(g)
  const minionMap = new Map<string, number[]>()
  for (const g of crafted) {
    const m = /^(.+)_(\d+)$/.exec(g)
    if (!m) continue
    const t = minionMap.get(m[1]) ?? []
    t.push(Number(m[2]))
    minionMap.set(m[1], t)
  }
  const minions = [...minionMap]
    .map(([id, tiers]) => ({
      id,
      name: `${title(id.toLowerCase())} Minion`,
      tiers: tiers.sort((a, b) => a - b),
      highest: Math.max(...tiers)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Bestiary
  const kills = obj(obj(me.bestiary).kills)
  const bestiary = x.bestiary
    .map((isl) => ({
      island: isl.island,
      mobs: isl.mobs
        .map((mob) => {
          const k = mob.ids.reduce((a, id) => a + (num(kills[id]) ?? 0), 0)
          const brackets = (x.bestiaryBrackets[String(mob.bracket)] ?? []).filter((t) => t <= mob.cap)
          return {
            name: mob.name,
            kills: k,
            tier: brackets.filter((t) => k >= t).length,
            maxTier: brackets.length
          }
        })
        .filter((m) => m.kills > 0)
    }))
    .filter((i) => i.mobs.length)

  // Garden (its own answer from Hypixel)
  const gd = obj(obj(extra.garden).garden)
  const garden = isObj(obj(extra.garden).garden)
    ? {
        level: (() => {
          const l = levelOf(num(gd.garden_experience) ?? 0, x.gardenXp.slice(1))
          return { ...l, level: l.level + 1, max: l.max + 1 }
        })(),
        visitors: num(obj(gd.commission_data).total_completed) ?? 0,
        uniqueVisitors: num(obj(gd.commission_data).unique_npcs_served) ?? 0,
        plots: Array.isArray(gd.unlocked_plots_ids) ? gd.unlocked_plots_ids.length : 0,
        crops: Object.entries(obj(gd.resources_collected)).map(([id, n]) => ({
          id,
          name: itemName(neuId(id)),
          collected: num(n) ?? 0,
          milestone: levelOf(num(n) ?? 0, x.cropMilestones[CROP_KEYS[id] ?? id] ?? [])
        })),
        upgrades: Object.entries(obj(gd.crop_upgrade_levels)).map(([id, n]) => ({ id: itemName(neuId(id)), level: num(n) ?? 0 }))
      }
    : null

  const jc = obj(me.jacobs_contest)
  const jacob = isObj(me.jacobs_contest)
    ? {
        medals: Object.fromEntries(Object.entries(obj(jc.medals_inv)).map(([k, v]) => [k, num(v) ?? 0])),
        contests: Object.keys(obj(jc.contests)).length,
        perks: Object.fromEntries(Object.entries(obj(jc.perks)).map(([k, v]) => [title(k), num(v) ?? 0])),
        personalBests: Object.entries(obj(jc.personal_bests)).map(([k, v]) => ({
          crop: itemName(neuId(k)),
          amount: num(v) ?? 0
        }))
      }
    : null

  // Rift
  const rift = isObj(me.rift)
    ? {
        enigmaSouls: Array.isArray(obj(obj(me.rift).enigma).found_souls) ? (obj(obj(me.rift).enigma).found_souls as unknown[]).length : 0,
        timecharms: Array.isArray(obj(obj(me.rift).gallery).secured_trophies) ? (obj(obj(me.rift).gallery).secured_trophies as unknown[]).length : 0,
        motes: num(currencies.motes_purse),
        visits: num(obj(obj(me.player_stats).rift).visits)
      }
    : null

  // Trophy fish
  const tf = obj(me.trophy_fish)
  const trophyFish = isObj(me.trophy_fish)
    ? {
        total: num(tf.total_caught) ?? 0,
        fish: x.trophyFish
          .map((id) => {
            const k = id.toLowerCase()
            const t = (tier: string): number => num(tf[`${k}_${tier}`]) ?? 0
            return {
              id,
              name: title(k),
              bronze: t('bronze'),
              silver: t('silver'),
              gold: t('gold'),
              diamond: t('diamond'),
              total: num(tf[k]) ?? 0
            }
          })
          .filter((f) => f.total > 0)
      }
    : null

  // Crimson Isle and Kuudra
  const ni = obj(me.nether_island_player_data)
  const crimson = isObj(me.nether_island_player_data)
    ? {
        faction: typeof ni.selected_faction === 'string' ? title(ni.selected_faction) : '',
        mage: num(ni.mages_reputation) ?? 0,
        barbarian: num(ni.barbarians_reputation) ?? 0,
        kuudra: [
          ['none', 'Basic'],
          ['hot', 'Hot'],
          ['burning', 'Burning'],
          ['fiery', 'Fiery'],
          ['infernal', 'Infernal']
        ].map(([k, n]) => ({
          tier: n,
          completions: num(obj(ni.kuudra_completed_tiers)[k]) ?? 0
        })),
        dojo: Object.entries(obj(ni.dojo))
          .filter(([k]) => k.startsWith('dojo_points_'))
          .map(([k, v]) => ({
            test: title(k.replace('dojo_points_', '')),
            points: num(v) ?? 0
          }))
      }
    : null

  // Museum (its own answer from Hypixel)
  const mm = obj(obj(obj(extra.museum).members)[myId])
  const museum =
    extra.museum !== undefined
      ? {
          value: num(mm.value),
          donated: Object.keys(obj(mm.items)).length,
          items: Object.keys(obj(mm.items))
            .map((id) => ({ id, name: itemName(id) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        }
      : null
  if (extra.museum !== undefined && !isObj(mm.items)) hidden.push('Museum API is off (or nothing’s donated yet).')

  // Every other stat
  const stats: { key: string; value: number }[] = []
  const flat = (o: Record<string, unknown>, prefix: string, depth: number): void => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (num(v) !== null) stats.push({ key, value: v as number })
      else if (isObj(v) && depth < 3) flat(v, key, depth + 1)
    }
  }
  flat(obj(me.player_stats), '', 0)

  const essence = Object.entries(obj(currencies.essence))
    .map(([id, v]) => ({
      id: title(id.toLowerCase()),
      amount: num(obj(v).current) ?? 0
    }))
    .filter((e) => e.amount > 0)
  const fs = obj(me.fairy_soul)

  return {
    at,
    profileId: String(profile.profile_id ?? ''),
    profileName: String(profile.cute_name ?? 'Profile'),
    mode: typeof profile.game_mode === 'string' ? profile.game_mode : '',
    coopMembers: Object.keys(members).length - 1,
    skyblockLevel: {
      level: Math.floor(sbXp / 100),
      progress: (sbXp % 100) / 100
    },
    purse: num(currencies.coin_purse),
    bank: isObj(profile.banking) ? num(profile.banking.balance) : null,
    motes: num(currencies.motes_purse),
    essence,
    fairySouls: {
      collected: num(fs.total_collected) ?? 0,
      max: x.fairySoulsMax,
      exchanges: num(fs.fairy_exchanges) ?? 0
    },
    skills,
    skillAverage,
    slayers,
    dungeons,
    mining,
    gear,
    accessories,
    pets,
    collections,
    minions,
    craftedMinions: crafted.size,
    bestiary,
    bestiaryMilestone: num(obj(obj(me.bestiary).milestone).last_claimed_milestone),
    garden,
    jacob,
    rift,
    trophyFish,
    crimson,
    museum,
    stats: stats.sort((a, b) => a.key.localeCompare(b.key)),
    hidden
  }
}
