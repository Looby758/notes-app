import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Brush, Eraser, PaintBucket, Redo2, Slash, Stamp, Type, Undo2 } from 'lucide-react'
import { isTyping, undoKey } from '../../lib/undo'

/**
 * The map maker: paint land and sea, fill areas, draw roads and borders, stamp mountains, forests,
 * towns and castles, and write place names. Everything is painted onto one picture, which the
 * story map then shows with your pins on top. Ctrl+Z / Ctrl+Y undo and redo strokes here.
 */

export interface MapPicture {
  image: string
  w: number
  h: number
}

type Tool = 'brush' | 'fill' | 'line' | 'stamp' | 'text' | 'eraser'
type StampId = 'mountain' | 'hills' | 'tree' | 'pine' | 'town' | 'house' | 'castle' | 'tower' | 'cave' | 'waves' | 'cross' | 'compass'

const PAPERS = [
  { id: 'parchment', label: 'Parchment', c: '#efe6d2' },
  { id: 'sea', label: 'Sea', c: '#6f9cc9' },
  { id: 'white', label: 'White', c: '#fbfbf8' },
  { id: 'night', label: 'Night', c: '#1d2230' }
]
const COLOURS = [
  '#3b3227', '#6b5a45', '#efe6d2', '#ffffff',
  '#4a7fb5', '#8db8de', '#2e5d8a', '#4f8a4b',
  '#8fb37a', '#2f5e33', '#c8b27a', '#9a6b3f',
  '#b64a3a', '#e08a3c', '#8e8e8e', '#7a5ea8'
]
const STAMPS: { id: StampId; label: string }[] = [
  { id: 'mountain', label: 'Mountain' },
  { id: 'hills', label: 'Hills' },
  { id: 'tree', label: 'Tree' },
  { id: 'pine', label: 'Pine' },
  { id: 'town', label: 'Town' },
  { id: 'house', label: 'House' },
  { id: 'castle', label: 'Castle' },
  { id: 'tower', label: 'Tower' },
  { id: 'cave', label: 'Cave' },
  { id: 'waves', label: 'Waves' },
  { id: 'cross', label: 'X marks the spot' },
  { id: 'compass', label: 'Compass' }
]
const TOOLS: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: 'brush', label: 'Brush', key: 'B', icon: Brush },
  { id: 'fill', label: 'Fill an area', key: 'F', icon: PaintBucket },
  { id: 'line', label: 'Straight line (roads, rivers, borders)', key: 'L', icon: Slash },
  { id: 'stamp', label: 'Stamps (drag to scatter a forest or a range)', key: 'S', icon: Stamp },
  { id: 'text', label: 'Place names', key: 'T', icon: Type },
  { id: 'eraser', label: 'Rubber', key: 'E', icon: Eraser }
]
const MAX_UNDO = 14

