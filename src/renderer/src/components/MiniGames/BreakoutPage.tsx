import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { BrickWall, ChartColumn, Heart, Pause, Play, RotateCcw } from 'lucide-react'
import { BALL_R, FIELD_H, FIELD_W, launch, LIVES, newBreakout, PADDLE_H, PADDLE_W, PADDLE_Y, step, type Breakout, type StepEvents } from '../../lib/breakout'
import { celebrate } from '../../lib/celebrate'
import { useGameKeys } from './useGameKeys'
import { motionLevel } from '../../lib/motion'

// Best score, highest level and games played live on this computer only: it's just for fun.
const BEST_KEY = 'notesapp.breakout.best'

interface Best {
  score: number
  level: number
  played: number
}

function loadBest(): Best {
  try {
    const b = JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null') as Best | null
    return b && typeof b.score === 'number' ? b : { score: 0, level: 0, played: 0 }
  } catch {
    return { score: 0, level: 0, played: 0 }
  }
}

function saveBest(b: Best): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b))
  } catch {
    // Not remembered; the game still works.
  }
}

/** Brick colours, top row first (the top rows are worth breaking first anyway). */
const ROW_COLOURS = ['#e5484d', '#f76b15', '#f5a524', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f']

/** How fast the arrow keys move the paddle, in field units a second. */
const KEY_SPEED = 520

/** Breakout: bounce the ball to break all the bricks, level after level. */
export default function BreakoutPage() {
  const [game, setGame] = useState<Breakout>(() => newBreakout())
  const [paused, setPaused] = useState(false)
  const [best, setBest] = useState<Best>(loadBest)
  const canvas = useRef<HTMLCanvasElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const state = useRef({ game, paused, target: FIELD_W / 2, keys: { left: false, right: false } })
  const fx = useRef<Fx>(newFx())
  state.current.game = game
  state.current.paused = paused

  // The game loop: moves everything on each frame and draws it.
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      const s = state.current
      const el = canvas.current
      // Pause by itself when the tab is hidden or the window loses focus.
      if (el && (el.offsetParent === null || !document.hasFocus()) && s.game.launched && !s.game.over && !s.paused) setPaused(true)
      if (!s.paused && !s.game.over) {
        if (s.keys.left) s.target -= KEY_SPEED * dt
        if (s.keys.right) s.target += KEY_SPEED * dt
        s.target = Math.max(PADDLE_W / 2, Math.min(FIELD_W - PADDLE_W / 2, s.target))
        const { game: next, events } = step(s.game, dt, s.target)
        if (next !== s.game) {
          s.game = next
          setGame(next)
        }
        react(fx.current, events, next)
        if (events.levelUp) celebrate('small')
      }
      tickFx(fx.current, s.paused || s.game.over ? 0 : dt, s.game)
      if (el) draw(el, s.game, fx.current)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  // Record the game when it ends.
  useEffect(() => {
    if (!game.over) return
    setBest((b) => {
      const next = { score: Math.max(b.score, game.score), level: Math.max(b.level, game.level), played: b.played + 1 }
      saveBest(next)
      return next
    })
  }, [game.over, game.score, game.level])

  useEffect(() => page.current?.focus(), [])

  const go = (): void => {
    const s = state.current
    if (s.game.over) return restart()
    if (s.paused) return setPaused(false)
    if (!s.game.launched) setGame(launch(s.game))
  }

  const restart = (): void => {
    state.current.target = FIELD_W / 2
    setGame(newBreakout())
    setPaused(false)
    page.current?.focus()
  }

  useGameKeys(page, (e) => {
    const s = state.current
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault()
      s.keys.left = true
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault()
      s.keys.right = true
    } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') {
      e.preventDefault()
      go()
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (s.game.launched && !s.game.over) {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
  })

  useEffect(() => {
    const up = (e: KeyboardEvent): void => {
      const k = state.current.keys
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') k.left = false
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') k.right = false
    }
    const blur = (): void => void (state.current.keys = { left: false, right: false })
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const onMove = (e: PointerEvent): void => {
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect) return
    state.current.target = ((e.clientX - rect.left) / rect.width) * FIELD_W
  }

  const overlay = game.over
    ? { title: 'Game over', text: `${game.score} points, level ${game.level}. Click or press Space to play again.` }
    : paused
      ? { title: 'Paused', text: 'Click or press Space to carry on.' }
      : !game.launched
        ? { title: game.score ? `Level ${game.level}` : 'Breakout', text: 'Click or press Space to launch the ball.' }
        : null

  return (
    <div ref={page} className="sudoku-page breakout-page" tabIndex={0} data-breakout-page>
      <div className="sudoku-inner breakout-inner">
        <header className="sudoku-head">
          <h2>
            <BrickWall size={20} /> Breakout
          </h2>
        </header>

        <div className="sudoku-status">
          <span>
            Score <strong data-breakout-score>{game.score}</strong>
          </span>
          <span>
            Level <strong>{game.level}</strong>
          </span>
          <span className="breakout-lives" aria-label={`${game.lives} lives left`}>
            {Array.from({ length: LIVES }, (_, i) => (
              <Heart key={i} size={15} className={i < game.lives ? 'on' : ''} />
            ))}
          </span>
          <span className="mines-tools">
            {game.launched && !game.over && (
              <button className="sudoku-tool" onClick={() => setPaused((p) => !p)} title="Pause (P or Esc)">
                {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Carry on' : 'Pause'}
              </button>
            )}
            <button className="sudoku-tool" onClick={restart} title="Start again from level 1" data-breakout-new>
              <RotateCcw size={15} /> New game
            </button>
          </span>
        </div>

        <div className="breakout-stage">
          <canvas
            ref={canvas}
            className="breakout-canvas"
            width={FIELD_W * 2}
            height={FIELD_H * 2}
            onPointerMove={onMove}
            onClick={go}
            data-breakout-canvas
          />
          {overlay && (
            <div className="breakout-overlay" onClick={go} data-breakout-overlay>
              <strong>{overlay.title}</strong>
              <span>{overlay.text}</span>
            </div>
          )}
        </div>

        <section className="wordle-stats" aria-label="Stats" data-breakout-stats>
          <h3>
            <ChartColumn size={15} /> Breakout
          </h3>
          <div className="games-numbers" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div>
              <strong>{best.score}</strong>
              <span>Best score</span>
            </div>
            <div>
              <strong>{best.level || '–'}</strong>
              <span>Highest level</span>
            </div>
            <div>
              <strong>{best.played}</strong>
              <span>Played</span>
            </div>
          </div>
        </section>

        <p className="sudoku-help">
          Move the paddle with the mouse or the arrow keys, and keep the ball in play. Where the ball hits the paddle sets its angle, so hit it
          with an edge to aim. Clear every brick for the next level: each one is faster, and darker-edged bricks take more than one hit. You have{' '}
          {LIVES} lives. P or Esc pauses, and it pauses by itself if you switch away.
        </p>
      </div>
    </div>
  )
}

/** Sparks, the ball's trail, points that float up, and the shake: just for show, kept outside React. */
interface Fx {
  sparks: { x: number; y: number; vx: number; vy: number; life: number; colour: string; size: number }[]
  trail: { x: number; y: number }[]
  points: { x: number; y: number; text: string; life: number }[]
  shake: number
  /** Red flash when a ball is lost, white when a level is cleared. */
  flash: { colour: string; life: number } | null
  /** The paddle squashes a little when the ball hits it. */
  squash: number
  time: number
}

const newFx = (): Fx => ({ sparks: [], trail: [], points: [], shake: 0, flash: null, squash: 0, time: 0 })

function react(fx: Fx, e: StepEvents, g: Breakout): void {
  const motion = motionLevel()
  if (motion === 'off') return
  const full = motion === 'full'
  for (const h of e.hits) {
    const colour = ROW_COLOURS[h.row % ROW_COLOURS.length]
    const n = h.broke ? (full ? 16 : 6) : 5
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = 60 + Math.random() * (h.broke ? 220 : 120)
      fx.sparks.push({ x: h.x, y: h.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.5 + Math.random() * 0.5, colour, size: 2 + Math.random() * 3 })
    }
    fx.points.push({ x: h.x, y: h.y, text: `+${h.points}`, life: 0.9 })
    if (full && h.broke) fx.shake = Math.min(fx.shake + 2, 6)
  }
  if (e.paddle) fx.squash = 1
  if (e.lostLife) {
    fx.flash = { colour: '229,72,77', life: 0.5 }
    if (full) fx.shake = 10
    fx.trail = []
  }
  if (e.levelUp) {
    fx.flash = { colour: '255,255,255', life: 0.6 }
    fx.trail = []
  }
  if (!g.launched) fx.trail = []
}

function tickFx(fx: Fx, dt: number, g: Breakout): void {
  fx.time += dt
  for (const p of fx.sparks) {
    p.vy += 420 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  }
  fx.sparks = fx.sparks.filter((p) => p.life > 0)
  for (const p of fx.points) {
    p.y -= 40 * dt
    p.life -= dt
  }
  fx.points = fx.points.filter((p) => p.life > 0)
  fx.shake = Math.max(0, fx.shake - 30 * dt)
  fx.squash = Math.max(0, fx.squash - 5 * dt)
  if (fx.flash) fx.flash = fx.flash.life - dt > 0 ? { ...fx.flash, life: fx.flash.life - dt } : null
  if (g.launched && dt > 0 && motionLevel() !== 'off') {
    fx.trail.push({ x: g.ball.x, y: g.ball.y })
    if (fx.trail.length > 12) fx.trail.shift()
  }
}

/** Draws the field. The canvas is twice the field's size, for sharp edges on any screen. */
function draw(el: HTMLCanvasElement, g: Breakout, fx: Fx): void {
  const ctx = el.getContext('2d')
  if (!ctx) return
  const css = getComputedStyle(el)
  const game = css.getPropertyValue('--game').trim() || '#ff4fa3'
  const sx = el.width / FIELD_W
  const sy = el.height / FIELD_H
  const shakeX = fx.shake ? (Math.random() - 0.5) * fx.shake : 0
  const shakeY = fx.shake ? (Math.random() - 0.5) * fx.shake : 0
  ctx.setTransform(sx, 0, 0, sy, shakeX * sx, shakeY * sy)
  ctx.clearRect(-20, -20, FIELD_W + 40, FIELD_H + 40)

  // A faint grid that the light catches.
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= FIELD_W; x += 24) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, FIELD_H)
  }
  for (let y = 0; y <= FIELD_H; y += 24) {
    ctx.moveTo(0, y)
    ctx.lineTo(FIELD_W, y)
  }
  ctx.stroke()

  for (const b of g.bricks) {
    const colour = ROW_COLOURS[b.row % ROW_COLOURS.length]
    const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h)
    grad.addColorStop(0, shade(colour, 0.35))
    grad.addColorStop(0.5, colour)
    grad.addColorStop(1, shade(colour, -0.25))
    ctx.fillStyle = grad
    ctx.shadowColor = colour
    ctx.shadowBlur = 8
    roundRect(ctx, b.x, b.y, b.w, b.h, 4)
    ctx.fill()
    ctx.shadowBlur = 0
    // A shine along the top.
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    roundRect(ctx, b.x + 3, b.y + 2, b.w - 6, 2.5, 1.2)
    ctx.fill()
    if (b.hits > 1) {
      ctx.lineWidth = b.hits > 2 ? 2.5 : 1.8
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 3)
      ctx.stroke()
      // Dots show how many more hits it takes.
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      for (let i = 0; i < b.hits; i++) {
        ctx.beginPath()
        ctx.arc(b.x + b.w / 2 + (i - (b.hits - 1) / 2) * 7, b.y + b.h / 2 + 1, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // The ball's trail, then the ball with a glow.
  fx.trail.forEach((p, i) => {
    const t = (i + 1) / fx.trail.length
    ctx.fillStyle = `rgba(255,255,255,${0.25 * t})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, BALL_R * (0.4 + 0.6 * t), 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.shadowColor = '#fff'
  ctx.shadowBlur = 14
  const ballGrad = ctx.createRadialGradient(g.ball.x - 2, g.ball.y - 2, 1, g.ball.x, g.ball.y, BALL_R)
  ballGrad.addColorStop(0, '#ffffff')
  ballGrad.addColorStop(1, '#d6dcff')
  ctx.fillStyle = ballGrad
  ctx.beginPath()
  ctx.arc(g.ball.x, g.ball.y, BALL_R, 0, Math.PI * 2)
  ctx.fill()

  // The paddle: glowing, squashing when it hits the ball.
  const squash = fx.squash * 3
  const pw = PADDLE_W + squash * 2
  const ph = PADDLE_H - squash
  const paddleGrad = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H)
  paddleGrad.addColorStop(0, shade(game, 0.4))
  paddleGrad.addColorStop(1, game)
  ctx.shadowColor = game
  ctx.shadowBlur = 16
  ctx.fillStyle = paddleGrad
  roundRect(ctx, g.paddle - pw / 2, PADDLE_Y + squash, pw, ph, 5)
  ctx.fill()
  ctx.shadowBlur = 0

  for (const p of fx.sparks) {
    ctx.globalAlpha = Math.min(1, p.life * 2)
    ctx.fillStyle = p.colour
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
  }
  ctx.globalAlpha = 1
  ctx.font = 'bold 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const p of fx.points) {
    ctx.globalAlpha = Math.min(1, p.life * 1.5)
    ctx.fillStyle = '#fff'
    ctx.fillText(p.text, p.x, p.y)
  }
  ctx.globalAlpha = 1

  if (fx.flash) {
    ctx.fillStyle = `rgba(${fx.flash.colour},${fx.flash.life * 0.35})`
    ctx.fillRect(-20, -20, FIELD_W + 40, FIELD_H + 40)
  }
}

/** A colour made lighter (amount > 0) or darker (< 0). Takes #rrggbb. */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const mix = (c: number): number => Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
