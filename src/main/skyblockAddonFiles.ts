import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { iconOf, iconOfNbt, indexPacks, mcItemOfNeu, minecraftItem, skinFromTag, type ItemIcon, type McItem, type TextureIndex, type TexturePack } from '@shared/skyblockTextures'

/**
 * Where the SkyBlock add-on's files live, whether it's installed, and item pictures worked out from
 * them. Kept apart from skyblockAddon.ts (the download) so the planner and session summary can ask
 * "is it installed?" without importing the downloader.
 */

export interface AddonManifest {
  version: 1
  /** The SkyBlock texture packs downloaded, best first (vanilla is always there too). */
  packs: string[]
  at: number
  bytes: number
}

let manifest: AddonManifest | null | undefined
let index: TextureIndex | null = null
let neuIcons: Record<string, ItemIcon> | null = null
let modelsBySbId: Record<string, string> | null = null
let lookups: { ids: Record<string, string>; damages: Record<string, string> } | null = null
const listeners: (() => void)[] = []
/** Goes up whenever the pictures may have changed, so the page knows to ask again. */
export let iconsVersion = 0

export const addonDir = (): string => join(app.getPath('userData'), 'skyblock-addon')
export const addonPath = (...parts: string[]): string => join(addonDir(), ...parts)

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), 'utf8')
  renameSync(`${file}.tmp`, file)
}

export function addonManifest(): AddonManifest | null {
  if (manifest !== undefined) return manifest
  const m = readJson<AddonManifest | null>(addonPath('manifest.json'), null)
  manifest = m && m.version === 1 && Array.isArray(m.packs) ? m : null
  return manifest
}

/** Whether the SkyBlock add-on is downloaded. Everything SkyBlock in Orbit stays off until it is. */
export const skyblockAddonReady = (): boolean => !!addonManifest()

export function setAddonManifest(m: AddonManifest | null): void {
  manifest = m
  index = null
  neuIcons = null
  lookups = null
  modelsBySbId = null
  iconsVersion++
  rmSync(addonPath('icons.json'), { force: true })
  if (m) {
    mkdirSync(addonDir(), { recursive: true })
    writeJson(addonPath('manifest.json'), m)
  }
  for (const fn of listeners) fn()
}

/** Called when the add-on is installed, removed or its packs change. */
export const onAddonChanged = (fn: () => void): void => void listeners.push(fn)

function getLookups(): { ids: Record<string, string>; damages: Record<string, string> } {
  if (!lookups) lookups = { ids: readJson(addonPath('data', 'minecraft_ids.json'), {}), damages: readJson(addonPath('data', 'vanilla_damages.json'), {}) }
  return lookups
}

function getIndex(): TextureIndex | null {
  const m = addonManifest()
  if (!m) return null
  if (!index) {
    const packs: TexturePack[] = []
    for (const id of [...m.packs, 'vanilla']) {
      const file = readJson<{ matchers?: TexturePack['matchers']; models?: Record<string, string> } | null>(addonPath('matchers', `${id}.json`), null)
      if ((file?.matchers || file?.models) && existsSync(addonPath('textures', id))) packs.push({ id, matchers: file.matchers ?? [], models: file.models })
    }
    index = indexPacks(packs)
    const custom = customPack()
    if (custom) index.vanillaOverride = new Set(custom.files)
  }
  return index
}

/** Your own Minecraft pack, used in place of plain Minecraft's pictures (see skyblockVanillaPack.ts). */
export interface CustomPack {
  name: string
  /** The plain-Minecraft pictures it replaces, saved as textures/custom/<name>.png. */
  files: string[]
  at: number
}

export function customPack(): CustomPack | null {
  const c = readJson<CustomPack | null>(addonPath('custom.json'), null)
  return c && Array.isArray(c.files) && existsSync(addonPath('textures', 'custom')) ? c : null
}

/** The pictures changed without a new download (your own pack added or taken away). */
export function picturesChanged(): void {
  index = null
  neuIcons = null
  iconsVersion++
  rmSync(addonPath('icons.json'), { force: true })
  for (const fn of listeners) fn()
}

/** Keep the Minecraft side of every NEU item (for pictures), from the item list download. */
export function saveNeuPictures(files: unknown[]): void {
  if (!existsSync(addonDir())) return
  lookups = null
  const { ids, damages } = getLookups()
  const out: Record<string, McItem> = {}
  for (const f of files) {
    const mc = mcItemOfNeu(f, ids, damages)
    if (mc) out[(f as { internalname: string }).internalname] = mc
  }
  writeJson(addonPath('neu-items.json'), out)
  neuIcons = null
  modelsBySbId = null
  rmSync(addonPath('icons.json'), { force: true })
  iconsVersion++
  for (const fn of listeners) fn()
}

/** NEU item id → picture, for the planner's tree, missing accessories, collections and the rest. */
export function neuItemIcons(): Record<string, ItemIcon> {
  if (neuIcons) return neuIcons
  const m = addonManifest()
  if (!m) return {}
  // Working them out takes a moment, so they're kept until the packs or item list change.
  const saved = readJson<{ at: number; icons: Record<string, ItemIcon> } | null>(addonPath('icons.json'), null)
  if (saved && saved.at === m.at) return (neuIcons = saved.icons)
  const idx = getIndex()
  if (!idx) return {}
  const items = readJson<Record<string, McItem>>(addonPath('neu-items.json'), {})
  const out: Record<string, ItemIcon> = {}
  for (const [id, mc] of Object.entries(items)) {
    const icon = iconOf(mc, idx)
    if (icon.tex || icon.skin) out[id] = icon
  }
  neuIcons = out
  try {
    writeJson(addonPath('icons.json'), { at: m.at, icons: out })
  } catch {
    // Worked out again next time.
  }
  return out
}

/** SkyBlock id → Hypixel's item model, from the NEU list (Hypixel's API gives 1.8 items without one). */
function modelOf(sbId: string): string | undefined {
  if (!modelsBySbId) {
    modelsBySbId = {}
    for (const mc of Object.values(readJson<Record<string, McItem>>(addonPath('neu-items.json'), {}))) if (mc.x && mc.m) modelsBySbId[mc.x] = mc.m
  }
  return modelsBySbId[sbId]
}

/** The picture for one slot of a Hypixel item list ({ id: 276, Damage: 0, tag: {...} }). */
export function slotIcon(slot: Record<string, unknown>): ItemIcon | undefined {
  const idx = getIndex()
  if (!idx) return undefined
  const { ids, damages } = getLookups()
  const raw = slot.id as string | number
  const { id, damage } = minecraftItem(raw, Number(slot.Damage) || 0, ids, damages)
  const tag = (slot.tag && typeof slot.tag === 'object' ? slot.tag : {}) as Record<string, unknown>
  const extra = tag.ExtraAttributes && typeof tag.ExtraAttributes === 'object' ? (tag.ExtraAttributes as Record<string, unknown>) : {}
  const model = typeof tag.ItemModel === 'string' ? tag.ItemModel : typeof extra.id === 'string' ? modelOf(extra.id) : undefined
  const icon = iconOfNbt(id, damage, tag, skinFromTag(tag), idx, model)
  return icon.tex || icon.skin ? icon : undefined
}
