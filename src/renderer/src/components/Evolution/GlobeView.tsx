import { useEffect, useRef } from 'react'
import { CITIES } from '@shared/globeCities'
import { LAND } from '@shared/globeLand'
import { allGroups, along, partyPosition, type Globe } from '@shared/globe'

/** What's been clicked on the globe. */
export type GlobePick = { kind: 'spot'; lat: number; lon: number } | { kind: 'area'; id: number } | { kind: 'party'; id: number } | null

interface Camera {
  lon: number
  lat: number
  /** 1 shows the whole globe; bigger is closer. */
  zoom: number
}

const rad = (d: number): number => (d * Math.PI) / 180
const deg = (r: number): number => (r * 180) / Math.PI

/**
 * The globe, seen from space: drag to spin it, scroll to zoom. Coastlines, famous cities, the areas
 * you've opened (with who's there) and groups on the road. Click land to pick a spot; double-click
 * an area to go down to it.
 */
export default function GlobeView({
  globe,
  version,
  pick,
  onPick,
  onEnter,
  focus,
  picking
}: {
  globe: React.MutableRefObject<Globe>
  version: number
  pick: GlobePick
  onPick: (p: GlobePick) => void
  onEnter: (areaId: number) => void
  focus: { lat: number; lon: number; zoom?: number; n: number } | null
  /** Picking a destination for a group: the cursor says so. */
  picking: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const cam = useRef<Camera>({ lon: -84, lat: 33, zoom: 1.4 })
  const draw = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (focus) {
      cam.current.lon = focus.lon
      cam.current.lat = Math.max(-80, Math.min(80, focus.lat))
      if (focus.zoom) cam.current.zoom = focus.zoom
      draw.current()
    }
  }, [focus])

  draw.current = () => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth
    const H = c.clientHeight
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = globe.current
    const { lon: lon0, lat: lat0, zoom } = cam.current
    const R = Math.min(W, H) * 0.44 * zoom
    const cx = W / 2
    const cy = H / 2
    const sp0 = Math.sin(rad(lat0))
    const cp0 = Math.cos(rad(lat0))
    // Orthographic projection: x, y on screen, and whether the point faces us.
    const proj = (lat: number, lon: number): [number, number, boolean] => {
      const p = rad(lat)
      const l = rad(lon - lon0)
      const cosc = sp0 * Math.sin(p) + cp0 * Math.cos(p) * Math.cos(l)
      const x = Math.cos(p) * Math.sin(l)
      const y = cp0 * Math.sin(p) - sp0 * Math.cos(p) * Math.cos(l)
      if (cosc >= 0) return [cx + x * R, cy - y * R, true]
      // Round the back: pin it to the edge of the disc so outlines hug the horizon.
      const m = Math.hypot(x, y) || 1
      return [cx + (x / m) * R, cy - (y / m) * R, false]
    }

    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--sv-space') || '#05070d'
    ctx.fillRect(0, 0, W, H)
    // The sea.
    const sea = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R)
    sea.addColorStop(0, '#16304d')
    sea.addColorStop(1, '#0a1626')
    ctx.fillStyle = sea
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()

    // Lines of latitude and longitude, faintly.
    ctx.strokeStyle = 'rgba(140, 170, 210, 0.08)'
    ctx.lineWidth = 1
    for (let lo = -180; lo < 180; lo += 15) {
      ctx.beginPath()
      let on = false
      for (let la = -90; la <= 90; la += 3) {
        const [x, y, vis] = proj(la, lo)
        if (vis && on) ctx.lineTo(x, y)
        else if (vis) ctx.moveTo(x, y)
        on = vis
      }
      ctx.stroke()
    }
    for (let la = -75; la <= 75; la += 15) {
      ctx.beginPath()
      let on = false
      for (let lo = -180; lo <= 180; lo += 3) {
        const [x, y, vis] = proj(la, lo)
        if (vis && on) ctx.lineTo(x, y)
        else if (vis) ctx.moveTo(x, y)
        on = vis
      }
      ctx.stroke()
    }

    // Land.
    ctx.fillStyle = '#2b3a2f'
    ctx.strokeStyle = 'rgba(170, 200, 160, 0.35)'
    ctx.lineWidth = 0.8
    for (const pts of LAND) {
      let any = false
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y, vis] = proj(pts[i + 1], pts[i])
        if (vis) any = true
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      if (!any) continue
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // Famous cities.
    ctx.font = '11px system-ui, sans-serif'
    for (const city of CITIES) {
      const [x, y, vis] = proj(city.lat, city.lon)
      if (!vis) continue
      ctx.fillStyle = 'rgba(230, 225, 200, 0.75)'
      ctx.beginPath()
      ctx.arc(x, y, city.size === 3 ? 2.2 : 1.6, 0, Math.PI * 2)
      ctx.fill()
      if (zoom >= 4 || (zoom >= 2 && city.size >= 2) || city.size === 3) {
        ctx.fillStyle = 'rgba(230, 225, 200, 0.6)'
        ctx.fillText(city.name, x + 4, y - 3)
      }
    }

    // Groups on the road: where they are, and the way ahead.
    for (const p of g.parties) {
      const pos = partyPosition(g, p)
      ctx.strokeStyle = p.group.color
      ctx.globalAlpha = 0.6
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      let on = false
      for (let i = 0; i <= 32; i++) {
        const t = pos.t + ((1 - pos.t) * i) / 32
        const q = along(p.from.lat, p.from.lon, p.to.lat, p.to.lon, t)
        const [x, y, vis] = proj(q.lat, q.lon)
        if (vis && on) ctx.lineTo(x, y)
        else if (vis) ctx.moveTo(x, y)
        on = vis
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      const [x, y, vis] = proj(pos.lat, pos.lon)
      if (!vis) continue
      ctx.fillStyle = p.group.color
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = pick?.kind === 'party' && pick.id === p.id ? '#fff' : 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = '#e8ecf4'
      ctx.fillText(`${p.group.name} → ${p.to.name}`, x + 8, y + 4)
    }

    // Areas you've opened, and who's in them.
    const groups = allGroups(g)
    for (const a of g.areas) {
      const [x, y, vis] = proj(a.lat, a.lon)
      if (!vis) continue
      const here = groups.filter((x) => x.area === a)
      const on = pick?.kind === 'area' && pick.id === a.id
      ctx.fillStyle = here.length ? 'rgba(255,255,255,0.9)' : 'rgba(200,210,230,0.5)'
      ctx.strokeStyle = on ? '#fff' : 'rgba(0,0,0,0.6)'
      ctx.lineWidth = on ? 2 : 1
      ctx.fillRect(x - 4.5, y - 4.5, 9, 9)
      ctx.strokeRect(x - 4.5, y - 4.5, 9, 9)
      here.forEach((h, i) => {
        ctx.fillStyle = h.group.color
        ctx.beginPath()
        ctx.arc(x + 9 + i * 8, y, 3.5, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.fillStyle = '#e8ecf4'
      ctx.font = on ? 'bold 12px system-ui, sans-serif' : '12px system-ui, sans-serif'
      ctx.fillText(a.name, x + 9 + here.length * 8 + 2, y + 4)
      ctx.font = '11px system-ui, sans-serif'
    }

    // The spot you picked.
    if (pick?.kind === 'spot') {
      const [x, y, vis] = proj(pick.lat, pick.lon)
      if (vis) {
        ctx.strokeStyle = '#ffd27a'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.moveTo(x - 11, y)
        ctx.lineTo(x - 4, y)
        ctx.moveTo(x + 4, y)
        ctx.lineTo(x + 11, y)
        ctx.moveTo(x, y - 11)
        ctx.lineTo(x, y - 4)
        ctx.moveTo(x, y + 4)
        ctx.lineTo(x, y + 11)
        ctx.stroke()
      }
    }

    // A soft rim of atmosphere.
    const rim = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.06)
    rim.addColorStop(0, 'rgba(120, 170, 255, 0.18)')
    rim.addColorStop(1, 'rgba(120, 170, 255, 0)')
    ctx.fillStyle = rim
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2)
    ctx.fill()
  }

  useEffect(() => {
    draw.current()
  })

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(() => draw.current())
    ro.observe(c)
    // Screen point to lat/lon, or null off the globe.
    const unproject = (sx: number, sy: number): { lat: number; lon: number } | null => {
      const { lon: lon0, lat: lat0, zoom } = cam.current
      const R = Math.min(c.clientWidth, c.clientHeight) * 0.44 * zoom
      const x = (sx - c.clientWidth / 2) / R
      const y = -(sy - c.clientHeight / 2) / R
      const rho = Math.hypot(x, y)
      if (rho > 1) return null
      const cc = Math.asin(rho)
      const sp0 = Math.sin(rad(lat0))
      const cp0 = Math.cos(rad(lat0))
      const lat = rho === 0 ? lat0 : deg(Math.asin(Math.cos(cc) * sp0 + (y * Math.sin(cc) * cp0) / rho))
      const lon = lon0 + deg(Math.atan2(x * Math.sin(cc), rho * Math.cos(cc) * cp0 - y * Math.sin(cc) * sp0))
      return { lat, lon: ((lon + 540) % 360) - 180 }
    }
    let drag: { x: number; y: number; moved: boolean } | null = null
    const down = (e: PointerEvent): void => {
      drag = { x: e.clientX, y: e.clientY, moved: false }
      c.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      drag.x = e.clientX
      drag.y = e.clientY
      const R = Math.min(c.clientWidth, c.clientHeight) * 0.44 * cam.current.zoom
      cam.current.lon = ((cam.current.lon - deg(dx / R) + 540) % 360) - 180
      cam.current.lat = Math.max(-85, Math.min(85, cam.current.lat + deg(dy / R)))
      draw.current()
    }
    const up = (e: PointerEvent): void => {
      const d = drag
      drag = null
      if (!d || d.moved) return
      const r = c.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      onPickRef.current(hitTest(sx, sy) ?? (() => {
        const p = unproject(sx, sy)
        return p ? { kind: 'spot' as const, lat: p.lat, lon: p.lon } : null
      })())
    }
    const hitTest = (sx: number, sy: number): GlobePick => {
      const g = globe.current
      const near = (lat: number, lon: number, r: number): boolean => {
        const { lon: lon0, lat: lat0, zoom } = cam.current
        const R = Math.min(c.clientWidth, c.clientHeight) * 0.44 * zoom
        const p = rad(lat)
        const l = rad(lon - lon0)
        const sp0 = Math.sin(rad(lat0))
        const cp0 = Math.cos(rad(lat0))
        if (sp0 * Math.sin(p) + cp0 * Math.cos(p) * Math.cos(l) < 0) return false
        const x = c.clientWidth / 2 + Math.cos(p) * Math.sin(l) * R
        const y = c.clientHeight / 2 - (cp0 * Math.sin(p) - sp0 * Math.cos(p) * Math.cos(l)) * R
        return Math.hypot(x - sx, y - sy) < r
      }
      for (const p of g.parties) {
        const pos = partyPosition(g, p)
        if (near(pos.lat, pos.lon, 9)) return { kind: 'party', id: p.id }
      }
      for (const a of g.areas) if (near(a.lat, a.lon, 9)) return { kind: 'area', id: a.id }
      for (const city of CITIES) if (near(city.lat, city.lon, 6)) return { kind: 'spot', lat: city.lat, lon: city.lon }
      return null
    }
    const dbl = (e: MouseEvent): void => {
      const r = c.getBoundingClientRect()
      const hit = hitTest(e.clientX - r.left, e.clientY - r.top)
      if (hit?.kind === 'area') onEnterRef.current(hit.id)
    }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      cam.current.zoom = Math.max(0.8, Math.min(250, cam.current.zoom * Math.exp(-e.deltaY * 0.0015)))
      draw.current()
    }
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('dblclick', dbl)
    c.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('dblclick', dbl)
      c.removeEventListener('wheel', wheel)
    }
  }, [globe])

  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter
  void version

  return <canvas ref={canvas} className={`sv-globe ${picking ? 'picking' : ''}`} data-sv-globe />
}
