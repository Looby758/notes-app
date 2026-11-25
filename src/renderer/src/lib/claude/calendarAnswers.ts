import { countdownsText } from '@shared/claudeFormat'
import { COUNTDOWN_KINDS, isDate, isTime, type Countdown, type CountdownKind } from '@shared/countdown'
import { describeRepeat, parseRepeat, type RepeatRule } from '@shared/repeat'
import type { CalEvent } from '@shared/types'
import { setPrefs, usePrefs } from '../../store/prefs'
import { itemsByDay } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { toItems, type ExternalItem } from '../../store/externalEvents'
import { addDays, dayKey, fromDayKey } from '../dates'
import { deleteEvent, editNote, endSeriesBefore, moveEvent, skipOccurrence, toggleCalendarTask } from '../daily'
import { createCalendarEvent, deleteGoogle, moveGoogle, updateGoogle } from '../calendarEdit'
import { findEventLine, type DatedItem } from '../schedule'
import { has, locked, needNotes, pickOne, str, type Answer, type Args } from './common'

/**
 * Calendar and countdowns for Claude Desktop: adding events (repeating ones, and into Google
 * calendars), moving, renaming and deleting them, ticking tasks, and changing countdowns.
 */

// ---------- countdowns ----------

const countdowns = (): Countdown[] => usePrefs.getState().prefs.countdowns
const pickCountdown = (want: string): Countdown => pickOne(countdowns(), want, (c) => c.title, 'countdown')

function editCountdownFor(args: Args): string {
  const c = pickCountdown(str(args.countdown))
  const next: Countdown = { ...c }
  if (has(args, 'title')) {
    const title = str(args.title).trim().slice(0, 80)
    if (!title) throw new Error('The new name can’t be empty.')
    next.title = title
  }
  if (has(args, 'date')) {
    if (!isDate(args.date)) throw new Error('The date has to be a real day, like 2026-12-20.')
    next.date = args.date
  }
  if (has(args, 'time')) {
    const t = str(args.time)
    if (t && !isTime(t)) throw new Error('The time has to be like 18:00, or empty for the whole day.')
    next.time = t
  }
  if (has(args, 'kind')) {
    if (!COUNTDOWN_KINDS.some((k) => k.id === args.kind)) throw new Error('The kind has to be season, game, trip, birthday, event or other.')
    next.kind = args.kind as CountdownKind
  }
  if (typeof args.yearly === 'boolean') next.yearly = args.yearly
  setPrefs({ countdowns: countdowns().map((x) => (x.id === c.id ? next : x)) })
  return `Changed the countdown.\n\n${countdownsText([next], new Date())}`
}

function deleteCountdownFor(args: Args): string {
  const c = pickCountdown(str(args.countdown))
  setPrefs({ countdowns: countdowns().filter((x) => x.id !== c.id) })
  return `Deleted the countdown “${c.title}”.`
}

// ---------- which calendar ----------

interface WritableCalendar {
  id: string
  name: string
}

async function googleCalendars(): Promise<{ canEdit: boolean; calendars: WritableCalendar[] }> {
  try {
    const s = await window.api.calendarSources()
    return { canEdit: s.google.canEdit, calendars: s.google.calendars.filter((c) => c.enabled && c.writable).map((c) => ({ id: c.id, name: c.name })) }
  } catch {
    return { canEdit: false, calendars: [] }
  }
}

async function listCalendarsFor(): Promise<string> {
  const g = await googleCalendars()
  const lines = ['Orbit (events written in your daily notes): the default']
  if (g.canEdit) lines.push(...g.calendars.map((c) => `${c.name} (Google)`))
  else lines.push('Google calendars can’t be changed from Orbit yet: the user can allow it in Orbit’s Settings → Calendar.')
  return lines.join('\n')
}

function readRepeat(args: Args): RepeatRule | undefined {
  const words = str(args.repeat).trim()
  if (!words) return undefined
  const rule = parseRepeat(words.replace(/^🔁\s*/u, ''))
  if (!rule) throw new Error(`Orbit can’t read “${words}” as a repeat. Write it like "every Tuesday", "every weekday", "every 2 weeks on Thursday", "every month on the 1st" or "every year", with "until 2027-03-31" if it ends.`)
  return rule
}

