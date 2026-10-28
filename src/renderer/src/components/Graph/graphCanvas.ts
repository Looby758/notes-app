import { neighbourhoodLayout, RING_1, RING_2, seedPosition, simulate, type Body, type Graph } from '../../lib/graph'

/**
 * Draws the graph on a canvas and handles pointing at it: hover to highlight, click a note, drag
 * the background to pan, scroll to zoom, and (in the constellation) drag notes around.
 */

export type GraphStyle = 'neighbourhood' | 'constellation'

interface Options {
  onClick: (id: string, e: { ctrl: boolean }) => void
}

interface Shown {
  id: string
  x: number
  y: number
  /** Where it's heading (neighbourhood moves animate). */
  tx: number
  ty: number
  ring: 0 | 1 | 2
  /** Fades in when it first appears. */
  fade: number
}

const PALETTE = ['#5ea8ff', '#3ccfcf', '#4ade80', '#e0a458', '#f97066', '#f472b6', '#c4b5fd', '#a3e635', '#fbbf24', '#38bdf8']

interface Colours {
  bg: string
  text: string
  muted: string
  faint: string
  accent: string
  border: string
}

function readColours(): Colours {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--bg', '#16171d'),
    text: v('--text', '#d7d9e0'),
    muted: v('--text-muted', '#9a9caa'),
    faint: v('--text-faint', '#6b6e7d'),
    accent: v('--accent', '#4ade80'),
    border: v('--border', '#2a2b36')
  }
}

const xy = ([x, y]: [number, number]): { x: number; y: number } => ({ x, y })

