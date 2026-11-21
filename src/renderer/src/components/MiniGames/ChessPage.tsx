import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Crown, Flag, Handshake, RefreshCw, RotateCcw, Trophy, Undo2, Users } from 'lucide-react'
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
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
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
  /** The last move's squares, for highlighting. */
  last: [number, number] | null
  seconds: number
  /** Set once the game is over. */
  end: { reason: Status | 'resigned'; winner: Color | null } | null
  counted: boolean
}

// The game lives on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.chess.game'
const statsId = (level: Level): string => `chess:${level}`

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Game | null
    return g && Array.isArray(g.fens) && g.fens.length ? g : null
  } catch {
    return null
  }
}

const fresh = (mode: Mode, level: Level, you: Color): Game => ({ mode, level, you, fens: [START_FEN], sans: [], last: null, seconds: 0, end: null, counted: false })

// Text style (not emoji) chess pieces; colour comes from CSS.
const GLYPH: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
const glyph = (p: string): string => GLYPH[p.toUpperCase()] + '︎'
const NAMES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' }
const VALUES: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 }
const START_COUNT: Record<string, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1 }

const sideName = (c: Color): string => (c === 'w' ? 'White' : 'Black')

function endText(end: NonNullable<Game['end']>): string {
  switch (end.reason) {
    case 'checkmate':
      return `Checkmate. ${sideName(end.winner!)} wins.`
    case 'resigned':
      return `${sideName(end.winner === 'w' ? 'b' : 'w')} resigned. ${sideName(end.winner!)} wins.`
    case 'stalemate':
      return 'Stalemate: no legal move, but not in check. It’s a draw.'
    case 'fifty':
      return 'Draw: 50 moves each without a capture or a pawn move.'
    case 'material':
      return 'Draw: not enough pieces left for anyone to checkmate.'
    case 'repetition':
      return 'Draw: the same position came up three times.'
    default:
      return ''
  }
}

