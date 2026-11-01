import type { Prefs } from '@shared/prefs'
import { addDays, formatDate, fromDayKey } from './dates'
import { fillTemplate } from './templates'
import { formatEventLine, insertEvent, toggleTaskAt, type DatedItem } from './schedule'
import { applyText, getOpenText, isNoteTab, openNote } from './editorController'
import { findNode, noteTitle } from './paths'
import { isLockedText } from './lock/crypto'
import { readFrontmatter } from './properties'
import { dailyDateOf, dailyPath } from './dailyPaths'
import { usePrefs } from '../store/prefs'
import { useVault } from '../store/vault'
import { useEditor } from '../store/editor'
import { getNoteText, normalizeText } from '../store/noteIndex'
import { notify } from '../store/notify'
import { recordUndo } from './undo'

export { dailyDateOf, dailyPath }

const exists = (path: string): boolean => findNode(useVault.getState().tree, path)?.type === 'file'

const DATE_HEADING = '# {{date:dddd D MMMM YYYY}}\n\n'

/**
 * With "keep the date heading" on, a daily template that doesn't start with a heading of its own
 * gets the usual date heading on top (after its properties, if it has any). The properties block
 * (icon, banner and the rest) always stays the very first thing in the note, or it stops being
 * properties: that includes one with spaces after a fence, a `...` closing line, or no newline
 * after the closing `---`.
 */
export function withDateHeading(template: string, keep: boolean): string {
  const fm = readFrontmatter(template)
  let front = fm ? template.slice(0, fm.to) : ''
  if (front && !front.endsWith('\n')) front += '\n'
  const body = fm ? template.slice(fm.to) : template
  if (!keep || /^\s*#\s/.test(body)) return front + body
  return front + DATE_HEADING + body.replace(/^\s*\n/, '')
}

const templateFile = (name: string): string => (/\.md$/i.test(name) ? name : `${name}.md`)

/**
 * The daily template's current text: from the editor if it's open (so an icon or banner you just
 * picked counts before it's saved), else from disk, else from the search index.
 */
async function readTemplate(path: string): Promise<string | undefined> {
  const open = getOpenText(path)
  if (open !== null) return normalizeText(open)
  if (exists(path)) {
    try {
      const text = normalizeText(await window.api.readNote(path))
      if (!isLockedText(text)) return text
    } catch {
      // fall back to the index below
    }
  }
  return getNoteText(path)
}

/** What a brand-new daily note starts with: your daily template, or just a title. */
async function newDailyContent(date: Date): Promise<{ text: string; cursor: number | null }> {
  const prefs = usePrefs.getState().prefs
  const title = formatDate(date, prefs.dailyFormat)
  const templatePath = prefs.dailyTemplate ? templateFile(prefs.dailyTemplate) : ''
  const template = templatePath ? await readTemplate(templatePath) : undefined
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
  const { text, cursor } = await newDailyContent(date)
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
 * kept), else on disk. With `undo`, Ctrl+Z outside the note puts the text back (named by `undo`).
 */
export async function editNote(path: string, change: (text: string) => string | null, { undo }: { undo?: string } = {}): Promise<boolean> {
  let current = getOpenText(path)
  if (current === null) {
    current = normalizeText(await window.api.readNote(path))
    if (isLockedText(current)) throw new Error(`“${noteTitle(path)}” is locked. Open and unlock it to change it.`)
  }
  const next = change(current)
  if (next === null || next === current) return false
  if (!applyText(path, next)) await window.api.writeNote(path, next)
  if (undo) {
    const before = current
    recordUndo({ label: undo, undo: () => swapText(path, next, before), redo: () => swapText(path, before, next) })
  }
  return true
}

/** For Ctrl+Z: puts `to` back, as long as the note still reads `from` (typing since would be lost). */
async function swapText(path: string, from: string, to: string): Promise<void> {
  await editNote(path, (text) => {
    if (text !== from) throw new Error(`“${noteTitle(path)}” has changed since, so that can’t be undone.`)
    return to
  })
  await useVault.getState().refresh([path])
}

/** Makes sure a day's daily note exists (from your template), without opening it. Returns its path. */
export async function ensureDaily(date: Date): Promise<string> {
  const path = dailyPath(date)
  if (!exists(path)) {
    const { text } = await newDailyContent(date)
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
    await editNote(path, (text) => insertEvent(text, prefs.scheduleHeading, formatEventLine(title, start, end)), { undo: `Added “${title.trim()}” to the calendar` })
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
    }, { undo: `${item.done ? 'Unticked' : 'Ticked'} “${item.title}”` })
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
