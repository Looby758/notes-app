import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Frown, RotateCcw, Trophy, Undo2 } from 'lucide-react'
import { addTile, biggest, canMove, GOAL, newBoard, SIZE, slide, slideTiles, tileId, tilesOf, type Direction, type Tile } from '../../lib/game2048'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'
import GameStats from './GameStats'

interface Game {
  board: number[]
  score: number
  moves: number
  seconds: number
  /** Reached 2048 (the win is counted once; you can keep going after). */
  reached: boolean
  over: boolean
  /** Already counted in the stats. */
  counted: boolean
  /** The board before the last move, for one undo. */
  before: { board: number[]; score: number } | null
  /** Squares that just appeared or joined, for the little pop. */
  fresh: number[]
}

// The game and best score live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.2048.game'
const BEST_KEY = 'notesapp.2048.best'
const STATS_ID = '2048'

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Game | null
    return g && Array.isArray(g.board) && g.board.length === 16 ? g : null
  } catch {
    return null
  }
}

const fresh = (): Game => ({ board: newBoard(), score: 0, moves: 0, seconds: 0, reached: false, over: false, counted: false, before: null, fresh: [] })

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right'
}

/** 2048: slide the tiles so matching numbers join, and try to make a 2048 tile. */
export default function Game2048Page() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? fresh())
  const [best, setBest] = useState<number>(() => Number(localStorage.getItem(BEST_KEY)) || 0)
  const [record, setRecord] = useState<GameRecord | undefined>(() => loadRecords()[STATS_ID])
  const [showWin, setShowWin] = useState(false)
  const [tiles, setTiles] = useState<Tile[]>(() => tilesOf(game.board))
  const [bump, setBump] = useState<Direction | null>(null)
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(game))
    } catch {
      // Not remembered; it still plays.
    }
  }, [game])
  useEffect(() => board.current?.focus(), [])

  useEffect(() => {
    if (game.score <= best) return
    setBest(game.score)
    try {
      localStorage.setItem(BEST_KEY, String(game.score))
    } catch {
      // Not remembered.
    }
  }, [game.score, best])

  // The clock starts with the first move and runs while the window is in front.
  const running = game.moves > 0 && !game.over
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g.over ? g : { ...g, seconds: g.seconds + 1 }))
    }, 1000)
    return () => clearInterval(tick)
  }, [running])

  // Count the game once: a win the moment 2048 appears, a loss when the board locks up first.
  useEffect(() => {
    if (game.counted) return
    if (game.reached) {
      setRecord(saveGame(STATS_ID, true, game.seconds))
      setShowWin(true)
      setGame((g) => ({ ...g, counted: true }))
    } else if (game.over) {
      setRecord(saveGame(STATS_ID, false))
      setGame((g) => ({ ...g, counted: true }))
    }
  }, [game.reached, game.over, game.counted, game.seconds])

  // The latest game and tiles, so quick key presses each build on the one before.
  const gameRef = useRef(game)
  gameRef.current = game
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  // Tiles that slid into another one disappear once they've arrived.
  useEffect(() => {
    if (!tiles.some((t) => t.gone)) return
    const t = setTimeout(() => setTiles((ts) => ts.filter((x) => !x.gone)), 130)
    return () => clearTimeout(t)
  }, [tiles])

  const go = (dir: Direction): void => {
    const g = gameRef.current
    if (g.over) return
    const s = slide(g.board, dir)
    if (!s.moved) {
      // Nothing can move that way: a little nudge says so.
      setBump(null)
      requestAnimationFrame(() => setBump(dir))
      return
    }
    const { board: next, at } = addTile(s.board)
    const moved = slideTiles(tilesRef.current, dir).tiles
    const ts = [...moved, { id: tileId(), value: next[at], at, isNew: true }]
    const ng: Game = {
      ...g,
      board: next,
      score: g.score + s.gained,
      moves: g.moves + 1,
      reached: g.reached || biggest(next) >= GOAL,
      over: !canMove(next),
      before: { board: g.board, score: g.score },
      fresh: []
    }
    gameRef.current = ng
    tilesRef.current = ts
    setGame(ng)
    setTiles(ts)
    setBump(null)
    if (s.gained) setGain({ n: s.gained, key: ng.moves })
  }

  const undo = (): void => {
    const g = gameRef.current
    if (!g.before || g.over) return
    setGame({ ...g, board: g.before.board, score: g.before.score, before: null, fresh: [] })
    setTiles(tilesOf(g.before.board))
  }

  const restart = (): void => {
    // Leaving a game you'd made a start on counts as a loss, like giving up.
    if (!game.counted && game.moves > 0) setRecord(saveGame(STATS_ID, false))
    const g = fresh()
    setGame(g)
    setTiles(tilesOf(g.board).map((t) => ({ ...t, isNew: true })))
    setShowWin(false)
    setGain(null)
    board.current?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
      return
    }
    const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
    if (dir) {
      e.preventDefault()
      setShowWin(false)
      go(dir)
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault()
      restart()
    } else if (e.key.toLowerCase() === 'u') {
      e.preventDefault()
      undo()
    }
  }

  // Swipe with the mouse or a touch screen.
  const onDown = (e: PointerEvent): void => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: PointerEvent): void => {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return
    go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  return (
    <div className="sudoku-page g2048-page" data-2048-page>
      <div className="sudoku-inner g2048-inner" onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <span className="g2048-logo">2048</span>
          </h2>
          <div className="g2048-scores">
            <div>
              <span>Score</span>
              <strong data-2048-score>{game.score}</strong>
              {gain && (
                <em key={gain.key} className="g2048-gain">
                  +{gain.n}
                </em>
              )}
            </div>
            <div>
              <span>Best</span>
              <strong>{best}</strong>
            </div>
          </div>
        </header>

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long you've been playing this game">
            {formatTime(game.seconds)}
          </span>
          {record?.bestTime !== undefined && (
            <span className="sudoku-best" title="Your fastest 2048 tile">
              <Trophy size={13} /> Best {formatTime(record.bestTime)}
            </span>
          )}
          <span className="mines-tools">
            <button className="sudoku-tool" onClick={undo} disabled={!game.before || game.over} title="Take back the last move (U or Ctrl+Z)">
              <Undo2 size={15} /> Undo
            </button>
            <button className="sudoku-tool" onClick={restart} title="Start a new game (N)">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div
          ref={board}
          className={`g2048-board ${bump ? `bump-${bump}` : ''}`}
          tabIndex={0}
          role="grid"
          aria-label="2048 board. Use the arrow keys to slide the tiles."
          onPointerDown={onDown}
          onPointerUp={onUp}
          data-2048-board
        >
          {game.board.map((_, i) => (
            <div key={i} className="g2048-cell" />
          ))}
          <div className="g2048-tiles">
            {tiles.map((t) => (
              <div
                key={t.id}
                className={['g2048-tile', `t${t.value > 2048 ? 'big' : t.value}`, t.value >= 1024 ? 'wide' : '', t.merged ? 'merged' : '', t.isNew ? 'new' : '', t.gone ? 'gone' : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ '--r': Math.floor(t.at / SIZE), '--c': t.at % SIZE } as CSSProperties}
                data-tile={t.gone ? undefined : t.value}
              >
                {t.value}
              </div>
            ))}
          </div>
          {(game.over || showWin) && (
            <div className={`sudoku-won g2048-result ${game.over ? 'lost' : 'won'}`} data-2048-result>
              {game.over && !game.reached ? <Frown size={30} /> : <Trophy size={30} />}
              <strong>{game.over ? (game.reached ? 'No moves left' : 'Game over') : 'You made 2048!'}</strong>
              <span>
                {game.over ? `Score ${game.score}` : `${formatTime(game.seconds)}${record?.bestTime === game.seconds ? ' · your best yet' : ''}`}
              </span>
              <div className="g2048-result-buttons">
                {!game.over && (
                  <button className="btn" onClick={() => (setShowWin(false), board.current?.focus())}>
                    Keep going
                  </button>
                )}
                <button className="btn btn-primary" onClick={restart}>
                  Play again
                </button>
              </div>
            </div>
          )}
        </div>

        <GameStats title="2048" record={record} />

        <p className="sudoku-help">
          Slide the tiles with the arrow keys (or W A S D, or swipe). Two tiles with the same number join into one. Make a 2048 tile to win, then keep going for a
          higher score if you like. Undo takes back your last move. Starting a new game before this one ends counts as a loss.
        </p>
      </div>
    </div>
  )
}
