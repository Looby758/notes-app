import { useEffect, useRef } from 'react'
import { BARS, soundLevels } from '../../store/localMusic'
import { setPrefs, usePrefs } from '../../store/prefs'
import { nextVisualiser, VISUALISER_STYLES, type VisualiserStyle } from '@shared/musicSound'

/**
 * Moving shapes for your own music, in the style picked in Settings → Music (bars, a wave,
 * mountains, a circle or lights); clicking it moves on to the next style. The sound comes from
 * `levels` (the floating mini player gets it from the notes window), or else from the music playing here.
 */
export function Visualiser({ playing, levels, big, className }: { playing: boolean; levels?: () => ArrayLike<number> | null; big?: boolean; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const heights = useRef(new Float32Array(BARS))
  const peaks = useRef(new Float32Array(BARS))
  const style = usePrefs((s) => s.prefs.musicVisualiserStyle)

  useEffect(() => {
    const el = canvas.current
    const read = levels ?? soundLevels()
    if (!el || !read) return
    const g = el.getContext('2d')!
    let frame = 0
    let phase = 0
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const data = playing ? read() : null
      const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#4ade80'
      const v = heights.current
      for (let i = 0; i < BARS; i++) {
        const target = data?.[i] ?? 0
        // Rise quickly, fall gently.
        v[i] = target > v[i] ? v[i] + (target - v[i]) * 0.6 : v[i] - (v[i] - target) * 0.12
        peaks.current[i] = Math.max(v[i], peaks.current[i] - 0.008)
      }
      phase += playing ? 0.04 : 0
      g.fillStyle = accent
      g.strokeStyle = accent
      DRAW[style](g, w, h, v, { peaks: peaks.current, phase, big: !!big })
      g.globalAlpha = 1
      // Once paused and settled, stop drawing until it plays again.
      if (playing || v.some((x) => x > 0.01)) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playing, levels, style, big])

  const label = VISUALISER_STYLES.find((s) => s.id === style)?.label ?? 'Bars'
  return (
    <canvas
      ref={canvas}
      className={`music-visualiser ${className ?? ''}`}
      onClick={() => setPrefs({ musicVisualiserStyle: nextVisualiser(style) })}
      title={`Visualiser: ${label} (click for another style)`}
      data-music-visualiser={style}
    />
  )
}

interface Extra {
  peaks: Float32Array
  phase: number
  big: boolean
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, v: Float32Array, extra: Extra) => void

/** A smooth line through points (for the wave and the mountains). */
function smooth(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  g.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
  }
  const last = pts[pts.length - 1]
  g.lineTo(last[0], last[1])
}

const DRAW: Record<VisualiserStyle, Draw> = {
  // Bars mirrored from the middle line (the original).
  bars(g, w, h, v) {
    const gap = 2
    const barW = (w - gap * (BARS - 1)) / BARS
    for (let i = 0; i < BARS; i++) {
      const bh = Math.max(2, v[i] * h)
      g.globalAlpha = 0.35 + v[i] * 0.65
      g.beginPath()
      g.roundRect(i * (barW + gap), (h - bh) / 2, barW, bh, Math.min(barW / 2, 2))
      g.fill()
    }
  },
  // A ribbon that ripples with the music: two lines, mirrored, drifting slowly.
  wave(g, w, h, v, { phase, big }) {
    const mid = h / 2
    for (const [sign, alpha, width] of [
      [1, 0.9, big ? 3 : 2],
      [-1, 0.45, big ? 2 : 1.5]
    ] as const) {
      const pts: [number, number][] = []
      const n = 64
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * w
        const level = v[Math.min(BARS - 1, Math.floor((i / n) * BARS))]
        const y = mid + sign * Math.sin(i * 0.45 + phase * (sign > 0 ? 3 : -2)) * level * mid * 0.9
        pts.push([x, y])
      }
      g.globalAlpha = alpha
      g.lineWidth = width
      g.beginPath()
      smooth(g, pts)
      g.stroke()
    }
  },
  // Filled hills from the bottom, low notes on the left, with a lighter ridge on top.
  mountain(g, w, h, v) {
    const pts: [number, number][] = [[0, h]]
    for (let i = 0; i < BARS; i++) pts.push([(i / (BARS - 1)) * w, h - Math.max(1, v[i] * h * 0.95)])
    pts.push([w, h])
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, g.fillStyle as string)
    grad.addColorStop(1, 'transparent')
    g.globalAlpha = 0.55
    g.fillStyle = grad
    g.beginPath()
    smooth(g, pts)
    g.closePath()
    g.fill()
    g.globalAlpha = 0.95
    g.lineWidth = 1.5
    g.beginPath()
    smooth(g, pts.slice(1, -1))
    g.stroke()
  },
  // Bars pointing out from a ring, all the way round (low notes at the top, both sides).
  circle(g, w, h, v, { phase }) {
    // A short strip (the corner and mini players) has no room for one ring: a row of circles that swell with the music instead.
    if (w > h * 3 && h < 120) {
      const count = Math.max(8, Math.min(32, Math.floor(w / (h * 0.9))))
      const step = w / count
      for (let c = 0; c < count; c++) {
        const level = v[Math.floor((c / count) * BARS)]
        g.globalAlpha = 0.3 + level * 0.7
        g.beginPath()
        g.arc(step * (c + 0.5), h / 2, Math.max(1.5, Math.min(step, h) * 0.48 * (0.15 + level * 0.85)), 0, Math.PI * 2)
        g.fill()
      }
      return
    }
    const cx = w / 2
    const cy = h / 2
    const r = Math.min(w, h) * 0.22
    const room = Math.min(w, h) / 2 - r - 2
    const count = BARS * 2
    g.lineCap = 'round'
    g.lineWidth = Math.max(1.5, ((2 * Math.PI * r) / count) * 0.55)
    for (let i = 0; i < count; i++) {
      const level = v[i < BARS ? i : count - 1 - i]
      const a = (i / count) * Math.PI * 2 - Math.PI / 2 + phase * 0.05
      const len = 2 + level * room
      g.globalAlpha = 0.35 + level * 0.65
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      g.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len))
      g.stroke()
    }
    const avg = v.reduce((t, x) => t + x, 0) / BARS
    g.globalAlpha = 0.25 + avg * 0.5
    g.beginPath()
    g.arc(cx, cy, r * (0.8 + avg * 0.2), 0, Math.PI * 2)
    g.fill()
  },
  // Columns of little lights, like a stereo's display, with a falling peak on each.
  dots(g, w, h, v, { peaks, big }) {
    const cols = big ? 32 : 24
    const size = Math.max(3, Math.min(w / cols - 2, big ? 14 : 6))
    const gap = (w - cols * size) / Math.max(1, cols - 1)
    const rows = Math.max(3, Math.floor((h + 2) / (size + 2)))
    for (let c = 0; c < cols; c++) {
      const i = Math.floor((c / cols) * BARS)
      const lit = Math.round(v[i] * rows)
      const peak = Math.min(rows - 1, Math.round(peaks[i] * rows))
      for (let r = 0; r < rows; r++) {
        const on = r < lit
        g.globalAlpha = on ? 0.45 + (r / rows) * 0.55 : r === peak && peak > 0 ? 0.9 : 0.08
        g.beginPath()
        g.roundRect(c * (size + gap), h - (r + 1) * (size + 2) + 2, size, size, size / 3)
        g.fill()
      }
    }
  }
}
