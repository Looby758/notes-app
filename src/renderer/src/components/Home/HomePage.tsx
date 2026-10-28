import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, Clock, Eye, EyeOff, FileText, GripVertical, Layers, Plus, SlidersHorizontal } from 'lucide-react'
import Private from '../Streamer/Private'
import { useHideNames } from '../../store/streamer'
import { useEditor } from '../../store/editor'
import { useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { CALENDAR_TAB, FLASHCARDS_TAB, isNoteTab, openNote, openSpecialTab } from '../../lib/editorController'
import { openToday } from '../../lib/daily'
import { dayKey, formatDate } from '../../lib/dates'
import { arrangeHome, homeCards, moveId } from '../../lib/home'
import { setPrefs, usePrefs } from '../../store/prefs'
import { IS_MAC, showKeys } from '@shared/platform'
import { noteTitle, parentOf } from '../../lib/paths'
import { DayList, ExternalStatus, useExternalRange, useItemsByDay } from '../Calendar/shared'
import { useAllCards, useDueCount } from '../Flashcards/FlashcardsPage'
import { WeatherHomeBox } from '../Weather/Weather'

/** The current time, updated every minute (so the date and greeting roll over at midnight). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function greeting(now: Date): string {
  const h = now.getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** One box on the Home page. */
export function HomeBox({ icon, title, action, children }: { icon: ReactNode; title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="home-box">
      <header>
        {icon}
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

function TodayBox({ now }: { now: Date }) {
  const today = dayKey(now)
  const byDay = useItemsByDay()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const external = useExternalRange(start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1))
  const local = (byDay.get(today) ?? []).filter((i) => i.kind !== 'daily')
  const ext = external.get(today) ?? []
  return (
    <HomeBox
      icon={<CalendarDays size={15} />}
      title="Today"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(CALENDAR_TAB)}>
          Calendar
        </button>
      }
    >
      {local.length + ext.length === 0 ? <p className="home-empty">Nothing planned for today.</p> : <DayList local={local} external={ext} />}
      <ExternalStatus />
      <button className="btn home-wide-btn" onClick={() => openToday()}>
        <CalendarDays size={13} />
        Open today's note
      </button>
    </HomeBox>
  )
}

function FlashcardsBox() {
  const cards = useAllCards()
  const due = useDueCount()
  if (!cards.length) return null
  return (
    <HomeBox icon={<Layers size={15} />} title="Flashcards">
      <div className="home-flashcards">
        <span>{due ? `${due} card${due === 1 ? '' : 's'} waiting for review` : 'All caught up for today.'}</span>
        {due > 0 && (
          <button className="btn btn-primary" onClick={() => openSpecialTab(FLASHCARDS_TAB)}>
            Review
          </button>
        )}
      </div>
    </HomeBox>
  )
}

const RECENT_SHOWN = 8

