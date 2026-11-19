import { create } from 'zustand'
import { dedupeTags, emptyPublishing, newDraft, newPublishingId, readPublishing, sortChapters, type Chapter, type PublishingData, type VideoDraft } from '../lib/publishing'
import { notify } from './notify'
import { recordUndo, undoChanged } from '../lib/undo'

/**
 * Title options, descriptions, tags and chapters for your videos. Saved in the vault
 * (.notesapp/publishing.json) so they follow your notes to other computers via Google Drive.
 * Ctrl+Z (outside a text box) undoes changes, like everywhere else.
 */
export const usePublishing = create<PublishingData & { loaded: boolean }>(() => ({ ...emptyPublishing(), loaded: false }))

const FILE = 'publishing.json'

/** Bumped when publishing.json is read again (another notes folder, say): older undo steps no longer fit. */
let generation = 0

export async function loadPublishing(): Promise<void> {
  generation++
  usePublishing.setState({ ...emptyPublishing(), loaded: false })
  try {
    usePublishing.setState({ ...readPublishing(await window.api.readAppData(FILE)), loaded: true })
  } catch {
    // unreadable file: start empty rather than failing
    usePublishing.setState({ loaded: true })
  }
}

/** Makes sure publishing.json has been read (a video project can ask before the page is opened). */
export async function ensurePublishing(): Promise<void> {
  if (!usePublishing.getState().loaded) await loadPublishing()
}

let writing = false
let again = false

