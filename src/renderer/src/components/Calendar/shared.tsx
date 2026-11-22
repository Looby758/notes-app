import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, CalendarPlus, Clock, ExternalLink, FileText, Flag, Pencil, Repeat, Trash2 } from 'lucide-react'
import Private, { usePrivateTitle } from '../Streamer/Private'
import { itemsByDay, useNoteIndex } from '../../store/noteIndex'
import { usePrefs } from '../../store/prefs'
import { ensureRange, useExternal, type ExternalItem } from '../../store/externalEvents'
import { openNote, openSpecialTab, VIDEOS_TAB } from '../../lib/editorController'
import { selectProject, useVideos } from '../../store/videos'
import { stageLabel, uploadsBetween } from '../../lib/videos'
import { addEvent, displayTime, toggleCalendarTask } from '../../lib/daily'
import { addDays, dayKey, formatDate, fromDayKey } from '../../lib/dates'
import { useMoney } from '../../store/money'
import { allRecurring, occurrences } from '../../lib/moneyInsights'
import { formatPounds } from '../../lib/money'
import type { DatedItem } from '../../lib/schedule'
import { EventWeather } from '../Weather/Weather'
import type { CalEvent } from '@shared/types'
import { describeRepeat, repeatChoices, type RepeatRule } from '@shared/repeat'
import { canEditGoogle, deleteGoogle, updateGoogle, type EventTarget } from '../../lib/calendarEdit'
import { allowGoogleEditing, openCalendarSettings, showEventMenu, startDayDrag, useCalendarStatus, useWritableCalendars } from './edit'

/**
 * Calendar items by day, recomputed whenever any note changes. Repeating events are filled in
 * between `from` and `to` (day keys) as well as the usual months around today.
 */
export function useItemsByDay(from?: string, to?: string): Map<string, DatedItem[]> {
  const version = useNoteIndex((s) => s.version)
  // `version` changes whenever the index changes.
  return useMemo(() => {
    if (!from || !to) return itemsByDay()
    // Always cover the next year too, so the side panel and agenda keep working while you look far back.
    const today = dayKey(new Date())
    const year = dayKey(addDays(new Date(), 400))
    return itemsByDay(from < today ? from : today, to > year ? to : year)
  }, [version, from, to])
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
  const movable = item.kind === 'event'
  return (
    <div
      className={`cal-item ${item.kind} ${item.done ? 'done' : ''} ${compact ? 'compact' : ''}`}
      title={privateTitle(`${item.title}${item.repeat ? `\n🔁 ${describeRepeat(item.repeat)}` : ''}\n${item.path}`)}
      draggable={movable}
      onDragStart={movable ? (e) => startDayDrag(e, { local: item }) : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        showEventMenu(item, e.clientX, e.clientY)
      }}
    >
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
        {item.repeat && <Repeat size={10} className="cal-repeat-icon" aria-label="Repeats" />}
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
  const uploads = useUploadItems(from, to)
  return useMemo(() => {
    if (!bills.length && !uploads.length) return byDay
    const merged = new Map(byDay)
    for (const item of [...bills, ...uploads]) merged.set(item.date, [item, ...(merged.get(item.date) ?? [])])
    return merged
  }, [byDay, bills, uploads])
}

const VIDEO_EVENT = 'videos:'

