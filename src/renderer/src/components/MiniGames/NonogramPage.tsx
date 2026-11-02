import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Grid2x2Check, Lightbulb, RotateCcw, Trophy, Undo2, X } from 'lucide-react'
import { colOf, isNonoSolved, lineDone, makeNonogram, nonoLevelOf, NONO_LEVELS, rowOf, type Mark, type Nonogram, type NonoLevel } from '../../lib/nonogram'
import { formatTime } from '../../lib/sudoku'
import { petCheer } from '../../lib/pet'

/** A game in progress. */
interface Game {
  level: NonoLevel
  puzzle: Nonogram
  marks: Mark[]
  seconds: number
  hints: number
  history: Mark[][]
  won: boolean
}

// The game and best times live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.nonogram.game'
const BEST_KEY = 'notesapp.nonogram.best'
const MAX_HISTORY = 200

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

function newGame(level: NonoLevel): Game {
  const puzzle = makeNonogram(level)
  return { level, puzzle, marks: new Array(puzzle.rows * puzzle.cols).fill(0), seconds: 0, hints: 0, history: [], won: false }
}

/** A saved game from an older or damaged save is thrown away rather than drawn wrong. */
function loadGame(): Game | null {
  const g = load<Game>(GAME_KEY)
  return g && g.puzzle && Array.isArray(g.marks) && g.marks.length === g.puzzle.rows * g.puzzle.cols ? g : null
}

/** What a drag does to each square it passes over: decided by the first square. */
type Paint = { to: Mark; from: Mark }

