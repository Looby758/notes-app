import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, CalendarPlus, Clock, ExternalLink, FileText, Flag } from 'lucide-react'
import Private, { usePrivateTitle } from '../Streamer/Private'
import { itemsByDay, useNoteIndex } from '../../store/noteIndex'
import { usePrefs } from '../../store/prefs'
import { ensureRange, useExternal, type ExternalItem } from '../../store/externalEvents'
import { openNote } from '../../lib/editorController'
import { addEvent, displayTime, toggleCalendarTask } from '../../lib/daily'
import { addDays, dayKey, formatDate, fromDayKey } from '../../lib/dates'
import { useMoney } from '../../store/money'
import { allRecurring, occurrences } from '../../lib/moneyInsights'
import { formatPounds } from '../../lib/money'
import type { DatedItem } from '../../lib/schedule'
import { EventWeather } from '../Weather/Weather'

/** Calendar items by day, recomputed whenever any note changes. */
export function useItemsByDay(): Map<string, DatedItem[]> {
  const version = useNoteIndex((s) => s.version)
  // `version` changes whenever the index changes.
  return useMemo(() => itemsByDay(), [version])
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Weekday names starting from your first day of the week. */
export function weekdayNames(weekStart: number): string[] {
  return [...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)]
}

function timeLabel(item: DatedItem): string {
  if (!item.start) return ''
  return item.end ? `${displayTime(item.start)}–${displayTime(item.end)}` : displayTime(item.start)
}

/** One row in an agenda: an event, a task with a due date, a dated note, or the daily note. */
export function ItemRow({ item, compact = false }: { item: DatedItem; compact?: boolean }) {
  usePrefs((s) => s.prefs.timeFormat) // re-render when the time format changes
  const open = (): void => openNote(item.path, item.kind === 'daily' || item.kind === 'note' ? {} : { line: item.line })
  const isTask = item.done !== undefined
  const privateTitle = usePrivateTitle()
  return (
    <div className={`cal-item ${item.kind} ${item.done ? 'done' : ''} ${compact ? 'compact' : ''}`} title={privateTitle(`${item.title}\n${item.path}`)}>
      {isTask ? (
        <input
          type="checkbox"
          className="cal-check"
          checked={item.done}
          onChange={() => toggleCalendarTask(item)}
          onClick={(e) => e.stopPropagation()}
          aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
        />
      ) : (
        <span className="cal-item-icon">
          {item.kind === 'daily' ? (
            <CalendarDays size={12} />
          ) : item.kind === 'event' ? (
            <Clock size={12} />
          ) : item.due ? (
            <Flag size={12} />
          ) : (
            <FileText size={12} />
          )}
        </span>
      )}
      <button className="cal-item-text" onClick={open}>
        {/* In small calendar cells only the start time fits next to the title. */}
        {item.start && <span className="cal-time">{compact ? displayTime(item.start) : timeLabel(item)}</span>}
        <span className="cal-title">{item.kind === 'daily' ? 'Daily note' : <Private>{item.title}</Private>}</span>
        {item.kind === 'note' && item.due && !compact && <span className="cal-badge">due</span>}
      </button>
      {/* Small calendar cells have no room: the day's own forecast shows there instead. */}
      {item.kind !== 'daily' && !compact && <EventWeather title={item.title} date={item.date} start={item.start} />}
    </div>
  )
}

/** Loads Google/link events for [from, to) and returns all external events by day, with bills and paydays from Money. */
export function useExternalRange(from: Date, to: Date): Map<string, ExternalItem[]> {
  const fromKey = from.getTime()
  const toKey = to.getTime()
  const generation = useExternal((s) => s.generation)
  useEffect(() => {
    ensureRange(new Date(fromKey), new Date(toKey))
  }, [fromKey, toKey, generation])
  const byDay = useExternal((s) => s.byDay)
  const bills = useBillItems(from, to)
  return useMemo(() => {
    if (!bills.length) return byDay
    const merged = new Map(byDay)
    for (const item of bills) merged.set(item.date, [item, ...(merged.get(item.date) ?? [])])
    return merged
  }, [byDay, bills])
}

/** Repeating payments and paydays the money tracker found, as all-day calendar items. */
function useBillItems(from: Date, to: Date): ExternalItem[] {
  const entries = useMoney((s) => s.entries)
  const notRecurring = useMoney((s) => s.notRecurring)
  const subscriptions = useMoney((s) => s.subscriptions)
  const cancelled = useMoney((s) => s.cancelled)
  const fromDay = dayKey(from)
  const toDay = dayKey(new Date(to.getTime() - 1))
  return useMemo(() => {
    const today = dayKey(new Date())
    const items: ExternalItem[] = []
    for (const r of allRecurring({ entries, notRecurring, subscriptions, cancelled }, today)) {
      // Only from today on: earlier ones are already in your spending log.
      for (const date of occurrences(r, fromDay > today ? fromDay : today, toDay)) {
        const end = dayKey(addDays(fromDayKey(date)!, 1))
        items.push({
          date,
          allDay: true,
          event: {
            id: `money:${r.income ? 'in' : 'out'}:${r.key}`,
            sourceId: 'money',
            calendarName: r.income ? 'Payday (from Money)' : 'Bill (from Money)',
            color: r.income ? '#199e70' : '#c98500',
            title: `${r.income ? '💷' : '🧾'} ${r.name} ${formatPounds(r.amount)}`,
            allDay: true,
            start: date,
            end
          }
        })
      }
    }
    return items
  }, [entries, notRecurring, subscriptions, cancelled, fromDay, toDay])
}

