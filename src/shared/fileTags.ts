/**
 * Colour tags and favourite folders in the Files tab. Any file or folder can have one or more
 * colour tags (like Finder's), each colour can be given a name ("School"), and favourite folders
 * sit at the top of the Files sidebar. Kept by full path in file-tags.json in the settings folder
 * (see main/fileTags.ts), and they follow a file when Orbit renames or moves it.
 */

export const TAG_COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey'] as const
export type TagColour = (typeof TAG_COLOURS)[number]

/** What each colour is called until it's given a name of its own. */
export const TAG_DEFAULT_NAMES: Record<TagColour, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  grey: 'Grey'
}

/** The dots' colours (the same in every theme, so a colour always means the same thing). */
export const TAG_HEX: Record<TagColour, string> = {
  red: '#ef5350',
  orange: '#ffa040',
  yellow: '#f5d142',
  green: '#4cc46c',
  blue: '#4a9eff',
  purple: '#b678f0',
  grey: '#9aa0a6'
}

export interface FileTagStore {
  /** Names given to colours; a colour that isn't here uses its default name. */
  labels: Partial<Record<TagColour, string>>
  /** Full path → its colours, in the order of TAG_COLOURS. */
  items: Record<string, TagColour[]>
  /** Favourite folders, in the order shown. */
  favourites: string[]
}

export const emptyTagStore = (): FileTagStore => ({ labels: {}, items: {}, favourites: [] })

export const isTagColour = (c: unknown): c is TagColour => typeof c === 'string' && (TAG_COLOURS as readonly string[]).includes(c)

export const tagName = (store: Pick<FileTagStore, 'labels'>, c: TagColour): string => store.labels[c]?.trim() || TAG_DEFAULT_NAMES[c]

/** Repairs a hand-edited or damaged file instead of losing everything in it. */
export function cleanTagStore(raw: unknown): FileTagStore {
  const out = emptyTagStore()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const labels = (r.labels && typeof r.labels === 'object' ? r.labels : {}) as Record<string, unknown>
  for (const c of TAG_COLOURS) if (typeof labels[c] === 'string' && (labels[c] as string).trim()) out.labels[c] = (labels[c] as string).trim().slice(0, 40)
  const items = (r.items && typeof r.items === 'object' ? r.items : {}) as Record<string, unknown>
  for (const [path, list] of Object.entries(items)) {
    if (!Array.isArray(list)) continue
    const colours = TAG_COLOURS.filter((c) => list.includes(c))
    if (colours.length) out.items[path] = colours
  }
  if (Array.isArray(r.favourites)) out.favourites = [...new Set(r.favourites.filter((p): p is string => typeof p === 'string' && !!p))]
  return out
}

/** Turns one colour on or off for each path. Returns a new store. */
export function setTag(store: FileTagStore, paths: string[], colour: TagColour, on: boolean): FileTagStore {
  const items = { ...store.items }
  for (const p of paths) {
    const now = new Set(items[p] ?? [])
    if (on) now.add(colour)
    else now.delete(colour)
    const list = TAG_COLOURS.filter((c) => now.has(c))
    if (list.length) items[p] = list
    else delete items[p]
  }
  return { ...store, items }
}

/** Paths compared the way Windows and a Mac do (capitals don't matter), with either slash. */
const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

/** `path` with `from` (or a folder above it) swapped for `to`, or null when it isn't under `from`. */
export function rebase(path: string, from: string, to: string): string | null {
  const a = norm(path)
  const b = norm(from)
  if (a === b) return to
  if (!a.startsWith(`${b}/`)) return null
  const rest = path.slice(from.replace(/[\\/]+$/, '').length)
  return to.replace(/[\\/]+$/, '') + rest
}

/** After a rename or move: tags (and favourites) on it, and on anything inside it, go with it. */
export function moveInStore(store: FileTagStore, from: string, to: string): FileTagStore {
  let changed = false
  const items: Record<string, TagColour[]> = {}
  for (const [p, list] of Object.entries(store.items)) {
    const next = rebase(p, from, to)
    if (next !== null) changed = true
    items[next ?? p] = list
  }
  const favourites = store.favourites.map((p) => {
    const next = rebase(p, from, to)
    if (next !== null) changed = true
    return next ?? p
  })
  return changed ? { ...store, items, favourites } : store
}

/** After a copy: the copy gets the same tags (as Finder does). */
export function copyInStore(store: FileTagStore, from: string, to: string): FileTagStore {
  let items: Record<string, TagColour[]> | null = null
  for (const [p, list] of Object.entries(store.items)) {
    const next = rebase(p, from, to)
    if (next === null) continue
    items ??= { ...store.items }
    items[next] = list
  }
  return items ? { ...store, items } : store
}

/** How many items have each colour. */
export function tagCounts(store: FileTagStore): Record<TagColour, number> {
  const counts = Object.fromEntries(TAG_COLOURS.map((c) => [c, 0])) as Record<TagColour, number>
  for (const list of Object.values(store.items)) for (const c of list) counts[c]++
  return counts
}

/** The colours every one of these paths has (so the menu can show them ticked). */
export function sharedTags(store: FileTagStore, paths: string[]): TagColour[] {
  if (!paths.length) return []
  return TAG_COLOURS.filter((c) => paths.every((p) => store.items[p]?.includes(c)))
}
