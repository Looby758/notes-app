import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Eraser, Grid3x3, Lightbulb, Pencil, RotateCcw, Trophy, Undo2 } from 'lucide-react'
import {
  boxOf,
  clashes,
  colOf,
  DIFFICULTIES,
  formatTime,
  isSolved,
  makePuzzle,
  peersOf,
  rowOf,
  type Difficulty,
  type Grid
} from '../../lib/sudoku'

/** A game in progress. `notes` holds the small pencil marks: bit n is set when n is pencilled in. */
interface Game {
  difficulty: Difficulty
  puzzle: Grid
  solution: Grid
  grid: Grid
  notes: number[]
  seconds: number
  hints: number
  history: { grid: Grid; notes: number[] }[]
  won: boolean
}

// The game and best times live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.sudoku.game'
const BEST_KEY = 'notesapp.sudoku.best'

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

function newGame(difficulty: Difficulty): Game {
  const { puzzle, solution } = makePuzzle(difficulty)
  return { difficulty, puzzle, solution, grid: [...puzzle], notes: new Array(81).fill(0), seconds: 0, hints: 0, history: [], won: false }
}

const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
/** Undo goes back this many moves. */
const MAX_HISTORY = 200

/** Sudoku, for a quick break: fill the grid so every row, column and box has 1 to 9 once. */
export default function SudokuPage() {
  const [game, setGame] = useState<Game>(() => load<Game>(GAME_KEY) ?? newGame('easy'))
  const [best, setBest] = useState<Partial<Record<Difficulty, number>>>(() => load(BEST_KEY) ?? {})
  const [selected, setSelected] = useState<number | null>(null)
  const [pencil, setPencil] = useState(false)
  const board = useRef<HTMLDivElement>(null)

  useEffect(() => save(GAME_KEY, game), [game])
  useEffect(() => board.current?.focus(), [])

  // A new fastest time for this level?
  useEffect(() => {
    if (!game.won || game.hints) return
    setBest((b) => {
      if (b[game.difficulty] !== undefined && b[game.difficulty]! <= game.seconds) return b
      const updated = { ...b, [game.difficulty]: game.seconds }
      save(BEST_KEY, updated)
      return updated
    })
  }, [game.won, game.hints, game.difficulty, game.seconds])

  // The clock runs while the page is on screen and the window is in front.
  useEffect(() => {
    if (game.won) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g.won ? g : { ...g, seconds: g.seconds + 1 }))
    }, 1000)
    return () => clearInterval(tick)
  }, [game.won])

  const wrong = useMemo(() => {
    const out = clashes(game.grid)
    game.grid.forEach((n, i) => n && n !== game.solution[i] && out.add(i))
    return out
  }, [game.grid, game.solution])

  const left = useMemo(() => {
    const counts = new Array(10).fill(9)
    game.grid.forEach((n, i) => n && n === game.solution[i] && counts[n]--)
    return counts
  }, [game.grid, game.solution])

  const start = (difficulty: Difficulty): void => {
    setGame(newGame(difficulty))
    setSelected(null)
    setPencil(false)
    board.current?.focus()
  }

  /** Makes a move on the selected square (unless it's one of the given numbers). */
  const change = (i: number | null, edit: (g: Game) => Pick<Game, 'grid' | 'notes'> & Partial<Game>): void => {
    if (i === null || game.won || game.puzzle[i]) return
    setGame((g) => {
      const next = { ...g, ...edit(g), history: [...g.history.slice(-MAX_HISTORY + 1), { grid: g.grid, notes: g.notes }] }
      return { ...next, won: isSolved(next.grid, next.solution) }
    })
  }

  const enter = (n: number): void => {
    if (selected === null) return
    if (pencil) {
      if (game.grid[selected]) return
      change(selected, (g) => {
        const notes = [...g.notes]
        notes[selected] ^= 1 << n
        return { grid: g.grid, notes }
      })
      return
    }
    change(selected, (g) => {
      const grid = [...g.grid]
      const notes = [...g.notes]
      grid[selected] = grid[selected] === n ? 0 : n
      // Placing a number tidies away that pencil mark from the squares it rules out.
      if (grid[selected]) for (const j of peersOf(selected)) notes[j] &= ~(1 << n)
      return { grid, notes }
    })
  }

  const erase = (): void =>
    change(selected, (g) => {
      const grid = [...g.grid]
      const notes = [...g.notes]
      grid[selected!] = 0
      notes[selected!] = 0
      return { grid, notes }
    })

  /** Fills in the selected square (or, with none picked, one that's empty or wrong). */
  const hint = (): void => {
    let i = selected !== null && !game.puzzle[selected] && game.grid[selected] !== game.solution[selected] ? selected : null
    if (i === null) {
      const open = [...game.grid.keys()].filter((j) => game.grid[j] !== game.solution[j])
      i = open[Math.floor(Math.random() * open.length)] ?? null
    }
    if (i === null) return
    const at = i
    setSelected(at)
    change(at, (g) => {
      const grid = [...g.grid]
      const notes = [...g.notes]
      grid[at] = g.solution[at]
      notes[at] = 0
      for (const j of peersOf(at)) notes[j] &= ~(1 << g.solution[at])
      return { grid, notes, hints: g.hints + 1 }
    })
  }

  const undo = (): void => {
    if (game.won) return
    setGame((g) => {
      const last = g.history[g.history.length - 1]
      return last ? { ...g, ...last, history: g.history.slice(0, -1) } : g
    })
  }

  const onKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') return void (e.preventDefault(), undo())
    if (mod || e.altKey) return
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
    if (digit) return void (e.preventDefault(), enter(Number(digit[1])))
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dr, dc] = moves[e.key]
      const i = selected ?? 40
      setSelected(((rowOf(i) + dr + 9) % 9) * 9 + ((colOf(i) + dc + 9) % 9))
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') return void (e.preventDefault(), erase())
    if (e.key.toLowerCase() === 'n') return void (e.preventDefault(), setPencil((p) => !p))
    if (e.key.toLowerCase() === 'h') return void (e.preventDefault(), hint())
    if (e.key === 'Escape') setSelected(null)
  }

  const sel = selected
  const selNumber = sel !== null ? game.grid[sel] : 0

  return (
    <div className="sudoku-page" data-sudoku-page>
      {/* Keys work wherever you clicked last on the page (the grid, a number, a tool). */}
      <div className="sudoku-inner" onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <Grid3x3 size={20} /> Sudoku
          </h2>
          <div className="sudoku-levels" role="group" aria-label="How hard">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                className={`sudoku-level ${game.difficulty === d.id ? 'active' : ''}`}
                onClick={() => start(d.id)}
                title={`Start a new ${d.label.toLowerCase()} puzzle`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long you've been playing this puzzle">
            {formatTime(game.seconds)}
          </span>
          {best[game.difficulty] !== undefined && (
            <span className="sudoku-best" title={`Your fastest ${game.difficulty} puzzle`}>
              <Trophy size={13} /> Best {formatTime(best[game.difficulty]!)}
            </span>
          )}
          {game.hints > 0 && <span className="sudoku-hints">{game.hints === 1 ? '1 hint' : `${game.hints} hints`}</span>}
        </div>

        <div className="sudoku-play">
          <div
            ref={board}
            className={`sudoku-board ${game.won ? 'won' : ''}`}
            tabIndex={0}
            role="grid"
            aria-label="Sudoku grid"
            data-sudoku-board
          >
            {game.grid.map((n, i) => {
              const given = !!game.puzzle[i]
              const related = sel !== null && i !== sel && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel))
              const classes = [
                'sudoku-cell',
                given ? 'given' : n ? 'filled' : '',
                i === sel ? 'selected' : '',
                related ? 'related' : '',
                n && n === selNumber && i !== sel ? 'same' : '',
                wrong.has(i) && !given ? 'wrong' : '',
                colOf(i) % 3 === 2 && colOf(i) !== 8 ? 'edge-right' : '',
                rowOf(i) % 3 === 2 && rowOf(i) !== 8 ? 'edge-bottom' : ''
              ]
              return (
                <button
                  key={i}
                  className={classes.filter(Boolean).join(' ')}
                  onClick={() => setSelected(i)}
                  tabIndex={-1}
                  aria-label={`Row ${rowOf(i) + 1}, column ${colOf(i) + 1}${n ? `: ${n}` : ', empty'}`}
                  data-cell={i}
                >
                  {n ? (
                    n
                  ) : game.notes[i] ? (
                    <span className="sudoku-notes">
                      {NUMBERS.map((m) => (
                        <span key={m}>{game.notes[i] & (1 << m) ? m : ''}</span>
                      ))}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {game.won && (
              <div className="sudoku-won" data-sudoku-won>
                <Trophy size={30} />
                <strong>Solved!</strong>
                <span>
                  {formatTime(game.seconds)}
                  {game.hints ? ` with ${game.hints === 1 ? '1 hint' : `${game.hints} hints`}` : ''}
                  {!game.hints && best[game.difficulty] === game.seconds ? ' · your best yet' : ''}
                </span>
                <button className="btn btn-primary" onClick={() => start(game.difficulty)}>
                  Play again
                </button>
              </div>
            )}
          </div>

          <div className="sudoku-side">
            <div className="sudoku-pad">
              {NUMBERS.map((n) => (
                <button
                  key={n}
                  className="sudoku-key"
                  onClick={() => {
                    enter(n)
                    board.current?.focus()
                  }}
                  disabled={!left[n] && !pencil}
                  title={left[n] ? `${left[n]} left to place` : 'All placed'}
                  data-key={n}
                >
                  {n}
                  <small>{left[n] || ''}</small>
                </button>
              ))}
            </div>
            <div className="sudoku-tools">
              <button className="sudoku-tool" onClick={undo} disabled={!game.history.length || game.won} title="Undo (Ctrl+Z)">
                <Undo2 size={16} /> Undo
              </button>
              <button className="sudoku-tool" onClick={erase} disabled={game.won} title="Clear this square (Backspace)">
                <Eraser size={16} /> Erase
              </button>
              <button
                className={`sudoku-tool ${pencil ? 'active' : ''}`}
                onClick={() => setPencil((p) => !p)}
                title="Pencil in small numbers you're not sure of (N)"
                aria-pressed={pencil}
                data-pencil
              >
                <Pencil size={16} /> Notes {pencil ? 'on' : 'off'}
              </button>
              <button className="sudoku-tool" onClick={hint} disabled={game.won} title="Fill in one square for me (H)">
                <Lightbulb size={16} /> Hint
              </button>
              <button className="sudoku-tool" onClick={() => start(game.difficulty)} title="Start a new puzzle">
                <RotateCcw size={16} /> New
              </button>
            </div>
            <p className="sudoku-help">
              Fill the grid so every row, column and 3×3 box has the numbers 1 to 9 once each. Click a square, then a number (or type it). Mistakes turn red.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
