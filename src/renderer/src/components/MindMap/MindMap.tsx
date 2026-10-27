import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { Maximize, PenLine, Sparkles } from 'lucide-react'
import { useVault } from '../../store/vault'
import { toggleMindMap } from '../../store/ui'
import { extractHeadings } from '../../lib/outline'
import { allNodes, buildMindTree, placeMindMap, type Point } from '../../lib/mindmap'
import { jumpTo, noteTextNow, onNoteEdited } from '../../lib/editorController'
import { noteTitle } from '../../lib/paths'

/** One colour per main branch, picked to read on both dark and light themes. */
const BRANCH_COLOURS = ['#5ea8ff', '#4ade80', '#f472b6', '#e0a458', '#a78bfa', '#3ccfcf', '#f97066', '#a3e635']

interface View {
  x: number
  y: number
  scale: number
}

/** Where you've moved bubbles to, per note, on this computer. */
const storageKey = (path: string): string => `mindmap:${useVault.getState().vault}:${path}`

function loadOffsets(path: string): Record<string, Point> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(path)) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveOffsets(path: string, offsets: Record<string, Point>): void {
  try {
    if (Object.keys(offsets).length) localStorage.setItem(storageKey(path), JSON.stringify(offsets))
    else localStorage.removeItem(storageKey(path))
  } catch {
    // not fatal: the map just goes back to its tidy layout next time
  }
}

/**
 * A note's headings as a mind map, in place of its text. Drag bubbles to arrange them (a branch
 * moves together), drag the background to look around, scroll to zoom, and double-click a bubble
 * to go to that part of the note.
 */
export default function MindMap({ pane, path }: { pane: string; path: string }) {
  const [text, setText] = useState(() => noteTextNow(path) ?? '')
  const [offsets, setOffsets] = useState(() => loadOffsets(path))
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fitted = useRef(false)

  // Follow edits (from another pane showing this note, or the file changing on disk).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onNoteEdited((p) => {
      if (p !== path) return
      clearTimeout(timer)
      timer = setTimeout(() => setText(noteTextNow(path) ?? ''), 150)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [path])

  const root = useMemo(() => buildMindTree(noteTitle(path), extractHeadings(text)), [path, text])
  const nodes = useMemo(() => allNodes(root), [root])
  const at = useMemo(() => placeMindMap(root, offsets), [root, offsets])

  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    const ps = [...at.values()]
    // Bubbles are up to ~200 wide and ~40 tall around their centre.
    const minX = Math.min(...ps.map((p) => p.x)) - 110
    const maxX = Math.max(...ps.map((p) => p.x)) + 110
    const minY = Math.min(...ps.map((p) => p.y)) - 30
    const maxY = Math.max(...ps.map((p) => p.y)) + 30
    const scale = Math.max(0.3, Math.min(1.2, box.width / (maxX - minX), box.height / (maxY - minY)))
    setView({
      scale,
      x: box.width / 2 - ((minX + maxX) / 2) * scale,
      y: box.height / 2 - ((minY + maxY) / 2) * scale
    })
  }, [at])

  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    fit()
  }, [fit])

  /** Drags the background (to look around) or a bubble (to move it and its branch). */
  const startDrag = (e: PointerEvent, id: string | null): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startView = view
    const start = offsets[id ?? ''] ?? { x: 0, y: 0 }
    let latest = offsets
    let moved = false
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      if (id === null) {
        setView({ ...startView, x: startView.x + dx, y: startView.y + dy })
      } else {
        setDragging(id)
        latest = { ...latest, [id]: { x: start.x + dx / startView.scale, y: start.y + dy / startView.scale } }
        setOffsets(latest)
      }
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      setDragging(null)
      if (id !== null && moved) saveOffsets(path, latest)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const onWheel = (e: WheelEvent): void => {
    const box = stage.current!.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    setView((v) => {
      const scale = Math.max(0.25, Math.min(2.5, v.scale * Math.exp(-e.deltaY * 0.0015)))
      // Zoom around the pointer, so what's under it stays put.
      return { scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale }
    })
  }

  const goTo = (from: number | null): void => {
    toggleMindMap(pane, path, false)
    if (from !== null) requestAnimationFrame(() => jumpTo(from))
  }

  const tidy = (): void => {
    setOffsets({})
    saveOffsets(path, {})
  }

  const colour = (branch: number): string => (branch < 0 ? 'var(--accent)' : BRANCH_COLOURS[branch % BRANCH_COLOURS.length])
  const headingCount = nodes.length - (root.from === null ? 1 : 0)

  return (
    <div className="mindmap-page">
      <div className="cal-toolbar mindmap-toolbar">
        <button className="btn" onClick={() => goTo(null)} title="Show the note's text again">
          <PenLine size={14} /> Back to writing
        </button>
        <span className="graph-spacer" />
        <span className="graph-count">
          {headingCount} {headingCount === 1 ? 'heading' : 'headings'}
        </span>
        <button className="btn" onClick={tidy} disabled={Object.keys(offsets).length === 0} title="Put every bubble back in its tidy spot">
          <Sparkles size={14} /> Tidy up
        </button>
        <button className="btn" onClick={fit} title="Fit the whole map on screen">
          <Maximize size={14} /> Fit
        </button>
      </div>
      <div ref={stage} className={`mindmap-stage ${dragging ? 'dragging' : ''}`} onPointerDown={(e) => startDrag(e, null)} onWheel={onWheel}>
        <div className="mindmap-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="mindmap-lines" width="1" height="1" aria-hidden>
            {nodes.flatMap((n) =>
              n.children.map((c) => {
                const a = at.get(n.id)!
                const b = at.get(c.id)!
                const mx = (a.x + b.x) / 2
                return <path key={c.id} d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`} stroke={colour(c.branch)} strokeWidth={Math.max(1.5, 4 - c.depth)} />
              })
            )}
          </svg>
          {nodes.map((n) => {
            const p = at.get(n.id)!
            return (
              <div
                key={n.id}
                className={`mindmap-node depth-${Math.min(n.depth, 3)} ${dragging === n.id ? 'dragging' : ''}`}
                style={{ left: p.x, top: p.y, ['--branch' as string]: colour(n.branch) }}
                title={n.from !== null ? `${n.text}\nDouble-click to go here in the note` : n.text}
                onPointerDown={(e) => startDrag(e, n.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  goTo(n.from)
                }}
              >
                {n.text}
              </div>
            )
          })}
        </div>
        {root.children.length === 0 && (
          <div className="graph-empty mindmap-empty">
            <p>
              This note has no headings yet. Lines that start with <code>#</code>, <code>##</code> or <code>###</code> become bubbles here.
            </p>
          </div>
        )}
        <div className="graph-hint">Drag bubbles to arrange · drag the background to move around · scroll to zoom · double-click a bubble to go there</div>
      </div>
    </div>
  )
}
