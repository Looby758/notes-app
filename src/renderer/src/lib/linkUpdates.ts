import { NoteLookup, rewriteLinks } from './links'
import { isWithin, noteTitle, replacePrefix } from './paths'
import { applyText } from './editorController'
import { normalizeText, useNoteIndex } from '../store/noteIndex'
import { notify } from '../store/notify'

/** What a rename looked like beforehand: the old note set, and the text of every note that might need fixing. */
export interface LinkSnapshot {
  before: NoteLookup
  texts: Map<string, string>
}

/** Call before renaming or moving `path` (a note or folder). */
export async function snapshotLinks(path: string): Promise<LinkSnapshot> {
  const { notes, lookup } = useNoteIndex.getState()
  const candidates = [...notes]
    .filter(([source, { links }]) =>
      links.some((l) => {
        const target = lookup.resolve(l, source)
        // Links into the moved item, or relative links out of a note that's moving.
        return (target !== null && isWithin(target, path)) || (l.kind === 'md' && isWithin(source, path))
      })
    )
    .map(([source]) => source)
  const texts = new Map<string, string>()
  await Promise.all(
    candidates.map(async (p) => {
      try {
        texts.set(p, normalizeText(await window.api.readNote(p)))
      } catch {
        // gone; nothing to fix
      }
    })
  )
  return { before: lookup, texts }
}

/**
 * Call after `from` became `to`: offers to fix the links that would otherwise break. With
 * `answer` (moving several things at once, asked once beforehand) it doesn't ask again.
 */
export async function updateLinksAfterMove(snapshot: LinkSnapshot, from: string, to: string, answer?: boolean): Promise<void> {
  const { before, texts } = snapshot
  const after = new NoteLookup(before.paths.map((p) => replacePrefix(p, from, to)))
  const edits: { path: string; text: string }[] = []
  for (const [source, text] of texts) {
    const next = rewriteLinks(text, source, from, to, before, after)
    if (next !== null) edits.push({ path: replacePrefix(source, from, to), text: next })
  }
  if (edits.length === 0) return

  const name = noteTitle(from)
  const ok =
    answer ??
    (await window.api.confirm({
    message: `Update links to "${name}"?`,
    detail: `${edits.length} ${edits.length === 1 ? 'note links' : 'notes link'} to it. Update ${
      edits.length === 1 ? 'that link' : 'those links'
    } so they keep working?`,
    ok: 'Update links',
    cancel: "Don't update"
  }))
  if (!ok) return

  for (const { path, text } of edits) {
    try {
      if (!applyText(path, text)) await window.api.writeNote(path, text)
    } catch (err) {
      notify(err)
    }
  }
}
