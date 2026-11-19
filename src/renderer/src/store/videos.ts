import { create } from 'zustand'
import {
  emptyVideos,
  findMovedFolder,
  ideaToProject,
  shortIdea,
  type VideoIdea,
  isDayKey,
  stageLabel,
  uploadDateOf,
  type VideoStage,
  MAX_TITLE,
  newVideoId,
  projectFolderFor,
  readVideos,
  remapProjects,
  videosJson,
  type VideoItem,
  type VideoItemKind,
  type VideoProject,
  type VideosData
} from '../lib/videos'
import { recordUndo } from '../lib/undo'
import { isWithin, replacePrefix } from '../lib/paths'
import { dayKey } from '../lib/dates'
import type { FileNode } from '@shared/types'
import { setPrefsQuietly, usePrefs } from './prefs'
import { notify } from './notify'

/**
 * Video projects. Saved in the vault (.notesapp/videos.json) so they follow your notes to other
 * computers via Google Drive. Every change can be undone with Ctrl+Z (outside a text box).
 */
export const useVideos = create<VideosData & { loaded: boolean; selected: string | null; ideaFocus: number }>(() => ({ ...emptyVideos(), loaded: false, selected: null, ideaFocus: 0 }))

const FILE = 'videos.json'

/** Bumped when videos.json is read again (another notes folder): older undo steps no longer fit. */
let generation = 0

export async function loadVideos(): Promise<void> {
  generation++
  useVideos.setState({ ...emptyVideos(), loaded: false, selected: null })
  try {
    useVideos.setState({ ...readVideos(await window.api.readAppData(FILE)), loaded: true })
  } catch {
    // unreadable file: start empty rather than failing
    useVideos.setState({ loaded: true })
  }
}

/** Makes sure videos.json has been read (Ctrl+K can add things before the page is opened). */
export async function ensureVideos(): Promise<void> {
  if (!useVideos.getState().loaded) await loadVideos()
}

let writing = false
let again = false

/** Writes the file, one write at a time. */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  const { projects, ideas } = useVideos.getState()
  window.api
    .writeAppData(FILE, videosJson({ projects, ideas }))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function write(change: Partial<VideosData>): void {
  useVideos.setState(change)
  persist()
}

/** Makes a change that Ctrl+Z can undo. Changes with the same `mergeKey` a moment apart (typing) undo as one. */
function save(change: Partial<VideosData>, label: string, mergeKey?: string): void {
  const state = useVideos.getState()
  const before = Object.fromEntries(Object.keys(change).map((k) => [k, state[k as keyof VideosData]])) as Partial<VideosData>
  const at = generation
  const swap = (to: Partial<VideosData>) => (): void => {
    if (at !== generation) throw new Error('Your video projects were reloaded since, so that can’t be undone.')
    write(to)
  }
  write(change)
  recordUndo({ label, mergeKey: mergeKey && `videos:${mergeKey}`, undo: swap(before), redo: swap(change) })
}

const named = (p: VideoProject | undefined): string => (p?.title.trim() ? `“${p.title.trim()}”` : 'a video')

export const projectById = (id: string): VideoProject | undefined => useVideos.getState().projects.find((p) => p.id === id)

/** Changes one project (and marks it updated). */
function change(id: string, update: (p: VideoProject) => Partial<VideoProject>, label: (p: VideoProject) => string, mergeKey?: string): void {
  const { projects } = useVideos.getState()
  const old = projects.find((p) => p.id === id)
  if (!old) return
  save({ projects: projects.map((p) => (p.id === id ? { ...p, ...update(p), updated: Date.now() } : p)) }, label(old), mergeKey)
}

export function selectProject(id: string | null): void {
  useVideos.setState({ selected: id })
}

/** Makes a new project (at the top of the list) and returns it. */
export function createProject(title: string, extra: Partial<VideoProject> = {}): VideoProject {
  const now = Date.now()
  const made: VideoProject = { id: newVideoId(), title: title.trim().slice(0, MAX_TITLE), stage: 'idea', summary: '', script: null, folder: null, items: [], created: now, updated: now, ...extra }
  save({ projects: [made, ...useVideos.getState().projects] }, `Made the video ${named(made)}`)
  return made
}

