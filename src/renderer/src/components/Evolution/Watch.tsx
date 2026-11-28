import { useEffect, useRef, useState } from 'react'
import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_OUTPUTS,
  TRAITS,
  maxEnergyOf,
  mindOf,
  type Sample,
  type Setup,
  type TraitKey,
  type World
} from '@shared/evolution'

const fmt = (n: number): string => n.toLocaleString()

/** A line chart drawn on a canvas, sized to its box. */
function LineChart({ series, version, height = 150, fromZero = true }: { series: { color: string; points: number[]; dashed?: boolean }[]; version: number; height?: number; fromZero?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth
    el.width = Math.floor(w * dpr)
    el.height = Math.floor(height * dpr)
    const ctx = el.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, height)
    // Counts start from zero; traits zoom in on their range so small changes show.
    let max = fromZero ? 1 : -Infinity
    let min = fromZero ? 0 : Infinity
    for (const s of series)
      for (const v of s.points) {
        if (v > max) max = v
        if (v < min) min = v
      }
    if (!Number.isFinite(max)) {
      max = 1
      min = 0
    }
    if (!fromZero) {
      const padBy = Math.max((max - min) * 0.15, Math.abs(max) * 0.05, 0.01)
      max += padBy
      min -= padBy
    }
    const pad = 4
    const len = Math.max(2, ...series.map((s) => s.points.length))
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const y = pad + ((height - pad * 2) * i) / 4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    for (const s of series) {
      if (s.points.length < 2) continue
      const path = new Path2D()
      s.points.forEach((v, i) => {
        const x = (i / (len - 1)) * w
        const y = height - pad - ((v - min) / (max - min)) * (height - pad * 2)
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      })
      ctx.setLineDash(s.dashed ? [3, 4] : [])
      ctx.strokeStyle = s.color
      ctx.lineWidth = 2
      ctx.shadowColor = s.color
      ctx.shadowBlur = s.dashed ? 0 : 8
      ctx.stroke(path)
      ctx.shadowBlur = 0
    }
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = '10px system-ui, sans-serif'
    const label = (v: number): string => (Math.abs(v) >= 10 ? fmt(Math.round(v)) : v.toFixed(2))
    ctx.fillText(label(max), 4, 12)
    if (!fromZero) ctx.fillText(label(min), 4, height - 6)
  }, [series, version, height, fromZero])
  return <canvas ref={ref} className="evo-chart" style={{ height }} />
}

export function PopulationChart({ samples, setup, version }: { samples: Sample[]; setup: Setup; version: number }) {
  const series = [
    { color: 'rgba(160,255,190,0.35)', points: samples.map((s) => s.plants), dashed: true },
    ...setup.species.map((sp) => ({ color: sp.color, points: samples.map((s) => s.species[sp.id]?.count ?? 0) }))
  ]
  return (
    <section className="evo-card">
      <h4>Population</h4>
      <LineChart series={series} version={version} />
      <div className="evo-legend">
        {setup.species.map((sp) => (
          <span key={sp.id}>
            <i style={{ background: sp.color }} /> {sp.name}
          </span>
        ))}
        <span className="muted">
          <i className="dashed" /> Plants
        </span>
      </div>
    </section>
  )
}

export function TraitChart({ samples, setup, version }: { samples: Sample[]; setup: Setup; version: number }) {
  const [trait, setTrait] = useState<TraitKey>('speed')
  const series = setup.species.map((sp) => ({ color: sp.color, points: samples.filter((s) => (s.species[sp.id]?.count ?? 0) > 0).map((s) => s.species[sp.id].avg[trait]) }))
  const latest = samples[samples.length - 1]
  return (
    <section className="evo-card">
      <div className="evo-card-head">
        <h4>How they’re changing</h4>
        <div className="evo-seg small">
          {TRAITS.map((t) => (
            <button key={t.key} className={trait === t.key ? 'on' : ''} onClick={() => setTrait(t.key)}>
              {t.label === 'Babies at once' ? 'Babies' : t.label}
            </button>
          ))}
        </div>
      </div>
      <LineChart series={series} version={version} height={120} fromZero={false} />
      <div className="evo-trait-now">
        {setup.species.map((sp) => {
          const now = latest?.species[sp.id]
          if (!now?.count) return null
          const start = sp.traits[trait]
          const diff = now.avg[trait] - start
          const pct = start ? Math.round((diff / start) * 100) : 0
          return (
            <span key={sp.id}>
              <i style={{ background: sp.color }} /> {sp.name}: {now.avg[trait].toFixed(trait === 'sight' ? 0 : 2)}{' '}
              <b className={pct > 0 ? 'up' : pct < 0 ? 'down' : ''}>{pct === 0 ? 'same as the start' : `${pct > 0 ? '+' : ''}${pct}% since the start`}</b>
            </span>
          )
        })}
      </div>
    </section>
  )
}

