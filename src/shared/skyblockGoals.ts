/**
 * SkyBlock ironman goal planner, the pure parts: turning the NEU item repo (the community data the
 * NotEnoughUpdates mod uses) into a small recipe book, reading what you own from Hypixel's API,
 * breaking each goal down into its crafting tree with what you have and what's missing, what's
 * stopping you crafting it (collection, slayer, HotM), and how long it might take at the rates
 * you've actually managed (learned from your SkyBlock session summaries).
 *
 * Ironman only: nothing here looks at the Bazaar or the Auction House.
 */

// ---------- the recipe book ----------

export type Pair = [id: string, count: number]

export interface SbItem {
  id: string
  name: string
  /** The Minecraft colour code of the name (rarity), e.g. '6' for legendary gold. */
  color: string
  craft?: { inputs: Pair[]; count: number }
  forge?: { inputs: Pair[]; count: number; seconds: number }
  /** "Ender Pearl VII", "Zombie Slayer 6", "Gemstone X & HotM 5"… from "Requires: …". */
  req?: string
  shops?: { npc: string; cost: Pair[]; count: number }[]
  drops?: { mob: string; chance: string }[]
  /** A minion makes it. */
  minion?: boolean
}

export interface SbCollectionInfo {
  name: string
  /** How many you need to have collected for tier 1, 2, 3… */
  tiers: number[]
}

