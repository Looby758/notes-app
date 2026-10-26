import type { Prefs } from '@shared/prefs'
import { addDays, formatDate, fromDayKey } from './dates'
import { fillTemplate } from './templates'
import { formatEventLine, insertEvent, toggleTaskAt, type DatedItem } from './schedule'
import { applyText, getOpenText, isNoteTab, openNote } from './editorController'
import { findNode, noteTitle } from './paths'
import { isLockedText } from './lock/crypto'
import { dailyDateOf, dailyPath } from './dailyPaths'
import { usePrefs } from '../store/prefs'
import { useVault } from '../store/vault'
import { useEditor } from '../store/editor'
import { getNoteText, normalizeText } from '../store/noteIndex'
import { notify } from '../store/notify'

export { dailyDateOf, dailyPath }

const exists = (path: string): boolean => findNode(useVault.getState().tree, path)?.type === 'file'

const DATE_HEADING = '# {{date:dddd D MMMM YYYY}}\n\n'

/**
 * With "keep the date heading" on, a daily template that doesn't start with a heading of its own
 * gets the usual date heading on top (after its properties, if it has any).
 */
export function withDateHeading(template: string, keep: boolean): string {
  if (!keep) return template
  const front = /^---\n[\s\S]*?\n---\n/.exec(template)?.[0] ?? ''
  const body = template.slice(front.length)
  if (/^\s*#\s/.test(body)) return template
  return front + DATE_HEADING + body.replace(/^\s*\n/, '')
}

/** What a brand-new daily note starts with: your daily template, or just a title. */
function newDailyContent(date: Date): { text: string; cursor: number | null } {
  const prefs = usePrefs.getState().prefs
  const title = formatDate(date, prefs.dailyFormat)
  const templatePath = prefs.dailyTemplate ? (/\.md$/i.test(prefs.dailyTemplate) ? prefs.dailyTemplate : `${prefs.dailyTemplate}.md`) : ''
  const template = templatePath ? getNoteText(templatePath) : undefined
  if (templatePath && template === undefined) notify(`Daily template "${prefs.dailyTemplate}" wasn't found, so a plain note was made.`, 'info')
  return fillTemplate(template === undefined ? `${DATE_HEADING}{{cursor}}` : withDateHeading(template, prefs.dailyKeepHeading), { title, date })
}

/** Opens a day's daily note, creating it first (unless `create` is false). */
export async function openDaily(date: Date, { create = true, pane }: { create?: boolean; pane?: string } = {}): Promise<boolean> {
  const path = dailyPath(date)
  if (exists(path)) {
    openNote(path, { pane })
    return true
  }
  if (!create) return false
  const { text, cursor } = newDailyContent(date)
  return (await useVault.getState().createNoteAt(path, text, cursor)) !== null
}

export const openToday = (): Promise<boolean> => openDaily(new Date())

/** From a daily note, open the day before or after (creating it). */
export function stepDaily(step: 1 | -1): void {
  const { active } = useEditor.getState()
  const key = isNoteTab(active) ? dailyDateOf(active) : null
  const base = key ? fromDayKey(key)! : new Date()
  openDaily(addDays(base, key ? step : 0))
}

/**
 * Changes a note's text, through the editor if it's open (so undo works and unsaved typing is
 * kept), else on disk.
 */
export async function editNote(path: string, change: (text: string) => string | null): Promise<boolean> {
  let current = getOpenText(path)
  if (current === null) {
    current = normalizeText(await window.api.readNote(path))
    if (isLockedText(current)) throw new Error(`“${noteTitle(path)}” is locked. Open and unlock it to change it.`)
  }
  const next = change(current)
  if (next === null || next === current) return false
  if (!applyText(path, next)) await window.api.writeNote(path, next)
  return true
}

/** Makes sure a day's daily note exists (from your template), without opening it. Returns its path. */
export async function ensureDaily(date: Date): Promise<string> {
  const path = dailyPath(date)
  if (!exists(path)) {
    const { text } = newDailyContent(date)
    await window.api.createNoteAt(path)
    await window.api.writeNote(path, text)
  }
  return path
}

/** Adds an event to a day's schedule, creating the daily note if needed. */
export async function addEvent(date: Date, title: string, start?: string, end?: string): Promise<void> {
  if (!title.trim()) return
  const prefs = usePrefs.getState().prefs
  try {
    const path = await ensureDaily(date)
    await editNote(path, (text) => insertEvent(text, prefs.scheduleHeading, formatEventLine(title, start, end)))
    await useVault.getState().refresh([path])
  } catch (err) {
    notify(err)
  }
}

/** Ticks or unticks a task shown in the calendar. */
export async function toggleCalendarTask(item: DatedItem): Promise<void> {
  try {
    await editNote(item.path, (text) => {
      // The line number comes from the last save; if edits since then moved the task, find it by its text.
      const lines = text.split('\n')
      const isTask = (l: string | undefined): boolean => !!l && /^\s*[-*+]\s+\[[ xX]\]/.test(l) && l.includes(item.title)
      const line = isTask(lines[item.line]) ? item.line : lines.findIndex(isTask)
      return line === -1 ? null : toggleTaskAt(text, line)
    })
    await useVault.getState().refresh([item.path])
  } catch (err) {
    notify(err)
  }
}

/** "09:30" → "9:30 am" in 12-hour mode. */
export function displayTime(time: string | undefined, format: Prefs['timeFormat'] = usePrefs.getState().prefs.timeFormat): string {
  if (!time) return ''
  if (format === '24h') return time
  const [h, m] = time.split(':').map(Number)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}