/** Pieces taken from each side, and who is ahead on material. */
function captured(p: Position): { w: string[]; b: string[]; lead: number } {
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

/** Chess against the computer (easy, medium or hard) or a friend on the same computer. */
export default function ChessPage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? fresh('computer', 'easy', 'w'))
  const [records, setRecords] = useState<Record<string, GameRecord>>(() => loadRecords())
  const [selected, setSelected] = useState<number | null>(null)
  const [promo, setPromo] = useState<Move[] | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [thinking, setThinking] = useState(false)
  const moveList = useRef<HTMLOListElement>(null)

  const pos = useMemo(() => fromFen(game.fens[game.fens.length - 1]), [game.fens])
  const keys = useMemo(() => game.fens.map((f) => positionKey(fromFen(f))), [game.fens])
  const moves = useMemo(() => legalMoves(pos), [pos])
  const vsComputer = game.mode === 'computer'
  const computerTurn = vsComputer && !game.end && pos.turn !== game.you
  const yourMoves = game.fens.length - 1 - (game.you === 'w' ? 0 : 1) > 0
  const record = records[statsId(game.level)]
  // Against the computer you see your own side at the bottom.
  const bottom: Color = (vsComputer ? game.you : 'w') === 'w' ? (flipped ? 'b' : 'w') : flipped ? 'w' : 'b'
  const checkSq = inCheck(pos) ? kingSquare(pos.board, pos.turn) : null
  const taken = useMemo(() => captured(pos), [pos])

  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(game))
    } catch {
      // Not remembered; it still plays.
    }
  }, [game])

  useEffect(() => {
    moveList.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [game.sans.length])

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

  const play = (m: Move): void => {
    setGame((g) => {
      const p = fromFen(g.fens[g.fens.length - 1])
      const san = toSan(p, m)
      const next = makeMove(p, m)
      const fens = [...g.fens, toFen(next)]
      const status = statusOf(
        next,
        fens.map((f) => positionKey(fromFen(f)))
      )
      const end = status === 'playing' ? null : { reason: status, winner: status === 'checkmate' ? p.turn : null }
      return { ...g, fens, sans: [...g.sans, san], last: [m.from, m.to], end }
    })
    setSelected(null)
    setPromo(null)
  }

  // The computer's turn: think after a short pause so its move doesn't appear instantly.
  useEffect(() => {
    if (!computerTurn) return
    setThinking(true)
    const t = setTimeout(() => {
      const m = computerMove(pos, game.level, Math.random, keys)
      setThinking(false)
      if (m) play(m)
    }, 350)
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
    let back = 1
    if (vsComputer) back = pos.turn === game.you ? 2 : 1
    const keep = Math.max(1, game.fens.length - back)
    if (keep === game.fens.length) return
    if (vsComputer && fromFen(game.fens[keep - 1]).turn !== game.you) return
    setGame((g) => {
      const fens = g.fens.slice(0, keep)
      return { ...g, fens, sans: g.sans.slice(0, keep - 1), last: null }
    })
    setSelected(null)
    setPromo(null)
  }

  const canUndo = !game.end && !thinking && (vsComputer ? yourMoves && game.fens.length > 1 : game.fens.length > 1)

  const yourTurn = !game.end && !computerTurn
  const targets = selected === null ? [] : moves.filter((m) => m.from === selected)

  const clickSquare = (sq: number): void => {
    if (!yourTurn || promo) return
    const piece = pos.board[sq]
    if (selected !== null) {
      const choices = targets.filter((m) => m.to === sq)
      if (choices.length > 1) return void setPromo(choices)
      if (choices.length === 1) return play(choices[0])
    }
    if (piece && colorOf(piece) === pos.turn && moves.some((m) => m.from === sq)) setSelected(sq === selected ? null : sq)
    else setSelected(null)
  }

  const order = [...Array(64).keys()]
  if (bottom === 'b') order.reverse()

  const status = game.end
    ? endText(game.end)
    : thinking
      ? 'The computer is thinking…'
      : `${vsComputer ? (pos.turn === game.you ? 'Your move' : 'Computer to move') : `${sideName(pos.turn)} to move`}${checkSq !== null ? ' · Check!' : ''}`

  const takenRow = (color: Color) => {
    const pieces = taken[color]
    const lead = color === 'w' ? -taken.lead : taken.lead
    return (
      <div className="chess-taken" aria-label={`${sideName(color)} pieces taken`}>
        {pieces.map((p, i) => (
          <span key={i} className={`chess-piece ${colorOf(p)}`}>
            {glyph(p)}
          </span>
        ))}
        {lead > 0 && <small>+{lead}</small>}
      </div>
    )
  }

  return (
    <div className="sudoku-page chess-page" data-chess-page>
      <div className="sudoku-inner chess-inner">
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

        {vsComputer && (
          <div className="chess-options">
            <div className="sudoku-levels" role="group" aria-label="How hard">
              {LEVELS.map((l) => (
                <button key={l.id} className={`sudoku-level ${game.level === l.id ? 'active' : ''}`} onClick={() => start('computer', l.id, game.you)} title={`Start a new game on ${l.label.toLowerCase()}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="sudoku-levels" role="group" aria-label="Your side">
              {(['w', 'b'] as Color[]).map((c) => (
                <button key={c} className={`sudoku-level ${game.you === c ? 'active' : ''}`} onClick={() => start('computer', game.level, c)} title={`Start a new game playing ${sideName(c)}`}>
                  Play {sideName(c)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long this game has been going">
            {formatTime(game.seconds)}
          </span>
          <span className={`chess-turn ${game.end ? 'over' : ''} ${checkSq !== null && !game.end ? 'check' : ''}`} data-chess-status>
            {status}
          </span>
          <span className="mines-tools">
            <button className="sudoku-tool" onClick={undo} disabled={!canUndo} title="Take back the last move">
              <Undo2 size={15} /> Undo
            </button>
            <button className="sudoku-tool" onClick={() => setFlipped((f) => !f)} title="Turn the board around">
              <RefreshCw size={15} /> Turn
            </button>
            <button className="sudoku-tool" onClick={resign} disabled={!!game.end || game.fens.length < 2} title="Give up this game">
              <Flag size={15} /> Resign
            </button>
            <button className="sudoku-tool" onClick={() => start(game.mode, game.level, game.you)} title="Start a new game">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div className="chess-play">
          <div className="chess-board-wrap">
            {takenRow(bottom)}
            <div className={`chess-board ${yourTurn ? 'live' : ''}`} role="grid" aria-label="Chess board" data-chess-board>
              {order.map((sq, i) => {
                const piece = pos.board[sq]
                const dark = ((sq >> 3) + (sq & 7)) % 2 === 1
                const target = targets.find((m) => m.to === sq)
                const row = i >> 3
                const col = i & 7
                const name = 'abcdefgh'[sq & 7] + (8 - (sq >> 3))
                return (
                  <button
                    key={sq}
                    className={[
                      'chess-sq',
                      dark ? 'dark' : 'light',
                      sq === selected ? 'selected' : '',
                      game.last?.includes(sq) ? 'last' : '',
                      sq === checkSq ? 'check' : '',
                      target ? (target.captured ? 'capture' : 'move') : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => clickSquare(sq)}
                    aria-label={`${name}${piece ? `, ${sideName(colorOf(piece))} ${NAMES[piece.toUpperCase()]}` : ''}`}
                    data-sq={name}
                  >
                    {col === 0 && <span className="chess-rank">{8 - (sq >> 3)}</span>}
                    {row === 7 && <span className="chess-file">{'abcdefgh'[sq & 7]}</span>}
                    {piece && <span className={`chess-piece ${colorOf(piece)}`}>{glyph(piece)}</span>}
                  </button>
                )
              })}
              {promo && (
                <div className="chess-promo" data-chess-promo>
                  <span>Turn your pawn into</span>
                  <div>
                    {promo.map((m) => (
                      <button key={m.promo} onClick={() => play(m)} title={NAMES[m.promo!.toUpperCase()]}>
                        <span className={`chess-piece ${pos.turn}`}>{glyph(m.promo!)}</span>
                      </button>
                    ))}
                  </div>
                  <button className="btn" onClick={() => (setPromo(null), setSelected(null))}>
                    Cancel
                  </button>
                </div>
              )}
              {game.end && (
                <div className="sudoku-won chess-result" data-chess-result>
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
                  <span>
                    {endText(game.end)}
                    {vsComputer && game.end.winner === game.you && record?.bestTime === game.seconds ? ' Your fastest win yet.' : ''}
                  </span>
                  <button className="btn btn-primary" onClick={() => start(game.mode, game.level, game.you)}>
                    Play again
                  </button>
                </div>
              )}
            </div>
            {takenRow(bottom === 'w' ? 'b' : 'w')}
          </div>

          <div className="chess-side">
            <h3>Moves</h3>
            <ol className="chess-moves" ref={moveList} data-chess-moves>
              {Array.from({ length: Math.ceil(game.sans.length / 2) }, (_, i) => (
                <li key={i}>
                  <span>{i + 1}.</span>
                  <span>{game.sans[i * 2]}</span>
                  <span>{game.sans[i * 2 + 1] ?? ''}</span>
                </li>
              ))}
              {!game.sans.length && <li className="chess-none">No moves yet</li>}
            </ol>
          </div>
        </div>

        {vsComputer ? (
          <GameStats title={`Chess against the computer, ${game.level}`} record={record} />
        ) : (
          <p className="sudoku-help">Two players: take turns at the keyboard. Stats and streaks are kept for games against the computer.</p>
        )}

        <p className="sudoku-help">
          Click a piece to see where it can go, then click a square to move. Castle by moving the king two squares. A pawn that reaches the far side becomes the
          piece you pick. Undo takes back your last move (and the computer’s reply). Easy makes mistakes, medium plays sensibly, hard thinks further ahead.
          Leaving or resigning a game against the computer counts as a loss.
        </p>
      </div>
    </div>
  )
}
