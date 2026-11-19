import { isWithin, replacePrefix } from './paths'

/**
 * Video projects: everything for one YouTube video in one place (its script note, research notes,
 * pictures, recordings and thumbnail ideas). Kept in the notes folder (.notesapp/videos.json) so
 * they follow your notes to other computers, like stars and flashcards. The notes and files
 * themselves stay where they are in your notes; a project only points at them.
 *
 * A project's id is a random string that never changes, so other parts of Orbit (publishing,
 * the pipeline board, the studio) can key their own data by it. Fields this version of Orbit
 * doesn't know about are kept as they are, so a newer Orbit's additions survive an older one.
 */

/** Where a video is in the pipeline, in order. */
export const VIDEO_STAGES = [
  { id: 'idea', label: 'Idea' },
  { id: 'research', label: 'Research' },
  { id: 'script', label: 'Script' },
  { id: 'recorded', label: 'Recorded' },
  { id: 'edited', label: 'Edited' },
  { id: 'uploaded', label: 'Uploaded' }
] as const

export type VideoStage = (typeof VIDEO_STAGES)[number]['id']

const STAGE_IDS: readonly string[] = VIDEO_STAGES.map((s) => s.id)
export const isVideoStage = (v: unknown): v is VideoStage => typeof v === 'string' && STAGE_IDS.includes(v)

/** What a thing in a project is for. A thumbnail idea is a picture or a line of text. */
export type VideoItemKind = 'research' | 'image' | 'recording' | 'thumbnail'

const ITEM_KINDS: readonly string[] = ['research', 'image', 'recording', 'thumbnail']

export interface VideoItem {
  id: string
  kind: VideoItemKind
  /** A note or file in the notes folder. */
  path?: string
  /** A written idea (thumbnail ideas only). */
  text?: string
  added: number
}

export interface VideoProject {
  id: string
  title: string
  stage: VideoStage
  /** A line or two about what the video is. */
  summary: string
  /** The script note. */
  script: string | null
  /** The project's own folder in your notes, where new script and research notes go (made when first needed). */
  folder: string | null
  items: VideoItem[]
  created: number
  updated: number
  /** Anything else (from a newer Orbit), kept as it was. */
  [more: string]: unknown
}

/** A quickly jotted idea for a future video. */
export interface VideoIdea {
  id: string
  text: string
  created: number
}

export interface VideosData {
  projects: VideoProject[]
  ideas: VideoIdea[]
}

export const emptyVideos = (): VideosData => ({ projects: [], ideas: [] })

export const newVideoId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const MAX_TITLE = 120

/** The folder new video projects go in. */
export const VIDEOS_FOLDER = 'Videos'

const str = (v: unknown): v is string => typeof v === 'string'
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
/** A path inside the notes folder: no backslashes, no "..", not absolute. */
const cleanPath = (v: unknown): string | null =>
  str(v) && v && v.length < 1000 && !v.startsWith('/') && !v.includes('\\') && !v.split('/').some((p) => !p || p === '..') ? v : null

function readItem(raw: unknown): VideoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!str(r.id) || !str(r.kind) || !ITEM_KINDS.includes(r.kind)) return null
  const kind = r.kind as VideoItemKind
  const path = cleanPath(r.path)
  const text = str(r.text) ? r.text.slice(0, 500) : undefined
  if (!path && !(kind === 'thumbnail' && text?.trim())) return null
  return { id: r.id, kind, ...(path ? { path } : { text }), added: num(r.added, 0) }
}

function readProject(raw: unknown): VideoProject | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!str(r.id) || !r.id) return null
  const items = Array.isArray(r.items) ? r.items.map(readItem).filter((i): i is VideoItem => !!i) : []
  return {
    ...r,
    id: r.id,
    title: str(r.title) ? r.title.slice(0, MAX_TITLE) : '',
    stage: isVideoStage(r.stage) ? r.stage : 'idea',
    summary: str(r.summary) ? r.summary.slice(0, 2000) : '',
    script: cleanPath(r.script),
    folder: cleanPath(r.folder),
    items,
    created: num(r.created, 0),
    updated: num(r.updated, num(r.created, 0))
  }
}

function readIdea(raw: unknown): VideoIdea | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!str(r.id) || !str(r.text) || !r.text.trim()) return null
  return { id: r.id, text: r.text.slice(0, 1000), created: num(r.created, 0) }
}

/** Reads videos.json (anything broken is left out rather than failing the lot). */
export function readVideos(text: string | null): VideosData {
  if (!text) return emptyVideos()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyVideos()
  }
  if (!raw || typeof raw !== 'object') return emptyVideos()
  const r = raw as Record<string, unknown>
  const seen = new Set<string>()
  const projects = (Array.isArray(r.projects) ? r.projects : [])
    .map(readProject)
    .filter((p): p is VideoProject => !!p && !seen.has(p.id) && !!seen.add(p.id))
  const ideas = (Array.isArray(r.ideas) ? r.ideas : []).map(readIdea).filter((i): i is VideoIdea => !!i)
  return { projects, ideas }
}

export const videosJson = (data: VideosData): string => JSON.stringify({ version: 1, projects: data.projects, ideas: data.ideas }, null, 2)

/** Every note and file a project points at. */
export function projectPaths(p: VideoProject): string[] {
  const out = p.script ? [p.script] : []
  for (const i of p.items) if (i.path) out.push(i.path)
  return out
}

/**
 * Follows a rename or move of `from` (a note, file or folder) to `to`. Returns the projects with
 * paths updated, or null if none of them pointed inside it.
 */
export function remapProjects(projects: VideoProject[], from: string, to: string): VideoProject[] | null {
  const hit = (p: string | null | undefined): boolean => !!p && isWithin(p, from)
  if (!projects.some((p) => hit(p.script) || hit(p.folder) || p.items.some((i) => hit(i.path)))) return null
  const move = (p: string): string => replacePrefix(p, from, to)
  return projects.map((p) =>
    hit(p.script) || hit(p.folder) || p.items.some((i) => hit(i.path))
      ? {
          ...p,
          script: p.script && move(p.script),
          folder: p.folder && move(p.folder),
          items: p.items.map((i) => (i.path && hit(i.path) ? { ...i, path: move(i.path) } : i))
        }
      : p
  )
}

/** A title made safe to be a folder name. */
export function folderName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
  return clean || 'Untitled video'
}

/** A folder for a new project under Videos/, not one another project already uses. */
export function projectFolderFor(title: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  const base = `${VIDEOS_FOLDER}/${folderName(title)}`
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!used.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`
}

/** Whether a file can go in a section. */
export function fitsSection(kind: VideoItemKind | 'script', path: string, fileKind: (p: string) => string): boolean {
  const k = /\.md$/i.test(path) ? 'note' : fileKind(path)
  if (kind === 'script' || kind === 'research') return k === 'note'
  if (kind === 'image' || kind === 'thumbnail') return k === 'image'
  return k === 'audio' || k === 'video'
}

/** Counts shown on a project's card. */
export function projectCounts(p: VideoProject): Record<VideoItemKind, number> {
  const out: Record<VideoItemKind, number> = { research: 0, image: 0, recording: 0, thumbnail: 0 }
  for (const i of p.items) out[i.kind]++
  return out
}
