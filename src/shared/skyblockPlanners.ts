import { stripColors } from './skyblockGoals'

/**
 * The planners on the SkyBlock profile page: museum, slayer, dungeons, the Heart of the Mountain and
 * Forest trees, the garden, the closest bestiary milestones and the daily checklist. The repo parts
 * are read once when the item list downloads (plannerExtras); the rest is worked out from a profile.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : [])
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {})
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

// ---------- what's read from the NEU repo ----------

export interface TreePerk {
  id: string
  name: string
  x: number
  y: number
  maxLevel: number
  /** Lisp from the repo: which powder the next level costs, and how much. */
  powder: string
  cost: string
  ability: boolean
  /** Lines, some only shown once a level is reached ({ text, onlyIf: "(gt level 3)" }). */
  lore: (string | { text: string; onlyIf: string })[]
  /** "stat", "statBoost"… → Lisp for the {stat} parts of the lore. */
  stats: Record<string, string>
}

export interface PlannerExtras {
  museum: {
    /** Category → item (or armour set) ids. */
    items: Record<string, string[]>
    xp: Record<string, number>
    /** Item → the lower item that counts as donated with it. */
    children: Record<string, string>
    setsToItems: Record<string, string[]>
    /** Starred and other copies → the id the museum counts. */
    mapped: Record<string, string>
  }
  hotm: TreePerk[]
  hotf: TreePerk[]
  hotfXp: number[]
  slayerBossXp: number[]
  slayerBossXpByType: Record<string, number[]>
  slayerHighestTier: Record<string, number>
  garden: {
    /** Plot id → where it is on the 5 × 5 map and its name. */
    plots: Record<string, { name: string; x: number; y: number }>
    /** beginner / intermediate / advanced / expert → the cost of the 1st, 2nd… plot of that kind. */
    plotCosts: Record<string, { item: string; amount: number }[]>
    /** Copper for each crop upgrade level. */
    cropUpgrades: number[]
    /** Upgrade → level → its cost. */
    composter: Record<string, Record<string, { upgrade: number; items: Record<string, number>; copper: number }>>
    composterTips: Record<string, string>
    /** Visitor id → rarity. */
    visitors: Record<string, string>
  }
}

function perksOf(layout: unknown, key: string): TreePerk[] {
  const perks = obj(obj(obj(layout)[key]).perks)
  return Object.entries(perks)
    .filter(([, p]) => isObj(p))
    .map(([id, raw]) => {
      const p = obj(raw)
      const stats: Record<string, string> = {}
      for (const [k, v] of Object.entries(p)) if (/^stat/.test(k) && typeof v === 'string') stats[k] = v
      return {
        id,
        name: stripColors(String(p.name ?? id)),
        x: num(p.x) ?? 0,
        y: num(p.y) ?? 0,
        maxLevel: num(p.maxLevel) ?? 1,
        powder: String(p.powder ?? ''),
        cost: String(p.cost ?? ''),
        ability: p.isAbility === true || /Pickaxe Ability|Axe Ability/.test(strs(p.lore).join(' ')),
        lore: (Array.isArray(p.lore) ? p.lore : []).map((l) => (isObj(l) ? { text: String(l.text ?? ''), onlyIf: String(l.onlyIf ?? '') } : String(l))),
        stats
      }
    })
}

