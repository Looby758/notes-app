import type { CaptureRequest } from '@shared/types'
import { usePrefs } from '../store/prefs'
import { useVault } from '../store/vault'
import { appendUnderHeading, insertEvent } from './schedule'
import { editNote, ensureDaily } from './daily'
import { formatDate, fromDayKey } from './dates'
import { findNode, noteTitle, parentOf } from './paths'
import { relativePath } from './links'

/** Turns captured text into a list item; extra lines are indented under it. */
export function captureLines(text: string, time: string | null): string {
  const [first, ...rest] = text.trim().split(/\r?\n/)
  const head = `- ${time ? `${time} ` : ''}${first.trim()}`
  return [head, ...rest.map((l) => (l.trim() ? `  ${l.trimEnd()}` : ''))].join('\n').replace(/\n+$/, '')
}

/** A file name from the first line of a capture: no characters Windows forbids, not too long. */
export function nameFromText(text: string): string {
  const first = text.trim().split(/\r?\n/)[0].replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
  const clean = first.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return (clean.length > 60 ? `${clean.slice(0, 60).replace(/\s+\S*$/, '')}…` : clean) || `Capture ${formatDate(new Date(), 'YYYY-MM-DD HH-mm')}`
}

/** Voice notes recorded in capture arrive as (vault:path) links; point them at the file from `note`. */
const linkFrom = (text: string, note: string): string =>
  text.replace(/\]\(vault:([^)\n]+)\)/g, (_m, file: string) => `](${relativePath(parentOf(note), file).split('/').map(encodeURIComponent).join('/')})`)

const exists = (path: string): boolean => findNode(useVault.getState().tree, path)?.type === 'file'

/** A new note in `folder` named after the capture (with a number if that name is taken). */
async function newNoteIn(folder: string, text: string): Promise<string> {
  const base = nameFromText(text)
  for (let n = 1; ; n++) {
    const path = `${folder ? `${folder}/` : ''}${base}${n > 1 ? ` ${n}` : ''}.md`
    if (exists(path)) continue
    const created = await window.api.createNoteAt(path)
    const [, ...rest] = text.trim().split(/\r?\n/)
    await window.api.writeNote(created, `# ${base}\n\n${linkFrom(rest.join('\n').trim() || text.trim(), created)}\n`)
    return created
  }
}

/**
 * Saves a quick capture: by default under your capture heading in today's daily note, or at the
 * end of your inbox note; or at the end of a chosen note, as a new note in a chosen folder, or as
 * an event in a day's schedule. Notes are created if needed; open ones are edited through the editor.
 */
export async function saveCapture(req: CaptureRequest | string): Promise<{ ok: boolean; where?: string; error?: string }> {
  const { text, target, event } = typeof req === 'string' ? ({ text: req } as CaptureRequest) : req
  if (!text.trim() && !event) return { ok: false, error: 'Nothing to save.' }
  const prefs = usePrefs.getState().prefs
  try {
    // A calendar event: a line in that day's schedule.
    if (event) {
      const day = fromDayKey(event.date)
      if (!day) return { ok: false, error: 'That date isn’t valid.' }
      const path = await ensureDaily(day)
      const title = linkFrom(event.title.trim() || text.trim(), path).replace(/\s*\n\s*/g, ' ')
      const line = event.remind && event.time ? `- [ ] ${event.time} ${title} ⏰ ${event.time}` : `- ${event.time ? `${event.time} ` : ''}${title}`
      await editNote(path, (current) => insertEvent(current, prefs.scheduleHeading, line), { undo: `Added “${title}” to the calendar` })
      await useVault.getState().refresh([path])
      return { ok: true, where: `the calendar (${formatDate(day, 'ddd D MMM')})` }
    }

    const kind = target?.kind ?? prefs.captureTarget
    if (kind === 'folder' && target && 'path' in target) {
      const created = await newNoteIn(target.path, text)
      await useVault.getState().refresh([created])
      return { ok: true, where: noteTitle(created) }
    }

    let path: string
    let heading = ''
    if (kind === 'note' && target && 'path' in target) {
      path = target.path
      if (!exists(path)) return { ok: false, error: `“${noteTitle(path)}” isn’t there any more.` }
    } else if (kind === 'daily') {
      path = await ensureDaily(new Date())
      heading = prefs.captureHeading
    } else {
      path = /\.md$/i.test(prefs.captureInbox) ? prefs.captureInbox : `${prefs.captureInbox}.md`
      if (!exists(path)) {
        await window.api.createNoteAt(path)
        await window.api.writeNote(path, `# ${noteTitle(path)}\n\n`)
      }
    }
    const line = captureLines(linkFrom(text, path), prefs.captureTimestamp ? formatDate(new Date(), 'HH:mm') : null)
    await editNote(path, (current) => appendUnderHeading(current, heading, line))
    await useVault.getState().refresh([path])
    return { ok: true, where: kind === 'daily' ? "today's note" : noteTitle(path) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
