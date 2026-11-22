import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Eraser, PenLine, Type, X } from 'lucide-react'
import { rememberSignature, savedSignature } from '../../store/pdfEditor'

const INKS = [
  { name: 'Black', color: '#111318' },
  { name: 'Blue', color: '#1d3fa8' }
]

const FONTS = [
  { name: 'Flowing', css: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive" },
  { name: 'Neat', css: "'Lucida Handwriting', 'Bradley Hand', 'Segoe Print', cursive" },
  { name: 'Bold', css: "'Ink Free', 'Segoe Print', 'Chalkboard SE', 'Comic Sans MS', cursive" }
]

const WIDTH = 560
const HEIGHT = 190

/** Cuts the empty space from around the ink and returns it as a see-through PNG. */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let top = height,
    left = width,
    right = -1,
    bottom = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 16) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  if (right < 0) return null
  const pad = 6
  left = Math.max(0, left - pad)
  top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad)
  bottom = Math.min(height - 1, bottom + pad)
  const out = document.createElement('canvas')
  out.width = right - left + 1
  out.height = bottom - top + 1
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/** Draw your signature with the mouse (or a pen), or type your name in a handwriting font. */
export default function SignaturePad({ onDone, onClose }: { onDone: (png: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [ink, setInk] = useState(INKS[0].color)
  const [name, setName] = useState('')
  const [font, setFont] = useState(FONTS[0].css)
  const [remember, setRemember] = useState(true)
  const [drawn, setDrawn] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const ratio = 2

  const ctx = (): CanvasRenderingContext2D => {
    const c = canvas.current!.getContext('2d')!
    c.setTransform(ratio, 0, 0, ratio, 0, 0)
    return c
  }

  const clear = (): void => {
    const c = canvas.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDrawn(false)
  }

  // Typed: the name is drawn on the canvas in the chosen font.
  useEffect(() => {
    if (mode !== 'type') return
    clear()
    if (!name.trim()) return
    const c = ctx()
    let size = 64
    c.font = `${size}px ${font}`
    while (size > 20 && c.measureText(name).width > WIDTH - 40) {
      size -= 2
      c.font = `${size}px ${font}`
    }
    c.fillStyle = ink
    c.textBaseline = 'middle'
    c.fillText(name, 20, HEIGHT / 2)
    setDrawn(true)
  }, [mode, name, font, ink])

  const point = (e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * WIDTH, y: ((e.clientY - r.top) / r.height) * HEIGHT }
  }

  const down = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (mode !== 'draw') return
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = point(e)
    const c = ctx()
    c.fillStyle = ink
    c.beginPath()
    c.arc(last.current.x, last.current.y, 1.4, 0, Math.PI * 2)
    c.fill()
    setDrawn(true)
  }

  const move = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (!last.current) return
    const c = ctx()
    // A pen pressing harder draws a thicker line; a mouse draws an even one.
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const r = e.currentTarget.getBoundingClientRect()
      const p = { x: ((ev.clientX - r.left) / r.width) * WIDTH, y: ((ev.clientY - r.top) / r.height) * HEIGHT }
      const from = last.current
      c.strokeStyle = ink
      c.lineWidth = 1.6 + pressure * 2.4
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      c.moveTo(from.x, from.y)
      c.quadraticCurveTo(from.x, from.y, (from.x + p.x) / 2, (from.y + p.y) / 2)
      c.lineTo(p.x, p.y)
      c.stroke()
      last.current = p
    }
  }

  const up = (): void => {
    last.current = null
  }

  const done = (): void => {
    const png = canvas.current && trimmed(canvas.current)
    if (!png) return
    rememberSignature(remember ? png : null)
    onDone(png)
  }

  const saved = savedSignature()

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal pdfe-sign" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-pdf-signature-pad>
        <header className="pdfe-sign-head">
          <strong>Your signature</strong>
          <div className="pdfe-seg">
            <button className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')} data-sign-draw>
              <PenLine size={13} /> Draw
            </button>
            <button className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')} data-sign-type>
              <Type size={13} /> Type
            </button>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="pdfe-sign-body">
          {mode === 'type' && (
            <div className="pdfe-sign-typed">
              <input className="text-input" autoFocus placeholder="Type your name" value={name} onChange={(e) => setName(e.target.value)} data-sign-name />
              <div className="pdfe-seg">
                {FONTS.map((f) => (
                  <button key={f.name} className={font === f.css ? 'on' : ''} style={{ fontFamily: f.css }} onClick={() => setFont(f.css)}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="pdfe-sign-paper">
            <canvas
              ref={canvas}
              width={WIDTH * ratio}
              height={HEIGHT * ratio}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className={mode === 'draw' ? 'drawing' : ''}
              data-sign-canvas
            />
            <span className="pdfe-sign-line" />
            {mode === 'draw' && !drawn && <span className="pdfe-sign-hint">Sign here with your mouse, touchpad or pen</span>}
          </div>
          <div className="pdfe-sign-row">
            <span className="pdfe-muted">Ink</span>
            {INKS.map((i) => (
              <button key={i.color} className={`pdfe-ink ${ink === i.color ? 'on' : ''}`} style={{ background: i.color }} title={i.name} onClick={() => setInk(i.color)} />
            ))}
            {mode === 'draw' && (
              <button className="btn" onClick={clear} disabled={!drawn}>
                <Eraser size={13} /> Clear
              </button>
            )}
            <div className="pdfe-spacer" />
            <label className="pdfe-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it on this computer
            </label>
          </div>
        </div>
        <footer className="pdfe-sign-foot">
          {saved && (
            <button className="link-button" onClick={() => onDone(saved)}>
              Use my saved signature
            </button>
          )}
          <div className="pdfe-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!drawn} onClick={done} data-sign-done>
            Put it on the page
          </button>
        </footer>
      </div>
    </div>
  )
}
