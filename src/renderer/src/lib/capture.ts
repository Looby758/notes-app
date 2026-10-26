import { usePrefs } from '../store/prefs'
import { useVault } from '../store/vault'
import { appendUnderHeading } from './schedule'
import { editNote, ensureDaily } from './daily'
import { formatDate } from './dates'
import { findNode, noteTitle, parentOf } from './paths'
import { relativePath } from './links'

/** Turns captured text into a list item; extra lines are indented under it. */
export function captureLines(text: string, time: string | null): string {
  const [first, ...rest] = text.trim().split(/\r?\n/)
  const head = `- ${time ? `${time} ` : ''}${first.trim()}`
  return [head, ...rest.map((l) => (l.trim() ? `  ${l.trimEnd()}` : ''))].join('\n').replace(/\n+$/, '')
}

/**
 * Saves a quick capture: under your capture heading in today's daily note, or at the end of your
 * inbox note (both are created if needed). Goes through the editor when the note is open.
 */
export async function saveCapture(text: string): Promise<{ ok: boolean; where?: string; error?: string }> {
  if (!text.trim()) return { ok: false, error: 'Nothing to save.' }
  const prefs = usePrefs.getState().prefs
  try {
    let path: string
    let heading: string
    if (prefs.captureTarget === 'daily') {
      path = await ensureDaily(new Date())
      heading = prefs.captureHeading
    } else {
      path = /\.md$/i.test(prefs.captureInbox) ? prefs.captureInbox : `${prefs.captureInbox}.md`
      if (findNode(useVault.getState().tree, path)?.type !== 'file') {
        await window.api.createNoteAt(path)
        await window.api.writeNote(path, `# ${noteTitle(path)}\n\n`)
      }
      heading = ''
    }
    // Voice notes recorded in capture arrive as (vault:path) links; point them at the file from this note.
    const linked = text.replace(/\]\(vault:([^)\n]+)\)/g, (_m, file: string) => `](${relativePath(parentOf(path), file).split('/').map(encodeURIComponent).join('/')})`)
    const line = captureLines(linked, prefs.captureTimestamp ? formatDate(new Date(), 'HH:mm') : null)
    await editNote(path, (current) => appendUnderHeading(current, heading, line))
    await useVault.getState().refresh([path])
    return { ok: true, where: prefs.captureTarget === 'daily' ? "today's note" : noteTitle(path) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
