import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { TEXT_SIZE, type Stamp } from '../../lib/pdfEdit'
import { drawPage, fieldBoxes, pageSize, type FieldBox } from '../../lib/pdfView'
import { checkpoint, fieldValue, removeStamp, setFieldValue, updateStamp, usePdfEditor } from '../../store/pdfEditor'

/** How wide a line of text is, as a share of the page's width (PDFs use Helvetica, which Arial matches). */
export function textWidth(text: string, h: number, shown: { width: number; height: number }): number {
  const ctx = document.createElement('canvas').getContext('2d')!
  const size = h * shown.height * TEXT_SIZE
  ctx.font = `${size}px Helvetica, Arial, sans-serif`
  return Math.min(1, (ctx.measureText(text || ' ').width + size * 0.3) / shown.width)
}

/**
 * One page, big: drawn by pdf.js, with its form boxes to type in and the signatures and text
 * you've put on it, which can be dragged about and resized.
 */
export default function PageView({ pageKey, editing, onEditing }: { pageKey: string; editing: string | null; onEditing: (id: string | null) => void }) {
  const page = usePdfEditor((s) => s.pages.find((p) => p.key === pageKey))
  const hasFields = usePdfEditor((s) => !!page && (s.fields[page.source]?.length ?? 0) > 0)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [shown, setShown] = useState<{ width: number; height: number } | null>(null)
  const [boxes, setBoxes] = useState<FieldBox[]>([])
  const [drawing, setDrawing] = useState(true)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const fit = (): void => setWidth(Math.max(240, Math.min(el.clientWidth - 48, 900)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const source = page?.source
  const index = page?.index ?? 0
  const turn = page?.turn ?? 0

  useEffect(() => {
    if (!source || !width || !canvas.current) return
    let cancelled = false
    setDrawing(true)
    void pageSize(source, index, turn).then((s) => !cancelled && setShown(s))
    void drawPage(canvas.current, source, index, turn, width)
      .catch(() => undefined)
      .finally(() => !cancelled && setDrawing(false))
    if (hasFields) void fieldBoxes(source, index, turn, width).then((b) => !cancelled && setBoxes(b))
    else setBoxes([])
    return () => {
      cancelled = true
    }
  }, [source, index, turn, width, hasFields])

  if (!page) return null
  const height = shown ? (shown.height / shown.width) * width : width * 1.3

  return (
    <div className="pdfe-view" ref={host} data-pdf-page-view>
      <div className="pdfe-sheet" style={{ width, height }} onPointerDown={() => onEditing(null)}>
        <canvas ref={canvas} />
        {drawing && (
          <span className="pdfe-sheet-loading">
            <Loader2 size={18} className="spin" />
          </span>
        )}
        {boxes.map((b) => (
          <FormBox key={b.id} box={b} source={page.source} scale={shown ? width / shown.width : 1} />
        ))}
        {shown &&
          page.stamps.map((s) => (
            <StampBox key={s.id} stamp={s} pageKey={page.key} width={width} height={height} shown={shown} editing={editing === s.id} onEditing={onEditing} />
          ))}
      </div>
    </div>
  )
}

function FormBox({ box, source, scale }: { box: FieldBox; source: string; scale: number }) {
  const value = usePdfEditor((s) => fieldValue(s, source, box.name))
  // The same sizes the saved PDF uses (lib/pdfEdit fillForm), in points turned into pixels.
  const points = box.multiline ? Math.min(11, Math.max(7, box.height / scale / 4)) : Math.min(12, Math.max(7, (box.height / scale) * 0.62))
  const style = { left: box.left, top: box.top, width: box.width, height: box.height, fontSize: Math.max(9, points * scale) }
  const title = box.readOnly ? 'This box can’t be changed' : box.name
  const set = (v: string | boolean): void => setFieldValue(source, box.name, v)
  if (box.kind === 'check' || box.kind === 'radio') {
    const on = box.kind === 'check' ? value === true : value === box.onValue
    return (
      <button
        className={`pdfe-field pdfe-tick ${box.kind} ${on ? 'on' : ''}`}
        style={style}
        title={title}
        disabled={box.readOnly}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => set(box.kind === 'check' ? !on : on ? '' : box.onValue ?? '')}
        data-pdf-field={box.name}
      >
        {on && (box.kind === 'check' ? <Check size={Math.max(8, box.height * 0.8)} strokeWidth={3} /> : <span className="pdfe-dot" />)}
      </button>
    )
  }
  if (box.kind === 'choice')
    return (
      <select className="pdfe-field" style={style} title={title} disabled={box.readOnly} value={String(value)} onChange={(e) => set(e.target.value)} onPointerDown={(e) => e.stopPropagation()} data-pdf-field={box.name}>
        <option value="" />
        {box.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  if (box.multiline)
    return <textarea className="pdfe-field" style={style} title={title} disabled={box.readOnly} value={String(value)} onChange={(e) => set(e.target.value)} onPointerDown={(e) => e.stopPropagation()} data-pdf-field={box.name} />
  return <input className="pdfe-field" style={style} title={title} disabled={box.readOnly} value={String(value)} onChange={(e) => set(e.target.value)} onPointerDown={(e) => e.stopPropagation()} data-pdf-field={box.name} />
}

function StampBox({
  stamp,
  pageKey,
  width,
  height,
  shown,
  editing,
  onEditing
}: {
  stamp: Stamp
  pageKey: string
  width: number
  height: number
  shown: { width: number; height: number }
  editing: boolean
  onEditing: (id: string | null) => void
}) {
  const [text, setText] = useState(stamp.text ?? '')
  useEffect(() => setText(stamp.text ?? ''), [stamp.text])

  const drag = (e: ReactPointerEvent, how: 'move' | 'resize'): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, s: { ...stamp } }
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - start.x) / width
      const dy = (ev.clientY - start.y) / height
      if (!moved) {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return
        moved = true
        checkpoint()
      }
      if (how === 'move') {
        const x = Math.min(1 - start.s.w, Math.max(0, start.s.x + dx))
        const y = Math.min(1 - start.s.h, Math.max(0, start.s.y + dy))
        updateStamp(pageKey, stamp.id, { x, y }, true)
      } else {
        // Keeps its shape: the corner follows the pointer across.
        const w = Math.max(0.03, Math.min(1 - start.s.x, start.s.w + dx))
        const scale = w / start.s.w
        const h = Math.min(1 - start.s.y, start.s.h * scale)
        updateStamp(pageKey, stamp.id, { w: (h / start.s.h) * start.s.w, h }, true)
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved && stamp.kind === 'text') onEditing(stamp.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const commit = (): void => {
    onEditing(null)
    const t = text.trim()
    if (!t) return removeStamp(pageKey, stamp.id)
    if (t !== stamp.text) updateStamp(pageKey, stamp.id, { text: t, w: textWidth(t, stamp.h, shown) })
  }

  const px = { left: stamp.x * width, top: stamp.y * height, width: stamp.w * width, height: stamp.h * height }
  // While typing, the box grows with the words.
  if (editing) px.width = Math.max(px.width, textWidth(text, stamp.h, shown) * width)
  const fontSize = px.height * TEXT_SIZE
  return (
    <div className={`pdfe-stamp ${stamp.kind} ${editing ? 'editing' : ''}`} style={px} onPointerDown={(e) => !editing && drag(e, 'move')} data-pdf-stamp={stamp.kind}>
      {stamp.kind === 'image' ? (
        <img src={stamp.image} alt="Signature" draggable={false} />
      ) : editing ? (
        <input
          autoFocus
          value={text}
          style={{ fontSize, height: px.height }}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setText(stamp.text ?? '')
              onEditing(null)
            }
          }}
        />
      ) : (
        <span style={{ fontSize, lineHeight: `${px.height}px` }}>{stamp.text}</span>
      )}
      {!editing && (
        <>
          <button
            className="pdfe-stamp-x"
            title="Take it off"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              removeStamp(pageKey, stamp.id)
            }}
          >
            <X size={11} />
          </button>
          <span className="pdfe-stamp-size" title="Drag to make it bigger or smaller" onPointerDown={(e) => drag(e, 'resize')} />
        </>
      )}
    </div>
  )
}
