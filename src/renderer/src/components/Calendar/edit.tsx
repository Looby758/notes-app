import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarX2, FileText, Repeat, SkipForward, Trash2 } from 'lucide-react'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { describeRepeat } from '@shared/repeat'
import type { CalendarSourcesStatus } from '@shared/types'
import { deleteEvent, endSeriesBefore, moveEvent, skipOccurrence, type EventMove } from '../../lib/daily'
import { moveGoogle } from '../../lib/calendarEdit'
import { openNote } from '../../lib/editorController'
import { formatDate, fromDayKey } from '../../lib/dates'
import type { DatedItem } from '../../lib/schedule'
import { useExternal, type ExternalItem } from '../../store/externalEvents'

/**
 * Bits the calendar views share for changing events: the "Only this day / Every one" question
 * for repeating events, the right-click menu on note events, dragging between days, and which
 * Google calendars you can add to.
 */

// ---------- "this one or all of them?" ----------

type Which = 'one' | 'all'
interface Ask {
  x: number
  y: number
  title: string
  resolve: (which: Which | null) => void
}
let setAsk: ((a: Ask | null) => void) | null = null

/** Asks whether a change to a repeating event is for that day only or the whole series. */
export function askWhich(x: number, y: number, title: string): Promise<Which | null> {
  if (!setAsk) return Promise.resolve('all')
  return new Promise((resolve) => setAsk!({ x, y, title, resolve }))
}

/** Moves a note event, asking first if it repeats. */
export async function moveLocalEvent(item: DatedItem, to: EventMove, x: number, y: number): Promise<void> {
  if (item.date === to.date && item.start === to.start && item.end === to.end) return
  const which = item.repeat ? await askWhich(x, y, item.title) : 'all'
  if (which) await moveEvent(item, to, which)
}

// ---------- right-click menu on events from notes ----------

interface Menu {
  x: number
  y: number
  item: DatedItem
}
let setMenu: ((m: Menu | null) => void) | null = null

export function showEventMenu(item: DatedItem, x: number, y: number): void {
  setMenu?.({ x, y, item })
}

function menuItems(item: DatedItem): MenuItem[] {
  const open: MenuItem = { label: 'Open in its note', icon: <FileText size={15} />, onClick: () => openNote(item.path, { line: item.line }) }
  if (item.kind !== 'event') return [open]
  if (!item.repeat) return [open, 'separator', { label: 'Delete event', icon: <Trash2 size={15} />, danger: true, onClick: () => deleteEvent(item) }]
  const day = formatDate(fromDayKey(item.date)!, 'ddd D MMM')
  const first = !item.seriesDate || item.seriesDate === item.date
  return [
    open,
    'separator',
    { label: `Skip ${day} only`, icon: <SkipForward size={15} />, onClick: () => skipOccurrence(item) },
    ...(first ? [] : [{ label: `Stop repeating from ${day}`, icon: <CalendarX2 size={15} />, onClick: () => endSeriesBefore(item) }]),
    { label: 'Delete every one', icon: <Trash2 size={15} />, danger: true, onClick: () => deleteEvent(item) }
  ]
}

/** Mounted once (by the Shell): the question card and the event menu. */
export function CalendarOverlays() {
  const [ask, setAskState] = useState<Ask | null>(null)
  const [menu, setMenuState] = useState<Menu | null>(null)
  setAsk = setAskState
  setMenu = setMenuState
  return (
    <>
      {ask && (
        <WhichCard
          ask={ask}
          onDone={(w) => {
            setAskState(null)
            ask.resolve(w)
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={() => setMenuState(null)} />}
    </>
  )
}

function WhichCard({ ask, onDone }: { ask: Ask; onDone: (w: Which | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: ask.x, y: ask.y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(ask.x, window.innerWidth - r.width - 8), y: Math.min(ask.y + 6, window.innerHeight - r.height - 8) })
  }, [ask.x, ask.y])
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onDone(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDone(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDone])
  return createPortal(
    <div ref={ref} className="event-card which-card" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Change which days?">
      <div className="event-card-title">
        <Repeat size={14} /> “{ask.title}” repeats
      </div>
      <div className="event-card-line faint">Change just this day, or every one?</div>
      <div className="event-card-actions">
        <button className="btn" autoFocus onClick={() => onDone('one')}>
          Only this day
        </button>
        <button className="btn btn-primary" onClick={() => onDone('all')}>
          Every one
        </button>
        <button className="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}

/** "Every Tuesday" for an item's repeat, for tooltips. */
export const repeatLabel = (item: DatedItem): string => (item.repeat ? describeRepeat(item.repeat) : '')

// ---------- dragging between days (month view and the all-day row) ----------

type Dragged = { local: DatedItem } | { external: ExternalItem }
let dragged: Dragged | null = null

/** Starts dragging an event (call from onDragStart). */
export function startDayDrag(e: React.DragEvent, what: Dragged): void {
  dragged = what
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-orbit-event', '1')
  e.stopPropagation()
}

export const isEventDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('application/x-orbit-event')

/** Drops the dragged event on a day, keeping its time. */
export async function dropOnDay(e: React.DragEvent, date: string): Promise<void> {
  const what = dragged
  dragged = null
  if (!what) return
  e.preventDefault()
  if ('local' in what) {
    const item = what.local
    if (item.date !== date) await moveLocalEvent(item, { date, start: item.start, end: item.end }, e.clientX, e.clientY)
    return
  }
  const item = what.external
  if (item.date !== date) await moveGoogle(item, { date, start: item.start, end: item.end })
}

// ---------- Google calendars you can add to ----------

let calendarsCache: CalendarSourcesStatus['google']['calendars'] | null = null

/** Your Google calendars that Orbit may add events to (empty until you reconnect with editing allowed). */
export function useWritableCalendars(): { id: string; name: string; color: string }[] {
  const generation = useExternal((s) => s.generation)
  const [calendars, setCalendars] = useState(calendarsCache ?? [])
  useEffect(() => {
    let live = true
    window.api
      .calendarSources()
      .then((s) => {
        calendarsCache = s.google.canEdit ? s.google.calendars.filter((c) => c.writable && c.enabled) : []
        if (live) setCalendars(calendarsCache)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [generation])
  return calendars
}
