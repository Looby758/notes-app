import { collectionTier, planGoals, stripColors, type SbData, type SbProfileData } from './skyblockGoals'
import type { SbProfileView, SbViewItem } from './skyblockProfile'

/**
 * More for the SkyBlock profile: networth from Auction House and Bazaar prices, snapshots of your
 * numbers over time (graphs, "since last time", milestones), ironman helpers (craftable now, Magical
 * Power planner, minion helper), stats added up from item descriptions, and the SkyBlock calendar.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ---------- networth ----------

/** Item id (NEU style: "HYPERION", "BEE;4", "INK_SACK-3") → coins each. */
export type Prices = Record<string, number>

export interface NetworthItem {
  id: string
  name: string
  count: number
  /** Coins for all of them. */
  value: number
}

export interface Networth {
  total: number
  /** Purse and bank. */
  coins: number
  sections: { id: string; name: string; value: number; items: NetworthItem[] }[]
  /** Items Orbit found no price for (soulbound, or never sold). */
  unpriced: number
  pricesAt: number
}

/** The price of one item, trying the ways an id is spelled. */
export function priceOf(id: string, prices: Prices): number {
  if (!id) return 0
  return prices[id] ?? prices[id.replace(/-/g, ':')] ?? prices[id.replace(/:/g, '-')] ?? 0
}

/** Lowest BIN prices (NEU ids) and Bazaar sell prices together, Bazaar winning where both have one. */
export function mergePrices(lowestBin: unknown, bazaar: unknown): Prices {
  const out: Prices = {}
  if (isObj(lowestBin)) for (const [k, v] of Object.entries(lowestBin)) if (num(v) !== null && (v as number) > 0) out[k] = v as number
  const products = isObj(bazaar) && isObj(bazaar.products) ? bazaar.products : {}
  for (const [k, p] of Object.entries(products)) {
    const q = isObj(p) && isObj(p.quick_status) ? p.quick_status : null
    const sell = num(q?.sellPrice) ?? 0
    const buy = num(q?.buyPrice) ?? 0
    const price = sell || buy
    if (price > 0) out[k.replace(/:/g, '-')] = price
  }
  return out
}

/**
 * What a profile is worth at Auction House and Bazaar prices: coins, then every item Orbit can see,
 * by where it is. Accessories carried in the inventory aren't counted twice.
 */
export function networthOf(v: SbProfileView, prices: Prices, pricesAt = 0, sackNames: Record<string, string> = {}): Networth {
  let unpriced = 0
  const rows = (list: readonly (SbViewItem | null)[]): NetworthItem[] => {
    const out: NetworthItem[] = []
    for (const it of list) {
      if (!it || !it.id) continue
      const each = priceOf(it.id, prices)
      if (!each) {
        unpriced++
        continue
      }
      out.push({ id: it.id, name: stripColors(it.name), count: it.count, value: each * it.count })
    }
    return out
  }
  const g = v.gear
  const sections: Networth['sections'] = []
  const add = (id: string, name: string, items: NetworthItem[]): void => {
    if (!items.length) return
    items.sort((a, b) => b.value - a.value)
    sections.push({ id, name, value: items.reduce((a, i) => a + i.value, 0), items })
  }
  if (g) {
    add('armor', 'Armour and equipment', rows([...g.armor, ...g.equipment]))
    add(
      'wardrobe',
      'Wardrobe',
      rows([...(g.wardrobe ?? []), ...(g.equipmentSets ?? [])].filter((w) => w.slot !== g.wardrobeEquipped || !g.armor.some(Boolean)).flatMap((w) => w.pieces))
    )
    add('inventory', 'Inventory', rows(g.inventory))
    add('ender', 'Ender chest', rows(g.enderChest))
    add('backpacks', 'Backpacks', rows(g.backpacks.flatMap((b) => b.items)))
    add('vault', 'Personal vault', rows(g.vault))
    add('bags', 'Bags', rows(g.bags.flatMap((b) => b.items)))
    add(
      'sacks',
      'Sacks',
      g.sacks.map((s) => ({ id: s.id, name: sackNames[s.id] ?? s.name, count: s.count, value: priceOf(s.id, prices) * s.count })).filter((s) => s.value > 0)
    )
  }
  if (v.accessories) {
    // Carried ones are already in the inventory or ender chest.
    const carried = new Map<string, number>()
    for (const it of [...(g?.inventory ?? []), ...(g?.enderChest ?? [])]) if (it) carried.set(it.id, (carried.get(it.id) ?? 0) + 1)
    const bag = v.accessories.items.filter((it) => {
      const n = carried.get(it.id) ?? 0
      if (n > 0) {
        carried.set(it.id, n - 1)
        return false
      }
      return true
    })
    add('accessories', 'Accessories', rows(bag))
  }
  add(
    'pets',
    'Pets',
    v.pets
      .map((p) => {
        const each = priceOf(p.neuId, prices) || priceOf(`${p.type};${['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'].indexOf(p.rarity.toUpperCase())}`, prices)
        if (!each) unpriced++
        return { id: p.neuId, name: `${p.name} (${p.rarity.toLowerCase()})`, count: 1, value: each }
      })
      .filter((p) => p.value > 0)
  )
  if (v.museum?.value) sections.push({ id: 'museum', name: 'Museum', value: v.museum.value, items: [] })
  const coins = (v.purse ?? 0) + (v.bank ?? 0)
  sections.sort((a, b) => b.value - a.value)
  return { total: coins + sections.reduce((a, s) => a + s.value, 0), coins, sections, unpriced, pricesAt }
}

