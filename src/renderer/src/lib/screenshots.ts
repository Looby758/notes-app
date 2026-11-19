import { isWithin, replacePrefix } from './paths'
import { compareEpisodes, episodeMatches, isEpisodeQuery, normalizeEpisode } from './episodes'

/**
 * The screenshot organiser: characters and episodes tagged on the pictures in your notes, kept in
 * .notesapp/screenshots.json (keyed by the picture's path, following renames) so the tags go with
 * your notes to other computers. The pictures themselves aren't changed.
 */

export interface PictureTags {
  characters: string[]
  /** "S4E9", "Issue 115". */
  episodes: string[]
}

export type ScreenshotsData = Record<string, PictureTags>

const MAX_TAG = 60

/** A character's name tidied up: spaces squashed, at most 60 characters. */
export const cleanCharacter = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG)

const uniq = (list: string[]): string[] => {
  const seen = new Set<string>()
  return list.filter((s) => s && !seen.has(s.toLowerCase()) && !!seen.add(s.toLowerCase()))
}

function readTags(raw: unknown): PictureTags | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const characters = uniq(list(r.characters).map(cleanCharacter))
  const episodes = uniq(list(r.episodes).map((e) => normalizeEpisode(e) ?? '')).sort(compareEpisodes)
  return characters.length || episodes.length ? { characters, episodes } : null
}

export function readScreenshots(text: string | null): ScreenshotsData {
  if (!text) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  const pictures = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).pictures : null
  if (!pictures || typeof pictures !== 'object') return {}
  const out: ScreenshotsData = {}
  for (const [path, tags] of Object.entries(pictures)) {
    const t = readTags(tags)
    if (t && path && !path.startsWith('/') && !path.split('/').includes('..')) out[path] = t
  }
  return out
}

export const screenshotsJson = (data: ScreenshotsData): string => JSON.stringify({ version: 1, pictures: data }, null, 2)

export const EMPTY_TAGS: PictureTags = { characters: [], episodes: [] }

/** Adds and takes away tags on some pictures. Pictures left with no tags are dropped from the file. */
export function changeTags(
  data: ScreenshotsData,
  paths: string[],
  change: { addCharacters?: string[]; removeCharacters?: string[]; addEpisodes?: string[]; removeEpisodes?: string[] }
): ScreenshotsData {
  const out = { ...data }
  const lower = (l: string[] | undefined): Set<string> => new Set((l ?? []).map((s) => s.toLowerCase()))
  const dropChars = lower(change.removeCharacters)
  const dropEps = new Set((change.removeEpisodes ?? []).map((e) => normalizeEpisode(e) ?? e))
  const addChars = (change.addCharacters ?? []).map(cleanCharacter).filter(Boolean)
  const addEps = (change.addEpisodes ?? []).map((e) => normalizeEpisode(e)).filter((e): e is string => !!e)
  for (const path of paths) {
    const cur = out[path] ?? EMPTY_TAGS
    const characters = uniq([...cur.characters.filter((c) => !dropChars.has(c.toLowerCase())), ...addChars])
    const episodes = uniq([...cur.episodes.filter((e) => !dropEps.has(e)), ...addEps]).sort(compareEpisodes)
    if (characters.length || episodes.length) out[path] = { characters, episodes }
    else delete out[path]
  }
  return out
}

/** Follows a rename or move of a picture or folder; null if nothing tagged was in it. */
export function remapScreenshots(data: ScreenshotsData, from: string, to: string): ScreenshotsData | null {
  if (!Object.keys(data).some((p) => isWithin(p, from))) return null
  const out: ScreenshotsData = {}
  for (const [p, t] of Object.entries(data)) out[isWithin(p, from) ? replacePrefix(p, from, to) : p] = t
  return out
}

/** Every character used, most-tagged first. */
export function allCharacters(data: ScreenshotsData): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const t of Object.values(data)) {
    for (const c of t.characters) {
      const found = counts.get(c.toLowerCase())
      if (found) found.count++
      else counts.set(c.toLowerCase(), { name: c, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Every episode used, in order. */
export function allEpisodes(data: ScreenshotsData): string[] {
  return [...new Set(Object.values(data).flatMap((t) => t.episodes))].sort(compareEpisodes)
}

/** "Maggie · S4E9", for showing beside a picture. */
export function tagSummary(t: PictureTags | undefined): string {
  return t ? [...t.characters, ...t.episodes].join(' · ') : ''
}

/**
 * Whether a picture matches a search. Each word (or "quoted phrase") must match its file name, a
 * character, or an episode: "maggie s4" is every picture of Maggie from season 4.
 */
export function pictureMatches(path: string, tags: PictureTags | undefined, query: string): boolean {
  const terms = (query.match(/"[^"]+"|\S+/g) ?? []).map((t) => t.replace(/"/g, '').toLowerCase()).filter(Boolean)
  if (!terms.length) return true
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  // "issue 115" is one term.
  const joined: string[] = []
  for (let i = 0; i < terms.length; i++) {
    if (/^(issue|twd)$/.test(terms[i]) && /^#?\d+$/.test(terms[i + 1] ?? '')) joined.push(`${terms[i]} ${terms[++i]}`)
    else joined.push(terms[i])
  }
  return joined.every((term) => {
    if (isEpisodeQuery(term)) return !!tags?.episodes.some((e) => episodeMatches(e, term)) || name.includes(term.replace(/\s/g, ''))
    return name.includes(term) || !!tags?.characters.some((c) => c.toLowerCase().includes(term))
  })
}
