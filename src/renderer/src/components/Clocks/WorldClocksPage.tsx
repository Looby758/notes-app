import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock, Globe2, MapPin, Moon, Pencil, Plus, RotateCcw, Sun, Sunrise, Sunset, Trash2, X } from 'lucide-react'
import { setPrefs, usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, CLOCKS_TAB } from '../../lib/editorController'
import { useMotion } from '../../lib/motion'
import { HomeBox } from '../Home/HomePage'
import type { Place } from '@shared/places'
import {
  changeSentence,
  cityOfZone,
  clockId,
  clockText,
  dayText,
  differenceText,
  durationText,
  findClockPlaces,
  lastChange,
  localZone,
  MAX_CLOCKS,
  nextChange,
  nextGapChange,
  offsetMinutes,
  offsetText,
  onSummerTime,
  partOfDay,
  relativeDay,
  timeIn,
  zoneAbbreviation,
  type ClockPlace,
  type WorldClock
} from '@shared/worldClock'

addHomeCard({ id: 'clocks', order: 22, title: 'World clocks', Card: ClocksHomeCard })

const DAY = 86_400_000
/** A change of gap this close gets a heads-up on the clock. */
const HEADS_UP_DAYS = 45
/** A change this recent is still worth mentioning. */
const RECENT_DAYS = 10

/** The time now, ticking every `ms` (lined up with the clock so minutes turn over on time). */
function useTicking(ms: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      setNow(new Date())
      timer = setTimeout(tick, ms - (Date.now() % ms) + 5)
    }
    timer = setTimeout(tick, ms - (Date.now() % ms) + 5)
    return () => clearTimeout(timer)
  }, [ms])
  return now
}

const useTwelve = (): boolean => usePrefs((s) => s.prefs.timeFormat === '12h')
const useClocks = (): WorldClock[] => usePrefs((s) => s.prefs.worldClocks)
const saveClocks = (clocks: WorldClock[]): void => setPrefs({ worldClocks: clocks })

/** Adds a place unless it's already there; returns whether it was added. */
function addClock(label: string, zone: string): boolean {
  const clocks = usePrefs.getState().prefs.worldClocks
  if (clocks.length >= MAX_CLOCKS) {
    notify(`That’s the most clocks there’s room for (${MAX_CLOCKS}). Remove one first.`)
    return false
  }
  if (clocks.some((c) => c.zone === zone && c.label === label)) {
    notify(`${label} is already on your clocks.`, 'info')
    return false
  }
  saveClocks([...clocks, { id: clockId(), label, zone }])
  return true
}

const DayIcon = ({ hour, size = 13 }: { hour: number; size?: number }) => {
  const part = partOfDay(hour)
  if (part === 'night') return <Moon size={size} />
  if (part === 'morning') return <Sunrise size={size} />
  if (part === 'evening') return <Sunset size={size} />
  return <Sun size={size} />
}

/** A round clock face. The second hand only shows on the page itself, and sweeps unless motion is off. */
function Face({ hour, minute, second, showSeconds }: { hour: number; minute: number; second: number; showSeconds: boolean }) {
  const h = ((hour % 12) + minute / 60) * 30
  const m = (minute + second / 60) * 6
  const s = second * 6
  return (
    <svg className="clock-face" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" className="clock-rim" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1={i % 3 === 0 ? 8 : 10} x2="50" y2="14" className={`clock-tick ${i % 3 === 0 ? 'major' : ''}`} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      <line x1="50" y1="50" x2="50" y2="27" className="clock-hour" transform={`rotate(${h} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="17" className="clock-minute" transform={`rotate(${m} 50 50)`} />
      {showSeconds && <line x1="50" y1="58" x2="50" y2="14" className="clock-second" transform={`rotate(${s} 50 50)`} />}
      <circle cx="50" cy="50" r="2.6" className="clock-pin" />
    </svg>
  )
}

interface CardProps {
  clock: WorldClock | null
  home: string
  at: Date
  /** The real time now (clock changes are always worked out from now, even while planning). */
  now: Date
  /** True while you're looking at a planned time rather than now. */
  planning: boolean
  index: number
  count: number
}

