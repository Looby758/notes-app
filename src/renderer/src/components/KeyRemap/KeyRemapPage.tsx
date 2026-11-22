import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Gamepad2, Globe, Keyboard, Plus, Power, Repeat2, Trash2, X } from 'lucide-react'
import {
  duplicateKeys,
  EVERYWHERE_ID,
  PICKABLE_KEYS,
  REMAP_MODS,
  remapKeyLabel,
  ruleProblem,
  setMatches,
  shortcutFromEvent,
  targetLabel,
  type RemapMod,
  type RemapOs,
  type RemapRule,
  type RemapSet,
  type RemapStatus,
  type RemapTarget
} from '@shared/keyRemap'
import { acceleratorFromEvent, hotkeyLabel } from '@shared/soundboard'
import { IS_MAC } from '@shared/platform'

const OS: RemapOs = IS_MAC ? 'mac' : 'win'
const MOD_NAMES: Record<RemapMod, string> = IS_MAC ? { Control: '⌃ Control', Alt: '⌥ Option', Shift: '⇧ Shift', Super: '⌘ Command' } : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' }

function useRemaps(): RemapStatus | null {
  const [status, setStatus] = useState<RemapStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.api.keyRemapGet().then((s) => live && setStatus(s))
    const off = window.api.onKeyRemapChanged((s) => live && setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}

/**
 * Picks a key: press it (remaps pause meanwhile, so the real key comes through), or choose it from
 * the list for keys you can't press here. With `withMods`, a press with Ctrl/Alt/Shift held gives
 * the whole shortcut.
 */
function KeyPicker({ value, onPick, withMods, placeholder }: { value: string; onPick: (t: RemapTarget) => void; withMods?: boolean; placeholder: string }) {
  const [listening, setListening] = useState(false)
  // The latest onPick, without restarting the listening (and the pause) on every render.
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    if (!listening) return
    void window.api.keyRemapHold(true)
    const take = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (withMods) {
        const t = shortcutFromEvent(e)
        if (!t) return
        pick.current(t)
      } else pick.current({ kind: 'key', code: e.code })
      setListening(false)
    }
    // Print Screen only reaches the page as the key comes up.
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'PrintScreen') take(e)
    }
    window.addEventListener('keydown', take, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', take, true)
      window.removeEventListener('keyup', up, true)
      void window.api.keyRemapHold(false)
    }
  }, [listening, withMods])
  return (
    <span className="keyremap-picker">
      <button className={`btn${listening ? ' listening' : ''}`} onClick={() => setListening(!listening)}>
        <Keyboard size={13} /> {listening ? 'Press a key… (click to cancel)' : value ? remapKeyLabel(value, OS) : placeholder}
      </button>
      <select
        className="text-input keyremap-select"
        value=""
        aria-label="Choose a key from the list"
        onChange={(e) => {
          if (e.target.value) onPick({ kind: 'key', code: e.target.value })
          setListening(false)
        }}
      >
        <option value="">or choose…</option>
        {PICKABLE_KEYS.map((k) => (
          <option key={k} value={k}>
            {remapKeyLabel(k, OS)}
          </option>
        ))}
      </select>
    </span>
  )
}