/** Writes the file, one write at a time (typing makes several changes quickly). */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  const { videos } = usePublishing.getState()
  window.api
    .writeAppData(FILE, JSON.stringify({ version: 1, videos }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function write(videos: VideoDraft[]): void {
  usePublishing.setState({ videos })
  persist()
}

/**
 * Makes a change, which Ctrl+Z can undo, named by `label`. Changes with the same `mergeKey` a
 * moment apart (typing a description) undo as one.
 */
function save(videos: VideoDraft[], label: string, mergeKey?: string): void {
  const before = usePublishing.getState().videos
  const at = generation
  const swap = (to: VideoDraft[]) => (): void => {
    if (at !== generation) throw new Error('Your publishing drafts were reloaded since, so that can’t be undone.')
    write(to)
    undoChanged('publishing')
  }
  write(videos)
  recordUndo({ label, mergeKey: mergeKey && `publishing:${mergeKey}`, undo: swap(before), redo: swap(videos) })
}

const named = (d: VideoDraft | undefined): string => (d?.name.trim() ? `“${d.name.trim()}”` : 'a video')

export const draftOf = (id: string): VideoDraft | undefined => usePublishing.getState().videos.find((v) => v.id === id)

/** Changes one video's drafts. */
function change(id: string, fn: (d: VideoDraft) => Partial<VideoDraft>, label: string, mergeKey?: string): void {
  const { videos } = usePublishing.getState()
  const d = videos.find((v) => v.id === id)
  if (!d) return
  save(
    videos.map((v) => (v.id === id ? { ...v, ...fn(v), updated: Date.now() } : v)),
    `${label} for ${named(d)}`,
    mergeKey && `${id}:${mergeKey}`
  )
}

// ---------- videos ----------

/** A new video on the Publishing page. */
export function addVideo(name: string): VideoDraft {
  const made = newDraft(name.trim() || 'Untitled video')
  save([made, ...usePublishing.getState().videos], `Added ${named(made)}`)
  return made
}

/**
 * The drafts for a video made somewhere else (a video project), made empty the first time. Not
 * an undo step: it's just somewhere to keep them.
 */
export function videoDraftFor(id: string, name: string): VideoDraft {
  const found = draftOf(id)
  if (found) return found
  const made = newDraft(name, id)
  write([made, ...usePublishing.getState().videos])
  return made
}

export function renameVideo(id: string, name: string): void {
  change(id, () => ({ name }), 'Renamed', 'name')
}

export function deleteVideo(id: string): void {
  const { videos } = usePublishing.getState()
  const gone = videos.find((v) => v.id === id)
  if (!gone) return
  save(
    videos.filter((v) => v.id !== id),
    `Deleted ${named(gone)}`
  )
}

// ---------- titles ----------

export function addTitle(id: string, text = ''): string {
  const titleId = newPublishingId()
  change(id, (d) => ({ titles: [...d.titles, { id: titleId, text }], chosenTitle: d.chosenTitle ?? (d.titles.length ? d.chosenTitle : titleId) }), 'Added a title option')
  return titleId
}

export function setTitleText(id: string, titleId: string, text: string): void {
  change(id, (d) => ({ titles: d.titles.map((t) => (t.id === titleId ? { ...t, text } : t)) }), 'Changed a title option', `title:${titleId}`)
}

export function chooseTitle(id: string, titleId: string): void {
  change(id, () => ({ chosenTitle: titleId }), 'Picked a title')
}

export function deleteTitle(id: string, titleId: string): void {
  change(
    id,
    (d) => {
      const titles = d.titles.filter((t) => t.id !== titleId)
      return { titles, chosenTitle: d.chosenTitle === titleId ? (titles[0]?.id ?? null) : d.chosenTitle }
    },
    'Removed a title option'
  )
}

export function moveTitle(id: string, titleId: string, by: -1 | 1): void {
  change(
    id,
    (d) => {
      const i = d.titles.findIndex((t) => t.id === titleId)
      const j = i + by
      if (i < 0 || j < 0 || j >= d.titles.length) return {}
      const titles = [...d.titles]
      ;[titles[i], titles[j]] = [titles[j], titles[i]]
      return { titles }
    },
    'Moved a title option'
  )
}

// ---------- description and tags ----------

export function setDescription(id: string, description: string): void {
  change(id, () => ({ description }), 'Changed the description', 'description')
}

export function setChaptersInDescription(id: string, on: boolean): void {
  change(id, () => ({ chaptersInDescription: on }), on ? 'Put chapters in the description' : 'Left chapters out of the description')
}

export function addTags(id: string, tags: string[]): void {
  if (!tags.length) return
  change(id, (d) => ({ tags: dedupeTags([...d.tags, ...tags]) }), tags.length === 1 ? 'Added a tag' : `Added ${tags.length} tags`)
}

export function removeTag(id: string, tag: string): void {
  change(id, (d) => ({ tags: d.tags.filter((t) => t !== tag) }), `Removed the “${tag}” tag`)
}

export function clearTags(id: string): void {
  change(id, () => ({ tags: [] }), 'Removed all tags')
}

// ---------- chapters ----------

export function addChapter(id: string, time = '', name = ''): string {
  const chapterId = newPublishingId()
  change(id, (d) => ({ chapters: [...d.chapters, { id: chapterId, time, name }] }), 'Added a chapter')
  return chapterId
}

export function setChapter(id: string, chapterId: string, edit: Partial<Omit<Chapter, 'id'>>): void {
  change(id, (d) => ({ chapters: d.chapters.map((c) => (c.id === chapterId ? { ...c, ...edit } : c)) }), 'Changed a chapter', `chapter:${chapterId}:${Object.keys(edit).sort().join(',')}`)
}

export function deleteChapter(id: string, chapterId: string): void {
  change(id, (d) => ({ chapters: d.chapters.filter((c) => c.id !== chapterId) }), 'Removed a chapter')
}

export function sortVideoChapters(id: string): void {
  change(id, (d) => ({ chapters: sortChapters(d.chapters) }), 'Sorted the chapters')
}

/** Replaces (or adds to) the chapters with ones pasted as text. */
export function setChapters(id: string, chapters: Chapter[], label = 'Pasted chapters'): void {
  change(id, () => ({ chapters }), label)
}
