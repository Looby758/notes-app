import { useEffect, useRef, useState } from 'react'
import { Check, Contrast, Copy, Keyboard, Monitor as MonitorIcon, Pencil, Plus, RefreshCw, Sun, SunDim, Trash2 } from 'lucide-react'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, SCREENS_TAB } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import { acceleratorFromEvent, hotkeyLabel } from '@shared/soundboard'
import { TRAY_NAME } from '@shared/platform'
import {
  COMMON_INPUTS,
  inputName,
  MAX_HOTKEYS,
  percent,
  type Level,
  type Monitor,
  type MonitorAction,
  type MonitorHotkey,
  type MonitorSaved,
  type MonitorSetting,
  type MonitorsStatus
} from '@shared/monitors'

addHomeCard({ id: 'screens', order: 23, title: 'Screens', Card: ScreensHomeCard })

/** Your screens, kept up to date while the page (or Home box) is showing. */
function useMonitors(): [MonitorsStatus | null, (s: MonitorsStatus) => void] {
  const [status, setStatus] = useState<MonitorsStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.api.monitorsGet().then((s) => live && setStatus(s))
    const off = window.api.onMonitorsChanged((s) => live && setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return [status, setStatus]
}

const save = (saved: MonitorSaved): Promise<MonitorsStatus> => window.api.monitorsSave(saved)

/** A slider for brightness or contrast that follows your finger and sends the screen the latest value. */
function LevelSlider({ monitor, setting, level, compact }: { monitor: Monitor; setting: Exclude<MonitorSetting, 'input'>; level: Level; compact?: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const value = dragging ?? level.value
  const max = level.max > 0 ? level.max : 100
  const label = setting === 'brightness' ? 'Brightness' : 'Contrast'
  const set = (v: number): void => {
    setDragging(v)
    void window.api.monitorSet(monitor.id, setting, v).then((ok) => {
      if (!ok) notify(`${monitor.name} didn’t take the change. It may have DDC/CI turned off in its own menu.`)
    })
  }
  return (
    <label className={`screens-level${compact ? ' compact' : ''}`}>
      <span className="screens-level-name">
        {setting === 'brightness' ? <Sun size={13} /> : <Contrast size={13} />}
        {!compact && label}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-label={`${label} of ${monitor.name}`}
        onChange={(e) => set(Number(e.target.value))}
        onPointerUp={() => setDragging(null)}
        onKeyUp={() => setDragging(null)}
        onBlur={() => setDragging(null)}
      />
      <span className="screens-level-value">{percent({ value, max })}%</span>
    </label>
  )
}

function InlineName({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  if (!editing) {
    return (
      <button
        className="icon-btn"
        title="Rename"
        onClick={() => {
          setText(value)
          setEditing(true)
        }}
      >
        <Pencil size={12} />
      </button>
    )
  }
  const done = (): void => {
    onSave(text.trim())
    setEditing(false)
  }
  return (
    <span className="screens-rename">
      <input
        className="text-input"
        autoFocus
        value={text}
        placeholder={placeholder}
        maxLength={60}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button className="icon-btn" title="Save" onClick={done}>
        <Check size={13} />
      </button>
    </span>
  )
}

function ScreenCard({ monitor, saved }: { monitor: Monitor; saved: MonitorSaved }) {
  const [naming, setNaming] = useState(false)
  const switchTo = (value: number): void => {
    void window.api.monitorSet(monitor.id, 'input', value).then((ok) => {
      if (!ok) notify(`${monitor.name} didn’t switch. Not every monitor lets a computer change its input.`)
    })
  }
  const rename = (name: string): void => {
    const names = { ...saved.names }
    if (name) names[monitor.id] = name
    else delete names[monitor.id]
    void save({ ...saved, names })
  }
  const renameInput = (value: number, name: string): void => {
    const mine = { ...(saved.inputNames[monitor.id] ?? {}) }
    if (name) mine[String(value)] = name
    else delete mine[String(value)]
    void save({ ...saved, inputNames: { ...saved.inputNames, [monitor.id]: mine } })
  }
  return (
    <section className={`screens-card${monitor.controllable ? '' : ' off'}`} data-screen-card>
      <header>
        <MonitorIcon size={16} />
        <h3>{monitor.name}</h3>
        {monitor.primary && <span className="screens-badge">Main screen</span>}
        <InlineName value={saved.names[monitor.id] ?? ''} placeholder={monitor.name} onSave={rename} />
      </header>
      {!monitor.controllable && <p className="screens-note">This screen didn’t answer. Turn on DDC/CI in its own menu, then press Look again.</p>}
      {monitor.brightness && <LevelSlider monitor={monitor} setting="brightness" level={monitor.brightness} />}
      {monitor.contrast && <LevelSlider monitor={monitor} setting="contrast" level={monitor.contrast} />}
      {monitor.controllable && (
        <div className="screens-inputs">
          <div className="screens-inputs-head">
            <span>Input</span>
            <button className="link-button" onClick={() => setNaming(!naming)}>
              {naming ? 'Done' : 'Name inputs'}
            </button>
          </div>
          {naming ? (
            <div className="screens-input-names">
              {monitor.inputs.map((i) => (
                <label key={i.value}>
                  <span>{inputName(i.value)}</span>
                  <input
                    className="text-input"
                    defaultValue={saved.inputNames[monitor.id]?.[String(i.value)] ?? ''}
                    placeholder="e.g. PC, MacBook, PS5"
                    maxLength={40}
                    onBlur={(e) => renameInput(i.value, e.target.value.trim())}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="screens-chips">
              {monitor.inputs.map((i) => (
                <button key={i.value} className={`screens-chip${monitor.input === i.value ? ' on' : ''}`} onClick={() => switchTo(i.value)} title={inputName(i.value)}>
                  {i.label}
                </button>
              ))}
            </div>
          )}
          <p className="screens-note">Switching to another input shows the other computer, so this screen goes blank for Orbit until you switch back (with a hotkey, or the monitor’s buttons).</p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Hotkeys

function HotkeyKeys({ value, onChange }: { value: string; onChange: (accel: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setHint(null)
        return
      }
      const accel = acceleratorFromEvent(e)
      if (!accel) {
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) setHint('Letters and numbers need Ctrl, Alt or Shift+Ctrl with them. F keys and the number pad work on their own.')
        return
      }
      setHint(null)
      onChange(accel)
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])
  return (
    <span className="screens-keys">
      <button className={`btn${recording ? ' recording' : ''}`} onClick={() => setRecording(!recording)}>
        <Keyboard size={13} /> {recording ? 'Press the keys… (Esc cancels)' : value ? hotkeyLabel(value) : 'Set keys'}
      </button>
      {hint && <span className="screens-note">{hint}</span>}
    </span>
  )
}

type ActionChoice = 'brightness-up' | 'brightness-down' | 'brightness-set' | 'contrast-up' | 'contrast-down' | 'contrast-set' | 'input'

const choiceOf = (a: MonitorAction): ActionChoice => (a.kind === 'input' ? 'input' : `${a.kind}-${a.mode}`)

function actionFor(choice: ActionChoice, before: MonitorAction, inputs: number[]): MonitorAction {
  if (choice === 'input') return { kind: 'input', value: before.kind === 'input' ? before.value : (inputs[0] ?? 0x0f) }
  const [kind, mode] = choice.split('-') as ['brightness' | 'contrast', 'up' | 'down' | 'set']
  const amount = before.kind === 'input' ? (mode === 'set' ? 50 : 10) : before.amount
  return { kind, mode, amount }
}

function HotkeyRow({ hotkey, monitors, error, onChange, onRemove }: { hotkey: MonitorHotkey; monitors: Monitor[]; error?: string; onChange: (h: MonitorHotkey) => void; onRemove: () => void }) {
  const screen = monitors.find((m) => m.id === hotkey.monitor)
  const inputs = screen ? screen.inputs : COMMON_INPUTS.map((value) => ({ value, label: inputName(value) }))
  const a = hotkey.action
  return (
    <div className="screens-hotkey" data-screen-hotkey>
      <HotkeyKeys value={hotkey.keys} onChange={(keys) => onChange({ ...hotkey, keys })} />
      <select className="select" value={hotkey.monitor} aria-label="Which screen" onChange={(e) => onChange({ ...hotkey, monitor: e.target.value })}>
        {a.kind !== 'input' && <option value="all">Every screen</option>}
        {monitors.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {hotkey.monitor !== 'all' && !screen && <option value={hotkey.monitor}>A screen that isn’t plugged in</option>}
      </select>
      <select
        className="select"
        value={choiceOf(a)}
        aria-label="What it does"
        onChange={(e) => {
          const action = actionFor(e.target.value as ActionChoice, a, inputs.map((i) => i.value))
          const monitor = action.kind === 'input' && hotkey.monitor === 'all' ? (monitors[0]?.id ?? 'all') : hotkey.monitor
          onChange({ ...hotkey, monitor, action })
        }}
      >
        <option value="brightness-up">Brightness up</option>
        <option value="brightness-down">Brightness down</option>
        <option value="brightness-set">Brightness to</option>
        <option value="contrast-up">Contrast up</option>
        <option value="contrast-down">Contrast down</option>
        <option value="contrast-set">Contrast to</option>
        <option value="input">Switch input to</option>
      </select>
      {a.kind === 'input' ? (
        <select className="select" value={a.value} aria-label="Input" onChange={(e) => onChange({ ...hotkey, action: { kind: 'input', value: Number(e.target.value) } })}>
          {inputs.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
          {!inputs.some((i) => i.value === a.value) && <option value={a.value}>{inputName(a.value)}</option>}
        </select>
      ) : (
        <label className="screens-amount">
          <input
            className="text-input"
            type="number"
            min={1}
            max={100}
            value={a.amount}
            aria-label="Percent"
            onChange={(e) => onChange({ ...hotkey, action: { ...a, amount: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))) } })}
          />
          %
        </label>
      )}
      <button className="icon-btn" title="Try it" onClick={() => void window.api.monitorAction(hotkey.monitor, a)}>
        <SunDim size={13} />
      </button>
      <button className="icon-btn" title="Remove this hotkey" onClick={onRemove}>
        <Trash2 size={13} />
      </button>
      {error && <p className="screens-error">{error}</p>}
    </div>
  )
}

function Hotkeys({ status }: { status: MonitorsStatus }) {
  const { saved, hotkeyErrors } = status
  const monitors = status.monitors.list.filter((m) => m.controllable)
  // Typing a number sends one save a key; keep the latest so quick edits don't undo each other.
  const latest = useRef(saved)
  latest.current = saved
  const put = (hotkeys: MonitorHotkey[]): void => void save({ ...latest.current, hotkeys })
  return (
    <section className="screens-hotkeys">
      <h3>
        <Keyboard size={15} /> Hotkeys
      </h3>
      <p className="screens-note">These work anywhere, even in a game, while Orbit is running (it can sit in the {TRAY_NAME}).</p>
      {saved.hotkeys.map((h) => (
        <HotkeyRow
          key={h.id}
          hotkey={h}
          monitors={monitors}
          error={hotkeyErrors[h.id]}
          onChange={(next) => put(latest.current.hotkeys.map((x) => (x.id === h.id ? next : x)))}
          onRemove={() => put(latest.current.hotkeys.filter((x) => x.id !== h.id))}
        />
      ))}
      {saved.hotkeys.length < MAX_HOTKEYS && (
        <button
          className="btn"
          onClick={() =>
            put([...saved.hotkeys, { id: Math.random().toString(36).slice(2, 10), keys: '', monitor: 'all', action: { kind: 'brightness', mode: 'up', amount: 10 } }])
          }
        >
          <Plus size={13} /> Add a hotkey
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

/** Brightness, contrast and input for every monitor, plus hotkeys for them. */
export default function ScreensPage() {
  const [status, setStatus] = useMonitors()
  const [looking, setLooking] = useState(false)
  const look = (): void => {
    setLooking(true)
    void window.api
      .monitorsRescan()
      .then(setStatus)
      .finally(() => setLooking(false))
  }
  const list = status?.monitors.list ?? []
  const controllable = list.filter((m) => m.controllable)
  return (
    <div className="screens-page" data-screens-page>
      <div className="screens-inner">
        <header className="screens-head">
          <h2>
            <MonitorIcon size={18} /> Screens
          </h2>
          <button className="btn" onClick={look} disabled={looking || !status}>
            <RefreshCw size={13} className={looking ? 'spin' : ''} /> Look again
          </button>
        </header>
        <p className="screens-intro">
          Change your monitors’ own brightness, contrast and input from here, like using the buttons on the monitor. It works over the screen’s cable (DDC/CI), so most desktop monitors can do it; laptop screens can’t.
        </p>
        {!status && <p className="screens-note">Looking for your screens…</p>}
        {status?.monitors.problem && (
          <div className="screens-problem">
            <p>{status.monitors.problem}</p>
            {status.monitors.fix && (
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(status.monitors.fix!)
                  notify('Copied. Paste it into Terminal.', 'info')
                }}
              >
                <Copy size={13} /> <code>{status.monitors.fix}</code>
              </button>
            )}
          </div>
        )}
        {controllable.length > 1 && (
          <div className="screens-all">
            <span>Every screen</span>
            <button className="btn" onClick={() => void window.api.monitorAction('all', { kind: 'brightness', mode: 'down', amount: 10 })}>
              <SunDim size={13} /> Dimmer
            </button>
            <button className="btn" onClick={() => void window.api.monitorAction('all', { kind: 'brightness', mode: 'up', amount: 10 })}>
              <Sun size={13} /> Brighter
            </button>
          </div>
        )}
        <div className="screens-grid">
          {list.map((m) => (
            <ScreenCard key={m.id} monitor={m} saved={status!.saved} />
          ))}
        </div>
        {status && <Hotkeys status={status} />}
      </div>
    </div>
  )
}

function ScreensHomeCard() {
  const [status] = useMonitors()
  const list = (status?.monitors.list ?? []).filter((m) => m.brightness)
  if (list.length === 0) return null
  return (
    <HomeBox
      icon={<MonitorIcon size={15} />}
      title="Screens"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(SCREENS_TAB)}>
          More
        </button>
      }
    >
      <div className="screens-home">
        {list.map((m) => (
          <div key={m.id} className="screens-home-row" title={m.input ? `Showing ${m.inputs.find((i) => i.value === m.input)?.label ?? inputName(m.input)}` : undefined}>
            <span className="home-row-title">{m.name}</span>
            <LevelSlider monitor={m} setting="brightness" level={m.brightness!} compact />
          </div>
        ))}
      </div>
    </HomeBox>
  )
}