// ---------- snapshots over time ----------

/** A small copy of a profile's numbers, saved each time Orbit reads it, for graphs and milestones. */
export interface SbSnapshot {
  at: number
  level: number
  /** Skill → level with progress (12.4). */
  skills: Record<string, number>
  skillAverage: number | null
  /** Slayer → level with progress. */
  slayers: Record<string, number>
  catacombs: number | null
  /** Collection id → [count, tier]. */
  collections: Record<string, [number, number]>
  coins: number
  networth: number | null
  magicalPower: number | null
  accessories: string[]
  minions: number
  fairySouls: number
  pets: number
}

const lp = (l: { level: number; progress: number; max?: number }): number => Math.round((l.level + (l.max !== undefined && l.level >= l.max ? 0 : l.progress)) * 1000) / 1000

export function snapshotOf(v: SbProfileView, at = v.at): SbSnapshot {
  const collections: SbSnapshot['collections'] = {}
  for (const g of v.collections ?? []) for (const c of g.items) collections[c.id] = [c.count, c.tier]
  return {
    at,
    level: lp(v.skyblockLevel),
    skills: Object.fromEntries((v.skills ?? []).map((s) => [s.id, lp(s)])),
    skillAverage: v.skillAverage === null ? null : Math.round(v.skillAverage * 1000) / 1000,
    slayers: Object.fromEntries(v.slayers.map((s) => [s.id, lp(s.level)])),
    catacombs: v.dungeons ? lp(v.dungeons.catacombs) : null,
    collections,
    coins: (v.purse ?? 0) + (v.bank ?? 0),
    networth: v.networth?.total ?? null,
    magicalPower: v.accessories?.magicalPower ?? null,
    accessories: v.accessories ? [...new Set(v.accessories.items.map((a) => a.id))].sort() : [],
    minions: v.craftedMinions,
    fairySouls: v.fairySouls.collected,
    pets: v.pets.length
  }
}

/** Whether two snapshots hold the same numbers (so a new one isn't worth keeping). */
export function sameSnapshot(a: SbSnapshot, b: SbSnapshot): boolean {
  const strip = (s: SbSnapshot): string => JSON.stringify({ ...s, at: 0, coins: Math.round(s.coins / 1000), networth: s.networth === null ? null : Math.round(s.networth / 1e5) })
  return strip(a) === strip(b)
}

/**
 * Adds a snapshot to the history: replaces the last one when it's under `minGap` old (so a play
 * session keeps one point a while), skips it when nothing changed, and keeps at most `max`.
 */
export function addSnapshot(history: readonly SbSnapshot[], s: SbSnapshot, minGap = 30 * 60_000, max = 1500): SbSnapshot[] {
  const last = history[history.length - 1]
  if (last && sameSnapshot(last, s)) return history.slice()
  const before = history.length >= 2 ? history[history.length - 2] : null
  // Keep the first point of a run, move the newest along.
  const out = last && before && s.at - before.at < minGap && last.at - before.at < minGap ? [...history.slice(0, -1), s] : [...history, s]
  return out.slice(-max)
}

