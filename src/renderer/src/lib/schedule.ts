import { maskCode } from './links'
import { parseFrontmatter } from './tags'
import { dayKey, fromDayKey } from './dates'
import { REMINDER } from './reminders'

/**
 * Finding dated things in notes, for the calendar:
 * - a daily note is on its own date
 * - `date:` / `due:` in frontmatter puts a note on that date
 * - tasks with a due date: `- [ ] Pay rent 📅 2026-10-30` or `- [ ] Pay rent due:2026-10-30`
 * - events: list items under a "Schedule" heading in a daily note:
 *     - 09:30-10:30 Standup     (timed)
 *     - 14:00 Dentist           (a point in time)
 *     - Holiday                 (all day)
 */

export type DatedKind = 'daily' | 'note' | 'due' | 'event'

export interface DatedItem {
  kind: DatedKind
  /** Day key, e.g. "2026-10-26". */
  date: string
  path: string
  /** 0-based line in the note (for jumping there). */
  line: number
  title: string
  /** "09:30" (24-hour). Missing for all-day items. */
  start?: string
  end?: string
  /** For tasks (and events written as tasks). */
  done?: boolean
  /** Frontmatter `due:` rather than `date:`. */
  due?: boolean
}

const DATE = /(\d{4}-\d{2}-\d{2})/
const TASK_DUE = /(?:📅\s*|\bdue::?\s*)(\d{4}-\d{2}-\d{2})/u
const LIST_ITEM = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/
const TIME = '(\\d{1,2})(?::(\\d{2}))?\\s*([ap]\\.?m\\.?)?'
const TIME_RANGE = new RegExp(`^${TIME}(?:\\s*[-–—]\\s*${TIME})?\\s+(.+)$`, 'i')

/** "9", "30", "pm" → "21:30" (or null if it's not a real time). */
function toTime(h: string, m: string | undefined, ap: string | undefined): string | null {
  let hour = Number(h)
  const minute = m ? Number(m) : 0
  if (ap) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (/p/i.test(ap) ? 12 : 0)
  }
  if (hour > 23 || minute > 59) return null
  // A bare number with no minutes and no am/pm ("3 books") isn't a time.
  if (!m && !ap) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Reads one schedule line's text ("09:30-10:30 Standup") into times and a title. */
export function parseEventText(text: string): { start?: string; end?: string; title: string } {
  const m = TIME_RANGE.exec(text.trim())
  if (m) {
    const start = toTime(m[1], m[2], m[3] ?? m[6])
    const end = m[4] ? toTime(m[4], m[5], m[6]) : null
    if (start) return { start, ...(end ? { end } : {}), title: m[7].trim() }
  }
  return { title: text.trim() }
}

function isScheduleHeading(line: string, heading: string): number {
  const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
  return m && m[2].toLowerCase() === heading.toLowerCase() ? m[1].length : 0
}

export function parseDatedItems(
  text: string,
  path: string,
  opts: { dailyDate: string | null; scheduleHeading: string; title: string }
): DatedItem[] {
  const items: DatedItem[] = []
  const { dailyDate, scheduleHeading, title } = opts

  if (dailyDate) items.push({ kind: 'daily', date: dailyDate, path, line: 0, title })

  // Frontmatter date: / due:
  const fm = parseFrontmatter(text)
  if (fm.end) {
    const yaml = text.slice(0, fm.end)
    for (const key of ['date', 'due'] as const) {
      const m = new RegExp(`^${key}\\s*:\\s*["']?${DATE.source}`, 'mi').exec(yaml)
      if (m && fromDayKey(m[1])) items.push({ kind: 'note', date: m[1], path, line: 0, title, due: key === 'due' })
    }
  }

  const lines = maskCode(text).split('\n')
  const raw = text.split('\n')
  let scheduleLevel = 0 // > 0 while inside the schedule section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = /^(#{1,6})\s/.exec(line)
    if (heading) {
      const level = isScheduleHeading(line, scheduleHeading)
      if (level) scheduleLevel = level
      else if (scheduleLevel && heading[1].length <= scheduleLevel) scheduleLevel = 0
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (!item) continue
    const check = item[1]
    const body = raw[i].replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
    const done = check === undefined ? undefined : check !== ' '

    // A due date on a task wins (it can be anywhere, in any note).
    const due = check !== undefined ? TASK_DUE.exec(body) : null
    if (due && fromDayKey(due[1])) {
      items.push({ kind: 'due', date: due[1], path, line: i, title: body.replace(TASK_DUE, '').replace(REMINDER, '').trim(), done })
      continue
    }
    // A reminder (⏰ date time) shows on its day, at its time.
    const remind = check !== undefined ? REMINDER.exec(body) : null
    const remindDate = remind ? (remind[1] ?? dailyDate) : null
    if (remind && remindDate && fromDayKey(remindDate) && Number(remind[2]) < 24) {
      const event = parseEventText(body.replace(REMINDER, ''))
      const start = event.start ?? `${remind[2].padStart(2, '0')}:${remind[3]}`
      items.push({ kind: 'due', date: remindDate, path, line: i, title: `⏰ ${event.title.trim()}`, done, start, ...(event.end ? { end: event.end } : {}) })
      continue
    }
    if (scheduleLevel && dailyDate && body.trim()) {
      items.push({ kind: 'event', date: dailyDate, path, line: i, ...parseEventText(body), ...(done !== undefined ? { done } : {}) })
    }
  }
  return items
}

