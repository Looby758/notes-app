import { useDeferredValue, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Activity, Eraser, Pencil, TrendingDown, TrendingUp } from 'lucide-react'
import { allScenes, countWords, sceneText } from '@shared/writing'
import { presetShape, shapeAt, shapeDrift, SHAPE_POINTS, SHAPE_PRESETS, storyShape, type ShapePoint } from '@shared/writingTools'
import { change, openScene, useWriting } from '../../store/writingStudio'

/**
 * Draw the shape: sketch how tense you want the story to be from start to end, and see the real
 * shape worked out from the writing laid over it, with the scenes where they drift apart.
 */

const W = 1000
const H = 320
const PAD = { l: 8, r: 8, t: 18, b: 18 }
const px = (x: number): number => PAD.l + x * (W - PAD.l - PAD.r)
const py = (y: number): number => PAD.t + (1 - y) * (H - PAD.t - PAD.b)

/** A smooth line through points (Catmull-Rom turned into curves). */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

export default function ShapeView() {
  const story = useWriting((s) => s.story)!
  const deferred = useDeferredValue(story)
  const points = useMemo(() => storyShape(deferred), [deferred])
  const [draft, setDraft] = useState<number[] | null>(null)
  const [hover, setHover] = useState<ShapePoint | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const shape = draft ?? story.shape
  const drift = useMemo(() => shapeDrift(points, shape), [points, shape])
  const placed = useMemo(() => new Map(allScenes(deferred).map((p) => [p.scene.id, p])), [deferred])

  // Chapters as bands across the chart, sized by words.
  const bands = useMemo(() => {
    const total = deferred.chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + countWords(sceneText(s)), 0), 0)
    let run = 0
    return deferred.chapters.map((c) => {
      const words = c.scenes.reduce((m, s) => m + countWords(sceneText(s)), 0)
      const band = { id: c.id, title: c.title, from: total ? run / total : 0, to: total ? (run + words) / total : 0 }
      run += words
      return band
    })
  }, [deferred])

  const realAt = (x: number): number => {
    if (!points.length) return 0.5
    if (x <= points[0].x) return points[0].y
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1)
    }
    return points[points.length - 1].y
  }

  const draw = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const el = svg.current!
    el.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const at = (ev: { clientX: number; clientY: number }): [number, number] => {
      const x = (((ev.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r)
      const y = 1 - (((ev.clientY - r.top) / r.height) * H - PAD.t) / (H - PAD.t - PAD.b)
      return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]
    }
    // A first drawing starts from the real shape, so only what you draw over changes.
    let cur = story.shape.length === SHAPE_POINTS ? [...story.shape] : Array.from({ length: SHAPE_POINTS }, (_, i) => realAt(i / (SHAPE_POINTS - 1)))
    let last = at(e)
    const paint = ([x, y]: [number, number]): void => {
      const [lx, ly] = last
      const i0 = Math.round(Math.min(lx, x) * (SHAPE_POINTS - 1))
      const i1 = Math.round(Math.max(lx, x) * (SHAPE_POINTS - 1))
      cur = [...cur]
      for (let i = i0; i <= i1; i++) {
        const t = i1 === i0 ? 1 : (i / (SHAPE_POINTS - 1) - Math.min(lx, x)) / (Math.abs(x - lx) || 1)
        cur[i] = lx <= x ? ly + (y - ly) * Math.min(1, Math.max(0, t)) : y + (ly - y) * Math.min(1, Math.max(0, t))
      }
      last = [x, y]
      setDraft(cur)
    }
    paint(last)
    const move = (ev: PointerEvent): void => paint(at(ev))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      const final = cur
      change('Drew the story’s shape', (s) => void (s.shape = final))
      setDraft(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const want = shape.length ? smooth(shape.map((y, i) => [px(i / (shape.length - 1)), py(y)])) : ''
  const real = smooth(points.map((p) => [px(p.x), py(p.y)]))
  const driftIds = new Set(drift.map((d) => d.scene))

  return (
    <div className="ws-shape" data-ws-shape>
      <div className="ws-shape-inner">
        <header className="ws-calendar-head">
          <h2>
            <Activity size={18} /> The story’s shape
          </h2>
          <p>Draw how tense you want the story to feel from start to end, right on the chart. The solid line is how tense it really reads, worked out from the writing: action, short sentences, questions and exclamations push it up, long description brings it down.</p>
        </header>

        <div className="ws-shape-tools">
          <span className="ws-hint">
            <Pencil size={12} /> Drag on the chart to draw, or start from
          </span>
          {SHAPE_PRESETS.map((p) => (
            <button key={p.id} className="ws-chip-btn" onClick={() => change(`Used the “${p.label}” shape`, (s) => void (s.shape = presetShape(p.id)))} data-ws-shape-preset={p.id}>
              {p.label}
            </button>
          ))}
          {story.shape.length > 0 && (
            <button className="ws-chip-btn" onClick={() => change('Cleared the shape', (s) => void (s.shape = []))}>
              <Eraser size={11} /> Clear
            </button>
          )}
          <span className="ws-shape-key">
            <i className="real" /> How it reads <i className="want" /> What you drew
          </span>
        </div>

        <div className="ws-shape-chart">
          {!points.length && <div className="ws-shape-none">Write a few scenes and the real shape appears here.</div>}
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={draw} data-ws-shape-chart>
            <defs>
              <linearGradient id="ws-shape-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {bands.map((b, i) => (
              <rect key={b.id} className={`ws-shape-band ${i % 2 ? 'odd' : ''}`} x={px(b.from)} y={PAD.t} width={Math.max(0, px(b.to) - px(b.from))} height={H - PAD.t - PAD.b} />
            ))}
            {[0.25, 0.5, 0.75].map((g) => (
              <line key={g} className="ws-shape-grid" x1={PAD.l} x2={W - PAD.r} y1={py(g)} y2={py(g)} />
            ))}
            {points
              .filter((p) => driftIds.has(p.scene))
              .map((p) => (
                <line key={`d${p.scene}`} className="ws-shape-gap" x1={px(p.x)} x2={px(p.x)} y1={py(p.y)} y2={py(shapeAt(shape, p.x))} />
              ))}
            {real && <path className="ws-shape-area" d={`${real} L${px(points[points.length - 1].x)},${py(0)} L${px(points[0].x)},${py(0)} Z`} />}
            {real && <path className="ws-shape-real" d={real} pathLength={1} />}
            {want && <path className={`ws-shape-want ${draft ? 'drawing' : ''}`} d={want} />}
          </svg>
          <div className="ws-shape-dots">
            {points.map((p, i) => (
              <button
                key={p.scene}
                className={`ws-shape-dot ${driftIds.has(p.scene) ? 'drift' : ''}`}
                style={{ left: `${(px(p.x) / W) * 100}%`, top: `${(py(p.y) / H) * 100}%`, '--i': i } as CSSProperties}
                onClick={() => openScene(p.scene)}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                aria-label={placed.get(p.scene)?.scene.title}
                data-ws-shape-dot={p.scene}
              />
            ))}
            {hover && (
              <div className="ws-shape-tip" style={{ left: `${(px(hover.x) / W) * 100}%`, top: `${(py(hover.y) / H) * 100}%` }}>
                <b>{placed.get(hover.scene)?.scene.title}</b>
                <span>
                  {placed.get(hover.scene)?.chapter.title} · {hover.words.toLocaleString()} words
                </span>
              </div>
            )}
          </div>
          <div className="ws-shape-chapters">
            {bands.map((b) => (
              <span key={b.id} style={{ left: `${(px(b.from) / W) * 100}%`, width: `${((px(b.to) - px(b.from)) / W) * 100}%` }} title={b.title}>
                {b.title}
              </span>
            ))}
          </div>
        </div>

        {shape.length > 0 && (
          <section className="ws-drift" data-ws-drift>
            <h3>{drift.length ? 'Where it drifts from your shape' : 'It follows your shape'}</h3>
            {!drift.length && <p className="ws-panel-empty">Every scene is close to the shape you drew.</p>}
            {drift.slice(0, 10).map((d, i) => {
              const p = placed.get(d.scene)
              const calmer = d.got < d.want
              return (
                <button key={d.scene} className={`ws-drift-row ${calmer ? 'calmer' : 'tenser'}`} style={{ '--i': i } as CSSProperties} onClick={() => openScene(d.scene)}>
                  {calmer ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
                  <span>
                    <b>{p?.scene.title}</b> <span className="ws-scene-link-ch">{p?.chapter.title}</span>
                  </span>
                  <span className="ws-drift-what">{calmer ? 'calmer than you drew' : 'tenser than you drew'}</span>
                </button>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}
