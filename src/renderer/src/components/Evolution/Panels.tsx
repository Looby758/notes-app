import { useState } from 'react'
import { Apple, BrickWall, Eraser, Flame, MousePointer2, Plus, Sprout, Trash2, Wheat, Users } from 'lucide-react'
import { PRESETS, TRAITS, newSpecies, spawn, clampTrait, type Conditions, type Setup, type SpeciesSetup } from '@shared/evolution'
import type { Lab } from './useLab'
import type { Tool } from './WorldView'

const PALETTE = ['#4ade80', '#f87171', '#60a5fa', '#fbbf24', '#c084fc', '#f472b6', '#2dd4bf', '#fb923c', '#a3a380', '#e5e7eb']

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  show
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  show?: (v: number) => string
}) {
  return (
    <label className="evo-slider" title={hint}>
      <span className="evo-slider-top">
        <span>{label}</span>
        <b>{show ? show(value) : value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="evo-toggle" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

// ---------- species ----------

function SpeciesEditor({ lab, sp, counts }: { lab: Lab; sp: SpeciesSetup; counts: Map<string, number> }) {
  const change = (patch: Partial<SpeciesSetup>): void => lab.update((s) => ({ ...s, species: s.species.map((x) => (x.id === sp.id ? { ...x, ...patch } : x)) }))
  const others = lab.setup.species
  const alive = counts.get(sp.id) ?? 0
  return (
    <div className="evo-species" data-evo-species={sp.name}>
      <div className="evo-species-top">
        <input type="color" value={sp.color} onChange={(e) => change({ color: e.target.value })} title="Colour" />
        <input className="text-input" value={sp.name} maxLength={40} onChange={(e) => change({ name: e.target.value })} aria-label="Name" />
        <span className="evo-alive" title="Alive right now">
          {alive.toLocaleString()} alive
        </span>
        <button
          className="icon-btn"
          title="Remove this species"
          onClick={() => lab.update((s) => ({ ...s, species: s.species.filter((x) => x.id !== sp.id).map((x) => ({ ...x, hunts: x.hunts.filter((h) => h !== sp.id) })) }))}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="evo-sub">What it eats</div>
      <div className="evo-chips">
        <button className={`evo-chip ${sp.eatsPlants ? 'on' : ''}`} onClick={() => change({ eatsPlants: !sp.eatsPlants })}>
          <Sprout size={12} /> Plants
        </button>
        {others.map((o) => {
          const on = sp.hunts.includes(o.id)
          return (
            <button
              key={o.id}
              className={`evo-chip ${on ? 'on' : ''}`}
              style={on ? { borderColor: o.color, color: o.color } : undefined}
              onClick={() => change({ hunts: on ? sp.hunts.filter((h) => h !== o.id) : [...sp.hunts, o.id] })}
              title={o.id === sp.id ? 'Its own kind' : `Hunts ${o.name}`}
            >
              <i className="evo-dot" style={{ background: o.color }} /> {o.id === sp.id ? 'Its own kind' : o.name}
            </button>
          )
        })}
      </div>
      <div className="evo-toggles">
        <Toggle label="Has babies" on={sp.breeds} onChange={(v) => change({ breeds: v })} hint="Off for a species that only grows by turning others, like walkers." />
        <Toggle
          label="Anyone it catches turns into one of them"
          on={sp.infects}
          onChange={(v) => change({ infects: v })}
          hint="Instead of being eaten, prey comes back as this species."
        />
      </div>

      <div className="evo-sub">What it starts with</div>
      {TRAITS.map((t) => (
        <Slider
          key={t.key}
          label={t.label}
          hint={t.hint}
          value={sp.traits[t.key]}
          min={t.min}
          max={t.max}
          step={t.step}
          show={(v) => v.toFixed(t.whole || t.key === 'sight' ? 0 : 2)}
          onChange={(v) => change({ traits: { ...sp.traits, [t.key]: clampTrait(t.key, v) } })}
        />
      ))}
      <Slider label="Lives for" value={sp.lifespan} min={300} max={12000} step={100} show={(v) => `${Math.round(v / 60)} s`} onChange={(v) => change({ lifespan: v })} hint="At normal speed." />
      <Slider label="How many at the start" value={sp.start} min={0} max={300} step={1} onChange={(v) => change({ start: v })} />
      <div className="evo-species-actions">
        <button
          className="btn"
          onClick={() => {
            spawn(lab.world.current, lab.setup, sp.id, 10)
            lab.refresh()
          }}
        >
          <Plus size={13} /> Drop 10 in now
        </button>
        <span className="muted">New starting numbers are used for ones you drop in and when you start again.</span>
      </div>
    </div>
  )
}

export function SpeciesPanel({ lab }: { lab: Lab }) {
  const counts = new Map<string, number>()
  for (const c of lab.world.current.creatures) counts.set(c.species, (counts.get(c.species) ?? 0) + 1)
  const add = (): void =>
    lab.update((s) => {
      const used = new Set(s.species.map((x) => x.color))
      const color = PALETTE.find((p) => !used.has(p)) ?? PALETTE[s.species.length % PALETTE.length]
      return { ...s, species: [...s.species, newSpecies({ name: `Species ${s.species.length + 1}`, color })] }
    })
  return (
    <div className="evo-panel-body">
      {lab.setup.species.length === 0 && <p className="muted">No species yet. Add one, give it a diet, and drop it in.</p>}
      {lab.setup.species.map((sp) => (
        <SpeciesEditor key={sp.id} lab={lab} sp={sp} counts={counts} />
      ))}
      <button className="btn btn-primary evo-add" onClick={add} data-evo-add-species>
        <Plus size={14} /> New species
      </button>
    </div>
  )
}

// ---------- world conditions ----------

export function WorldPanel({ lab }: { lab: Lab }) {
  const c = lab.setup.conditions
  const set = (patch: Partial<Conditions>): void => lab.update((s) => ({ ...s, conditions: { ...s.conditions, ...patch } }))
  return (
    <div className="evo-panel-body">
      <div className="evo-sub">Food</div>
      <Slider label="Plant growth" value={c.plantGrowth} min={0} max={15} step={0.1} onChange={(v) => set({ plantGrowth: v })} show={(v) => v.toFixed(1)} hint="New plants per step." />
      <Slider label="Energy per plant" value={c.plantEnergy} min={5} max={100} step={1} onChange={(v) => set({ plantEnergy: v })} />
      <Slider label="Most plants at once" value={c.maxPlants} min={0} max={3000} step={50} onChange={(v) => set({ maxPlants: v })} />
      <div className="evo-sub">Nature</div>
      <Slider
        label="How harsh"
        value={c.harshness}
        min={0.2}
        max={3}
        step={0.05}
        onChange={(v) => set({ harshness: v })}
        show={(v) => `${v.toFixed(2)}×`}
        hint="Everything uses this much more (or less) energy."
      />
      <Slider
        label="Mutation chance"
        value={c.mutationRate}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ mutationRate: v })}
        show={(v) => `${Math.round(v * 100)}%`}
        hint="The chance each gene changes when a baby is born."
      />
      <Slider
        label="Mutation size"
        value={c.mutationSize}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ mutationSize: v })}
        show={(v) => `${Math.round(v * 100)}%`}
        hint="How big those changes are."
      />
      <Slider label="Most creatures at once" value={c.maxCreatures} min={50} max={3000} step={50} onChange={(v) => set({ maxCreatures: v })} hint="Higher can slow the PC down." />
      <Toggle label="Edges wrap round (off: the edges are walls)" on={c.wrap} onChange={(v) => set({ wrap: v })} />
      <div className="evo-sub">Starting again</div>
      <Slider label="World width" value={c.width} min={400} max={3000} step={50} onChange={(v) => set({ width: v })} />
      <Slider label="World height" value={c.height} min={300} max={2000} step={50} onChange={(v) => set({ height: v })} />
      <label className="evo-seed">
        <span>Seed</span>
        <input className="text-input" type="number" value={c.seed} onChange={(e) => set({ seed: Math.round(Number(e.target.value) || 0) })} />
        <button className="link-button" onClick={() => set({ seed: Math.floor(Math.random() * 1_000_000) })}>
          Random
        </button>
      </label>
      <p className="muted">The same seed and setup always play out the same way. Size and seed take effect when you start again.</p>
      <button className="btn" onClick={() => lab.restart()}>
        Start again with this setup
      </button>
    </div>
  )
}

