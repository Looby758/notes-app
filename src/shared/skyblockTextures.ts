/**
 * Item pictures for the SkyBlock pages. The textures come from skyblock-assets
 * (github.com/skyblockstats/skyblock-assets, MIT, by mat): vanilla Minecraft textures plus several
 * SkyBlock texture packs (FurfSky Reborn, PacksHQ, Hypixel+…), each with a list of "matchers" that
 * say which picture an item gets from its Minecraft id, damage and SkyBlock NBT. This is a port of
 * its matching. Items no pack covers are usually player heads, drawn from their skin instead.
 */

export interface TextureMatcher {
  /** The picture's file name (without .png) in the pack's folder. */
  t: string
  m: {
    /** Minecraft item names it applies to ("diamond_sword"). */
    i?: string[]
    /** Damage value. */
    d?: number
    /** NBT it needs (ExtraAttributes.id, display.Name, display.Lore…), with pattern:/regex: values. */
    n?: Record<string, unknown>
    /** 'armor' entries are worn textures, not item pictures. */
    t?: string | null
  }
}

export interface TexturePack {
  id: string
  matchers: TextureMatcher[]
}

/** The packs Orbit offers, best known first, with roughly how much each downloads. Vanilla is always added last. */
export const TEXTURE_PACKS: { id: string; name: string; about: string; mb: number }[] = [
  { id: 'furfsky_reborn', name: 'FurfSky Reborn', about: 'The most popular SkyBlock pack: almost every item redrawn.', mb: 9.7 },
  { id: 'packshq', name: 'PacksHQ', about: 'Clean, close to vanilla.', mb: 5.5 },
  { id: 'hypixel+', name: 'Hypixel+', about: 'Mostly armour and tools.', mb: 1.1 },
  { id: 'rnbw', name: 'RNBW', about: 'Bright and colourful.', mb: 3.4 },
  { id: 'worlds_and_beyond', name: 'Worlds and Beyond', about: 'Fantasy style.', mb: 2.8 },
  { id: 'ectoplasm', name: 'Ectoplasm', about: 'Dungeon items.', mb: 1.5 },
  { id: 'furfsky', name: 'FurfSky (original)', about: 'The older FurfSky.', mb: 1.9 }
]
/** The plain Minecraft pictures, always downloaded, and the item list (a download that's mostly thrown away). */
export const VANILLA_MB = 4.8
export const ITEM_LIST_MB = 30
export const DEFAULT_PACKS = ['furfsky_reborn']

export interface SkyblockAddonState {
  state: 'missing' | 'installing' | 'ready'
  /** The SkyBlock packs installed (or being installed), best first. */
  packs: string[]
  /** What's happening now, while installing. */
  stage: string
  progress: number
  /** Megabytes on disk once installed. */
  mb: number
  error: string
  /** Changes whenever the item pictures do. */
  iconsVersion: number
}

export const TEXTURES_TAG = '2.0.11'
export const TEXTURES_BASE = `https://raw.githubusercontent.com/skyblockstats/skyblock-assets/${TEXTURES_TAG}`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const patternCache = new Map<string, RegExp | null>()
function patternOf(value: string): RegExp | null {
  let re = patternCache.get(value)
  if (re !== undefined) return re
  const esc = (s: string): string => s.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*')
  try {
    if (value.startsWith('ipattern:')) re = new RegExp(`^${esc(value.slice(9))}$`, 'is')
    else if (value.startsWith('pattern:')) re = new RegExp(`^${esc(value.slice(8))}$`, 's')
    else if (value.startsWith('iregex:')) re = new RegExp(`^${value.slice(7)}$`, 'i')
    else if (value.startsWith('regex:')) re = new RegExp(`^${value.slice(6)}$`)
    else re = null
  } catch {
    re = null
  }
  patternCache.set(value, re)
  return re
}

/** Whether `obj` has everything `check` asks for ('*' means any entry of a list). */
function partlyMatches(obj: unknown, check: Record<string, unknown>): boolean {
  for (const [key, want] of Object.entries(check)) {
    if (key === '*') {
      const list = Array.isArray(obj) ? obj : isObj(obj) ? Object.values(obj) : []
      if (!list.some((v) => (isObj(want) ? partlyMatches(v, want) : valueMatches(v, want)))) return false
      continue
    }
    const have = isObj(obj) || Array.isArray(obj) ? (obj as Record<string, unknown>)[key] : undefined
    if (isObj(want)) {
      if (!partlyMatches(have, want)) return false
    } else if (!valueMatches(have, want)) return false
  }
  return true
}

function valueMatches(have: unknown, want: unknown): boolean {
  if (have === want) return true
  if (typeof want === 'string') {
    const re = patternOf(want)
    if (re) return typeof have === 'string' || typeof have === 'number' ? re.test(String(have)) : false
  }
  if (typeof want === 'number' && typeof have === 'string') return Number(have) === want
  return false
}

