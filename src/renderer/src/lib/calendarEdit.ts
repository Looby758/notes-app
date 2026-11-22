import type { CalEvent, GoogleEventInput } from '@shared/types'
import { toExDates, toRRule, type RepeatRule } from '@shared/repeat'
import { addEvent, type EventMove } from './daily'
import { addDays, dayKey, formatDate, fromDayKey } from './dates'
import type { DatedItem } from './schedule'
import { patchExternal, reloadExternal, type ExternalItem } from '../store/externalEvents'
import { notify } from '../store/notify'

/**
 * Making and changing calendar events from the calendar views, wherever they live: a line in a
 * daily note, or an event in one of your Google calendars.
 */

const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone
const local = (d: Date): string => formatDate(d, 'YYYY-MM-DD[T]HH:mm[:00]')
const at = (date: string, time: string): Date => {
  const [h, m] = time.split(':').map(Number)
  const d = fromDayKey(date)!
  d.setHours(h, m, 0, 0)
  return d
}

/** Where a new event goes: your notes, or a Google calendar (by id). */
export type EventTarget = { google?: undefined } | { google: string }

/** Adds a new event on `date`, in your notes or in Google Calendar. */
export async function createCalendarEvent(
  date: Date,
  title: string,
  start: string | undefined,
  end: string | undefined,
  { repeat, target }: { repeat?: RepeatRule; target?: EventTarget } = {}
): Promise<void> {
  if (!target?.google) return addEvent(date, title, start, end, repeat)
  const key = dayKey(date)
  try {
    const input: GoogleEventInput = start
      ? {
          title,
          allDay: false,
          start: local(at(key, start)),
          // No end time: an hour, like Google does.
          end: local(end ? at(key, end) : new Date(at(key, start).getTime() + 3600_000)),
          timeZone: timeZone()
        }
      : { title, allDay: true, start: key, end: dayKey(addDays(date, 1)), timeZone: timeZone() }
    if (repeat) input.recurrence = [toRRule(repeat, key), ...toExDates(repeat)]
    await window.api.googleCreateEvent(target.google, input)
    reloadExternal()
  } catch (err) {
    notify(err)
  }
}

/** Can this be dragged around / edited from Orbit? */
export const canMoveLocal = (item: DatedItem): boolean => item.kind === 'event'
export const canEditGoogle = (e: CalEvent): boolean => !!e.google?.editable

/**
 * Moves or resizes a Google event to `to` (a day and, for timed events, the new start/end).
 * A repeating event's day is changed on its own (that's what Google's own "This event" does).
 */
export async function moveGoogle(item: ExternalItem, to: EventMove): Promise<void> {
  const e = item.event
  if (!e.google) return
  let change: GoogleEventInput
  if (item.allDay || !to.start) {
    // All-day events keep how many days they last.
    const days = Math.max(1, Math.round((fromDayKey(e.end)!.getTime() - fromDayKey(e.start)!.getTime()) / 86_400_000)) || 1
    const first = item.allDay ? shiftKey(e.start, daysFrom(item.date, to.date)) : to.date
    change = { title: e.title, allDay: true, start: first, end: shiftKey(first, item.allDay ? days : 1), timeZone: timeZone() }
  } else {
    const start = at(to.date, to.start)
    const end = to.end ? at(to.date, to.end) : new Date(start.getTime() + (new Date(e.end).getTime() - new Date(e.start).getTime()))
    change = { title: e.title, allDay: false, start: local(start), end: local(end), timeZone: timeZone() }
  }
  await updateGoogle(e, change)
}

/** Saves changes to a Google event (shown straight away, then fetched again). */
export async function updateGoogle(e: CalEvent, change: Partial<GoogleEventInput>): Promise<boolean> {
  if (!e.google) return false
  const before = e
  patchExternal(e.id, (old) => ({
    ...old,
    ...(change.title !== undefined ? { title: change.title } : {}),
    ...(change.location !== undefined ? { location: change.location || undefined } : {}),
    ...(change.start !== undefined && change.end !== undefined
      ? change.allDay
        ? { allDay: true, start: change.start, end: change.end }
        : { allDay: false, start: new Date(change.start).toISOString(), end: new Date(change.end).toISOString() }
      : {})
  }))
  try {
    await window.api.googleUpdateEvent(e.google.calendarId, e.google.eventId, change)
    reloadExternal()
    return true
  } catch (err) {
    patchExternal(e.id, () => before)
    notify(err)
    return false
  }
}

export async function deleteGoogle(e: CalEvent): Promise<void> {
  if (!e.google) return
  patchExternal(e.id, () => null)
  try {
    await window.api.googleDeleteEvent(e.google.calendarId, e.google.eventId)
  } catch (err) {
    notify(err)
  }
  reloadExternal()
}

const shiftKey = (key: string, days: number): string => dayKey(addDays(fromDayKey(key)!, days))
const daysFrom = (a: string, b: string): number => Math.round((fromDayKey(b)!.getTime() - fromDayKey(a)!.getTime()) / 86_400_000)