/** Video projects' upload days (planned, or when they went up), as all-day calendar items. */
function useUploadItems(from: Date, to: Date): ExternalItem[] {
  const projects = useVideos((s) => s.projects)
  const fromDay = dayKey(from)
  const toDay = dayKey(new Date(to.getTime() - 1))
  return useMemo(
    () =>
      uploadsBetween(projects, fromDay, toDay).map(({ date, project: p }) => {
        const up = p.stage === 'uploaded'
        return {
          date,
          allDay: true,
          event: {
            id: VIDEO_EVENT + p.id,
            sourceId: 'videos',
            calendarName: 'Video projects',
            color: up ? '#199e70' : '#e5484d',
            title: `🎬 ${up ? 'Went up' : 'Upload'}: ${p.title || 'Untitled video'}${up ? '' : ` (${stageLabel(p.stage)})`}`,
            allDay: true,
            start: date,
            end: dayKey(addDays(fromDayKey(date)!, 1))
          }
        }
      }),
    [projects, fromDay, toDay]
  )
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
  const movable = canEditGoogle(e)
  return (
    <div
      className={`cal-item external ${compact ? 'compact' : ''}`}
      title={privateTitle(`${e.title}\n${e.calendarName}`)}
      draggable={movable}
      onDragStart={movable ? (ev) => startDayDrag(ev, { external: item }) : undefined}
    >
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
  // A video's upload day opens the video itself.
  if (item.event.id.startsWith(VIDEO_EVENT)) {
    selectProject(item.event.id.slice(VIDEO_EVENT.length))
    openSpecialTab(VIDEOS_TAB)
    return
  }
  setDetails?.({ item, x, y })
}

/** The card shown when you click a Google/link event. Mounted once by the Shell. */
export function EventDetails() {
  const [details, set] = useState<Details | null>(null)
  const [editing, setEditing] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  setDetails = (d) => {
    setEditing(false)
    set(d)
  }
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
  const editable = canEditGoogle(e)
  const recurring = !!e.google?.recurring
  const when = item.allDay
    ? formatDate(date, 'dddd D MMMM') + ' · all day'
    : `${formatDate(date, 'dddd D MMMM')} · ${displayTime(item.start)}${item.end ? '–' + displayTime(item.end) : ''}`
  return (
    <div
      ref={card}
      className="event-card"
      style={{ left: Math.min(x, window.innerWidth - 330), top: Math.min(y + 8, window.innerHeight - (editing ? 330 : 220)) }}
      role="dialog"
      aria-label={e.title}
    >
      {editing ? (
        <EditGoogleEvent
          item={item}
          onDone={() => {
            setEditing(false)
            set(null)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="event-card-title">
            <span className="cal-color" style={{ background: e.color }} />
            {e.title}
          </div>
          <div className="event-card-line">{when}</div>
          {e.location && <div className="event-card-line">📍 {e.location}</div>}
          {recurring && <div className="event-card-line">🔁 Repeats</div>}
          <div className="event-card-line faint">
            {e.calendarName}
            {editable ? '' : ' · read-only'}
          </div>
          {!editable && <ReadOnlyHint event={e} onAct={() => set(null)} />}
          <div className="event-card-actions">
            {editable && (
              <button className="btn" onClick={() => setEditing(true)} title={recurring ? 'Changes this day only' : undefined}>
                <Pencil size={13} /> Edit
              </button>
            )}
            {editable && (
              <button
                className="btn"
                onClick={async () => {
                  set(null)
                  await deleteGoogle(e)
                }}
                title={recurring ? 'Deletes this day only' : 'Deletes it from Google Calendar'}
              >
                <Trash2 size={13} /> {recurring ? 'Delete this day' : 'Delete'}
              </button>
            )}
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
        </>
      )}
    </div>
  )
}

/** Why an event can't be changed from Orbit, and the button that fixes it when there is one. */
function ReadOnlyHint({ event, onAct }: { event: CalEvent; onAct: () => void }) {
  const status = useCalendarStatus()
  if (!status || event.sourceId === 'money' || event.sourceId === 'videos') return null
  const g = status.google
  let text: string
  let button: { label: string; run: () => void } | null = null
  if (event.sourceId.startsWith('feed:')) {
    text = g.connected && g.canEdit ? 'This comes from a calendar link, which Orbit can only read. Events from your Google sign-in can be edited.' : 'This comes from a calendar link, which Orbit can only read. To edit Google events here, connect Google in Settings → Calendar.'
    if (!g.connected || !g.canEdit) button = { label: 'Open calendar settings', run: openCalendarSettings }
  } else if (g.connected && !g.canEdit) {
    text = 'Orbit can only read your Google Calendar so far.'
    button = { label: 'Allow editing', run: () => void allowGoogleEditing() }
  } else if (!g.connected) {
    text = 'Your Google sign-in has ended. Connect again to see and edit events.'
    button = { label: 'Open calendar settings', run: openCalendarSettings }
  } else return null // a calendar shared with you as view-only
  return (
    <div className="event-card-hint">
      {text}
      {button && (
        <button
          className="link-btn"
          onClick={() => {
            onAct()
            button!.run()
          }}
        >
          {button.label}
        </button>
      )}
    </div>
  )
}

/** Changing a Google event's name, day, times and place, from its card. */
function EditGoogleEvent({ item, onDone, onCancel }: { item: ExternalItem; onDone: () => void; onCancel: () => void }) {
  const e = item.event
  const [title, setTitle] = useState(e.title)
  const [day, setDay] = useState(item.date)
  const [start, setStart] = useState(item.allDay ? '' : (item.start ?? ''))
  const [end, setEnd] = useState(item.allDay ? '' : (item.end ?? ''))
  const [location, setLocation] = useState(e.location ?? '')
  const [saving, setSaving] = useState(false)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const valid = !!title.trim() && !!fromDayKey(day) && (!start || !end || end > start)

  const save = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault()
    if (!valid) return
    setSaving(true)
    const d = fromDayKey(day)!
    let times: { allDay: boolean; start: string; end: string }
    if (!start) {
      // All day: keep how many days it lasts if it was all day already.
      const span = item.allDay ? Math.max(1, Math.round((fromDayKey(e.end)!.getTime() - fromDayKey(e.start)!.getTime()) / 86_400_000)) : 1
      const first = item.allDay ? dayKey(addDays(fromDayKey(e.start)!, Math.round((d.getTime() - fromDayKey(item.date)!.getTime()) / 86_400_000))) : day
      times = { allDay: true, start: first, end: dayKey(addDays(fromDayKey(first)!, span)) }
    } else {
      const endTime = end || addHour(start)
      // An end before the start (e.g. 23:00–01:00) runs into the next day.
      const endDay = endTime > start ? day : dayKey(addDays(d, 1))
      times = { allDay: false, start: `${day}T${start}:00`, end: `${endDay}T${endTime}:00` }
    }
    const ok = await updateGoogle(e, { title: title.trim(), location: location.trim(), timeZone: tz, ...times })
    setSaving(false)
    if (ok) onDone()
  }

  return (
    <form className="event-edit" onSubmit={save} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), onCancel())}>
      <input className="quick-add-title" value={title} onChange={(ev) => setTitle(ev.target.value)} aria-label="Event name" autoFocus />
      <div className="quick-add-row">
        <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} aria-label="Day" />
      </div>
      <div className="quick-add-row">
        <input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} aria-label="Start time" />
        <span>to</span>
        <input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} aria-label="End time" />
        <span className="quick-add-hint">{start ? '' : 'All day'}</span>
      </div>
      <input className="quick-add-title" value={location} onChange={(ev) => setLocation(ev.target.value)} placeholder="Where (optional)" aria-label="Where" />
      {e.google?.recurring && <div className="event-card-line faint">Changes this day only. Open it in Google Calendar to change every one.</div>}
      <div className="event-card-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Save to Google'}
        </button>
      </div>
    </form>
  )
}

