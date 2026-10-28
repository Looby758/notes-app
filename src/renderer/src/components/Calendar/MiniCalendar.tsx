import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, FileText, History, Maximize2, Plus } from 'lucide-react'
import Private from '../Streamer/Private'
import { useHideNames } from '../../store/streamer'
import { useUI } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { addDays, dayKey, formatDate, fromDayKey, monthGrid } from '../../lib/dates'
import { addEvent, dailyPath, openDaily } from '../../lib/daily'
import { CALENDAR_TAB, openNote, openSpecialTab } from '../../lib/editorController'
import { earlierDays } from '../../lib/onThisDay'
import type { DatedItem } from '../../lib/schedule'
import { findNode } from '../../lib/paths'
import { showKeys } from '@shared/platform'
import { DayList, ExternalStatus, QuickAdd, useExternalRange, useItemsByDay, weekdayNames } from './shared'

/**
 * "On this day": daily notes and dated notes from the same date in earlier months and years.
 * Hidden when there aren't any.
 */
function OnThisDay({ date, byDay }: { date: Date; byDay: Map<string, DatedItem[]> }) {
  const hideNames = useHideNames()
  const groups = earlierDays(date)
    .map((d) => ({ ...d, items: (byDay.get(d.key) ?? []).filter((i) => i.kind === 'daily' || i.kind === 'note') }))
    .filter((g) => g.items.length)
  if (groups.length === 0) return null
  return (
    <div className="on-this-day" data-on-this-day>
      <div className="on-this-day-head">
        <History size={13} /> On this day
      </div>
      {groups.map((g) => (
        <div key={g.key} className="on-this-day-group">
          <span className="on-this-day-when" title={formatDate(fromDayKey(g.key)!, 'dddd D MMMM YYYY')}>
            {g.label}
          </span>
          {g.items.map((i) => (
            <button key={i.path + i.kind} className="on-this-day-item" onClick={() => openNote(i.path)} title={hideNames ? undefined : i.path}>
              <FileText size={12} /> {i.kind === 'daily' ? formatDate(fromDayKey(g.key)!, 'dddd D MMMM YYYY') : <Private when={hideNames}>{i.title}</Private>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** A month grid in the side panel, with the selected day's agenda underneath. */
export default function MiniCalendar() {
  const selected = useUI((s) => s.calendarDay)
  const weekStart = usePrefs((s) => s.prefs.weekStart) as 0 | 1
  const createOnClick = usePrefs((s) => s.prefs.createDailyOnClick)
  const tree = useVault((s) => s.tree)
  const byDay = useItemsByDay()
  const selectedDate = fromDayKey(selected) ?? new Date()
  const [month, setMonth] = useState({ y: selectedDate.getFullYear(), m: selectedDate.getMonth() })
  const [adding, setAdding] = useState(false)
  const today = dayKey(new Date())

  // Follow the selected day when it changes elsewhere (e.g. in the full calendar).
  useEffect(() => {
    const d = fromDayKey(selected)
    if (d) setMonth({ y: d.getFullYear(), m: d.getMonth() })
  }, [selected])
  useEffect(() => setAdding(false), [selected])

  const days = monthGrid(month.y, month.m, weekStart)
  const external = useExternalRange(days[0], addDays(days[days.length - 1], 1))
  const shift = (n: number): void => {
    const d = new Date(month.y, month.m + n, 1)
    setMonth({ y: d.getFullYear(), m: d.getMonth() })
  }
  const pick = (d: Date): void => {
    useUI.setState({ calendarDay: dayKey(d) })
    openDaily(d, { create: createOnClick })
  }

  const agenda = (byDay.get(selected) ?? []).filter((i) => i.kind !== 'daily')
  const hasDaily = findNode(tree, dailyPath(selectedDate))?.type === 'file'

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <span className="mini-cal-title">{formatDate(new Date(month.y, month.m, 1), 'MMMM YYYY')}</span>
        <button className="icon-btn" title="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button
          className="icon-btn today-btn"
          title="Today"
          onClick={() => {
            const now = new Date()
            setMonth({ y: now.getFullYear(), m: now.getMonth() })
            useUI.setState({ calendarDay: dayKey(now) })
          }}
        >
          Today
        </button>
        <button className="icon-btn" title="Next month" onClick={() => shift(1)}>
          <ChevronRight size={15} />
        </button>
        <button className="icon-btn" title={`Open the full calendar (${showKeys('Ctrl+Shift+C')})`} onClick={() => openSpecialTab(CALENDAR_TAB)}>
          <Maximize2 size={13} />
        </button>
      </div>

      <div className="mini-cal-grid" role="grid">
        {weekdayNames(weekStart).map((w) => (
          <div key={w} className="mini-cal-weekday">
            {w.slice(0, 2)}
          </div>
        ))}
        {days.map((d) => {
          const key = dayKey(d)
          const items = byDay.get(key) ?? []
          const daily = items.some((i) => i.kind === 'daily')
          const ext = external.get(key) ?? []
          const others = items.filter((i) => i.kind !== 'daily').length + ext.length
          return (
            <button
              key={key}
              data-day={key}
              className={`mini-cal-day ${d.getMonth() !== month.m ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}`}
              onClick={() => pick(d)}
              title={`${formatDate(d, 'dddd D MMMM')}${daily ? ' · daily note' : ''}${others ? ` · ${others} item${others === 1 ? '' : 's'}` : ''}`}
            >
              {d.getDate()}
              <span className="mini-cal-dots">
                {daily && <i className="dot daily" />}
                {/* Google/link events get a dot in their calendar's colour. */}
                {Array.from({ length: Math.min(others, 3) }, (_, i) => {
                  const fromCalendar = ext[i - (others - ext.length)]
                  return <i key={i} className="dot" style={fromCalendar ? { background: fromCalendar.event.color } : undefined} />
                })}
              </span>
            </button>
          )
        })}
      </div>

      <div className="agenda">
        <div className="agenda-head">
          <span>{formatDate(selectedDate, 'dddd D MMMM')}</span>
          <button className="icon-btn" title="Add an event" onClick={() => setAdding(true)}>
            <Plus size={14} />
          </button>
        </div>
        {adding && (
          <QuickAdd
            onSave={async (title, start, end) => {
              setAdding(false)
              await addEvent(selectedDate, title, start, end)
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        <button className="agenda-daily" onClick={() => openDaily(selectedDate)}>
          <CalendarDays size={13} />
          {hasDaily ? 'Open daily note' : 'Create daily note'}
        </button>
        {agenda.length === 0 && (external.get(selected) ?? []).length === 0 && !adding && (
          <p className="agenda-empty">Nothing planned.</p>
        )}
        <DayList local={agenda} external={external.get(selected) ?? []} />
        <ExternalStatus />
        <OnThisDay date={selectedDate} byDay={byDay} />
        <div className="agenda-nav">
          <button className="btn" onClick={() => useUI.setState({ calendarDay: dayKey(addDays(selectedDate, -1)) })}>
            <ChevronLeft size={13} /> Previous day
          </button>
          <button className="btn" onClick={() => useUI.setState({ calendarDay: dayKey(addDays(selectedDate, 1)) })}>
            Next day <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
