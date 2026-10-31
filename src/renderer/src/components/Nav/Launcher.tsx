import './nav.css'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { CircleDot, PanelLeft, Pin, Search } from 'lucide-react'
import { useUI } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { FEATURE_GROUPS, FEATURES, toggleFeatureIn, type Feature, type FeaturePlace } from '../../lib/features'
import { commands, shortcutFor } from '../../lib/commands'
import { fuzzyFilter } from '../../lib/fuzzy'
import { showKeys } from '@shared/platform'
import { openPalette } from '../../lib/smartCommands'

const close = (): void => useUI.setState({ launcherOpen: false })

const keysFor = (f: Feature): string | null => {
  const cmd = f.command ? commands.find((c) => c.id === f.command) : undefined
  const keys = cmd ? shortcutFor(cmd) : null
  return keys ? showKeys(keys) : null
}

/**
 * The launcher: every feature on one screen, grouped, with names. Start typing to filter; Enter
 * opens the first match (or, if nothing matches, sends what you typed to Ctrl+K).
 */
export default function Launcher() {
  const open = useUI((s) => s.launcherOpen)
  if (!open) return null
  return <LauncherScreen />
}

function LauncherScreen() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setSelected(0), [query])

  const q = query.trim()
  const matches = useMemo(
    () => (q ? fuzzyFilter(FEATURES, q, (f) => `${f.name} ${f.keywords ?? ''} ${f.group}`).map((m) => m.item) : FEATURES),
    [q]
  )
  // In group order when not searching, best match first when searching.
  const ordered = useMemo(() => (q ? matches : FEATURE_GROUPS.flatMap((g) => matches.filter((f) => f.group === g))), [q, matches])

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const launch = (f: Feature): void => {
    close()
    f.run()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const cols = Math.max(1, Math.floor((grid.current?.clientWidth ?? 800) / 200))
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query) setQuery('')
      else close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const f = ordered[selected]
      if (f) launch(f)
      else if (q) {
        close()
        openPalette(q)
      }
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, ordered.length - 1))
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + cols, ordered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - cols, 0))
    }
  }

  const tile = (f: Feature) => {
    const index = ordered.indexOf(f)
    return <Tile key={f.id} feature={f} index={index} selected={index === selected} onHover={() => setSelected(index)} onLaunch={() => launch(f)} />
  }

  return (
    <div className="launcher" onMouseDown={close} data-launcher>
      <div className="launcher-inner" onMouseDown={(e) => e.stopPropagation()}>
        <div className="launcher-search">
          <Search size={20} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What do you want to do?"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="launcher-grid" ref={grid}>
          {q ? (
            ordered.length ? (
              <div className="launcher-tiles">{ordered.map(tile)}</div>
            ) : (
              <button
                className="launcher-fallback"
                onClick={() => {
                  close()
                  openPalette(q)
                }}
              >
                Nothing called “{q}”. Press <kbd>Enter</kbd> to try it as a command.
              </button>
            )
          ) : (
            FEATURE_GROUPS.map((g) => {
              const inGroup = ordered.filter((f) => f.group === g)
              if (!inGroup.length) return null
              return (
                <section key={g} className="launcher-group">
                  <h3>{g}</h3>
                  <div className="launcher-tiles">{inGroup.map(tile)}</div>
                </section>
              )
            })
          )}
        </div>
        <p className="launcher-hint">
          Arrow keys to move, <kbd>Enter</kbd> to open. Use the buttons on a tile to put it in the top bar, the dock or the radial menu (hold the middle mouse
          button anywhere).
        </p>
      </div>
    </div>
  )
}

const PLACES: { place: FeaturePlace; label: string; icon: typeof Pin }[] = [
  { place: 'topbarFeatures', label: 'top bar', icon: Pin },
  { place: 'dockFeatures', label: 'dock', icon: PanelLeft },
  { place: 'radialFeatures', label: 'radial menu', icon: CircleDot }
]

function Tile({ feature: f, index, selected, onHover, onLaunch }: { feature: Feature; index: number; selected: boolean; onHover: () => void; onLaunch: () => void }) {
  const prefs = usePrefs((s) => s.prefs)
  const Icon = f.icon
  const Badge = f.badge
  const keys = keysFor(f)
  const pin = (place: FeaturePlace) => (e: MouseEvent) => {
    e.stopPropagation()
    toggleFeatureIn(place, f.id)
  }
  return (
    <div
      className={`launcher-tile ${selected ? 'selected' : ''}`}
      data-index={index}
      data-feature={f.id}
      onMouseMove={() => !selected && onHover()}
      onClick={onLaunch}
      role="button"
      tabIndex={-1}
    >
      <span className="launcher-icon">
        <Icon size={22} />
        {Badge && <Badge />}
      </span>
      <span className="launcher-text">
        <span className="launcher-name">{f.name}</span>
        <span className="launcher-blurb">{f.blurb}</span>
        {keys && <kbd className="launcher-keys">{keys}</kbd>}
      </span>
      <span className="launcher-pins">
        {PLACES.map(({ place, label, icon: PinIcon }) => {
          const on = prefs[place].includes(f.id)
          return (
            <button key={place} className={`launcher-pin ${on ? 'on' : ''}`} onClick={pin(place)} title={on ? `Take off the ${label}` : `Add to the ${label}`}>
              <PinIcon size={12} />
            </button>
          )
        })}
      </span>
    </div>
  )
}

/** The button in the top bar that opens the launcher. */
export function LauncherButton() {
  return (
    <button className="launcher-btn" onClick={() => useUI.setState({ launcherOpen: true })} title={`Everything (${showKeys('Ctrl+Shift+Space')})`} data-launcher-button>
      <span className="launcher-btn-dots" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      All features
    </button>
  )
}