export interface SbData {
  at: number
  items: Record<string, SbItem>
  collections: Record<string, SbCollectionInfo>
  /** XP for each skill level, one after another (not added up). */
  skillXp: number[]
  /** Slayer boss → total XP for level 1, 2, 3… */
  slayerXp: Record<string, number[]>
  /** XP for each HotM tier, one after another. */
  hotmXp: number[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** "§6Terminator" → "Terminator". */
export const stripColors = (s: string): string => s.replace(/§./g, '').trim()

/** Hypixel writes "LOG:2" where NEU writes "LOG-2". */
export const neuId = (id: string): string => id.replace(/:/g, '-')

/** "ENDER_PEARL:4" → ['ENDER_PEARL', 4]. */
export function parsePair(s: unknown): Pair | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const i = s.lastIndexOf(':')
  if (i <= 0) return [s.trim(), 1]
  const n = Number(s.slice(i + 1))
  return Number.isFinite(n) && n > 0 ? [s.slice(0, i).trim(), n] : [s.trim(), 1]
}

/** The same ids added together, in first-seen order. */
function merge(pairs: Pair[]): Pair[] {
  const out = new Map<string, number>()
  for (const [id, n] of pairs) out.set(id, (out.get(id) ?? 0) + n)
  return [...out]
}

function gridInputs(grid: Record<string, unknown>): Pair[] {
  const out: Pair[] = []
  for (const slot of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']) {
    const p = parsePair(grid[slot])
    if (p) out.push(p)
  }
  return merge(out)
}

const TOOLS = /(^WOOD_|_SWORD$|_PICKAXE$|_AXE$|_HOE$|_SPADE$|_SHOVEL$|^FISHING_ROD$|^SHEARS$)/

/**
 * The recipe book from the NEU repo's item files (items/*.json, already parsed). Mobs' drop tables,
 * NPC shops and minion recipes (which live on the mob, the NPC and the minion) are put onto the items
 * they give.
 */
export function buildItems(files: unknown[]): Record<string, SbItem> {
  const items: Record<string, SbItem> = {}
  const raw = files.filter(isObj)
  for (const f of raw) {
    const id = typeof f.internalname === 'string' ? f.internalname : ''
    if (!id) continue
    const display = typeof f.displayname === 'string' ? f.displayname : id
    const color = /^§([0-9a-f])/i.exec(display)?.[1]?.toLowerCase() ?? 'f'
    const item: SbItem = { id, name: stripColors(display) || id, color }
    if (isObj(f.recipe)) {
      const inputs = gridInputs(f.recipe)
      if (inputs.length) item.craft = { inputs, count: num(f.recipe.count) ?? 1 }
    }
    for (const r of Array.isArray(f.recipes) ? f.recipes.filter(isObj) : []) {
      const out = typeof r.overrideOutputId === 'string' ? r.overrideOutputId : id
      if (out !== id) continue
      if (r.type === 'crafting' && !item.craft) {
        const inputs = gridInputs(r)
        if (inputs.length) item.craft = { inputs, count: num(r.count) ?? 1 }
      } else if (r.type === 'forge' && !item.forge && Array.isArray(r.inputs)) {
        const inputs = merge(r.inputs.map(parsePair).filter((p): p is Pair => !!p))
        if (inputs.length) item.forge = { inputs, count: num(r.count) ?? 1, seconds: num(r.duration) ?? 0 }
      }
    }
    const req = typeof f.crafttext === 'string' ? f.crafttext.replace(/^Requires:?\s*/i, '').trim() : ''
    if (req) item.req = req
    items[id] = item
  }

  // Things that live on other items: NPC shops, mob drops, minion recipes.
  for (const f of raw) {
    const id = typeof f.internalname === 'string' ? f.internalname : ''
    const who = stripColors(typeof f.displayname === 'string' ? f.displayname : id).replace(/\s*\((NPC|Monster|Boss|Miniboss|Animal|Sea Creature)\)\s*$/i, '')
    for (const r of Array.isArray(f.recipes) ? f.recipes.filter(isObj) : []) {
      if (r.type === 'npc_shop' || r.type === 'trade') {
        const result = parsePair(r.result)
        const cost = (Array.isArray(r.cost) ? r.cost : [r.cost]).map(parsePair).filter((p): p is Pair => !!p)
        const target = result && items[result[0]]
        if (!target || !cost.length) continue
        const shops = (target.shops ??= [])
        if (shops.length < 6 && !shops.some((s) => s.npc === who)) shops.push({ npc: who, cost: merge(cost), count: result[1] })
      } else if (r.type === 'drops' && Array.isArray(r.drops)) {
        const mob = stripColors(typeof r.name === 'string' ? r.name : who) || who
        for (const d of r.drops.filter(isObj)) {
          const p = parsePair(d.id)
          const target = p && items[p[0]]
          if (!target) continue
          const drops = (target.drops ??= [])
          if (drops.length < 8 && !drops.some((x) => x.mob === mob)) drops.push({ mob, chance: typeof d.chance === 'string' ? d.chance : '' })
        }
      }
    }
    // A tier I minion is made from what it makes (Enderman Minion I: 80 Ender Pearls and a wooden sword).
    if (/_GENERATOR_1$/.test(id) && items[id]?.craft) {
      const main = items[id].craft!.inputs.filter(([x]) => !TOOLS.test(x)).sort((a, b) => b[1] - a[1])[0]
      if (main && items[main[0]]) items[main[0]].minion = true
    }
  }
  return items
}

/** Collection tiers from /v2/resources/skyblock/collections (no key needed). */
export function buildCollections(body: unknown): Record<string, SbCollectionInfo> {
  const out: Record<string, SbCollectionInfo> = {}
  const groups = isObj(body) && isObj(body.collections) ? body.collections : {}
  for (const g of Object.values(groups)) {
    if (!isObj(g) || !isObj(g.items)) continue
    for (const [id, item] of Object.entries(g.items)) {
      if (!isObj(item)) continue
      const tiers = (Array.isArray(item.tiers) ? item.tiers.filter(isObj) : [])
        .sort((a, b) => (num(a.tier) ?? 0) - (num(b.tier) ?? 0))
        .map((t) => num(t.amountRequired) ?? 0)
      out[neuId(id)] = { name: typeof item.name === 'string' ? item.name : id, tiers }
    }
  }
  return out
}

/** Levels tables from the NEU repo's constants/leveling.json. */
export function buildLevels(body: unknown): Pick<SbData, 'skillXp' | 'slayerXp' | 'hotmXp'> {
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : [])
  const b = isObj(body) ? body : {}
  const slayerXp: Record<string, number[]> = {}
  if (isObj(b.slayer_xp)) for (const [k, v] of Object.entries(b.slayer_xp)) slayerXp[k] = nums(v)
  return { skillXp: nums(b.leveling_xp), slayerXp, hotmXp: nums(b.HOTM) }
}

// ---------- levels ----------

/** The level reached with `xp`, where `steps` is the XP for each level one after another. */
export function levelFromSteps(xp: number, steps: readonly number[]): number {
  let level = 0
  let total = 0
  for (const s of steps) {
    total += s
    if (xp < total) break
    level++
  }
  return level
}

/** Total XP needed for `level`, from per-level steps. */
export const xpForLevel = (level: number, steps: readonly number[]): number => steps.slice(0, level).reduce((a, b) => a + b, 0)

/** The level reached with `xp`, where `totals` is the total XP for level 1, 2, 3… */
export const levelFromTotals = (xp: number, totals: readonly number[]): number => totals.filter((t) => xp >= t).length