/** Draws a stamp centred on x, y, about `s` across, in `c`. */
function drawStamp(g: CanvasRenderingContext2D, id: StampId, x: number, y: number, s: number, c: string, paper: string): void {
  const r = s / 2
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = c
  g.fillStyle = c
  g.lineWidth = Math.max(1.5, s / 16)
  const line = (pts: [number, number][], close = false): void => {
    g.beginPath()
    pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * r, y + py * r) : g.moveTo(x + px * r, y + py * r)))
    if (close) g.closePath()
  }
  switch (id) {
    case 'mountain':
      line([[-1, 0.7], [-0.1, -0.8], [0.9, 0.7]], true)
      g.fillStyle = paper
      g.fill()
      g.stroke()
      g.fillStyle = c
      g.globalAlpha = 0.35
      line([[-0.1, -0.8], [0.9, 0.7], [0.15, 0.7], [0.2, -0.1]], true)
      g.fill()
      g.globalAlpha = 1
      line([[-0.45, -0.15], [-0.25, -0.05], [-0.1, -0.25], [0.05, -0.05], [0.2, -0.2]])
      g.stroke()
      break
    case 'hills':
      g.beginPath()
      g.arc(x - r * 0.35, y + r * 0.5, r * 0.6, Math.PI, 0)
      g.moveTo(x + r * 0.05, y + r * 0.5)
      g.arc(x + r * 0.5, y + r * 0.5, r * 0.45, Math.PI, 0)
      g.stroke()
      break
    case 'tree':
      g.fillRect(x - r * 0.07, y + r * 0.1, r * 0.14, r * 0.7)
      g.beginPath()
      g.arc(x, y - r * 0.2, r * 0.55, 0, Math.PI * 2)
      g.globalAlpha = 0.85
      g.fill()
      g.globalAlpha = 1
      break
    case 'pine':
      g.fillRect(x - r * 0.06, y + r * 0.5, r * 0.12, r * 0.4)
      line([[-0.55, 0.55], [0, -0.9], [0.55, 0.55]], true)
      g.fill()
      break
    case 'town':
      g.beginPath()
      g.arc(x, y, r * 0.32, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.arc(x, y, r * 0.6, 0, Math.PI * 2)
      g.stroke()
      break
    case 'house':
      line([[-0.55, 0.7], [-0.55, -0.05], [0, -0.6], [0.55, -0.05], [0.55, 0.7]], true)
      g.fillStyle = paper
      g.fill()
      g.stroke()
      g.fillStyle = c
      g.fillRect(x - r * 0.15, y + r * 0.25, r * 0.3, r * 0.45)
      break
    case 'castle': {
      g.fillStyle = paper
      g.fillRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 0.9)
      g.strokeRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 0.9)
      g.fillStyle = c
      for (const dx of [-0.8, -0.4, 0, 0.4]) g.fillRect(x + dx * r, y - r * 0.38, r * 0.2, r * 0.18)
      g.fillStyle = paper
      g.fillRect(x - r * 0.25, y - r * 0.75, r * 0.5, r * 0.55)
      g.strokeRect(x - r * 0.25, y - r * 0.75, r * 0.5, r * 0.55)
      g.fillStyle = c
      line([[0, -0.75], [0, -1.05], [0.3, -0.95], [0, -0.85]])
      g.stroke()
      g.beginPath()
      g.arc(x, y + r * 0.7, r * 0.18, Math.PI, 0)
      g.fill()
      break
    }
    case 'tower':
      g.fillStyle = paper
      g.fillRect(x - r * 0.25, y - r * 0.5, r * 0.5, r * 1.2)
      g.strokeRect(x - r * 0.25, y - r * 0.5, r * 0.5, r * 1.2)
      g.fillStyle = c
      line([[-0.35, -0.5], [0, -1], [0.35, -0.5]], true)
      g.fill()
      break
    case 'cave':
      g.beginPath()
      g.moveTo(x - r * 0.8, y + r * 0.6)
      g.quadraticCurveTo(x - r * 0.6, y - r * 0.8, x, y - r * 0.7)
      g.quadraticCurveTo(x + r * 0.6, y - r * 0.8, x + r * 0.8, y + r * 0.6)
      g.stroke()
      g.beginPath()
      g.moveTo(x - r * 0.35, y + r * 0.6)
      g.quadraticCurveTo(x, y - r * 0.4, x + r * 0.35, y + r * 0.6)
      g.closePath()
      g.fill()
      break
    case 'waves':
      for (const dy of [-0.25, 0.25]) {
        g.beginPath()
        g.moveTo(x - r * 0.8, y + dy * r)
        g.quadraticCurveTo(x - r * 0.4, y + (dy - 0.3) * r, x, y + dy * r)
        g.quadraticCurveTo(x + r * 0.4, y + (dy + 0.3) * r, x + r * 0.8, y + dy * r)
        g.stroke()
      }
      break
    case 'cross':
      g.lineWidth = Math.max(3, s / 8)
      line([[-0.5, -0.5], [0.5, 0.5]])
      g.stroke()
      line([[0.5, -0.5], [-0.5, 0.5]])
      g.stroke()
      break
    case 'compass': {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2
        const tip: [number, number] = [Math.cos(a), Math.sin(a)]
        const l: [number, number] = [Math.cos(a - Math.PI / 4) * 0.22, Math.sin(a - Math.PI / 4) * 0.22]
        const rr: [number, number] = [Math.cos(a + Math.PI / 4) * 0.22, Math.sin(a + Math.PI / 4) * 0.22]
        line([l, tip, [0, 0]], true)
        g.fill()
        line([rr, tip, [0, 0]], true)
        g.fillStyle = paper
        g.fill()
        g.stroke()
        g.fillStyle = c
      }
      g.font = `700 ${Math.round(r * 0.45)}px Georgia, serif`
      g.textAlign = 'center'
      g.fillText('N', x, y - r * 1.08)
      break
    }
  }
  g.restore()
}