/** One place: its face, time, how it compares to you, and what its clocks do next. */
function ClockCard({ clock, home, at, now: realNow, planning, index, count }: CardProps) {
  const twelve = useTwelve()
  const motion = useMotion()
  const zone = clock?.zone ?? home
  const isHere = !clock
  const t = timeIn(zone, at)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(clock?.label ?? '')

  // Clock changes are worked out from the real now, not a planned time, and only once a minute.
  const minute = Math.floor(realNow.getTime() / 60_000)
  const notes = useMemo(() => {
    const now = new Date(minute * 60_000)
    const next = nextChange(zone, now)
    const last = lastChange(zone, now, RECENT_DAYS)
    const gap = isHere ? null : nextGapChange(zone, home, now, HEADS_UP_DAYS)
    return { next, last, gap }
  }, [zone, home, isHere, minute])

  const label = clock?.label ?? 'Here'
  const place = cityOfZone(zone)
  const move = (to: number): void => {
    const clocks = [...usePrefs.getState().prefs.worldClocks]
    const [c] = clocks.splice(index, 1)
    clocks.splice(to, 0, c)
    saveClocks(clocks)
  }
  const rename = (): void => {
    const label = name.trim()
    if (clock && label) saveClocks(usePrefs.getState().prefs.worldClocks.map((c) => (c.id === clock.id ? { ...c, label: label.slice(0, 60) } : c)))
    setRenaming(false)
  }
  const day = isHere ? null : relativeDay(zone, home, at)
  const abbr = zoneAbbreviation(zone, at)
  const offset = offsetText(offsetMinutes(zone, at))

  return (
    <article className={`clock-card part-${partOfDay(t.hour)} ${isHere ? 'here' : ''}`} data-clock={clock?.id ?? 'here'}>
      <Face hour={t.hour} minute={t.minute} second={t.second} showSeconds={!planning && motion !== 'off'} />
      <div className="clock-body">
        <header className="clock-name">
          {renaming ? (
            <form
              className="clock-rename"
              onSubmit={(e) => {
                e.preventDefault()
                rename()
              }}
            >
              <input
                className="text-input"
                autoFocus
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                aria-label="Name for this clock"
              />
              <button className="icon-btn" type="submit" title="Save name">
                <Check size={13} />
              </button>
            </form>
          ) : (
            <h3 title={zone}>
              {isHere && <MapPin size={13} />}
              {label}
            </h3>
          )}
          {!isHere && !renaming && (
            <div className="clock-tools">
              <button
                className="icon-btn"
                title="Rename"
                onClick={() => {
                  setName(label)
                  setRenaming(true)
                }}
              >
                <Pencil size={12} />
              </button>
              <button className="icon-btn" title="Move earlier" disabled={index === 0} onClick={() => move(index - 1)}>
                <ArrowLeft size={12} />
              </button>
              <button className="icon-btn" title="Move later" disabled={index === count - 1} onClick={() => move(index + 1)}>
                <ArrowRight size={12} />
              </button>
              <button
                className="icon-btn"
                title="Remove this clock"
                onClick={() => saveClocks(usePrefs.getState().prefs.worldClocks.filter((c) => c.id !== clock.id))}
                data-clock-remove
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </header>
        <p className="clock-where">
          {label !== place && `${place} · `}
          {abbr}
          {abbr !== offset && ` · ${offset}`}
          {onSummerTime(zone, at) && ' · summer time'}
        </p>
        <div className="clock-time" data-clock-time>
          {clockText(t, twelve)}
        </div>
        <p className="clock-day">
          <DayIcon hour={t.hour} />
          <span>
            {isHere ? (planning ? dayText(zone, at) : 'Your time') : `${day === 'Today' ? 'Today' : `${day}, ${dayText(zone, at)}`} · ${differenceText(zone, home, at)}`}
          </span>
        </p>
        {notes.gap && (
          <p className="clock-note heads-up" data-clock-heads-up>
            <AlertTriangle size={12} />
            <span>
              From {dayText(home, notes.gap.at)}, {label} will be {gapWords(notes.gap.after)} instead of {gapShort(notes.gap.before)}, because{' '}
              {notes.gap.who === 'there' ? `${place}’s clocks change` : notes.gap.who === 'here' ? 'your clocks change' : 'both clocks change'}.
            </span>
          </p>
        )}
        {notes.last && notes.last.at.getTime() > Date.now() - RECENT_DAYS * DAY && (
          <p className="clock-note">{changeSentence(zone, notes.last, twelve, true)}.</p>
        )}
        <p className="clock-note" data-clock-next>
          {notes.next ? `${changeSentence(zone, notes.next, twelve)}.` : 'No daylight saving here: the clocks stay the same all year.'}
        </p>
      </div>
    </article>
  )
}

const gapShort = (minutes: number): string =>
  minutes === 0 ? 'the same time' : `${durationText(minutes)} ${minutes > 0 ? 'ahead' : 'behind'}`
const gapWords = (minutes: number): string =>
  minutes === 0 ? 'the same time as you' : `${durationText(minutes)} ${minutes > 0 ? 'ahead of you' : 'behind you'}`

const SUGGESTIONS = ['New York', 'Los Angeles', 'Tokyo', 'Sydney', 'Dubai', 'Paris', 'Delhi', 'Toronto']

/** Adding a place: well-known places as you type, and any town in the world from the map search. */
function AddPlace({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [towns, setTowns] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const quick = useMemo(() => findClockPlaces(query, 6), [query])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = query.trim()
    setError('')
    setTowns([])
    if (q.length < 3) {
      setSearching(false)
      return
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(() => {
      window.api
        .searchPlaces(q)
        .then((res) => {
          if (stale) return
          setTowns(res.places.slice(0, 5))
          if (res.error) setError(res.error)
        })
        .finally(() => !stale && setSearching(false))
    }, 700)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  const pick = (p: ClockPlace): void => {
    if (addClock(p.name, p.zone)) onClose()
  }
  const pickTown = async (p: Place): Promise<void> => {
    const key = `${p.lat},${p.lon}`
    setAdding(key)
    const zone = await window.api.zoneAt(p.lat, p.lon).catch(() => null)
    setAdding(null)
    if (!zone) {
      setError(`Couldn’t find the time zone for ${p.name}. Check you’re online, or try a nearby city.`)
      return
    }
    if (addClock(p.name, zone)) onClose()
  }

  return (
    <div className="clock-add" data-clock-add>
      <div className="clock-add-row">
        <input
          ref={input}
          className="text-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && quick[0]) pick(quick[0])
          }}
          placeholder="A city, town or country, e.g. New York"
          aria-label="Place to add"
        />
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>
      {!query.trim() && (
        <div className="clock-suggestions">
          {SUGGESTIONS.map((name) => {
            const p = findClockPlaces(name, 1)[0]
            return (
              p && (
                <button key={name} className="clock-chip" onClick={() => pick(p)}>
                  <Plus size={11} /> {name}
                </button>
              )
            )
          })}
        </div>
      )}
      {quick.map((p) => (
        <button key={`${p.name}|${p.zone}`} className="home-row" onClick={() => pick(p)} data-clock-option>
          <span className="home-row-icon">
            <Globe2 size={13} />
          </span>
          <span className="home-row-title">{p.name}</span>
          <span className="home-row-folder">{p.country}</span>
        </button>
      ))}
      {towns.length > 0 && <p className="clock-add-label">Other towns</p>}
      {towns.map((p) => {
        const key = `${p.lat},${p.lon}`
        return (
          <button key={key} className="home-row" onClick={() => void pickTown(p)} disabled={adding !== null}>
            <span className="home-row-icon">
              <MapPin size={13} />
            </span>
            <span className="home-row-title">{p.name}</span>
            <span className="home-row-folder clock-add-address">{adding === key ? 'Finding its time zone…' : p.address}</span>
          </button>
        )
      })}
      {searching && <p className="home-empty">Looking for more towns…</p>}
      {error && <p className="home-empty">{error}</p>}
      {!searching && !error && query.trim().length >= 3 && quick.length === 0 && towns.length === 0 && <p className="home-empty">No places found with that name.</p>}
    </div>
  )
}

/** Steps for the planner: every 15 minutes from 12 hours ago to 36 hours ahead. */
const PLAN_MIN = -12 * 4
const PLAN_MAX = 36 * 4

/** Clocks for places around the world, with daylight saving right for each, and a planner for "what time is that there?". */
export default function WorldClocksPage() {
  const clocks = useClocks()
  const twelve = useTwelve()
  const real = useTicking(1000)
  const [adding, setAdding] = useState(false)
  // Planner: quarter-hours from the current quarter-hour, or null for now.
  const [plan, setPlan] = useState<number | null>(null)
  const home = localZone()

  const quarter = Math.floor(real.getTime() / 900_000) * 900_000
  const at = plan === null ? real : new Date(quarter + plan * 900_000)
  const homeTime = timeIn(home, at)

  return (
    <div className="clocks-page" data-clocks-page>
      <div className="clocks-inner">
        <header className="clocks-head">
          <h2>
            <Globe2 size={18} /> World clocks
          </h2>
          {!adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)} data-clock-add-button>
              <Plus size={14} /> Add a place
            </button>
          )}
        </header>
        <p className="clocks-intro">
          Every clock follows its own place’s daylight saving, so when the UK’s clocks go back and somewhere else’s change on another day, the times here are still right.
        </p>
        {adding && <AddPlace onClose={() => setAdding(false)} />}

        <div className="clocks-planner" data-clock-planner>
          <Clock size={14} />
          <label htmlFor="clock-plan">{plan === null ? 'Plan a time' : `When it’s ${clockText(homeTime, twelve)} on ${dayText(home, at)} for you`}</label>
          <input
            id="clock-plan"
            type="range"
            min={PLAN_MIN}
            max={PLAN_MAX}
            step={1}
            value={plan ?? 0}
            onChange={(e) => setPlan(Number(e.target.value))}
            aria-valuetext={`${clockText(homeTime, twelve)} your time`}
          />
          {plan !== null && (
            <button className="link-button" onClick={() => setPlan(null)} data-clock-now>
              <RotateCcw size={12} /> Back to now
            </button>
          )}
        </div>

        <div className="clocks-grid">
          <ClockCard clock={null} home={home} at={at} now={real} planning={plan !== null} index={-1} count={clocks.length} />
          {clocks.map((c, i) => (
            <ClockCard key={c.id} clock={c} home={home} at={at} now={real} planning={plan !== null} index={i} count={clocks.length} />
          ))}
        </div>
        {clocks.length === 0 && !adding && (
          <p className="clocks-empty">
            Add the places you care about (friends, family, a game server, a match kick-off) to see their time at a glance. They show on Home too.
          </p>
        )}
      </div>
    </div>
  )
}

