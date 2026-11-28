import { useEffect, useRef } from 'react'
import { addPlants, maxEnergyOf, newId, radiusOf, spawn, zoneAt, type Setup, type World, type Zone, type ZoneKind } from '@shared/evolution'

export type Tool = 'select' | ZoneKind | 'erase' | 'food' | 'spawn'

interface Props {
  world: React.MutableRefObject<World>
  setup: Setup
  tool: Tool
  /** The species the Spawn tool drops in. */
  spawnSpecies: string | null
  selected: number | null
  onSelect: (id: number | null) => void
  onZones: (zones: Zone[]) => void
  /** Something was dropped into the world while paused, so panels should catch up. */
  onChanged: () => void
}

const ZONE_FILL: Record<ZoneKind, string> = {
  wall: 'rgba(120, 126, 150, 0.9)',
  fertile: 'rgba(74, 222, 128, 0.10)',
  barren: 'rgba(160, 120, 80, 0.10)',
  danger: 'rgba(248, 113, 113, 0.12)'
}
const ZONE_EDGE: Record<ZoneKind, string> = {
  wall: 'rgba(190, 196, 220, 0.9)',
  fertile: 'rgba(74, 222, 128, 0.45)',
  barren: 'rgba(200, 160, 110, 0.4)',
  danger: 'rgba(248, 113, 113, 0.55)'
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The world, drawn big and glowing, plus the tools for drawing land and dropping things in. */
export default function WorldView({ world, setup, tool, spawnSpecies, selected, onSelect, onZones, onChanged }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const setupRef = useRef(setup)
  setupRef.current = setup
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const trail = useRef<{ id: number; points: { x: number; y: number }[] }>({ id: -1, points: [] })
  const view = useRef({ scale: 1, ox: 0, oy: 0 })

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    let frame = 0
    const draw = (time: number): void => {
      const box = wrap.current!.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const cw = Math.max(1, Math.floor(box.width * dpr))
      const ch = Math.max(1, Math.floor(box.height * dpr))
      if (el.width !== cw || el.height !== ch) {
        el.width = cw
        el.height = ch
      }
      const s = setupRef.current
      const w = world.current
      const { width: W, height: H } = s.conditions
      const scale = Math.min(cw / W, ch / H)
      const ox = (cw - W * scale) / 2
      const oy = (ch - H * scale) / 2
      view.current = { scale: scale / dpr, ox: ox / dpr, oy: oy / dpr }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#07080c'
      ctx.fillRect(0, 0, cw, ch)
      ctx.setTransform(scale, 0, 0, scale, ox, oy)

      // The ground: deep blue-black with a soft light in the middle and a faint grid.
      const ground = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
      ground.addColorStop(0, '#121726')
      ground.addColorStop(1, '#0a0c14')
      ctx.fillStyle = ground
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(255,255,255,0.025)'
      ctx.lineWidth = 1 / scale
      ctx.beginPath()
      for (let x = 0; x <= W; x += 50) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
      }
      for (let y = 0; y <= H; y += 50) {
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
      }
      ctx.stroke()

      // Special areas, walls last so they sit on top.
      const pulse = 0.6 + 0.4 * Math.sin(time / 500)
      for (const pass of [false, true]) {
        for (const z of s.zones) {
          if ((z.kind === 'wall') !== pass) continue
          ctx.globalAlpha = z.kind === 'danger' ? 0.7 + 0.3 * pulse : 1
          ctx.fillStyle = ZONE_FILL[z.kind]
          ctx.fillRect(z.x, z.y, z.w, z.h)
          ctx.strokeStyle = ZONE_EDGE[z.kind]
          ctx.lineWidth = (z.kind === 'wall' ? 1.5 : 1) / scale
          ctx.setLineDash(z.kind === 'wall' ? [] : [6 / scale, 5 / scale])
          ctx.strokeRect(z.x, z.y, z.w, z.h)
        }
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      if (!s.conditions.wrap) {
        ctx.strokeStyle = 'rgba(190,196,220,0.5)'
        ctx.lineWidth = 2 / scale
        ctx.strokeRect(0, 0, W, H)
      }

      // Glowing things add their light together.
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = 'rgba(74, 222, 128, 0.10)'
      for (const p of w.plants) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(160, 255, 190, 0.85)'
      for (const p of w.plants) ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4)

      const colours = new Map(s.species.map((sp) => [sp.id, hexToRgb(sp.color)]))
      for (const c of w.creatures) {
        const rgb = colours.get(c.species) ?? [200, 200, 200]
        const r = radiusOf(c)
        const glow = 0.08 + 0.2 * c.throttle
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${glow})`
        ctx.beginPath()
        ctx.arc(c.x, c.y, r * 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      for (const c of w.creatures) {
        const rgb = colours.get(c.species) ?? [200, 200, 200]
        const r = radiusOf(c)
        const full = Math.min(1, c.energy / maxEnergyOf(c))
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
        ctx.globalAlpha = 0.45 + 0.55 * full
        ctx.beginPath()
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
        ctx.fill()
        // An eye on the side it's facing.
        ctx.globalAlpha = 1
        ctx.fillStyle = 'rgba(10,12,20,0.85)'
        ctx.beginPath()
        ctx.arc(c.x + Math.cos(c.angle) * r * 0.55, c.y + Math.sin(c.angle) * r * 0.55, Math.max(1, r * 0.28), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // The one you're watching: its trail, how far it sees, and a ring.
      const sel = selectedRef.current
      const picked = sel != null ? w.creatures.find((c) => c.id === sel) : undefined
      if (picked) {
        const t = trail.current
        if (t.id !== picked.id) trail.current = { id: picked.id, points: [] }
        const last = trail.current.points[trail.current.points.length - 1]
        if (!last || Math.hypot(last.x - picked.x, last.y - picked.y) > 2) {
          // A jump means it wrapped round an edge, so the trail starts again.
          if (last && Math.hypot(last.x - picked.x, last.y - picked.y) > 60) trail.current.points = []
          trail.current.points.push({ x: picked.x, y: picked.y })
          if (trail.current.points.length > 140) trail.current.points.shift()
        }
        const pts = trail.current.points
        for (let i = 1; i < pts.length; i++) {
          ctx.strokeStyle = `rgba(255,255,255,${(i / pts.length) * 0.5})`
          ctx.lineWidth = 1.5 / scale
          ctx.beginPath()
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
          ctx.lineTo(pts[i].x, pts[i].y)
          ctx.stroke()
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.setLineDash([4 / scale, 6 / scale])
        ctx.beginPath()
        ctx.arc(picked.x, picked.y, picked.traits.sight, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2 / scale
        ctx.beginPath()
        ctx.arc(picked.x, picked.y, radiusOf(picked) + 4 + pulse * 2, 0, Math.PI * 2)
        ctx.stroke()
      }

      // The box you're drawing.
      const d = drag.current
      if (d && tool !== 'select' && tool !== 'erase' && tool !== 'food' && tool !== 'spawn') {
        ctx.fillStyle = ZONE_FILL[tool]
        ctx.strokeStyle = ZONE_EDGE[tool]
        ctx.lineWidth = 1.5 / scale
        const x = Math.min(d.x0, d.x1)
        const y = Math.min(d.y0, d.y1)
        ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0))
        ctx.strokeRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0))
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [world, tool])

  const toWorld = (e: React.PointerEvent): { x: number; y: number } => {
    const box = canvas.current!.getBoundingClientRect()
    const v = view.current
    return { x: (e.clientX - box.left - v.ox) / v.scale, y: (e.clientY - box.top - v.oy) / v.scale }
  }

  const dropAt = (p: { x: number; y: number }): void => {
    if (tool === 'food') addPlants(world.current, setup, 12, { ...p, r: 30 })
    if (tool === 'spawn' && spawnSpecies) spawn(world.current, setup, spawnSpecies, 8, { ...p, r: 25 })
    onChanged()
  }

  const down = (e: React.PointerEvent): void => {
    const p = toWorld(e)
    if (tool === 'select') {
      let best: number | null = null
      let bestD = Infinity
      for (const c of world.current.creatures) {
        const d = Math.hypot(c.x - p.x, c.y - p.y)
        if (d < Math.max(14, radiusOf(c) + 6) && d < bestD) {
          bestD = d
          best = c.id
        }
      }
      onSelect(best)
      return
    }
    if (tool === 'erase') {
      const z = zoneAt(setup.zones, p.x, p.y)
      if (z) onZones(setup.zones.filter((x) => x.id !== z.id))
      return
    }
    if (tool === 'food' || tool === 'spawn') {
      dropAt(p)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      return
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  }

  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toWorld(e)
    if (tool === 'food' && Math.hypot(p.x - d.x1, p.y - d.y1) > 25) dropAt(p)
    d.x1 = p.x
    d.y1 = p.y
  }

  const up = (): void => {
    const d = drag.current
    drag.current = null
    if (!d || tool === 'select' || tool === 'erase' || tool === 'food' || tool === 'spawn') return
    const { width: W, height: H } = setup.conditions
    const x = Math.max(0, Math.min(d.x0, d.x1))
    const y = Math.max(0, Math.min(d.y0, d.y1))
    const w = Math.min(W, Math.max(d.x0, d.x1)) - x
    const h = Math.min(H, Math.max(d.y0, d.y1)) - y
    if (w < 6 || h < 6) return
    onZones([...setup.zones, { id: newId('z'), kind: tool, x, y, w, h }])
  }

  return (
    <div className={`evo-world tool-${tool}`} ref={wrap} data-evo-world>
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </div>
  )
}
