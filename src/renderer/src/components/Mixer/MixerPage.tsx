import { useEffect, useRef, useState } from 'react'
import { AppWindow, Bell, Globe, RefreshCw, SlidersVertical, Speaker, Volume1, Volume2, VolumeX } from 'lucide-react'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { MIXER_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import { IS_MAC } from '@shared/platform'
import type { MixerApp, MixerState } from '@shared/mixer'

addHomeCard({ id: 'mixer', order: 26, title: 'Volume mixer', Card: MixerHomeCard })

/** How often to look again while the mixer shows (Windows answers quickly; a Mac runs a script each time). */
const EVERY = IS_MAC ? 2000 : 500

/** The sliders, kept up to date while the page (or Home box) is showing and the window is in view. */
function useMixer(every = EVERY): [MixerState | null, () => Promise<void>] {
  const [state, setState] = useState<MixerState | null>(null)
  const live = useRef(true)
  const look = async (): Promise<void> => {
    const s = await window.api.mixerGet().catch(() => null)
    if (live.current && s) setState(s)
  }
  useEffect(() => {
    live.current = true
    void look()
    const timer = setInterval(() => {
      if (!document.hidden) void look()
    }, every)
    return () => {
      live.current = false
      clearInterval(timer)
    }
  }, [every])
  return [state, look]
}

function AppIcon({ app }: { app: MixerApp }) {
  if (app.icon) return <img className="mixer-icon" src={app.icon} alt="" />
  const Icon = app.kind === 'master' ? Speaker : app.kind === 'system' ? Bell : app.kind === 'site' ? Globe : AppWindow
  return (
    <span className="mixer-icon">
      <Icon size={16} />
    </span>
  )
}

/** One app's slider, mute button and live level. */
function MixerRow({ app, compact, onChanged }: { app: MixerApp; compact?: boolean; onChanged: () => void }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const volume = dragging ?? app.volume
  const set = (v: number): void => {
    setDragging(v)
    void window.api.mixerVolume(app.id, v).then((ok) => {
      if (!ok) notify(`${app.name} didn’t take the change. It may have closed.`)
    })
  }
  const done = (): void => {
    // Keep showing the value let go of until the next look has it.
    setTimeout(() => setDragging(null), EVERY + 300)
  }
  const mute = (): void => {
    void window.api.mixerMute(app.id, !app.muted).then((ok) => {
      if (!ok) notify(`Couldn’t ${app.muted ? 'unmute' : 'mute'} ${app.name}.`)
      onChanged()
    })
  }
  const Icon = app.muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2
  return (
    <div className={`mixer-row${app.muted ? ' muted' : ''}${app.kind === 'master' ? ' master' : ''}${compact ? ' compact' : ''}`} data-mixer-row={app.id}>
      <AppIcon app={app} />
      <div className="mixer-main">
        <div className="mixer-name">
          <span title={app.name}>{app.name}</span>
          <span className="mixer-value">{app.muted ? 'Muted' : `${volume}%`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label={`Volume of ${app.name}`}
          onChange={(e) => set(Number(e.target.value))}
          onPointerUp={done}
          onKeyUp={done}
          onBlur={done}
        />
        {app.level !== undefined && !compact && (
          <div className="mixer-meter" aria-hidden>
            <div style={{ width: `${app.muted ? 0 : app.level}%` }} />
          </div>
        )}
      </div>
      <button className={`icon-btn mixer-mute${app.muted ? ' on' : ''}`} title={app.muted ? 'Unmute' : 'Mute'} aria-pressed={app.muted} onClick={mute}>
        <Icon size={15} />
      </button>
    </div>
  )
}

export default function MixerPage() {
  const [state, look] = useMixer()
  const [looking, setLooking] = useState(false)
  const master = state?.apps.find((a) => a.kind === 'master')
  const others = state?.apps.filter((a) => a.kind !== 'master') ?? []
  const again = async (): Promise<void> => {
    setLooking(true)
    await look()
    setLooking(false)
  }
  return (
    <div className="screens-page" data-mixer-page>
      <div className="screens-inner mixer-inner">
        <header className="screens-head">
          <h2>
            <SlidersVertical size={18} /> Volume mixer
          </h2>
          <button className="btn" onClick={() => void again()} disabled={looking}>
            <RefreshCw size={13} className={looking ? 'spin' : ''} /> Look again
          </button>
        </header>
        <p className="screens-intro">
          A volume for each app, so a game, Discord and music can each be as loud as you want. It’s the computer’s own volume for each app, so it stays set after Orbit closes. You can do this from your phone too, in Remote.
        </p>
        {!state && <p className="screens-note">Looking at what’s playing…</p>}
        {state?.problem && (
          <div className="screens-problem">
            <p>{state.problem}</p>
          </div>
        )}
        {master && (
          <section className="mixer-card">
            <MixerRow app={master} onChanged={() => void look()} />
            {state?.device && <p className="screens-note">Playing through {state.device}</p>}
          </section>
        )}
        {others.length > 0 && (
          <section className="mixer-card">
            {others.map((a) => (
              <MixerRow key={a.id} app={a} onChanged={() => void look()} />
            ))}
          </section>
        )}
        {state?.note && <p className="screens-note">{state.note}</p>}
      </div>
    </div>
  )
}

function MixerHomeCard() {
  const [state, look] = useMixer(2500)
  // Everything, then the first few apps (by name, so they don't jump about).
  const apps = (state?.apps ?? []).filter((a) => a.kind !== 'system').slice(0, 5)
  if (!state || state.problem || apps.length === 0) return null
  return (
    <HomeBox
      icon={<SlidersVertical size={15} />}
      title="Volume"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(MIXER_TAB)}>
          All apps
        </button>
      }
    >
      <div className="mixer-home">
        {apps.map((a) => (
          <MixerRow key={a.id} app={a} compact onChanged={() => void look()} />
        ))}
      </div>
    </HomeBox>
  )
}
