import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { Bomb, Flag, RotateCcw, Trophy, X } from 'lucide-react'
import { countsOf, isCleared, layMines, levelOf, LEVELS, neighbours, reveal, type Level } from '../../lib/minesweeper'
import { formatTime } from '../../lib/sudoku'

/** A game in progress. `mine` is null until the first click, so the first click is never a mine. */
interface Game {
  level: Level
  mine: boolean[] | null
  open: boolean[]
  flags: boolean[]
  seconds: number
  state: 'playing' | 'won' | 'lost'
  /** The mine that went off. */
  boom: number | null
}

// The game and best times live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.minesweeper.game'
const BEST_KEY = 'notesapp.minesweeper.best'

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the game still works, it just won't be remembered.
  }
}

function newGame(level: Level): Game {
  const { rows, cols } = levelOf(level)
  const none = new Array(rows * cols).fill(false)
  return { level, mine: null, open: none, flags: none, seconds: 0, state: 'playing', boom: null }
}

/** Minesweeper, for a quick break: open every square that isn't a mine. */
export default function MinesweeperPage() {
  const [game, setGame] = useState<Game>(() => load<Game>(GAME_KEY) ?? newGame('easy'))
  const [best, setBest] = useState<Partial<Record<Level, number>>>(() => load(BEST_KEY) ?? {})
  const [cursor, setCursor] = useState<number | null>(null)
  const [flagMode, setFlagMode] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const { rows, cols, mines } = levelOf(game.level)

  useEffect(() => save(GAME_KEY, game), [game])
  useEffect(() => board.current?.focus(), [])

  // A new fastest time for this level?
  useEffect(() => {
    if (game.state !== 'won') return
    setBest((b) => {
      if (b[game.level] !== undefined && b[game.level]! <= game.seconds) return b
      const updated = { ...b, [game.level]: game.seconds }
      save(BEST_KEY, updated)
      return updated
    })
  }, [game.state, game.level, game.seconds])

  // The clock starts with the first click and runs while the window is in front.
  const running = game.state === 'playing' && !!game.mine
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g.state === 'playing' ? { ...g, seconds: g.seconds + 1 } : g))
    }, 1000)
    return () => clearInterval(tick)
  }, [running])

  const counts = useMemo(() => (game.mine ? countsOf(game.mine, rows, cols) : null), [game.mine, rows, cols])
  const flagsLeft = mines - game.flags.filter(Boolean).length

  const start = (level: Level): void => {
    setGame(newGame(level))
    setCursor(null)
    setFlagMode(false)
    board.current?.focus()
  }

  /** Opens these squares; a mine among them ends the game. */
  const openSquares = (g: Game, squares: number[]): Game => {
    const mine = g.mine ?? layMines(rows, cols, mines, squares[0])
    let open = g.open
    for (const i of squares) open = reveal(open, g.flags, mine, i, rows, cols)
    const boom = squares.find((i) => mine[i] && !g.flags[i]) ?? null
    if (boom !== null) return { ...g, mine, open, state: 'lost', boom }
    return { ...g, mine, open, state: isCleared(open, mine) ? 'won' : 'playing' }
  }

  const dig = (i: number): void => {
    setGame((g) => {
      if (g.state !== 'playing' || g.flags[i]) return g
      if (!g.open[i]) return openSquares(g, [i])
      // Clicking an open number whose mines are all flagged opens the rest of its neighbours.
      if (!g.mine) return g
      const around = neighbours(i, rows, cols)
      const flagged = around.filter((j) => g.flags[j]).length
      const shut = around.filter((j) => !g.open[j] && !g.flags[j])
      if (!shut.length || flagged !== countsOf(g.mine, rows, cols)[i]) return g
      return openSquares(g, shut)
    })
  }

  const flag = (i: number): void => {
    setGame((g) => {
      if (g.state !== 'playing' || g.open[i]) return g
      const flags = [...g.flags]
      flags[i] = !flags[i]
      return { ...g, flags }
    })
  }

  const onCell = (i: number) => (e: MouseEvent): void => {
    setCursor(i)
    if (e.type === 'contextmenu') {
      e.preventDefault()
      flag(i)
    } else if (flagMode && !game.open[i]) flag(i)
    else dig(i)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dr, dc] = moves[e.key]
      const i = cursor ?? Math.floor(rows / 2) * cols + Math.floor(cols / 2)
      setCursor(((Math.floor(i / cols) + dr + rows) % rows) * cols + (((i % cols) + dc + cols) % cols))
      return
    }
    if (cursor !== null && (e.key === ' ' || e.key === 'Enter')) return void (e.preventDefault(), dig(cursor))
    if (cursor !== null && e.key.toLowerCase() === 'f') return void (e.preventDefault(), flag(cursor))
    if (e.key.toLowerCase() === 'n') return void (e.preventDefault(), start(game.level))
    if (e.key === 'Escape') setCursor(null)
  }

  const over = game.state !== 'playing'

  return (
    <div className="sudoku-page mines-page" data-minesweeper-page>
      <div className="sudoku-inner mines-inner" onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <Bomb size={20} /> Minesweeper
          </h2>
          <div className="sudoku-levels" role="group" aria-label="How hard">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                className={`sudoku-level ${game.level === l.id ? 'active' : ''}`}
                onClick={() => start(l.id)}
                title={`Start a new ${l.label.toLowerCase()} game (${l.cols}×${l.rows}, ${l.mines} mines)`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long you've been playing this game">
            {formatTime(game.seconds)}
          </span>
          <span className="mines-left" title="Mines left to flag">
            <Flag size={13} /> {flagsLeft}
          </span>
          {best[game.level] !== undefined && (
            <span className="sudoku-best" title={`Your fastest ${game.level} game`}>
              <Trophy size={13} /> Best {formatTime(best[game.level]!)}
            </span>
          )}
          <span className="mines-tools">
            <button
              className={`sudoku-tool ${flagMode ? 'active' : ''}`}
              onClick={() => setFlagMode((f) => !f)}
              title="Clicks place flags instead of digging (right-click always flags)"
              aria-pressed={flagMode}
              data-flag-mode
            >
              <Flag size={15} /> Flag mode {flagMode ? 'on' : 'off'}
            </button>
            <button className="sudoku-tool" onClick={() => start(game.level)} title="Start a new game (N)">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div className="mines-wrap">
          <div
            ref={board}
            className={`mines-board ${game.state}`}
            style={{ '--mine-size': cols > 20 ? '24px' : '30px', gridTemplateColumns: `repeat(${cols}, var(--mine-size))` } as CSSProperties}
            tabIndex={0}
            role="grid"
            aria-label="Minesweeper board"
            data-mines-board
          >
            {game.open.map((isOpen, i) => {
              const isMine = !!game.mine?.[i]
              const flagged = game.flags[i]
              const n = counts?.[i] ?? 0
              // Once it's over, show where the mines were and which flags were wrong.
              const showMine = isMine && (isOpen || (over && !flagged))
              const wrongFlag = over && flagged && !isMine
              const classes = [
                'mines-cell',
                isOpen || showMine ? 'open' : '',
                isOpen && !isMine && n ? `n${n}` : '',
                i === game.boom ? 'boom' : '',
                i === cursor ? 'cursor' : ''
              ]
              return (
                <button
                  key={i}
                  className={classes.filter(Boolean).join(' ')}
                  onClick={onCell(i)}
                  onContextMenu={onCell(i)}
                  tabIndex={-1}
                  aria-label={`Row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}${isOpen ? (n ? `: ${n}` : ', clear') : flagged ? ', flagged' : ''}`}
                  data-cell={i}
                >
                  {wrongFlag ? (
                    <X size={14} />
                  ) : flagged ? (
                    <Flag size={13} className="mines-flag" />
                  ) : showMine ? (
                    <Bomb size={14} />
                  ) : isOpen && n ? (
                    n
                  ) : null}
                </button>
              )
            })}
            {over && (
              <div className={`sudoku-won mines-result ${game.state}`} data-mines-result>
                {game.state === 'won' ? <Trophy size={30} /> : <Bomb size={30} />}
                <strong>{game.state === 'won' ? 'Cleared!' : 'Boom!'}</strong>
                <span>
                  {game.state === 'won'
                    ? `${formatTime(game.seconds)}${best[game.level] === game.seconds ? ' · your best yet' : ''}`
                    : 'You hit a mine.'}
                </span>
                <button className="btn btn-primary" onClick={() => start(game.level)}>
                  Play again
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="sudoku-help">
          Open every square that isn't a mine. A number tells you how many mines touch that square. Right-click (or F) to flag a mine, and click a number
          once its mines are flagged to open the squares around it. Your first click is always safe.
        </p>
      </div>
    </div>
  )
}
