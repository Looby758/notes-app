import { maskCode } from './links'

/**
 * Reminders: a task with an alarm clock and a time.
 *   - [ ] Call the dentist ⏰ 2026-10-28 15:00
 *   - [ ] Stand-up ⏰ 09:30            (in a daily note: that day; elsewhere Notes fills in today's date)
 * When the time comes, Notes shows a notification. Ticked tasks don't remind.
 */

export interface Reminder {
  path: string
  /** 0-based line. */
  line: number
  /** The task text without the ⏰ part. */
  title: string
  /** "2026-10-28" */
  date: string
  /** "15:00" */
  time: string
  /** Same reminder, same moment: used to remember it has gone off. */
  key: string
}

/** ⏰ (or "remind:"), then an optional date, then a time. */
export const REMINDER = /(?:⏰️?|\bremind:)\s*(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{1,2}):(\d{2})\b/u
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/

const pad = (n: number): string => String(n).padStart(2, '0')

export function parseReminders(text: string, path: string, dailyDate: string | null): { reminders: Reminder[]; undated: number[] } {
  const reminders: Reminder[] = []
  const undated: number[] = []
  const lines = maskCode(text).split('\n')
  lines.forEach((l, i) => {
    const task = TASK.exec(l)
    if (!task || task[1] !== ' ') return
    const m = REMINDER.exec(task[2])
    if (!m) return
    const [h, min] = [Number(m[2]), Number(m[3])]
    if (h > 23 || min > 59) return
    const date = m[1] ?? dailyDate
    if (!date) {
      undated.push(i)
      return
    }
    const time = `${pad(h)}:${m[3]}`
    const title = task[2].replace(REMINDER, '').replace(/\s{2,}/g, ' ').trim()
    reminders.push({ path, line: i, title, date, time, key: `${path}|${title}|${date} ${time}` })
  })
  return { reminders, undated }
}

/** When a reminder goes off. */
export const reminderTime = (r: Pick<Reminder, 'date' | 'time'>): Date => {
  const [y, mo, d] = r.date.split('-').map(Number)
  const [h, m] = r.time.split(':').map(Number)
  return new Date(y, mo - 1, d, h, m)
}

/** Adds today's date to `⏰ 15:00` reminders on these lines (outside daily notes a bare time means today). */
export function fillInDates(text: string, lines: number[], today: string): string {
  const all = text.split('\n')
  for (const i of lines) {
    if (all[i] !== undefined) all[i] = all[i].replace(/(⏰️?|\bremind:)(\s*)(\d{1,2}:\d{2})/u, `$1$2${today} $3`)
  }
  return all.join('\n')
}

/**
 * Sorts reminders into ones due now (time reached within the last couple of minutes) and ones
 * missed (time passed while Notes wasn't running), skipping ones that already went off.
 */
export function dueReminders(all: Reminder[], fired: Set<string>, now: Date, missedWithinDays = 7): { due: Reminder[]; missed: Reminder[] } {
  const due: Reminder[] = []
  const missed: Reminder[] = []
  for (const r of all) {
    if (fired.has(r.key)) continue
    const at = reminderTime(r).getTime()
    const late = now.getTime() - at
    if (late < 0) continue
    if (late <= 2 * 60_000) due.push(r)
    else if (late <= missedWithinDays * 86_400_000) missed.push(r)
  }
  return { due, missed }
}
