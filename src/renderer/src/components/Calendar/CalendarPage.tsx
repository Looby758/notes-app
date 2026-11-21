import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import Private, { usePrivateTitle } from '../Streamer/Private'
import { useUI, type CalendarView } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { addDays, dayKey, formatDate, fromDayKey, monthGrid, startOfWeek } from '../../lib/dates'
import { displayTime, openDaily } from '../../lib/daily'
import { openNote } from '../../lib/editorController'
import { canEditGoogle, createCalendarEvent, moveGoogle } from '../../lib/calendarEdit'
import type { DatedItem } from '../../lib/schedule'
import type { ExternalItem } from '../../store/externalEvents'
import { describeRepeat } from '@shared/repeat'
import { DayList, ExternalStatus, QuickAdd, showEventDetails, useExternalRange, useItemsByDay, weekdayNames } from './shared'
import { dropOnDay, isEventDrag, moveLocalEvent, showEventMenu } from './edit'
import { DayWeather, EventWeather } from '../Weather/Weather'

const HOUR_PX = 44
const MONTH_MAX_ITEMS = 3
/** Dragged events snap to quarter hours. */
const SNAP_MIN = 15
const DAY_MIN = 24 * 60

interface AddAt {
  date: Date
  x: number
  y: number
  start?: string
  end?: string
}

const minutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const hhmm = (mins: number): string => {
  const m = Math.max(0, Math.min(mins, 23 * 60 + 59))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const snap = (mins: number): number => Math.round(mins / SNAP_MIN) * SNAP_MIN

/** The full calendar tab: month, week and day views, with click-to-add and drag-to-move. */
export default function CalendarPage() {
  const view = useUI((s) => s.calendarView)
  const selected = useUI((s) => s.calendarDay)
  const weekStart = usePrefs((s) => s.prefs.weekStart) as 0 | 1
  const anchor = fromDayKey(selected) ?? new Date()
  const [adding, setAdding] = useState<AddAt | null>(null)
  const page = useRef<HTMLDivElement>(null)

  const go = (step: number): void => {
    const next =
      view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + step, 1) : addDays(anchor, step * (view === 'week' ? 7 : 1))
    useUI.setState({ calendarDay: dayKey(next) })
  }
  const setView = (v: CalendarView): void => useUI.setState({ calendarView: v })

  const weekFirst = startOfWeek(anchor, weekStart)
  const title =
    view === 'month'
      ? formatDate(anchor, 'MMMM YYYY')
      : view === 'day'
        ? formatDate(anchor, 'dddd D MMMM YYYY')
        : `${formatDate(weekFirst, 'D MMM')} – ${formatDate(addDays(weekFirst, 6), 'D MMM YYYY')}`
  const unit = view === 'month' ? 'month' : view === 'week' ? 'week' : 'day'

  /** Opens the add-event box at the pointer, relative to the page. */
  const startAdding = (e: MouseEvent, date: Date, start?: string, end?: string): void => {
    const r = page.current!.getBoundingClientRect()
    setAdding({ date, x: e.clientX - r.left, y: e.clientY - r.top, start, end })
  }

  // Esc or clicking elsewhere closes the add box.
  useEffect(() => {
    if (!adding) return
    const onDown = (e: globalThis.MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.cal-popover')) setAdding(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [adding])

  return (
    <div className="cal-page" ref={page}>
      <div className="cal-toolbar">
        <button className="btn" onClick={() => useUI.setState({ calendarDay: dayKey(new Date()) })}>
          Today
        </button>
        <button className="icon-btn" title={`Previous ${unit}`} onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" title={`Next ${unit}`} onClick={() => go(1)}>
          <ChevronRight size={16} />
        </button>
        <h2 className="cal-title-text">{title}</h2>
        <ExternalStatus />
        <div className="segmented">
          <button className={view === 'month' ? 'selected' : ''} onClick={() => setView('month')}>
            Month
          </button>
          <button className={view === 'week' ? 'selected' : ''} onClick={() => setView('week')}>
            Week
          </button>
          <button className={view === 'day' ? 'selected' : ''} onClick={() => setView('day')}>
            Day
          </button>
        </div>
      </div>

      {view === 'month' ? (
        <MonthView anchor={anchor} weekStart={weekStart} onAdd={startAdding} />
      ) : (
        <TimelineView days={view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekFirst, i)) : [anchor]} onAdd={startAdding} />
      )}

      {adding && (
        <div
          className="cal-popover"
          style={{
            left: Math.min(adding.x, (page.current?.clientWidth ?? 800) - 360),
            top: Math.min(adding.y, (page.current?.clientHeight ?? 600) - 190)
          }}
        >
          <div className="cal-popover-date">{formatDate(adding.date, 'dddd D MMMM')}</div>
          <QuickAdd
            date={adding.date}
            initialStart={adding.start}
            initialEnd={adding.end}
            onSave={async (t, s, en, extra) => {
              const date = adding.date
              setAdding(null)
              await createCalendarEvent(date, t, s, en, extra)
            }}
            onCancel={() => setAdding(null)}
          />
        </div>
      )}
    </div>
  )
}

/** Lets a day (cell or column) take events dropped on it. */
function dropProps(key: string, setOver: (k: string | null) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!isEventDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOver(key)
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      setOver(null)
      dropOnDay(e, key)
    }
  }
}