async function addEventFor(args: Args): Promise<string> {
  needNotes()
  const date = fromDayKey(str(args.date))
  if (!date) throw new Error('The date has to be like 2026-11-25.')
  const title = str(args.title).trim()
  if (!title) throw new Error('Say what the event is.')
  const start = str(args.start) || undefined
  const end = start ? str(args.end) || undefined : undefined
  if (start && end && end <= start) throw new Error('The end time has to be after the start time.')
  const repeat = readRepeat(args)
  let where = 'Orbit’s calendar'
  let google: string | undefined
  const want = str(args.calendar).trim()
  if (want && !/^orbit$/i.test(want)) {
    const g = await googleCalendars()
    if (!g.canEdit) throw new Error('Orbit isn’t allowed to change Google calendars yet. The user can allow it in Settings → Calendar, or leave out the calendar to use Orbit’s own.')
    const cal = pickOne(g.calendars, want, (c) => c.name, 'calendar')
    google = cal.id
    where = `the “${cal.name}” Google calendar`
  }
  await createCalendarEvent(date, title, start, end, { repeat, target: google ? { google } : {} })
  return `Added “${title}” on ${str(args.date)}${start ? ` at ${start}${end ? `–${end}` : ''}` : ' (all day)'}${repeat ? `, repeating ${describeRepeat(repeat)}` : ''} to ${where}.`
}

// ---------- finding an event ----------

type Found = { kind: 'orbit'; item: DatedItem } | { kind: 'google'; item: ExternalItem }

const titleOf = (f: Found): string => (f.kind === 'orbit' ? f.item.title : f.item.event.title)
const timeOf = (f: Found): string => {
  const start = f.kind === 'orbit' ? f.item.start : f.item.allDay ? undefined : f.item.start
  return start ? ` at ${start}` : ''
}

async function eventsOn(date: string): Promise<Found[]> {
  const found: Found[] = []
  for (const i of itemsByDay(date, date).get(date) ?? []) {
    if (locked(i.path) || i.kind === 'daily' || i.kind === 'note') continue
    found.push({ kind: 'orbit', item: i })
  }
  try {
    const from = fromDayKey(date)!
    const { events } = await window.api.fetchCalendarEvents(from.toISOString(), addDays(from, 1).toISOString())
    for (const e of events as CalEvent[]) for (const it of toItems(e)) if (it.date === date) found.push({ kind: 'google', item: it })
  } catch {
    // No connected calendars: Orbit's own events are still there.
  }
  return found
}

async function findEvent(args: Args): Promise<Found> {
  needNotes()
  const date = str(args.date)
  if (!fromDayKey(date)) throw new Error('The date has to be like 2026-11-25.')
  const all = await eventsOn(date)
  if (!all.length) throw new Error(`There’s nothing on ${date}.`)
  return pickOne(all, str(args.title), (f) => titleOf(f), `event on ${date}`)
}

const stillThere = async (date: string, title: string): Promise<boolean> => (await eventsOn(date)).some((f) => titleOf(f) === title)

function googleEditable(f: Found & { kind: 'google' }): void {
  if (!f.item.event.google?.editable) throw new Error(`“${f.item.event.title}” is in ${f.item.event.calendarName}, which Orbit can’t change. The user can change it in that calendar.`)
}

// ---------- changing events ----------

async function moveEventFor(args: Args): Promise<string> {
  const f = await findEvent(args)
  const date = str(args.date)
  const to = str(args.to_date) || date
  if (!fromDayKey(to)) throw new Error('The new date has to be like 2026-11-25.')
  const allDay = args.all_day === true
  const oldStart = f.kind === 'orbit' ? f.item.start : f.item.start
  const oldEnd = f.kind === 'orbit' ? f.item.end : f.item.end
  const start = allDay ? undefined : str(args.start) || oldStart
  let end = allDay ? undefined : str(args.end) || undefined
  // Keeps how long it lasts when only the start changes.
  if (!end && start && oldStart && oldEnd && start !== oldStart) {
    const mins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    const length = mins(oldEnd) - mins(oldStart)
    const e = mins(start) + length
    if (length > 0 && e < 24 * 60) end = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
  } else if (!end && start === oldStart) end = oldEnd
  if (start && end && end <= start) throw new Error('The end time has to be after the start time.')
  const move = { date: to, start, end }
  if (f.kind === 'google') {
    googleEditable(f)
    await moveGoogle(f.item, move)
  } else {
    if (f.item.kind !== 'event') throw new Error(`“${f.item.title}” is a task or a dated note, not an event, so it can’t be moved from here. Change its date in its note (${f.item.path}).`)
    await moveEvent(f.item, move, args.which === 'one' ? 'one' : 'all')
  }
  const title = titleOf(f)
  if (!(await stillThere(to, title))) throw new Error(`Orbit couldn’t move “${title}”. It may have changed in its note since.`)
  return `Moved “${title}” to ${to}${start ? ` at ${start}${end ? `–${end}` : ''}` : ' (all day)'}${f.kind === 'orbit' && f.item.repeat ? (args.which === 'one' ? ' (just that day)' : ' (every time it repeats)') : ''}.`
}