/** A creature's brain: what it senses on the left, what it decides on the right, lit up as it thinks. */
function BrainView({ brain, thought }: { brain: number[]; thought: { inputs: number[]; hidden: number[]; outputs: number[] } }) {
  const W = 300
  const H = 250
  const nIn = BRAIN_INPUTS.length
  const col = [92, 190, 262]
  const yOf = (i: number, n: number): number => 12 + ((H - 24) * (i + 0.5)) / n
  const glow = (v: number): string => (v >= 0 ? `rgba(94,234,212,${0.25 + 0.75 * Math.min(1, Math.abs(v))})` : `rgba(251,113,133,${0.25 + 0.75 * Math.min(1, Math.abs(v))})`)
  const lines: React.ReactNode[] = []
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    for (let i = 0; i < nIn; i++) {
      const wgt = brain[h * nIn + i]
      const flow = thought.inputs[i] * wgt
      lines.push(
        <line
          key={`a${h}-${i}`}
          x1={col[0]}
          y1={yOf(i, nIn)}
          x2={col[1]}
          y2={yOf(h, BRAIN_HIDDEN)}
          stroke={wgt >= 0 ? '#5eead4' : '#fb7185'}
          strokeOpacity={0.05 + Math.min(0.6, Math.abs(flow) * 0.35)}
          strokeWidth={0.5 + Math.min(2.5, Math.abs(wgt))}
        />
      )
    }
    for (let o = 0; o < BRAIN_OUTPUTS.length; o++) {
      const wgt = brain[nIn * BRAIN_HIDDEN + o * BRAIN_HIDDEN + h]
      const flow = thought.hidden[h] * wgt
      lines.push(
        <line
          key={`b${h}-${o}`}
          x1={col[1]}
          y1={yOf(h, BRAIN_HIDDEN)}
          x2={col[2]}
          y2={yOf(o, BRAIN_OUTPUTS.length)}
          stroke={wgt >= 0 ? '#5eead4' : '#fb7185'}
          strokeOpacity={0.08 + Math.min(0.7, Math.abs(flow) * 0.4)}
          strokeWidth={0.5 + Math.min(2.5, Math.abs(wgt))}
        />
      )
    }
  }
  return (
    <svg className="evo-brain" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="This creature's brain">
      {lines}
      {BRAIN_INPUTS.map((label, i) => (
        <g key={label}>
          <text x={col[0] - 9} y={yOf(i, nIn) + 3} textAnchor="end">
            {label}
          </text>
          <circle cx={col[0]} cy={yOf(i, nIn)} r={4.5} fill={glow(thought.inputs[i])} />
        </g>
      ))}
      {thought.hidden.map((v, h) => (
        <circle key={h} cx={col[1]} cy={yOf(h, BRAIN_HIDDEN)} r={6} fill={glow(v)} />
      ))}
      {BRAIN_OUTPUTS.map((label, o) => (
        <g key={label}>
          <circle cx={col[2]} cy={yOf(o, BRAIN_OUTPUTS.length)} r={7} fill={glow(o === 1 ? thought.outputs[o] : thought.outputs[o])} />
          <text x={col[2] + 12} y={yOf(o, BRAIN_OUTPUTS.length) + 3}>
            {label}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function CreatureCard({ world, setup, id, onClose }: { world: World; setup: Setup; id: number; version: number; onClose: () => void }) {
  const c = world.creatures.find((x) => x.id === id)
  if (!c) {
    return (
      <section className="evo-card">
        <div className="evo-card-head">
          <h4>Watching</h4>
          <button className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">It died. Click another creature in the world to watch it.</p>
      </section>
    )
  }
  const sp = setup.species.find((s) => s.id === c.species)
  const thought = mindOf(world, setup, id)
  const energy = Math.min(1, c.energy / maxEnergyOf(c))
  return (
    <section className="evo-card evo-creature" data-evo-creature>
      <div className="evo-card-head">
        <h4>
          <i className="evo-dot" style={{ background: sp?.color }} /> {sp?.name ?? 'Unknown'} #{c.id}
        </h4>
        <button className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="evo-facts">
        <span>
          Generation <b>{c.generation}</b>
        </span>
        <span>
          Age <b>{fmt(c.age)}</b>
        </span>
        <span>
          Babies <b>{c.babies}</b>
        </span>
        {(sp?.hunts.length ?? 0) > 0 && (
          <span>
            Caught <b>{c.kills}</b>
          </span>
        )}
        <span title="Times it was close enough to eat something and chose to leave it">
          Let meals go <b>{c.spared ?? 0}</b>
        </span>
      </div>
      <div className="evo-energy" title={`Energy ${Math.round(c.energy)} of ${Math.round(maxEnergyOf(c))}`}>
        <div style={{ width: `${energy * 100}%`, background: sp?.color }} />
      </div>
      <div className="evo-genes">
        {TRAITS.map((t) => {
          const start = sp?.traits[t.key] ?? c.traits[t.key]
          const d = c.traits[t.key] - start
          return (
            <span key={t.key} title={t.hint}>
              {t.label} <b>{c.traits[t.key].toFixed(t.whole ? 0 : t.key === 'sight' ? 0 : 2)}</b>
              {Math.abs(d) > (t.max - t.min) * 0.01 && <em className={d > 0 ? 'up' : 'down'}>{d > 0 ? '▲' : '▼'}</em>}
            </span>
          )
        })}
      </div>
      {thought && <BrainView brain={c.brain} thought={thought} />}
      <p className="evo-hint">The brain started random. Every line is a number its parents passed down, changed a little each generation. Green pushes, pink holds back. Nothing tells it when to eat: if Eat is below halfway it leaves a meal it’s touching, and only what works gets passed on.</p>
    </section>
  )
}

export function EventList({ world, setup }: { world: World; setup: Setup; version: number }) {
  const colour = new Map(setup.species.map((s) => [s.id, s.color]))
  const events = world.events.slice(-40).reverse()
  return (
    <section className="evo-card">
      <h4>What’s happened</h4>
      <ul className="evo-events">
        {events.map((e, i) => (
          <li key={`${e.tick}-${i}`} className={e.kind}>
            <i style={{ background: colour.get(e.species) ?? 'var(--text-faint)' }} />
            <span>{e.text}</span>
            <time>step {fmt(e.tick)}</time>
          </li>
        ))}
      </ul>
    </section>
  )
}
