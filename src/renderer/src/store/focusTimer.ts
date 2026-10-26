import { create } from 'zustand'
import { usePrefs } from './prefs'
import { notify } from './notify'
import { useUI, toggleZen } from './ui'
import { chime } from '../lib/ambience'

/**
 * The focus timer: focus for a while, then (with several rounds) a short break, focus again… and a
 * longer break at the end. It can be paused, extended or skipped, and keeps running if you leave
 * zen mode (the status bar shows it).
 */

export type Phase = 'focus' | 'break' | 'longBreak'

interface TimerState {
  phase: Phase | null
  /** Which focus round (1-based). */
  round: number
  rounds: number
  /** When the current phase ends (ms), or null while paused. */
  endsAt: number | null
  /** Paused: what was left (ms). */
  pausedLeft: number | null
  /** Now, roughly (re-renders the countdown). */
  now: number
}

export const useTimer = create<TimerState>(() => ({ phase: null, round: 1, rounds: 1, endsAt: null, pausedLeft: null, now: Date.now() }))

let ticker: ReturnType<typeof setInterval> | null = null

const minutes = (phase: Phase): number => {
  const p = usePrefs.getState().prefs
  return phase === 'focus' ? p.focusMinutes : phase === 'break' ? p.breakMinutes : p.longBreakMinutes
}

function run(phase: Phase, round: number, rounds: number, lengthMinutes = minutes(phase)): void {
  useTimer.setState({ phase, round, rounds, endsAt: Date.now() + lengthMinutes * 60_000, pausedLeft: null, now: Date.now() })
  ticker ??= setInterval(tick, 500)
}

function tick(): void {
  const s = useTimer.getState()
  useTimer.setState({ now: Date.now() })
  if (s.endsAt && Date.now() >= s.endsAt) next(false)
}

/** Moves on to what comes after the current phase (`skipped`: no chime). */
export function next(skipped = true): void {
  const { phase, round, rounds } = useTimer.getState()
  const { timerChime, timerLeaveZen } = usePrefs.getState().prefs
  if (!phase) return
  if (phase === 'focus' && round < rounds) {
    if (timerChime && !skipped) chime(true)
    notify(`Round ${round} done. Take a ${minutes('break')} minute break.`, 'info')
    run('break', round, rounds)
  } else if (phase === 'focus' && rounds > 1) {
    if (timerChime && !skipped) chime(true)
    notify(`All ${rounds} rounds done. Enjoy a longer break.`, 'info')
    run('longBreak', round, rounds)
  } else if (phase === 'break') {
    if (timerChime && !skipped) chime(false)
    notify(`Break's over. Round ${round + 1} of ${rounds}.`, 'info')
    run('focus', round + 1, rounds)
  } else {
    if (timerChime && !skipped) chime(false)
    stop()
    notify('Focus session done. Nice work.', 'info')
    if (timerLeaveZen && useUI.getState().zen) toggleZen()
  }
}

/** Starts a session: `focusMinutes` (default from Settings), for `rounds` rounds. */
export function startTimer(focusMinutes?: number, rounds?: number): void {
  const p = usePrefs.getState().prefs
  run('focus', 1, Math.max(1, rounds ?? p.focusRounds), focusMinutes ?? p.focusMinutes)
}

export function pauseTimer(): void {
  const { endsAt } = useTimer.getState()
  if (endsAt) useTimer.setState({ endsAt: null, pausedLeft: Math.max(0, endsAt - Date.now()) })
}

export function resumeTimer(): void {
  const { pausedLeft } = useTimer.getState()
  if (pausedLeft !== null) useTimer.setState({ endsAt: Date.now() + pausedLeft, pausedLeft: null })
}

export function addMinutes(n: number): void {
  const { endsAt, pausedLeft } = useTimer.getState()
  if (endsAt) useTimer.setState({ endsAt: endsAt + n * 60_000 })
  else if (pausedLeft !== null) useTimer.setState({ pausedLeft: pausedLeft + n * 60_000 })
}

export function stop(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
  useTimer.setState({ phase: null, endsAt: null, pausedLeft: null })
}

/** Seconds left in the current phase. */
export function secondsLeft(s: Pick<TimerState, 'endsAt' | 'pausedLeft' | 'now'>): number {
  const ms = s.endsAt ? s.endsAt - s.now : (s.pausedLeft ?? 0)
  return Math.max(0, Math.ceil(ms / 1000))
}

export const formatClock = (sec: number): string => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const phaseLabel = (phase: Phase, round: number, rounds: number): string =>
  phase === 'focus' ? (rounds > 1 ? `Focus ${round}/${rounds}` : 'Focus') : phase === 'break' ? 'Break' : 'Long break'
