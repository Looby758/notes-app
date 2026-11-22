import { useEffect, useRef } from 'react'
import { CELEBRATE, type CelebrationSize } from '../../lib/celebrate'
import { motionLevel } from '../../lib/motion'

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  turn: number
  size: number
  colour: string
  shape: 0 | 1 | 2
  life: number
}

const COLOURS = ['#ff5c7a', '#ffb02e', '#ffe14d', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6', '#ffffff']
const COUNT: Record<CelebrationSize, number> = { small: 50, win: 140, big: 260 }

/**
 * Confetti over the mini games when someone wins (lib/celebrate.ts). Two bursts from the bottom
 * corners, then it drifts down and fades. Nothing with motion off; a short fade-only sprinkle on Subtle.
 */
export default function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let bits: Bit[] = []
    let raf = 0
    let last = 0

    const frame = (now: number): void => {
      const el = canvas.current
      const ctx = el?.getContext('2d')
      if (!el || !ctx) return
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      const w = el.clientWidth
      const h = el.clientHeight
      const ratio = window.devicePixelRatio || 1
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
        el.width = Math.round(w * ratio)
        el.height = Math.round(h * ratio)
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, w, h)
      for (const b of bits) {
        b.vy += 520 * dt
        b.vx *= 1 - 1.4 * dt
        b.vy *= 1 - 0.9 * dt
        b.x += (b.vx + Math.sin(b.life * 6 + b.spin) * 30) * dt
        b.y += b.vy * dt
        b.turn += b.spin * dt
        b.life += dt
        const fade = Math.max(0, Math.min(1, (3.2 - b.life) / 0.8))
        ctx.save()
        ctx.globalAlpha = fade
        ctx.translate(b.x, b.y)
        ctx.rotate(b.turn)
        ctx.fillStyle = b.colour
        if (b.shape === 0) ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2)
        else if (b.shape === 1) {
          ctx.beginPath()
          ctx.arc(0, 0, b.size / 3, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.scale(1, Math.cos(b.life * 9 + b.spin))
          ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size)
        }
        ctx.restore()
      }
      bits = bits.filter((b) => b.life < 3.2 && b.y < h + 40)
      if (bits.length) raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, w, h)
    }

    const burst = (e: Event): void => {
      const motion = motionLevel()
      const el = canvas.current
      if (motion === 'off' || !el) return
      const size = (e as CustomEvent<CelebrationSize>).detail ?? 'win'
      const w = el.clientWidth
      const h = el.clientHeight
      const n = motion === 'subtle' ? Math.round(COUNT[size] / 3) : COUNT[size]
      for (let i = 0; i < n; i++) {
        const left = i % 2 === 0
        const angle = (left ? -60 : -120) + (Math.random() - 0.5) * 50
        const speed = (motion === 'subtle' ? 300 : 620) + Math.random() * 520
        bits.push({
          x: left ? w * 0.08 : w * 0.92,
          y: h + 10,
          vx: Math.cos((angle * Math.PI) / 180) * speed,
          vy: Math.sin((angle * Math.PI) / 180) * speed * (h > 500 ? 1.15 : 0.85),
          spin: (Math.random() - 0.5) * 14,
          turn: Math.random() * Math.PI,
          size: 7 + Math.random() * 7,
          colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
          shape: (i % 3) as 0 | 1 | 2,
          life: Math.random() * 0.2
        })
      }
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }

    window.addEventListener(CELEBRATE, burst)
    return () => {
      window.removeEventListener(CELEBRATE, burst)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvas} className="minigames-confetti" aria-hidden="true" />
}
