import { useEffect, useRef, useState, type KeyboardEvent, type RefObject, type WheelEvent } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'

/** Square sizes you can zoom between, in pixels. 'fit' makes the board fill the space it has. */
export type Zoom = number | 'fit'

const MIN_SIZE = 16
const MAX_SIZE = 72
const STEP = 6

interface Options {
  /** Where the zoom is remembered (this computer only). */
  storageKey: string
  /** How many squares' worth of width and height the board takes (clues count too). */
  across: number
  down: number
  /** Pixels on top of the squares (padding, borders, gaps). */
  extraW: number
  extraH: number
  /** The square size that counts as 100%. */
  normal: number
  /** The biggest a square gets when fitting the page. */
  fitMax?: number
}

export interface BoardZoom {
  wrap: RefObject<HTMLDivElement | null>
  size: number
  zoom: Zoom
  setZoom: (z: Zoom) => void
  zoomBy: (steps: number) => void
  onWheel: (e: WheelEvent) => void
  /** Handles + − and Ctrl + 0; true when it used the key. */
  onKey: (e: KeyboardEvent) => boolean
  percent: number
  canIn: boolean
  canOut: boolean
}

function loadZoom(key: string): Zoom {
  try {
    const z = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
    return typeof z === 'number' && z >= MIN_SIZE && z <= MAX_SIZE ? z : 'fit'
  } catch {
    return 'fit'
  }
}

/**
 * Zoom for a game board: squares as big as fit the page by default, or a size you pick with the
 * buttons, + and −, or Ctrl + scroll (remembered). Put `wrap` on the element around the board.
 */
export function useBoardZoom({ storageKey, across, down, extraW, extraH, normal, fitMax = 52 }: Options): BoardZoom {
  const [zoom, setZoomState] = useState<Zoom>(() => loadZoom(storageKey))
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = (): void => {
      const scroller = el.closest('.sudoku-page')
      setRoom({ w: el.clientWidth, h: window.innerHeight - el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    // Ctrl + wheel would otherwise zoom the whole window, so it's caught before the browser sees it.
    const stop = (e: globalThis.WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    el.addEventListener('wheel', stop, { passive: false })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      el.removeEventListener('wheel', stop)
    }
  }, [])

  const fitW = Math.floor((room.w - extraW) / across)
  // Leave room under the board for the help text, but never shrink to nothing on a short window.
  const fitH = Math.floor((room.h - 90 - extraH) / down)
  const fitSize = room.w ? Math.max(22, Math.min(fitMax, fitW, Math.max(fitH, 26))) : normal
  const size = zoom === 'fit' ? fitSize : zoom

  const setZoom = (z: Zoom): void => {
    const next = z === 'fit' ? z : Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(z)))
    setZoomState(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Not remembered, but still used.
    }
  }
  const zoomBy = (steps: number): void => setZoom(size + steps * STEP)

  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1 : -1)
  }

  const onKey = (e: KeyboardEvent): boolean => {
    if (e.altKey) return false
    const plus = e.key === '+' || e.key === '='
    const minus = e.key === '-' || e.key === '_'
    if ((e.ctrlKey || e.metaKey) && e.key === '0') setZoom('fit')
    else if (plus || minus) zoomBy(plus ? 1 : -1)
    else return false
    e.preventDefault()
    return true
  }

  return { wrap, size, zoom, setZoom, zoomBy, onWheel, onKey, percent: Math.round((size / normal) * 100), canIn: size < MAX_SIZE, canOut: size > MIN_SIZE }
}

/** The − / Fit / + buttons. */
export function ZoomControls({ z }: { z: BoardZoom }) {
  return (
    <span className="mines-zoom" role="group" aria-label="Zoom">
      <button className="sudoku-tool" onClick={() => z.zoomBy(-1)} disabled={!z.canOut} title="Smaller squares (−, or Ctrl + scroll)" data-zoom-out>
        <ZoomOut size={15} />
      </button>
      <button
        className={`sudoku-tool mines-zoom-level ${z.zoom === 'fit' ? 'active' : ''}`}
        onClick={() => z.setZoom('fit')}
        title={z.zoom === 'fit' ? 'The board fills the space it has' : 'Back to fitting the page (Ctrl + 0)'}
        data-zoom-fit
      >
        {z.zoom === 'fit' ? 'Fit' : `${z.percent}%`}
      </button>
      <button className="sudoku-tool" onClick={() => z.zoomBy(1)} disabled={!z.canIn} title="Bigger squares (+, or Ctrl + scroll)" data-zoom-in>
        <ZoomIn size={15} />
      </button>
    </span>
  )
}