/** What a key does instead: another key, a shortcut, or nothing. */
function TargetEditor({ to, onChange }: { to: RemapTarget | null; onChange: (t: RemapTarget) => void }) {
  const kind = to?.kind ?? 'key'
  const code = to && to.kind !== 'off' ? to.code : ''
  const mods = to?.kind === 'shortcut' ? to.mods : []
  const setKind = (k: RemapTarget['kind']): void => {
    if (k === 'off') onChange({ kind: 'off' })
    else if (k === 'key') onChange({ kind: 'key', code })
    else onChange({ kind: 'shortcut', mods: mods.length ? mods : ['Control'], code })
  }
  return (
    <div className="keyremap-target">
      <div className="macro-row">
        {(['key', 'shortcut', 'off'] as const).map((k) => (
          <button key={k} className={`screens-chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
            {k === 'key' ? 'A key' : k === 'shortcut' ? 'A shortcut' : 'Nothing'}
          </button>
        ))}
      </div>
      {kind === 'key' && <KeyPicker value={code} placeholder="Pick the key" onPick={(t) => onChange(t.kind === 'shortcut' ? t : { kind: 'key', code: t.kind === 'key' ? t.code : '' })} />}
      {kind === 'shortcut' && (
        <div className="macro-row">
          {REMAP_MODS.map((m) => (
            <button
              key={m}
              className={`screens-chip${mods.includes(m) ? ' on' : ''}`}
              onClick={() => onChange({ kind: 'shortcut', mods: mods.includes(m) ? mods.filter((x) => x !== m) : REMAP_MODS.filter((x) => x === m || mods.includes(x)), code })}
            >
              {MOD_NAMES[m]}
            </button>
          ))}
          <span className="macro-faint">+</span>
          <KeyPicker
            value={code}
            withMods
            placeholder="Pick the key"
            onPick={(t) => {
              if (t.kind === 'shortcut') onChange(t)
              else if (t.kind === 'key') onChange({ kind: 'shortcut', mods, code: t.code })
            }}
          />
        </div>
      )}
    </div>
  )
}

function RuleRow({ set, rule, duplicate }: { set: RemapSet; rule: RemapRule; duplicate: boolean }) {
  const save = (patch: Partial<RemapRule>): void => void window.api.keyRemapSaveRule(set.id, { ...rule, ...patch })
  const complete = rule.to.kind === 'off' || !!rule.to.code
  const problem = complete ? ruleProblem(rule, OS) : null
  return (
    <li className={`keyremap-rule${rule.on ? '' : ' off'}`} data-keyremap-rule={rule.from}>
      <div className="keyremap-rule-main">
        <KeyPicker value={rule.from} placeholder="Pick the key" onPick={(t) => t.kind !== 'off' && save({ from: t.code })} />
        <ArrowRight size={14} className="keyremap-arrow" />
        <TargetEditor to={rule.to} onChange={(to) => save({ to })} />
        <span className="keyremap-rule-tools">
          <label className="macro-check" title={rule.on ? 'Switch this remap off' : 'Switch this remap on'}>
            <input type="checkbox" checked={rule.on} onChange={(e) => save({ on: e.target.checked })} /> On
          </label>
          <button className="icon-btn" title="Delete this remap" onClick={() => void window.api.keyRemapRemoveRule(set.id, rule.id)}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <p className="macro-faint keyremap-summary">
        {remapKeyLabel(rule.from, OS)} → {complete ? targetLabel(rule.to, OS) : 'pick what it does'}
      </p>
      {problem && <p className="screens-error">{problem}</p>}
      {duplicate && <p className="screens-error">{remapKeyLabel(rule.from, OS)} is remapped more than once here: the last one wins.</p>}
    </li>
  )
}

/** A new remap, kept on the page until both keys are picked. */
function NewRule({ set, onDone }: { set: RemapSet; onDone: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState<RemapTarget | null>(null)
  const ready = !!from && !!to && (to.kind === 'off' || !!to.code)
  const sent = useRef(false)
  useEffect(() => {
    if (!ready || sent.current) return
    sent.current = true
    void window.api.keyRemapSaveRule(set.id, { from, to: to!, on: true }).then(onDone)
  }, [ready, from, to, set.id, onDone])
  return (
    <li className="keyremap-rule new" data-keyremap-new>
      <div className="keyremap-rule-main">
        <KeyPicker value={from} placeholder="The key you press" onPick={(t) => t.kind !== 'off' && setFrom(t.code)} />
        <ArrowRight size={14} className="keyremap-arrow" />
        <TargetEditor to={to} onChange={setTo} />
        <span className="keyremap-rule-tools">
          <button className="icon-btn" title="Cancel" onClick={onDone}>
            <X size={13} />
          </button>
        </span>
      </div>
    </li>
  )
}

function SetDetail({ set, status }: { set: RemapSet; status: RemapStatus }) {
  const [adding, setAdding] = useState(false)
  const everywhere = set.id === EVERYWHERE_ID
  const dup = duplicateKeys(set)
  const inFront = !everywhere && setMatches(set, status.front)
  useEffect(() => setAdding(false), [set.id])
  return (
    <section className="macro-detail" data-keyremap-set={set.id}>
      <header>
        {everywhere ? <Globe size={16} /> : <Gamepad2 size={16} />}
        {everywhere ? (
          <h4>Everywhere</h4>
        ) : (
          <input
            className="text-input macro-name"
            defaultValue={set.name}
            key={`${set.id}-${set.name}`}
            aria-label="Name"
            onBlur={(e) => e.target.value.trim() !== set.name && void window.api.keyRemapUpdateSet(set.id, { name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
        <label className="macro-check">
          <input type="checkbox" checked={set.on} onChange={(e) => void window.api.keyRemapUpdateSet(set.id, { on: e.target.checked })} /> On
        </label>
        {!everywhere && (
          <button className="icon-btn" title="Delete this set" onClick={() => void window.api.keyRemapRemoveSet(set.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </header>
      {everywhere ? (
        <p className="macro-faint">These work in every app and game. A game’s own remaps go on top of them while it’s in front.</p>
      ) : (
        <div className="macro-row">
          <span className="macro-faint">Works while this program is in front:</span>
          <input
            className="text-input keyremap-app"
            defaultValue={set.app}
            key={set.app}
            aria-label="Program name"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== set.app && void window.api.keyRemapUpdateSet(set.id, { app: e.target.value })}
          />
          {inFront && <span className="keyremap-badge">In front now</span>}
        </div>
      )}
      <ul className="keyremap-rules">
        {set.rules.map((r) => (
          <RuleRow key={r.id} set={set} rule={r} duplicate={r.on && dup.has(r.from) && set.rules.filter((x) => x.on && x.from === r.from).pop()?.id !== r.id} />
        ))}
        {adding && <NewRule set={set} onDone={() => setAdding(false)} />}
      </ul>
      {set.rules.length === 0 && !adding && <p className="macro-faint macro-empty">No remaps here yet.</p>}
      {!adding && (
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add a remap
        </button>
      )}
    </section>
  )
}

function AddSet({ status, onAdded }: { status: RemapStatus; onAdded: (app: string) => void }) {
  const [name, setName] = useState('')
  const taken = new Set(status.data.sets.map((s) => s.app.toLowerCase()))
  const choices = status.recentApps.filter((a) => !taken.has(a.name.toLowerCase()))
  const add = (app: string, label?: string): void => {
    if (!app.trim()) return
    void window.api.keyRemapAddSet(app, label).then(() => onAdded(app))
    setName('')
  }
  return (
    <div className="keyremap-add" data-keyremap-add>
      <strong>Remaps for one game or app</strong>
      {choices.length > 0 ? (
        <>
          <span className="macro-faint">Lately in front (open your game, then come back here):</span>
          <div className="macro-row">
            {choices.slice(0, 8).map((a) => (
              <button key={a.name} className="screens-chip" onClick={() => add(a.name, a.title || a.name)}>
                <Plus size={12} /> {a.title && a.title !== a.name ? `${a.title} (${a.name})` : a.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="macro-faint">Open your game for a moment, then come back: it shows up here to pick.</span>
      )}
      <div className="macro-row">
        <input
          className="text-input"
          placeholder={IS_MAC ? 'Or type its name (Minecraft)' : 'Or type its program (javaw.exe)'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add(name)}
        />
        <button className="btn" disabled={!name.trim()} onClick={() => add(name)}>
          Add
        </button>
      </div>
    </div>
  )
}

function ToggleHotkey({ status }: { status: RemapStatus }) {
  const [listening, setListening] = useState(false)
  const value = status.data.toggleHotkey
  useEffect(() => {
    if (!listening) return
    void window.api.keyRemapHold(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      if (e.key === 'Escape' && plain) return setListening(false)
      const accel = acceleratorFromEvent(e)
      if (!accel) return
      void window.api.keyRemapSetHotkey(accel)
      setListening(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void window.api.keyRemapHold(false)
    }
  }, [listening])
  return (
    <section className="screens-card" data-keyremap-hotkey>
      <header>
        <Keyboard size={16} />
        <h3>Switch every remap on or off</h3>
      </header>
      <p className="macro-faint">A hotkey that works anywhere, even in a full-screen game. Orbit never switches remaps off by itself: only you do.</p>
      <span className="macro-hotkey">
        <button className={`btn${listening ? ' listening' : ''}`} onClick={() => setListening(!listening)}>
          <Keyboard size={13} /> {listening ? 'Press the keys… (Esc cancels)' : value ? hotkeyLabel(value) : 'Set a hotkey'}
        </button>
        {value && !listening && (
          <button className="icon-btn" title="No hotkey" onClick={() => void window.api.keyRemapSetHotkey('')}>
            <X size={13} />
          </button>
        )}
      </span>
    </section>
  )
}

export default function KeyRemapPage() {
  const status = useRemaps()
  const [pickedId, setPickedId] = useState(EVERYWHERE_ID)
  const [pickApp, setPickApp] = useState<string | null>(null)
  // A set just added becomes the one shown.
  useEffect(() => {
    if (!status || !pickApp) return
    const added = status.data.sets.find((s) => s.app.toLowerCase() === pickApp.replace(/\.(exe|app)$/i, '').toLowerCase())
    if (added) {
      setPickedId(added.id)
      setPickApp(null)
    }
  }, [status, pickApp])
  if (!status) return <div className="screens-page" />
  const { data } = status
  const picked = data.sets.find((s) => s.id === pickedId) ?? data.sets[0]
  return (
    <div className="screens-page" data-keyremap-page>
      <div className="screens-inner">
        <header className="screens-head">
          <h2>
            <Repeat2 size={18} /> Key remapper
          </h2>
          <button className={`btn ${data.on ? 'btn-primary' : ''}`} disabled={!!status.problem} onClick={() => void window.api.keyRemapSetOn(!data.on)} data-keyremap-switch>
            <Power size={13} /> {data.on ? 'Remaps are on' : 'Remaps are off'}
            {data.toggleHotkey && <kbd>{hotkeyLabel(data.toggleHotkey)}</kbd>}
          </button>
        </header>
        <p className="screens-intro">
          Make any key press a different key, a shortcut, or nothing at all. Remaps under Everywhere work in every app; a game’s own remaps work while that game is in front, on top of Everywhere.
        </p>
        {status.problem && (
          <div className="screens-problem">
            <p>{status.problem}</p>
          </div>
        )}
        {status.notes.map((n) => (
          <div className="screens-problem" key={n}>
            <p>{n}</p>
          </div>
        ))}
        {status.front?.name && (
          <p className="macro-faint" data-keyremap-front>
            In front now: {status.front.title && status.front.title !== status.front.name ? `${status.front.title} (${status.front.name})` : status.front.name}
          </p>
        )}

        <div className="macro-layout">
          <aside className="macro-list" data-keyremap-sets>
            {data.sets.map((s) => {
              const live = data.on && s.on && (s.id === EVERYWHERE_ID || setMatches(s, status.front))
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  className={`macro-item${s.id === picked.id ? ' on' : ''}${live ? ' playing' : ''}`}
                  onClick={() => setPickedId(s.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setPickedId(s.id)}
                >
                  {s.id === EVERYWHERE_ID ? <Globe size={14} /> : <Gamepad2 size={14} />}
                  <div className="macro-item-main">
                    <strong>{s.name}</strong>
                    <span className="macro-faint">
                      {s.rules.length === 1 ? '1 remap' : `${s.rules.length} remaps`}
                      {s.app && s.app !== s.name ? ` · ${s.app}` : ''}
                      {!s.on ? ' · off' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
            <AddSet status={status} onAdded={setPickApp} />
          </aside>
          <SetDetail set={picked} status={status} />
        </div>

        <div className="macro-bottom">
          <ToggleHotkey status={status} />
        </div>
        {IS_MAC ? (
          <p className="screens-note">
            On a Mac, Orbit uses macOS’s own key remapping, so remaps to a key (or to nothing) need no permission. A remap to a shortcut borrows a spare key (F13 to F20) and needs Orbit allowed
            under Accessibility, like macros. Remaps are taken out when Orbit closes.
          </p>
        ) : (
          <p className="screens-note">
            Only your real keyboard is remapped, never keys that macros or other programs press. If a game runs as administrator, Windows only lets Orbit remap keys in it when Orbit runs as
            administrator too.
          </p>
        )}
      </div>
    </div>
  )
}
