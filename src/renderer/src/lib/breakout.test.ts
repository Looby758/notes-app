import { describe, expect, it } from 'vitest'
import { BALL_R, FIELD_H, FIELD_W, launch, levelBricks, newBreakout, PADDLE_W, PADDLE_Y, step, type Breakout } from './breakout'

describe('breakout', () => {
  it('lays out bricks inside the field, tougher on later levels', () => {
    for (let level = 1; level <= 10; level++) {
      const bricks = levelBricks(level)
      expect(bricks.length, `level ${level}`).toBeGreaterThan(15)
      for (const b of bricks) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w).toBeLessThanOrEqual(FIELD_W)
        expect(b.y + b.h).toBeLessThan(PADDLE_Y - 100)
      }
    }
    expect(levelBricks(1).every((b) => b.hits === 1)).toBe(true)
    expect(levelBricks(4).some((b) => b.hits > 1)).toBe(true)
  })

  it('keeps the ball on the paddle until launched, and the paddle on the field', () => {
    const g = newBreakout()
    const { game } = step(g, 0.1, -500)
    expect(game.paddle).toBe(PADDLE_W / 2)
    expect(game.ball.x).toBe(game.paddle)
    const up = launch(game, () => 0.5)
    expect(up.launched).toBe(true)
    expect(up.ball.vy).toBeLessThan(0)
  })

  it('bounces off the paddle and loses a life when missed', () => {
    const falling: Breakout = { ...newBreakout(), bricks: levelBricks(1), launched: true, ball: { x: 240, y: PADDLE_Y - 20, vx: 0, vy: 260 } }
    const bounced = step(falling, 0.1, 240).game
    expect(bounced.ball.vy).toBeLessThan(0)
    expect(bounced.lives).toBe(3)
    const missed = step({ ...falling, ball: { x: 40, y: FIELD_H - 2, vx: 0, vy: 260 } }, 0.1, 400)
    expect(missed.events.lostLife).toBe(true)
    expect(missed.game.lives).toBe(2)
    expect(missed.game.launched).toBe(false)
    const last = step({ ...falling, lives: 1, ball: { x: 40, y: FIELD_H - 2, vx: 0, vy: 260 } }, 0.1, 400)
    expect(last.game.over).toBe(true)
  })

  it('breaks bricks for points and moves on a level when they are all gone', () => {
    const one = levelBricks(1)[0]
    const g: Breakout = { ...newBreakout(), launched: true, bricks: [one], ball: { x: one.x + one.w / 2, y: one.y + one.h + BALL_R + 2, vx: 0, vy: -260 } }
    const { game, events } = step(g, 0.05, 240)
    expect(events.levelUp).toBe(true)
    expect(game.level).toBe(2)
    expect(game.score).toBeGreaterThan(0)
    expect(game.lives).toBe(3)
  })

  it('never lets the ball leave the field through a wall over a long game', () => {
    let g = launch(newBreakout(), () => 0.9)
    for (let i = 0; i < 3000 && !g.over; i++) {
      g = step(g, 1 / 60, g.ball.x).game
      if (!g.launched) g = launch(g, () => 0.2)
      expect(g.ball.x).toBeGreaterThanOrEqual(BALL_R)
      expect(g.ball.x).toBeLessThanOrEqual(FIELD_W - BALL_R)
      expect(g.ball.y).toBeGreaterThanOrEqual(BALL_R)
    }
    // A paddle that follows the ball never misses.
    expect(g.lives).toBe(3)
    expect(g.score).toBeGreaterThan(0)
  })
})