/** Your collection tier from how many you've collected. */
export const collectionTier = (count: number, tiers: readonly number[]): number => tiers.filter((t) => count >= t).length

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }
export function fromRoman(s: string): number | null {
  if (!/^[IVXLC]+$/.test(s)) return null
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]]
    const next = ROMAN[s[i + 1]] ?? 0
    n += v < next ? -v : v
  }
  return n
}

export const toRoman = (n: number): string => {
  const parts: [number, string][] = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of parts) while (n >= v) ((out += s), (n -= v))
  return out || '0'
}

// ---------- what's needed to craft something ----------

export type Requirement =
  | { kind: 'collection'; id: string; name: string; tier: number }
  | { kind: 'slayer'; boss: string; name: string; level: number }
  | { kind: 'hotm'; level: number }
  | { kind: 'skill'; skill: string; level: number }
  | { kind: 'other'; text: string }

const SLAYER_NAMES: Record<string, string> = {
  zombie: 'zombie', revenant: 'zombie', spider: 'spider', tarantula: 'spider', wolf: 'wolf', sven: 'wolf',
  enderman: 'enderman', voidgloom: 'enderman', eman: 'enderman', blaze: 'blaze', inferno: 'blaze', vampire: 'vampire', riftstalker: 'vampire'
}
const SKILLS = ['farming', 'mining', 'combat', 'foraging', 'fishing', 'enchanting', 'alchemy', 'carpentry', 'taming', 'runecrafting', 'social']

/** "Gemstone X & HotM 5" → a collection and a HotM requirement. */
export function parseRequirements(text: string, collections: Record<string, SbCollectionInfo>): Requirement[] {
  const byName = new Map(Object.entries(collections).map(([id, c]) => [c.name.toLowerCase(), id]))
  return text
    .split(/\s*&\s*|\s*,\s*|\s+and\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t): Requirement => {
      let m = /^(?:HotM|Heart of the Mountain)(?: Tier)? (\d+)$/i.exec(t)
      if (m) return { kind: 'hotm', level: Number(m[1]) }
      m = /^(\w+) Slayer (\d+|[IVX]+)$/i.exec(t)
      if (m && SLAYER_NAMES[m[1].toLowerCase()]) return { kind: 'slayer', boss: SLAYER_NAMES[m[1].toLowerCase()], name: `${m[1]} Slayer`, level: Number(m[2]) || fromRoman(m[2]) || 0 }
      m = /^(\w+)(?: Skill)? (\d+)$/i.exec(t)
      if (m && SKILLS.includes(m[1].toLowerCase())) return { kind: 'skill', skill: m[1].toLowerCase(), level: Number(m[2]) }
      m = /^(.+?) ([IVXLC]+)$/.exec(t)
      const tier = m ? fromRoman(m[2]) : null
      const id = m ? byName.get(m[1].toLowerCase()) : undefined
      if (m && tier && id) return { kind: 'collection', id, name: collections[id].name, tier }
      return { kind: 'other', text: t }
    })
}

// ---------- your profile ----------

export interface SbProfileData {
  at: number
  profileName: string
  mode: string
  /** Everything Orbit can see you own: inventory, ender chest, backpacks, sacks, vault, bags, armour. */
  owned: Record<string, number>
  /** null when the Collections API setting is off. */
  collections: Record<string, number> | null
  /** Collection → the highest tier unlocked (counts co-op members too). */
  unlockedTiers: Record<string, number>
  skills: Record<string, number> | null
  slayer: Record<string, number> | null
  hotmXp: number | null
  /** Plain sentences: an API setting that's off, so some of your stuff can't be seen. */
  hidden: string[]
}

export const API_SETTINGS_PATH = 'SkyBlock Menu → Settings → Personal → API Settings'

/** Collection id → highest tier, from player_data.unlocked_coll_tiers ("ENDER_PEARL_7"). */
export function unlockedTiers(list: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of Array.isArray(list) ? list : []) {
    if (typeof s !== 'string') continue
    const m = /^(.+)_(-?\d+)$/.exec(s)
    if (!m) continue
    const id = neuId(m[1])
    out[id] = Math.max(out[id] ?? 0, Number(m[2]))
  }
  return out
}

