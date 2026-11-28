import { useEffect, useRef } from 'react'
import {
  CELL,
  CELLS_X,
  CELLS_Y,
  MAP_H,
  MAP_W,
  TILE,
  buildingAt,
  darkness,
  groupById,
  hasLesson,
  staleness,
  type BuildingKind,
  type MapData,
  type SurvivalWorld
} from '@shared/survival'

export type Selection = { kind: 'person' | 'group' | 'building'; id: number } | null

interface Props {
  world: React.MutableRefObject<SurvivalWorld>
  selection: Selection
  /** The group whose fog of war is shown, if any. */
  fogGroup: number | null
  /** What a click does: select things, or put something down. */
  placing: boolean
  onPick: (x: number, y: number, hit: Selection) => void
  /** Bumped when the map should jump to fit everything (a new world). */
  fitKey: number
  /** Ask the view to centre on a point. */
  focus: { x: number; y: number; n: number } | null
}

const PX = 6 // tile size in the cached map picture

const TILE_COLOR: Record<number, string> = {
  [TILE.grass]: '#18211b',
  [TILE.forest]: '#101a13',
  [TILE.road]: '#33363d',
  [TILE.lot]: '#1d2220',
  [TILE.field]: '#262819',
  [TILE.creek]: '#1b3447'
}

const BUILDING_COLOR: Record<BuildingKind, string> = {
  house: '#4a4f57',
  farm: '#5a4c3a',
  store: '#4d5a6b',
  pharmacy: '#3f6157',
  gas: '#5e5643',
  police: '#3d4a6e',
  school: '#5b4b63',
  church: '#5d5555',
  warehouse: '#4f4a44',
  cache: '#8a7a3a'
}

function mapPicture(map: MapData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = MAP_W * PX
  c.height = MAP_H * PX
  const g = c.getContext('2d')!
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const t = map.tiles[y * MAP_W + x]
      g.fillStyle = TILE_COLOR[t] ?? TILE_COLOR[TILE.grass]
      g.fillRect(x * PX, y * PX, PX, PX)
    }
  // Trees: small darker dots, so woods read as woods.
  let seed = map.seed
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  g.fillStyle = '#0b130e'
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (map.tiles[y * MAP_W + x] === TILE.forest && rnd() < 0.55) {
        g.beginPath()
        g.arc(x * PX + rnd() * PX, y * PX + rnd() * PX, PX * (0.35 + rnd() * 0.3), 0, Math.PI * 2)
        g.fill()
      }
  // Crop rows on fields.
  g.strokeStyle = 'rgba(80, 78, 40, 0.5)'
  g.lineWidth = 1
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (map.tiles[y * MAP_W + x] === TILE.field && y % 2 === 0) {
        g.beginPath()
        g.moveTo(x * PX, y * PX + PX / 2)
        g.lineTo(x * PX + PX, y * PX + PX / 2)
        g.stroke()
      }
  // Road centre lines on the highways.
  g.fillStyle = 'rgba(200, 180, 90, 0.18)'
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) if (map.tiles[y * MAP_W + x] === TILE.road && (x + y) % 3 === 0) g.fillRect(x * PX + PX / 2 - 0.5, y * PX + PX / 2 - 0.5, 1, 1)
  return c
}