/** "Offline, showing saved events" / "Your Google sign-in expired…", when there's something to say. */
export function ExternalStatus() {
  const errors = useExternal((s) => s.errors)
  const offline = useExternal((s) => s.offline)
  if (!errors.length && !offline) return null
  return (
    <div className="cal-ext-status" title={errors.join('\n')}>
      {offline ? 'Offline: showing saved calendar events.' : errors[0]}
    </div>
  )
}

/** An event from Google Calendar or a calendar link (read-only); click for details. */
export function ExternalRow({ item, compact = false }: { item: ExternalItem; compact?: boolean }) {
  usePrefs((s) => s.prefs.timeFormat)
  const e = item.event
  const privateTitle = usePrivateTitle()
  return (
    <div className={`cal-item external ${compact ? 'compact' : ''}`} title={privateTitle(`${e.title}\n${e.calendarName}`)}>
      <span className="cal-ext-bar" style={{ background: e.color }} />
      <button
        className="cal-item-text"
        onClick={(ev) => {
          ev.stopPropagation()
          showEventDetails(item, ev.clientX, ev.clientY)
        }}
      >
        {item.start && (
          <span className="cal-time" style={{ color: e.color }}>
            {compact || !item.end ? displayTime(item.start) : `${displayTime(item.start)}–${displayTime(item.end)}`}
          </span>
        )}
        <span className="cal-title">
          <Private>{e.title}</Private>
        </span>
      </button>
      {!compact && <EventWeather title={e.title} date={item.date} start={item.allDay ? undefined : item.start} />}
    </div>
  )
}

/** A day's notes items and external events in one list: all-day first, then by time. */
export function DayList({ local, external, compact = false, limit }: { local: DatedItem[]; external: ExternalItem[]; compact?: boolean; limit?: number }) {
  const rows = [
    ...local.map((item) => ({ key: `l:${item.path}:${item.line}:${item.kind}`, start: item.start ?? '', node: <ItemRow item={item} compact={compact} /> })),
    ...external.map((item) => ({ key: `e:${item.event.id}`, start: item.start ?? '', node: <ExternalRow item={item} compact={compact} /> }))
  ].sort((a, b) => (!a.start !== !b.start ? (a.start ? 1 : -1) : a.start.localeCompare(b.start)))
  const shown = limit !== undefined ? rows.slice(0, limit) : rows
  return (
    <>
      {shown.map((r) => (
        <Fragment key={r.key}>{r.node}</Fragment>
      ))}
    </>
  )
}

// ---------- event details card ----------

interface Details {
  item: ExternalItem
  x: number
  y: number
}
let setDetails: ((d: Details | null) => void) | null = null

export function showEventDetails(item: ExternalItem, x: number, y: number): void {
  setDetails?.({ item, x, y })
}

/** The card shown when you click a Google/link event. Mounted once by the Shell. */
export function EventDetails() {
  const [details, set] = useState<Details | null>(null)
  const card = useRef<HTMLDivElement>(null)
  setDetails = set
  useEffect(() => {
    if (!details) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !card.current?.contains(e.target as Node)) set(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [details])
  if (!details) return null
  const { item, x, y } = details
  const e = item.event
  const date = fromDayKey(item.date)!
  const when = item.allDay
    ? formatDate(date, 'dddd D MMMM') + ' · all day'
    : `${formatDate(date, 'dddd D MMMM')} · ${displayTime(item.start)}${item.end ? '–' + displayTime(item.end) : ''}`
  return (
    <div
      ref={card}
      className="event-card"
      style={{ left: Math.min(x, window.innerWidth - 330), top: Math.min(y + 8, window.innerHeight - 220) }}
      role="dialog"
      aria-label={e.title}
    >
      <div className="event-card-title">
        <span className="cal-color" style={{ background: e.color }} />
        {e.title}
      </div>
      <div className="event-card-line">{when}</div>
      {e.location && <div className="event-card-line">📍 {e.location}</div>}
      <div className="event-card-line faint">{e.calendarName} · read-only</div>
      <div className="event-card-actions">
        <button
          className="btn"
          onClick={async () => {
            set(null)
            await addEvent(date, e.title, item.allDay ? undefined : item.start, item.allDay ? undefined : item.end)
          }}
          title="Copy this event into that day's daily note"
        >
          <CalendarPlus size={13} /> Add to daily note
        </button>
        {e.url && (
          <button className="btn" onClick={() => window.open(e.url)}>
            <ExternalLink size={13} /> Open in Google Calendar
          </button>
        )}
      </div>
    </div>
  )
}

/** A small form to add an event to a day: title, and optional start/end times. */
export function QuickAdd({
  onSave,
  onCancel,
  initialStart = '',
  initialEnd = '',
  autoFocus = true
}: {
  onSave: (title: string, start?: string, end?: string) => void
  onCancel: () => void
  initialStart?: string
  initialEnd?: string
  autoFocus?: boolean
}) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!title.trim()) return
    onSave(title.trim(), start || undefined, start && end && end > start ? end : undefined)
  }

  return (
    <form
      className="quick-add"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <input ref={input} className="quick-add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event, e.g. Lunch with Sam" />
      <div className="quick-add-row">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
        <span>to</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" />
        <span className="quick-add-hint">{start ? '' : 'All day'}</span>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
          Add
        </button>
      </div>
    </form>
  )
}