/** The planners' parts of the repo's constants. */
export function plannerExtras(c: Record<string, unknown>): PlannerExtras {
  const m = obj(c.museum)
  const lv = obj(c.leveling)
  const g = obj(c.garden)
  const items: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj(m.items))) items[k] = strs(v)
  const strMap = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(obj(v)).map(([k, x]) => [k, String(x)]))
  const plots: PlannerExtras['garden']['plots'] = {}
  for (const [k, v] of Object.entries(obj(g.plots))) plots[k] = { name: stripColors(String(obj(v).name ?? k)), x: num(obj(v).x) ?? 0, y: num(obj(v).y) ?? 0 }
  const plotCosts: PlannerExtras['garden']['plotCosts'] = {}
  for (const [k, v] of Object.entries(obj(g.plot_costs)))
    plotCosts[k] = (Array.isArray(v) ? v : []).map((x) => ({ item: String(obj(x).item ?? ''), amount: num(obj(x).amount) ?? 0 }))
  const composter: PlannerExtras['garden']['composter'] = {}
  for (const [k, levels] of Object.entries(obj(g.composter_upgrades))) {
    composter[k] = {}
    for (const [lvl, x] of Object.entries(obj(levels)))
      composter[k][lvl] = {
        upgrade: num(obj(x).upgrade) ?? 0,
        items: Object.fromEntries(Object.entries(obj(obj(x).items)).map(([i, n]) => [i, num(n) ?? 0])),
        copper: num(obj(x).copper) ?? 0
      }
  }
  return {
    museum: {
      items,
      xp: Object.fromEntries(Object.entries(obj(m.itemToXp)).map(([k, v]) => [k, num(v) ?? 0])),
      children: strMap(m.children),
      setsToItems: Object.fromEntries(Object.entries(obj(m.sets_to_items)).map(([k, v]) => [k, strs(v)])),
      mapped: strMap(m.mapped_ids)
    },
    hotm: perksOf(c.hotmlayout, 'hotm'),
    hotf: perksOf(c.hotflayout, 'hotf'),
    hotfXp: nums(lv.HOTF),
    slayerBossXp: nums(lv.slayer_boss_xp),
    slayerBossXpByType: Object.fromEntries(Object.entries(obj(lv.slayer_boss_xp_type)).map(([k, v]) => [k, nums(v)])),
    slayerHighestTier: Object.fromEntries(Object.entries(obj(lv.slayer_to_highest_tier)).map(([k, v]) => [k, num(v) ?? 5])),
    garden: {
      plots,
      plotCosts,
      cropUpgrades: nums(g.crop_upgrades),
      composter,
      composterTips: strMap(g.composter_tooltips),
      visitors: strMap(g.visitors)
    }
  }
}

// ---------- the repo's little Lisp (costs and stats in the tree layouts) ----------

type LispValue = number | string | boolean | LispValue[]
type Node = string | Node[]

function parseLisp(src: string): Node | null {
  const tokens = src.match(/"(?:[^"\\]|\\.)*"|[()]|[^\s()]+/g)
  if (!tokens) return null
  let i = 0
  const read = (): Node => {
    const t = tokens[i++]
    if (t === '(') {
      const list: Node[] = []
      while (i < tokens.length && tokens[i] !== ')') list.push(read())
      i++
      return list
    }
    return t
  }
  return read()
}

const asNum = (v: LispValue): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v))

function evalLisp(n: Node, env: Record<string, number>): LispValue {
  if (typeof n === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n)
    if (n.startsWith('"')) return n.slice(1, -1)
    if (n === 'true') return true
    if (n === 'false') return false
    if (n in env) return env[n]
    return n.replace(/^:/, '')
  }
  const [head, ...rest] = n
  const arg = (k: number): LispValue => evalLisp(rest[k], env)
  const all = (): number[] => rest.map((r) => asNum(evalLisp(r, env)))
  switch (head) {
    case 'if':
      return asNum(arg(0)) ? arg(1) : rest.length > 2 ? arg(2) : 0
    case 'lt':
      return asNum(arg(0)) < asNum(arg(1))
    case 'gt':
      return asNum(arg(0)) > asNum(arg(1))
    case '=':
      return arg(0) === arg(1)
    case '+':
      return all().reduce((a, b) => a + b, 0)
    case '*':
      return all().reduce((a, b) => a * b, 1)
    case '-': {
      const [a, ...b] = all()
      return b.length ? b.reduce((x, y) => x - y, a) : -a
    }
    case '/': {
      const [a, ...b] = all()
      return b.reduce((x, y) => x / y, a)
    }
    case 'pow':
      return Math.pow(asNum(arg(0)), asNum(arg(1)))
    case 'min':
      return Math.min(...all())
    case 'max':
      return Math.max(...all())
    case 'round':
      return Math.round(asNum(arg(0)))
    case 'floor':
      return Math.floor(asNum(arg(0)))
    case 'ceil':
      return Math.ceil(asNum(arg(0)))
    case 'round-decimals': {
      const p = Math.pow(10, asNum(arg(1)))
      return Math.round(asNum(arg(0)) * p) / p
    }
    case 'id':
      return arg(0)
    case 'list.new':
      return rest.map((r) => evalLisp(r, env))
    case 'list.at': {
      const l = arg(0)
      return Array.isArray(l) ? (l[asNum(arg(1))] ?? 0) : 0
    }
    default:
      throw new Error(`unknown ${String(head)}`)
  }
}