export function renameProject(id: string, title: string): void {
  change(id, () => ({ title: title.slice(0, MAX_TITLE) }), (p) => `Renamed ${named(p)}`, `title:${id}`)
}

export function setSummary(id: string, summary: string): void {
  change(id, () => ({ summary: summary.slice(0, 2000) }), (p) => `Changed what ${named(p)} is about`, `summary:${id}`)
}

/** Deletes a project. Its notes and files stay where they are. */
export function deleteProject(id: string): void {
  const { projects, selected } = useVideos.getState()
  const gone = projects.find((p) => p.id === id)
  if (!gone) return
  if (selected === id) selectProject(null)
  save({ projects: projects.filter((p) => p.id !== id) }, `Deleted the video ${named(gone)}`)
}

/** Puts a deleted project back as it was (from Recently deleted). */
export function putBackProject(p: VideoProject): void {
  save({ projects: [p, ...useVideos.getState().projects.filter((q) => q.id !== p.id)] }, `Brought back the video ${named(p)}`)
}

// ---------- the idea inbox ----------

/** Jots an idea for a future video (newest first). */
export function addIdea(text: string): VideoIdea | null {
  const clean = text.trim().slice(0, 1000)
  if (!clean) return null
  const made: VideoIdea = { id: newVideoId(), text: clean, created: Date.now() }
  save({ ideas: [made, ...useVideos.getState().ideas] }, `Jotted the video idea “${shortIdea(clean)}”`)
  return made
}

export function updateIdea(id: string, text: string): void {
  const { ideas } = useVideos.getState()
  const old = ideas.find((i) => i.id === id)
  if (!old || !text.trim()) return
  save({ ideas: ideas.map((i) => (i.id === id ? { ...i, text: text.slice(0, 1000) } : i)) }, `Changed the video idea “${shortIdea(old.text)}”`, `idea:${id}`)
}

export function deleteIdea(id: string): void {
  const { ideas } = useVideos.getState()
  const gone = ideas.find((i) => i.id === id)
  if (!gone) return
  save({ ideas: ideas.filter((i) => i.id !== id) }, `Deleted the video idea “${shortIdea(gone.text)}”`)
}

/** Opens the Videos page's list with the idea box ready to type in. */
export function focusIdeaBox(): void {
  useVideos.setState((s) => ({ selected: null, ideaFocus: s.ideaFocus + 1 }))
}

/** Turns an idea into a video project (at the Idea stage), taking it out of the inbox, as one Ctrl+Z step. */
export function promoteIdea(id: string): VideoProject | null {
  const { ideas, projects } = useVideos.getState()
  const idea = ideas.find((i) => i.id === id)
  if (!idea) return null
  const { title, summary } = ideaToProject(idea.text)
  const now = Date.now()
  const made: VideoProject = { id: newVideoId(), title, stage: 'idea', summary, script: null, folder: null, items: [], created: now, updated: now }
  save({ ideas: ideas.filter((i) => i.id !== id), projects: [made, ...projects] }, `Made the video “${shortIdea(title)}” from an idea`)
  return made
}

/**
 * Moves a video along the pipeline. Marking it uploaded with no date puts it on the calendar for
 * today; moving it back off Uploaded puts back the day it was planned for (or none).
 */
export function setStage(id: string, stage: VideoStage): void {
  const p = projectById(id)
  if (!p || p.stage === stage) return
  const today = dayKey(new Date())
  change(
    id,
    (q) => {
      if (stage === 'uploaded') return { stage, plannedDate: uploadDateOf(q), uploadDate: uploadDateOf(q) ?? today }
      if (q.stage === 'uploaded' && q.plannedDate !== undefined) return { stage, plannedDate: undefined, uploadDate: q.plannedDate ?? undefined }
      return { stage }
    },
    (q) => `Moved ${named(q)} to ${stageLabel(stage)}`
  )
}

