/**
 * Breakout: bounce the ball off your paddle to break every brick. Clear the bricks for the next
 * level (faster, with tougher bricks); miss the ball and you lose a life. Everything is measured in
 * a fixed 480 × 360 playing field, so the canvas can be any size.
 */

export const FIELD_W = 480
export const FIELD_H = 360
export const PADDLE_W = 72
export const PADDLE_H = 10
export const PADDLE_Y = FIELD_H - 26
export const BALL_R = 6
export const LIVES = 3

const BRICK_COLS = 10
const BRICK_H = 14
const BRICK_GAP = 4
const BRICK_TOP = 44
const SIDE = 12

export interface Brick {
  x: number
  y: number
  w: number
  h: number
  /** Hits left: 1 for a normal brick, 2 or 3 for tougher ones. */
  hits: number
  /** Which row colour to draw it in. */
  row: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export interface Breakout {
  paddle: number
  ball: Ball
  bricks: Brick[]
  score: number
  lives: number
  level: number
  /** The ball sits on the paddle until you launch it. */
  launched: boolean
  over: boolean
}

/** How fast the ball goes on a level, in field units a second. */
export const speedFor = (level: number): number => Math.min(260 + (level - 1) * 28, 480)

/**
 * The bricks for a level. The pattern changes each level (full wall, gaps, a pyramid, stripes), and
 * from level 3 the top rows take more than one hit.
 */
export function levelBricks(level: number): Brick[] {
  const rows = Math.min(4 + Math.floor((level + 1) / 2), 8)
  const w = (FIELD_W - SIDE * 2 - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS
  const pattern = (level - 1) % 4
  const bricks: Brick[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      const keep =
        pattern === 0 ||
        (pattern === 1 && (r + c) % 3 !== 0) ||
        (pattern === 2 && Math.abs(c - (BRICK_COLS - 1) / 2) <= rows - r - 0.5) ||
        (pattern === 3 && c % 4 !== 3)
      if (!keep) continue
      const tough = level >= 3 && r < Math.min(Math.floor(level / 2), rows - 1)
      bricks.push({
        x: SIDE + c * (w + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        w,
        h: BRICK_H,
        hits: tough ? (level >= 6 && r === 0 ? 3 : 2) : 1,
        row: r
      })
    }
  }
  return bricks
}

const restingBall = (paddle: number): Ball => ({ x: paddle, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 })

export function newBreakout(level = 1, score = 0, lives = LIVES): Breakout {
  const paddle = FIELD_W / 2
  return { paddle, ball: restingBall(paddle), bricks: levelBricks(level), score, lives, level, launched: false, over: false }
}

/** Sends the ball up from the paddle, a little to one side. */
export function launch(g: Breakout, random: () => number = Math.random): Breakout {
  if (g.launched || g.over) return g
  const speed = speedFor(g.level)
  const angle = (random() * 0.6 - 0.3) * Math.PI * 0.5
  return { ...g, launched: true, ball: { ...g.ball, vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed } }
}

const clampPaddle = (x: number): number => Math.max(PADDLE_W / 2, Math.min(FIELD_W - PADDLE_W / 2, x))

/** What happened in a step, so the page can react (a little flash, the pet cheering). */
export interface StepEvents {
  broke: number
  lostLife: boolean
  levelUp: boolean
}

/**
 * Moves everything on by `dt` seconds, with the paddle heading for `target` (its centre). Small
 * sub-steps keep a fast ball from going through a brick.
 */
export function step(g: Breakout, dt: number, target: number): { game: Breakout; events: StepEvents } {
  const events: StepEvents = { broke: 0, lostLife: false, levelUp: false }
  if (g.over) return { game: g, events }
  const paddle = clampPaddle(target)
  if (!g.launched) return { game: { ...g, paddle, ball: restingBall(paddle) }, events }

  let ball = { ...g.ball }
  let bricks = g.bricks
  let score = g.score
  const speed = speedFor(g.level)
  const parts = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.8)))
  const sdt = dt / parts

  for (let i = 0; i < parts; i++) {
    ball.x += ball.vx * sdt
    ball.y += ball.vy * sdt

    // Walls and ceiling.
    if (ball.x < BALL_R) {
      ball.x = BALL_R
      ball.vx = Math.abs(ball.vx)
    } else if (ball.x > FIELD_W - BALL_R) {
      ball.x = FIELD_W - BALL_R
      ball.vx = -Math.abs(ball.vx)
    }
    if (ball.y < BALL_R) {
      ball.y = BALL_R
      ball.vy = Math.abs(ball.vy)
    }

    // The paddle: where it hits picks the angle, so you can aim.
    if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_H && Math.abs(ball.x - paddle) <= PADDLE_W / 2 + BALL_R) {
      const off = Math.max(-1, Math.min(1, (ball.x - paddle) / (PADDLE_W / 2)))
      const angle = off * (Math.PI / 3)
      ball.vx = Math.sin(angle) * speed
      ball.vy = -Math.cos(angle) * speed
      ball.y = PADDLE_Y - BALL_R
    }

    // Bricks: bounce off the side the ball came in through.
    const hit = bricks.findIndex((b) => ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w && ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h)
    if (hit >= 0) {
      const b = bricks[hit]
      const overlapX = Math.min(ball.x + BALL_R - b.x, b.x + b.w - (ball.x - BALL_R))
      const overlapY = Math.min(ball.y + BALL_R - b.y, b.y + b.h - (ball.y - BALL_R))
      if (overlapX < overlapY) {
        ball.vx = ball.x < b.x + b.w / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx)
      } else {
        ball.vy = ball.y < b.y + b.h / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy)
      }
      bricks = b.hits > 1 ? bricks.map((x, j) => (j === hit ? { ...x, hits: x.hits - 1 } : x)) : bricks.filter((_, j) => j !== hit)
      score += b.hits > 1 ? 5 : 10 * g.level
      if (b.hits === 1) events.broke++
    }

    // Missed it.
    if (ball.y - BALL_R > FIELD_H) {
      events.lostLife = true
      const lives = g.lives - 1
      return { game: { ...g, paddle, bricks, score, lives, launched: false, over: lives <= 0, ball: restingBall(paddle) }, events }
    }

    if (!bricks.length) {
      events.levelUp = true
      return { game: { ...newBreakout(g.level + 1, score + 100 * g.level, g.lives), paddle }, events }
    }
  }
  return { game: { ...g, paddle, ball, bricks, score }, events }
}