/** One of the repo's expressions worked out, or null when it's empty or uses something unknown. */
export function lisp(src: string, env: Record<string, number>): LispValue | null {
  if (!src.trim()) return null
  try {
    const n = parseLisp(src)
    return n === null ? null : evalLisp(n, env)
  } catch {
    return null
  }
}

// ---------- Heart of the Mountain and Forest ----------

/** Hypixel's names for HotM perks where they differ from the repo's. */
const HOTM_API: Record<string, string> = {
  hungry_for_more: 'dead_mans_chest',
  warm_hearted: 'warm_heart',
  mining_speed_2: 'speedy_mineman',
  mining_fortune_2: 'fortunate_mineman',
  special_0: 'core_of_the_mountain',
  daily_effect: 'sky_mall',
  fortunate: 'gem_lover',
  mining_experience: 'seasoned_mineman',
  random_event: 'luck_of_the_cave',
  forge_time: 'quick_forge',
  pickaxe_toss: 'pickobulus',
  special_1: 'center_of_the_forest'
}
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface TreeNode {
  id: string
  name: string
  x: number
  y: number
  level: number
  maxLevel: number
  ability: boolean
  /** The ability you've picked. */
  selected: boolean
  /** Turned off in game (it still counts as bought). */
  disabled: boolean
  /** What the next level costs, and in which powder (null when it's maxed or the cost isn't known). */
  next: { powder: string; cost: number } | null
  /** Powder to max it from here, by kind. */
  toMax: Record<string, number>
  lore: string[]
}

export interface TreeView {
  kind: 'mining' | 'foraging'
  width: number
  height: number
  nodes: TreeNode[]
  /** Perks you have levels in. */
  bought: number
  /** Powder to max everything, by kind. */
  toMax: Record<string, number>
}

const POWDER_NAME: Record<string, string> = {
  MITHRIL: 'Mithril',
  GEMSTONE: 'Gemstone',
  GLACITE: 'Glacite',
  FOREST_WHISPERS: 'Forest Whispers',
  DESERT_WHISPERS: 'Desert Whispers'
}
export const powderName = (p: string): string => POWDER_NAME[p] ?? p

