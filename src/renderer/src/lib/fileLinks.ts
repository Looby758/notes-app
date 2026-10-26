import { rewriteFileLinks } from './links'
import { isWithin, replacePrefix } from './paths'
import { editNote } from './daily'
import { getOpenText } from './editorController'
import { getNoteText, useNoteIndex } from '../store/noteIndex'
import { notify } from '../store/notify'

/**
 * After a rename or move (`from` → `to`, already done and the index refreshed): keeps pictures,
 * recordings and file links in notes working. Quietly, since a broken picture is never wanted.
 */
export async function fixFileLinks(from: string, to: string): Promise<void> {
  const name = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  for (const path of useNoteIndex.getState().lookup.paths) {
    const moved = isWithin(path, to)
    const source = moved ? replacePrefix(path, to, from) : path
    const text = getOpenText(path) ?? getNoteText(path)
    // Cheap check first: the note mentions the moved thing's name, or itself moved.
    if (!text || (!moved && !text.includes(encodeURIComponent(name(from)).replace(/%2F/g, '/')) && !text.includes(name(from)))) continue
    try {
      await editNote(path, (current) => rewriteFileLinks(current, source, from, to))
    } catch (err) {
      notify(err)
    }
  }
}
