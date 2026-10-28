import { useVault } from '../store/vault'
import { useNoteIndex } from '../store/noteIndex'
import { notify } from '../store/notify'
import { usePrefs } from '../store/prefs'
import { openNote, openWebTab } from './editorController'
import { parseWikiInner } from './links'
import { findNode, parentOf, resolveRelative } from './paths'

/** Opens a markdown link clicked in a note: web links in a web tab (or the browser), relative links as notes. */
export function openLink(href: string, fromNote: string): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (/^https?:/i.test(href) && usePrefs.getState().prefs.openLinksInApp) openWebTab(href, { beside: true })
    else if (/^(https?|mailto):/i.test(href)) window.open(href)
    return
  }
  let target = href.split('#')[0]
  try {
    target = decodeURI(target)
  } catch {
    // use as typed
  }
  if (!target) return
  const tree = useVault.getState().tree
  let path = resolveRelative(parentOf(fromNote), target)
  // Attachments (PDFs, documents, images…) open in their usual Windows app.
  if (/\.[a-z0-9]{1,5}$/i.test(path) && !/\.md$/i.test(path)) {
    window.api.openFile(path).catch(() => notify(`File not found: ${target}`))
    return
  }
  if (!findNode(tree, path) && !/\.md$/i.test(path)) path += '.md'
  if (findNode(tree, path)?.type === 'file') openNote(path)
  else notify(`Note not found: ${target}`)
}

/** Opens a [[wikilink]]; if the note doesn't exist yet, offers to create it next to the current note. */
export async function openWikiLink(inner: string, fromNote: string): Promise<void> {
  const { target, heading } = parseWikiInner(inner)
  if (!target) return
  const existing = useNoteIndex.getState().lookup.resolve({ kind: 'wiki', target }, fromNote)
  if (existing) {
    openNote(existing, { heading: heading || undefined })
    return
  }
  const folder = parentOf(fromNote)
  const newPath = target.includes('/') || !folder ? target.replace(/^\/+/, '') : `${folder}/${target}`
  const ok = await window.api.confirm({
    message: `"${target}" doesn't exist yet.`,
    detail: `Create ${newPath.replace(/\.md$/i, '')}.md?`,
    ok: 'Create note'
  })
  if (ok) await useVault.getState().createNoteAt(newPath)
}