/** The perk tree from the levels Hypixel sends ({ mining_speed: 50, toggle_mining_speed: false, … }). */
export function treeView(kind: 'mining' | 'foraging', perks: readonly TreePerk[], raw: Record<string, unknown>, selectedAbility: string, potm = 0): TreeView | null {
  if (!perks.length) return null
  const byKey = new Map<string, TreePerk>()
  for (const p of perks) {
    byKey.set(p.id, p)
    byKey.set(squash(p.id), p)
    byKey.set(squash(p.name), p)
  }
  const levels = new Map<string, number>()
  const off = new Set<string>()
  for (const [k, v] of Object.entries(raw)) {
    const toggle = /^toggle_(.+)$/.exec(k)
    const key = toggle ? toggle[1] : k
    const perk = byKey.get(HOTM_API[key] ?? key) ?? byKey.get(squash(HOTM_API[key] ?? key))
    if (!perk) continue
    if (toggle) {
      if (v === false) off.add(perk.id)
    } else if (num(v) !== null) levels.set(perk.id, v as number)
  }
  const selected = squash(selectedAbility)
  const total: Record<string, number> = {}
  const nodes: TreeNode[] = perks.map((p) => {
    const level = Math.min(p.maxLevel, levels.get(p.id) ?? 0)
    const costAt = (l: number): { powder: string; cost: number } | null => {
      const env = { level: l, level0: l - 1, maxLevel: p.maxLevel, potm }
      const cost = lisp(p.cost, env)
      const powder = lisp(p.powder, env) ?? p.powder
      if (typeof cost !== 'number' || !Number.isFinite(cost) || typeof powder !== 'string' || !powder) return null
      return { powder, cost: Math.ceil(cost) }
    }
    const toMax: Record<string, number> = {}
    for (let l = Math.max(1, level); l < p.maxLevel; l++) {
      const c = costAt(l)
      if (c && c.cost > 0) {
        toMax[c.powder] = (toMax[c.powder] ?? 0) + c.cost
        total[c.powder] = (total[c.powder] ?? 0) + c.cost
      }
    }
    const env = { level: Math.max(1, level), level0: Math.max(0, level - 1), maxLevel: p.maxLevel, potm }
    const lore = p.lore.map((raw) => {
      // A line for a level not reached yet shows greyed out, so you can see what's coming.
      const line = typeof raw === 'string' ? raw : lisp(raw.onlyIf, env) === false ? `§8${stripColors(raw.text)}` : raw.text
      return line.replace(/\{(stat\w*)\}/g, (all, key: string) => {
        const v = lisp(p.stats[key] ?? '', env)
        return v === null ? all : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v)
      })
    })
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      level,
      maxLevel: p.maxLevel,
      ability: p.ability,
      selected: !!selected && (squash(p.id) === selected || squash(p.name) === selected || squash(HOTM_API[selectedAbility] ?? '') === squash(p.id)),
      disabled: off.has(p.id),
      next: level > 0 && level < p.maxLevel ? costAt(level) : null,
      toMax,
      lore
    }
  })
  return {
    kind,
    width: Math.max(...perks.map((p) => p.x)) + 1,
    height: Math.max(...perks.map((p) => p.y)) + 1,
    nodes,
    bought: nodes.filter((n) => n.level > 0).length,
    toMax: total
  }
}

/** Where a tree's levels live: the new skill_tree, or mining_core / foraging_core before it. */
export function treeSource(me: Record<string, unknown>, kind: 'mining' | 'foraging'): { nodes: Record<string, unknown>; xp: number | null; ability: string } | null {
  const st = obj(me.skill_tree)
  const core = obj(me[kind === 'mining' ? 'mining_core' : 'foraging_core'])
  const nodes = isObj(obj(st.nodes)[kind]) ? obj(obj(st.nodes)[kind]) : isObj(core.nodes) ? obj(core.nodes) : null
  const xp = num(obj(st.experience)[kind]) ?? num(core.experience)
  if (!nodes && xp === null) return null
  const ability = obj(st.selected_ability)[kind] ?? core.selected_pickaxe_ability ?? core.selected_ability
  return { nodes: nodes ?? {}, xp, ability: typeof ability === 'string' ? ability : '' }
}

/** Forest and Desert Whispers, wherever Hypixel keeps them. */
export function whispersOf(me: Record<string, unknown>): { kind: string; available: number; spent: number }[] {
  const found: Record<string, { available: number; spent: number }> = {}
  const look = (o: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(o)) {
      const m = /(forest|desert)_whispers/.exec(k)
      if (!m || num(v) === null) continue
      const f = (found[m[1]] ??= { available: 0, spent: 0 })
      if (/spent/.test(k)) f.spent = v as number
      else if (!/total/.test(k)) f.available = v as number
    }
  }
  look(obj(me.foraging_core))
  look(obj(me.skill_tree))
  look(obj(obj(me.skill_tree).powder))
  look(obj(me.currencies))
  return Object.entries(found).map(([k, v]) => ({ kind: k === 'forest' ? 'Forest Whispers' : 'Desert Whispers', ...v }))
}

// ---------- museum ----------

