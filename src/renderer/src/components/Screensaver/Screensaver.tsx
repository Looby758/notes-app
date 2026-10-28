import { useEffect, useState } from 'react'
import { degrees, describeWeather } from '@shared/weather'
import { usePrefs } from '../../store/prefs'
import { useForecast } from '../../store/weather'
import { currentPosition, useMusic, watchMusic } from '../../store/music'
import { useStreamerOn } from '../../store/streamer'
import { useMotion } from '../../lib/motion'
import { dayKey, formatDate } from '../../lib/dates'
import { WeatherIcon } from '../Weather/Weather'
import './screensaver.css'

/** How long it takes to fade away once you're back (screensaver.css matches it). */
const LEAVE_MS = 450
/** A nudge of the mouse smaller than this doesn't count as being back. */
const MOVE_PX = 12

// When the app was last used (keys, clicks, the mouse, scrolling).
let lastActive = Date.now()
const touch = (): void => {
  lastActive = Date.now()
}
if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'mousedown', 'pointermove', 'wheel', 'touchstart'] as const) window.addEventListener(ev, touch, { capture: true, passive: true })
}

/** True when something is playing a video in the app (a YouTube note, a recording), so it isn't covered up. */
const videoPlaying = (): boolean => [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended)

/**
 * Settings → Appearance → Screensaver: after a few minutes without using Notes, the app fades into
 * a slow, moving screen with the time, the weather and what's playing. Any key, click or real
 * mouse movement brings the app back (the click that wakes it doesn't click what's underneath).
 */
export default function Screensaver() {
  const on = usePrefs((s) => s.prefs.screensaver)
  const minutes = usePrefs((s) => s.prefs.screensaverMinutes)
  const [phase, setPhase] = useState<'off' | 'on' | 'leaving'>('off')

  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => {
      if (document.hidden || videoPlaying()) return touch()
      if (Date.now() - lastActive > minutes * 60_000) setPhase((p) => (p === 'off' ? 'on' : p))
    }, 5_000)
    return () => clearInterval(timer)
  }, [on, minutes])

  // Turning it off in Settings (or from another window) closes it straight away.
  useEffect(() => {
    if (!on) setPhase('off')
  }, [on])

  useEffect(() => {
    if (phase !== 'on') return
    let start: { x: number; y: number } | null = null
    const wake = (): void => {
      touch()
      setPhase('leaving')
    }
    const swallow = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
      wake()
    }
    const onMove = (e: PointerEvent): void => {
      start ??= { x: e.clientX, y: e.clientY }
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) wake()
    }
    const opts = { capture: true }
    window.addEventListener('keydown', swallow, opts)
    window.addEventListener('mousedown', swallow, opts)
    window.addEventListener('wheel', wake, opts)
    window.addEventListener('pointermove', onMove, opts)
    return () => {
      window.removeEventListener('keydown', swallow, opts)
      window.removeEventListener('mousedown', swallow, opts)
      window.removeEventListener('wheel', wake, opts)
      window.removeEventListener('pointermove', onMove, opts)
    }
  }, [phase])

  // The click that woke it up shouldn't land on the app either (mouseup → click).
  useEffect(() => {
    if (phase !== 'leaving') return
    const eat = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('click', eat, { capture: true, once: true })
    const t = setTimeout(() => {
      window.removeEventListener('click', eat, { capture: true })
      setPhase('off')
    }, LEAVE_MS)
    return () => {
      clearTimeout(t)
      window.removeEventListener('click', eat, { capture: true })
    }
  }, [phase])

  if (phase === 'off') return null
  return <Scene leaving={phase === 'leaving'} />
}

function Scene({ leaving }: { leaving: boolean }) {
  const motion = useMotion()
  const now = useNow()
  return (
    <div className={`screensaver ${leaving ? 'leaving' : ''}`} aria-hidden>
      <div className="ss-sky">
        <i className="ss-glow a" />
        <i className="ss-glow b" />
        <i className="ss-glow c" />
      </div>
      <div className="ss-stars" />
      <div className={`ss-content ${motion === 'full' ? 'drifting' : ''}`}>
        <Clock now={now} />
        <div className="ss-date">{formatDate(now, 'dddd D MMMM')}</div>
        <div className="ss-cards">
          <WeatherCard />
          <NowPlaying />
        </div>
      </div>
    </div>
  )
}

/** The time, ticking once a second. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Big digits; each one rolls into place when it changes, and a thin line fills up over the minute. */
function Clock({ now }: { now: Date }) {
  const twelve = usePrefs((s) => s.prefs.timeFormat === '12h')
  const time = formatDate(now, twelve ? 'h:mm' : 'HH:mm')
  return (
    <div className="ss-clock">
      <div className="ss-time">
        {[...time].map((ch, i) =>
          ch === ':' ? (
            <span key={`colon${i}`} className="ss-colon">
              :
            </span>
          ) : (
            // Keyed by the digit, so a new one mounts (and rolls in) only when it changes.
            <span key={`${i}:${ch}`} className="ss-digit">
              {ch}
            </span>
          )
        )}
        {twelve && <span className="ss-ampm">{formatDate(now, 'A')}</span>}
      </div>
      <div className="ss-minute">
        <i style={{ transform: `scaleX(${(now.getSeconds() + 1) / 60})` }} />
      </div>
    </div>
  )
}

function WeatherCard() {
  const show = usePrefs((s) => s.prefs.weatherHome)
  const streamer = useStreamerOn()
  const { place, forecast } = useForecast(show)
  if (!show || !place || !forecast) return null
  const now = forecast.current
  const today = forecast.days.find((d) => d.date === dayKey(new Date()))
  return (
    <div className="ss-card ss-weather">
      <span className="ss-weather-icon">
        <WeatherIcon code={now.code} size={40} night={!now.isDay} />
      </span>
      <div className="ss-card-text">
        <strong>
          {degrees(now.temp)} <span>{describeWeather(now.code).label}</span>
        </strong>
        <span className="ss-faint">
          {/* Streamer mode: your town isn't shown at all (there's nothing to click on a screensaver). */}
          {!streamer && `${place.name} · `}
          {today ? `High ${degrees(today.max)}, low ${degrees(today.min)}` : `Feels like ${degrees(now.feels)}`}
        </span>
      </div>
    </div>
  )
}

function NowPlaying() {
  const status = useMusic((s) => s.status)
  const local = useMusic((s) => s.local)
  const state = useMusic((s) => s.state)
  const at = useMusic((s) => s.at)
  const usable = local || (!!status && (status.appControl || status.connected))
  useEffect(() => (usable ? watchMusic() : undefined), [usable])
  // Re-draw each second so the progress bar moves between updates.
  const [, tick] = useState(0)
  const playing = !!state?.playing
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [playing])
  const track = state?.track
  const [artFailed, setArtFailed] = useState<string | null>(null)
  if (!usable || !state || state.hint || !track) return null
  const progress = track.durationMs > 0 ? Math.min(1, currentPosition(state, at) / track.durationMs) : 0
  const art = track.art && artFailed !== track.art ? track.art : null
  return (
    <div className={`ss-card ss-music ${playing ? 'playing' : 'paused'}`}>
      {art ? (
        <img key={art} className="ss-art" src={art} alt="" onError={() => setArtFailed(art)} />
      ) : (
        <span className="ss-art ss-art-empty" />
      )}
      <div className="ss-card-text">
        <strong key={track.name} className="ss-song">
          {track.name}
        </strong>
        <span className="ss-faint">{track.artist}</span>
        <div className="ss-progress">
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
      <span className="ss-bars">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
