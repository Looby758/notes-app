import { Fragment, useRef, type PointerEvent } from 'react'
import { useEditor, type LayoutNode } from '../../store/editor'
import { resizeSplit } from '../../lib/layout'
import { setLayout } from '../../lib/editorController'
import Pane from './Pane'

/** Smallest a pane can be dragged to. */
const MIN_PANE_PX = 160

/** The editor area: draws the layout tree of splits and panes. */
export default function EditorArea() {
  const layout = useEditor((s) => s.layout)
  return (
    <main className="editor-area">
      <LayoutView node={layout} />
    </main>
  )
}

function LayoutView({ node }: { node: LayoutNode }) {
  if (node.type === 'pane') return <Pane key={node.id} pane={node.id} />
  return <SplitView node={node} />
}

function SplitView({ node }: { node: Extract<LayoutNode, { type: 'split' }> }) {
  const container = useRef<HTMLDivElement>(null)
  const horizontal = node.dir === 'row'

  /** Dragging the divider after child `i` trades space between child i and i+1. */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>, i: number): void => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const rect = container.current!.getBoundingClientRect()
    const total = horizontal ? rect.width : rect.height
    const start = horizontal ? e.clientX : e.clientY
    const startSizes = [...node.sizes]
    const pair = startSizes[i] + startSizes[i + 1]
    const min = Math.min(MIN_PANE_PX / total, pair / 2)
    document.body.classList.add(horizontal ? 'resizing' : 'resizing-rows')

    const onMove = (ev: globalThis.PointerEvent): void => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) / total
      const a = Math.min(pair - min, Math.max(min, startSizes[i] + delta))
      const sizes = [...startSizes]
      sizes[i] = a
      sizes[i + 1] = pair - a
      setLayout(resizeSplit(useEditor.getState().layout, node.id, sizes))
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
  const onDoubleClick = (): void => {
    setLayout(resizeSplit(useEditor.getState().layout, node.id, node.children.map(() => 1)))
  }

  return (
    <div ref={container} className={`split ${node.dir}`}>
      {node.children.map((child, i) => (
        <Fragment key={child.type === 'pane' ? child.id : child.id}>
          {i > 0 && (
            <div
              className={`divider ${node.dir}`}
              onPointerDown={(e) => onPointerDown(e, i - 1)}
              onDoubleClick={onDoubleClick}
              title="Drag to resize · double-click to even out"
            />
          )}
          <div className="split-child" style={{ flexGrow: node.sizes[i] }}>
            <LayoutView node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
