import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Lightbulb, RotateCcw, Skull, TextSearch, Trophy } from 'lucide-react'
import { displayWord, makeWordSearch, sizeOf, snapLine, themeOf, walkingDeadSearchKind, wordAt, WORD_SEARCH_SIZES, type WordSearch, type WordSearchSize } from '../../lib/wordSearch'
import { WORD_SEARCH_THEMES, type WordSearchTheme } from '../../lib/wordSearchWords'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'
import { petCheer } from '../../lib/pet'
import GameStats from './GameStats'

/** A puzzle in progress (or just finished). */
interface Game {
  puzzle: WordSearch
  /** Found words, in the order they were found (which picks their colour). */
  found: string[]
  seconds: number
  hints: number
  won: boolean
  /** Already added to the stats (a win, or a puzzle left part way through). */
  counted: boolean
}

// The puzzle lives on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.wordsearch.game'

function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(GAME_KEY)
    const g = raw ? (JSON.parse(raw) as Game) : null
    const p = g?.puzzle
    const ok =
      !!p &&
      WORD_SEARCH_THEMES.some((t) => t.id === p.theme) &&
      WORD_SEARCH_SIZES.some((s) => s.id === p.size) &&
      typeof p.letters === 'string' &&
      p.letters.length === p.grid * p.grid &&
      Array.isArray(p.words) &&
      Array.isArray(g!.found)
    return ok ? g : null
  } catch {
    return null
  }
}

function saveGameState(g: Game): void {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(g))
  } catch {
    // Storage full or blocked: the game still works, it just won't be remembered.
  }
}

const newGame = (theme: WordSearchTheme, size: WordSearchSize): Game => ({
  puzzle: makeWordSearch(theme, size),
  found: [],
  seconds: 0,
  hints: 0,
  won: false,
  counted: false
})

const statsId = (p: WordSearch): string => `wordsearch:${p.theme}:${p.size}`

/** A different colour for each found word, going round the wheel so neighbours don't match. */
const hueOf = (n: number): number => (n * 137 + 200) % 360