const addHour = (t: string): string => {
  const [h, m] = t.split(':').map(Number)
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h + 1 > 23 ? 59 : m).padStart(2, '0')}`
}

/** In the add box: how to get Google calendars into the "add to" menu. */
function GoogleAddHint() {
  const status = useCalendarStatus()
  if (!status) return null
  const g = status.google
  if (g.connected && !g.canEdit)
    return (
      <button type="button" className="link-btn quick-add-google" onClick={() => void allowGoogleEditing()} title="Sign in to Google again and allow Orbit to add events">
        Add to Google too? Allow editing
      </button>
    )
  if (!g.connected)
    return (
      <button type="button" className="link-btn quick-add-google" onClick={openCalendarSettings} title="Connect Google Calendar in Settings">
        Add to Google Calendar…
      </button>
    )
  return null
}

export interface QuickAddExtra {
  repeat?: RepeatRule
  target?: EventTarget
}

const TARGET_KEY = 'orbit.calendar.addTo'
function savedTarget(): string {
  try {
    return localStorage.getItem(TARGET_KEY) ?? ''
  } catch {
    return ''
  }
}

/** A small form to add an event to a day: title, optional start/end times, repeat, and where it goes. */
export function QuickAdd({
  onSave,
  onCancel,
  date,
  initialStart = '',
  initialEnd = '',
  autoFocus = true
}: {
  onSave: (title: string, start: string | undefined, end: string | undefined, extra: QuickAddExtra) => void
  onCancel: () => void
  /** The day it's for (words the repeat choices, e.g. "Every Tuesday"). */
  date: Date
  initialStart?: string
  initialEnd?: string
  autoFocus?: boolean
}) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [repeatIndex, setRepeatIndex] = useState(0)
  const calendars = useWritableCalendars()
  const [target, setTarget] = useState(savedTarget)
  const input = useRef<HTMLInputElement>(null)
  const choices = useMemo(() => repeatChoices(dayKey(date)), [date])
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])
  // A calendar that's gone (or can't be added to any more) falls back to your notes.
  const google = calendars.find((c) => c.id === target)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!title.trim()) return
    const repeat = choices[repeatIndex]?.rule ?? undefined
    onSave(title.trim(), start || undefined, start && end && end > start ? end : undefined, { repeat, target: google ? { google: google.id } : {} })
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
      </div>
      <div className="quick-add-row">
        <Repeat size={13} className="quick-add-icon" />
        <select value={repeatIndex} onChange={(e) => setRepeatIndex(Number(e.target.value))} aria-label="Repeat">
          {choices.map((c, i) => (
            <option key={c.label} value={i}>
              {c.label}
            </option>
          ))}
        </select>
        {calendars.length === 0 && <GoogleAddHint />}
        {calendars.length > 0 && (
          <select
            value={google ? google.id : ''}
            onChange={(e) => {
              setTarget(e.target.value)
              try {
                localStorage.setItem(TARGET_KEY, e.target.value)
              } catch {
                // only a convenience
              }
            }}
            aria-label="Add to"
            title="Where the event is saved"
          >
            <option value="">Orbit (daily note)</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                Google: {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="quick-add-row quick-add-buttons">
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
