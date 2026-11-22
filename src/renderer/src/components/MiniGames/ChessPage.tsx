import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Bot, ChevronLeft, ChevronRight, ChevronsRight, Crown, Flag, Handshake, RefreshCw, RotateCcw, Trophy, Undo2, User, Users } from 'lucide-react'
import {
  colorOf,
  computerMove,
  fromFen,
  inCheck,
  kingSquare,
  legalMoves,
  LEVELS,
  makeMove,
  positionKey,
  START_FEN,
  statusOf,
  toFen,
  toSan,
  type Color,
  type Level,
  type Move,
  type Position,
  type Status
} from '../../lib/chess'
import { pieceSrc } from '../../lib/chessPieces'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { playSound } from '../../lib/sounds'
import { formatTime } from '../../lib/sudoku'
import GameStats from './GameStats'

type Mode = 'computer' | 'friend'

interface Game {
  mode: Mode
  level: Level
  /** Your side against the computer. */
  you: Color
  /** Every position so far, as FEN, starting with the first. */
  fens: string[]
  sans: string[]
  /** Each move's from and to squares, for highlighting and replaying. */
  squares?: [number, number][]
  seconds: number
  /** Set once the game is over. */
  end: { reason: Status | 'resigned'; winner: Color | null } | null
  counted: boolean
}

// The game and board settings live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.chess.game'
const SPIN_KEY = 'notesapp.chess.spin'
const statsId = (level: Level): string => `chess:${level}`

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Game | null
    return g && Array.isArray(g.fens) && g.fens.length ? g : null
  } catch {
    return null
  }
}

const fresh = (mode: Mode, level: Level, you: Color): Game => ({ mode, level, you, fens: [START_FEN], sans: [], squares: [], seconds: 0, end: null, counted: false })

const NAMES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }
const VALUES: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }
const START_COUNT: Record<string, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1 }
const FILES = 'abcdefgh'

const sideName = (c: Color): string => (c === 'w' ? 'White' : 'Black')
const nameOf = (sq: number): string => FILES[sq & 7] + (8 - (sq >> 3))

function endText(end: NonNullable<Game['end']>): string {
  switch (end.reason) {
    case 'checkmate':
      return `Checkmate. ${sideName(end.winner!)} wins.`
    case 'resigned':
      return `${sideName(end.winner === 'w' ? 'b' : 'w')} resigned.`
    case 'stalemate':
      return 'Stalemate: no legal move, but not in check.'
    case 'fifty':
      return '50 moves each without a capture or a pawn move.'
    case 'material':
      return 'Not enough pieces left for anyone to checkmate.'
    case 'repetition':
      return 'The same position came up three times.'
    default:
      return ''
  }
}

/** Pieces each side has lost, and White's lead in material (negative when Black is ahead). */
function lostPieces(p: Position): { w: string[]; b: string[]; lead: number } {
  const out = { w: [] as string[], b: [] as string[], lead: 0 }
  for (const color of ['w', 'b'] as Color[]) {
    for (const type of 'QRBNP') {
      const piece = color === 'w' ? type : type.toLowerCase()
      const left = p.board.filter((x) => x === piece).length
      for (let i = left; i < START_COUNT[type]; i++) out[color].push(piece)
      out.lead += (color === 'w' ? 1 : -1) * left * VALUES[type]
    }
  }
  return out
}

interface Drag {
  from: number
  pointer: number
  startX: number
  startY: number
  x: number
  y: number
  moving: boolean
  /** The square under the pointer. */
  over: number | null
}

