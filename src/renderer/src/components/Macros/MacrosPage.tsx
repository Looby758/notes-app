import { useEffect, useMemo, useState } from 'react'
import { Circle, Crosshair, Keyboard, MousePointer2, MousePointerClick, Play, Square, Trash2, X } from 'lucide-react'
import {
  BUTTON_NAMES,
  clickerPlan,
  clicksPerSecond,
  formatMs,
  intervalFor,
  keyLabel,
  MOUSE_MODES,
  playLength,
  type ClickerSettings,
  type MacroHotkeys,
  type MacroStatus,
  type MacroStep,
  type MacroView
} from '@shared/macros'
import { acceleratorFromEvent, hotkeyLabel } from '@shared/soundboard'
import { IS_MAC } from '@shared/platform'

/** The page's copy of the status, kept up to date by the main process. */
function useMacros(): [MacroStatus | null, (s: MacroStatus) => void] {
  const [status, setStatus] = useState<MacroStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.api.macrosGet().then((s) => live && setStatus(s))
    const off = window.api.onMacrosChanged((s) => live && setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return [status, setStatus]
}

/** Ticks while something is going on, for the running clock. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [on])
  return now
}

const clock = (ms: number): string => {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

function HotkeyButton({ value, onChange, label }: { value: string; onChange: (accel: string) => void; label?: string }) {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      if (e.key === 'Escape' && plain) return setListening(false)
      if ((e.key === 'Backspace' || e.key === 'Delete') && plain) {
        onChange('')
        return setListening(false)
      }
      const accel = acceleratorFromEvent(e)
      if (!accel) return
      onChange(accel)
      setListening(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, onChange])
  return (
    <span className="macro-hotkey">
      <button className={`btn${listening ? ' listening' : ''}`} onClick={() => setListening(!listening)} aria-label={label}>
        <Keyboard size={13} /> {listening ? 'Press the keys… (Esc cancels)' : value ? hotkeyLabel(value) : 'Set a hotkey'}
      </button>
      {value && !listening && (
        <button className="icon-btn" title="No hotkey" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </span>
  )
}

/** Picks one key (for the auto-clicker): press it. */
function KeyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key !== 'Escape') onChange(e.code)
      setListening(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, onChange])
  return (
    <button className={`btn${listening ? ' listening' : ''}`} onClick={() => setListening(!listening)}>
      <Keyboard size={13} /> {listening ? 'Press a key…' : keyLabel(value)}
    </button>
  )
}

function StatusBar({ status }: { status: MacroStatus }) {
  const a = status.activity
  const now = useNow(a.kind !== 'idle')
  const h = status.data.hotkeys
  if (a.kind === 'idle') return null
  if (a.kind === 'recording')
    return (
      <div className="macro-live recording" data-macro-live="recording">
        <span className="macro-dot" />
        <strong>Recording</strong>
        <span>{clock(now - a.since)}</span>
        <span className="macro-live-count">{a.events.toLocaleString()} inputs</span>
        <span className="macro-live-hint">{h.record ? `Press ${hotkeyLabel(h.record)} to stop and keep it` : 'Press Stop to keep it'}</span>
        <button className="btn btn-primary" onClick={() => void window.api.macrosRecord()}>
          <Square size={13} /> Stop
        </button>
      </div>
    )
  if (a.kind === 'playing') {
    const m = status.data.macros.find((x) => x.id === a.id)
    return (
      <div className="macro-live playing" data-macro-live="playing">
        <Play size={14} />
        <strong>Playing {m?.name ?? 'macro'}</strong>
        <span>{a.loops === 1 ? clock(now - a.since) : a.loops === 0 ? `Go ${a.loop.toLocaleString()} (until stopped)` : `Go ${a.loop} of ${a.loops}`}</span>
        <span className="macro-live-hint">{h.play ? `${hotkeyLabel(h.play)} stops` : ''}</span>
        <button className="btn" onClick={() => void window.api.macrosStop()}>
          <Square size={13} /> Stop
        </button>
      </div>
    )
  }
  return (
    <div className="macro-live clicking" data-macro-live="clicking">
      <MousePointerClick size={14} />
      <strong>Auto-clicker on</strong>
      <span>{clock(now - a.since)}</span>
      <span className="macro-live-count">{a.clicks.toLocaleString()} clicks</span>
      <span className="macro-live-hint">{h.clicker ? `${hotkeyLabel(h.clicker)} stops` : ''}</span>
      <button className="btn" onClick={() => void window.api.macrosClicker(false)}>
        <Square size={13} /> Stop
      </button>
    </div>
  )
}