/** The day it's planned to go up (or went up); null clears it. */
export function setUploadDate(id: string, date: string | null): void {
  if (date !== null && !isDayKey(date)) return
  change(id, () => ({ uploadDate: date ?? undefined }), (q) => (date ? `Set the upload date for ${named(q)}` : `Cleared the upload date for ${named(q)}`), `upload:${id}`)
}

export function setScript(id: string, path: string | null): void {
  change(id, () => ({ script: path }), (p) => (path ? `Set the script for ${named(p)}` : `Unlinked the script from ${named(p)}`))
}

/** Adds notes or files to a section (ones already in it are skipped). Returns how many were added. */
export function addItems(id: string, kind: VideoItemKind, paths: string[]): number {
  const p = projectById(id)
  if (!p) return 0
  const have = new Set(p.items.filter((i) => i.kind === kind).map((i) => i.path))
  const now = Date.now()
  const fresh = [...new Set(paths)].filter((path) => !have.has(path)).map((path): VideoItem => ({ id: newVideoId(), kind, path, added: now }))
  if (!fresh.length) return 0
  const what = { research: 'research note', image: 'picture', recording: 'recording', thumbnail: 'thumbnail idea' }[kind]
  change(id, (q) => ({ items: [...q.items, ...fresh] }), (q) => `Added ${fresh.length === 1 ? `a ${what}` : `${fresh.length} ${what}s`} to ${named(q)}`)
  return fresh.length
}

/** A written thumbnail idea. */
export function addThumbnailText(id: string, text: string): void {
  const clean = text.trim().slice(0, 500)
  if (!clean) return
  change(id, (q) => ({ items: [...q.items, { id: newVideoId(), kind: 'thumbnail', text: clean, added: Date.now() }] }), (q) => `Added a thumbnail idea to ${named(q)}`)
}

/** Takes something out of a project (the note or file itself stays in your notes). */
export function removeItem(id: string, itemId: string): void {
  change(id, (q) => ({ items: q.items.filter((i) => i.id !== itemId) }), (q) => `Took something out of ${named(q)}`)
}

/** Remembers the project's folder once it's been made. */
export function setProjectFolder(id: string, folder: string): void {
  const { projects } = useVideos.getState()
  // Not an undo step of its own: it goes with making the note there.
  write({ projects: projects.map((p) => (p.id === id ? { ...p, folder } : p)) })
}

/** The project's folder, picking a new one under Videos/ if it hasn't one yet. */
export function folderForProject(p: VideoProject): string {
  if (p.folder) return p.folder
  const taken = useVideos
    .getState()
    .projects.map((q) => q.folder)
    .filter((f): f is string => !!f)
  const folder = projectFolderFor(p.title, taken, usePrefs.getState().prefs.videosFolder)
  setProjectFolder(p.id, folder)
  return folder
}

/** Follows renames and moves of notes, files and folders (the videos folder setting too). */
export function remapVideos(from: string, to: string): void {
  const next = remapProjects(useVideos.getState().projects, from, to)
  if (next) write({ projects: next })
  const { videosFolder } = usePrefs.getState().prefs
  if (from && videosFolder && isWithin(videosFolder, from)) setPrefsQuietly({ videosFolder: replacePrefix(videosFolder, from, to) })
}

function folderPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type !== 'folder') continue
    out.push(n.path)
    folderPaths(n.children ?? [], out)
  }
  return out
}

/**
 * Called whenever the notes list is read again: if the videos folder was renamed or moved outside
 * Orbit, the setting and every project follow it to its new name.
 */
export function followMovedVideosFolder(tree: FileNode[]): void {
  const { loaded, projects } = useVideos.getState()
  const old = usePrefs.getState().prefs.videosFolder
  if (!loaded || !old || !tree.length) return
  const folders = projects.map((p) => p.folder).filter((f): f is string => !!f)
  const to = findMovedFolder(old, folders, folderPaths(tree))
  if (!to) return
  remapVideos(old, to)
  notify(`Your videos folder is now “${to}”, so video projects follow it there.`, 'info')
}
