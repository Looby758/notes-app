import { useEffect, useRef } from 'react'
import { localAnalyser } from '../../store/localMusic'

const BARS = 48

/** Moving bars for your own music: low notes on the left, high on the right, mirrored from the middle line. */
export function Visualiser({ playing }: { playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const heights = useRef(new Float32Array(BARS))

  useEffect(() => {
    const el = canvas.current
    const analyser = localAnalyser()
    if (!el || !analyser) return
    const g = el.getContext('2d')!
    const data = new Uint8Array(analyser.frequencyBinCount)
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
      analyser.getByteFrequencyData(data)
      const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#4ade80'
      const gap = 2
      const barW = (w - gap * (BARS - 1)) / BARS
      // Spread the bars over the notes we hear most of (the top of the range is mostly empty).
      const usable = Math.floor(data.length * 0.72)
      for (let i = 0; i < BARS; i++) {
        const from = Math.floor((i / BARS) ** 1.6 * usable)
        const to = Math.max(from + 1, Math.floor(((i + 1) / BARS) ** 1.6 * usable))
        let sum = 0
        for (let j = from; j < to; j++) sum += data[j]
        const target = playing ? sum / (to - from) / 255 : 0
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
  }, [playing])

  return <canvas ref={canvas} className="music-visualiser" aria-hidden="true" data-music-visualiser />
}