/** Fills the area of one colour around x, y (with a little give for soft edges). */
function floodFill(g: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number, colour: string, tolerance = 40): void {
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  const at = (x: number, y: number): number => (y * w + x) * 4
  const i0 = at(sx, sy)
  const [r0, g0, b0, a0] = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]]
  const probe = document.createElement('canvas').getContext('2d')!
  probe.fillStyle = colour
  probe.fillRect(0, 0, 1, 1)
  const [r1, g1, b1] = probe.getImageData(0, 0, 1, 1).data
  if (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1) < 6) return
  const same = (i: number): boolean => Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) <= tolerance
  const seen = new Uint8Array(w * h)
  const stack = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    let x = stack.pop()!
    while (x >= 0 && !seen[y * w + x] && same(at(x, y))) x--
    x++
    let up = false
    let down = false
    while (x < w && !seen[y * w + x] && same(at(x, y))) {
      const i = at(x, y)
      seen[y * w + x] = 1
      d[i] = r1
      d[i + 1] = g1
      d[i + 2] = b1
      d[i + 3] = 255
      if (y > 0) {
        const ok = !seen[(y - 1) * w + x] && same(at(x, y - 1))
        if (ok && !up) stack.push(x, y - 1)
        up = ok
      }
      if (y < h - 1) {
        const ok = !seen[(y + 1) * w + x] && same(at(x, y + 1))
        if (ok && !down) stack.push(x, y + 1)
        down = ok
      }
      x++
    }
  }
  g.putImageData(img, 0, 0)
}

