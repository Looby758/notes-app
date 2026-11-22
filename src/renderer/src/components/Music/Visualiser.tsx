import { useEffect, useRef } from 'react'
import { BARS, soundLevels } from '../../store/localMusic'

/**
 * Moving bars for your own music, mirrored from the middle line. The sound comes from `levels`
 * (the floating mini player gets it from the notes window), or else from the music playing here.
 */
export function Visualiser({ playing, levels }: { playing: boolean; levels?: () => ArrayLike<number> | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const heights = useRef(new Float32Array(BARS))

  useEffect(() => {
    const el = canvas.current
    const read = levels ?? soundLevels()
    if (!el || !read) return
    const g = el.getContext('2d')!
    let frame = 0
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr
        el.height = h * dpr
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const data = playing ? read() : null
      const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#4ade80'
      const gap = 2
      const barW = (w - gap * (BARS - 1)) / BARS
      for (let i = 0; i < BARS; i++) {
        const target = data?.[i] ?? 0
        // Rise quickly, fall gently.
        const now = heights.current[i]
        heights.current[i] = target > now ? now + (target - now) * 0.6 : now - (now - target) * 0.12
        const bh = Math.max(2, heights.current[i] * h)
        const x = i * (barW + gap)
        g.globalAlpha = 0.35 + heights.current[i] * 0.65
        g.fillStyle = accent
        g.beginPath()
        g.roundRect(x, (h - bh) / 2, barW, bh, Math.min(barW / 2, 2))
        g.fill()
      }
      // Once paused and settled, stop drawing until it plays again.
      if (playing || heights.current.some((v) => v > 0.01)) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playing, levels])

  return <canvas ref={canvas} className="music-visualiser" aria-hidden="true" data-music-visualiser />
}