/** The map: zoom with the wheel, drag to move around, click to pick. */
export default function SurvivalView({ world, selection, fogGroup, placing, onPick, fitKey, focus }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const cam = useRef({ x: MAP_W / 2, y: MAP_H / 2, z: 5 })
  const props = useRef({ selection, fogGroup })
  props.current = { selection, fogGroup }
  const pic = useRef<{ map: MapData | null; canvas: HTMLCanvasElement | null }>({ map: null, canvas: null })
  const fitted = useRef(-1)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)

  // Fit the whole map in view for a new world.
  useEffect(() => {
    const box = wrap.current?.getBoundingClientRect()
    if (!box || fitted.current === fitKey) return
    fitted.current = fitKey
    cam.current = { x: MAP_W / 2, y: MAP_H / 2, z: Math.max(1, Math.min(box.width / MAP_W, box.height / MAP_H)) }
  }, [fitKey])

  useEffect(() => {
    if (!focus) return
    cam.current = { x: focus.x, y: focus.y, z: Math.max(cam.current.z, 9) }
  }, [focus])

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
      if (fitted.current === -1 && box.width > 0) {
        fitted.current = fitKey
        cam.current = { x: MAP_W / 2, y: MAP_H / 2, z: Math.max(1, Math.min(box.width / MAP_W, box.height / MAP_H)) }
      }
      const w = world.current
      if (pic.current.map !== w.map) pic.current = { map: w.map, canvas: mapPicture(w.map) }
      const { x: camX, y: camY, z } = cam.current
      const zs = z * dpr
      const ox = cw / 2 - camX * zs
      const oy = ch / 2 - camY * zs
      const { selection: sel, fogGroup: fogId } = props.current

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#07080c'
      ctx.fillRect(0, 0, cw, ch)
      ctx.setTransform(zs, 0, 0, zs, ox, oy)
      ctx.imageSmoothingEnabled = z < PX
      ctx.drawImage(pic.current.canvas!, 0, 0, MAP_W, MAP_H)

      const px = 1 / zs // one screen pixel, in tiles
      const dark = darkness(w.tick)

      // Buildings.
      const campIds = new Map<number, string>()
      for (const g of w.groups) if (g.alive && g.camp != null) campIds.set(g.camp, g.color)
      for (const b of w.buildings) {
        ctx.fillStyle = BUILDING_COLOR[b.kind]
        ctx.fillRect(b.x, b.y, b.w, b.h)
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = px * 1.5
        ctx.strokeRect(b.x, b.y, b.w, b.h)
        // Roof ridge, so they read as buildings.
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'
        ctx.beginPath()
        if (b.w >= b.h) {
          ctx.moveTo(b.x + 0.4, b.y + b.h / 2)
          ctx.lineTo(b.x + b.w - 0.4, b.y + b.h / 2)
        } else {
          ctx.moveTo(b.x + b.w / 2, b.y + 0.4)
          ctx.lineTo(b.x + b.w / 2, b.y + b.h - 0.4)
        }
        ctx.stroke()
        if (b.kind === 'cache') {
          ctx.fillStyle = '#f6e05e'
          ctx.fillRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, b.h - 1.2)
        }
        const color = campIds.get(b.id)
        if (color) {
          // A camp: outlined in the group's colour, thicker the better it's barricaded.
          ctx.strokeStyle = color
          ctx.lineWidth = Math.max(px * 2, 0.15 + (b.fort / 100) * 0.5)
          ctx.strokeRect(b.x - 0.3, b.y - 0.3, b.w + 0.6, b.h + 0.6)
          if (b.fort > 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'
            ctx.fillRect(b.x, b.y - 1.2, b.w, 0.5)
            ctx.fillStyle = color
            ctx.fillRect(b.x, b.y - 1.2, (b.w * b.fort) / 100, 0.5)
          }
          // Campfire at night, unless they've learned to keep dark.
          const g = w.groups.find((x) => x.camp === b.id)
          if (dark > 0.3 && g && !hasLesson(g, 'quiet')) {
            const cx = b.x + b.w / 2
            const cy = b.y + b.h / 2
            const flick = 0.85 + Math.sin(time / 120 + b.id) * 0.08
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9 * flick)
            glow.addColorStop(0, `rgba(255, 170, 80, ${0.35 * dark})`)
            glow.addColorStop(1, 'rgba(255, 170, 80, 0)')
            ctx.fillStyle = glow
            ctx.beginPath()
            ctx.arc(cx, cy, 9, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        if (sel?.kind === 'building' && sel.id === b.id) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = px * 2
          ctx.strokeRect(b.x - 0.6, b.y - 0.6, b.w + 1.2, b.h + 1.2)
        }
      }

      // Bodies that haven't been dealt with.
      ctx.strokeStyle = 'rgba(220, 80, 80, 0.8)'
      ctx.lineWidth = Math.max(px * 1.5, 0.12)
      for (const c of w.corpses) {
        ctx.beginPath()
        ctx.moveTo(c.x - 0.5, c.y - 0.5)
        ctx.lineTo(c.x + 0.5, c.y + 0.5)
        ctx.moveTo(c.x + 0.5, c.y - 0.5)
        ctx.lineTo(c.x - 0.5, c.y + 0.5)
        ctx.stroke()
      }

      // Noise: rings spreading out.
      for (const n of w.noises) {
        const age = 1 - (n.until - w.tick) / 20
        ctx.strokeStyle = `rgba(255, 220, 120, ${0.5 * (1 - age)})`
        ctx.lineWidth = Math.max(px * 1.5, 0.15)
        ctx.beginPath()
        ctx.arc(n.x, n.y, Math.max(1, n.r * age), 0, Math.PI * 2)
        ctx.stroke()
      }

      // Walkers.
      const wr = Math.max(0.5, 2.2 * px)
      for (const zk of w.walkers) {
        ctx.fillStyle = zk.chase != null ? '#b4806e' : zk.herd != null ? '#8a9480' : '#9aa38c'
        ctx.beginPath()
        ctx.arc(zk.x, zk.y, wr, 0, Math.PI * 2)
        ctx.fill()
      }

      // Night falls over the land, but people stay easy to see.
      if (dark > 0) {
        ctx.fillStyle = `rgba(6, 10, 30, ${dark * 0.35})`
        ctx.fillRect(0, 0, MAP_W, MAP_H)
      }

      // Fog of war for the chosen group: what they don't know is dark, what's out of date is dimmed.
      const fog = fogId != null ? groupById(w, fogId) : undefined
      if (fog) {
        for (let cy = 0; cy < CELLS_Y; cy++)
          for (let cx = 0; cx < CELLS_X; cx++) {
            const st = staleness(w, fog, cy * CELLS_X + cx)
            if (st === 0) continue
            ctx.fillStyle = st < 0 ? 'rgba(5, 6, 10, 0.78)' : `rgba(5, 6, 10, ${0.12 + st * 0.35})`
            ctx.fillRect(cx * CELL, cy * CELL, CELL + px, CELL + px)
          }
      }

      // People.
      const pr = Math.max(0.65, 3.2 * px)
      const selPerson = sel?.kind === 'person' ? w.people.find((p) => p.id === sel.id) : undefined
      const selGroup = sel?.kind === 'group' ? sel.id : selPerson?.group
      if (selPerson) {
        // What they can see, and where they're headed.
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = px * 1.2
        ctx.setLineDash([px * 4, px * 4])
        ctx.beginPath()
        ctx.arc(selPerson.x, selPerson.y, 14 - dark * 8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(selPerson.x, selPerson.y)
        ctx.lineTo(selPerson.fleeUntil > w.tick ? selPerson.fleeX : selPerson.task.x, selPerson.fleeUntil > w.tick ? selPerson.fleeY : selPerson.task.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
      for (const p of w.people) {
        const g = groupById(w, p.group)
        const color = g?.color ?? '#fff'
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.age < 14 ? pr * 0.75 : pr, 0, Math.PI * 2)
        ctx.fill()
        ctx.lineWidth = Math.max(px * 1.5, 0.12)
        ctx.strokeStyle = p.bitten ? '#ff4d4d' : p.asleep ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.85)'
        ctx.stroke()
        if (g?.hostile) {
          ctx.strokeStyle = '#ff6b6b'
          ctx.beginPath()
          ctx.arc(p.x, p.y, pr + px * 2.5, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (p.id === selPerson?.id || p.group === selGroup) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = px * 1.5
          ctx.beginPath()
          ctx.arc(p.x, p.y, pr + px * (p.id === selPerson?.id ? 4 : 2.5), 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Words: town names when zoomed out, building and people names when zoomed in.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const sx = (x: number) => x * zs + ox
      const sy = (y: number) => y * zs + oy
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (z < 9) {
        ctx.font = `600 ${13 * dpr}px system-ui, sans-serif`
        for (const t of w.map.towns) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'
          ctx.fillText(t.name, sx(t.x) + dpr, sy(t.y - t.r - 3) + dpr)
          ctx.fillStyle = 'rgba(235, 238, 245, 0.85)'
          ctx.fillText(t.name, sx(t.x), sy(t.y - t.r - 3))
        }
      } else {
        ctx.font = `${10.5 * dpr}px system-ui, sans-serif`
        for (const b of w.buildings) {
          if (b.kind === 'house' && z < 16) continue
          ctx.fillStyle = 'rgba(220, 225, 235, 0.7)'
          ctx.fillText(b.name, sx(b.x + b.w / 2), sy(b.y + b.h + 1))
        }
      }
      for (const e of w.map.exits) {
        ctx.font = `${11 * dpr}px system-ui, sans-serif`
        ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(220, 200, 120, 0.8)'
        ctx.fillText(`${e.label} →`, sx(e.x) - 4 * dpr, sy(e.y) - 10 * dpr)
        ctx.textAlign = 'center'
      }
      if (z >= 7) {
        ctx.font = `600 ${10.5 * dpr}px system-ui, sans-serif`
        for (const p of w.people) {
          if (z < 12 && p.group !== selGroup) continue
          const label = p.name.split(' ')[0]
          ctx.fillStyle = 'rgba(0,0,0,0.65)'
          ctx.fillText(label, sx(p.x) + dpr, sy(p.y) - 11 * dpr + dpr)
          ctx.fillStyle = '#fff'
          ctx.fillText(label, sx(p.x), sy(p.y) - 11 * dpr)
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [world, fitKey])

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = wrap.current!.getBoundingClientRect()
    const { x, y, z } = cam.current
    return { x: (e.clientX - box.left - box.width / 2) / z + x, y: (e.clientY - box.top - box.height / 2) / z + y }
  }

  const hit = (x: number, y: number): Selection => {
    const w = world.current
    const r = Math.max(1.2, 6 / cam.current.z)
    let best: Selection = null
    let bd = r
    for (const p of w.people) {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bd) {
        bd = d
        best = { kind: 'person', id: p.id }
      }
    }
    if (best) return best
    const b = buildingAt(w, x, y, 0.5)
    return b ? { kind: 'building', id: b.id } : null
  }

  return (
    <div
      className={`evo-world sv-world ${placing ? 'placing' : ''}`}
      ref={wrap}
      onWheel={(e) => {
        const before = toWorld(e)
        const c = cam.current
        c.z = Math.max(1, Math.min(40, c.z * Math.exp(-e.deltaY * 0.0015)))
        const after = toWorld(e)
        c.x += before.x - after.x
        c.y += before.y - after.y
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (d.moved) {
          cam.current.x = Math.max(0, Math.min(MAP_W, d.cx - dx / cam.current.z))
          cam.current.y = Math.max(0, Math.min(MAP_H, d.cy - dy / cam.current.z))
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved) return
        const p = toWorld(e)
        if (p.x < 0 || p.y < 0 || p.x > MAP_W || p.y > MAP_H) return
        onPick(p.x, p.y, hit(p.x, p.y))
      }}
      data-sv-map
    >
      <canvas ref={canvas} />
    </div>
  )
}
