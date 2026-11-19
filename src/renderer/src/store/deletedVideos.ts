import { create } from 'zustand'
import { notify } from './notify'
import type { VideoProject } from '../lib/videos'
import type { VideoDraft } from '../lib/publishing'

/**
 * Recently deleted videos, kept for 30 days so one deleted by mistake can be brought back: the
 * project, its Publishing drafts and (moved to .notesapp/deleted-videos/<id>) its folder. Saved in
 * .notesapp/deleted-videos.json, so it follows the notes folder like the videos themselves.
 */

export const KEEP_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export interface DeletedVideo {
  id: string
  name: string
  project: VideoProject | null
  draft: VideoDraft | null
  /** Where its folder was, while the folder is kept in the bin; null if it had none. */
  folder: string | null
  deleted: number
}

export const useDeletedVideos = create<{ list: DeletedVideo[]; loaded: boolean }>(() => ({ list: [], loaded: false }))

const FILE = 'deleted-videos.json'

/** When a deleted video goes for good. */
export const goesOn = (d: DeletedVideo): number => d.deleted + KEEP_DAYS * DAY_MS

export function readDeleted(raw: string | null): DeletedVideo[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as { videos?: unknown }
    if (!Array.isArray(data.videos)) return []
    return data.videos.filter(
      (v): v is DeletedVideo =>
        !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.deleted === 'number' && (v.folder === null || typeof v.folder === 'string')
    )
  } catch {
    return []
  }
}

let writing = false
let again = false
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .writeAppData(FILE, JSON.stringify({ version: 1, videos: useDeletedVideos.getState().list }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function setList(list: DeletedVideo[]): void {
  useDeletedVideos.setState({ list })
  persist()
}

/** Reads the list (for the notes folder just opened), and sends ones older than 30 days on to the Recycle Bin / Bin. */
export async function loadDeletedVideos(now = Date.now()): Promise<void> {
  useDeletedVideos.setState({ list: [], loaded: false })
  let list: DeletedVideo[] = []
  try {
    list = readDeleted(await window.api.readAppData(FILE))
  } catch {
    // unreadable: start empty
  }
  const old = list.filter((d) => goesOn(d) <= now)
  useDeletedVideos.setState({ list: list.filter((d) => goesOn(d) > now), loaded: true })
  if (old.length) {
    persist()
    for (const d of old) if (d.folder) void window.api.videoBinDrop(d.id).catch(() => undefined)
  }
}

export async function ensureDeletedVideos(): Promise<void> {
  if (!useDeletedVideos.getState().loaded) await loadDeletedVideos()
}

export function addDeleted(entry: DeletedVideo): void {
  setList([entry, ...useDeletedVideos.getState().list.filter((d) => d.id !== entry.id)])
}

export function removeDeleted(id: string): void {
  setList(useDeletedVideos.getState().list.filter((d) => d.id !== id))
}