export interface MuseumPlan {
  categories: { id: string; name: string; donated: number; total: number }[]
  missing: { id: string; name: string; category: string; xp: number; owned: boolean; pieces?: string[] }[]
}

const CATEGORY_NAMES: Record<string, string> = { dungeoneering: 'Dungeons' }

/** What's donated and what's left, counting lower tiers that come with a better item. */
export function museumPlan(donatedIds: readonly string[], m: PlannerExtras['museum'], owned: ReadonlySet<string>, nameOf: (id: string) => string = (id) => id): MuseumPlan {
  const donated = new Set<string>()
  for (const raw of donatedIds) {
    let id: string | undefined = m.mapped[raw] ?? raw
    // A donated item counts its lower tiers too (Hyperion's Necron's Blade family, set upgrades).
    while (id && !donated.has(id)) {
      donated.add(id)
      id = m.children[id]
    }
  }
  const categories: MuseumPlan['categories'] = []
  const missing: MuseumPlan['missing'] = []
  for (const [cat, ids] of Object.entries(m.items)) {
    if (cat === 'special') continue
    let got = 0
    for (const id of ids) {
      if (donated.has(id)) {
        got++
        continue
      }
      const pieces = m.setsToItems[id]
      missing.push({
        id,
        // An armour set is named after its helmet ("Necron's Helmet" → "Necron's Armor").
        name: pieces
          ? `${nameOf(pieces.find((p) => /HELMET|HAT|HOOD|MASK|CROWN|HEAD/.test(p)) ?? pieces[0]).replace(/\s+(Helmet|Hat|Hood|Mask|Crown|Head)$/i, '')} set`
          : nameOf(id),
        category: cat,
        xp: m.xp[id] ?? 0,
        owned: pieces ? pieces.length > 0 && pieces.every((p) => owned.has(p)) : owned.has(id),
        pieces
      })
    }
    categories.push({ id: cat, name: CATEGORY_NAMES[cat] ?? cat[0].toUpperCase() + cat.slice(1), donated: got, total: ids.length })
  }
  missing.sort((a, b) => Number(b.owned) - Number(a.owned) || b.xp - a.xp || a.id.localeCompare(b.id))
  return { categories, missing }
}

// ---------- slayer ----------

/** What each tier of a slayer boss costs to start, in coins (Riftstalker costs motes). */
const SLAYER_COST = [2_000, 7_500, 20_000, 50_000, 100_000]
const VAMPIRE_COST = [2_000, 6_000, 12_000, 30_000, 75_000]

export interface SlayerPlan {
  /** XP left for the next level (null at max). */
  left: number | null
  nextLevel: number | null
  tiers: { tier: number; xp: number; bosses: number; cost: number; currency: string }[]
}

/** Bosses of each tier needed for the next slayer level. */
export function slayerPlan(id: string, xp: number, totals: readonly number[], x: Pick<PlannerExtras, 'slayerBossXp' | 'slayerBossXpByType' | 'slayerHighestTier'>): SlayerPlan {
  const level = totals.filter((t) => xp >= t).length
  const next = totals[level]
  const perBoss = x.slayerBossXpByType[id] ?? x.slayerBossXp
  const highest = x.slayerHighestTier[id] ?? perBoss.length
  if (next === undefined) return { left: null, nextLevel: null, tiers: [] }
  const left = next - xp
  const costs = id === 'vampire' ? VAMPIRE_COST : SLAYER_COST
  return {
    left,
    nextLevel: level + 1,
    tiers: perBoss.slice(0, highest).map((bx, i) => {
      const bosses = bx > 0 ? Math.ceil(left / bx) : 0
      return { tier: i + 1, xp: bx, bosses, cost: bosses * costs[i], currency: id === 'vampire' ? 'motes' : 'coins' }
    })
  }
}

// ---------- dungeons ----------