export interface TextureQuery {
  /** Minecraft item name without "minecraft:" ("diamond_sword"). */
  id: string
  damage: number
  nbt: Record<string, unknown>
  /** The head's skin id, if it's a head (matched against matchers that name a skin). */
  skin?: string
}

type Entry = { m: TextureMatcher; n: number }
/** One Minecraft item's matchers: those naming a plain SkyBlock id are looked up by it, the rest are tried in turn. */
interface ItemMatchers {
  bySbId: Map<string, Entry[]>
  /** Head matchers that only name a skin, by skin id (so they match heads with the same skin from anywhere). */
  bySkin: Map<string, Entry[]>
  other: Entry[]
}

/** The skin id a matcher asks for, when all it asks for is one exact head skin. */
function matcherSkin(n: unknown): string {
  if (!isObj(n) || Object.keys(n).length !== 1 || !isObj(n.SkullOwner)) return ''
  const so = n.SkullOwner
  if (Object.keys(so).length !== 1 || !isObj(so.Properties) || !isObj(so.Properties.textures)) return ''
  const t = so.Properties.textures
  const first = isObj(t['0']) ? t['0'] : isObj(t['*']) ? t['*'] : null
  return first && typeof first.Value === 'string' && !isPattern(first.Value) ? skinFromValue(first.Value) : ''
}

/** Packs with their matchers grouped by Minecraft item and SkyBlock id, so finding a picture doesn't scan every matcher. */
export interface TextureIndex {
  packs: { id: string; byItem: Map<string, ItemMatchers>; any: Entry[] }[]
}

const isPattern = (v: string): boolean => /^(i?pattern|i?regex):/.test(v)

export function indexPacks(packs: readonly TexturePack[]): TextureIndex {
  return {
    packs: packs.map((p) => {
      const byItem = new Map<string, ItemMatchers>()
      const any: Entry[] = []
      p.matchers.forEach((m, n) => {
        if (!m?.m || m.m.t === 'armor') return
        const e = { m, n }
        if (!m.m.i) return void any.push(e)
        const ea = isObj(m.m.n) && isObj(m.m.n.ExtraAttributes) ? m.m.n.ExtraAttributes : null
        const sbId = ea && typeof ea.id === 'string' && !isPattern(ea.id) ? ea.id : null
        const skin = sbId === null ? matcherSkin(m.m.n) : ''
        for (const id of m.m.i) {
          let g = byItem.get(id)
          if (!g) byItem.set(id, (g = { bySbId: new Map(), bySkin: new Map(), other: [] }))
          if (skin) {
            const list = g.bySkin.get(skin) ?? []
            list.push(e)
            g.bySkin.set(skin, list)
          } else if (sbId === null) g.other.push(e)
          else {
            const list = g.bySbId.get(sbId) ?? []
            list.push(e)
            g.bySbId.set(sbId, list)
          }
        }
      })
      return { id: p.id, byItem, any }
    })
  }
}

/** "<pack>/<file>.png" for the first pack (in order) with a picture for this item, or null. */
export function findTexture(q: TextureQuery, packs: readonly TexturePack[] | TextureIndex): string | null {
  const index = Array.isArray(packs) ? indexPacks(packs) : (packs as TextureIndex)
  const ea = isObj(q.nbt.ExtraAttributes) ? q.nbt.ExtraAttributes : null
  const sbId = ea && typeof ea.id === 'string' ? ea.id : ''
  const skin = q.skin ?? ''
  const lists = index.packs.map((pack) => {
    const g = pack.byItem.get(q.id)
    if (!g && !pack.any.length) return []
    const bySkin = (skin && g?.bySkin.get(skin)) || []
    const all = [...(g?.bySbId.get(sbId) ?? []), ...bySkin, ...(g?.other ?? []), ...pack.any]
    return all.sort((a, b) => a.n - b.n).map((e) => ({ e, skinOnly: bySkin.includes(e) }))
  })
  for (const exact of [true, false]) {
    for (let i = 0; i < index.packs.length; i++) {
      for (const { e, skinOnly } of lists[i]) {
        const c = e.m.m
        const hasD = c.d !== undefined && c.d !== null
        // The second pass only needs the ones the damage ruled out.
        if (!exact && (!hasD || c.d === q.damage)) continue
        if (exact && hasD && c.d !== q.damage) continue
        if (!skinOnly && c.n && !partlyMatches(q.nbt, c.n)) continue
        return `${index.packs[i].id}/${e.m.t}.png`
      }
    }
  }
  return null
}

/**
 * The Minecraft item name and damage from what Hypixel or NEU give: a number from 1.8 ("276"), a
 * name ("minecraft:diamond_sword"), or a name with damage ("minecraft:dye:4"). `vanillaDamages`
 * turns texture-file names like "granite" into "stone:1".
 */