function MonthView({ anchor, weekStart, onAdd }: { anchor: Date; weekStart: 0 | 1; onAdd: (e: MouseEvent, d: Date) => void }) {
  const selected = useUI((s) => s.calendarDay)
  const createOnClick = usePrefs((s) => s.prefs.createDailyOnClick)
  const days = monthGrid(anchor.getFullYear(), anchor.getMonth(), weekStart)
  const byDay = useItemsByDay(dayKey(days[0]), dayKey(days[days.length - 1]))
  const external = useExternalRange(days[0], addDays(days[days.length - 1], 1))
  const [over, setOver] = useState<string | null>(null)
  const today = dayKey(new Date())
  return (
    <div className="cal-month">
      {weekdayNames(weekStart).map((w) => (
        <div key={w} className="cal-weekday">
          {w}
        </div>
      ))}
      {days.map((d) => {
        const key = dayKey(d)
        const items = (byDay.get(key) ?? []).filter((i) => i.kind !== 'daily')
        const ext = external.get(key) ?? []
        const daily = (byDay.get(key) ?? []).some((i) => i.kind === 'daily')
        const extra = items.length + ext.length - MONTH_MAX_ITEMS
        return (
          <div
            key={key}
            data-day={key}
            className={`cal-cell ${d.getMonth() !== anchor.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''} ${over === key ? 'drop-over' : ''}`}
            onClick={(e) => {
              useUI.setState({ calendarDay: key })
              // Clicking empty space in a day adds an event there.
              if (e.target === e.currentTarget) onAdd(e, d)
            }}
            {...dropProps(key, setOver)}
          >
            <button
              className={`cal-date ${daily ? 'has-daily' : ''}`}
              title={daily ? 'Open daily note' : 'Create daily note'}
              onClick={(e) => {
                e.stopPropagation()
                useUI.setState({ calendarDay: key })
                openDaily(d, { create: createOnClick || daily })
              }}
            >
              {d.getDate()}
            </button>
            <DayWeather date={key} />
            <DayList local={items} external={ext} compact limit={MONTH_MAX_ITEMS} />
            {extra > 0 && (
              <button
                className="cal-more"
                onClick={(e) => {
                  e.stopPropagation()
                  useUI.setState({ calendarDay: key, calendarView: 'day' })
                }}
              >
                +{extra} more
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Something drawn in the timeline: an event from a note, or one from Google / a calendar link. */
interface Block {
  key: string
  start: string
  end?: string
  title: string
  date: string
  color?: string
  done?: boolean
  repeat?: string
  local?: DatedItem
  external?: ExternalItem
  /** Can be dragged to move it and resized from its bottom edge. */
  movable: boolean
  onClick: (e: MouseEvent) => void
}

/** Splits a day's timed events into side-by-side lanes where they overlap. */
function layoutEvents(items: Block[]): { item: Block; top: number; height: number; lane: number; lanes: number }[] {
  const timed = items
    .map((i) => {
      const start = minutes(i.start)
      const end = Math.max(i.end ? minutes(i.end) : start + 30, start + 30)
      return { item: i, start, end, lane: 0 }
    })
    .sort((a, b) => a.start - b.start)
  const laneEnds: number[] = []
  for (const ev of timed) {
    let lane = laneEnds.findIndex((end) => end <= ev.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = ev.end
    ev.lane = lane
  }
  const lanes = Math.max(1, laneEnds.length)
  return timed.map((ev) => ({
    item: ev.item,
    top: (ev.start / 60) * HOUR_PX,
    height: Math.max(((ev.end - ev.start) / 60) * HOUR_PX - 2, 18),
    lane: ev.lane,
    lanes
  }))
}

/** Where a dragged event would land (shown while dragging and until the change is saved). */
interface DragPreview {
  key: string
  date: string
  start: number
  end: number
  hasEnd: boolean
}

interface Gesture {
  block: Block
  mode: 'move' | 'resize'
  x: number
  y: number
  start: number
  end: number
  moved: boolean
}

/** The week and day views: an all-day row, then a 24-hour timeline per day. */
function TimelineView({ days, onAdd }: { days: Date[]; onAdd: (e: MouseEvent, d: Date, start?: string, end?: string) => void }) {
  const privateTitle = usePrivateTitle()
  const first = days[0]
  const last = days[days.length - 1]
  const byDay = useItemsByDay(dayKey(first), dayKey(last))
  const createOnClick = usePrefs((s) => s.prefs.createDailyOnClick)
  usePrefs((s) => s.prefs.timeFormat)
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())
  const external = useExternalRange(first, addDays(last, 1))
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const today = dayKey(now)
  const single = days.length === 1

  /** Timed things for a day, from notes and from your calendars. */
  const blocksFor = (key: string): Block[] => [
    ...(byDay.get(key) ?? [])
      .filter((i) => i.start)
      .map((i) => ({
        key: `l:${i.path}:${i.line}:${key}`,
        start: i.start!,
        end: i.end,
        title: i.title,
        date: key,
        done: i.done,
        repeat: i.repeat ? describeRepeat(i.repeat) : undefined,
        local: i,
        movable: i.kind === 'event',
        onClick: () => openNote(i.path, { line: i.line })
      })),
    ...(external.get(key) ?? [])
      .filter((x) => !x.allDay && x.start)
      .map((x) => ({
        key: `e:${x.event.id}:${key}`,
        start: x.start!,
        end: x.end,
        title: x.event.title,
        date: key,
        color: x.event.color,
        external: x,
        movable: canEditGoogle(x.event),
        onClick: (e: MouseEvent) => showEventDetails(x, e.clientX, e.clientY)
      }))
  ]

  // All the days' blocks, with the one being dragged shown where it would land.
  const blocks = new Map(days.map((d) => [dayKey(d), blocksFor(dayKey(d))]))
  if (preview) {
    let moving: Block | undefined
    for (const [k, list] of blocks) {
      const found = list.find((b) => b.key === preview.key)
      if (found) {
        moving = found
        blocks.set(k, list.filter((b) => b !== found))
      }
    }
    if (moving && blocks.has(preview.date)) {
      blocks.get(preview.date)!.push({ ...moving, date: preview.date, start: hhmm(preview.start), end: preview.hasEnd ? hhmm(preview.end) : undefined })
    }
  }

  const dayAt = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const col = (el as HTMLElement).closest?.('.cal-day-col') as HTMLElement | null
      if (col?.dataset.day) return col.dataset.day
    }
    return null
  }

  const onPointerDown = (e: PointerEvent, block: Block): void => {
    if (e.button !== 0 || !block.movable) return
    const start = minutes(block.start)
    const end = block.end ? minutes(block.end) : start + 30
    gesture.current = {
      block,
      mode: (e.target as HTMLElement).closest('.cal-event-resize') ? 'resize' : 'move',
      x: e.clientX,
      y: e.clientY,
      start,
      end: Math.max(end, start + SNAP_MIN),
      moved: false
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent): void => {
    const g = gesture.current
    if (!g) return
    if (!g.moved && Math.abs(e.clientX - g.x) < 4 && Math.abs(e.clientY - g.y) < 4) return
    g.moved = true
    const delta = snap(((e.clientY - g.y) / HOUR_PX) * 60)
    if (g.mode === 'resize') {
      const end = Math.min(DAY_MIN, Math.max(g.start + SNAP_MIN, g.end + delta))
      setPreview({ key: g.block.key, date: g.block.date, start: g.start, end, hasEnd: true })
      return
    }
    const length = g.end - g.start
    const start = Math.max(0, Math.min(DAY_MIN - SNAP_MIN, g.start + delta))
    setPreview({
      key: g.block.key,
      date: dayAt(e.clientX, e.clientY) ?? g.block.date,
      start,
      end: Math.min(DAY_MIN, start + length),
      hasEnd: !!g.block.end || start + length > DAY_MIN
    })
  }

  const onPointerUp = async (e: PointerEvent): Promise<void> => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (!g.moved) {
      g.block.onClick(e)
      return
    }
    const p = preview
    if (!p) return
    const to = { date: p.date, start: hhmm(p.start), end: p.hasEnd ? hhmm(p.end) : undefined }
    try {
      if (g.block.local) await moveLocalEvent(g.block.local, to, e.clientX, e.clientY)
      else if (g.block.external) await moveGoogle(g.block.external, to)
    } finally {
      setPreview(null)
    }
  }

  // Start scrolled to 8 am, and keep the "now" line moving.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX - 8
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`cal-week ${single ? 'cal-single-day' : ''}`} style={{ ['--cal-cols' as string]: days.length }}>
      <div className="cal-week-head">
        <div className="cal-gutter" />
        {days.map((d) => {
          const key = dayKey(d)
          const daily = (byDay.get(key) ?? []).some((i) => i.kind === 'daily')
          return (
            <button
              key={key}
              className={`cal-week-day ${key === today ? 'today' : ''}`}
              onClick={() => {
                useUI.setState({ calendarDay: key })
                openDaily(d, { create: createOnClick || daily })
              }}
              title={daily ? 'Open daily note' : 'Create daily note'}
            >
              <span>{formatDate(d, single ? 'dddd' : 'ddd')}</span>
              <strong className={daily ? 'has-daily' : ''}>{d.getDate()}</strong>
              <DayWeather date={key} />
            </button>
          )
        })}
      </div>
      <div className="cal-allday">
        <div className="cal-gutter">all day</div>
        {days.map((d) => {
          const key = dayKey(d)
          const items = (byDay.get(key) ?? []).filter((i) => !i.start && i.kind !== 'daily')
          const ext = (external.get(key) ?? []).filter((x) => x.allDay)
          return (
            <div
              key={key}
              className={`cal-allday-cell ${over === key ? 'drop-over' : ''}`}
              onClick={(e) => e.target === e.currentTarget && onAdd(e, d)}
              {...dropProps(key, setOver)}
            >
              <DayList local={items} external={ext} compact={!single} />
            </div>
          )
        })}
      </div>
      <div className="cal-week-body" ref={scroller}>
        <div className="cal-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal-hour" style={{ height: HOUR_PX }}>
              {h > 0 && displayTime(`${String(h).padStart(2, '0')}:00`)}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const key = dayKey(d)
          return (
            <div
              key={key}
              data-day={key}
              className={`cal-day-col ${key === today ? 'today' : ''}`}
              style={{ height: 24 * HOUR_PX }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return
                // Snap to the half hour you clicked; events default to an hour long.
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                const start = Math.floor(((y / HOUR_PX) * 60) / 30) * 30
                onAdd(e, d, hhmm(start), hhmm(start + 60))
              }}
            >
              {layoutEvents(blocks.get(key) ?? []).map(({ item, top, height, lane, lanes }) => (
                <button
                  key={item.key}
                  // Short events put the time and title on one line so the title stays visible.
                  className={`cal-event ${item.done ? 'done' : ''} ${height < 36 ? 'short' : ''} ${item.color ? 'external' : ''} ${item.movable ? 'movable' : ''} ${preview?.key === item.key ? 'dragging' : ''}`}
                  style={{
                    top,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    ...(item.color ? { ['--event-color' as string]: item.color } : {})
                  }}
                  onPointerDown={(e) => onPointerDown(e, item)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    gesture.current = null
                    setPreview(null)
                  }}
                  // Clicks are handled on pointer up (so a drag doesn't also open the event); keyboard still works.
                  onClick={(e) => e.detail === 0 && item.onClick(e)}
                  onContextMenu={(e) => {
                    if (!item.local) return
                    e.preventDefault()
                    showEventMenu(item.local, e.clientX, e.clientY)
                  }}
                  title={privateTitle(
                    `${displayTime(item.start)}${item.end ? '–' + displayTime(item.end) : ''} ${item.title}${item.repeat ? `\n🔁 ${item.repeat}` : ''}${item.movable ? '\nDrag to move, drag the bottom edge to change how long' : ''}`
                  )}
                >
                  <span className="cal-event-time">
                    {displayTime(item.start)}
                    {item.end && preview?.key === item.key && `–${displayTime(item.end)}`}
                    {item.repeat && <Repeat size={10} className="cal-repeat-icon" aria-label="Repeats" />}
                    <EventWeather title={item.title} date={item.date} start={item.start} compact />
                  </span>
                  <span className="cal-event-title">
                    <Private>{item.title}</Private>
                  </span>
                  {item.movable && <span className="cal-event-resize" aria-hidden />}
                </button>
              ))}
              {key === today && <div className="cal-now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