function RecentBox() {
  const recent = useEditor((s) => s.recent)
  const lookup = useNoteIndex((s) => s.lookup)
  const icons = useNoteIndex((s) => s.notes)
  const newNote = useVault((s) => s.newNote)
  const hideNames = useHideNames()
  const existing = useMemo(() => new Set(lookup.paths), [lookup])
  const shown = recent.filter((p) => isNoteTab(p) && existing.has(p)).slice(0, RECENT_SHOWN)
  return (
    <HomeBox
      icon={<Clock size={15} />}
      title="Recent notes"
      action={
        <button className="link-button home-box-action" onClick={() => newNote()}>
          <Plus size={12} /> New note
        </button>
      }
    >
      {shown.length === 0 ? (
        <p className="home-empty">Notes you open will show up here.</p>
      ) : (
        <ul className="home-list">
          {shown.map((p) => (
            <li key={p}>
              <button className="home-row" onClick={() => openNote(p)} title={hideNames ? undefined : p}>
                <span className="home-row-icon">{icons.get(p)?.icon ?? <FileText size={13} />}</span>
                <span className="home-row-title">
                  <Private when={hideNames}>{noteTitle(p)}</Private>
                </span>
                {parentOf(p) && (
                  <span className="home-row-folder">
                    <Private when={hideNames}>{parentOf(p)}</Private>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomeBox>
  )
}

/** A shortcut as keycaps: "Ctrl" "P" on Windows, "⌘P" on a Mac. */
function Keys({ s }: { s: string }) {
  if (IS_MAC) return <kbd>{showKeys(s)}</kbd>
  return (
    <>
      {s.split('+').map((k, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <kbd>{k}</kbd>
        </span>
      ))}
    </>
  )
}

/** The start page: today's plans (reminders included), the weather, flashcards and recent notes at a glance. */
export default function HomePage() {
  const now = useNow()
  const order = usePrefs((s) => s.prefs.homeOrder)
  const hidden = usePrefs((s) => s.prefs.homeHidden)
  const [editing, setEditing] = useState(false)
  const boxes = arrangeHome(
    [
      { id: 'today', order: 10, title: 'Today', node: <TodayBox now={now} /> },
      { id: 'weather', order: 20, title: 'Weather', node: <WeatherHomeBox /> },
      { id: 'flashcards', order: 30, title: 'Flashcards', node: <FlashcardsBox /> },
      { id: 'recent', order: 40, title: 'Recent notes', node: <RecentBox /> },
      ...homeCards().map(({ id, order, title, Card }) => ({ id, order, title, node: <Card /> }))
    ].sort((a, b) => a.order - b.order),
    order
  )

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  return (
    <div className="home-page" data-home-page>
      <div className="home-inner">
        <div className="home-head">
          <h2>{greeting(now)}</h2>
          {editing ? (
            <>
              {(order.length > 0 || hidden.length > 0) && (
                <button className="link-button" onClick={() => setPrefs({ homeOrder: [], homeHidden: [] })}>
                  Reset
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setEditing(false)} data-home-done>
                Done
              </button>
            </>
          ) : (
            <button className="link-button home-customise" onClick={() => setEditing(true)} title="Move and hide boxes" data-home-customise>
              <SlidersHorizontal size={13} /> Customise
            </button>
          )}
        </div>
        <p className="home-date">{editing ? 'Drag boxes to move them, or use the arrows. Hidden boxes stay here until you show them again.' : formatDate(now, 'dddd D MMMM YYYY')}</p>
        {editing ? (
          <EditGrid boxes={boxes} hidden={hidden} />
        ) : (
          <div className="home-grid">
            {boxes
              .filter((b) => !hidden.includes(b.id))
              .map((b) => (
                <div key={b.id} className="home-cell">
                  {b.node}
                </div>
              ))}
          </div>
        )}
        <p className="home-keys">
          <Keys s="Ctrl+P" /> open a note · <Keys s="Ctrl+N" /> new note · <Keys s="Ctrl+K" /> all commands
        </p>
      </div>
    </div>
  )
}

interface Box {
  id: string
  title: string
  node: ReactNode
}

/** Customising the Home page: every box, with a handle to drag it, arrows to move it and an eye to hide it. */
function EditGrid({ boxes, hidden }: { boxes: Box[]; hidden: string[] }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const ids = boxes.map((b) => b.id)
  const move = (id: string, to: number): void => setPrefs({ homeOrder: moveId(ids, id, to) })
  const toggle = (id: string): void =>
    setPrefs({ homeHidden: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id] })

  return (
    <div className="home-grid editing">
      {boxes.map((b, i) => {
        const off = hidden.includes(b.id)
        return (
          <div
            key={b.id}
            className={`home-cell home-cell-edit ${off ? 'off' : ''} ${dragging === b.id ? 'dragging' : ''} ${over === b.id && dragging !== b.id ? 'drop-here' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', b.id)
              setDragging(b.id)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              if (!dragging) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== b.id) setOver(b.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging && dragging !== b.id) move(dragging, i)
              setDragging(null)
              setOver(null)
            }}
            data-home-edit={b.id}
          >
            <div className="home-edit-bar">
              <GripVertical size={14} className="home-edit-grip" />
              <button className="icon-btn" disabled={i === 0} onClick={() => move(b.id, i - 1)} title="Move earlier">
                <ArrowUp size={13} />
              </button>
              <button className="icon-btn" disabled={i === boxes.length - 1} onClick={() => move(b.id, i + 1)} title="Move later">
                <ArrowDown size={13} />
              </button>
              <button className={`icon-btn ${off ? 'active' : ''}`} onClick={() => toggle(b.id)} title={off ? 'Show this box' : 'Hide this box'} data-home-hide>
                {off ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {/* A box with nothing to show yet still gets a placeholder, so you can place it. */}
            <div className="home-cell-body" data-empty={`${b.title}: shows up once there’s something in it.`}>
              {b.node}
            </div>
          </div>
        )
      })}
    </div>
  )
}
