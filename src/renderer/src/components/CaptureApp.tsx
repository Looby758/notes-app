import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CalendarPlus, ChevronDown, CornerDownLeft, FileText, Folder, Inbox, Loader2, Mic, Sparkles, Square, Sun, Undo2, X, Zap } from 'lucide-react'
import { formatDuration, saveRecording, startRecording, type Recording } from '../lib/voice'
import type { CaptureRequest, CaptureStatus, FileNode } from '@shared/types'
import { usePrefs } from '../store/prefs'
import { dayKeyOf, findWhen } from '../lib/when'
import { formatDate, fromDayKey } from '../lib/dates'
import { fuzzyFilter } from '../lib/fuzzy'
import { errorMessage, noteTitle } from '../lib/paths'
import { describeSmart, parseSmart, type SmartAction } from '../lib/smartParse'
import { FEATURE_INFO } from '../lib/featureInfo'

/** What the summon bar would do with what's typed, instead of saving it: a command, a sum, or "?" to ask. */
function summonAction(text: string): SmartAction | null {
  const t = text.trim()
  if (!t || t.includes('\n')) return null
  if (t.startsWith('?')) return t.slice(1).trim() ? { kind: 'ask', question: t.slice(1).trim() } : null
  const a = parseSmart(t, { features: FEATURE_INFO })
  // Events and jots are what saving already does (with the calendar chip); questions only with "?".
  // Reminders ("remind me Friday 5pm…") are handled as commands so the ⏰ is set and "remind me" left out.
  if (a?.kind === 'event' && a.remind) return a
  return a && a.kind !== 'event' && a.kind !== 'jot' && a.kind !== 'ask' ? a : null
}

export type Dest = NonNullable<CaptureRequest['target']>

const RECENT_KEY = 'capture:recent'
const LAST_KEY = 'capture:last'

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // not fatal
  }
}

const destKey = (d: Dest): string => ('path' in d ? `${d.kind}:${d.path}` : d.kind)

/** Every folder and note, for "Choose a folder or note…". */
function flatten(nodes: FileNode[], out: Dest[] = []): Dest[] {
  for (const n of nodes) {
    if (n.type === 'folder') {
      out.push({ kind: 'folder', path: n.path })
      flatten(n.children ?? [], out)
    } else if (n.type === 'file') out.push({ kind: 'note', path: n.path })
  }
  return out
}