export function minecraftItem(raw: string | number, damage: number, ids: Record<string, string>, vanillaDamages: Record<string, string> = {}): { id: string; damage: number } {
  let id = String(raw ?? '')
  if (/^\d+$/.test(id)) id = ids[id] ?? id
  id = id.replace(/^minecraft:/, '')
  const m = /^(.+):(\d+)$/.exec(id)
  if (m) return { id: m[1], damage: Number(m[2]) }
  const vd = vanillaDamages[id]
  if (vd) {
    const [vid, d] = vd.split(':')
    return { id: vid.replace(/^minecraft:/, ''), damage: Number(d) || 0 }
  }
  return { id, damage: damage || 0 }
}

/** The skin texture id from a player head's NBT (SkullOwner.Properties.textures[0].Value), or ''. */
export function skinFromValue(value: string): string {
  try {
    const json = JSON.parse(atob(value)) as { textures?: { SKIN?: { url?: string } } }
    const url = json.textures?.SKIN?.url ?? ''
    const m = /\/texture\/([0-9a-f]{20,80})$/i.exec(url)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

/** The skin id from a head item's tag (parsed NBT). */
export function skinFromTag(tag: unknown): string {
  if (!isObj(tag) || !isObj(tag.SkullOwner) || !isObj(tag.SkullOwner.Properties)) return ''
  const textures = tag.SkullOwner.Properties.textures
  const first = Array.isArray(textures) ? textures[0] : null
  return isObj(first) && typeof first.Value === 'string' ? skinFromValue(first.Value) : ''
}

/** The skin id from NEU's nbttag text (SNBT), or ''. */
export function skinFromSnbt(snbt: string): string {
  const m = /Value:\\?"([A-Za-z0-9+/=]{40,})\\?"/.exec(snbt)
  return m ? skinFromValue(m[1]) : ''
}

/** How an item is drawn: a texture from a pack, a head from a skin, or neither (initials). */
export interface ItemIcon {
  tex?: string
  skin?: string
}

/** What a picture is worked out from, kept small: Minecraft item, damage, head skin, name and lore. */
export interface McItem {
  /** Minecraft item name ("diamond_sword"). */
  i: string
  d: number
  /** Head skin id, if a player head. */
  s?: string
  /** ExtraAttributes.id, for the packs' matchers. */
  x?: string
  name?: string
  lore?: string[]
  /** Only a pack picture will do: NEU now lists some items as plain paper with a new-style model, which plain Minecraft would draw as paper. */
  p?: 1
}

/** The Minecraft side of a NEU item file (itemid, damage, nbttag, displayname, lore). */
export function mcItemOfNeu(file: unknown, ids: Record<string, string>, vanillaDamages: Record<string, string>): McItem | null {
  if (!isObj(file) || typeof file.internalname !== 'string') return null
  const { id, damage } = minecraftItem(String(file.itemid ?? ''), Number(file.damage) || 0, ids, vanillaDamages)
  if (!id) return null
  const nbt = typeof file.nbttag === 'string' ? file.nbttag : ''
  const x = /ExtraAttributes:\{[^]*?\bid:\\?"([^"\\]+)\\?"/.exec(nbt)?.[1]
  // Items NEU now lists as paper with a 1.21 model were heads in 1.8, which is what the packs match.
  const modern = id === 'paper' && /ItemModel:/.test(nbt)
  const out: McItem = modern ? { i: 'skull', d: 3, p: 1 } : { i: id, d: damage }
  const skin = nbt ? skinFromSnbt(nbt) : ''
  if (skin) out.s = skin
  if (x) out.x = x
  if (typeof file.displayname === 'string') out.name = file.displayname
  if (Array.isArray(file.lore)) out.lore = file.lore.map(String)
  return out
}

/** The picture for an item: a texture from the packs if one matches, else its head skin, else nothing. */
export function iconOf(mc: McItem, index: TextureIndex): ItemIcon {
  const nbt: Record<string, unknown> = { ExtraAttributes: { id: mc.x ?? '' }, display: { Name: mc.name ?? '', Lore: mc.lore ?? [] } }
  const icon = iconOfNbt(mc.i, mc.d, nbt, mc.s ?? '', index)
  return mc.p && icon.tex?.startsWith('vanilla/') ? {} : icon
}

/**
 * Packs come first, then (for heads) the skin, then vanilla: a SkyBlock pack's picture for a head
 * item beats the head, and the head beats vanilla's plain Steve head.
 */
export function iconOfNbt(id: string, damage: number, nbt: Record<string, unknown>, skin: string, index: TextureIndex): ItemIcon {
  const packs = index.packs.filter((p) => p.id !== 'vanilla')
  const tex = findTexture({ id, damage, nbt, skin }, { packs })
  if (tex) return { tex }
  if (skin) return { skin }
  const van = index.packs.find((p) => p.id === 'vanilla')
  const v = van ? findTexture({ id, damage, nbt, skin }, { packs: [van] }) : null
  return v ? { tex: v } : {}
}