export interface SbChange {
  kind: 'level' | 'skill' | 'slayer' | 'catacombs' | 'collection' | 'coins' | 'networth' | 'accessory' | 'mp' | 'minions' | 'fairy' | 'pets'
  /** "Combat", "Ender Pearl", "Coins". */
  label: string
  /** NEU id for its picture, when there is one. */
  icon?: string
  from: number
  to: number
  /** For levels: whole levels gained. */
  levels?: number
}

const SKILL_ICONS: Record<string, string> = {
  farming: 'GOLD_HOE',
  mining: 'STONE_PICKAXE',
  combat: 'STONE_SWORD',
  foraging: 'SAPLING',
  fishing: 'FISHING_ROD',
  enchanting: 'ENCHANTMENT_TABLE',
  alchemy: 'BREWING_STAND_ITEM',
  taming: 'BONE',
  carpentry: 'WORKBENCH',
  runecrafting: 'MAGMA_CREAM',
  social: 'EMERALD',
  hunting: 'BOW'
}
export const SLAYER_ICONS: Record<string, string> = {
  zombie: 'ROTTEN_FLESH',
  spider: 'WEB',
  wolf: 'MUTTON',
  enderman: 'ENDER_PEARL',
  blaze: 'BLAZE_POWDER',
  vampire: 'REDSTONE'
}
const SLAYER_LABELS: Record<string, string> = { zombie: 'Revenant', spider: 'Tarantula', wolf: 'Sven', enderman: 'Voidgloom', blaze: 'Inferno', vampire: 'Riftstalker' }
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** What moved between two snapshots, biggest news first. `names`: item id → name, for collections. */
export function changesBetween(a: SbSnapshot, b: SbSnapshot, names: Record<string, string> = {}): SbChange[] {
  const out: SbChange[] = []
  const whole = (x: number, y: number): number => Math.floor(y) - Math.floor(x)
  if (b.level - a.level > 0.001) out.push({ kind: 'level', label: 'SkyBlock level', icon: 'NETHER_STAR', from: a.level, to: b.level, levels: whole(a.level, b.level) })
  for (const [id, to] of Object.entries(b.skills)) {
    const from = a.skills[id] ?? 0
    if (to - from > 0.001) out.push({ kind: 'skill', label: cap(id), icon: SKILL_ICONS[id], from, to, levels: whole(from, to) })
  }
  for (const [id, to] of Object.entries(b.slayers)) {
    const from = a.slayers[id] ?? 0
    if (to - from > 0.001) out.push({ kind: 'slayer', label: SLAYER_LABELS[id] ?? cap(id), icon: SLAYER_ICONS[id], from, to, levels: whole(from, to) })
  }
  if (a.catacombs !== null && b.catacombs !== null && b.catacombs - a.catacombs > 0.001)
    out.push({ kind: 'catacombs', label: 'Catacombs', icon: 'ESSENCE_WITHER', from: a.catacombs, to: b.catacombs, levels: whole(a.catacombs, b.catacombs) })
  const cols: SbChange[] = []
  for (const [id, [count, tier]] of Object.entries(b.collections)) {
    const [fc, ft] = a.collections[id] ?? [0, 0]
    if (count > fc) cols.push({ kind: 'collection', label: names[id] ?? cap(id.toLowerCase().replace(/_/g, ' ')), icon: id, from: fc, to: count, levels: tier - ft })
  }
  cols.sort((x, y) => (y.levels ?? 0) - (x.levels ?? 0) || y.to - y.from - (x.to - x.from))
  out.push(...cols)
  if (Math.abs(b.coins - a.coins) >= 1000) out.push({ kind: 'coins', label: 'Coins', icon: 'GOLD_INGOT', from: a.coins, to: b.coins })
  if (a.networth !== null && b.networth !== null && Math.abs(b.networth - a.networth) >= 10_000)
    out.push({ kind: 'networth', label: 'Networth', icon: 'EMERALD', from: a.networth, to: b.networth })
  if (a.magicalPower !== null && b.magicalPower !== null && b.magicalPower !== a.magicalPower)
    out.push({ kind: 'mp', label: 'Magical Power', icon: 'HEGEMONY_ARTIFACT', from: a.magicalPower, to: b.magicalPower })
  const had = new Set(a.accessories)
  for (const id of b.accessories) if (!had.has(id)) out.push({ kind: 'accessory', label: names[id] ?? cap(id.toLowerCase().replace(/_/g, ' ')), icon: id, from: 0, to: 1 })
  if (b.minions > a.minions) out.push({ kind: 'minions', label: 'Minion tiers crafted', icon: 'COBBLESTONE_GENERATOR_1', from: a.minions, to: b.minions })
  if (b.fairySouls > a.fairySouls) out.push({ kind: 'fairy', label: 'Fairy souls', icon: 'GHAST_TEAR', from: a.fairySouls, to: b.fairySouls })
  if (b.pets > a.pets) out.push({ kind: 'pets', label: 'Pets', icon: 'BONE', from: a.pets, to: b.pets })
  return out
}

