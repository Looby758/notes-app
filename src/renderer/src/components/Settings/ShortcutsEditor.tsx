import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { commands, shortcutFor, type Command } from '../../lib/commands'
import { findConflicts, RESERVED_SHORTCUTS, shortcutFromEvent } from '../../lib/shortcuts'
import { setPrefs, setShortcut, usePrefs } from '../../store/prefs'
import { IS_MAC, showKeys, SYSTEM_NAME } from '@shared/platform'

/** Commands whose name, group or current shortcut match a search. */
export function matchingCommands(query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter((c) => {
    const keys = shortcutFor(c) ?? ''
    const haystack = `${c.title} ${c.group} ${keys} ${keys && showKeys(keys)} shortcut key`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

/** Lists every command with its shortcut; click one and press keys to change it. */
export default function ShortcutsEditor({ query }: { query: string }) {
  const overrides = usePrefs((s) => s.prefs.shortcuts)
  const [recording, setRecording] = useState<string | null>(null)
  const [refused, setRefused] = useState<{ id: string; shortcut: string } | null>(null)

  const current = useMemo(
    () => Object.fromEntries(commands.map((c) => [c.id, shortcutFor(c)])),
    // shortcutFor reads `overrides` from the store, so recompute when they change.
    [overrides]
  )
  const conflicts = useMemo(() => findConflicts(current), [current])
  const conflictFor = (id: string): string[] => {
    const shortcut = current[id]
    if (!shortcut) return []
    for (const ids of conflicts.values()) if (ids.includes(id)) return ids.filter((other) => other !== id)
    return []
  }

  // While recording, the next key press becomes the shortcut (Esc cancels).
  useEffect(() => {
    if (!recording) return
    const cmd = commands.find((c) => c.id === recording)!
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(null)
        return
      }
      const shortcut = shortcutFromEvent(e)
      if (!shortcut) return // only a modifier so far
      if (RESERVED_SHORTCUTS.has(shortcut)) {
        setRefused({ id: cmd.id, shortcut })
        return
      }
      setRefused(null)
      setShortcut(cmd.id, shortcut, cmd.shortcut)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  const visible = matchingCommands(query)
  const groups = [...new Set(visible.map((c) => c.group))]
  const anyOverrides = Object.keys(overrides).length > 0

  if (visible.length === 0) return null

  return (
    <div className="shortcuts-editor">
      {!query && (
        <div className="shortcuts-intro">
          <p>Click a shortcut, then press the keys you want. Press Esc to cancel.</p>
          {anyOverrides && (
            <button className="btn" onClick={() => setPrefs({ shortcuts: {} })}>
              <RotateCcw size={13} /> Reset all shortcuts
            </button>
          )}
        </div>
      )}
      {groups.map((group) => (
        <section key={group} className="settings-group">
          <h3>{group}</h3>
          {visible
            .filter((c) => c.group === group)
            .map((c) => (
              <ShortcutRow
                key={c.id}
                cmd={c}
                shortcut={current[c.id]}
                customised={c.id in overrides}
                recording={recording === c.id}
                refused={refused?.id === c.id ? refused.shortcut : null}
                conflicts={conflictFor(c.id).map((id) => commands.find((x) => x.id === id)?.title ?? id)}
                onRecord={() => {
                  setRefused(null)
                  setRecording(recording === c.id ? null : c.id)
                }}
              />
            ))}
        </section>
      ))}
    </div>
  )
}

interface RowProps {
  cmd: Command
  shortcut: string | null
  customised: boolean
  recording: boolean
  refused: string | null
  conflicts: string[]
  onRecord: () => void
}

function ShortcutRow({ cmd, shortcut, customised, recording, refused, conflicts, onRecord }: RowProps) {
  return (
    <div className="setting-row shortcut-row" data-command={cmd.id}>
      <div className="setting-text">
        <label>
          {cmd.title}
          {customised && <span className="modified-dot" title="Changed from the default" />}
        </label>
        {cmd.scope === 'editor' && <p>While typing in a note</p>}
        {conflicts.length > 0 && (
          <p className="setting-warning">
            <AlertTriangle size={12} /> Also used by {conflicts.join(', ')}
          </p>
        )}
        {refused && (
          <p className="setting-warning">
            <AlertTriangle size={12} /> {showKeys(refused)} is reserved by {SYSTEM_NAME} or the editor
          </p>
        )}
      </div>
      <div className="setting-control">
        <button className={`shortcut-key ${recording ? 'recording' : ''} ${shortcut ? '' : 'none'}`} onClick={onRecord}>
          {recording ? 'Press keys…' : shortcut ? IS_MAC ? <kbd>{showKeys(shortcut)}</kbd> : shortcut.split('+').map((k, i) => <kbd key={i}>{k}</kbd>) : 'None'}
        </button>
        {shortcut && !recording && (
          <button className="icon-btn" title="Remove shortcut" onClick={() => setShortcut(cmd.id, null, cmd.shortcut)}>
            <X size={13} />
          </button>
        )}
        {customised && !recording && (
          <button className="icon-btn" title={`Reset to ${cmd.shortcut ? showKeys(cmd.shortcut) : 'none'}`} onClick={() => setShortcut(cmd.id, cmd.shortcut ?? null, cmd.shortcut)}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
