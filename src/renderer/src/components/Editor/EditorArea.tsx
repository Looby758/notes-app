import { useRef, type PointerEvent } from 'react'
import { useEditor, type LayoutNode } from '../../store/editor'
import { resizeSplit } from '../../lib/layout'
import { setLayout } from '../../lib/editorController'
import Pane from './Pane'

/** Smallest a pane can be dragged to. */
const MIN_PANE_PX = 160

/** A part of the editor area, as fractions of it (0–1). */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface DividerBox {
  key: string
  split: Extract<LayoutNode, { type: 'split' }>
  /** The divider sits after this child of the split. */
  index: number
  /** The whole split's box, and where the line is along it. */
  box: Box
  at: number
}

/** Where each pane and divider goes, worked out from the layout tree of splits and panes. */
function measure(node: LayoutNode, box: Box, panes: Map<string, Box>, dividers: DividerBox[]): void {
  if (node.type === 'pane') {
    panes.set(node.id, box)
    return
  }
  const row = node.dir === 'row'
  const total = node.sizes.reduce((a, b) => a + b, 0) || 1
  let start = 0
  node.children.forEach((child, i) => {
    const part = node.sizes[i] / total
    if (i > 0) dividers.push({ key: `${node.id}:${i}`, split: node, index: i - 1, box, at: start })
    const childBox = row ? { x: box.x + start * box.w, y: box.y, w: part * box.w, h: box.h } : { x: box.x, y: box.y + start * box.h, w: box.w, h: part * box.h }
    measure(child, childBox, panes, dividers)
    start += part
  })
}

const pct = (n: number): string => `${n * 100}%`

/**
 * The editor area: lays out the panes and the dividers between them. Every pane is drawn side by
 * side in this one place, whatever the layout tree looks like, so splitting or closing a pane never
 * takes the others apart and puts them back (that would reload a web page showing in one).
 */
export default function EditorArea() {
  const layout = useEditor((s) => s.layout)
  const area = useRef<HTMLElement>(null)
  // Panes keep the order they first appeared in: moving a web page around in the page reloads it.
  const order = useRef<string[]>([])

  const panes = new Map<string, Box>()
  const dividers: DividerBox[] = []
  measure(layout, { x: 0, y: 0, w: 1, h: 1 }, panes, dividers)
  order.current = [...order.current.filter((id) => panes.has(id)), ...[...panes.keys()].filter((id) => !order.current.includes(id))]

  /** Dragging the divider after child `i` trades space between child i and i+1. */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>, d: DividerBox): void => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const horizontal = d.split.dir === 'row'
    const rect = area.current!.getBoundingClientRect()
    const total = horizontal ? rect.width * d.box.w : rect.height * d.box.h
    const start = horizontal ? e.clientX : e.clientY
    const sum = d.split.sizes.reduce((a, b) => a + b, 0) || 1
    const startSizes = d.split.sizes.map((s) => s / sum)
    const i = d.index
    const pair = startSizes[i] + startSizes[i + 1]
    const min = Math.min(MIN_PANE_PX / total, pair / 2)
    document.body.classList.add(horizontal ? 'resizing' : 'resizing-rows')

    const onMove = (ev: globalThis.PointerEvent): void => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) / total
      const a = Math.min(pair - min, Math.max(min, startSizes[i] + delta))
      const sizes = [...startSizes]
      sizes[i] = a
      sizes[i + 1] = pair - a
      setLayout(resizeSplit(useEditor.getState().layout, d.split.id, sizes))
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing', 'resizing-rows')
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  // Double-click a divider to even out the panes in that split.
  const onDoubleClick = (d: DividerBox): void => {
    setLayout(resizeSplit(useEditor.getState().layout, d.split.id, d.split.children.map(() => 1)))
  }

  return (
    <main ref={area} className="editor-area">
      {order.current.map((id) => {
        const b = panes.get(id)!
        return (
          <div key={id} className="split-child" style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}>
            <Pane pane={id} />
          </div>
        )
      })}
      {dividers.map((d) => {
        const { box, at } = d
        const style =
          d.split.dir === 'row'
            ? { left: pct(box.x + at * box.w), top: pct(box.y), height: pct(box.h) }
            : { left: pct(box.x), top: pct(box.y + at * box.h), width: pct(box.w) }
        return (
          <div
            key={d.key}
            className={`divider ${d.split.dir}`}
            style={style}
            onPointerDown={(e) => onPointerDown(e, d)}
            onDoubleClick={() => onDoubleClick(d)}
            title="Drag to resize · double-click to even out"
          />
        )
      })}
    </main>
  )
}