/** Lanes of bars: each key and button held for exactly as long as it was, plus the mouse movement. */
function Timeline({ macro }: { macro: MacroView }) {
  const length = Math.max(macro.length, 1)
  const lanes = useMemo(() => {
    const byName = new Map<string, MacroStep[]>()
    for (const s of macro.steps) {
      const name = s.kind === 'key' ? keyLabel(s.code) : s.kind === 'button' ? BUTTON_NAMES[s.b] : s.kind === 'move' ? 'Mouse' : 'Scroll'
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name)!.push(s)
    }
    return [...byName.entries()].slice(0, 10)
  }, [macro.steps])
  if (!lanes.length) return null
  const pct = (ms: number): string => `${Math.min(100, (ms / length) * 100)}%`
  return (
    <div className="macro-timeline" aria-label="Timeline">
      {lanes.map(([name, steps]) => (
        <div className="macro-lane" key={name}>
          <span className="macro-lane-name">{name}</span>
          <div className="macro-lane-track">
            {steps.map((s, i) => {
              const dur = s.kind === 'move' ? s.until - s.at : s.kind === 'scroll' ? 0 : (s.held ?? 0)
              return (
                <span
                  key={i}
                  className={`macro-bar ${s.kind}${s.kind === 'move' && s.game ? ' game' : ''}`}
                  style={{ left: pct(s.at), width: `max(3px, ${pct(dur)})` }}
                  title={`${formatMs(s.at)}${dur ? ` · ${formatMs(dur)}` : ''}`}
                />
              )
            })}
          </div>
        </div>
      ))}
      <div className="macro-lane macro-scale">
        <span />
        <div className="macro-lane-track">
          <span style={{ left: 0 }}>0</span>
          <span style={{ right: 0 }}>{formatMs(macro.length)}</span>
        </div>
      </div>
    </div>
  )
}

function StepRow({ step }: { step: MacroStep }) {
  if (step.kind === 'key')
    return (
      <li>
        <span className="macro-at">{formatMs(step.at)}</span>
        <kbd>{keyLabel(step.code)}</kbd>
        <span>{step.held === null ? 'pressed' : `held ${formatMs(step.held)}`}</span>
        {step.repeats > 0 && <span className="macro-faint">({step.repeats} key repeats)</span>}
      </li>
    )
  if (step.kind === 'button')
    return (
      <li>
        <span className="macro-at">{formatMs(step.at)}</span>
        <span className="macro-chip">{BUTTON_NAMES[step.b]}</span>
        <span>{step.held === null ? 'pressed' : `held ${formatMs(step.held)}`}</span>
      </li>
    )
  if (step.kind === 'move')
    return (
      <li className="macro-faint">
        <span className="macro-at">{formatMs(step.at)}</span>
        <MousePointer2 size={12} />
        <span>
          {step.game ? 'Turned the camera' : 'Moved the mouse'} for {formatMs(step.until - step.at)} ({step.count.toLocaleString()} move{step.count === 1 ? '' : 's'})
        </span>
      </li>
    )
  return (
    <li className="macro-faint">
      <span className="macro-at">{formatMs(step.at)}</span>
      <span>
        Scrolled {step.notches > 0 ? 'up' : 'down'} {Math.abs(Math.round(step.notches * 10) / 10)} notch{Math.abs(step.notches) === 1 ? '' : 'es'}
      </span>
    </li>
  )
}

