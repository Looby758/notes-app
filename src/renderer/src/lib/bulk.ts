import { useNoteIndex } from '../store/noteIndex'
import { useVault } from '../store/vault'
import { toggleStar, useStarred } from '../store/starred'
import { notify } from '../store/notify'
import { clearSelection } from '../store/selection'
import { editNote } from './daily'
import { isWithin, parentOf } from './paths'
import { readFrontmatter, setProperty } from './properties'

/** Bulk actions on the selected notes and folders. */

/** The notes a selection covers (folders count as all the notes inside them). */
export function notesIn(paths: string[]): string[] {
  const all = useNoteIndex.getState().lookup.paths
  const out = new Set<string>()
  for (const p of paths) {
    if (all.includes(p)) out.add(p)
    else for (const n of all) if (isWithin(n, p)) out.add(n)
  }
  return [...out]
}

/** Top-level items only: a note inside a selected folder moves with the folder. */
const outermost = (paths: string[]): string[] => paths.filter((p) => !paths.some((o) => o !== p && isWithin(p, o)))

export async function moveMany(paths: string[], folder: string): Promise<void> {
  const items = outermost(paths).filter((p) => parentOf(p) !== folder && !isWithin(folder, p))
  if (items.length === 0) return
  // Ask about links once for the lot (only if other notes link to what's moving).
  const { notes, lookup } = useNoteIndex.getState()
  const linked = [...notes].some(
    ([source, { links }]) => !items.some((i) => isWithin(source, i)) && links.some((l) => items.some((i) => isWithin(lookup.resolve(l, source) ?? '', i)))
  )
  const update = linked
    ? await window.api.confirm({
        message: `Update links to the moved ${items.length === 1 ? 'item' : 'items'}?`,
        detail: 'Other notes link to them. Update those links so they keep working?',
        ok: 'Update links',
        cancel: "Don't update"
      })
    : false
  for (const p of items) await useVault.getState().move(p, folder, update)
  clearSelection()
}

export async function trashMany(paths: string[]): Promise<void> {
  await useVault.getState().trashMany(outermost(paths))
  clearSelection()
}

/** Stars them all, or (if they're all starred already) unstars them. */
export function starMany(paths: string[]): void {
  const targets = notesIn(paths)
  const starred = useStarred.getState().paths
  const allStarred = targets.every((p) => starred.includes(p))
  for (const p of targets) if (starred.includes(p) === allStarred) toggleStar(p)
}

async function eachNote(paths: string[], change: (text: string) => string | null): Promise<number> {
  let changed = 0
  for (const p of notesIn(paths)) {
    try {
      if (await editNote(p, change)) changed++
    } catch (err) {
      notify(err)
    }
  }
  await useVault.getState().refresh(notesIn(paths))
  return changed
}

const tagsOf = (text: string): string[] => {
  const p = readFrontmatter(text)?.properties.find((x) => x.key === 'tags' || x.key === 'tag')
  return Array.isArray(p?.value) ? p.value : p?.value ? p.value.split(/[,\s]+/).filter(Boolean) : []
}

export function addTagMany(paths: string[], tag: string): Promise<number> {
  const t = tag.trim().replace(/^#/, '')
  return eachNote(paths, (text) => {
    const tags = tagsOf(text)
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return null
    return setProperty(text, 'tags', [...tags, t])
  })
}

/** Removes a tag from the notes' properties (#tags written in the text itself are left alone). */
export function removeTagMany(paths: string[], tag: string): Promise<number> {
  const t = tag.trim().replace(/^#/, '').toLowerCase()
  return eachNote(paths, (text) => {
    const tags = tagsOf(text)
    if (!tags.some((x) => x.toLowerCase() === t)) return null
    return setProperty(text, 'tags', tags.filter((x) => x.toLowerCase() !== t))
  })
}

export function setPropertyMany(paths: string[], key: string, value: string | undefined): Promise<number> {
  const k = key.trim().replace(/:/g, '')
  if (!k) return Promise.resolve(0)
  return eachNote(paths, (text) => setProperty(text, k, value))
}