/** The parts of your profile the planner needs. `countItems` turns one of Hypixel's packed item lists into ids and counts. */
export function profileData(
  body: unknown,
  uuid: string,
  profileId: string,
  at: number,
  countItems: (data: string) => Record<string, number>
): SbProfileData | null {
  const list = (isObj(body) && Array.isArray(body.profiles) ? body.profiles : []).filter(isObj)
  const profile = (profileId && list.find((p) => p.profile_id === profileId)) || list.find((p) => p.selected === true) || list[0]
  if (!profile) return null
  const members = isObj(profile.members) ? profile.members : {}
  const me = members[uuid.replace(/-/g, '').toLowerCase()]
  if (!isObj(me)) return null

  const hidden: string[] = []
  const owned: Record<string, number> = {}
  const add = (counts: Record<string, number>): void => {
    for (const [id, n] of Object.entries(counts)) owned[neuId(id)] = (owned[neuId(id)] ?? 0) + n
  }
  const packed = (v: unknown): void => {
    if (isObj(v) && typeof v.data === 'string' && v.data) {
      try {
        add(countItems(v.data))
      } catch {
        // One unreadable list shouldn't stop the rest.
      }
    }
  }
  const inv = isObj(me.inventory) ? me.inventory : null
  if (!inv || !isObj(inv.inv_contents)) {
    hidden.push('Inventory API is off, so Orbit can’t see your inventory, ender chest, backpacks or sacks.')
  }
  if (inv) {
    for (const k of ['inv_contents', 'ender_chest_contents', 'inv_armor', 'equipment_contents', 'wardrobe_contents', 'personal_vault_contents']) packed(inv[k])
    if (isObj(inv.backpack_contents)) for (const b of Object.values(inv.backpack_contents)) packed(b)
    if (isObj(inv.bag_contents)) for (const b of Object.values(inv.bag_contents)) packed(b)
    if (isObj(inv.sacks_counts)) {
      const sacks: Record<string, number> = {}
      for (const [id, n] of Object.entries(inv.sacks_counts)) if (num(n)) sacks[id] = n as number
      add(sacks)
    }
    if (isObj(inv.inv_contents) && !isObj(inv.personal_vault_contents)) hidden.push('Personal Vault API is off, so what’s in your vault isn’t counted.')
  }
  const collections = isObj(me.collection) ? (Object.fromEntries(Object.entries(me.collection).filter(([, v]) => num(v) !== null).map(([k, v]) => [neuId(k), v as number])) as Record<string, number>) : null
  if (!collections) hidden.push('Collections API is off, so Orbit can’t tell which recipes you’ve unlocked or learn how fast you collect.')
  const playerData = isObj(me.player_data) ? me.player_data : {}
  let skills: Record<string, number> | null = null
  if (isObj(playerData.experience)) {
    skills = {}
    for (const [k, v] of Object.entries(playerData.experience)) if (k.startsWith('SKILL_') && num(v) !== null) skills[k.slice(6).toLowerCase()] = v as number
  } else hidden.push('Skills API is off, so skill requirements can’t be checked.')
  let slayer: Record<string, number> | null = null
  if (isObj(me.slayer) && isObj(me.slayer.slayer_bosses)) {
    slayer = {}
    for (const [k, v] of Object.entries(me.slayer.slayer_bosses)) slayer[k] = (isObj(v) ? num(v.xp) : null) ?? 0
  }
  const hotmXp = isObj(me.mining_core) ? num(me.mining_core.experience) : null
  return {
    at,
    profileName: String(profile.cute_name ?? 'Profile'),
    mode: typeof profile.game_mode === 'string' ? profile.game_mode : '',
    owned,
    collections,
    unlockedTiers: unlockedTiers(playerData.unlocked_coll_tiers),
    skills,
    slayer,
    hotmXp,
    hidden
  }
}

// ---------- reading Minecraft's NBT (how Hypixel packs item lists) ----------