function MacroDetail({ macro, status }: { macro: MacroView; status: MacroStatus }) {
  const [name, setName] = useState(macro.name)
  useEffect(() => setName(macro.name), [macro.id, macro.name])
  const update = (patch: Parameters<typeof window.api.macrosUpdate>[1]): void => void window.api.macrosUpdate(macro.id, patch)
  const playing = status.activity.kind === 'playing' && status.activity.id === macro.id
  const total = playLength(macro)
  const report = status.lastPlay?.id === macro.id ? status.lastPlay : null
  const hotkeyError = status.hotkeyErrors[macro.id]
  const otherComputer = macro.os !== (IS_MAC ? 'mac' : 'win') && macro.mouse !== 'none'
  return (
    <section className="macro-detail" data-macro-detail={macro.id}>
      <header>
        <input
          className="text-input macro-name"
          value={name}
          aria-label="Name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== macro.name && update({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {playing ? (
          <button className="btn" onClick={() => void window.api.macrosStop()}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary" disabled={status.activity.kind === 'recording' || !!status.problem} onClick={() => void window.api.macrosPlay(macro.id)}>
            <Play size={13} /> Play
          </button>
        )}
        <button className="icon-btn" title="Delete this macro" onClick={() => void window.api.macrosRemove(macro.id)}>
          <Trash2 size={14} />
        </button>
      </header>
      <p className="macro-faint">
        {macro.summary} · {formatMs(macro.length)} a go{total !== null && macro.repeat !== 'once' ? ` · ${formatMs(total)} in all` : ''}
      </p>
      {report && (
        <p className={`macro-report${report.worstLateMs > 2 ? ' late' : ''}`} data-macro-report>
          {report.stopped ? 'Stopped early. ' : 'Played. '}
          {report.events.toLocaleString()} inputs, each within {formatMs(report.worstLateMs)} of its time (on average {formatMs(report.averageLateMs)}).
        </p>
      )}

      <div className="macro-fields">
        <label>Repeat</label>
        <div className="macro-row">
          {(['once', 'times', 'forever'] as const).map((r) => (
            <button key={r} className={`screens-chip${macro.repeat === r ? ' on' : ''}`} onClick={() => update({ repeat: r })}>
              {r === 'once' ? 'Once' : r === 'times' ? 'A number of times' : 'Until I stop it'}
            </button>
          ))}
          {macro.repeat === 'times' && (
            <input
              className="text-input macro-num"
              type="number"
              min={1}
              value={macro.times}
              aria-label="How many times"
              onChange={(e) => Number(e.target.value) >= 1 && update({ times: Number(e.target.value) })}
            />
          )}
        </div>
        <label>Speed</label>
        <div className="macro-row">
          {[0.5, 1, 2, 4].map((s) => (
            <button key={s} className={`screens-chip${macro.speed === s ? ' on' : ''}`} onClick={() => update({ speed: s })}>
              {s === 1 ? 'As recorded' : `${s}×`}
            </button>
          ))}
          <input
            className="text-input macro-num"
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={macro.speed}
            aria-label="Speed"
            onChange={(e) => Number(e.target.value) > 0 && update({ speed: Number(e.target.value) })}
          />
        </div>
        <label>Mouse</label>
        <div>
          <div className="macro-row">
            {MOUSE_MODES.map((m) => (
              <button key={m.id} className={`screens-chip${macro.mouse === m.id ? ' on' : ''}`} onClick={() => update({ mouse: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="macro-faint">{MOUSE_MODES.find((m) => m.id === macro.mouse)?.hint}</p>
          {otherComputer && <p className="macro-faint">Recorded on the {macro.os === 'mac' ? 'Mac' : 'PC'}: keys play the same, but pointer positions were for its screens.</p>}
        </div>
        <label>Hotkey</label>
        <div>
          <HotkeyButton value={macro.hotkey} onChange={(accel) => update({ hotkey: accel })} label="Play hotkey" />
          <p className="macro-faint">Plays this macro from anywhere, even in a game. Press it again to stop.</p>
          {hotkeyError && <p className="screens-error">{hotkeyError}</p>}
        </div>
      </div>

      <h4>What it does</h4>
      <Timeline macro={macro} />
      <ol className="macro-steps">
        {macro.steps.map((s, i) => (
          <StepRow key={i} step={s} />
        ))}
        {macro.moreSteps > 0 && <li className="macro-faint">…and {macro.moreSteps.toLocaleString()} more</li>}
      </ol>
    </section>
  )
}

function Clicker({ status }: { status: MacroStatus }) {
  const c = status.data.clicker
  const set = (patch: Partial<ClickerSettings>): void => void window.api.macrosSettings({ clicker: patch })
  const [unit, setUnit] = useState<'cps' | 'ms'>('cps')
  const [countdown, setCountdown] = useState(0)
  const on = status.activity.kind === 'clicking'
  const plan = clickerPlan(c)
  const speed = unit === 'cps' ? Math.round(clicksPerSecond(c.intervalMs) * 1000) / 1000 : c.intervalMs
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => {
      if (countdown === 1) void window.api.macrosPointer().then((p) => set({ where: 'spot', x: p.x, y: p.y }))
      setCountdown(countdown - 1)
    }, 1000)
    return () => clearTimeout(t)
  })
  const what = c.what === 'key' ? `press ${keyLabel(c.key)}` : `${c.what} click`
  return (
    <section className="screens-card macro-clicker" data-macro-clicker>
      <header>
        <MousePointerClick size={16} />
        <h3>Auto-clicker</h3>
        {on ? (
          <button className="btn macro-start" onClick={() => void window.api.macrosClicker(false)}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary macro-start" disabled={status.activity.kind === 'recording' || !!status.problem} onClick={() => void window.api.macrosClicker(true)}>
            <Play size={13} /> Start
          </button>
        )}
      </header>
      <div className="macro-fields">
        <label>Click</label>
        <div className="macro-row">
          {(['left', 'right', 'middle', 'key'] as const).map((w) => (
            <button key={w} className={`screens-chip${c.what === w ? ' on' : ''}`} onClick={() => set({ what: w })}>
              {w === 'key' ? 'A key' : `${w[0].toUpperCase()}${w.slice(1)}`}
            </button>
          ))}
          {c.what === 'key' && <KeyPicker value={c.key} onChange={(key) => set({ key })} />}
        </div>
        <label>Speed</label>
        <div className="macro-row">
          <input
            className="text-input macro-num"
            type="number"
            min={unit === 'cps' ? 0.001 : 1}
            step="any"
            value={speed}
            aria-label="Speed"
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v > 0) set({ intervalMs: unit === 'cps' ? intervalFor(v) : v })
            }}
          />
          <button className={`screens-chip${unit === 'cps' ? ' on' : ''}`} onClick={() => setUnit('cps')}>
            clicks a second
          </button>
          <button className={`screens-chip${unit === 'ms' ? ' on' : ''}`} onClick={() => setUnit('ms')}>
            ms between clicks
          </button>
        </div>
        <label>Hold each</label>
        <div>
          <div className="macro-row">
            <input
              className="text-input macro-num"
              type="number"
              min={0}
              step="any"
              value={c.holdMs}
              aria-label="Hold each click for (ms)"
              onChange={(e) => Number(e.target.value) >= 0 && set({ holdMs: Number(e.target.value) })}
            />
            <span className="macro-faint">ms down before it comes up</span>
          </div>
          {plan.problem && <p className="screens-error">{plan.problem}</p>}
        </div>
        <label>Stop</label>
        <div className="macro-row">
          {(['never', 'clicks', 'seconds'] as const).map((s) => (
            <button key={s} className={`screens-chip${c.stop === s ? ' on' : ''}`} onClick={() => set({ stop: s })}>
              {s === 'never' ? 'When I stop it' : s === 'clicks' ? 'After a number of clicks' : 'After some seconds'}
            </button>
          ))}
          {c.stop !== 'never' && (
            <input
              className="text-input macro-num"
              type="number"
              min={1}
              value={c.stopAfter}
              aria-label={c.stop === 'clicks' ? 'Clicks' : 'Seconds'}
              onChange={(e) => Number(e.target.value) >= 1 && set({ stopAfter: Number(e.target.value) })}
            />
          )}
        </div>
        <label>Where</label>
        <div className="macro-row">
          <button className={`screens-chip${c.where === 'pointer' ? ' on' : ''}`} onClick={() => set({ where: 'pointer' })}>
            Wherever the pointer is
          </button>
          <button className={`screens-chip${c.where === 'spot' ? ' on' : ''}`} onClick={() => set({ where: 'spot' })}>
            One spot{c.where === 'spot' ? ` (${c.x}, ${c.y})` : ''}
          </button>
          {c.where === 'spot' && (
            <button className="btn" onClick={() => setCountdown(3)} disabled={countdown > 0}>
              <Crosshair size={13} /> {countdown > 0 ? `Point at it… ${countdown}` : 'Pick the spot'}
            </button>
          )}
        </div>
      </div>
      {status.activity.kind === 'clicking' && (
        <p className="macro-report" data-macro-clicking>
          Clicking: {status.activity.clicks.toLocaleString()} so far.
        </p>
      )}
      <p className="macro-faint" data-macro-clicker-sum>
        {what[0].toUpperCase() + what.slice(1)} every {formatMs(plan.intervalMs)} (
        {Math.round(clicksPerSecond(plan.intervalMs) * 100) / 100} a second), each held {formatMs(plan.holdMs)}. Click n always lands at exactly n × {formatMs(plan.intervalMs)} from the start, so it
        never drifts.
      </p>
      {status.hotkeyErrors.clicker && <p className="screens-error">{status.hotkeyErrors.clicker}</p>}
    </section>
  )
}

