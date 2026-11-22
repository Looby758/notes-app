import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { BrickWall, ChartColumn, Heart, Pause, Play, RotateCcw } from 'lucide-react'
import { BALL_R, FIELD_H, FIELD_W, launch, LIVES, newBreakout, PADDLE_H, PADDLE_W, PADDLE_Y, step, type Breakout } from '../../lib/breakout'
import { petCheer } from '../../lib/pet'
import { useGameKeys } from './useGameKeys'

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
        if (events.levelUp) petCheer()
      }
      if (el) draw(el, s.game)
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

/** Draws the field. The canvas is twice the field's size, for sharp edges on any screen. */
function draw(el: HTMLCanvasElement, g: Breakout): void {
  const ctx = el.getContext('2d')
  if (!ctx) return
  const css = getComputedStyle(el)
  const accent = css.getPropertyValue('--accent').trim() || '#4ade80'
  const text = css.getPropertyValue('--text-strong').trim() || '#fff'
  ctx.setTransform(el.width / FIELD_W, 0, 0, el.height / FIELD_H, 0, 0)
  ctx.clearRect(0, 0, FIELD_W, FIELD_H)

  for (const b of g.bricks) {
    ctx.fillStyle = ROW_COLOURS[b.row % ROW_COLOURS.length]
    ctx.globalAlpha = b.hits > 1 ? 1 : 0.85
    roundRect(ctx, b.x, b.y, b.w, b.h, 3)
    ctx.fill()
    if (b.hits > 1) {
      ctx.globalAlpha = 1
      ctx.lineWidth = b.hits > 2 ? 3 : 2
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  ctx.fillStyle = accent
  roundRect(ctx, g.paddle - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, 5)
  ctx.fill()

  ctx.fillStyle = text
  ctx.beginPath()
  ctx.arc(g.ball.x, g.ball.y, BALL_R, 0, Math.PI * 2)
  ctx.fill()
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