/** Sort key for a day's items: all-day first, then by time. */
export function compareItems(a: DatedItem, b: DatedItem): number {
  const order: Record<DatedKind, number> = { daily: 0, note: 1, due: 2, event: 3 }
  const ta = a.start ?? ''
  const tb = b.start ?? ''
  if (!ta !== !tb) return ta ? 1 : -1
  return ta.localeCompare(tb) || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title)
}

/** "09:30", "10:30", "Standup" → "- 09:30-10:30 Standup" */
export function formatEventLine(title: string, start?: string, end?: string): string {
  const time = start ? (end ? `${start}-${end} ` : `${start} `) : ''
  return `- ${time}${title.trim()}`
}

/**
 * Adds an event line under the schedule heading (creating the heading at the end if there isn't
 * one), keeping timed events in time order.
 */
export function insertEvent(text: string, heading: string, line: string): string {
  const lines = text.split('\n')
  const newTime = parseEventText(line.replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '')).start ?? ''
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const l = isScheduleHeading(lines[i], heading)
    if (l) {
      start = i
      level = l
      break
    }
  }
  if (start === -1) {
    // No schedule yet: add one at the end.
    const body = text.replace(/\s+$/, '')
    return `${body}${body ? '\n\n' : ''}## ${heading}\n\n${line}\n`
  }
  // Find the end of the section and the right spot among its list items.
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = /^(#{1,6})\s/.exec(lines[i])
    if (h && h[1].length <= level) {
      end = i
      break
    }
  }
  let insertAt = -1
  let lastItem = -1
  for (let i = start + 1; i < end; i++) {
    const m = LIST_ITEM.exec(lines[i])
    if (!m) continue
    lastItem = i
    const t = parseEventText(lines[i].replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '')).start ?? ''
    // Before the first later-timed item (all-day items stay at the top).
    if (insertAt === -1 && newTime && t && t > newTime) insertAt = i
  }
  if (insertAt === -1) insertAt = lastItem !== -1 ? lastItem + 1 : start + 1
  if (lastItem === -1) {
    // Empty section: put the item after the heading with a blank line between.
    lines.splice(start + 1, lines[start + 1] === '' ? 1 : 0, '', line)
    return lines.join('\n')
  }
  lines.splice(insertAt, 0, line)
  return lines.join('\n')
}

/**
 * Adds lines at the end of the section under `heading` (any level), or, with no such heading,
 * adds the heading at the end of the note first. With heading '' the lines go at the end of the note.
 */
export function appendUnderHeading(text: string, heading: string, add: string): string {
  const body = text.replace(/\s+$/, '')
  if (!heading) {
    // Straight after another list item: no gap. After a heading or paragraph: a blank line.
    const lastLine = body.slice(body.lastIndexOf('\n') + 1)
    const gap = !body ? '' : /^\s*([-*+]|\d+[.)])\s/.test(lastLine) ? '\n' : '\n\n'
    return `${body}${gap}${add}\n`
  }
  const lines = text.split('\n')
  const start = lines.findIndex((l) => isScheduleHeading(l, heading) > 0)
  if (start === -1) return `${body}${body ? '\n\n' : ''}## ${heading}\n\n${add}\n`
  const level = isScheduleHeading(lines[start], heading)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = /^(#{1,6})\s/.exec(lines[i])
    if (h && h[1].length <= level) {
      end = i
      break
    }
  }
  // After the section's last non-empty line (or right under the heading, with a blank line).
  let last = start
  for (let i = start + 1; i < end; i++) if (lines[i].trim()) last = i
  const insert = last === start ? ['', ...add.split('\n')] : add.split('\n')
  lines.splice(last + 1, 0, ...insert)
  // Keep a blank line before the next heading.
  const after = last + 1 + insert.length
  if (after < lines.length && lines[after].trim() && /^#{1,6}\s/.test(lines[after])) lines.splice(after, 0, '')
  return lines.join('\n')
}

/** Ticks or unticks the task on `line` (0-based). Returns null if that line isn't a task. */
export function toggleTaskAt(text: string, line: number): string | null {
  const lines = text.split('\n')
  const m = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/.exec(lines[line] ?? '')
  if (!m) return null
  lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]
  return lines.join('\n')
}

/** Today's day key. */
export const todayKey = (): string => dayKey(new Date())
