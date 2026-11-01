import { useEffect, useState } from 'react'
import { Check, Hourglass, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react'
import { setPrefs, usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, COUNTDOWNS_TAB } from '../../lib/editorController'
import { formatDate } from '../../lib/dates'
import { HomeBox } from '../Home/HomePage'
import {
  COUNTDOWN_KINDS,
  countdownId,
  countdownStatus,
  isDate,
  kindOf,
  leftText,
  MAX_COUNTDOWNS,
  sortCountdowns,
  splitTime,
  todayKey,
  type Countdown,
  type CountdownKind,
  type CountdownStatus
} from '@shared/countdown'

addHomeCard({ id: 'countdowns', order: 15, title: 'Countdowns', Card: CountdownsHomeCard })

/** The time now, ticking every `ms`, lined up so seconds and minutes turn over on time. */
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

const useCountdowns = (): Countdown[] => usePrefs((s) => s.prefs.countdowns)
const save = (list: Countdown[]): void => setPrefs({ countdowns: list })
const useTwelve = (): boolean => usePrefs((s) => s.prefs.timeFormat === '12h')

/** "Fri 25 Dec 2026", plus the time if it has one. */
function whenText(c: Countdown, s: CountdownStatus, twelve: boolean): string {
  const day = formatDate(s.target, 'ddd D MMM YYYY')
  if (!c.time) return day
  return `${day}, ${formatDate(s.target, twelve ? 'h:mm a' : 'HH:mm')}`
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** The big number on a card, and what it counts. */
function bigNumber(c: Countdown, s: CountdownStatus): { value: string; unit: string } {
  if (s.state === 'now') return { value: '🎉', unit: 'it’s here' }
  if (s.state === 'done') return { value: '✓', unit: 'done' }
  if (s.state === 'today') {
    if (!c.time) return { value: '🎉', unit: 'today' }
    const { hours, minutes } = splitTime(s.ms)
    return hours > 0 ? { value: String(hours), unit: hours === 1 ? 'hour' : 'hours' } : { value: String(Math.max(1, minutes)), unit: minutes === 1 ? 'minute' : 'minutes' }
  }
  return { value: String(s.days), unit: s.days === 1 ? 'day' : 'days' }
}

// ---------- adding and editing ----------

function CountdownForm({ start, onClose }: { start: Countdown | null; onClose: () => void }) {
  const now = new Date()
  const [title, setTitle] = useState(start?.title ?? '')
  const [kind, setKind] = useState<CountdownKind>(start?.kind ?? 'season')
  const [date, setDate] = useState(start?.date ?? todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)))
  const [time, setTime] = useState(start?.time ?? '')
  const [yearly, setYearly] = useState(start?.yearly ?? false)

  const submit = (): void => {
    const name = title.trim()
    if (!name) return notify('Give it a name first, e.g. “Walking Dead season 2”.', 'info')
    if (!isDate(date)) return notify('Pick a date for it.', 'info')
    const list = usePrefs.getState().prefs.countdowns
    if (start) {
      save(list.map((c) => (c.id === start.id ? { ...c, title: name.slice(0, 80), kind, date, time, yearly } : c)))
    } else {
      if (list.length >= MAX_COUNTDOWNS) return notify(`That’s the most countdowns there’s room for (${MAX_COUNTDOWNS}). Remove a finished one first.`)
      save([...list, { id: countdownId(), title: name.slice(0, 80), kind, date, time, yearly, created: Date.now() }])
    }
    onClose()
  }

  return (
    <div
      className="countdown-form"
      data-countdown-form
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit()
      }}
    >
      <div className="countdown-form-row">
        <input
          className="text-input"
          autoFocus
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What are you counting down to? e.g. New season of The Walking Dead"
          aria-label="Countdown name"
          data-countdown-title
        />
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>
      <div className="countdown-kinds" role="radiogroup" aria-label="What kind">
        {COUNTDOWN_KINDS.map((k) => (
          <button key={k.id} role="radio" aria-checked={kind === k.id} className={`countdown-kind ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
            <span aria-hidden>{k.emoji}</span> {k.label}
          </button>
        ))}
      </div>
      <div className="countdown-form-row countdown-form-when">
        <label>
          <span>Date</span>
          <input className="text-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-countdown-date />
        </label>
        <label>
          <span>
            Time <span className="countdown-optional">(optional)</span>
          </span>
          <input className="text-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} data-countdown-time />
        </label>
        {time && (
          <button className="link-button" onClick={() => setTime('')}>
            Whole day
          </button>
        )}
        <label className="countdown-yearly">
          <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Every year
        </label>
        <button className="btn btn-primary" onClick={submit} data-countdown-save>
          <Check size={14} /> {start ? 'Save' : 'Add countdown'}
        </button>
      </div>
    </div>
  )
}

// ---------- a card ----------

function CountdownCard({ c, now, onEdit }: { c: Countdown; now: Date; onEdit: () => void }) {
  const twelve = useTwelve()
  const [confirming, setConfirming] = useState(false)
  const s = countdownStatus(c, now)
  const big = bigNumber(c, s)
  const k = kindOf(c.kind)
  const t = splitTime(s.ms)
  const live = s.state === 'upcoming' || s.state === 'today'
  // A whole-day one has nothing left to tick once its day starts.
  const ticking = s.state === 'upcoming' || (s.state === 'today' && !!c.time)
  const remove = (): void => save(usePrefs.getState().prefs.countdowns.filter((x) => x.id !== c.id))

  return (
    <article className={`countdown-card kind-${c.kind} state-${s.state}`} data-countdown-card={c.id}>
      <div className="countdown-card-top">
        <span className="countdown-emoji" aria-hidden>
          {k.emoji}
        </span>
        <div className="countdown-card-name">
          <h3 title={c.title}>{c.title}</h3>
          <p>
            {whenText(c, s, twelve)}
            {c.yearly && (
              <span className="countdown-repeat" title="Every year">
                <Repeat size={11} />
              </span>
            )}
          </p>
        </div>
        <div className="countdown-card-actions">
          {confirming ? (
            <>
              <button className="link-button danger" onClick={remove} data-countdown-remove-yes>
                Remove
              </button>
              <button className="icon-btn" onClick={() => setConfirming(false)} title="Keep it">
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <button className="icon-btn" onClick={onEdit} title="Edit">
                <Pencil size={13} />
              </button>
              <button className="icon-btn" onClick={() => setConfirming(true)} title="Remove" data-countdown-remove>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="countdown-big" aria-label={leftText(s, !!c.time)}>
        <strong>{big.value}</strong>
        <span>{big.unit}</span>
      </div>
      {ticking ? (
        <p className="countdown-ticker" aria-hidden>
          {t.days > 0 && <>{t.days}d </>}
          {pad(t.hours)}h {pad(t.minutes)}m {pad(t.seconds)}s
        </p>
      ) : (
        <p className="countdown-ticker">{leftText(s, !!c.time)}</p>
      )}
      {s.progress !== null && live && (
        <div className="countdown-progress" title={`${Math.round(s.progress * 100)}% of the wait done`}>
          <span style={{ width: `${s.progress * 100}%` }} />
        </div>
      )}
    </article>
  )
}

// ---------- the page ----------

export default function CountdownsPage() {
  const list = useCountdowns()
  const now = useTicking(1000)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const sorted = sortCountdowns(list, now)
  const finished = sorted.filter((c) => countdownStatus(c, now).state === 'done')

  return (
    <div className="countdowns-page" data-countdowns-page>
      <div className="countdowns-inner">
        <header className="countdowns-head">
          <h2>
            <Hourglass size={18} /> Countdowns
          </h2>
          <div className="countdowns-head-actions">
            {finished.length > 0 && (
              <button className="link-button" onClick={() => save(list.filter((c) => !finished.includes(c)))} data-countdown-clear>
                Clear finished ({finished.length})
              </button>
            )}
            {!adding && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null)
                  setAdding(true)
                }}
                data-countdown-add
              >
                <Plus size={14} /> New countdown
              </button>
            )}
          </div>
        </header>
        <p className="countdowns-intro">A new season, a game update, a trip, a birthday. The soonest ones show big on Home too.</p>
        {adding && <CountdownForm start={null} onClose={() => setAdding(false)} />}
        {list.length === 0 && !adding ? (
          <div className="countdowns-empty">
            <span aria-hidden>⏳</span>
            <p>Nothing to count down to yet.</p>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add your first countdown
            </button>
          </div>
        ) : (
          <div className="countdowns-grid">
            {sorted.map((c) =>
              editing === c.id ? (
                <div key={c.id} className="countdowns-grid-wide">
                  <CountdownForm start={c} onClose={() => setEditing(null)} />
                </div>
              ) : (
                <CountdownCard
                  key={c.id}
                  c={c}
                  now={now}
                  onEdit={() => {
                    setAdding(false)
                    setEditing(c.id)
                  }}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Home: the next few countdowns, big. Only ticks every minute, since it shows days and hours. */
function CountdownsHomeCard() {
  const list = useCountdowns()
  const now = useTicking(60_000)
  const upcoming = sortCountdowns(list, now)
    .map((c) => ({ c, s: countdownStatus(c, now) }))
    .filter(({ s }) => s.state !== 'done')
    .slice(0, 3)
  if (upcoming.length === 0) return null
  return (
    <HomeBox
      icon={<Hourglass size={15} />}
      title="Countdowns"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(COUNTDOWNS_TAB)}>
          All countdowns
        </button>
      }
    >
      <div className="countdowns-home" data-countdowns-home>
        {upcoming.map(({ c, s }) => {
          const big = bigNumber(c, s)
          return (
            <button key={c.id} className={`countdowns-home-card kind-${c.kind} state-${s.state}`} onClick={() => openSpecialTab(COUNTDOWNS_TAB)} title={leftText(s, !!c.time)}>
              <span className="countdowns-home-big">
                <strong>{big.value}</strong>
                <span>{big.unit}</span>
              </span>
              <span className="countdowns-home-title">
                <span aria-hidden>{kindOf(c.kind).emoji}</span> {c.title}
              </span>
            </button>
          )
        })}
      </div>
    </HomeBox>
  )
}