/** Catacombs XP for an S+ run of each floor, before boosts (the wiki's numbers). */
export const FLOOR_XP: { floor: string; master: boolean; xp: number }[] = [
  { floor: 'Entrance', master: false, xp: 50 },
  { floor: 'Floor 1', master: false, xp: 80 },
  { floor: 'Floor 2', master: false, xp: 160 },
  { floor: 'Floor 3', master: false, xp: 400 },
  { floor: 'Floor 4', master: false, xp: 1_420 },
  { floor: 'Floor 5', master: false, xp: 2_000 },
  { floor: 'Floor 6', master: false, xp: 4_000 },
  { floor: 'Floor 7', master: false, xp: 20_000 },
  { floor: 'Master 1', master: true, xp: 10_000 },
  { floor: 'Master 2', master: true, xp: 15_000 },
  { floor: 'Master 3', master: true, xp: 36_500 },
  { floor: 'Master 4', master: true, xp: 48_500 },
  { floor: 'Master 5', master: true, xp: 70_000 },
  { floor: 'Master 6', master: true, xp: 100_000 },
  { floor: 'Master 7', master: true, xp: 300_000 }
]

export interface DungeonPlan {
  goals: { id: string; name: string; target: number; left: number }[]
  /** Floors you've cleared (normal up to your best, and master floors once one is done). */
  floors: { floor: string; master: boolean; xp: number; runs: number[] }[]
}

/**
 * Runs of each floor to reach each goal: the next Catacombs level, the next level of your class, and
 * Catacombs 50. Your class gets the run's full XP and the others a quarter.
 */
export function dungeonPlan(
  cata: { xp: number; level: number },
  cls: { id: string; name: string; xp: number; level: number } | null,
  steps: readonly number[],
  /** Your best floor cleared (0 is the Entrance, -1 none) and best master floor (0 none). */
  cleared: { normal: number; master: number }
): DungeonPlan {
  const total = (level: number): number => steps.slice(0, level).reduce((a, b) => a + b, 0)
  const goals: DungeonPlan['goals'] = []
  const max = Math.min(50, steps.length)
  if (cata.level < max) goals.push({ id: 'cata', name: `Catacombs ${cata.level + 1}`, target: cata.level + 1, left: total(cata.level + 1) - cata.xp })
  if (cls && cls.level < max) goals.push({ id: 'class', name: `${cls.name} ${cls.level + 1}`, target: cls.level + 1, left: total(cls.level + 1) - cls.xp })
  if (cata.level < max - 1) goals.push({ id: 'cata50', name: `Catacombs ${max}`, target: max, left: total(max) - cata.xp })
  const floors = FLOOR_XP.filter((f, i) => (f.master ? cleared.normal >= 7 && i - 7 <= cleared.master + 1 : i <= cleared.normal + 1)).map((f) => ({
    ...f,
    runs: goals.map((g) => Math.max(1, Math.ceil(g.left / f.xp)))
  }))
  return { goals, floors }
}

// ---------- garden ----------

export interface GardenPlan {
  /** The 5 × 5 map: the barn in the middle, then each plot. */
  plots: { id: string; name: string; x: number; y: number; unlocked: boolean; cost: { item: string; amount: number } | null }[]
  /** The cheapest locked plot. */
  nextPlot: { name: string; item: string; amount: number } | null
  copper: number | null
  crops: { id: string; level: number; copperToMax: number }[]
  composter: { id: string; level: number; max: number; tip: string; next: { items: Record<string, number>; copper: number } | null }[]
  composterMatter: { organic: number; fuel: number; compost: number } | null
  visitors: { id: string; rarity: string; served: number; visits: number }[]
  /** Visitors waiting in the garden right now (when Hypixel last answered). */
  waiting: string[]
}

const PLOT_KIND = (id: string): string => id.replace(/_\d+$/, '')