/** Nonograms (picture logic): fill the squares the numbers describe to reveal a picture. */
export default function NonogramPage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? newGame('small'))
  const [best, setBest] = useState<Partial<Record<NonoLevel, number>>>(() => load(BEST_KEY) ?? {})
  const [cursor, setCursor] = useState<number | null>(null)
  const [crossMode, setCrossMode] = useState(false)
  const paint = useRef<Paint | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const { rows, cols, clues, solution } = game.puzzle

  useEffect(() => save(GAME_KEY, game), [game])
  useEffect(() => board.current?.focus(), [])

  const wasWon = useRef(game.won)
  useEffect(() => {
    if (game.won && !wasWon.current) petCheer()
    wasWon.current = game.won
  }, [game.won])

  useEffect(() => {
    if (!game.won || game.hints) return
    setBest((b) => {
      if (b[game.level] !== undefined && b[game.level]! <= game.seconds) return b
      const updated = { ...b, [game.level]: game.seconds }
      save(BEST_KEY, updated)
      return updated
    })
  }, [game.won, game.hints, game.level, game.seconds])

  useEffect(() => {
    if (game.won) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g.won ? g : { ...g, seconds: g.seconds + 1 }))
    }, 1000)
    return () => clearInterval(tick)
  }, [game.won])

  // A drag ends wherever the mouse is let go, even off the board.
  useEffect(() => {
    const end = (): void => void (paint.current = null)
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [])

  const start = (level: NonoLevel): void => {
    setGame(newGame(level))
    setCursor(null)
    setCrossMode(false)
    board.current?.focus()
  }

  /** Sets squares, as one move for undo. `fresh` starts a new move (a click); a drag adds to the last one. */
  const setMarks = (edit: (marks: Mark[]) => Mark[], fresh: boolean, extra: Partial<Game> = {}): void => {
    setGame((g) => {
      if (g.won) return g
      const marks = edit(g.marks)
      if (marks.every((m, i) => m === g.marks[i])) return g
      const history = fresh ? [...g.history.slice(-MAX_HISTORY + 1), g.marks] : g.history
      return { ...g, ...extra, marks, history, won: isNonoSolved(marks, g.puzzle.solution) }
    })
  }

  /** Starts a click or drag on a square: filling, crossing, or clearing what's there. */
  const press = (i: number, cross: boolean): void => {
    const want: Mark = cross ? 2 : 1
    const from = game.marks[i]
    const to: Mark = from === want ? 0 : want
    paint.current = { to, from }
    setCursor(i)
    setMarks((m) => m.map((v, j) => (j === i ? to : v)), true)
  }

  const onPointerDown = (i: number) => (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    board.current?.focus()
    press(i, e.button === 2 || crossMode)
  }

  const onPointerEnter = (i: number) => (): void => {
    const p = paint.current
    if (!p) return
    setCursor(i)
    // A drag only changes squares that were like the first one, so it never paints over your work.
    setMarks((m) => (m[i] === p.from ? m.map((v, j) => (j === i ? p.to : v)) : m), false)
  }

  const hint = (): void => {
    const wrong = game.marks.map((m, i) => (solution[i] !== (m === 1) ? i : -1)).filter((i) => i >= 0)
    const i = cursor !== null && wrong.includes(cursor) ? cursor : wrong[Math.floor(Math.random() * wrong.length)]
    if (i === undefined) return
    setCursor(i)
    setMarks((m) => m.map((v, j) => (j === i ? (solution[i] ? 1 : 2) : v)), true, { hints: game.hints + 1 })
  }

  const undo = (): void => {
    setGame((g) => {
      if (g.won) return g
      const last = g.history[g.history.length - 1]
      return last ? { ...g, marks: last, history: g.history.slice(0, -1) } : g
    })
  }

  const onKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') return void (e.preventDefault(), undo())
    if (mod || e.altKey) return
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dr, dc] = moves[e.key]
      const i = cursor ?? 0
      setCursor(((Math.floor(i / cols) + dr + rows) % rows) * cols + (((i % cols) + dc + cols) % cols))
      return
    }
    const key = e.key.toLowerCase()
    if (cursor !== null && (e.key === ' ' || e.key === 'Enter')) return void (e.preventDefault(), press(cursor, crossMode), (paint.current = null))
    if (cursor !== null && key === 'x') return void (e.preventDefault(), press(cursor, true), (paint.current = null))
    if (key === 'n') return void (e.preventDefault(), start(game.level))
    if (key === 'h') return void (e.preventDefault(), hint())
    if (e.key === 'Escape') setCursor(null)
  }

  const curRow = cursor === null ? -1 : Math.floor(cursor / cols)
  const curCol = cursor === null ? -1 : cursor % cols
  const size = cols > 10 ? 26 : cols > 5 ? 32 : 44
  const longestCol = Math.max(1, ...clues.cols.map((c) => c.length))
  const longestRow = Math.max(1, ...clues.rows.map((c) => c.length))

  return (
    <div className="sudoku-page nono-page" data-nonogram-page>
      <div className="sudoku-inner nono-inner" onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <Grid2x2Check size={20} /> Nonograms
          </h2>
          <div className="sudoku-levels" role="group" aria-label="How big">
            {NONO_LEVELS.map((l) => (
              <button
                key={l.id}
                className={`sudoku-level ${game.level === l.id ? 'active' : ''}`}
                onClick={() => start(l.id)}
                title={`Start a new ${l.size}×${l.size} puzzle`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long you've been playing this puzzle">
            {formatTime(game.seconds)}
          </span>
          {best[game.level] !== undefined && (
            <span className="sudoku-best" title={`Your fastest ${nonoLevelOf(game.level).label.toLowerCase()} puzzle (without hints)`}>
              <Trophy size={13} /> Best {formatTime(best[game.level]!)}
            </span>
          )}
          <span className="mines-tools">
            <button
              className={`sudoku-tool ${crossMode ? 'active' : ''}`}
              onClick={() => setCrossMode((c) => !c)}
              title="Clicks put a cross (this square is empty) instead of filling (right-click always crosses)"
              aria-pressed={crossMode}
              data-cross-mode
            >
              <X size={15} /> Cross mode {crossMode ? 'on' : 'off'}
            </button>
            <button className="sudoku-tool" onClick={undo} disabled={!game.history.length || game.won} title="Undo (Ctrl+Z)">
              <Undo2 size={15} /> Undo
            </button>
            <button className="sudoku-tool" onClick={hint} disabled={game.won} title="Put one square right (H)">
              <Lightbulb size={15} /> Hint
            </button>
            <button className="sudoku-tool" onClick={() => start(game.level)} title="Start a new puzzle (N)">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div className="mines-wrap">
          <div
            ref={board}
            className={`nono-board ${game.won ? 'won' : ''}`}
            tabIndex={0}
            role="grid"
            aria-label="Nonogram board: arrow keys move, Space fills, X crosses"
            data-nono-board
            style={
              {
                '--nono-size': `${size}px`,
                gridTemplateColumns: `auto repeat(${cols}, var(--nono-size))`,
                gridTemplateRows: `auto repeat(${rows}, var(--nono-size))`
              } as CSSProperties
            }
          >
            <div className="nono-corner" />
            {clues.cols.map((clue, c) => (
              <div
                key={`c${c}`}
                className={`nono-clue col ${lineDone(colOf(game.marks, rows, cols, c), clue) ? 'done' : ''} ${c === curCol ? 'current' : ''}`}
                style={{ minHeight: `${longestCol * 1.25}em` }}
                data-col-clue={c}
              >
                {(clue.length ? clue : [0]).map((n, k) => (
                  <span key={k}>{n}</span>
                ))}
              </div>
            ))}
            {Array.from({ length: rows }, (_, r) => [
              <div
                key={`r${r}`}
                className={`nono-clue row ${lineDone(rowOf(game.marks, cols, r), clues.rows[r]) ? 'done' : ''} ${r === curRow ? 'current' : ''}`}
                style={{ minWidth: `${longestRow * 1.4}em` }}
                data-row-clue={r}
              >
                {(clues.rows[r].length ? clues.rows[r] : [0]).map((n, k) => (
                  <span key={k}>{n}</span>
                ))}
              </div>,
              ...Array.from({ length: cols }, (_, c) => {
                const i = r * cols + c
                const m = game.marks[i]
                const classes = [
                  'nono-cell',
                  m === 1 ? 'filled' : m === 2 ? 'crossed' : '',
                  c % 5 === 4 && c < cols - 1 ? 'edge-right' : '',
                  r % 5 === 4 && r < rows - 1 ? 'edge-bottom' : '',
                  i === cursor ? 'cursor' : '',
                  r === curRow || c === curCol ? 'related' : ''
                ]
                return (
                  <button
                    key={i}
                    className={classes.filter(Boolean).join(' ')}
                    onPointerDown={onPointerDown(i)}
                    onPointerEnter={onPointerEnter(i)}
                    onContextMenu={(e) => e.preventDefault()}
                    tabIndex={-1}
                    aria-label={`Row ${r + 1}, column ${c + 1}${m === 1 ? ', filled' : m === 2 ? ', crossed' : ''}`}
                    data-cell={i}
                  >
                    {m === 2 && !game.won && <X size={size * 0.5} />}
                  </button>
                )
              })
            ])}
          </div>
          {game.won && (
            <div className="nono-result" data-nono-result>
              <Trophy size={26} />
              <strong>Solved!</strong>
              <span>
                {formatTime(game.seconds)}
                {game.hints ? ` · ${game.hints} hint${game.hints === 1 ? '' : 's'}` : best[game.level] === game.seconds ? ' · your best yet' : ''}
              </span>
              <button className="btn btn-primary" onClick={() => start(game.level)}>
                Play again
              </button>
            </div>
          )}
        </div>

        <p className="sudoku-help">
          The numbers by each row and column are the runs of filled squares in it, in order, with at least one empty square between runs. Fill squares
          to match every clue and a picture appears. Right-click (or X) puts a cross on a square you know is empty. Drag to fill or cross several at once.
          A clue fades once its line matches.
        </p>
      </div>
    </div>
  )
}
