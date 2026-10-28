import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Private, { usePrivateTitle } from '../Streamer/Private'
import { useUI, type CalendarView } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { addDays, dayKey, formatDate, fromDayKey, monthGrid, startOfWeek } from '../../lib/dates'
import { addEvent, displayTime, openDaily } from '../../lib/daily'
import { openNote } from '../../lib/editorController'
import { DayList, ExternalStatus, QuickAdd, showEventDetails, useExternalRange, useItemsByDay, weekdayNames } from './shared'
import { DayWeather, EventWeather } from '../Weather/Weather'

const HOUR_PX = 44
const MONTH_MAX_ITEMS = 3

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

/** The full calendar tab: month and week views, with click-to-add. */
export default function CalendarPage() {
  const view = useUI((s) => s.calendarView)
  const selected = useUI((s) => s.calendarDay)
  const weekStart = usePrefs((s) => s.prefs.weekStart) as 0 | 1
  const anchor = fromDayKey(selected) ?? new Date()
  const [adding, setAdding] = useState<AddAt | null>(null)
  const page = useRef<HTMLDivElement>(null)

  const go = (step: number): void => {
    const next =
      view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + step, 1) : addDays(anchor, step * 7)
    useUI.setState({ calendarDay: dayKey(next) })
  }
  const setView = (v: CalendarView): void => useUI.setState({ calendarView: v })

  const weekFirst = startOfWeek(anchor, weekStart)
  const title =
    view === 'month'
      ? formatDate(anchor, 'MMMM YYYY')
      : `${formatDate(weekFirst, 'D MMM')} – ${formatDate(addDays(weekFirst, 6), 'D MMM YYYY')}`

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
        <button className="icon-btn" title={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn" title={view === 'month' ? 'Next month' : 'Next week'} onClick={() => go(1)}>
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
        </div>
      </div>

      {view === 'month' ? (
        <MonthView anchor={anchor} weekStart={weekStart} onAdd={startAdding} />
      ) : (
        <WeekView first={weekFirst} weekStart={weekStart} onAdd={startAdding} />
      )}

      {adding && (
        <div
          className="cal-popover"
          style={{
            left: Math.min(adding.x, (page.current?.clientWidth ?? 800) - 360),
            top: Math.min(adding.y, (page.current?.clientHeight ?? 600) - 150)
          }}
        >
          <div className="cal-popover-date">{formatDate(adding.date, 'dddd D MMMM')}</div>
          <QuickAdd
            initialStart={adding.start}
            initialEnd={adding.end}
            onSave={async (t, s, en) => {
              const date = adding.date
              setAdding(null)
              await addEvent(date, t, s, en)
            }}
            onCancel={() => setAdding(null)}
          />
        </div>
      )}
    </div>
  )
}

function MonthView({ anchor, weekStart, onAdd }: { anchor: Date; weekStart: 0 | 1; onAdd: (e: MouseEvent, d: Date) => void }) {
  const byDay = useItemsByDay()
  const selected = useUI((s) => s.calendarDay)
  const createOnClick = usePrefs((s) => s.prefs.createDailyOnClick)
  const days = monthGrid(anchor.getFullYear(), anchor.getMonth(), weekStart)
  const external = useExternalRange(days[0], addDays(days[days.length - 1], 1))
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
            className={`cal-cell ${d.getMonth() !== anchor.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}`}
            onClick={(e) => {
              useUI.setState({ calendarDay: key })
              // Clicking empty space in a day adds an event there.
              if (e.target === e.currentTarget) onAdd(e, d)
            }}
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
                  useUI.setState({ calendarDay: key, calendarView: 'week' })
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

/** Something drawn in the week grid: an event from a note, or one from Google / a calendar link. */
interface Block {
  key: string
  start: string
  end?: string
  title: string
  date: string
  color?: string
  done?: boolean
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

function WeekView({ first, onAdd }: { first: Date; weekStart: 0 | 1; onAdd: (e: MouseEvent, d: Date, start?: string, end?: string) => void }) {
  const privateTitle = usePrivateTitle()
  const byDay = useItemsByDay()
  const createOnClick = usePrefs((s) => s.prefs.createDailyOnClick)
  usePrefs((s) => s.prefs.timeFormat)
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
  const external = useExternalRange(first, addDays(first, 7))
  const today = dayKey(now)

  /** Timed things for a day, from notes and from your calendars. */
  const blocksFor = (key: string): Block[] => [
    ...(byDay.get(key) ?? [])
      .filter((i) => i.start)
      .map((i) => ({
        key: `l:${i.path}:${i.line}`,
        start: i.start!,
        end: i.end,
        title: i.title,
        date: key,
        done: i.done,
        onClick: () => openNote(i.path, { line: i.line })
      })),
    ...(external.get(key) ?? [])
      .filter((x) => !x.allDay && x.start)
      .map((x) => ({
        key: `e:${x.event.id}`,
        start: x.start!,
        end: x.end,
        title: x.event.title,
        date: key,
        color: x.event.color,
        onClick: (e: MouseEvent) => showEventDetails(x, e.clientX, e.clientY)
      }))
  ]

  // Start scrolled to 8 am, and keep the "now" line moving.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX - 8
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="cal-week">
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
              <span>{formatDate(d, 'ddd')}</span>
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
              className="cal-allday-cell"
              onClick={(e) => e.target === e.currentTarget && onAdd(e, d)}
            >
              <DayList local={items} external={ext} compact />
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
              {layoutEvents(blocksFor(key)).map(({ item, top, height, lane, lanes }) => (
                <button
                  key={item.key}
                  // Short events put the time and title on one line so the title stays visible.
                  className={`cal-event ${item.done ? 'done' : ''} ${height < 36 ? 'short' : ''} ${item.color ? 'external' : ''}`}
                  style={{
                    top,
                    height,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                    ...(item.color ? { ['--event-color' as string]: item.color } : {})
                  }}
                  onClick={(e) => item.onClick(e)}
                  title={privateTitle(`${displayTime(item.start)}${item.end ? '–' + displayTime(item.end) : ''} ${item.title}`)}
                >
                  <span className="cal-event-time">
                    {displayTime(item.start)}
                    <EventWeather title={item.title} date={item.date} start={item.start} compact />
                  </span>
                  <span className="cal-event-title">
                    <Private>{item.title}</Private>
                  </span>
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