export function gardenPlan(garden: Record<string, unknown>, member: Record<string, unknown>, x: PlannerExtras['garden']): GardenPlan {
  const unlocked = new Set(strs(garden.unlocked_plots_ids))
  const plots: GardenPlan['plots'] = []
  const owned: Record<string, number> = {}
  for (const id of unlocked) owned[PLOT_KIND(id)] = (owned[PLOT_KIND(id)] ?? 0) + 1
  let nextPlot: GardenPlan['nextPlot'] = null
  const rank = (c: { item: string; amount: number }): number => c.amount * (c.item === 'COMPOST' ? 1 : 160)
  for (const [id, p] of Object.entries(x.plots)) {
    const kind = PLOT_KIND(id)
    const cost = unlocked.has(id) ? null : (x.plotCosts[kind]?.[owned[kind] ?? 0] ?? null)
    plots.push({ id, name: p.name, x: p.x, y: p.y, unlocked: unlocked.has(id), cost })
    if (cost && (!nextPlot || rank(cost) < rank({ item: nextPlot.item, amount: nextPlot.amount }))) nextPlot = { name: p.name, ...cost }
  }
  const cropLevels = obj(garden.crop_upgrade_levels)
  const crops = Object.keys({
    WHEAT: 1,
    CARROT_ITEM: 1,
    POTATO_ITEM: 1,
    PUMPKIN: 1,
    MELON: 1,
    MUSHROOM_COLLECTION: 1,
    'INK_SACK:3': 1,
    CACTUS: 1,
    SUGAR_CANE: 1,
    NETHER_STALK: 1,
    ...cropLevels
  }).map((id) => {
    const level = num(cropLevels[id]) ?? 0
    return { id, level, copperToMax: x.cropUpgrades.slice(level).reduce((a, b) => a + b, 0) }
  })
  const cd = obj(garden.composter_data)
  const ups = obj(cd.upgrades)
  const composter = Object.entries(x.composter).map(([id, levels]) => {
    const level = num(ups[id]) ?? 0
    const max = Object.keys(levels).length
    const next = levels[String(level + 1)]
    const tip = stripColors((x.composterTips[id] ?? id).replace('{}', String(levels[String(level)]?.upgrade ?? 0)))
    return { id, level, max, tip, next: next ? { items: next.items, copper: next.copper } : null }
  })
  const cm = obj(garden.commission_data)
  const visits = obj(cm.visits)
  const completed = obj(cm.completed)
  const visitors = Object.entries(x.visitors).map(([id, rarity]) => ({ id, rarity, served: num(completed[id]) ?? 0, visits: num(visits[id]) ?? 0 }))
  return {
    plots,
    nextPlot,
    copper: num(obj(member.garden_player_data).copper),
    crops,
    composter,
    composterMatter: isObj(garden.composter_data) ? { organic: num(cd.organic_matter) ?? 0, fuel: num(cd.fuel_units) ?? 0, compost: num(cd.compost_items) ?? 0 } : null,
    visitors,
    waiting: Object.keys(obj(garden.active_commissions))
  }
}

// ---------- bestiary ----------

export interface BestiaryMob {
  name: string
  kills: number
  tier: number
  maxTier: number
  /** Kills for the next tier (null when maxed). */
  next: number | null
  /** Kills the current tier took (0 before tier 1). */
  from?: number
}

/** The mobs nearest their next bestiary tier, by how much of the gap is already done. */
export function bestiaryClosest(
  islands: readonly { island: string; mobs: readonly BestiaryMob[] }[],
  limit = 12
): (BestiaryMob & { island: string; left: number; share: number })[] {
  const all: (BestiaryMob & { island: string; left: number; share: number })[] = []
  for (const i of islands)
    for (const m of i.mobs) {
      if (m.next === null || m.tier >= m.maxTier) continue
      const left = m.next - m.kills
      // How far through this tier, so a tier that's nearly done comes first whatever its size.
      const from = m.from ?? 0
      all.push({ ...m, island: i.island, left, share: m.next > from ? (m.kills - from) / (m.next - from) : 0 })
    }
  return all.sort((a, b) => b.share - a.share || a.left - b.left).slice(0, limit)
}

// ---------- forge ----------

export interface ForgeSlot {
  slot: number
  id: string
  /** When it started and when it's ready (null when the item list doesn't know how long it takes). */
  start: number
  ready: number | null
}

/** Quick Forge takes 10% off, plus 0.5% a level, up to 30% at level 20. */
export const quickForge = (level: number): number => (level <= 0 ? 0 : level >= 20 ? 0.3 : 0.1 + 0.005 * level)

