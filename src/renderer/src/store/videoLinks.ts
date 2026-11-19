import { createProject, deleteProject, ensureVideos, projectById, setStage, setUploadDate } from './videos'
import { deleteVideo, ensurePublishing, setUploaded, videoDraftFor } from './publishing'
import { undoGroup } from '../lib/undo'
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
 * all moves it back to Edited and keeps the day as the planned one.
 */
export async function markUploaded(id: string, uploaded: { on: string; url: string } | null): Promise<void> {
  const p = projectById(id)
  if (!p) return setUploaded(id, uploaded)
  await undoGroup(
    () => (uploaded ? `Marked “${p.title.trim() || 'a video'}” as uploaded` : `Marked “${p.title.trim() || 'a video'}” as not uploaded`),
    async () => {
      setUploaded(id, uploaded)
      if (uploaded) {
        if (p.uploadDate !== uploaded.on) setUploadDate(id, uploaded.on)
        setStage(id, 'uploaded')
      } else if (p.stage === 'uploaded') setStage(id, 'edited')
    }
  )
}


/**
 * Deletes a video from the Publishing page: its drafts, and for a video project the project too
 * (its notes and files stay where they are). One Ctrl+Z step brings it all back.
 */
export async function deleteFromPublishing(id: string): Promise<void> {
  const p = projectById(id)
  if (!p) return deleteVideo(id)
  await undoGroup(
    () => `Deleted the video “${p.title.trim() || 'a video'}”`,
    async () => {
      deleteVideo(id)
      deleteProject(id)
    }
  )
}
