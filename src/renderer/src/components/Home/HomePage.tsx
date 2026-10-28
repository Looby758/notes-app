import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, Clock, FileText, Layers, Plus } from 'lucide-react'
import { useEditor } from '../../store/editor'
import { useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { CALENDAR_TAB, FLASHCARDS_TAB, isNoteTab, openNote, openSpecialTab } from '../../lib/editorController'
import { openToday } from '../../lib/daily'
import { dayKey, formatDate } from '../../lib/dates'
import { homeCards } from '../../lib/home'
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
export function HomeBox({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
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
              <button className="home-row" onClick={() => openNote(p)} title={p}>
                <span className="home-row-icon">{icons.get(p)?.icon ?? <FileText size={13} />}</span>
                <span className="home-row-title">{noteTitle(p)}</span>
                {parentOf(p) && <span className="home-row-folder">{parentOf(p)}</span>}
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
  const boxes = [
    { id: 'today', order: 10, node: <TodayBox now={now} /> },
    { id: 'weather', order: 20, node: <WeatherHomeBox /> },
    { id: 'flashcards', order: 30, node: <FlashcardsBox /> },
    { id: 'recent', order: 40, node: <RecentBox /> },
    ...homeCards().map(({ id, order, Card }) => ({ id, order, node: <Card /> }))
  ].sort((a, b) => a.order - b.order)

  return (
    <div className="home-page" data-home-page>
      <div className="home-inner">
        <h2>{greeting(now)}</h2>
        <p className="home-date">{formatDate(now, 'dddd D MMMM YYYY')}</p>
        <div className="home-grid">
          {boxes.map((b) => (
            <div key={b.id} className="home-cell">
              {b.node}
            </div>
          ))}
        </div>
        <p className="home-keys">
          <Keys s="Ctrl+P" /> open a note · <Keys s="Ctrl+N" /> new note · <Keys s="Ctrl+K" /> all commands
        </p>
      </div>
    </div>
  )
}