/** A tiny reader for uncompressed NBT. Returns the root compound's contents. */
export function readNbt(buf: Uint8Array): unknown {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const text = new TextDecoder()
  const str = (): string => {
    const len = view.getUint16(pos)
    pos += 2
    const s = text.decode(buf.subarray(pos, pos + len))
    pos += len
    return s
  }
  const payload = (type: number, depth: number): unknown => {
    if (depth > 64) throw new Error('NBT nested too deeply')
    switch (type) {
      case 1:
        return view.getInt8(pos++)
      case 2: {
        const v = view.getInt16(pos)
        pos += 2
        return v
      }
      case 3: {
        const v = view.getInt32(pos)
        pos += 4
        return v
      }
      case 4: {
        const v = Number(view.getBigInt64(pos))
        pos += 8
        return v
      }
      case 5: {
        const v = view.getFloat32(pos)
        pos += 4
        return v
      }
      case 6: {
        const v = view.getFloat64(pos)
        pos += 8
        return v
      }
      case 7: {
        const len = view.getInt32(pos)
        pos += 4 + Math.max(0, len)
        return null
      }
      case 8:
        return str()
      case 9: {
        const inner = view.getInt8(pos++)
        const len = view.getInt32(pos)
        pos += 4
        const out: unknown[] = []
        for (let i = 0; i < len; i++) out.push(payload(inner, depth + 1))
        return out
      }
      case 10: {
        const out: Record<string, unknown> = {}
        for (;;) {
          const t = view.getInt8(pos++)
          if (t === 0) break
          const name = str()
          out[name] = payload(t, depth + 1)
        }
        return out
      }
      case 11: {
        const len = view.getInt32(pos)
        pos += 4 + Math.max(0, len) * 4
        return null
      }
      case 12: {
        const len = view.getInt32(pos)
        pos += 4 + Math.max(0, len) * 8
        return null
      }
      default:
        throw new Error(`Unknown NBT tag ${type}`)
    }
  }
  const type = view.getInt8(pos++)
  if (type !== 10) throw new Error('Not NBT')
  str()
  return payload(10, 0)
}

/** SkyBlock item ids and counts from a decoded item list ({ i: [ … ] }). */
export function countNbtItems(root: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  const list = isObj(root) && Array.isArray(root.i) ? root.i : []
  for (const slot of list) {
    if (!isObj(slot) || !isObj(slot.tag) || !isObj(slot.tag.ExtraAttributes)) continue
    const id = slot.tag.ExtraAttributes.id
    if (typeof id !== 'string' || !id) continue
    const n = num(slot.Count) ?? 1
    out[neuId(id)] = (out[neuId(id)] ?? 0) + Math.max(1, n)
  }
  return out
}

// ---------- goals and plans ----------

export interface SbGoal {
  id: string
  /** How many you want. */
  amount: number
  pinned: boolean
  added: number
}

export type SourceTag = 'crafted' | 'forge' | 'collection' | 'minion' | 'mob' | 'npc'

export interface RequirementCheck {
  req: Requirement
  /** "Ender Pearl VII" */
  label: string
  /** true met, false not yet, null Orbit can't tell. */
  met: boolean | null
  /** "You're at V, 2,300 to go" */
  detail: string
}

export interface PlanNode {
  id: string
  name: string
  color: string
  need: number
  /** Taken from what you own (shared materials are only counted once across goals). */
  have: number
  /** How many times it gets crafted / forged to make the rest. */
  crafts: number
  /** Still to get by hand, for parts that aren't crafted. */
  missing: number
  tags: SourceTag[]
  /** Where it comes from, in words: "Zealot (2.5%)", "Farm Merchant", "8h in the Forge". */
  where: string[]
  /** Requirements for crafting it that you haven't met yet. */
  locked: RequirementCheck[]
  children: PlanNode[]
}

export interface RawLine {
  id: string
  name: string
  color: string
  need: number
  have: number
  missing: number
  tags: SourceTag[]
  where: string[]
  /** Items an hour, from your own sessions, or null when Orbit hasn't seen you collect it. */
  perHour: number | null
}

export interface Blocker {
  check: RequirementCheck
  /** The parts that need it. */
  for: string[]
}

export interface GoalPlan {
  goal: SbGoal
  name: string
  color: string
  known: boolean
  tree: PlanNode | null
  raw: RawLine[]
  blockers: Blocker[]
  /** 0 to 1. */
  progress: number
  done: boolean
  /** Hours of play left at your rates, for the raw materials Orbit has a rate for. */
  hoursLeft: number | null
  /** Raw materials still missing that Orbit has no rate for (rare drops, never collected in a session). */
  noRate: number
  /** Time in the Forge (it runs while you're offline). */
  forgeHours: number
}

const tagWords: Record<SourceTag, string> = { crafted: 'Crafted', forge: 'Forge', collection: 'Collection', minion: 'Minion', mob: 'Mob drop', npc: 'NPC shop' }
export const tagLabel = (t: SourceTag): string => tagWords[t]

