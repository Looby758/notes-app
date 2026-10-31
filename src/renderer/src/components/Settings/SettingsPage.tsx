import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Clapperboard, FileJson, Music, FolderCog, Info, Keyboard, Palette, PenLine, RefreshCw, RotateCcw, ScrollText, Search, Sparkles, X, Zap } from 'lucide-react'
import { checkForUpdates, useUpdates, watchUpdates } from '../../store/updates'
import { DEFAULT_PREFS } from '@shared/prefs'
import type { CaptureStatus } from '@shared/types'
import { resetPrefs, usePrefs } from '../../store/prefs'
import { matchesSearch, SECTIONS, SETTINGS, type SectionId, type SettingDef } from '../../lib/settingsSchema'
import { SettingControl } from './Controls'
import ShortcutsEditor, { matchingCommands } from './ShortcutsEditor'
import CalendarSources from './CalendarSources'
import SnippetsEditor from './SnippetsEditor'
import PlaceholderHelp from './PlaceholderHelp'
import RemindersSettings from './RemindersSettings'
import AiSettings from '../Ai/AiSettings'
import MusicSettings from '../Music/MusicSettings'
import StudioSettings from '../Studio/LiveSetup'
import { useUI } from '../../store/ui'
import pkg from '../../../../../package.json'
import { showKeys, TRAY_NAME } from '@shared/platform'

const ICONS: Record<SectionId, typeof Palette> = {
  appearance: Palette,
  editor: PenLine,
  files: FolderCog,
  calendar: CalendarDays,
  capture: Zap,
  ai: Sparkles,
  music: Music,
  studio: Clapperboard,
  shortcuts: Keyboard,
  about: Info
}

const SNIPPET_WORDS = /^(snip|expan|text sh|abbrev|;)/i

const isModified = (def: SettingDef, prefs: Record<string, unknown>): boolean =>
  JSON.stringify(prefs[def.key]) !== JSON.stringify(DEFAULT_PREFS[def.key])

