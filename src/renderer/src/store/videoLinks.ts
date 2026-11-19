import { createProject, deleteProject, ensureVideos, projectById, putBackProject, setStage, setUploadDate } from './videos'
import { deleteVideo, draftOf, ensurePublishing, putBackDraft, setUploaded, videoDraftFor } from './publishing'
import { addDeleted, ensureDeletedVideos, removeDeleted, useDeletedVideos, type DeletedVideo } from './deletedVideos'
import { useVault } from './vault'
import { recordUndo, undoChanged, undoGroup } from '../lib/undo'
import { discardWithin, flushAll } from '../lib/editorController'
import { remapProjects } from '../lib/videos'
import type { VideoDraft } from '../lib/publishing'
import type { VideoProject } from '../lib/videos'

/**
 * Where Video projects and Publishing meet. A video is a video project (its title, stage and upload
 * date, on the Videos board and the calendar); Publishing keeps that video's title options, thumbnail
 * board, description and upload checklist under the project's id. Videos made on the Publishing page
 * before the two were joined stay there as Publishing-only videos.
 */

/** A row on the Publishing page: a video project (with its drafts, once it has some) or a Publishing-only video. */
export interface PublishingRow {
  id: string
  name: string
  project: VideoProject | null
  /** Its drafts, or null for a project that hasn't been opened in Publishing yet. */
  draft: VideoDraft | null
}

/** Every video project (in the Videos page's order), then the Publishing-only videos. */
export function publishingRows(projects: VideoProject[], drafts: VideoDraft[]): PublishingRow[] {
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const ids = new Set(projects.map((p) => p.id))
  return [
    ...projects.map((p) => ({ id: p.id, name: p.title.trim() || 'Untitled video', project: p, draft: byId.get(p.id) ?? null })),
    // A project's drafts stay when the project is deleted (so Ctrl+Z brings both back), but aren't listed.
    ...drafts.filter((d) => !d.project && !ids.has(d.id)).map((d) => ({ id: d.id, name: d.name, project: null, draft: d }))
  ]
}

/** Makes sure both files have been read, so writing one doesn't drop what's in it. */
export async function ensureVideoData(): Promise<void> {
  await Promise.all([ensureVideos(), ensurePublishing()])
}

/** Makes sure a video project has its Publishing drafts (empty the first time). */
export async function draftsForProject(id: string): Promise<VideoDraft | null> {
  await ensureVideoData()
  const p = projectById(id)
  return p ? videoDraftFor(p.id, p.title) : null
}

/** "New video" on the Publishing page: a video project at the Idea stage (so it's on the board too), with its drafts. */
export async function newVideoFromPublishing(name: string): Promise<string> {
  await ensureVideoData()
  const made = createProject(name || 'Untitled video')
  videoDraftFor(made.id, made.title)
  return made.id
}

/**
 * Marking a video uploaded in its checklist (or not uploaded after all). For a video project it also
 * moves it to Uploaded and puts the day on the calendar, all as one Ctrl+Z step. Not uploaded after
 * all moves it back to Edited and puts back the day it was planned for (or takes it off the calendar).
 */
export async function markUploaded(id: string, uploaded: { on: string; url: string } | null): Promise<void> {
  const p = projectById(id)
  if (!p) return setUploaded(id, uploaded)
  await undoGroup(
    () => (uploaded ? `Marked “${p.title.trim() || 'a video'}” as uploaded` : `Marked “${p.title.trim() || 'a video'}” as not uploaded`),
    async () => {
      setUploaded(id, uploaded)
      if (uploaded) {
        // The stage first, so it remembers the planned day; then the day it went up.
        setStage(id, 'uploaded')
        if (projectById(id)?.uploadDate !== uploaded.on) setUploadDate(id, uploaded.on)
      } else if (p.stage === 'uploaded') setStage(id, 'edited')
    }
  )
}


// ---------- deleting, and Recently deleted ----------

/** Puts a video's folder (if it has one) in the bin and lists it under Recently deleted. */
async function intoBin(entry: DeletedVideo): Promise<void> {
  if (entry.folder) {
    await flushAll()
    discardWithin(entry.folder)
    if (!(await window.api.videoBinKeep(entry.folder, entry.id))) entry.folder = null
    await useVault.getState().refresh()
  }
  addDeleted(entry)
  undoChanged('videos')
}

/** Takes it off Recently deleted and puts its folder back (where it was, or beside it if that's taken). */
async function outOfBin(entry: DeletedVideo): Promise<void> {
  removeDeleted(entry.id)
  if (entry.folder) {
    const back = await window.api.videoBinRestore(entry.id, entry.folder)
    if (back && back !== entry.folder) {
      if (entry.project) entry.project = remapProjects([entry.project], entry.folder, back)?.[0] ?? entry.project
      entry.folder = back
    }
    await useVault.getState().refresh()
  }
  undoChanged('videos')
}

/**
 * Deletes a video everywhere: its drafts, the video project, and the project's folder (with its
 * script and research notes). All of it is kept under Recently deleted on the Videos page for 30
 * days, and Ctrl+Z puts it straight back.
 */
export async function deleteVideoEverywhere(id: string): Promise<void> {
  await Promise.all([ensureVideoData(), ensureDeletedVideos()])
  const project = projectById(id) ?? null
  const draft = draftOf(id) ?? null
  if (!project && !draft) return
  const name = (project?.title || draft?.name || '').trim() || 'Untitled video'
  const entry: DeletedVideo = { id, name, project, draft, folder: project?.folder ?? null, deleted: Date.now() }
  const label = `Deleted the video “${name}”`
  await undoGroup(
    () => label,
    async () => {
      if (draft) deleteVideo(id)
      if (project) deleteProject(id)
      await intoBin(entry)
      recordUndo({ label, undo: () => outOfBin(entry), redo: () => intoBin(entry) })
    }
  )
}

/** Brings a video back from Recently deleted: the project, its drafts and its folder. */
export async function restoreVideo(id: string): Promise<void> {
  await Promise.all([ensureVideoData(), ensureDeletedVideos()])
  const entry = useDeletedVideos.getState().list.find((d) => d.id === id)
  if (!entry) return
  const label = `Brought back the video “${entry.name}”`
  await undoGroup(
    () => label,
    async () => {
      await outOfBin(entry)
      recordUndo({ label, undo: () => intoBin(entry), redo: () => outOfBin(entry) })
      if (entry.project) putBackProject(entry.project)
      if (entry.draft) putBackDraft(entry.draft)
    }
  )
}

/** "Delete now" on Recently deleted: its folder goes on to the Recycle Bin / Bin, and it can't be brought back here. */
export async function deleteForGood(id: string): Promise<void> {
  const entry = useDeletedVideos.getState().list.find((d) => d.id === id)
  if (!entry) return
  removeDeleted(id)
  if (entry.folder) await window.api.videoBinDrop(id)
}
