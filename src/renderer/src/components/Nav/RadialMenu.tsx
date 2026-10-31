import './nav.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { featuresFor, type Feature } from '../../lib/features'
import { radialIndexAt, radialPoint } from '../../lib/radial'

const HOLD_MS = 220
const MOVE_LIMIT = 8
const RADIUS = 96
const DEAD_ZONE = 30

// Where middle-click already means something (panning a board) or the page has its own mouse.
const SKIP = '.canvas-board, webview, .xterm, [data-no-radial]'

let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }

/** Opens the radial menu at the pointer (or the middle of the window), e.g. from a shortcut. */
export function openRadial(): void {
  useUI.setState({ radial: { ...lastPointer } })
}

/**
 * The radial menu: hold the middle mouse button and a ring of your favourite features appears
 * around the pointer. Flick toward one and let go to open it. A quick middle-click still does
 * what it always did (open in a new tab, close a tab).
 */
export default function RadialMenu() {
  const enabled = usePrefs((s) => s.prefs.radialMiddleClick)
  const at = useUI((s) => s.radial)

  // Watch for a held middle button.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      lastPointer = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    if (!enabled) return () => window.removeEventListener('mousemove', onMove)
    let timer: number | undefined
    let start = { x: 0, y: 0 }
    const cancel = (): void => {
      window.clearTimeout(timer)
      timer = undefined
    }
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 1 || useUI.getState().radial) return
      if ((e.target as Element | null)?.closest?.(SKIP)) return
      start = { x: e.clientX, y: e.clientY }
      cancel()
      timer = window.setTimeout(() => {
        timer = undefined
        heldOpen = true
        useUI.setState({ radial: start })
      }, HOLD_MS)
    }
    const onDrag = (e: MouseEvent): void => {
      if (timer !== undefined && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_LIMIT) cancel()
    }
    const onUp = (e: MouseEvent): void => {
      if (e.button === 1) cancel()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onDrag, { passive: true })
    window.addEventListener('mouseup', onUp, true)
    return () => {
      cancel()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onDrag)
      window.removeEventListener('mouseup', onUp, true)
    }
  }, [enabled])

  if (!at) return null
  return <Ring at={at} />
}

/** Whether the ring was opened by holding the button (so letting go picks). */
let heldOpen = false

function Ring({ at }: { at: { x: number; y: number } }) {
  const ids = usePrefs((s) => s.prefs.radialFeatures)
  const features = useMemo(() => featuresFor(ids).slice(0, 12), [ids])
  const [hover, setHover] = useState(-1)
  const hoverRef = useRef(-1)
  hoverRef.current = hover

  // Keep the ring on screen.
  const pad = RADIUS + 40
  const cx = Math.min(window.innerWidth - pad, Math.max(pad, at.x))
  const cy = Math.min(window.innerHeight - pad, Math.max(pad, at.y))

  useEffect(() => {
    const close = (): void => {
      heldOpen = false
      useUI.setState({ radial: null })
    }
    const pick = (f: Feature | undefined): void => {
      close()
      f?.run()
    }
    const onMove = (e: MouseEvent): void => setHover(radialIndexAt(e.clientX - cx, e.clientY - cy, features.length, DEAD_ZONE))
    const onUp = (e: MouseEvent): void => {
      if (!heldOpen || e.button !== 1) return
      heldOpen = false
      e.preventDefault()
      const i = hoverRef.current
      // Let go in the middle: the ring stays open for a click.
      if (i >= 0) pick(features[i])
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        pick(features[Number(e.key) - 1])
      }
    }
    // Stop the middle button's own click (e.g. closing a tab) when the ring picks.
    const swallow = (e: MouseEvent): void => {
      if (e.button === 1) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('auxclick', swallow, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp, true)
      // The auxclick comes right after mouseup.
      window.setTimeout(() => window.removeEventListener('auxclick', swallow, true), 0)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [cx, cy, features])

  return (
    <div
      className="radial-backdrop"
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) useUI.setState({ radial: null })
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="radial" style={{ left: cx, top: cy }}>
        <div className="radial-centre">
          {hover >= 0 && features[hover] ? (
            <span>{features[hover].name}</span>
          ) : features.length ? (
            <X size={16} />
          ) : (
            <span className="radial-empty">Add features in the launcher</span>
          )}
        </div>
        {features.map((f, i) => {
          const { x, y } = radialPoint(i, features.length, RADIUS)
          const Icon = f.icon
          return (
            <button
              key={f.id}
              className={`radial-item ${i === hover ? 'hover' : ''}`}
              style={{ transform: `translate(${x}px, ${y}px)`, animationDelay: `${i * 14}ms` }}
              onMouseEnter={() => setHover(i)}
              onClick={() => {
                heldOpen = false
                useUI.setState({ radial: null })
                f.run()
              }}
              title={`${f.name} (${i + 1})`}
              data-feature={f.id}
            >
              <Icon size={18} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