export default function MapSketch({ under, onCancel, onDone }: { under: MapPicture | null; onCancel: () => void; onDone: (p: MapPicture) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [colour, setColour] = useState(COLOURS[0])
  const [size, setSize] = useState(10)
  const [opacity, setOpacity] = useState(1)
  const [dashed, setDashed] = useState(false)
  const [stamp, setStamp] = useState<StampId>('mountain')
  const [stampSize, setStampSize] = useState(60)
  const [paper, setPaper] = useState(PAPERS[0].c)
  const [label, setLabel] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const [labelText, setLabelText] = useState('')
  const [fontSize, setFontSize] = useState(36)
  const undo = useRef<ImageData[]>([])
  const redo = useRef<ImageData[]>([])
  const [, bump] = useState(0)
  const w = under?.w ?? 1600
  const h = under?.h ?? 1000
  const [started, setStarted] = useState(!!under)

  const ctx = (): CanvasRenderingContext2D => canvas.current!.getContext('2d', { willReadFrequently: true })!

  useEffect(() => {
    const g = ctx()
    g.fillStyle = PAPERS[0].c
    g.fillRect(0, 0, w, h)
    if (under) {
      const img = new Image()
      img.onload = () => g.drawImage(img, 0, 0, w, h)
      img.src = under.image
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [under, w, h])

  const snapshot = (): void => {
    undo.current = [...undo.current.slice(-(MAX_UNDO - 1)), ctx().getImageData(0, 0, w, h)]
    redo.current = []
    bump((n) => n + 1)
  }
  const step = (from: { current: ImageData[] }, to: { current: ImageData[] }): void => {
    const last = from.current.pop()
    if (!last) return
    to.current.push(ctx().getImageData(0, 0, w, h))
    ctx().putImageData(last, 0, 0)
    bump((n) => n + 1)
  }

  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return
    const which = undoKey(e, navigator.platform.toLowerCase().includes('mac'))
    if (which) {
      e.preventDefault()
      e.stopPropagation()
      if (which === 'undo') step(undo, redo)
      else step(redo, undo)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
    if (t) setTool(t.id)
    if (e.key === '[') setSize((s) => Math.max(1, s - 2))
    if (e.key === ']') setSize((s) => Math.min(120, s + 2))
  }
  useEffect(() => {
    const on = (e: KeyboardEvent): void => keys.current(e)
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [])

  const toCanvas = (ev: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [((ev.clientX - r.left) / r.width) * w, ((ev.clientY - r.top) / r.height) * h]
  }
  const screenScale = (): number => w / canvas.current!.getBoundingClientRect().width

  /** The colour already on the map at a point, so a stamp on land is filled like the land. */
  const groundAt = (x: number, y: number): string => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x)))
    const py = Math.min(h - 1, Math.max(0, Math.floor(y)))
    const [r, g, b] = ctx().getImageData(px, py, 1, 1).data
    return `rgb(${r},${g},${b})`
  }

  const clearOverlay = (): void => overlay.current!.getContext('2d')!.clearRect(0, 0, w, h)

  const preview = (ev: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (ev.buttons) return
    const o = overlay.current!.getContext('2d')!
    o.clearRect(0, 0, w, h)
    const [x, y] = toCanvas(ev)
    if (tool === 'stamp') {
      o.globalAlpha = 0.5
      drawStamp(o, stamp, x, y, stampSize, colour, groundAt(x, y))
      o.globalAlpha = 1
    } else if (tool === 'brush' || tool === 'eraser' || tool === 'line') {
      o.beginPath()
      o.arc(x, y, (tool === 'eraser' ? size * 2 : size) / 2, 0, Math.PI * 2)
      o.strokeStyle = 'rgba(0,0,0,0.5)'
      o.lineWidth = 1.5 * screenScale()
      o.stroke()
    }
  }

  const down = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const c = canvas.current!
    const g = ctx()
    const [sx, sy] = toCanvas(e)
    if (tool === 'text') {
      // Keep the click from taking focus away from the name box as it opens.
      e.preventDefault()
      const r = c.getBoundingClientRect()
      setLabel({ x: sx, y: sy, sx: e.clientX - r.left, sy: e.clientY - r.top })
      setLabelText('')
      return
    }
    c.setPointerCapture(e.pointerId)
    snapshot()
    setStarted(true)
    if (tool === 'fill') {
      floodFill(g, w, h, Math.floor(sx), Math.floor(sy), colour)
      return
    }
    if (tool === 'stamp') {
      drawStamp(g, stamp, sx, sy, stampSize, colour, groundAt(sx, sy))
      let [lx, ly] = [sx, sy]
      const move = (ev: PointerEvent): void => {
        const [x, y] = toCanvas(ev)
        // Dragging scatters them: a forest, a mountain range.
        if (Math.hypot(x - lx, y - ly) < stampSize * 0.75) return
        const jx = (Math.random() - 0.5) * stampSize * 0.35
        const jy = (Math.random() - 0.5) * stampSize * 0.35
        drawStamp(g, stamp, x + jx, y + jy, stampSize * (0.85 + Math.random() * 0.3), colour, groundAt(x + jx, y + jy))
        ;[lx, ly] = [x, y]
      }
      const up = (): void => {
        c.removeEventListener('pointermove', move)
        c.removeEventListener('pointerup', up)
      }
      c.addEventListener('pointermove', move)
      c.addEventListener('pointerup', up)
      return
    }
    const stroke = (o: CanvasRenderingContext2D): void => {
      o.lineCap = 'round'
      o.lineJoin = 'round'
      o.strokeStyle = tool === 'eraser' ? paper : colour
      o.fillStyle = o.strokeStyle
      o.lineWidth = tool === 'eraser' ? size * 2 : size
      o.globalAlpha = tool === 'eraser' ? 1 : opacity
      o.setLineDash(tool === 'line' && dashed ? [size * 2.2, size * 1.6] : [])
    }
    if (tool === 'line') {
      const o = overlay.current!.getContext('2d')!
      let end: [number, number] = [sx, sy]
      const move = (ev: PointerEvent): void => {
        end = toCanvas(ev)
        o.clearRect(0, 0, w, h)
        stroke(o)
        o.beginPath()
        o.moveTo(sx, sy)
        o.lineTo(end[0], end[1])
        o.stroke()
      }
      const up = (): void => {
        c.removeEventListener('pointermove', move)
        c.removeEventListener('pointerup', up)
        clearOverlay()
        g.save()
        stroke(g)
        g.beginPath()
        g.moveTo(sx, sy)
        g.lineTo(end[0], end[1])
        g.stroke()
        g.restore()
      }
      c.addEventListener('pointermove', move)
      c.addEventListener('pointerup', up)
      return
    }
    // Brush and rubber: drawn on the overlay as one stroke, then laid down at once, so
    // see-through paint doesn't darken where the stroke crosses itself.
    const o = overlay.current!.getContext('2d')!
    o.clearRect(0, 0, w, h)
    const pts: [number, number][] = [[sx, sy]]
    const redraw = (): void => {
      o.clearRect(0, 0, w, h)
      o.save()
      stroke(o)
      o.globalAlpha = 1
      o.beginPath()
      o.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2
        const my = (pts[i][1] + pts[i + 1][1]) / 2
        o.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
      }
      const last = pts[pts.length - 1]
      if (pts.length === 1) o.lineTo(last[0] + 0.01, last[1])
      else o.lineTo(last[0], last[1])
      o.stroke()
      o.restore()
    }
    overlay.current!.style.opacity = String(tool === 'eraser' ? 1 : opacity)
    redraw()
    const move = (ev: PointerEvent): void => {
      for (const ce of ev.getCoalescedEvents?.() ?? [ev]) pts.push(toCanvas(ce))
      redraw()
    }
    const up = (): void => {
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      g.save()
      g.globalAlpha = tool === 'eraser' ? 1 : opacity
      g.drawImage(overlay.current!, 0, 0)
      g.restore()
      clearOverlay()
      overlay.current!.style.opacity = '1'
    }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
  }

  const placeLabel = (): void => {
    const text = labelText.trim()
    if (label && text) {
      snapshot()
      setStarted(true)
      const g = ctx()
      g.save()
      g.font = `italic 600 ${fontSize}px 'Iowan Old Style', Palatino, Georgia, serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineWidth = Math.max(3, fontSize / 6)
      g.strokeStyle = groundAt(label.x, label.y)
      g.globalAlpha = 0.85
      g.strokeText(text, label.x, label.y)
      g.globalAlpha = 1
      g.fillStyle = colour
      g.fillText(text, label.x, label.y)
      g.restore()
    }
    setLabel(null)
    setLabelText('')
  }

  const newPaper = (c: string): void => {
    snapshot()
    setPaper(c)
    const g = ctx()
    g.fillStyle = c
    g.fillRect(0, 0, w, h)
  }

  return (
    <div className="ws-sketch" data-ws-sketch>
      <div className="ws-sketch-tools">
        <div className="ws-sketch-group">
          {TOOLS.map((t) => (
            <button key={t.id} className={`ws-size ${tool === t.id ? 'on' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} data-ws-map-tool={t.id}>
              <t.icon size={16} />
            </button>
          ))}
        </div>
        <span className="ws-tool-sep" />
        <div className="ws-sketch-group ws-palette">
          {COLOURS.map((c) => (
            <button key={c} className={`ws-swatch ${colour === c ? 'on' : ''}`} style={{ '--c': c } as CSSProperties} onClick={() => setColour(c)} title={c} />
          ))}
          <label className="ws-swatch ws-swatch-custom" title="Any colour" style={{ '--c': colour } as CSSProperties}>
            <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} />
          </label>
        </div>
        <span className="ws-sketch-grow" />
        <button className="icon-btn" onClick={() => step(undo, redo)} disabled={!undo.current.length} title="Undo (Ctrl+Z)">
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" onClick={() => step(redo, undo)} disabled={!redo.current.length} title="Redo (Ctrl+Y)">
          <Redo2 size={15} />
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const c = canvas.current!
            let image = c.toDataURL('image/webp', 0.9)
            if (!image.startsWith('data:image/webp')) image = c.toDataURL('image/png')
            onDone({ image, w, h })
          }}
          data-ws-sketch-done
        >
          Use this map
        </button>
      </div>

      <div className="ws-sketch-options" key={tool}>
        {(tool === 'brush' || tool === 'eraser' || tool === 'line') && (
          <label className="ws-slider">
            Size <input type="range" min={1} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} /> <b>{size}</b>
          </label>
        )}
        {(tool === 'brush' || tool === 'line') && (
          <label className="ws-slider">
            See-through <input type="range" min={10} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} /> <b>{Math.round(opacity * 100)}%</b>
          </label>
        )}
        {tool === 'line' && (
          <label className="ws-toggle">
            <input type="checkbox" checked={dashed} onChange={(e) => setDashed(e.target.checked)} />
            <span className="ws-toggle-box">✓</span>
            Dashed (roads, borders)
          </label>
        )}
        {tool === 'fill' && <span className="ws-hint">Click inside an area to fill it: paint a coastline with the brush, then fill the land.</span>}
        {tool === 'stamp' && (
          <>
            <div className="ws-stamps">
              {STAMPS.map((s) => (
                <StampButton key={s.id} id={s.id} label={s.label} on={stamp === s.id} colour={colour} paper={paper} onPick={() => setStamp(s.id)} />
              ))}
            </div>
            <label className="ws-slider">
              Size <input type="range" min={16} max={220} value={stampSize} onChange={(e) => setStampSize(Number(e.target.value))} /> <b>{stampSize}</b>
            </label>
            <span className="ws-hint">Drag to scatter a forest or a mountain range.</span>
          </>
        )}
        {tool === 'text' && (
          <>
            <label className="ws-slider">
              Size <input type="range" min={14} max={140} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /> <b>{fontSize}</b>
            </label>
            <span className="ws-hint">Click where the name goes, type it, then press Enter.</span>
          </>
        )}
        <span className="ws-sketch-grow" />
        {!started && (
          <div className="ws-papers">
            <span className="ws-hint">Start on</span>
            {PAPERS.map((p) => (
              <button key={p.id} className={`ws-paper ${paper === p.c ? 'on' : ''}`} style={{ '--c': p.c } as CSSProperties} onClick={() => newPaper(p.c)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ws-sketch-stage">
        <div className="ws-sketch-paper" style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(100cqh * ${(w / h).toFixed(4)}))` }}>
          <canvas ref={canvas} width={w} height={h} className={`ws-sketch-main tool-${tool}`} onPointerDown={down} onPointerMove={preview} onPointerLeave={clearOverlay} />
          <canvas ref={overlay} width={w} height={h} className="ws-sketch-overlay" />
          {label && (
            <input
              className="ws-map-label-input"
              autoFocus
              value={labelText}
              placeholder="Place name"
              style={{ left: label.sx, top: label.sy, color: colour }}
              onChange={(e) => setLabelText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') placeLabel()
                if (e.key === 'Escape') setLabel(null)
              }}
              onBlur={placeLabel}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StampButton({ id, label, on, colour, paper, onPick }: { id: StampId; label: string; on: boolean; colour: string; paper: string; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current!.getContext('2d')!
    g.clearRect(0, 0, 64, 64)
    drawStamp(g, id, 32, 34, 40, colour, paper)
  }, [id, colour, paper])
  return (
    <button className={`ws-stamp ${on ? 'on' : ''}`} onClick={onPick} title={label} data-ws-stamp={id}>
      <canvas ref={ref} width={64} height={64} style={{ background: paper }} />
    </button>
  )
}
