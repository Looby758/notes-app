import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Dna, History, Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { useLab, SPEEDS } from './useLab'
import WorldView, { type Tool } from './WorldView'
import { LandPanel, SpeciesPanel, StartPanel, TOOLS, WorldPanel } from './Panels'
import { CreatureCard, EventList, PopulationChart, TraitChart } from './Watch'
import SurvivalPage from './SurvivalPage'
import './evolution.css'
import './survival.css'

type PanelId = 'watch' | 'species' | 'world' | 'land' | 'start'

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'watch', label: 'Watch' },
  { id: 'species', label: 'Species' },
  { id: 'world', label: 'Conditions' },
  { id: 'land', label: 'Land' },
  { id: 'start', label: 'Start' }
]

const fmt = (n: number): string => n.toLocaleString()

const MODE_KEY = 'orbit.evolution.mode'
type Mode = 'creatures' | 'survival'

/** If anything in the lab breaks, show what broke here instead of taking the whole window down. */
class LabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[evolution]', error, info.componentStack)
  }
  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="evo-page" style={{ padding: 24, gap: 10 }}>
        <h3 style={{ margin: 0 }}>Evolution Lab hit a problem</h3>
        <p className="muted">The rest of Orbit is fine. Here's what went wrong:</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, userSelect: 'text' }}>{String(error.stack || error.message)}</pre>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            try {
              localStorage.removeItem(MODE_KEY)
            } catch {
              // Nothing to reset.
            }
            this.setState({ error: null })
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}

/** Evolution Lab has two modes: creatures that evolve, and a survival sandbox with people. */
export default function EvolutionPage() {
  return (
    <LabErrorBoundary>
      <EvolutionModes />
    </LabErrorBoundary>
  )
}

function EvolutionModes() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'survival' ? 'survival' : 'creatures'
    } catch {
      return 'creatures'
    }
  })
  const choose = (m: Mode): void => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // Not remembered next time, that's all.
    }
  }
  const switcher = (
    <div className="evo-mode">
      <h2>
        <Dna size={18} /> Evolution Lab
      </h2>
      <div className="evo-seg" role="radiogroup" aria-label="Mode">
        <button className={mode === 'creatures' ? 'on' : ''} onClick={() => choose('creatures')} data-evo-mode="creatures">
          Creatures
        </button>
        <button className={mode === 'survival' ? 'on' : ''} onClick={() => choose('survival')} data-evo-mode="survival">
          Survival
        </button>
      </div>
    </div>
  )
  return mode === 'survival' ? <SurvivalPage switcher={switcher} /> : <CreatureLab switcher={switcher} />
}

/**
 * Creatures: build a world, fill it with species you design, and watch them get better at
 * surviving by trial and error. Pause, speed up or rewind whenever you like.
 */
