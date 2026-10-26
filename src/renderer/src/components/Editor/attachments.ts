import { EditorView } from '@codemirror/view'
import { notePath } from './facets'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { useVault } from '../../store/vault'
import { getDrag } from '../../lib/dnd'
import { formatDate } from '../../lib/dates'
import { relativePath } from '../../lib/links'
import { parentOf } from '../../lib/paths'
import { AUDIO_EXT } from '../../lib/voice'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

const EXT_FOR_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif'
}

/** Markdown for a link from `fromNote` to a vault file: an image embed for pictures, a link otherwise. */
export function attachmentLink(file: string, fromNote: string): string {
  const url = relativePath(parentOf(fromNote), file).split('/').map(encodeURIComponent).join('/')
  const name = file.slice(file.lastIndexOf('/') + 1)
  const label = name.replace(/\.[^.]+$/, '')
  // Pictures and voice notes are embedded (shown / playable); other files are links.
  return IMAGE_EXT.test(name) || AUDIO_EXT.test(name) ? `![${label}](${url})` : `[${name}](${url})`
}

/** Inserts links at `pos`, adding line breaks so images sit on their own lines. */
function insertLinks(view: EditorView, links: string[], pos: number): void {
  const at = Math.min(pos, view.state.doc.length)
  const line = view.state.doc.lineAt(at)
  const before = at > line.from ? '\n' : ''
  const after = at < line.to ? '\n' : ''
  const insert = before + links.join('\n') + after
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length - after.length } })
  view.focus()
}

/** Saves files into the attachments folder and links them from the note. */
async function attachFiles(view: EditorView, files: File[], pos: number): Promise<void> {
  const note = view.state.facet(notePath)
  const folder = usePrefs.getState().prefs.attachmentFolder
  const links: string[] = []
  for (const file of files) {
    // Screenshots from the clipboard arrive as "image.png"; give them a name you can find later.
    const generic = !file.name || /^image\.\w+$/i.test(file.name)
    const ext = EXT_FOR_TYPE[file.type] ?? (file.name.match(/\.[^.]+$/)?.[0] ?? '')
    const name = generic ? `Pasted image ${formatDate(new Date(), 'YYYYMMDD-HHmmss')}${ext}` : file.name
    try {
      const saved = await window.api.saveAttachment(folder, name, new Uint8Array(await file.arrayBuffer()))
      links.push(attachmentLink(saved, note))
    } catch (err) {
      notify(err)
    }
  }
  if (links.length) {
    insertLinks(view, links, pos)
    useVault.getState().refresh()
  }
}

/** Lets you pick images (or any files) from disk, copies them in and links them at the cursor. */
export async function pickAndAttach(view: EditorView, imagesOnly: boolean): Promise<void> {
  const note = view.state.facet(notePath)
  try {
    const saved = await window.api.pickAttachment(usePrefs.getState().prefs.attachmentFolder, imagesOnly)
    if (saved.length) insertLinks(view, saved.map((f) => attachmentLink(f, note)), view.state.selection.main.head)
  } catch (err) {
    notify(err)
  }
}

/** Paste a screenshot or drop files from File Explorer straight into a note. */
export const attachmentHandlers = EditorView.domEventHandlers({
  paste(e, view) {
    const files = [...(e.clipboardData?.files ?? [])]
    if (files.length === 0) return false
    e.preventDefault()
    attachFiles(view, files, view.state.selection.main.head)
    return true
  },
  dragover(e) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      return true
    }
    return false
  },
  drop(e, view) {
    // Tabs and notes dragged inside the app are handled by the pane (it opens or moves them).
    // Returning true stops the editor from also inserting their name as text.
    if (getDrag()) return true
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length === 0) return false
    e.preventDefault()
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
    attachFiles(view, files, pos)
    return true
  }
})
