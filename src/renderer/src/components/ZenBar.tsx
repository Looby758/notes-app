import { useEffect, useRef, useState } from 'react'
import { LogOut, Pause, Play, Plus, Settings2, SkipForward, Square, Timer } from 'lucide-react'
import { useUI, toggleZen } from '../store/ui'
import { setPrefs, usePrefs } from '../store/prefs'
import { addMinutes, formatClock, next, pauseTimer, phaseLabel, resumeTimer, secondsLeft, startTimer, stop, useTimer } from '../store/focusTimer'

/**
 * Zen mode's controls: the focus timer and the way out. They fade away while you write and come
 * back when you move the mouse.
 */
export default function ZenBar() {
  const zen = useUI((s) => s.zen)
  const [visible, setVisible] = useState(true)
  const [options, setOptions] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const timer = useTimer()
  const alwaysVisible = usePrefs((s) => s.prefs.timerAlwaysVisible)

  // Show on mouse movement; hide after a few quiet seconds (not while the options are open).
  useEffect(() => {
    if (!zen) return
    const wake = (): void => {
      setVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setVisible(false), 2500)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      clearTimeout(hideTimer.current)
    }
  }, [zen])
  useEffect(() => {
    if (!zen) setOptions(false)
  }, [zen])

  if (!zen) return null
  const running = timer.phase !== null
  const show = visible || options || (running && alwaysVisible)

  return (
    <div className={`zen-bar ${show ? 'show' : ''} ${visible || options ? '' : 'quiet'}`} data-zen-bar>
      {options && <TimerOptions close={() => setOptions(false)} />}
      <div className="zen-group">
        <Timer size={15} className="zen-timer-icon" />
        {running ? (
          <>
            <span className={`zen-phase ${timer.phase}`}>{phaseLabel(timer.phase!, timer.round, timer.rounds)}</span>
            <span className="zen-time" data-zen-time>
              {formatClock(secondsLeft(timer))}
            </span>
            {timer.pausedLeft !== null ? (
              <button className="zen-btn" onClick={resumeTimer} title="Carry on" data-timer-resume>
                <Play size={14} />
              </button>
            ) : (
              <button className="zen-btn" onClick={pauseTimer} title="Pause" data-timer-pause>
                <Pause size={14} />
              </button>
            )}
            <button className="zen-btn" onClick={() => addMinutes(5)} title="5 more minutes" data-timer-add>
              <Plus size={13} />5
            </button>
            <button className="zen-btn" onClick={() => next(true)} title="Skip to the next part" data-timer-skip>
              <SkipForward size={14} />
            </button>
            <button className="zen-btn" onClick={stop} title="Stop the timer" data-timer-stop>
              <Square size={13} />
            </button>
          </>
        ) : (
          <QuickStart />
        )}
        <button className={`zen-btn ${options ? 'on' : ''}`} onClick={() => setOptions(!options)} title="Timer options" data-timer-options>
          <Settings2 size={14} />
        </button>
      </div>
      <button className="zen-btn zen-exit" onClick={toggleZen} title="Leave zen mode (Esc)">
        <LogOut size={14} /> Leave
      </button>
    </div>
  )
}

/** One click to start: your usual length (from Settings), or a few others. */
function QuickStart() {
  const focus = usePrefs((s) => s.prefs.focusMinutes)
  const rounds = usePrefs((s) => s.prefs.focusRounds)
  const lengths = [...new Set([focus, 15, 25, 50])].slice(0, 4)
  return (
    <>
      {lengths.map((m) => (
        <button key={m} className={`zen-btn ${m === focus ? 'main' : ''}`} onClick={() => startTimer(m)} title={`Focus for ${m} minutes${rounds > 1 ? `, ${rounds} rounds` : ''}`} data-timer={m}>
          {m} min
        </button>
      ))}
    </>
  )
}

function NumberField({ label, value, min, max, onChange, unit }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; unit: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n)
    else setDraft(String(value))
  }
  return (
    <label className="timer-field">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label={label} />
      <em>{unit}</em>
    </label>
  )
}

/** The timer's settings, right in zen mode (also in Settings → Editor → Focus timer). */
function TimerOptions({ close }: { close: () => void }) {
  const p = usePrefs((s) => s.prefs)
  const running = useTimer((s) => s.phase !== null)
  const total = p.focusRounds * p.focusMinutes + Math.max(0, p.focusRounds - 1) * p.breakMinutes + (p.focusRounds > 1 ? p.longBreakMinutes : 0)
  return (
    <div className="timer-options" data-timer-panel>
      <div className="timer-options-grid">
        <NumberField label="Focus" value={p.focusMinutes} min={1} max={180} unit="min" onChange={(n) => setPrefs({ focusMinutes: n })} />
        <NumberField label="Rounds" value={p.focusRounds} min={1} max={12} unit={p.focusRounds === 1 ? 'round' : 'rounds'} onChange={(n) => setPrefs({ focusRounds: n })} />
        <NumberField label="Break" value={p.breakMinutes} min={1} max={60} unit="min" onChange={(n) => setPrefs({ breakMinutes: n })} />
        <NumberField label="Long break" value={p.longBreakMinutes} min={1} max={90} unit="min" onChange={(n) => setPrefs({ longBreakMinutes: n })} />
      </div>
      <p className="timer-summary">
        {p.focusRounds === 1
          ? `${p.focusMinutes} minutes of focus.`
          : `${p.focusRounds} × ${p.focusMinutes} min focus, ${p.breakMinutes} min breaks between, then a ${p.longBreakMinutes} min break. About ${total} min in all.`}
      </p>
      <label className="timer-check">
        <input type="checkbox" checked={p.timerChime} onChange={(e) => setPrefs({ timerChime: e.target.checked })} /> Chime when a part ends
      </label>
      <label className="timer-check">
        <input type="checkbox" checked={p.timerAlwaysVisible} onChange={(e) => setPrefs({ timerAlwaysVisible: e.target.checked })} /> Keep the countdown faintly visible while I write
      </label>
      <label className="timer-check">
        <input type="checkbox" checked={p.timerLeaveZen} onChange={(e) => setPrefs({ timerLeaveZen: e.target.checked })} /> Leave zen mode when the session ends
      </label>
      {!running && (
        <button
          className="btn btn-primary timer-start"
          onClick={() => {
            startTimer()
            close()
          }}
          data-timer-start
        >
          <Play size={13} /> Start
        </button>
      )}
    </div>
  )
}

/** Outside zen mode, a running timer shows in the status bar (click to stop it). */
export function StatusTimer() {
  const timer = useTimer()
  const zen = useUI((s) => s.zen)
  if (!timer.phase || zen) return null
  return (
    <button className="statusbar-btn status-timer" onClick={() => (timer.pausedLeft !== null ? resumeTimer() : pauseTimer())} title="Focus timer: click to pause or carry on" data-status-timer>
      <Timer size={11} /> {phaseLabel(timer.phase, timer.round, timer.rounds)} {formatClock(secondsLeft(timer))}
      {timer.pausedLeft !== null && ' (paused)'}
    </button>
  )
}