/** "#rrggbb" + alpha → rgba(). Anything else is returned unchanged. */
function alpha(colour: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour)
  if (!m) return colour
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export class GraphCanvas {
  private ctx: CanvasRenderingContext2D
  private graph: Graph | null = null
  private style: GraphStyle = 'neighbourhood'
  private centre: string | null = null
  private depth: 1 | 2 = 1
  private orphans = true
  private query = ''
  private shown = new Map<string, Shown>()
  private bodies: Body[] = []
  private bodyIndex = new Map<string, number>()
  private edgeIndex: [number, number][] = []
  private heat = 0
  private cam = { x: 0, y: 0, k: 1 }
  private camTarget: { x: number; y: number; k: number } | null = null
  private fitted = false
  private hover: string | null = null
  private drag: { id: string | null; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null
  private colours = readColours()
  private groupColour = new Map<string, string>()
  private frame = 0
  private raf = 0
  private width = 0
  private height = 0
  private stars: { x: number; y: number; r: number; a: number }[] = []
  private disposers: (() => void)[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: Options
  ) {
    this.ctx = canvas.getContext('2d')!
    ;(canvas as HTMLCanvasElement & { graph?: GraphCanvas }).graph = this
    this.listen()
    this.resize()
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(canvas.parentElement!)
    this.disposers.push(() => ro.disconnect())
    this.loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    for (const d of this.disposers) d()
  }

  // ---------- inputs ----------

  set(next: { graph: Graph; style: GraphStyle; centre: string | null; depth: 1 | 2; orphans: boolean; query: string }): void {
    const graphChanged = next.graph !== this.graph
    const styleChanged = next.style !== this.style
    const layoutChanged = graphChanged || styleChanged || next.centre !== this.centre || next.depth !== this.depth || next.orphans !== this.orphans
    this.graph = next.graph
    this.style = next.style
    this.centre = next.centre
    this.depth = next.depth
    this.orphans = next.orphans
    this.query = next.query.trim().toLowerCase()
    if (graphChanged) this.assignColours()
    if (styleChanged) this.fitted = false
    if (layoutChanged) this.layout(graphChanged)
  }

  /** Brings a note into view (constellation search). */
  focus(id: string): void {
    const b = this.bodies[this.bodyIndex.get(id) ?? -1]
    if (b) this.camTarget = { x: b.x, y: b.y, k: Math.max(this.cam.k, 1.4) }
  }

  /** Where each note is on screen right now (used by the end-to-end tests). */
  screenPositions(): { id: string; x: number; y: number; ring?: number }[] {
    if (this.style === 'neighbourhood') return [...this.shown.values()].map((s) => ({ id: s.id, ...xy(this.toScreen(s.x, s.y)), ring: s.ring }))
    return this.bodies.map((b) => ({ id: b.id, ...xy(this.toScreen(b.x, b.y)) }))
  }

  /** Back to the whole picture. */
  fit(): void {
    this.fitted = false
  }

  private assignColours(): void {
    const groups = [...new Set(this.graph!.nodes.map((n) => n.group))].filter(Boolean).sort()
    this.groupColour = new Map(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]))
  }

  groupColours(): [string, string][] {
    return [...this.groupColour]
  }

  private colourOf(id: string): string {
    const g = this.graph?.byId.get(id)?.group ?? ''
    return g ? (this.groupColour.get(g) ?? this.colours.accent) : this.colours.accent
  }

  private layout(graphChanged: boolean): void {
    const graph = this.graph!
    if (this.style === 'neighbourhood') {
      const placed = this.centre && graph.byId.has(this.centre) ? neighbourhoodLayout(graph, this.centre, this.depth) : []
      const next = new Map<string, Shown>()
      const from = this.shown.get(this.centre ?? '')
      for (const p of placed) {
        const old = this.shown.get(p.id)
        // Notes already on screen glide to their new spot; new ones grow out of the centre.
        next.set(p.id, old ? { ...old, tx: p.x, ty: p.y, ring: p.ring } : { id: p.id, x: from ? from.x * 0.5 : p.x * 0.4, y: from ? from.y * 0.5 : p.y * 0.4, tx: p.x, ty: p.y, ring: p.ring, fade: 0 })
      }
      this.shown = next
      // Each new middle note gets a fresh fit (the rings change size).
      this.fitted = false
      return
    }
    // Constellation: keep existing positions, seed new notes.
    const keep = new Map(this.bodies.map((b) => [b.id, b]))
    const visible = graph.nodes.filter((n) => this.orphans || n.degree > 0)
    const spread = Math.sqrt(visible.length) * 40 + 80
    this.bodies = visible.map((n) => keep.get(n.id) ?? { id: n.id, ...seedPosition(n.id, spread), vx: 0, vy: 0 })
    this.bodyIndex = new Map(this.bodies.map((b, i) => [b.id, i]))
    this.edgeIndex = graph.edges
      .map(([a, b]) => [this.bodyIndex.get(a), this.bodyIndex.get(b)] as [number | undefined, number | undefined])
      .filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined)
    this.heat = graphChanged || keep.size === 0 ? 1 : Math.max(this.heat, 0.4)
  }

  // ---------- sizing and camera ----------

  private resize(): void {
    const parent = this.canvas.parentElement!
    const dpr = window.devicePixelRatio || 1
    this.width = parent.clientWidth
    this.height = parent.clientHeight
    this.canvas.width = Math.max(1, Math.round(this.width * dpr))
    this.canvas.height = Math.max(1, Math.round(this.height * dpr))
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // A faint field of "stars" behind the constellation, fixed to the screen.
    let seed = 7
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    this.stars = Array.from({ length: Math.round((this.width * this.height) / 9000) }, () => ({
      x: rand() * this.width,
      y: rand() * this.height,
      r: rand() * 0.9 + 0.2,
      a: rand() * 0.25 + 0.05
    }))
  }

  private toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.k + this.width / 2, (y - this.cam.y) * this.cam.k + this.height / 2]
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / this.cam.k + this.cam.x, (sy - this.height / 2) / this.cam.k + this.cam.y]
  }

  /** The camera that shows everything. */
  private fitTarget(): { x: number; y: number; k: number } {
    if (this.style === 'neighbourhood') {
      // Room for the outer ring plus its labels.
      const radius = (this.depth === 2 && [...this.shown.values()].some((s) => s.ring === 2) ? RING_2 : RING_1) + 130
      return { x: 0, y: 0, k: Math.min(1.25, Math.min(this.width, this.height) / (radius * 2)) }
    }
    if (!this.bodies.length) return { x: 0, y: 0, k: 1 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of this.bodies) {
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x)
      maxY = Math.max(maxY, b.y)
    }
    const pad = 80
    const k = Math.min(2, (this.width - pad * 2) / Math.max(1, maxX - minX), (this.height - pad * 2) / Math.max(1, maxY - minY))
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: Math.max(0.15, k) }
  }

  // ---------- pointing ----------

  private radius(id: string, ring?: 0 | 1 | 2): number {
    if (this.style === 'neighbourhood') return ring === 0 ? 15 : ring === 1 ? 8.5 : 6
    const d = this.graph?.byId.get(id)?.degree ?? 0
    return 3.2 + Math.sqrt(d) * 2.1
  }

  private hit(sx: number, sy: number): string | null {
    let best: string | null = null
    let bestD = Infinity
    const consider = (id: string, x: number, y: number, ring?: 0 | 1 | 2): void => {
      const [px, py] = this.toScreen(x, y)
      const d = Math.hypot(px - sx, py - sy)
      const r = Math.max(8, this.radius(id, ring) * this.cam.k + 5)
      if (d < r && d < bestD) {
        best = id
        bestD = d
      }
    }
    if (this.style === 'neighbourhood') for (const s of this.shown.values()) consider(s.id, s.x, s.y, s.ring)
    else for (const b of this.bodies) consider(b.id, b.x, b.y)
    return best
  }

  private listen(): void {
    const c = this.canvas
    const pos = (e: MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const down = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const [sx, sy] = pos(e)
      const id = this.hit(sx, sy)
      this.drag = { id, sx, sy, cx: this.cam.x, cy: this.cam.y, moved: false }
      this.camTarget = null
      if (id && this.style === 'constellation') {
        const b = this.bodies[this.bodyIndex.get(id)!]
        if (b) b.fixed = true
      }
    }
    const move = (e: MouseEvent): void => {
      const [sx, sy] = pos(e)
      const d = this.drag
      if (d) {
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true
        if (!d.moved) return
        if (d.id && this.style === 'constellation') {
          const b = this.bodies[this.bodyIndex.get(d.id)!]
          if (b) {
            ;[b.x, b.y] = this.toWorld(sx, sy)
            this.heat = Math.max(this.heat, 0.3)
          }
        } else {
          this.cam.x = d.cx - (sx - d.sx) / this.cam.k
          this.cam.y = d.cy - (sy - d.sy) / this.cam.k
        }
        return
      }
      const h = this.hit(sx, sy)
      if (h !== this.hover) {
        this.hover = h
        c.style.cursor = h ? 'pointer' : 'grab'
      }
    }
    const up = (e: MouseEvent): void => {
      const d = this.drag
      this.drag = null
      if (!d) return
      if (d.id && this.style === 'constellation') {
        const b = this.bodies[this.bodyIndex.get(d.id)!]
        if (b) b.fixed = false
      }
      if (!d.moved && d.id) this.opts.onClick(d.id, { ctrl: e.ctrlKey || e.metaKey })
    }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const [sx, sy] = pos(e)
      const [wx, wy] = this.toWorld(sx, sy)
      const k = Math.min(4, Math.max(0.12, this.cam.k * Math.exp(-e.deltaY * 0.0015)))
      this.camTarget = null
      // Zoom around the pointer.
      this.cam.k = k
      this.cam.x = wx - (sx - this.width / 2) / k
      this.cam.y = wy - (sy - this.height / 2) / k
    }
    const leave = (): void => {
      this.hover = null
    }
    const dbl = (e: MouseEvent): void => {
      const [sx, sy] = pos(e)
      if (!this.hit(sx, sy)) this.fitted = false
    }
    c.addEventListener('mousedown', down)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('mouseleave', leave)
    c.addEventListener('dblclick', dbl)
    this.disposers.push(() => {
      c.removeEventListener('mousedown', down)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      c.removeEventListener('wheel', wheel)
      c.removeEventListener('mouseleave', leave)
      c.removeEventListener('dblclick', dbl)
    })
    c.style.cursor = 'grab'
  }

  // ---------- drawing ----------

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.frame++ % 30 === 0) this.colours = readColours()
    this.step()
    this.draw()
  }

  private step(): void {
    if (this.style === 'constellation' && this.heat > 0.01) {
      const ticks = this.bodies.length > 600 ? 1 : 2
      for (let i = 0; i < ticks; i++) simulate(this.bodies, this.edgeIndex, this.heat)
      this.heat *= 0.985
      if (!this.fitted && this.heat < 0.45) {
        this.camTarget = this.fitTarget()
        this.fitted = true
      }
    }
    if (this.style === 'neighbourhood') {
      for (const s of this.shown.values()) {
        s.x += (s.tx - s.x) * 0.16
        s.y += (s.ty - s.y) * 0.16
        s.fade = Math.min(1, s.fade + 0.07)
      }
      if (!this.fitted && this.shown.size) {
        this.camTarget = this.fitTarget()
        this.fitted = true
      }
    }
    const t = this.camTarget
    if (t) {
      this.cam.x += (t.x - this.cam.x) * 0.14
      this.cam.y += (t.y - this.cam.y) * 0.14
      this.cam.k += (t.k - this.cam.k) * 0.14
      if (Math.abs(t.k - this.cam.k) < 0.001 && Math.abs(t.x - this.cam.x) < 0.5) this.camTarget = null
    }
  }

  private draw(): void {
    const { ctx } = this
    const c = this.colours
    ctx.clearRect(0, 0, this.width, this.height)
    if (this.style === 'constellation') this.drawConstellation(ctx, c)
    else this.drawNeighbourhood(ctx, c)
  }

  private matches(id: string): boolean {
    return !!this.query && (this.graph?.byId.get(id)?.title.toLowerCase().includes(this.query) ?? false)
  }

  private drawConstellation(ctx: CanvasRenderingContext2D, c: Colours): void {
    for (const s of this.stars) {
      ctx.fillStyle = alpha(c.text.startsWith('#') ? c.text : '#d7d9e0', s.a)
      ctx.fillRect(s.x, s.y, s.r, s.r)
    }
    const graph = this.graph
    if (!graph) return
    const focus = this.hover
    const near = focus ? graph.neighbours.get(focus) : null
    const searching = !!this.query
    const dim = (id: string): boolean => (focus ? id !== focus && !near?.has(id) : searching ? !this.matches(id) : false)

    // Links: faint threads; the hovered note's light up.
    ctx.lineWidth = 1
    for (const [i, j] of this.edgeIndex) {
      const a = this.bodies[i]
      const b = this.bodies[j]
      const lit = focus && (a.id === focus || b.id === focus)
      const [ax, ay] = this.toScreen(a.x, a.y)
      const [bx, by] = this.toScreen(b.x, b.y)
      ctx.strokeStyle = lit ? alpha(c.accent, 0.75) : alpha(c.muted.startsWith('#') ? c.muted : '#9a9caa', focus || searching ? 0.05 : 0.14)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }

    // Notes: glowing dots, bigger the more they're linked.
    const k = this.cam.k
    for (const b of this.bodies) {
      const [x, y] = this.toScreen(b.x, b.y)
      if (x < -40 || y < -40 || x > this.width + 40 || y > this.height + 40) continue
      const r = this.radius(b.id) * Math.max(0.55, Math.min(k, 1.8))
      const col = this.colourOf(b.id)
      const faded = dim(b.id)
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4)
      glow.addColorStop(0, alpha(col, faded ? 0.08 : 0.42))
      glow.addColorStop(1, alpha(col, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, r * 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = faded ? alpha(col, 0.3) : col
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      if (b.id === focus || this.matches(b.id)) {
        ctx.strokeStyle = c.text
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Names: when zoomed in, for well-linked notes, and around the one you're pointing at.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const b of this.bodies) {
      const node = graph.byId.get(b.id)!
      const show = b.id === focus || near?.has(b.id) || this.matches(b.id) || k > 1.15 || (node.degree >= 6 && k > 0.6)
      if (!show) continue
      const [x, y] = this.toScreen(b.x, b.y)
      const r = this.radius(b.id) * Math.max(0.55, Math.min(k, 1.8))
      ctx.font = `${b.id === focus ? 600 : 400} 12px ${getComputedStyle(this.canvas).fontFamily}`
      ctx.fillStyle = b.id === focus ? c.text : dim(b.id) ? alpha(c.faint.startsWith('#') ? c.faint : '#6b6e7d', 0.5) : c.muted
      ctx.fillText(node.title, x, y + r + 5)
    }
  }

  private drawNeighbourhood(ctx: CanvasRenderingContext2D, c: Colours): void {
    const graph = this.graph
    if (!graph || !this.centre) return
    const k = this.cam.k
    const [ox, oy] = this.toScreen(0, 0)
    const hasOuter = [...this.shown.values()].some((s) => s.ring === 2)

    // Ring guides.
    ctx.setLineDash([3, 6])
    ctx.lineWidth = 1
    ctx.strokeStyle = alpha(c.muted.startsWith('#') ? c.muted : '#9a9caa', 0.16)
    for (const r of hasOuter ? [RING_1, RING_2] : [RING_1]) {
      ctx.beginPath()
      ctx.arc(ox, oy, r * k, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Links between the notes on screen; ones touching the hovered note light up.
    const focus = this.hover
    for (const [a, b] of graph.edges) {
      const sa = this.shown.get(a)
      const sb = this.shown.get(b)
      if (!sa || !sb) continue
      if (sa.ring === 2 && sb.ring === 2) continue
      const lit = focus === a || focus === b
      const [ax, ay] = this.toScreen(sa.x, sa.y)
      const [bx, by] = this.toScreen(sb.x, sb.y)
      const fade = Math.min(sa.fade, sb.fade)
      ctx.strokeStyle = lit ? alpha(c.accent, 0.8 * fade) : alpha(c.muted.startsWith('#') ? c.muted : '#9a9caa', (sa.ring === 0 || sb.ring === 0 ? 0.32 : 0.14) * fade)
      ctx.lineWidth = lit ? 2 : sa.ring === 0 || sb.ring === 0 ? 1.4 : 1
      ctx.beginPath()
      // A gentle curve, so the picture feels drawn rather than wired.
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      const bend = 0.12
      ctx.moveTo(ax, ay)
      ctx.quadraticCurveTo(mx - (by - ay) * bend, my + (bx - ax) * bend, bx, by)
      ctx.stroke()
    }

    const font = getComputedStyle(this.canvas).fontFamily
    const order = [...this.shown.values()].sort((a, b) => b.ring - a.ring)
    for (const s of order) {
      const [x, y] = this.toScreen(s.x, s.y)
      const r = this.radius(s.id, s.ring) * Math.max(0.7, Math.min(k, 1.4))
      const col = s.ring === 0 ? c.accent : this.colourOf(s.id)
      const hovered = s.id === focus
      ctx.globalAlpha = s.fade * (s.ring === 2 && !hovered ? 0.75 : 1)
      if (s.ring === 0 || hovered) {
        const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3)
        glow.addColorStop(0, alpha(col, 0.35))
        glow.addColorStop(1, alpha(col, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(x, y, r * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      // Ring notes are hollow with a coloured rim; the centre is solid.
      ctx.fillStyle = s.ring === 0 ? col : c.bg
      ctx.strokeStyle = col
      ctx.lineWidth = s.ring === 0 ? 0 : 2.2
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      if (s.ring !== 0) ctx.stroke()
      if (s.ring !== 0) {
        ctx.fillStyle = alpha(col, hovered ? 0.9 : 0.45)
        ctx.beginPath()
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2)
        ctx.fill()
      }

      // Label: under the centre; outside the ring for the others.
      const title = graph.byId.get(s.id)?.title ?? s.id
      ctx.fillStyle = s.ring === 0 || hovered ? c.text : s.ring === 1 ? c.muted : c.faint
      ctx.font = `${s.ring === 0 ? 600 : hovered ? 600 : 400} ${s.ring === 0 ? 15 : s.ring === 1 ? 12.5 : 11.5}px ${font}`
      if (s.ring === 0) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(title, x, y + r + 10)
        ctx.font = `400 11px ${font}`
        ctx.fillStyle = c.faint
        ctx.fillText(graph.neighbours.get(s.id)?.size ? 'Click to open' : 'No links yet — click to open', x, y + r + 30)
      } else {
        const ang = Math.atan2(s.ty, s.tx)
        const right = Math.cos(ang) >= -0.01
        ctx.textAlign = Math.abs(Math.cos(ang)) < 0.25 ? 'center' : right ? 'left' : 'right'
        ctx.textBaseline = Math.abs(Math.cos(ang)) < 0.25 ? (Math.sin(ang) > 0 ? 'top' : 'bottom') : 'middle'
        const gap = r + 7
        ctx.fillText(title, x + Math.cos(ang) * gap, y + Math.sin(ang) * gap)
      }
      ctx.globalAlpha = 1
    }
  }
}