function Hotkeys({ status }: { status: MacroStatus }) {
  const h = status.data.hotkeys
  const set = (k: keyof MacroHotkeys, accel: string): void => void window.api.macrosSettings({ hotkeys: { [k]: accel } })
  const rows: { k: keyof MacroHotkeys; label: string }[] = [
    { k: 'record', label: 'Start / stop recording' },
    { k: 'play', label: 'Play / stop the picked macro' },
    { k: 'clicker', label: 'Start / stop the auto-clicker' }
  ]
  return (
    <section className="screens-card" data-macro-hotkeys>
      <header>
        <Keyboard size={16} />
        <h3>Hotkeys</h3>
      </header>
      <p className="macro-faint">These work everywhere, even in a full-screen game. Their keys are never recorded into a macro.</p>
      <div className="macro-fields">
        {rows.map(({ k, label }) => (
          <div className="macro-field-pair" key={k}>
            <label>{label}</label>
            <div>
              <HotkeyButton value={h[k]} onChange={(accel) => set(k, accel)} label={label} />
              {status.hotkeyErrors[k] && <p className="screens-error">{status.hotkeyErrors[k]}</p>}
            </div>
          </div>
        ))}
      </div>
      <label className="macro-check">
        <input type="checkbox" checked={status.data.trimStart} onChange={(e) => void window.api.macrosSettings({ trimStart: e.target.checked })} />
        Start a new macro at my first key or click (leave out the wait before it)
      </label>
    </section>
  )
}