function SettingRow({ def }: { def: SettingDef }) {
  const prefs = usePrefs((s) => s.prefs) as unknown as Record<string, unknown>
  const modified = isModified(def, prefs)
  // Pickers and text boxes with long explanations read better with the control under the label.
  const wide =
    def.type === 'theme' ||
    def.type === 'appIcon' ||
    def.type === 'font' ||
    def.type === 'color' ||
    ((def.type === 'text' || def.type === 'folder') && (def.description?.length ?? 0) > 70)
  return (
    <div className={`setting-row ${wide ? 'wide' : ''}`} data-setting={def.key}>
      <div className="setting-text">
        <label>
          {def.label}
          {modified && <span className="modified-dot" title="Changed from the default" />}
        </label>
        {def.description && <p>{def.description}</p>}
      </div>
      <div className="setting-control">
        <SettingControl def={def} />
        {modified && (
          <button className="icon-btn reset" title="Reset to default" onClick={() => resetPrefs([def.key])}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function SettingsList({ defs }: { defs: SettingDef[] }) {
  const groups = [...new Set(defs.map((d) => d.group))]
  return (
    <>
      {groups.map((group) => (
        <section key={group} className="settings-group">
          <h3>{group}</h3>
          {defs
            .filter((d) => d.group === group)
            .map((d) => (
              <SettingRow key={d.key} def={d} />
            ))}
        </section>
      ))}
    </>
  )
}

/** Whether the system-wide capture shortcut is working, with a button to try capture now. */
function CaptureShortcutStatus() {
  const shortcut = usePrefs((s) => s.prefs.captureShortcut)
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  useEffect(() => {
    // The main process registers the new shortcut as soon as the setting is saved.
    const t = setTimeout(() => window.api.captureStatus().then(setStatus), 400)
    return () => clearTimeout(t)
  }, [shortcut])
  if (!status) return null
  return (
    <div className="capture-status" data-capture-status>
      {status.error ? (
        <p className="setting-warning">{status.error}</p>
      ) : status.shortcut ? (
        <p>
          <span className="cal-connected-dot" /> Press <kbd>{status.shortcut}</kbd> in any app to capture a thought.
        </p>
      ) : (
        <p>
          Quick capture has no shortcut. You can still open it from the {TRAY_NAME} icon or with {showKeys('Ctrl+K')} → “Quick
          capture”.
        </p>
      )}
      <button className="btn" onClick={() => window.api.openCapture()}>
        Try it now
      </button>
    </div>
  )
}

/** Current version, what the last update check found, and a button to check now. */
function UpdateStatusRow() {
  const status = useUpdates((s) => s.status)
  const [busy, setBusy] = useState(false)
  useEffect(() => watchUpdates(), [])
  if (!status) return null
  const text =
    status.state === 'off'
      ? status.reason
      : status.state === 'checking'
        ? 'Checking…'
        : status.state === 'none'
          ? 'You have the latest version.'
          : status.state === 'downloading'
            ? `Downloading ${status.version}… ${status.percent ?? 0}%`
            : status.state === 'ready'
              ? `${status.version} is ready. Restart Orbit to update.`
              : status.state === 'available'
                ? `${status.version} is out.`
                : null
  return (
    <div className="update-status" data-update-status>
      {status.state === 'error' ? <p className="setting-warning">{status.error}</p> : <span>{text}</span>}
      {status.state === 'ready' || status.state === 'available' ? (
        <button className="btn btn-primary" onClick={() => window.api.installUpdate()}>
          {status.state === 'ready' ? 'Restart now' : 'Download'}
        </button>
      ) : (
        status.state !== 'off' && (
          <button
            className="btn"
            disabled={busy || status.state === 'checking' || status.state === 'downloading'}
            onClick={async () => {
              setBusy(true)
              await checkForUpdates().finally(() => setBusy(false))
            }}
          >
            <RefreshCw size={13} /> Check now
          </button>
        )
      )}
    </div>
  )
}

function About() {
  return (
    <section className="settings-group about">
      <h3>Notes {pkg.version}</h3>
      <UpdateStatusRow />
      <p>
        Your settings are saved in <code>settings.json</code>. You can edit it by hand: changes apply as soon as you
        save the file, and anything invalid is ignored.
      </p>
      <div className="about-actions">
        <button className="btn" onClick={() => window.api.openSettingsFile()}>
          <FileJson size={14} /> Open settings file
        </button>
        <button className="btn" onClick={() => resetPrefs(Object.keys(DEFAULT_PREFS) as (keyof typeof DEFAULT_PREFS)[])}>
          <RotateCcw size={14} /> Reset all settings
        </button>
        <button className="btn" onClick={() => window.api.showLog()} title="Problems Notes ran into in the background, if any">
          <ScrollText size={14} /> Show log file
        </button>
      </div>
    </section>
  )
}

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('appearance')
  const [query, setQuery] = useState('')
  const prefs = usePrefs((s) => s.prefs) as unknown as Record<string, unknown>
  const search = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => search.current?.focus(), [])
  const requested = useUI((s) => s.settingsSection)
  useEffect(() => {
    if (!requested) return
    setQuery('')
    setSection(requested as SectionId)
    useUI.setState({ settingsSection: null })
  }, [requested])
  useEffect(() => body.current?.scrollTo({ top: 0 }), [section])

  const q = query.trim()
  const sectionDefs = SETTINGS.filter((d) => d.section === section)
  const sectionModified = sectionDefs.filter((d) => isModified(d, prefs))
  const results = q ? SETTINGS.filter((d) => matchesSearch(d, q)) : []

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <div className="settings-search">
          <Search size={14} />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search settings"
            spellCheck={false}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} title="Clear">
              <X size={12} />
            </button>
          )}
        </div>
        {SECTIONS.map(({ id, label }) => {
          const Icon = ICONS[id]
          return (
            <button
              key={id}
              className={`settings-nav-item ${!q && section === id ? 'selected' : ''}`}
              onClick={() => {
                setQuery('')
                setSection(id)
              }}
            >
              <Icon size={15} /> {label}
            </button>
          )
        })}
      </nav>

      <div className="settings-body" ref={body}>
        <div className="settings-content">
          {q ? (
            <>
              <h2>Results for “{q}”</h2>
              {results.length > 0 && <SettingsList defs={results} />}
              <ShortcutsEditor query={q} />
              {SNIPPET_WORDS.test(q) && <SnippetsEditor />}
              {results.length === 0 && matchingCommands(q).length === 0 && !SNIPPET_WORDS.test(q) && <p className="settings-empty">No settings match.</p>}
            </>
          ) : (
            <>
              <div className="settings-heading">
                <h2>{SECTIONS.find((s) => s.id === section)!.label}</h2>
                {sectionModified.length > 0 && (
                  <button className="btn" onClick={() => resetPrefs(sectionModified.map((d) => d.key))}>
                    <RotateCcw size={13} /> Reset section
                  </button>
                )}
              </div>
              {section === 'shortcuts' ? (
                <ShortcutsEditor query="" />
              ) : section === 'about' ? (
                <>
                  <About />
                  <SettingsList defs={sectionDefs} />
                </>
              ) : (
                <>
                  <SettingsList defs={sectionDefs} />
                  {section === 'editor' && <SnippetsEditor />}
                  {section === 'calendar' && <RemindersSettings />}
                  {section === 'calendar' && <PlaceholderHelp />}
                  {section === 'calendar' && <CalendarSources />}
                  {section === 'capture' && <CaptureShortcutStatus />}
                  {section === 'ai' && <AiSettings />}
                  {section === 'music' && <MusicSettings />}
                  {section === 'studio' && <StudioSettings />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