function CreatureLab({ switcher }: { switcher: React.ReactNode }) {
  const lab = useLab()
  const [panel, setPanel] = useState<PanelId>('watch')
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<number | null>(null)
  const [spawnSpecies, setSpawnSpecies] = useState<string | null>(null)
  const w = lab.world.current

  useEffect(() => {
    if (!spawnSpecies || !lab.setup.species.some((s) => s.id === spawnSpecies)) setSpawnSpecies(lab.setup.species[0]?.id ?? null)
  }, [lab.setup.species, spawnSpecies])

  // Space pauses, . steps once.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || !document.querySelector('[data-evo-page]')) return
      if (e.key === ' ') {
        e.preventDefault()
        lab.setRunning(!lab.running)
      } else if (e.key === '.' && !lab.running) lab.stepOnce()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [lab])

  const counts = new Map<string, number>()
  let topGen = 0
  for (const c of w.creatures) {
    counts.set(c.species, (counts.get(c.species) ?? 0) + 1)
    if (c.generation > topGen) topGen = c.generation
  }
  const snaps = lab.snapshots.current
  const seconds = Math.floor(w.tick / 60)

  return (
    <div className="evo-page" data-evo-page>
      <header className="evo-bar">
        {switcher}
        <div className="evo-transport">
          <button className="evo-play" onClick={() => lab.setRunning(!lab.running)} title={lab.running ? 'Pause (Space)' : 'Play (Space)'} data-evo-play>
            {lab.running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn" onClick={lab.stepOnce} disabled={lab.running} title="One step (.)">
            <StepForward size={15} />
          </button>
          <div className="evo-seg" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} className={lab.speed === s ? 'on' : ''} onClick={() => lab.setSpeed(s)} title={s === 1000 ? 'As fast as your PC can go' : `${s}× speed`}>
                {s === 1000 ? 'Max' : `${s}×`}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => lab.restart()} title="Start again with this setup">
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="evo-stats">
          <span>
            Step <b>{fmt(w.tick)}</b>
            <em>
              {Math.floor(seconds / 60)}m {seconds % 60}s of life
            </em>
          </span>
          <span>
            Generation <b>{fmt(topGen)}</b>
          </span>
          <span>
            Alive <b>{fmt(w.creatures.length)}</b>
          </span>
          {lab.running && lab.speed > 5 && (
            <span className="muted" title="Steps per second this PC is managing">
              {fmt(lab.stepsPerSecond)}/s
            </span>
          )}
        </div>
      </header>

      <div className="evo-main">
        <div className="evo-stage">
          <WorldView
            world={lab.world}
            setup={lab.setup}
            tool={tool}
            spawnSpecies={spawnSpecies}
            selected={selected}
            onSelect={(id) => {
              setSelected(id)
              if (id != null) setPanel('watch')
            }}
            onZones={(zones) => lab.update((s) => ({ ...s, zones }))}
            onChanged={lab.refresh}
          />
          <div className="evo-toolbox" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`kind-${t.id} ${tool === t.id ? 'on' : ''}`}
                onClick={() => {
                  setTool(t.id)
                  if (t.id === 'spawn') setPanel('land')
                }}
                title={`${t.label}: ${t.hint}`}
              >
                <t.icon size={15} />
              </button>
            ))}
          </div>
          <div className="evo-species-strip">
            {lab.setup.species.map((sp) => (
              <span key={sp.id} className={counts.get(sp.id) ? '' : 'gone'}>
                <i style={{ background: sp.color, boxShadow: `0 0 10px ${sp.color}` }} />
                {sp.name} <b>{fmt(counts.get(sp.id) ?? 0)}</b>
              </span>
            ))}
            <span className="plants">
              <i /> Plants <b>{fmt(w.plants.length)}</b>
            </span>
          </div>
          <div className="evo-rewind" title="Rewind: drag back to any earlier moment. Carrying on from there replaces what came after.">
            <History size={14} />
            <input
              type="range"
              min={0}
              max={Math.max(0, snaps.length - 1)}
              value={snaps.length - 1}
              onChange={(e) => {
                lab.setRunning(false)
                lab.rewindTo(Number(e.target.value))
              }}
              disabled={snaps.length < 2}
              aria-label="Rewind"
              data-evo-rewind
            />
            <span>{snaps.length < 2 ? 'Rewind points appear as it runs' : 'Drag back to rewind'}</span>
          </div>
        </div>

        <aside className="evo-side">
          <nav className="evo-tabs">
            {PANELS.map((p) => (
              <button key={p.id} className={panel === p.id ? 'on' : ''} onClick={() => setPanel(p.id)} data-evo-tab={p.id}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="evo-side-scroll">
            {panel === 'watch' && (
              <div className="evo-panel-body">
                {selected != null ? (
                  <CreatureCard world={w} setup={lab.setup} id={selected} version={lab.version} onClose={() => setSelected(null)} />
                ) : (
                  <p className="evo-hint">Click any creature in the world to follow it and see its genes and brain.</p>
                )}
                <PopulationChart samples={lab.samples.current} setup={lab.setup} version={lab.version} />
                <TraitChart samples={lab.samples.current} setup={lab.setup} version={lab.version} />
                <EventList world={w} setup={lab.setup} version={lab.version} />
              </div>
            )}
            {panel === 'species' && <SpeciesPanel lab={lab} />}
            {panel === 'world' && <WorldPanel lab={lab} />}
            {panel === 'land' && <LandPanel lab={lab} tool={tool} setTool={setTool} spawnSpecies={spawnSpecies} setSpawnSpecies={setSpawnSpecies} />}
            {panel === 'start' && (
              <StartPanel
                lab={lab}
                onDone={() => {
                  setSelected(null)
                  setPanel('watch')
                }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