export interface SbMilestone {
  at: number
  text: string
  icon?: string
}

/** Level-ups, collection tiers, new accessories and the like, from the history, newest first. */
export function milestones(history: readonly SbSnapshot[], names: Record<string, string> = {}, max = 150): SbMilestone[] {
  const out: SbMilestone[] = []
  for (let i = 1; i < history.length; i++) {
    for (const c of changesBetween(history[i - 1], history[i], names)) {
      const at = history[i].at
      const lv = c.levels ?? 0
      if (c.kind === 'level' && lv > 0) out.push({ at, icon: c.icon, text: `Reached SkyBlock level ${Math.floor(c.to)}` })
      else if ((c.kind === 'skill' || c.kind === 'catacombs') && lv > 0) out.push({ at, icon: c.icon, text: `${c.label} ${Math.floor(c.to)}` })
      else if (c.kind === 'slayer' && lv > 0) out.push({ at, icon: c.icon, text: `${c.label} slayer level ${Math.floor(c.to)}` })
      else if (c.kind === 'collection' && lv > 0) out.push({ at, icon: c.icon, text: `${c.label} collection tier ${history[i].collections[c.icon ?? '']?.[1] ?? ''}` })
      else if (c.kind === 'accessory') out.push({ at, icon: c.icon, text: `New accessory: ${c.label}` })
      else if (c.kind === 'fairy') out.push({ at, icon: c.icon, text: `Found ${c.to - c.from} fairy soul${c.to - c.from === 1 ? '' : 's'}` })
    }
  }
  return out.reverse().slice(0, max)
}

/** One line on a graph: [time, value] points. */
export function seriesOf(history: readonly SbSnapshot[], pick: (s: SbSnapshot) => number | null): [number, number][] {
  const out: [number, number][] = []
  for (const s of history) {
    const v = pick(s)
    if (v !== null && Number.isFinite(v)) out.push([s.at, v])
  }
  return out
}

// ---------- ironman helpers ----------

export interface Craftable {
  id: string
  name: string
  color: string
  /** How many you could make with what you have. */
  times: number
}

/** Items you have every ingredient for right now (from your inventory, sacks and storage). */
export function craftableNow(data: SbData, owned: Record<string, number>, limit = 80): Craftable[] {
  const out: Craftable[] = []
  for (const item of Object.values(data.items)) {
    const recipe = item.craft
    // Single-input "compressing" recipes (9 wheat → hay) aren't news.
    if (!recipe || recipe.inputs.length < 2) continue
    let times = Infinity
    for (const [id, qty] of recipe.inputs) {
      const have = owned[id] ?? 0
      times = Math.min(times, Math.floor(have / qty))
      if (times < 1) break
    }
    if (times >= 1 && times !== Infinity) out.push({ id: item.id, name: item.name, color: item.color, times })
  }
  // Rarer (coloured) things first, then the ones you can make most of.
  const rank = (c: string): number => '0123456789abcdef'.indexOf(c)
  const order = ['d', '6', '5', '9', 'a', 'f']
  out.sort((a, b) => (order.indexOf(a.color) + 1 || 9) - (order.indexOf(b.color) + 1 || 9) || rank(b.color) - rank(a.color) || a.name.localeCompare(b.name))
  return out.slice(0, limit)
}