/** Checks a requirement against your profile. */
export function checkRequirement(req: Requirement, data: SbData, p: SbProfileData | null): RequirementCheck {
  const fmt = (n: number): string => Math.ceil(n).toLocaleString('en-GB')
  switch (req.kind) {
    case 'collection': {
      const label = `${req.name} ${toRoman(req.tier)} collection`
      const tiers = data.collections[req.id]?.tiers ?? []
      const count = p?.collections ? (p.collections[req.id] ?? 0) : null
      const unlocked = Math.max(p?.unlockedTiers[req.id] ?? 0, count !== null ? collectionTier(count, tiers) : 0)
      if (!p || (count === null && !(req.id in (p.unlockedTiers ?? {})))) return { req, label, met: null, detail: p ? 'Turn on the Collections API to check this.' : 'Refresh to check this.' }
      if (unlocked >= req.tier) return { req, label, met: true, detail: `You're at ${toRoman(unlocked) === '0' ? 'none' : toRoman(unlocked)}.` }
      const goal = tiers[req.tier - 1]
      const toGo = goal !== undefined && count !== null ? Math.max(0, goal - count) : null
      return { req, label, met: false, detail: `You're at ${unlocked ? toRoman(unlocked) : 'none yet'}${toGo !== null ? `, ${fmt(toGo)} more to collect` : ''}.` }
    }
    case 'slayer': {
      const label = `${req.name} ${req.level}`
      const xp = p?.slayer?.[req.boss]
      const totals = data.slayerXp[req.boss] ?? []
      if (xp === undefined || !totals.length) return { req, label, met: null, detail: p ? 'Orbit can’t see your slayer levels.' : 'Refresh to check this.' }
      const level = levelFromTotals(xp, totals)
      if (level >= req.level) return { req, label, met: true, detail: `You're level ${level}.` }
      return { req, label, met: false, detail: `You're level ${level}, ${fmt((totals[req.level - 1] ?? 0) - xp)} slayer XP to go.` }
    }
    case 'hotm': {
      const label = `Heart of the Mountain ${req.level}`
      if (p?.hotmXp === null || p?.hotmXp === undefined) return { req, label, met: null, detail: p ? 'Orbit can’t see your HotM level.' : 'Refresh to check this.' }
      // HotM starts at tier 1 with 0 XP.
      const level = Math.max(1, levelFromSteps(p.hotmXp, data.hotmXp))
      if (level >= req.level) return { req, label, met: true, detail: `You're tier ${level}.` }
      return { req, label, met: false, detail: `You're tier ${level}, ${fmt(xpForLevel(req.level, data.hotmXp) - p.hotmXp)} HotM XP to go.` }
    }
    case 'skill': {
      const label = `${req.skill[0].toUpperCase()}${req.skill.slice(1)} ${req.level}`
      const xp = p?.skills?.[req.skill]
      if (xp === undefined) return { req, label, met: null, detail: p ? 'Turn on the Skills API to check this.' : 'Refresh to check this.' }
      const level = levelFromSteps(xp, data.skillXp)
      if (level >= req.level) return { req, label, met: true, detail: `You're level ${level}.` }
      return { req, label, met: false, detail: `You're level ${level}, ${fmt(xpForLevel(req.level, data.skillXp) - xp)} XP to go.` }
    }
    default:
      return { req, label: req.text, met: null, detail: 'Orbit can’t check this one, so check it in game.' }
  }
}

function tagsFor(item: SbItem | undefined, data: SbData, crafted: 'craft' | 'forge' | null): { tags: SourceTag[]; where: string[] } {
  const tags: SourceTag[] = []
  const where: string[] = []
  if (crafted === 'craft') tags.push('crafted')
  if (crafted === 'forge') {
    tags.push('forge')
    if (item?.forge?.seconds) where.push(`${describeHours(item.forge.seconds / 3600)} in the Forge`)
  }
  if (!item) return { tags, where }
  if (data.collections[item.id]) tags.push('collection')
  if (item.minion) tags.push('minion')
  if (item.drops?.length) {
    tags.push('mob')
    where.push(...item.drops.slice(0, 3).map((d) => (d.chance ? `${d.mob} (${d.chance})` : d.mob)))
  }
  if (item.shops?.length) {
    tags.push('npc')
    where.push(...item.shops.slice(0, 2).map((s) => `${s.npc}: ${s.cost.map(([id, n]) => (id === 'SKYBLOCK_COIN' ? `${n.toLocaleString('en-GB')} coins` : `${n} × ${data.items[id]?.name ?? id}`)).join(', ')}`))
  }
  if (!crafted && item.forge && !tags.includes('forge')) tags.push('forge')
  return { tags, where }
}