// ---------- land and tools ----------

export const TOOLS: { id: Tool; label: string; icon: typeof Sprout; hint: string }[] = [
  { id: 'select', label: 'Watch', icon: MousePointer2, hint: 'Click a creature to see its genes and brain.' },
  { id: 'wall', label: 'Wall', icon: BrickWall, hint: 'Drag to build a wall nothing can cross.' },
  { id: 'fertile', label: 'Lush', icon: Sprout, hint: 'Drag to mark land where plants grow fast.' },
  { id: 'barren', label: 'Barren', icon: Wheat, hint: 'Drag to mark land where nothing grows.' },
  { id: 'danger', label: 'Danger', icon: Flame, hint: 'Drag to mark land that drains energy.' },
  { id: 'erase', label: 'Erase', icon: Eraser, hint: 'Click an area to remove it.' },
  { id: 'food', label: 'Food', icon: Apple, hint: 'Click or drag to scatter plants.' },
  { id: 'spawn', label: 'Drop in', icon: Users, hint: 'Click to drop in creatures of the species you pick.' }
]

export function LandPanel({ lab, tool, setTool, spawnSpecies, setSpawnSpecies }: { lab: Lab; tool: Tool; setTool: (t: Tool) => void; spawnSpecies: string | null; setSpawnSpecies: (id: string) => void }) {
  const zones = lab.setup.zones
  return (
    <div className="evo-panel-body">
      <div className="evo-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`evo-tool ${tool === t.id ? 'on' : ''} kind-${t.id}`} onClick={() => setTool(t.id)} title={t.hint} data-evo-tool={t.id}>
            <t.icon size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="muted">{TOOLS.find((t) => t.id === tool)?.hint}</p>
      {tool === 'spawn' && (
        <div className="evo-chips">
          {lab.setup.species.map((sp) => (
            <button key={sp.id} className={`evo-chip ${spawnSpecies === sp.id ? 'on' : ''}`} onClick={() => setSpawnSpecies(sp.id)}>
              <i className="evo-dot" style={{ background: sp.color }} /> {sp.name}
            </button>
          ))}
        </div>
      )}
      <div className="evo-sub">Areas ({zones.length})</div>
      {zones.length === 0 ? (
        <p className="muted">None yet. Pick Wall, Lush, Barren or Danger and drag on the world.</p>
      ) : (
        <button className="link-button danger" onClick={() => lab.update((s) => ({ ...s, zones: [] }))}>
          Clear all areas
        </button>
      )}
    </div>
  )
}

// ---------- starting points ----------

export function StartPanel({ lab, onDone }: { lab: Lab; onDone: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="evo-panel-body">
      <div className="evo-sub">Start from</div>
      <div className="evo-presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="evo-preset"
            onClick={() => {
              lab.restart(p.make())
              onDone()
            }}
            data-evo-preset={p.id}
          >
            <b>{p.name}</b>
            <span>{p.blurb}</span>
          </button>
        ))}
      </div>
      <div className="evo-sub">Your setups</div>
      <form
        className="evo-save"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          lab.saveAs(name.trim())
          setName('')
        }}
      >
        <input className="text-input" placeholder="Name this setup" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        <button className="btn" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
      {lab.saved.length === 0 && <p className="muted">Save the species, conditions and land you’ve made to come back to them.</p>}
      {lab.saved.map((s) => (
        <div key={s.name} className="evo-saved">
          <button
            className="evo-saved-name"
            onClick={() => {
              lab.restart(structuredClone(s.setup) as Setup)
              onDone()
            }}
          >
            <b>{s.name}</b>
            <span>
              {s.setup.species.length} species · {s.setup.zones.length} areas
            </span>
          </button>
          <button className="icon-btn" title="Delete" onClick={() => lab.removeSaved(s.name)}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