/** Word search: find the theme's words hidden in the letters, as many puzzles as you like. */
export default function WordSearchPage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? newGame('walkingDead', 'medium'))
  const [records, setRecords] = useState<Record<string, GameRecord>>(loadRecords)
  const [selection, setSelection] = useState<number[]>([])
  // A first square clicked (not dragged): the next click picks the line from here.
  const [anchor, setAnchor] = useState<number | null>(null)
  const [hinted, setHinted] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: 'found' | 'miss' } | null>(null)
  const dragFrom = useRef<number | null>(null)
  const board = useRef<HTMLDivElement>(null)

  const { puzzle } = game
  const { grid } = puzzle
  const theme = themeOf(puzzle.theme)
  const twd = puzzle.theme === 'walkingDead'

  useEffect(() => saveGameState(game), [game])
  useEffect(() => board.current?.focus(), [])

  useEffect(() => {
    if (game.won) return
    const tick = setInterval(() => setGame((g) => (g.won ? g : { ...g, seconds: g.seconds + 1 })), 1000)
    return () => clearInterval(tick)
  }, [game.won])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2200)
    return () => clearTimeout(t)
  }, [message])

  useEffect(() => {
    if (hinted === null) return
    const t = setTimeout(() => setHinted(null), 2500)
    return () => clearTimeout(t)
  }, [hinted])

  /** Starts a new puzzle; one left part way through counts as not finished. */
  const start = (themeId: WordSearchTheme, size: WordSearchSize): void => {
    if (!game.counted && game.found.length > 0 && !game.won) {
      const id = statsId(puzzle)
      const rec = saveGame(id, false)
      setRecords((r) => ({ ...r, [id]: rec }))
    }
    setGame(newGame(themeId, size))
    setSelection([])
    setAnchor(null)
    setHinted(null)
    setMessage(null)
    board.current?.focus()
  }

  /** Checks a line of squares against the hidden words. */
  const check = (cells: number[]): void => {
    setSelection([])
    if (cells.length < 2 || game.won) return
    const hit = wordAt(puzzle, cells, game.found)
    if (!hit) {
      setMessage({ text: 'Not one of the words', tone: 'miss' })
      return
    }
    if (game.found.includes(hit.word)) {
      setMessage({ text: `Already found ${displayWord(hit.word)}`, tone: 'miss' })
      return
    }
    const found = [...game.found, hit.word]
    const won = found.length === puzzle.words.length
    const kind = twd ? walkingDeadSearchKind(hit.word) : null
    setMessage({ text: `${displayWord(hit.word)}${kind ? `: ${kind}` : ''}`, tone: 'found' })
    setGame((g) => ({ ...g, found, won, counted: g.counted || won }))
    if (won) {
      const id = statsId(puzzle)
      // A puzzle with hints still counts as a win, but not for the best time.
      const rec = saveGame(id, true, game.hints ? undefined : game.seconds)
      setRecords((r) => ({ ...r, [id]: rec }))
      petCheer()
    }
  }

  /** The square under the mouse, even between squares or off the edge of the board. */
  const squareAt = (e: PointerEvent): { row: number; col: number } | null => {
    const el = board.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const cell = rect.width / grid
    return { row: Math.floor((e.clientY - rect.top) / cell), col: Math.floor((e.clientX - rect.left) / cell) }
  }

  const onDown = (e: PointerEvent, i: number): void => {
    if (game.won || e.button !== 0) return
    e.preventDefault()
    board.current?.focus()
    board.current?.setPointerCapture(e.pointerId)
    const from = anchor !== null && anchor !== i ? anchor : i
    dragFrom.current = from
    const at = { row: Math.floor(i / grid), col: i % grid }
    setSelection(snapLine(grid, from, at.row, at.col))
  }

  const onMove = (e: PointerEvent): void => {
    if (dragFrom.current === null) return
    const at = squareAt(e)
    if (at) setSelection(snapLine(grid, dragFrom.current, at.row, at.col))
  }

  const onUp = (): void => {
    if (dragFrom.current === null) return
    const cells = selection
    dragFrom.current = null
    if (cells.length < 2) {
      // A single click: remember it, so a second click finishes the line (or clicking it again lets go).
      setAnchor((a) => (a === cells[0] ? null : (cells[0] ?? null)))
      setSelection([])
      return
    }
    setAnchor(null)
    check(cells)
  }

  const hint = (): void => {
    const left = puzzle.words.filter((p) => !game.found.includes(p.word))
    if (!left.length || game.won) return
    const pick = left[Math.floor(Math.random() * left.length)]
    setHinted(pick.cells[0])
    setMessage({ text: `${displayWord(pick.word)} starts at the flashing letter`, tone: 'found' })
    setGame((g) => ({ ...g, hints: g.hints + 1 }))
    board.current?.focus()
  }

  // Each square's colour: the most recently found word that covers it.
  const colour: (number | undefined)[] = new Array(grid * grid)
  game.found.forEach((w, n) => puzzle.words.find((p) => p.word === w)?.cells.forEach((c) => (colour[c] = hueOf(n))))
  const selected = new Set(selection)
  const cellSize = grid <= 10 ? 40 : grid <= 13 ? 34 : 30
  const size = sizeOf(puzzle.size)
  const record = records[statsId(puzzle)]

  return (
    <div className={`sudoku-page wordsearch-page ${twd ? 'twd' : ''}`} data-wordsearch-page>
      <div className="sudoku-inner wordsearch-inner">
        <header className="sudoku-head">
          <h2>
            {twd ? <Skull size={20} /> : <TextSearch size={20} />} Word search
          </h2>
          <div className="sudoku-levels" role="group" aria-label="Size">
            {WORD_SEARCH_SIZES.map((s) => (
              <button
                key={s.id}
                className={`sudoku-level ${puzzle.size === s.id ? 'active' : ''}`}
                onClick={() => start(puzzle.theme, s.id)}
                title={`${s.blurb}, ${s.words} words`}
                data-wordsearch-size={s.id}
              >
                {s.label}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-levels wordsearch-themes" role="group" aria-label="Theme">
          {WORD_SEARCH_THEMES.map((t) => (
            <button
              key={t.id}
              className={`sudoku-level ${puzzle.theme === t.id ? 'active' : ''}`}
              onClick={() => start(t.id, puzzle.size)}
              title={t.id === 'walkingDead' ? 'Characters, places, groups and more from the main Walking Dead TV show' : `${t.words.length} ${t.label.toLowerCase()} words`}
              data-wordsearch-theme={t.id}
            >
              {t.id === 'walkingDead' && <Skull size={13} />} {t.label}
            </button>
          ))}
        </div>

        <div className="sudoku-status">
          <span>
            Found{' '}
            <strong data-wordsearch-count>
              {game.found.length} of {puzzle.words.length}
            </strong>
          </span>
          <span className="sudoku-time">{formatTime(game.seconds)}</span>
          <span className="mines-tools">
            {message && (
              <span className={`wordsearch-message ${message.tone}`} role="status" data-wordsearch-message>
                {message.text}
              </span>
            )}
            <button className="sudoku-tool" onClick={hint} disabled={game.won} title="Flash the first letter of a word you haven't found (no best time)">
              <Lightbulb size={15} /> Hint
            </button>
            <button className="sudoku-tool" onClick={() => start(puzzle.theme, puzzle.size)} title="A new puzzle with different words" data-wordsearch-new>
              <RotateCcw size={15} /> New puzzle
            </button>
          </span>
        </div>

        <div className="wordsearch-play">
          <div
            ref={board}
            className={`wordsearch-board ${game.won ? 'won' : ''}`}
            style={{ '--ws-cols': grid, '--ws-cell': `${cellSize}px` } as CSSProperties}
            tabIndex={0}
            role="grid"
            aria-label={`Word search, ${grid} by ${grid}`}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              dragFrom.current = null
              setSelection([])
            }}
            data-wordsearch-board
          >
            {[...puzzle.letters].map((letter, i) => {
              const hue = colour[i]
              return (
                <div
                  key={i}
                  className={`wordsearch-cell ${hue !== undefined ? 'found' : ''} ${selected.has(i) ? 'selected' : ''} ${anchor === i ? 'anchor' : ''} ${hinted === i ? 'hinted' : ''}`}
                  style={hue !== undefined ? ({ '--ws-hue': hue } as CSSProperties) : undefined}
                  onPointerDown={(e) => onDown(e, i)}
                  role="gridcell"
                  data-cell={i}
                >
                  {letter.toUpperCase()}
                </div>
              )
            })}
          </div>

          <aside className="wordsearch-words" aria-label="Words to find">
            <h3>
              {theme.label} · {size.label}
            </h3>
            <ul>
              {puzzle.words.map(({ word }) => {
                const n = game.found.indexOf(word)
                const kind = twd ? walkingDeadSearchKind(word) : null
                return (
                  <li
                    key={word}
                    className={n >= 0 ? 'found' : ''}
                    style={n >= 0 ? ({ '--ws-hue': hueOf(n) } as CSSProperties) : undefined}
                    title={n >= 0 && kind ? kind : undefined}
                    data-word={word}
                  >
                    {displayWord(word)}
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>

        {game.won && (
          <div className="nono-result" data-wordsearch-result>
            {twd ? <Skull size={26} /> : <Trophy size={26} />}
            <strong>All {puzzle.words.length} found!</strong>
            <span>
              {formatTime(game.seconds)}
              {game.hints ? ` · ${game.hints} hint${game.hints === 1 ? '' : 's'}` : ''}
            </span>
            <button className="btn btn-primary" onClick={() => start(puzzle.theme, puzzle.size)} data-wordsearch-again>
              Next puzzle
            </button>
          </div>
        )}

        <GameStats title={`${theme.label}, ${size.label.toLowerCase()}`} record={record} />

        <p className="sudoku-help">
          Drag across the letters to circle a word, or click its first letter and then its last. {size.blurb}. Every puzzle is a new mix of words, so
          you can play as many as you like. Each theme and size keeps its own stats.
          {twd && ' Walking Dead words are all from the main TV show: characters, family names, places, groups and things, never everyday zombie words.'}
        </p>
      </div>
    </div>
  )
}