async function renameEventFor(args: Args): Promise<string> {
  const f = await findEvent(args)
  const name = str(args.new_title).trim()
  if (!name) throw new Error('Say the new name.')
  if (f.kind === 'google') {
    googleEditable(f)
    if (!(await updateGoogle(f.item.event, { title: name }))) throw new Error('Google didn’t take the change.')
    return `Renamed “${f.item.event.title}” to “${name}”.`
  }
  const item = f.item
  const changed = await editNote(
    item.path,
    (text) => {
      const at = findEventLine(text, item)
      const lines = text.split('\n')
      if (at === -1 || !lines[at].includes(item.title)) return null
      lines[at] = lines[at].replace(item.title, name.replace(/\n/g, ' '))
      return lines.join('\n')
    },
    { undo: `Claude renamed “${item.title}”` }
  )
  if (!changed) throw new Error(`Orbit couldn’t find “${item.title}” in its note any more.`)
  await useVault.getState().refresh([item.path])
  return `Renamed “${item.title}” to “${name}”${item.repeat ? ' (every time it repeats)' : ''}.`
}

async function deleteEventFor(args: Args): Promise<string> {
  const f = await findEvent(args)
  const which = str(args.which) || 'all'
  const title = titleOf(f)
  if (f.kind === 'google') {
    googleEditable(f)
    await deleteGoogle(f.item.event)
    return `Deleted “${title}” from ${f.item.event.calendarName}.`
  }
  const item = f.item
  if (item.kind !== 'event') throw new Error(`“${title}” is a task or a dated note, not an event. Use tick_task for a task, or change its note (${item.path}).`)
  if (item.repeat && which === 'one') await skipOccurrence(item)
  else if (item.repeat && which === 'from_here') await endSeriesBefore(item)
  else await deleteEvent(item)
  if (which !== 'from_here' && (await stillThere(str(args.date), title))) throw new Error(`Orbit couldn’t delete “${title}”. It may have changed in its note since.`)
  return item.repeat
    ? which === 'one'
      ? `Took “${title}” off ${str(args.date)} only; it still repeats on other days.`
      : which === 'from_here'
        ? `“${title}” now stops repeating before ${str(args.date)}.`
        : `Deleted “${title}” and every repeat of it. Ctrl+Z in Orbit brings it back.`
    : `Deleted “${title}”${timeOf(f)} on ${str(args.date)}. Ctrl+Z in Orbit brings it back.`
}

async function tickTaskFor(args: Args): Promise<string> {
  const f = await findEvent(args)
  if (f.kind !== 'orbit' || f.item.done === undefined) throw new Error(`“${titleOf(f)}” isn’t a task with a tick box.`)
  const want = args.done !== false
  if (f.item.done === want) return `“${f.item.title}” was already ${want ? 'ticked' : 'not ticked'}.`
  await toggleCalendarTask(f.item)
  return `${want ? 'Ticked' : 'Unticked'} “${f.item.title}”.`
}

function dueTasksFor(args: Args): string {
  needNotes()
  const from = str(args.from) || dayKey(new Date())
  const start = fromDayKey(from)
  if (!start) throw new Error('The first day has to be like 2026-11-25.')
  const to = str(args.to) || dayKey(addDays(start, 30))
  const tasks: string[] = []
  for (const [, items] of itemsByDay(from, to))
    for (const i of items) if (i.done === false && !locked(i.path)) tasks.push(`${i.date}  ${i.title}  (${i.path})`)
  return tasks.length ? tasks.join('\n') : `No unticked tasks with dates between ${from} and ${to}.`
}

export const CALENDAR_ANSWERS: Record<string, Answer> = {
  add_calendar_event: addEventFor,
  list_calendars: listCalendarsFor,
  move_calendar_event: moveEventFor,
  rename_calendar_event: renameEventFor,
  delete_calendar_event: deleteEventFor,
  tick_task: tickTaskFor,
  get_due_tasks: dueTasksFor,
  edit_countdown: editCountdownFor,
  delete_countdown: deleteCountdownFor
}
