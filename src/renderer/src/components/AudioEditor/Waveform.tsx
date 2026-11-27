import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp, formatTime, parseTime, peaks, rulerStep, type Selection } from '../../lib/audioTrim'
import type { OpenAudio } from '../../store/audioEditor'

/** The audio editor's waveform and time boxes, shared with the Music page's Trim song window. */

export interface View {
  from: number
  to: number
}

/** A start or end time you can type, nudge with the arrow keys, or set from where it's playing. */
export function TimeBox({ label, value, max, onChange, onFromPlayhead, hint }: { label: string; value: number; max: number; onChange: (t: number) => void; onFromPlayhead: () => void; hint: string }) {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    const t = parseTime(text)
    if (t !== null) onChange(clamp(t, 0, max))
    setText(null)
  }
  return (
    <div className="ae-time">
      <span>{label}</span>
      <input
        className="text-input"
        value={text ?? formatTime(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setText(null)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1)
            setText(null)
            onChange(clamp(value + step, 0, max))
          }
        }}
        aria-label={`${label} time`}
        title="Type a time like 1:05.5, or use the up and down arrows to nudge it (Shift for whole seconds)"
        data-audio-editor-time={label.toLowerCase()}
      />
      <button className="btn ae-small" onClick={onFromPlayhead} title={`Set it to where it’s playing (${hint})`}>
        Set here
      </button>
    </div>
  )
}

interface WaveProps {
  audio: OpenAudio
  view: View
  sel: Selection
  mode: 'keep' | 'cut'
  playhead: number
  onSeek: (t: number) => void
  onZoom: (factor: number, around: number) => void
  onPan: (from: number) => void
  onSelect: (sel: Selection) => void
}

type Drag = { kind: 'start' | 'end' } | { kind: 'new'; anchor: number; x: number; moved: boolean }

/** The waveform, with the selection's edges to drag, a time ruler and where it's playing. */
export function Waveform({ audio, view, sel, mode, playhead, onSeek, onZoom, onPan, onSelect }: WaveProps) {
  const selRef = useRef(sel)
  selRef.current = sel
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<Drag | null>(null)
  const span = view.to - view.from
  const x = (t: number): number => ((t - view.from) / span) * 100

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Draws the waveform: what's kept in the accent colour, the rest dimmed.
  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const dpr = window.devicePixelRatio || 1
    const h = c.clientHeight
    c.width = Math.round(width * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    const style = getComputedStyle(c)
    const kept = style.getPropertyValue('--accent').trim() || '#4ade80'
    const dim = style.getPropertyValue('--text-faint').trim() || '#5e6270'
    const columns = Math.max(1, Math.floor(width))
    const p = peaks(audio.channels, audio.sampleRate, view.from, view.to, columns)
    const mid = h / 2
    const inSel = (t: number): boolean => t >= sel.start && t <= sel.end
    for (let i = 0; i < columns; i++) {
      const t = view.from + ((i + 0.5) / columns) * span
      g.fillStyle = inSel(t) === (mode === 'keep') ? kept : dim
      const lo = p[i * 2]
      const hi = p[i * 2 + 1]
      const top = mid - hi * (mid - 2)
      const bottom = mid - lo * (mid - 2)
      g.fillRect(i, top, 1, Math.max(1, bottom - top))
    }
  }, [audio, view.from, view.to, span, sel.start, sel.end, mode, width])

  // Ctrl + scroll zooms around the pointer; sideways scrolling (or Shift + scroll) moves along.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const rect = el.getBoundingClientRect()
      const at = view.from + ((e.clientX - rect.left) / rect.width) * span
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        onZoom(e.deltaY > 0 ? 1.25 : 0.8, at)
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        if (span >= audio.duration) return
        e.preventDefault()
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / rect.width
        onPan(clamp(view.from + d * span, 0, audio.duration - span))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view.from, span, audio.duration, onZoom, onPan])

  const timeAt = (clientX: number): number => {
    const rect = box.current!.getBoundingClientRect()
    return clamp(view.from + ((clientX - rect.left) / rect.width) * span, 0, audio.duration)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const handle = (e.target as HTMLElement).dataset.handle as 'start' | 'end' | undefined
    drag.current = handle ? { kind: handle } : { kind: 'new', anchor: timeAt(e.clientX), x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    ;(e.currentTarget.closest('.ae') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const t = timeAt(e.clientX)
    if (d.kind === 'new') {
      if (!d.moved && Math.abs(e.clientX - d.x) < 4) return
      d.moved = true
      onSelect({ start: d.anchor, end: t })
      return
    }
    const cur = selRef.current
    const next = d.kind === 'start' ? { start: t, end: cur.end } : { start: cur.start, end: t }
    // Dragged past the other edge: carry on as that edge.
    if (next.start > next.end) drag.current = { kind: d.kind === 'start' ? 'end' : 'start' }
    onSelect(next)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'new' && !d.moved) return onSeek(timeAt(e.clientX))
    // After moving an edge, listen from it: from the start, or the last couple of seconds before the end.
    const now = selRef.current
    if (d.kind === 'start') onSeek(now.start)
    else if (d.kind === 'end') onSeek(Math.max(now.start, now.end - 2))
  }

  // The ruler: a label about every 80 pixels.
  const step = rulerStep(width ? (span * 80) / width : span)
  const places = step < 0.1 ? 2 : step < 1 ? 1 : 0
  const ticks: number[] = []
  for (let t = Math.ceil(view.from / step) * step; t <= view.to + 1e-9 && ticks.length < 200; t += step) ticks.push(t)

  const startVisible = sel.start >= view.from && sel.start <= view.to
  const endVisible = sel.end >= view.from && sel.end <= view.to

  return (
    <div className="ae-wave-wrap">
      <div
        ref={box}
        className={`ae-wave ${mode}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        data-audio-editor-wave
      >
        <canvas ref={canvas} />
        <div className="ae-sel" style={{ left: `${clamp(x(sel.start), 0, 100)}%`, right: `${100 - clamp(x(sel.end), 0, 100)}%` }} />
        {startVisible && (
          <div className="ae-handle start" style={{ left: `${x(sel.start)}%` }} data-handle="start" title={`Start: ${formatTime(sel.start)}`}>
            <span data-handle="start" />
          </div>
        )}
        {endVisible && (
          <div className="ae-handle end" style={{ left: `${x(sel.end)}%` }} data-handle="end" title={`End: ${formatTime(sel.end)}`}>
            <span data-handle="end" />
          </div>
        )}
        {playhead >= view.from && playhead <= view.to && <div className="ae-playhead" style={{ left: `${x(playhead)}%` }} />}
      </div>
      <div className="ae-ruler">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${x(t)}%` }}>
            {formatTime(t, places)}
          </span>
        ))}
      </div>
    </div>
  )
}