/** The small quick-capture window (Win+Shift+N). Enter saves, Shift+Enter adds a line, Esc closes. */
export default function CaptureApp() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const prefs = usePrefs((s) => s.prefs)

  // Where it goes (null: your capture setting), and the panel open over the text box, if any.
  const [dest, setDest] = useState<Dest | null>(null)
  const [panel, setPanel] = useState<null | 'dest' | 'event'>(null)
  // Calendar: 'auto' follows what you typed; 'on'/'off' once you've said.
  const [eventMode, setEventMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [manual, setManual] = useState<{ date: string; time: string } | null>(null)
  const [remind, setRemind] = useState(false)
  // AI helper: shown only once you've added a key. `untidied` is what you typed, for Undo.
  const [canTidy, setCanTidy] = useState(false)
  const [tidying, setTidying] = useState(false)
  const [untidied, setUntidied] = useState<string | null>(null)
  const [rec, setRec] = useState<Recording | null>(null)
  const [voice, setVoice] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  // "Save as a note instead" for a command the bar picked up.
  const [noCommand, setNoCommand] = useState(false)

  // Each time the window is shown: start fresh and focus.
  useEffect(() => {
    const reset = (): void => {
      setText('')
      setError(null)
      setSaving(false)
      setPanel(null)
      setEventMode('auto')
      setManual(null)
      setRemind(false)
      setUntidied(null)
      setTidying(false)
      setNoCommand(false)
      window.api.aiStatus().then((s) => setCanTidy(s.ready), () => setCanTidy(false))
      setDest(usePrefs.getState().prefs.captureRememberTarget ? readStored<Dest | null>(LAST_KEY, null) : null)
      window.api.captureStatus().then(setStatus)
      setTimeout(() => input.current?.focus(), 0)
    }
    reset()
    return window.api.onCaptureReset(reset)
  }, [])

  const tidy = async (): Promise<void> => {
    if (!text.trim() || tidying) return
    setTidying(true)
    setError(null)
    const before = text
    try {
      const tidied = await window.api.aiTidy(before, 'capture')
      setUntidied(before)
      setText(tidied)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setTidying(false)
      input.current?.focus()
    }
  }

  // ---------- commands ----------
  const command = useMemo(() => (voice ? null : summonAction(text)), [text, voice])
  const commandOn = !!command && !noCommand
  const runCommand = async (): Promise<void> => {
    if (!command || saving) return
    setError(null)
    if (command.kind === 'calc') {
      await navigator.clipboard.writeText(command.result).catch(() => undefined)
      void window.api.closeCapture()
      return
    }
    setSaving(true)
    const result = await window.api.submitCapture({ text, command: text })
    setSaving(false)
    if (!result.ok) setError(result.error ?? 'That didn’t work.')
  }

  // ---------- calendar ----------
  const found = useMemo(() => findWhen(text), [text])
  const eventDate = manual?.date ?? (found ? dayKeyOf(found.date) : dayKeyOf(new Date()))
  const eventTime = manual ? manual.time : (found?.time ?? '')
  // Found a time: it's an event unless you say no. Found only a day ("today"): just offered.
  const eventOn = !commandOn && (eventMode === 'on' || (eventMode === 'auto' && !!found?.time))
  const offered = !commandOn && eventMode === 'auto' && !!found && !found.time
  const eventLabel = (): string => {
    const day = fromDayKey(eventDate)
    const today = dayKeyOf(new Date())
    const tomorrow = dayKeyOf(new Date(Date.now() + 86_400_000))
    const name = eventDate === today ? 'Today' : eventDate === tomorrow ? 'Tomorrow' : day ? formatDate(day, 'ddd D MMM') : eventDate
    return `${name}${eventTime ? ` · ${eventTime}` : ''}`
  }

  // ---------- a voice note ----------
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed(Date.now() - rec.startedAt), 250)
    return () => clearInterval(t)
  }, [rec])
  useEffect(() => window.api.onCaptureReset(() => setVoice(null)), [])
  const toggleRecording = async (): Promise<void> => {
    setError(null)
    if (rec) {
      const blob = await rec.stop()
      setRec(null)
      window.api.captureKeepOpen(false)
      try {
        setVoice(await saveRecording(blob, prefs.attachmentFolder))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      input.current?.focus()
      return
    }
    try {
      window.api.captureKeepOpen(true)
      setElapsed(0)
      setRec(await startRecording())
    } catch (err) {
      window.api.captureKeepOpen(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async (): Promise<void> => {
    if ((!text.trim() && !voice) || saving || tidying || rec) return
    setSaving(true)
    setError(null)
    const withVoice = voice ? `${text.trim() || 'Voice note'}\n![Voice note](vault:${voice})` : text
    const request: CaptureRequest = { text: withVoice }
    if (eventOn) {
      // The date and time words come out of the title, even if you changed the day or time by hand.
      const title = found?.title || text.trim()
      request.event = { date: eventDate, time: eventTime || undefined, title: voice ? `${title} ![Voice note](vault:${voice})` : title, remind: remind && !!eventTime }
    } else if (dest) {
      request.target = dest
      const recent = [dest, ...readStored<Dest[]>(RECENT_KEY, []).filter((d) => destKey(d) !== destKey(dest))].slice(0, 5)
      store(RECENT_KEY, recent)
    }
    store(LAST_KEY, dest)
    const result = await window.api.submitCapture(request)
    setSaving(false)
    if (!result.ok) setError(result.error ?? 'Couldn’t save that.')
    else setVoice(null)
    // On success the window hides itself; the next open resets it.
  }

  const destLabel = (d: Dest | null): string => {
    const kind = d?.kind ?? prefs.captureTarget
    if (kind === 'daily') return `Today’s note${prefs.captureHeading ? ` › ${prefs.captureHeading}` : ''}`
    if (kind === 'inbox') return noteTitle(prefs.captureInbox.endsWith('.md') ? prefs.captureInbox : `${prefs.captureInbox}.md`)
    if (d && 'path' in d) return d.kind === 'folder' ? `New note in ${d.path || 'the top folder'}` : noteTitle(d.path)
    return ''
  }

  const closePanel = (): void => {
    setPanel(null)
    setTimeout(() => input.current?.focus(), 0)
  }

  return (
    <div className="capture">
      <div className="capture-head">
        <Zap size={14} />
        <span>Summon</span>
        <span className="capture-spacer" />
        {(eventOn || offered) && (
          <span className={`capture-chip ${eventOn ? 'on' : 'offered'}`} data-capture-chip={eventOn ? 'on' : 'offered'}>
            <button
              onClick={() => {
                if (offered) setEventMode('on')
                else setPanel(panel === 'event' ? null : 'event')
              }}
              title={eventOn ? 'Change the date or time' : 'Add this to the calendar'}
            >
              📅 {offered ? `Add to calendar: ${eventLabel()}?` : `${eventLabel()} → Calendar`}
              {eventOn && remind && eventTime && ' ⏰'}
            </button>
            {eventOn && (
              <button
                className="capture-chip-x"
                title="Not an event: save it as a normal capture"
                data-capture-chip-x
                onClick={() => {
                  setEventMode('off')
                  setManual(null)
                  if (panel === 'event') closePanel()
                }}
              >
                <X size={11} />
              </button>
            )}
          </span>
        )}
        {!eventOn && (
          <button className="capture-where" onClick={() => setPanel(panel === 'dest' ? null : 'dest')} data-capture-where title="Choose where this goes">
            → {destLabel(dest)} <ChevronDown size={12} />
          </button>
        )}
      </div>

      {panel === 'dest' ? (
        <DestPicker
          current={dest}
          label={destLabel}
          onPick={(d) => {
            setDest(d)
            closePanel()
          }}
          onClose={closePanel}
        />
      ) : panel === 'event' ? (
        <EventPanel
          date={eventDate}
          time={eventTime}
          remind={remind}
          onChange={(date, time, r) => {
            setManual({ date, time })
            setRemind(r)
            setEventMode('on')
          }}
          onClose={closePanel}
        />
      ) : (
        <textarea
          ref={input}
          className="capture-input"
          value={text}
          placeholder="Jot a thought, or try “spent 12 on food”, “play Drake”, “open money”, “12*4”, “? what’s on this week”…"
          spellCheck
          readOnly={tidying}
          onChange={(e) => {
            setText(e.target.value)
            setUntidied(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              // Alt+Enter: save it as a note even if it looks like a command.
              if (commandOn && !e.altKey) void runCommand()
              else save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              window.api.closeCapture()
            }
          }}
        />
      )}
      {commandOn && command && !panel && (
        <div className="capture-command" data-capture-command={command.kind}>
          <Zap size={13} />
          <span>{describeSmart(command)}</span>
          <kbd>Enter</kbd>
          <button className="link-button" onClick={() => setNoCommand(true)} title="Alt+Enter does this too">
            Save as a note instead
          </button>
        </div>
      )}
      <div className="capture-foot">
        {error ? (
          <span className="capture-error">{error}</span>
        ) : (
          <span>
            <kbd>Enter</kbd> save · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Esc</kbd> close
          </span>
        )}
        {voice && !rec && <span className="capture-voice">🎙 Voice note added</span>}
        {canTidy &&
          (untidied !== null ? (
            <button
              className="icon-btn"
              onClick={() => {
                setText(untidied)
                setUntidied(null)
                input.current?.focus()
              }}
              title="Undo: go back to what you typed"
              data-capture-untidy
            >
              <Undo2 size={15} />
            </button>
          ) : (
            <button className={`icon-btn ${tidying ? 'on' : ''}`} onClick={tidy} disabled={!text.trim() || tidying} title="Tidy up with AI: fix typos and add structure" data-capture-tidy>
              {tidying ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            </button>
          ))}
        <button
          className={`icon-btn ${eventOn ? 'on' : ''}`}
          onClick={() => {
            if (!eventOn) {
              setManual({ date: eventDate, time: eventTime })
              setEventMode('on')
            }
            setPanel('event')
          }}
          title="Add to the calendar (pick a day and time)"
          data-capture-calendar
        >
          <CalendarPlus size={15} />
        </button>
        <button className={`icon-btn capture-mic ${rec ? 'recording' : ''}`} onClick={toggleRecording} title={rec ? 'Stop recording' : 'Record a voice note'} data-capture-mic>
          {rec ? <Square size={13} /> : <Mic size={15} />}
          {rec && <span>{formatDuration(elapsed)}</span>}
        </button>
        {commandOn ? (
          <button className="btn btn-primary" onClick={() => void runCommand()} disabled={saving} data-capture-run>
            <CornerDownLeft size={13} /> {saving ? 'Working…' : command?.kind === 'calc' ? 'Copy' : 'Do it'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={save} disabled={(!text.trim() && !voice) || saving || tidying || !!rec} data-capture-save>
            <CornerDownLeft size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {status?.error && <div className="capture-warning">{status.error}</div>}
    </div>
  )
}

/** "Where should this go?": today's note, the inbox, recent places, or any folder or note. */
export function DestPicker({ current, label, onPick, onClose }: { current: Dest | null; label: (d: Dest | null) => string; onPick: (d: Dest) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<Dest[]>([])
  const [index, setIndex] = useState(0)
  const usualKey = usePrefs((s) => s.prefs.captureTarget)
  useEffect(() => {
    window.api.listTree().then((tree) => setAll(flatten(tree)), () => setAll([]))
  }, [])

  const items: Dest[] = useMemo(() => {
    if (query.trim()) return fuzzyFilter(all, query, (d) => ('path' in d ? d.path : '')).map((r) => r.item).slice(0, 40)
    const recent = readStored<Dest[]>(RECENT_KEY, []).filter((d) => 'path' in d)
    const start: Dest[] = [{ kind: 'daily' }, { kind: 'inbox' }]
    return [...start, ...recent].filter((d, i, list) => list.findIndex((x) => destKey(x) === destKey(d)) === i)
  }, [query, all])

  const key = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1))
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter' && items[index] !== undefined) onPick(items[index])
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
  }

  const icon = (d: Dest): ReactNode => {
    const kind = d.kind
    if (kind === 'folder') return <Folder size={13} />
    if (kind === 'inbox') return <Inbox size={13} />
    if (kind === 'daily') return <Sun size={13} />
    return <FileText size={13} />
  }

  return (
    <div className="capture-panel" data-capture-dest>
      <input
        autoFocus
        className="capture-search"
        placeholder="Choose a folder or note…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onKeyDown={key}
      />
      <div className="capture-list">
        {items.map((d, i) => (
          <button
            key={destKey(d)}
            className={`${i === index ? 'active' : ''} ${destKey(d) === (current ? destKey(current) : usualKey) ? 'current' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onPick(d)}
            data-dest={destKey(d)}
          >
            {icon(d)}
            <span>{label(d)}</span>
            {'path' in d && d.kind === 'note' && d.path.includes('/') && <em>{d.path.slice(0, d.path.lastIndexOf('/'))}</em>}
          </button>
        ))}
        {items.length === 0 && <p>No folder or note matches.</p>}
      </div>
    </div>
  )
}

/** The day, time and "remind me" for a capture going to the calendar. */
function EventPanel({ date, time, remind, onChange, onClose }: { date: string; time: string; remind: boolean; onChange: (date: string, time: string, remind: boolean) => void; onClose: () => void }) {
  return (
    <div
      className="capture-panel capture-event"
      data-capture-event
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <label>
        Day
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value, time, remind)} data-capture-date />
      </label>
      <label>
        Time
        <input type="time" value={time} onChange={(e) => onChange(date, e.target.value, remind)} data-capture-time />
        {time && (
          <button className="link-button" onClick={() => onChange(date, '', remind)}>
            All day
          </button>
        )}
      </label>
      <label className="capture-check">
        <input type="checkbox" checked={remind && !!time} disabled={!time} onChange={(e) => onChange(date, time, e.target.checked)} data-capture-remind />
        Remind me then {!time && '(pick a time first)'}
      </label>
      <button className="btn btn-primary" onClick={onClose} data-capture-event-done>
        Done
      </button>
    </div>
  )
}