/** The Home page's clocks: each place's time and how far ahead or behind you it is. Hidden until you add one. */
function ClocksHomeCard() {
  const clocks = useClocks()
  const twelve = useTwelve()
  const now = useTicking(60_000)
  if (clocks.length === 0) return null
  const home = localZone()
  return (
    <HomeBox
      icon={<Globe2 size={15} />}
      title="World clocks"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(CLOCKS_TAB)}>
          All clocks
        </button>
      }
    >
      <ul className="home-list clocks-home">
        {clocks.slice(0, 6).map((c) => {
          const t = timeIn(c.zone, now)
          const day = relativeDay(c.zone, home, now)
          return (
            <li key={c.id} className="clocks-home-row" title={`${cityOfZone(c.zone)} · ${zoneAbbreviation(c.zone, now)}`}>
              <span className={`clocks-home-icon part-${partOfDay(t.hour)}`}>
                <DayIcon hour={t.hour} />
              </span>
              <span className="home-row-title">{c.label}</span>
              <span className="home-row-folder">
                {day !== 'Today' && `${day} · `}
                {differenceText(c.zone, home, now).replace(' as you', '')}
              </span>
              <strong className="clocks-home-time">{clockText(t, twelve)}</strong>
            </li>
          )
        })}
      </ul>
    </HomeBox>
  )
}
