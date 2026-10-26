import { useNoteIndex, getNoteText } from '../store/noteIndex'
import { usePrefs } from '../store/prefs'
import { notify } from '../store/notify'
import { dailyDateOf } from './dailyPaths'
import { dayKey } from './dates'
import { editNote } from './daily'
import { isWithin } from './paths'
import { dueReminders, fillInDates, parseReminders, reminderTime, type Reminder } from './reminders'

/**
 * Watches the notes for reminders and shows a notification when one is due. Reminders that came
 * due while Notes wasn't running (or the computer was asleep) are listed together afterwards.
 * Which ones have gone off is kept in the notes folder, so they don't go off twice.
 */

const FILE = 'reminders.json'
let fired = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null
let filling = false

async function loadFired(): Promise<void> {
  try {
    const raw = await window.api.readAppData(FILE)
    const list: string[] = raw ? (JSON.parse(raw).fired ?? []) : []
    // Forget ones older than a month.
    const cutoff = Date.now() - 31 * 86_400_000
    fired = new Set(list.filter((k) => new Date(k.slice(k.lastIndexOf('|') + 1).replace(' ', 'T')).getTime() > cutoff))
  } catch {
    fired = new Set()
  }
}

const saveFired = (): Promise<void> => window.api.writeAppData(FILE, JSON.stringify({ fired: [...fired] }, null, 2)).catch(() => undefined)

/** Every reminder in every note (templates are skipped: they're not real tasks yet). */
export function allReminders(): { reminders: Reminder[]; undated: Map<string, number[]> } {
  const { templatesFolder } = usePrefs.getState().prefs
  const reminders: Reminder[] = []
  const undated = new Map<string, number[]>()
  for (const path of useNoteIndex.getState().lookup.paths) {
    if (templatesFolder && isWithin(path, templatesFolder)) continue
    const text = getNoteText(path)
    if (!text || !/⏰|remind:/u.test(text)) continue
    const r = parseReminders(text, path, dailyDateOf(path))
    reminders.push(...r.reminders)
    if (r.undated.length) undated.set(path, r.undated)
  }
  return { reminders, undated }
}

async function check(): Promise<void> {
  const { reminders, undated } = allReminders()
  // "⏰ 15:00" outside a daily note means today: write the date in, so it's clear and fires once.
  if (undated.size && !filling) {
    filling = true
    const today = dayKey(new Date())
    for (const [path, lines] of undated) {
      await editNote(path, (text) => fillInDates(text, lines, today)).catch(() => undefined)
    }
    filling = false
  }
  const { due, missed } = dueReminders(reminders, fired, new Date())
  if (!due.length && !missed.length) return
  for (const r of due) {
    window.api.showReminder({ title: r.title || 'Reminder', body: `${r.time} · ${r.path.replace(/\.md$/i, '')}`, path: r.path, line: r.line })
    // In the app too, in case the system hides notifications (Do not disturb, or switched off).
    notify(`⏰ ${r.title || 'Reminder'} (${r.time})`, 'info')
    fired.add(r.key)
  }
  if (missed.length) {
    const names = missed.map((r) => r.title).slice(0, 4).join(', ')
    window.api.showReminder({
      title: `You missed ${missed.length} ${missed.length === 1 ? 'reminder' : 'reminders'}`,
      body: names + (missed.length > 4 ? '…' : ''),
      path: missed[0].path,
      line: missed[0].line
    })
    notify(`Missed while Notes was closed: ${names}${missed.length > 4 ? '…' : ''}`, 'info')
    for (const r of missed) fired.add(r.key)
  }
  await saveFired()
}

/** Starts watching (after a notes folder opens). */
export async function startReminders(): Promise<void> {
  stopReminders()
  await loadFired()
  // Give the note index a moment to load, then check every 20 seconds.
  setTimeout(() => void check(), 4000)
  timer = setInterval(() => void check(), 20_000)
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** For tests: run a check now. */
export const checkRemindersNow = check

/** Reminders still to come, soonest first (for Settings). */
export function upcomingReminders(limit = 8): Reminder[] {
  const now = Date.now()
  return allReminders()
    .reminders.filter((r) => reminderTime(r).getTime() > now && !fired.has(r.key))
    .sort((a, b) => reminderTime(a).getTime() - reminderTime(b).getTime())
    .slice(0, limit)
}