/** Items an hour for each collection, learned from your session summaries (only the sessions where it went up). */
export function learnRates(sessions: readonly { minutes: number; collected: readonly { id: string; count: number }[] }[]): Record<string, number> {
  const got = new Map<string, { count: number; minutes: number }>()
  for (const s of sessions) {
    if (!(s.minutes > 0)) continue
    for (const c of s.collected) {
      if (!(c.count > 0)) continue
      const id = neuId(c.id)
      const g = got.get(id) ?? { count: 0, minutes: 0 }
      g.count += c.count
      g.minutes += s.minutes
      got.set(id, g)
    }
  }
  const out: Record<string, number> = {}
  for (const [id, g] of got) if (g.minutes >= 5) out[id] = (g.count / g.minutes) * 60
  return out
}

/** "40 min", "9.5h", "530h". Hours, not days, since it's time playing. */
export function describeHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return 'no time'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h).toLocaleString('en-GB')}h`
}

const MAX_DEPTH = 24

/**
 * Plans for every goal, in the order given (pinned ones first is up to the caller). What you own is
 * one shared pile: a diamond used by the first goal isn't counted again for the second.
 */
export function planGoals(goals: readonly SbGoal[], data: SbData, profile: SbProfileData | null, rates: Record<string, number>): GoalPlan[] {
  const pool = new Map(Object.entries(profile?.owned ?? {}))
  const reqCache = new Map<string, RequirementCheck[]>()
  const unmet = (item: SbItem): RequirementCheck[] => {
    if (!item.req) return []
    let c = reqCache.get(item.id)
    if (!c) {
      c = parseRequirements(item.req, data.collections).map((r) => checkRequirement(r, data, profile)).filter((x) => x.met !== true)
      reqCache.set(item.id, c)
    }
    return c
  }

  const expand = (id: string, qty: number, stock: Map<string, number>, path: Set<string>, depth: number): PlanNode => {
    const item = data.items[id]
    const take = Math.min(stock.get(id) ?? 0, qty)
    if (take) stock.set(id, (stock.get(id) ?? 0) - take)
    const rest = qty - take
    const recipe = item && !data.collections[id] && !path.has(id) && depth < MAX_DEPTH ? (item.craft ? 'craft' : item.forge ? 'forge' : null) : null
    const node: PlanNode = { id, name: item?.name ?? prettyId(id), color: item?.color ?? 'f', need: qty, have: take, crafts: 0, missing: 0, ...tagsFor(item, data, recipe), locked: [], children: [] }
    if (rest > 0 && recipe && item) {
      const r = recipe === 'craft' ? item.craft! : item.forge!
      const crafts = Math.ceil(rest / r.count)
      node.crafts = crafts
      const extra = crafts * r.count - rest
      if (extra) stock.set(id, (stock.get(id) ?? 0) + extra)
      const inner = new Set(path).add(id)
      node.children = r.inputs.map(([cid, n]) => expand(cid, n * crafts, stock, inner, depth + 1))
      node.locked = unmet(item)
    } else if (rest > 0) node.missing = rest
    return node
  }

  return goals.map((goal) => {
    const item = data.items[goal.id]
    const tree = expand(goal.id, Math.max(1, goal.amount), pool, new Set(), 0)
    // With nothing owned, for how far along you are.
    const empty = expand(goal.id, Math.max(1, goal.amount), new Map(), new Set(), 0)
    const raw = new Map<string, RawLine>()
    let forgeSeconds = 0
    const walk = (n: PlanNode): void => {
      if (n.tags.includes('forge') && n.crafts) forgeSeconds += (data.items[n.id]?.forge?.seconds ?? 0)
      if (!n.children.length) {
        const line = raw.get(n.id) ?? { id: n.id, name: n.name, color: n.color, need: 0, have: 0, missing: 0, tags: n.tags, where: n.where, perHour: rates[n.id] ?? null }
        line.need += n.need
        line.have += n.have
        line.missing += n.missing
        raw.set(n.id, line)
      } else {
        // Parts you already have partly count as raw progress too; the rest is in the children.
        n.children.forEach(walk)
      }
    }
    walk(tree)
    const leafTotal = (n: PlanNode): number => (n.children.length ? n.children.reduce((a, c) => a + leafTotal(c), 0) : n.need)
    const total = leafTotal(empty)
    const missing = [...raw.values()].reduce((a, l) => a + l.missing, 0)
    const progress = total > 0 ? Math.max(0, Math.min(1, 1 - missing / total)) : tree.have >= tree.need ? 1 : 0
    const blockers = new Map<string, Blocker>()
    const collect = (n: PlanNode): void => {
      for (const c of n.locked) {
        const b = blockers.get(c.label) ?? { check: c, for: [] }
        if (!b.for.includes(n.name)) b.for.push(n.name)
        blockers.set(c.label, b)
      }
      n.children.forEach(collect)
    }
    collect(tree)
    let hours = 0
    let noRate = 0
    let any = false
    for (const l of raw.values()) {
      if (!l.missing) continue
      if (l.perHour && l.perHour > 0) {
        hours += l.missing / l.perHour
        any = true
      } else noRate++
    }
    const done = tree.have >= tree.need
    return {
      goal,
      name: item?.name ?? prettyId(goal.id),
      color: item?.color ?? 'f',
      known: !!item,
      tree,
      raw: [...raw.values()].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name)),
      blockers: [...blockers.values()].sort((a, b) => Number(a.check.met === null) - Number(b.check.met === null)),
      progress: done ? 1 : progress,
      done,
      hoursLeft: done ? 0 : any ? hours : null,
      noRate: done ? 0 : noRate,
      forgeHours: done ? 0 : forgeSeconds / 3600
    }
  })
}

/** "ENCHANTED_ENDER_PEARL" → "Enchanted Ender Pearl", for ids the recipe book doesn't know. */
export const prettyId = (id: string): string =>
  id
    .toLowerCase()
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

/** Pinned goals first, then the rest in the order added. */
export const orderGoals = (goals: readonly SbGoal[]): SbGoal[] => [...goals].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.added - b.added)

/** Items whose name (or id) has every word of the search, best matches first. */
export function searchItems(items: Record<string, SbItem>, query: string, limit = 30): SbItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const q = words.join(' ')
  const hits: { item: SbItem; score: number }[] = []
  for (const item of Object.values(items)) {
    const name = item.name.toLowerCase()
    const id = item.id.toLowerCase()
    if (!words.every((w) => name.includes(w) || id.includes(w))) continue
    // Mobs and NPCs live in the same files; they aren't goals.
    if (/_(NPC|MONSTER|BOSS|MINIBOSS|ANIMAL|SEA_CREATURE)$/.test(item.id)) continue
    // Enchanted books, attribute shards and pet levels: hundreds of look-alikes nobody crafts towards.
    if (item.id.includes(';') && !item.craft && !item.forge) continue
    const score = (name === q ? 0 : name.startsWith(q) ? 1 : 2) + (item.craft || item.forge ? 0 : 0.5) + name.length / 200
    hits.push({ item, score })
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.item)
}

/** How long a Hypixel developer key lasts. */
export const DEV_KEY_DAYS = 3

/** A warning for a developer key that's about to run out (a day before), or has. */
export function keyWarning(savedAt: number | null, personal: boolean, now: number): string {
  if (!savedAt || personal) return ''
  const left = savedAt + DEV_KEY_DAYS * 86_400_000 - now
  if (left <= 0) return 'Your Hypixel developer key has probably run out (they last 3 days). Make a new one on developer.hypixel.net and paste it on the Games page → SkyBlock.'
  if (left <= 86_400_000) return `Your Hypixel developer key runs out in about ${describeHours(left / 3_600_000)}. Make a new one on developer.hypixel.net and paste it on the Games page → SkyBlock.`
  return ''
}

// ---------- what the Goals page gets ----------

export interface SkyblockItemHit {
  id: string
  name: string
  color: string
  crafted: boolean
}

export interface SkyblockGoalsState {
  /** A Hypixel key and Minecraft name are set up (Games page → SkyBlock). */
  ready: boolean
  /** The downloaded recipe book, if there is one. */
  data: { at: number; items: number } | null
  /** What's happening while the recipe book downloads. */
  downloading: string | null
  dataError: string
  profile: { at: number; profileName: string; mode: string; hidden: string[] } | null
  profileError: string
  refreshing: boolean
  keyWarning: string
  goals: SbGoal[]
  plans: GoalPlan[]
}

/** Minecraft's colour codes, for item names in their rarity colour. */
export const MC_COLORS: Record<string, string> = {
  '0': '#555555', '1': '#3b5bdb', '2': '#2f9e44', '3': '#1098ad', '4': '#c92a2a', '5': '#ae3ec9', '6': '#f59f00', '7': '#adb5bd',
  '8': '#868e96', '9': '#5c7cfa', a: '#51cf66', b: '#3bc9db', c: '#ff6b6b', d: '#f783ac', e: '#fcc419', f: 'inherit'
}