export const MP_BY_RARITY: Record<string, number> = {
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

export interface MpStep {
  id: string
  name: string
  rarity: string
  /** Magical Power it would add. */
  mp: number
  /** 0 to 1: how much of it you already have the materials for. */
  progress: number
  /** You can craft it right now. */
  ready: boolean
  /** Can't be crafted (a drop, an NPC buy, a reward). */
  uncraftable: boolean
  hoursLeft: number | null
  /** Upgrades one you have (so it adds the difference). */
  upgrade: boolean
}

/** Missing accessories ranked by Magical Power for the work left. */
export function mpPlanner(v: SbProfileView, data: SbData, profile: SbProfileData | null, rates: Record<string, number>, limit = 40): MpStep[] {
  if (!v.accessories) return []
  const owned = new Map(v.accessories.items.map((a) => [a.id, a.rarity]))
  const steps: MpStep[] = []
  for (const m of v.accessories.missing.slice(0, 250)) {
    const item = data.items[m.id]
    const rarity = m.rarity.toUpperCase()
    let mp = MP_BY_RARITY[rarity] ?? 0
    // An upgrade replaces a lower one, so it only adds the difference.
    if (m.upgrade) {
      const lower = [...owned.entries()].find(([id]) => m.id.startsWith(id.replace(/_(TALISMAN|RING|ARTIFACT|RELIC)$/, '')))
      if (lower) mp -= MP_BY_RARITY[lower[1].toUpperCase()] ?? 0
    }
    if (mp <= 0) continue
    const crafted = !!(item?.craft || item?.forge)
    const plan = crafted ? planGoals([{ id: m.id, amount: 1, pinned: false, added: 0 }], data, profile, rates)[0] : null
    steps.push({
      id: m.id,
      name: m.name,
      rarity: m.rarity,
      mp,
      progress: plan?.progress ?? 0,
      ready: !!plan && plan.raw.every((r) => r.have >= r.need) && !plan.blockers.length,
      uncraftable: !crafted,
      hoursLeft: plan?.hoursLeft ?? null,
      upgrade: m.upgrade
    })
  }
  // Most Magical Power per bit of work left; ready ones first.
  const score = (s: MpStep): number => (s.ready ? 1e6 : 0) + (s.mp * (0.25 + s.progress)) / (s.uncraftable ? 3 : 1)
  steps.sort((a, b) => score(b) - score(a))
  return steps.slice(0, limit)
}

export interface MinionStep {
  /** "COBBLESTONE". */
  type: string
  name: string
  /** Highest tier crafted, 0 if none. */
  tier: number
  maxTier: number
  /** The next tier's item id, if there is one. */
  next: string | null
  /** 0 to 1 of the next tier's materials you have. */
  progress: number
  ready: boolean
  /** The materials for the next tier, with what you have. */
  needs: { id: string; name: string; need: number; have: number }[]
}

/** Each minion's highest tier, and what the next one costs against what you have, best first. */
export function minionHelper(v: SbProfileView, data: SbData, owned: Record<string, number>): MinionStep[] {
  const crafted = new Map(v.minions.map((m) => [m.id, m.highest]))
  const types = new Map<string, number>()
  for (const id of Object.keys(data.items)) {
    const m = /^(.+)_GENERATOR_(\d+)$/.exec(id)
    if (m) types.set(m[1], Math.max(types.get(m[1]) ?? 0, Number(m[2])))
  }
  const out: MinionStep[] = []
  for (const [type, maxTier] of types) {
    const tier = crafted.get(type) ?? 0
    const nextId = tier < maxTier ? `${type}_GENERATOR_${tier + 1}` : null
    const recipe = nextId ? data.items[nextId]?.craft : undefined
    const needs = (recipe?.inputs ?? [])
      // The minion it upgrades from is yours already.
      .filter(([id]) => !/_GENERATOR_\d+$/.test(id))
      .map(([id, need]) => ({ id, name: data.items[id]?.name ?? cap(id.toLowerCase().replace(/_/g, ' ')), need, have: Math.min(need, owned[id] ?? 0) }))
    const total = needs.reduce((a, n) => a + n.need, 0)
    const have = needs.reduce((a, n) => a + n.have, 0)
    const name = (data.items[`${type}_GENERATOR_1`]?.name ?? cap(type.toLowerCase())).replace(/\s+[IVX]+$/, '')
    out.push({ type, name, tier, maxTier, next: nextId, progress: total ? have / total : 0, ready: !!recipe && have >= total && total > 0, needs })
  }
  out.sort(
    (a, b) =>
      Number(b.ready) - Number(a.ready) || Number(!!b.next) - Number(!!a.next) || Number(b.tier > 0) - Number(a.tier > 0) || b.progress - a.progress || a.name.localeCompare(b.name)
  )
  return out
}

// ---------- stats from item descriptions ----------

export interface StatLine {
  stat: string
  total: number
  /** Where it comes from: "Armour", "Equipment", "Accessories". */
  from: { source: string; value: number; items: { name: string; value: number }[] }[]
}

const STAT_RE = /^([A-Za-z][A-Za-z' ]{1,30}): ([+-]?[\d,.]+)(%?)/

/** "Strength: +100" lines from an item's description. */
export function loreStats(lore: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of lore) {
    const line = stripColors(raw)
    if (!line) continue
    const m = STAT_RE.exec(line)
    if (!m) continue
    const stat = m[1].trim()
    // Leave out the lines that aren't stats.
    if (/^(Cost|Cooldown|Mana Cost|Requires|Soulbound|Kills|Item Ability|Price|Bits|Owner|Upgrade|Level|Gemstone|Ability|Collection|Total|Rarity)/i.test(stat)) continue
    const n = Number(m[2].replace(/,/g, ''))
    if (Number.isFinite(n)) out[stat] = (out[stat] ?? 0) + n
  }
  return out
}

/** Stats added up from your armour, equipment and accessories' descriptions (reforges and enchants included). */
export function statBreakdown(groups: { source: string; items: readonly (SbViewItem | null)[] }[]): StatLine[] {
  const map = new Map<string, StatLine>()
  for (const g of groups)
    for (const it of g.items) {
      if (!it) continue
      for (const [stat, value] of Object.entries(loreStats(it.lore))) {
        let line = map.get(stat)
        if (!line) map.set(stat, (line = { stat, total: 0, from: [] }))
        line.total += value
        let src = line.from.find((f) => f.source === g.source)
        if (!src) line.from.push((src = { source: g.source, value: 0, items: [] }))
        src.value += value
        src.items.push({ name: stripColors(it.name), value })
      }
    }
  const order = [
    'Health',
    'Defense',
    'Strength',
    'Intelligence',
    'Crit Chance',
    'Crit Damage',
    'Speed',
    'Attack Speed',
    'Ferocity',
    'Magic Find',
    'Pet Luck',
    'True Defense',
    'Sea Creature Chance',
    'Mining Speed',
    'Mining Fortune',
    'Farming Fortune',
    'Foraging Fortune'
  ]
  return [...map.values()].sort((a, b) => (order.indexOf(a.stat) + 1 || 99) - (order.indexOf(b.stat) + 1 || 99) || a.stat.localeCompare(b.stat))
}

// ---------- the SkyBlock calendar ----------

/** SkyBlock's clock: year 1 began at this moment, a day is 20 minutes, a month 31 days, a year 12 months. */
export const SB_EPOCH = 1560275700000
export const SB_DAY = 20 * 60_000
export const SB_MONTH = 31 * SB_DAY
export const SB_YEAR = 12 * SB_MONTH
export const SB_MONTHS = [
  'Early Spring',
  'Spring',
  'Late Spring',
  'Early Summer',
  'Summer',
  'Late Summer',
  'Early Autumn',
  'Autumn',
  'Late Autumn',
  'Early Winter',
  'Winter',
  'Late Winter'
]

export interface SbDate {
  year: number
  /** 1 to 12. */
  month: number
  day: number
  hour: number
  minute: number
}

export function skyblockDate(now: number): SbDate {
  const t = now - SB_EPOCH
  const year = Math.floor(t / SB_YEAR) + 1
  const inYear = t - (year - 1) * SB_YEAR
  const month = Math.floor(inYear / SB_MONTH) + 1
  const inMonth = inYear - (month - 1) * SB_MONTH
  const day = Math.floor(inMonth / SB_DAY) + 1
  const minutes = ((inMonth - (day - 1) * SB_DAY) / SB_DAY) * 24 * 60
  return { year, month, day, hour: Math.floor(minutes / 60), minute: Math.floor(minutes % 60) }
}

export const describeSbDate = (d: SbDate): string =>
  `${SB_MONTHS[d.month - 1]} ${d.day}${['th', 'st', 'nd', 'rd'][d.day % 10 > 3 || [11, 12, 13].includes(d.day % 100) ? 0 : d.day % 10]}, Year ${d.year}`

/** Real time of a SkyBlock date (month 1–12, day 1–31) in a given year. */
const sbTime = (year: number, month: number, day: number): number => SB_EPOCH + (year - 1) * SB_YEAR + (month - 1) * SB_MONTH + (day - 1) * SB_DAY

export interface SbEvent {
  id: string
  name: string
  icon: string
  start: number
  end: number
  /** On now. */
  live: boolean
}

/** Yearly events by SkyBlock date, and the hourly ones by real clock. */
const YEARLY: { id: string; name: string; icon: string; month: number; day: number; days: number }[] = [
  { id: 'zoo-summer', name: 'Traveling Zoo', icon: 'MONSTER_EGG', month: 4, day: 1, days: 3 },
  { id: 'spooky', name: 'Spooky Festival', icon: 'PUMPKIN', month: 8, day: 29, days: 3 },
  { id: 'zoo-winter', name: 'Traveling Zoo', icon: 'MONSTER_EGG', month: 10, day: 1, days: 3 },
  { id: 'jerry', name: 'Jerry’s Workshop opens', icon: 'SNOW_BALL', month: 12, day: 1, days: 31 },
  { id: 'season-of-jerry', name: 'Season of Jerry', icon: 'SNOW_BLOCK', month: 12, day: 24, days: 3 },
  { id: 'new-year', name: 'New Year Celebration', icon: 'CAKE', month: 12, day: 29, days: 3 }
]

/** The next `limit` events from `now` (the ones on now first). */
export function upcomingEvents(now: number, limit = 8): SbEvent[] {
  const out: SbEvent[] = []
  const { year } = skyblockDate(now)
  for (const y of [year, year + 1])
    for (const e of YEARLY) {
      const start = sbTime(y, e.month, e.day)
      const end = start + e.days * SB_DAY
      if (end > now) out.push({ id: `${e.id}-${y}`, name: e.name, icon: e.icon, start, end, live: start <= now })
    }
  // Cult of the Fallen Star: days 7, 14, 21 and 28 of every month, 00:00–06:00 SkyBlock time.
  const d = skyblockDate(now)
  for (let m = 0; m < 3; m++) {
    const month = ((d.month - 1 + m) % 12) + 1
    const y = d.year + Math.floor((d.month - 1 + m) / 12)
    for (const day of [7, 14, 21, 28]) {
      const start = sbTime(y, month, day)
      const end = start + SB_DAY / 4
      if (end > now) out.push({ id: `cult-${y}-${month}-${day}`, name: 'Cult of the Fallen Star', icon: 'NETHER_STAR', start, end, live: start <= now })
    }
  }
  // Real-clock ones: the Dark Auction at :55 and Jacob's contests at :15, every hour.
  const hour = 3_600_000
  const atMinute = (min: number, length: number): { start: number; end: number } => {
    const h = Math.floor(now / hour) * hour
    let start = h + min * 60_000
    if (start + length <= now) start += hour
    return { start, end: start + length }
  }
  const dark = atMinute(55, 5 * 60_000)
  out.push({ id: 'dark-auction', name: 'Dark Auction', icon: 'NETHER_BRICK', ...dark, live: dark.start <= now })
  const jacob = atMinute(15, 20 * 60_000)
  out.push({ id: 'jacob', name: 'Jacob’s Farming Contest', icon: 'WHEAT', ...jacob, live: jacob.start <= now })
  out.sort((a, b) => Number(b.live) - Number(a.live) || a.start - b.start)
  return out.slice(0, limit)
}

export interface SbMayor {
  name: string
  perks: { name: string; description: string }[]
  minister: { name: string; perk: string } | null
  /** Who's ahead in the election running now. */
  leading: string | null
}

/** The mayor and minister from /v2/resources/skyblock/election. */
export function mayorOf(body: unknown): SbMayor | null {
  if (!isObj(body) || !isObj(body.mayor)) return null
  const m = body.mayor
  const perks = Array.isArray(m.perks) ? m.perks.filter(isObj).map((p) => ({ name: String(p.name ?? ''), description: stripColors(String(p.description ?? '')) })) : []
  const min = isObj(m.minister) ? m.minister : null
  const cands = isObj(body.current) && Array.isArray(body.current.candidates) ? body.current.candidates.filter(isObj) : []
  const leading = cands.length ? String(cands.reduce((a, b) => ((num(b.votes) ?? 0) > (num(a.votes) ?? 0) ? b : a)).name ?? '') : null
  return {
    name: String(m.name ?? ''),
    perks,
    minister: min ? { name: String(min.name ?? ''), perk: String(isObj(min.perk) ? (min.perk.name ?? '') : '') } : null,
    leading
  }
}

// ---------- co-op ----------

export interface CoopMember {
  uuid: string
  /** Name when known (filled in by the app). */
  name: string
  you: boolean
  /** Collection id → this member's share. */
  collections: Record<string, number>
  minionTiers: number
  skyblockLevel: number
}

/** Each co-op member's own collections and minions on the profile. */
export function coopMembers(body: unknown, profileId: string, uuid: string): CoopMember[] {
  const list = (isObj(body) && Array.isArray(body.profiles) ? body.profiles : []).filter(isObj)
  const profile = (profileId && list.find((p) => p.profile_id === profileId)) || list.find((p) => p.selected === true) || list[0]
  if (!profile || !isObj(profile.members)) return []
  const me = uuid.replace(/-/g, '').toLowerCase()
  return Object.entries(profile.members)
    .filter(([, m]) => isObj(m) && !(isObj(m.profile) && m.profile.deletion_notice))
    .map(([id, raw]) => {
      const m = raw as Record<string, unknown>
      const collections: Record<string, number> = {}
      if (isObj(m.collection)) for (const [k, v] of Object.entries(m.collection)) if (num(v)) collections[k.replace(/:/g, '-')] = v as number
      const gens = isObj(m.player_data) && Array.isArray(m.player_data.crafted_generators) ? m.player_data.crafted_generators.length : 0
      const xp = isObj(m.leveling) ? (num(m.leveling.experience) ?? 0) : 0
      return { uuid: id, name: '', you: id === me, collections, minionTiers: gens, skyblockLevel: Math.floor(xp / 100) }
    })
    .sort((a, b) => Number(b.you) - Number(a.you) || b.skyblockLevel - a.skyblockLevel)
}

/** A collection's tier from its count (for the co-op table). */
export const tierFor = (data: SbData, id: string, count: number): number => collectionTier(count, data.collections[id]?.tiers ?? [])

// ---------- the profile page ----------

export interface SbProfileChoice {
  id: string
  name: string
  mode: string
  /** The one you're on in game. */
  selected: boolean
  /** SkyBlock level on it. */
  level: number
  members: number
}

/** Every profile a player has, for the switcher. */
export function profileList(body: unknown, uuid: string): SbProfileChoice[] {
  const me = uuid.replace(/-/g, '').toLowerCase()
  const list = (isObj(body) && Array.isArray(body.profiles) ? body.profiles : []).filter(isObj)
  return list
    .map((p) => {
      const members = isObj(p.members) ? p.members : {}
      const m = isObj(members[me]) ? (members[me] as Record<string, unknown>) : {}
      const xp = isObj(m.leveling) ? (num(m.leveling.experience) ?? 0) : 0
      return {
        id: String(p.profile_id ?? ''),
        name: String(p.cute_name ?? 'Profile'),
        mode: typeof p.game_mode === 'string' ? p.game_mode : '',
        selected: p.selected === true,
        level: Math.floor(xp / 100),
        members: Object.keys(members).length
      }
    })
    .filter((p) => p.id)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.level - a.level)
}

/** Everything the profile page shows for one player and profile. */
export interface SbProfilePage {
  view: SbProfileView
  /** Your own account (goals, history and helpers are only for you). */
  mine: boolean
  player: { uuid: string; name: string; skin: string }
  choices: SbProfileChoice[]
  /** Your numbers over time on this profile (thinned for drawing). */
  history: SbSnapshot[]
  /** What moved since you last looked. */
  since: { at: number; changes: SbChange[] } | null
  milestones: SbMilestone[]
  starred: boolean
}

/** Keeps at most `max` points, always the first and last, evenly through time. */
export function thin<T extends { at: number }>(list: readonly T[], max = 240): T[] {
  if (list.length <= max) return list.slice()
  const out: T[] = []
  const step = (list.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)])
  return out
}

/** A player saved for the friends board: their headline numbers from the last look. */
export interface SbFriend {
  uuid: string
  name: string
  skin: string
  starred: boolean
  /** When last looked up. */
  at: number
  summary: {
    profileName: string
    mode: string
    level: number
    skillAverage: number | null
    catacombs: number | null
    slayerXp: number
    networth: number | null
    magicalPower: number | null
  } | null
}

export function friendSummary(v: SbProfileView): NonNullable<SbFriend['summary']> {
  return {
    profileName: v.profileName,
    mode: v.mode,
    level: lp(v.skyblockLevel),
    skillAverage: v.skillAverage,
    catacombs: v.dungeons ? lp(v.dungeons.catacombs) : null,
    slayerXp: v.slayers.reduce((a, s) => a + s.level.xp, 0),
    networth: v.networth?.total ?? null,
    magicalPower: v.accessories?.magicalPower ?? null
  }
}