/** Chess against the computer (easy, medium or hard) or a friend on the same computer. */
export default function ChessPage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? fresh('computer', 'easy', 'w'))
  const [records, setRecords] = useState<Record<string, GameRecord>>(() => loadRecords())
  const [selected, setSelected] = useState<number | null>(null)
  const [promo, setPromo] = useState<Move[] | null>(null)
  const [flipped, setFlipped] = useState(false)
  // Two players: turn the board round to whoever's move it is.
  const [spin, setSpin] = useState(() => localStorage.getItem(SPIN_KEY) === '1')
  const [thinking, setThinking] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** Looking back at an earlier position (its index in fens); null is the live game. */
  const [viewing, setViewing] = useState<number | null>(null)
  /** The move that should slide into place (moves you dragged are already there). */
  const [slideAt, setSlideAt] = useState<number | null>(null)
  const boardEl = useRef<HTMLDivElement>(null)
  const moveList = useRef<HTMLOListElement>(null)

  const squares = game.squares ?? []
  const live = viewing === null
  const shownIndex = viewing ?? game.fens.length - 1
  const pos = useMemo(() => fromFen(game.fens[game.fens.length - 1]), [game.fens])
  const shown = useMemo(() => fromFen(game.fens[shownIndex]), [game.fens, shownIndex])
  const keys = useMemo(() => game.fens.map((f) => positionKey(fromFen(f))), [game.fens])
  const moves = useMemo(() => legalMoves(pos), [pos])
  const vsComputer = game.mode === 'computer'
  const computerTurn = vsComputer && !game.end && pos.turn !== game.you
  const yourMoves = game.fens.length - 1 - (game.you === 'w' ? 0 : 1) > 0
  const record = records[statsId(game.level)]
  const lastMove = shownIndex > 0 ? squares[shownIndex - 1] : undefined

  // Who sits at the bottom: you against the computer; with two players, White (or whoever's turn, if the board spins).
  const baseBottom: Color = vsComputer ? game.you : spin ? pos.turn : 'w'
  const bottom: Color = flipped ? (baseBottom === 'w' ? 'b' : 'w') : baseBottom
  const top: Color = bottom === 'w' ? 'b' : 'w'
  const checkSq = inCheck(shown) ? kingSquare(shown.board, shown.turn) : null
  const lost = useMemo(() => lostPieces(shown), [shown])

  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(game))
    } catch {
      // Not remembered; it still plays.
    }
  }, [game])

  useEffect(() => {
    try {
      localStorage.setItem(SPIN_KEY, spin ? '1' : '0')
    } catch {
      // Not remembered.
    }
  }, [spin])

  useEffect(() => {
    const list = moveList.current
    const current = list?.querySelector('.current') as HTMLElement | null
    if (list && current) list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 2)
    else if (list && live) list.scrollTop = list.scrollHeight
  }, [game.sans.length, viewing, live])

  // The clock starts with the first move and runs while the window is in front.
  const running = game.fens.length > 1 && !game.end
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g.end ? g : { ...g, seconds: g.seconds + 1 }))
    }, 1000)
    return () => clearInterval(tick)
  }, [running])

  // Count games against the computer: only a win keeps the streak going.
  useEffect(() => {
    if (!game.end || game.counted || game.mode !== 'computer') return
    saveGame(statsId(game.level), game.end.winner === game.you, game.seconds)
    setRecords(loadRecords())
    setGame((g) => ({ ...g, counted: true }))
  }, [game.end, game.counted, game.mode, game.level, game.you, game.seconds])

  const play = (m: Move, dragged = false): void => {
    const p = pos
    const san = toSan(p, m)
    const next = makeMove(p, m)
    const fens = [...game.fens, toFen(next)]
    const status = statusOf(
      next,
      fens.map((f) => positionKey(fromFen(f)))
    )
    const end = status === 'playing' ? null : { reason: status, winner: status === 'checkmate' ? p.turn : null }
    setGame((g) => ({ ...g, fens, sans: [...g.sans, san], squares: [...(g.squares ?? []), [m.from, m.to]], end }))
    setSlideAt(dragged ? null : fens.length - 1)
    setSelected(null)
    setPromo(null)
    setViewing(null)
    playSound(m.captured ? 'capture' : 'piece')
  }

  // The computer's turn: think after a short pause so its move doesn't appear instantly.
  useEffect(() => {
    if (!computerTurn) return
    setThinking(true)
    const t = setTimeout(() => {
      const m = computerMove(pos, game.level, Math.random, keys)
      setThinking(false)
      if (m) play(m)
    }, 450)
    return () => {
      clearTimeout(t)
      setThinking(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, pos, game.level])

  const start = (mode: Mode, level: Level, you: Color): void => {
    // Leaving a game against the computer you'd made a move in counts as a loss.
    if (game.mode === 'computer' && !game.end && !game.counted && yourMoves) {
      saveGame(statsId(game.level), false)
      setRecords(loadRecords())
    }
    setGame(fresh(mode, level, you))
    setSelected(null)
    setPromo(null)
    setFlipped(false)
    setViewing(null)
    setSlideAt(null)
  }

  const resign = (): void => {
    if (game.end) return
    // Against a friend, the side to move resigns.
    const loser = vsComputer ? game.you : pos.turn
    setGame((g) => ({ ...g, end: { reason: 'resigned', winner: loser === 'w' ? 'b' : 'w' } }))
  }

  const undo = (): void => {
    if (game.end || thinking) return
    // Against the computer, take back its reply too so it's your turn again.
    const back = vsComputer && pos.turn === game.you ? 2 : 1
    const keep = Math.max(1, game.fens.length - back)
    if (keep === game.fens.length) return
    if (vsComputer && fromFen(game.fens[keep - 1]).turn !== game.you) return
    setGame((g) => ({ ...g, fens: g.fens.slice(0, keep), sans: g.sans.slice(0, keep - 1), squares: (g.squares ?? []).slice(0, keep - 1) }))
    setSelected(null)
    setPromo(null)
    setViewing(null)
    setSlideAt(null)
  }

  const canUndo = !game.end && !thinking && (vsComputer ? yourMoves : game.fens.length > 1)
  const yourTurn = live && !game.end && !computerTurn
  const active = drag?.from ?? selected
  const targets = active === null ? [] : moves.filter((m) => m.from === active)

  /** Moves the selected or dragged piece to `sq`, asking which piece for a promotion. True if it moved. */
  const tryMove = (from: number, sq: number, dragged: boolean): boolean => {
    const choices = moves.filter((m) => m.from === from && m.to === sq)
    if (choices.length > 1) {
      setSelected(from)
      setPromo(choices)
      return true
    }
    if (choices.length === 1) {
      play(choices[0], dragged)
      return true
    }
    return false
  }

  const canPick = (sq: number): boolean => {
    const piece = pos.board[sq]
    return yourTurn && !!piece && colorOf(piece) === pos.turn && moves.some((m) => m.from === sq)
  }

  const clickSquare = (sq: number): void => {
    if (!yourTurn || promo) return
    if (selected !== null && tryMove(selected, sq, false)) return
    setSelected(canPick(sq) && sq !== selected ? sq : null)
  }

  /** The board square under a point on the screen. */
  const squareAt = (x: number, y: number): number | null => {
    const r = boardEl.current?.getBoundingClientRect()
    if (!r || x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null
    const col = Math.floor(((x - r.left) / r.width) * 8)
    const row = Math.floor(((y - r.top) / r.height) * 8)
    return bottom === 'w' ? row * 8 + col : (7 - row) * 8 + (7 - col)
  }

  // Dragging: press on your piece, move, and let go on a square. A press without moving is a click.
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || promo) return
    const sq = squareAt(e.clientX, e.clientY)
    if (sq === null) return
    if (!canPick(sq)) return
    if (selected !== null && selected !== sq && targets.some((m) => m.to === sq)) return
    e.preventDefault()
    boardEl.current?.setPointerCapture(e.pointerId)
    setDrag({ from: sq, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moving: false, over: sq })
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return
    const moving = drag.moving || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moving, over: squareAt(e.clientX, e.clientY) })
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return
    const d = drag
    setDrag(null)
    if (!d.moving) {
      // Just a click on your own piece: pick it up (or put it down again).
      setSelected(selected === d.from ? null : d.from)
      return
    }
    if (d.over === null || d.over === d.from || !tryMove(d.from, d.over, true)) setSelected(d.from)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const last = game.fens.length - 1
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setViewing(Math.max(0, shownIndex - 1))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setViewing(shownIndex + 1 >= last ? null : shownIndex + 1)
    } else if (e.key === 'Escape') {
      setSelected(null)
      setViewing(null)
    }
  }

  const order = [...Array(64).keys()]
  if (bottom === 'b') order.reverse()

  // How far the last move's piece travels on screen, in squares, for the slide.
  const slide = (() => {
    if (!live || slideAt !== game.fens.length - 1 || !lastMove) return null
    const [from, to] = lastMove
    const sign = bottom === 'w' ? 1 : -1
    return { to, dx: sign * ((from & 7) - (to & 7)), dy: sign * ((from >> 3) - (to >> 3)) }
  })()

  const status = game.end
    ? game.end.winner === null
      ? `Draw. ${endText(game.end)}`
      : endText(game.end)
    : thinking
      ? 'The computer is thinking'
      : vsComputer
        ? pos.turn === game.you
          ? checkSq !== null
            ? 'Check! Your move'
            : 'Your move'
          : 'Computer to move'
        : `${sideName(pos.turn)} to move${checkSq !== null ? ', in check' : ''}`

  const player = (color: Color) => {
    const isComputer = vsComputer && color !== game.you
    const name = vsComputer ? (isComputer ? `Computer · ${LEVELS.find((l) => l.id === game.level)?.label}` : 'You') : sideName(color)
    const theirLost = lost[color === 'w' ? 'b' : 'w']
    const lead = color === 'w' ? lost.lead : -lost.lead
    const toMove = !game.end && pos.turn === color && live
    return (
      <div className={`chess-player ${toMove ? 'to-move' : ''}`} data-chess-player={color}>
        <span className={`chess-avatar ${color}`}>{isComputer ? <Bot size={16} /> : <User size={16} />}</span>
        <div className="chess-player-text">
          <strong>
            {name}
            {isComputer && thinking && (
              <span className="chess-dots" aria-label="thinking">
                <i />
                <i />
                <i />
              </span>
            )}
          </strong>
          <div className="chess-taken" aria-label={`Pieces ${name} has taken`}>
            {theirLost.map((p, i) => (
              <img key={i} src={pieceSrc(p)} alt={NAMES[p.toUpperCase()]} draggable={false} />
            ))}
            {lead > 0 && <small>+{lead}</small>}
          </div>
        </div>
      </div>
    )
  }

  const boardCls = ['chess-board', yourTurn ? 'live' : '', drag?.moving ? 'dragging' : '', !live ? 'reviewing' : ''].filter(Boolean).join(' ')

  return (
    <div className="sudoku-page chess-page" data-chess-page>
      <div className="sudoku-inner chess-inner" onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <Crown size={20} /> Chess
          </h2>
          <div className="sudoku-levels" role="group" aria-label="Who you play">
            <button className={`sudoku-level ${vsComputer ? 'active' : ''}`} onClick={() => start('computer', game.level, game.you)} title="Play against the computer">
              <Bot size={14} /> Computer
            </button>
            <button className={`sudoku-level ${!vsComputer ? 'active' : ''}`} onClick={() => start('friend', game.level, 'w')} title="Two players taking turns on this computer">
              <Users size={14} /> Two players
            </button>
          </div>
        </header>

        <div className="chess-options">
          {vsComputer ? (
            <>
              <div className="sudoku-levels" role="group" aria-label="How hard">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    className={`sudoku-level ${game.level === l.id ? 'active' : ''}`}
                    onClick={() => start('computer', l.id, game.you)}
                    title={`Start a new game on ${l.label.toLowerCase()}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="sudoku-levels" role="group" aria-label="Your side">
                {(['w', 'b'] as Color[]).map((c) => (
                  <button key={c} className={`sudoku-level ${game.you === c ? 'active' : ''}`} onClick={() => start('computer', game.level, c)} title={`Start a new game playing ${sideName(c)}`}>
                    <img className="chess-option-piece" src={pieceSrc(c === 'w' ? 'K' : 'k')} alt="" draggable={false} /> Play {sideName(c)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className={`sudoku-tool ${spin ? 'active' : ''}`} onClick={() => setSpin((s) => !s)} aria-pressed={spin} title="Turn the board to face whoever's move it is">
              <RefreshCw size={14} /> Turn board each move {spin ? 'on' : 'off'}
            </button>
          )}
        </div>

        <div className="chess-play">
          <div className="chess-board-col">
            {player(top)}
            <div
              ref={boardEl}
              className={boardCls}
              role="grid"
              aria-label="Chess board"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              data-chess-board
            >
              {order.map((sq, i) => {
                const piece = shown.board[sq]
                const dark = ((sq >> 3) + (sq & 7)) % 2 === 1
                const target = live ? targets.find((m) => m.to === sq) : undefined
                const row = i >> 3
                const col = i & 7
                const hidden = drag?.moving && drag.from === sq
                const sliding = slide && slide.to === sq
                return (
                  <div
                    key={sq}
                    className={[
                      'chess-sq',
                      dark ? 'sq-dark' : 'sq-light',
                      sq === active && live ? 'sq-selected' : '',
                      lastMove?.includes(sq) ? 'sq-last' : '',
                      sq === checkSq ? 'sq-check' : '',
                      target ? (shown.board[sq] || target.ep ? 'sq-take' : 'sq-move') : '',
                      drag?.moving && drag.over === sq && target ? 'sq-over' : '',
                      canPick(sq) ? 'sq-pick' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => !drag && clickSquare(sq)}
                    role="gridcell"
                    aria-label={`${nameOf(sq)}${piece ? `, ${sideName(colorOf(piece))} ${NAMES[piece.toUpperCase()]}` : ''}`}
                    data-sq={nameOf(sq)}
                  >
                    {col === 0 && <span className="chess-coord rank">{8 - (sq >> 3)}</span>}
                    {row === 7 && <span className="chess-coord file">{FILES[sq & 7]}</span>}
                    {target && <span className="chess-hint" />}
                    {piece && (
                      <img
                        key={sliding ? `slide-${game.fens.length}` : 'still'}
                        className={`chess-img ${hidden ? 'lifted' : ''} ${sliding ? 'slide' : ''}`}
                        style={sliding ? ({ '--dx': slide.dx, '--dy': slide.dy } as CSSProperties) : undefined}
                        src={pieceSrc(piece)}
                        alt=""
                        draggable={false}
                      />
                    )}
                  </div>
                )
              })}

              {promo && (
                <div className="chess-promo" data-chess-promo>
                  <span>Turn your pawn into</span>
                  <div>
                    {promo.map((m) => (
                      <button key={m.promo} onClick={() => play(m)} title={NAMES[m.promo!.toUpperCase()]}>
                        <img src={pieceSrc(m.promo!)} alt={NAMES[m.promo!.toUpperCase()]} draggable={false} />
                      </button>
                    ))}
                  </div>
                  <button className="btn" onClick={() => (setPromo(null), setSelected(null))}>
                    Cancel
                  </button>
                </div>
              )}

              {game.end && live && (
                <div className="chess-result" data-chess-result>
                  <div className="chess-result-card">
                    {game.end.winner ? <Trophy size={30} /> : <Handshake size={30} />}
                    <strong>
                      {game.end.winner === null
                        ? 'Draw'
                        : vsComputer
                          ? game.end.winner === game.you
                            ? 'You won!'
                            : 'The computer won'
                          : `${sideName(game.end.winner)} wins!`}
                    </strong>
                    <span>{endText(game.end)}</span>
                    {vsComputer && game.end.winner === game.you && (
                      <span className="chess-result-extra">
                        {formatTime(game.seconds)}
                        {record?.bestTime === game.seconds ? ' · your fastest win' : ''}
                        {record && record.streak > 1 ? ` · ${record.streak} wins in a row` : ''}
                      </span>
                    )}
                    <div className="chess-result-buttons">
                      <button className="btn" onClick={() => setViewing(Math.max(0, game.fens.length - 2))}>
                        Look back
                      </button>
                      <button className="btn btn-primary" onClick={() => start(game.mode, game.level, game.you)}>
                        Play again
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {player(bottom)}
          </div>

          <div className="chess-side">
            <div className={`chess-status ${game.end ? 'over' : ''} ${checkSq !== null && !game.end && live ? 'check' : ''}`} data-chess-status>
              <span className={`chess-turn-dot ${pos.turn}`} />
              <span>
                {status}
                {thinking && '…'}
              </span>
              <span className="chess-clock" title="How long this game has been going">
                {formatTime(game.seconds)}
              </span>
            </div>

            <ol className="chess-moves" ref={moveList} data-chess-moves>
              {Array.from({ length: Math.ceil(game.sans.length / 2) }, (_, i) => (
                <li key={i}>
                  <span className="chess-move-no">{i + 1}.</span>
                  {[0, 1].map((k) => {
                    const idx = i * 2 + k
                    const san = game.sans[idx]
                    if (!san) return <span key={k} />
                    return (
                      <button
                        key={k}
                        className={`chess-move ${shownIndex === idx + 1 ? 'current' : ''}`}
                        onClick={() => setViewing(idx + 1 === game.fens.length - 1 ? null : idx + 1)}
                        title="Look at the board after this move"
                      >
                        {san}
                      </button>
                    )
                  })}
                </li>
              ))}
              {!game.sans.length && <li className="chess-none">Moves show up here. Drag a piece, or click it and then click a square.</li>}
            </ol>

            <div className="chess-nav">
              <button className="sudoku-tool" onClick={() => setViewing(Math.max(0, shownIndex - 1))} disabled={shownIndex === 0} title="Back one move (←)">
                <ChevronLeft size={16} />
              </button>
              <button
                className="sudoku-tool"
                onClick={() => setViewing(shownIndex + 1 >= game.fens.length - 1 ? null : shownIndex + 1)}
                disabled={live}
                title="Forward one move (→)"
              >
                <ChevronRight size={16} />
              </button>
              <button className="sudoku-tool" onClick={() => setViewing(null)} disabled={live} title="Back to the game">
                <ChevronsRight size={16} />
              </button>
            </div>
            {!live && <p className="chess-reviewing">Looking back at move {Math.ceil(shownIndex / 2)}. Press → or the last button to return.</p>}

            <div className="chess-actions">
              <button className="sudoku-tool" onClick={undo} disabled={!canUndo} title="Take back your last move">
                <Undo2 size={15} /> Undo
              </button>
              <button className="sudoku-tool" onClick={() => setFlipped((f) => !f)} title="Turn the board around">
                <RefreshCw size={15} /> Flip
              </button>
              <button className="sudoku-tool" onClick={resign} disabled={!!game.end || game.fens.length < 2} title="Give up this game">
                <Flag size={15} /> Resign
              </button>
              <button className="sudoku-tool" onClick={() => start(game.mode, game.level, game.you)} title="Start a new game">
                <RotateCcw size={15} /> New game
              </button>
            </div>
          </div>
        </div>

        {drag?.moving && (
          <img
            className="chess-drag-ghost"
            src={pieceSrc(pos.board[drag.from]!)}
            alt=""
            draggable={false}
            style={{ left: drag.x, top: drag.y, width: (boardEl.current?.clientWidth ?? 480) / 8 } as CSSProperties}
          />
        )}

        {vsComputer ? (
          <GameStats title={`Chess against the computer, ${game.level}`} record={record} />
        ) : (
          <p className="sudoku-help">Two players: take turns at the same computer. Stats and streaks are kept for games against the computer.</p>
        )}

        <p className="sudoku-help">
          Drag a piece to move it, or click it and then click a square. Dots show where it can go and rings show what it can take. Castle by moving the king two
          squares. Click any move in the list (or use ← →) to look back. Undo takes back your last move and the computer’s reply. Easy makes mistakes, medium
          plays sensibly, hard thinks further ahead. Leaving or resigning a game against the computer counts as a loss.
        </p>
      </div>
    </div>
  )
}