export default function MacrosPage() {
  const [status] = useMacros()
  if (!status) return <div className="screens-page" />
  const { data, activity } = status
  const current = data.macros.find((m) => m.id === data.current) ?? data.macros[0]
  const recording = activity.kind === 'recording'
  return (
    <div className="screens-page" data-macros-page>
      <div className="screens-inner">
        <header className="screens-head">
          <h2>
            <Keyboard size={18} /> Macros
          </h2>
          <button className={`btn ${recording ? '' : 'btn-primary'}`} disabled={!!status.problem && !recording} onClick={() => void window.api.macrosRecord()}>
            {recording ? <Square size={13} /> : <Circle size={13} className="macro-rec-icon" />} {recording ? 'Stop recording' : 'Record a macro'}
            {data.hotkeys.record && <kbd>{hotkeyLabel(data.hotkeys.record)}</kbd>}
          </button>
        </header>
        <p className="screens-intro">
          Record your keys and mouse, and Orbit plays them back exactly: every key and button goes down and comes up at the same moment it did, so a key held for 1.25 seconds is held for 1.25 seconds again,
          and the mouse moves the same way at the same speed.
        </p>
        {status.problem && (
          <div className="screens-problem">
            <p>{status.problem}</p>
          </div>
        )}
        {status.error && (
          <div className="screens-problem">
            <p>{status.error}</p>
            <button className="btn" onClick={() => void window.api.macrosDismiss()}>
              OK
            </button>
          </div>
        )}
        <StatusBar status={status} />

        <div className="macro-layout">
          <aside className="macro-list" data-macro-list>
            {data.macros.length === 0 && (
              <p className="macro-faint macro-empty">
                No macros yet. Press {data.hotkeys.record ? hotkeyLabel(data.hotkeys.record) : 'Record a macro'}, do what you want repeated (in a game or anywhere), then press it again.
              </p>
            )}
            {data.macros.map((m) => {
              const playing = activity.kind === 'playing' && activity.id === m.id
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  className={`macro-item${m.id === current?.id ? ' on' : ''}${playing ? ' playing' : ''}`}
                  onClick={() => void window.api.macrosSetCurrent(m.id)}
                  onKeyDown={(e) => e.key === 'Enter' && void window.api.macrosSetCurrent(m.id)}
                >
                  <div className="macro-item-main">
                    <strong>{m.name}</strong>
                    <span className="macro-faint">
                      {formatMs(m.length)} · {m.summary}
                    </span>
                  </div>
                  {m.hotkey && <kbd>{hotkeyLabel(m.hotkey)}</kbd>}
                  <button
                    className="icon-btn"
                    title={playing ? 'Stop' : 'Play'}
                    disabled={recording || !!status.problem}
                    onClick={(e) => {
                      e.stopPropagation()
                      void (playing ? window.api.macrosStop() : window.api.macrosPlay(m.id))
                    }}
                  >
                    {playing ? <Square size={13} /> : <Play size={13} />}
                  </button>
                </div>
              )
            })}
            {data.macros.length > 0 && data.hotkeys.play && <p className="macro-faint">{hotkeyLabel(data.hotkeys.play)} plays the picked one.</p>}
          </aside>
          {current ? <MacroDetail macro={current} status={status} /> : <div />}
        </div>

        <div className="macro-bottom">
          <Clicker status={status} />
          <Hotkeys status={status} />
        </div>
        {!IS_MAC && (
          <p className="screens-note">
            If a game runs as administrator, Windows only lets Orbit press keys in it when Orbit runs as administrator too.
          </p>
        )}
      </div>
    </div>
  )
}