export function forgeSlots(member: Record<string, unknown>, seconds: (id: string) => number | null, quickForgeLevel: number): ForgeSlot[] {
  const out: ForgeSlot[] = []
  for (const [k, v] of Object.entries(obj(obj(member.forge).forge_processes))) {
    if (!k.startsWith('forge')) continue
    for (const p of Object.values(obj(v))) {
      const s = obj(p)
      const id = typeof s.id === 'string' ? s.id : ''
      const start = num(s.startTime)
      if (!id || start === null) continue
      const secs = seconds(id)
      out.push({ slot: num(s.slot) ?? out.length + 1, id, start, ready: secs === null ? null : start + secs * 1000 * (1 - quickForge(quickForgeLevel)) })
    }
  }
  return out.sort((a, b) => a.slot - b.slot)
}

// ---------- daily checklist ----------

export interface DailyTask {
  id: string
  name: string
  detail: string
  icon: string
  /** Filled from the profile: done or not without ticking (null for the ones you tick). */
  auto: boolean | null
}

/** The day's to-do list, from what the profile has unlocked. */
export function dailyTasks(v: {
  forge: ForgeSlot[]
  garden: { waiting: string[] } | null
  gardenUnlocked: boolean
  hotm: number
  dailyPowder: boolean
  crimson: boolean
  enchanting: number
  kuudra: boolean
  now: number
}): DailyTask[] {
  const t: DailyTask[] = []
  if (v.forge.length) {
    const ready = v.forge.filter((f) => f.ready !== null && f.ready <= v.now)
    t.push({
      id: 'forge',
      name: ready.length ? `Collect from the Forge (${ready.length} ready)` : 'The Forge',
      detail: ready.length ? 'Ready when Hypixel last answered.' : 'Nothing ready yet.',
      icon: 'ANVIL',
      auto: ready.length === 0
    })
  }
  if (v.gardenUnlocked)
    t.push({
      id: 'visitors',
      name: v.garden?.waiting.length ? `Serve Garden visitors (${v.garden.waiting.length} waiting)` : 'Serve Garden visitors',
      detail: v.garden?.waiting.length ? v.garden.waiting.map((w) => w.replace(/_/g, ' ')).join(', ') : 'Up to five can wait at once.',
      icon: 'GOLD_HOE',
      auto: null
    })
  if (v.hotm > 0) {
    t.push({ id: 'commissions', name: 'Dwarven Mines commissions', detail: 'The first four each day give double powder.', icon: 'DIAMOND_PICKAXE', auto: null })
    t.push({ id: 'puzzler', name: 'Puzzler', detail: 'His daily puzzle in the Dwarven Mines gives 1,000 Mithril Powder.', icon: 'BOOK', auto: null })
    t.push({ id: 'fetchur', name: 'Fetchur', detail: 'Bring him the item he asks for today.', icon: 'FLINT', auto: null })
  }
  if (v.dailyPowder) t.push({ id: 'powder', name: 'Daily Powder', detail: 'Your first ore of the day gives extra powder.', icon: 'MITHRIL_ORE', auto: null })
  if (v.enchanting >= 10)
    t.push({ id: 'experiments', name: 'Experimentation Table', detail: 'Superpairs, Chronomatron and Ultrasequencer, once each a day.', icon: 'ENCHANTMENT_TABLE', auto: null })
  if (v.crimson) {
    t.push({ id: 'faction', name: 'Crimson Isle daily quests', detail: 'Five faction quests for reputation.', icon: 'BLAZE_ROD', auto: null })
    t.push({ id: 'matriarch', name: 'Matriarch', detail: 'Heavy Pearls from the Matriarch, once a day.', icon: 'HEAVY_PEARL', auto: null })
  }
  if (v.kuudra) t.push({ id: 'kuudra', name: 'Kuudra', detail: 'A run or two for teeth and essence.', icon: 'KUUDRA_TEETH', auto: null })
  return t
}
