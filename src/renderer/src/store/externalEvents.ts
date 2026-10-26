import { create } from 'zustand'
import type { CalEvent } from '@shared/types'
import { addDays, dayKey, fromDayKey } from '../lib/dates'

/**
 * Events from Google Calendar and calendar links, for the days the calendars are showing.
 * Fetched (by the main process) per date range, refreshed every 10 minutes and when you come
 * back to the app.
 */

export interface ExternalItem {
  event: CalEvent
  /** Day key this item is shown on (multi-day all-day events appear on each day). */
  date: string
  allDay: boolean
  /** "09:30" local time, for timed events. */
  start?: string
  end?: string
}

interface ExternalState {
  byDay: Map<string, ExternalItem[]>
  errors: string[]
  offline: boolean
  /** Bumped when calendar settings change, so views fetch again. */
  generation: number
}

export const useExternal = create<ExternalState>(() => ({ byDay: new Map(), errors: [], offline: false, generation: 0 }))

const REFRESH_MS = 10 * 60 * 1000
const STALE_ON_FOCUS_MS = 2 * 60 * 1000
const MAX_SPAN_DAYS = 62

/** Range key → when fetched and what came back. */
const ranges = new Map<string, { from: string; to: string; at: number; items: ExternalItem[] }>()
const inFlight = new Map<string, Promise<void>>()

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Splits an event into the day(s) it appears on, in local time. */
export function toItems(e: CalEvent): ExternalItem[] {
  if (e.allDay) {
    const start = fromDayKey(e.start)
    const end = fromDayKey(e.end) ?? (start ? addDays(start, 1) : null)
    if (!start || !end) return []
    const out: ExternalItem[] = []
    for (let d = start, i = 0; d < end && i < MAX_SPAN_DAYS; d = addDays(d, 1), i++) out.push({ event: e, date: dayKey(d), allDay: true })
    return out
  }
  // Timed events show on the day they start; one running past midnight is drawn to the end of that day.
  const s = new Date(e.start)
  const en = new Date(e.end)
  const end = en <= s ? undefined : dayKey(en) === dayKey(s) ? hhmm(en) : '23:59'
  return [{ event: e, date: dayKey(s), allDay: false, start: hhmm(s), end }]
}

function rebuild(): void {
  const byDay = new Map<string, ExternalItem[]>()
  const seen = new Set<string>()
  for (const r of ranges.values()) {
    for (const item of r.items) {
      const id = `${item.event.id}|${item.date}`
      if (seen.has(id)) continue
      seen.add(id)
      const list = byDay.get(item.date)
      if (list) list.push(item)
      else byDay.set(item.date, [item])
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.event.title.localeCompare(b.event.title))
  useExternal.setState({ byDay })
}

async function fetchRange(key: string, from: string, to: string): Promise<void> {
  if (inFlight.has(key)) return inFlight.get(key)
  const job = window.api
    .fetchCalendarEvents(from, to)
    .then(({ events, errors, offline }) => {
      ranges.set(key, { from, to, at: Date.now(), items: events.flatMap(toItems) })
      useExternal.setState({ errors, offline })
      rebuild()
    })
    .catch(() => useExternal.setState({ offline: true }))
    .finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

/** Makes sure events for [from, to) are loaded (call from views when their dates change). */
export function ensureRange(from: Date, to: Date): void {
  const f = from.toISOString()
  const t = to.toISOString()
  const key = `${f}|${t}`
  const known = ranges.get(key)
  if (!known || Date.now() - known.at > REFRESH_MS) fetchRange(key, f, t)
}

/** Fetches everything again (after you connect, disconnect or change which calendars show). */
export function refreshExternal(): void {
  useExternal.setState((s) => ({ generation: s.generation + 1 }))
  const all = [...ranges.values()]
  ranges.clear()
  rebuild()
  for (const r of all) fetchRange(`${r.from}|${r.to}`, r.from, r.to)
}

// Keep things fresh: every 10 minutes, and when you switch back to the app after a while.
setInterval(() => {
  for (const r of ranges.values()) fetchRange(`${r.from}|${r.to}`, r.from, r.to)
}, REFRESH_MS)
window.addEventListener('focus', () => {
  for (const r of ranges.values()) if (Date.now() - r.at > STALE_ON_FOCUS_MS) fetchRange(`${r.from}|${r.to}`, r.from, r.to)
})
