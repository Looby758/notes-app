import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { RotateCcw, Sparkles, Spade, Trophy, Undo2 } from 'lucide-react'
import { bestMove, canFinish, deal, drawCards, finishStep, isRed, isWon, move, rankName, SUITS, type Card, type Deal, type From, type To } from '../../lib/solitaire'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'
import GameStats from './GameStats'

interface Game {
  deal: Deal
  /** Earlier deals, for undo (newest last). */
  undo: Deal[]
  moves: number
  seconds: number
  /** Already counted in the stats. */
  counted: boolean
}

// The game lives on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.solitaire.game'
const statsId = (draw: 1 | 3): string => `solitaire:${draw}`

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Game | null
    return g && g.deal && Array.isArray(g.deal.tableau) ? g : null
  } catch {
    return null
  }
}

const fresh = (draw: 1 | 3): Game => ({ deal: deal(draw), undo: [], moves: 0, seconds: 0, counted: false })

const sameFrom = (a: From | null, b: From): boolean => JSON.stringify(a) === JSON.stringify(b)

function CardFace({ card }: { card: Card }) {
  const name = rankName(card.rank)
  const suit = SUITS[card.suit]
  return (
    <>
      <span className="sol-corner">
        {name}
        <i>{suit}</i>
      </span>
      <span className="sol-pip">{card.rank > 10 ? name : suit}</span>
      <span className="sol-corner flip">
        {name}
        <i>{suit}</i>
      </span>
    </>
  )
}

const cardLabel = (c: Card): string => `${['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'][c.rank - 1]} of ${['spades', 'hearts', 'diamonds', 'clubs'][c.suit]}`

/** Solitaire (Klondike), draw one or draw three. */
export default function SolitairePage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? fresh(1))
  const [records, setRecords] = useState<Record<string, GameRecord>>(() => loadRecords())
  const [selected, setSelected] = useState<From | null>(null)
  const [finishing, setFinishing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const d = game.deal
  const won = isWon(d)
  const record = records[statsId(d.draw)]

  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(game))
    } catch {
      // Not remembered; it still plays.
    }
  }, [game])
  useEffect(() => root.current?.focus(), [])

  // The clock starts with the first move and runs while the window is in front.
  const running = game.moves > 0 && !won
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (isWon(g.deal) ? g : { ...g, seconds: g.seconds + 1 }))
    }, 1000)
    return () => clearInterval(tick)
  }, [running])

  useEffect(() => {
    if (!won || game.counted) return
    saveGame(statsId(d.draw), true, game.seconds)
    setRecords(loadRecords())
    setGame((g) => ({ ...g, counted: true }))
  }, [won, game.counted, game.seconds, d.draw])

  // Play the rest home, one card at a time.
  useEffect(() => {
    if (!finishing) return
    if (!finishStep(d)) return void setFinishing(false)
    const t = setTimeout(() => setGame((g) => {
      const next = finishStep(g.deal)
      return next ? { ...g, deal: next, moves: g.moves + 1 } : g
    }), 90)
    return () => clearTimeout(t)
  }, [finishing, d])

  const apply = (next: Deal | null): boolean => {
    if (!next) return false
    setGame((g) => ({ ...g, deal: next, undo: [...g.undo.slice(-199), g.deal], moves: g.moves + 1 }))
    setSelected(null)
    return true
  }

  const restart = (draw: 1 | 3 = d.draw): void => {
    // Leaving a game you'd made a start on counts as a loss, like giving up.
    if (!game.counted && game.moves > 0 && !won) {
      saveGame(statsId(d.draw), false)
      setRecords(loadRecords())
    }
    setGame(fresh(draw))
    setSelected(null)
    setFinishing(false)
    root.current?.focus()
  }

  const undo = (): void => {
    if (!game.undo.length || won) return
    setGame((g) => ({ ...g, deal: g.undo[g.undo.length - 1], undo: g.undo.slice(0, -1), moves: g.moves + 1 }))
    setSelected(null)
  }

  const draw = (): void => void apply(drawCards(d))

  /** Clicking a card: pick it up, or drop what you're holding onto its pile. */
  const clickFrom = (from: From): void => {
    if (won) return
    if (selected && !sameFrom(selected, from)) {
      const to: To | null = from.pile === 'tableau' ? { pile: 'tableau', col: from.col } : from.pile === 'foundation' ? { pile: 'foundation', f: from.f } : null
      if (to && apply(move(d, selected, to))) return
    }
    setSelected(sameFrom(selected, from) ? null : from)
  }

  const clickEmpty = (to: To): void => {
    if (selected) apply(move(d, selected, to))
  }

  const dragStart = (from: From) => (e: DragEvent): void => {
    e.dataTransfer.setData('application/x-orbit-card', JSON.stringify(from))
    e.dataTransfer.effectAllowed = 'move'
    setSelected(from)
  }
  const dropOn = (to: To) => (e: DragEvent): void => {
    const raw = e.dataTransfer.getData('application/x-orbit-card')
    if (!raw) return
    e.preventDefault()
    if (!apply(move(d, JSON.parse(raw) as From, to))) setSelected(null)
  }
  const allowDrop = (e: DragEvent): void => {
    if (e.dataTransfer.types.includes('application/x-orbit-card')) e.preventDefault()
  }

  const onKey = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') return void (e.preventDefault(), undo())
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'd') return void (e.preventDefault(), draw())
    if (k === 'u') return void (e.preventDefault(), undo())
    if (k === 'n') return void (e.preventDefault(), restart())
    if (k === 'escape') setSelected(null)
  }

  const isSel = (from: From): boolean => {
    if (!selected) return false
    if (selected.pile === 'tableau' && from.pile === 'tableau') return selected.col === from.col && from.index >= selected.index
    return sameFrom(selected, from)
  }

  const shownWaste = d.waste.slice(d.draw === 3 ? -3 : -1)

  return (
    <div className="sudoku-page sol-page" data-solitaire-page>
      <div className="sudoku-inner sol-inner" ref={root} tabIndex={-1} onKeyDown={onKey}>
        <header className="sudoku-head">
          <h2>
            <Spade size={20} /> Solitaire
          </h2>
          <div className="sudoku-levels" role="group" aria-label="Cards turned over at a time">
            {([1, 3] as const).map((n) => (
              <button
                key={n}
                className={`sudoku-level ${d.draw === n ? 'active' : ''}`}
                onClick={() => restart(n)}
                title={`Start a new game turning over ${n === 1 ? 'one card' : 'three cards'} at a time`}
              >
                Draw {n}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-status">
          <span className="sudoku-time" title="How long you've been playing this game">
            {formatTime(game.seconds)}
          </span>
          <span title="Moves so far">{game.moves} {game.moves === 1 ? 'move' : 'moves'}</span>
          {record?.bestTime !== undefined && (
            <span className="sudoku-best" title={`Your fastest draw ${d.draw} win`}>
              <Trophy size={13} /> Best {formatTime(record.bestTime)}
            </span>
          )}
          <span className="mines-tools">
            {canFinish(d) && !finishing && (
              <button className="sudoku-tool active" onClick={() => setFinishing(true)} title="Every card is showing: play the rest home" data-sol-finish>
                <Sparkles size={15} /> Finish
              </button>
            )}
            <button className="sudoku-tool" onClick={undo} disabled={!game.undo.length || won} title="Take back the last move (U or Ctrl+Z)">
              <Undo2 size={15} /> Undo
            </button>
            <button className="sudoku-tool" onClick={() => restart()} title="Deal a new game (N)">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div className="sol-table" data-sol-table>
          <div className="sol-top">
            <button className={`sol-slot sol-stock ${d.stock.length ? 'has' : ''}`} onClick={draw} aria-label={d.stock.length ? `Stock, ${d.stock.length} cards` : 'Turn the waste back over'} data-sol-stock>
              {d.stock.length ? <span className="sol-card back" /> : <RotateCcw size={22} />}
            </button>
            <div className={`sol-waste n${shownWaste.length}`}>
              {shownWaste.map((card, i) => {
                const top = i === shownWaste.length - 1
                const from: From = { pile: 'waste' }
                return (
                  <div
                    key={`${card.suit}-${card.rank}`}
                    className={`sol-card up ${isRed(card.suit) ? 'red' : ''} ${top && isSel(from) ? 'selected' : ''}`}
                    style={{ '--i': i } as CSSProperties}
                    draggable={top}
                    onDragStart={top ? dragStart(from) : undefined}
                    onClick={top ? () => clickFrom(from) : undefined}
                    onDoubleClick={top ? () => apply(bestMove(d, from)) : undefined}
                    aria-label={cardLabel(card)}
                  >
                    <CardFace card={card} />
                  </div>
                )
              })}
            </div>
            <span className="sol-gap" />
            {d.foundations.map((pile, f) => {
              const top = pile[pile.length - 1]
              const from: From = { pile: 'foundation', f }
              return (
                <div key={f} className="sol-slot sol-home" onDragOver={allowDrop} onDrop={dropOn({ pile: 'foundation', f })} onClick={top ? undefined : () => clickEmpty({ pile: 'foundation', f })} data-sol-home={f}>
                  {top ? (
                    <div
                      className={`sol-card up ${isRed(top.suit) ? 'red' : ''} ${isSel(from) ? 'selected' : ''}`}
                      draggable
                      onDragStart={dragStart(from)}
                      onClick={() => clickFrom(from)}
                      aria-label={cardLabel(top)}
                    >
                      <CardFace card={top} />
                    </div>
                  ) : (
                    <span className="sol-home-mark">A</span>
                  )}
                </div>
              )
            })}
          </div>

          <div
            className="sol-piles"
            // Tall enough for the longest pile, measured in card widths.
            style={{ '--extent': Math.max(0, ...d.tableau.map((p) => p.reduce((sum, c, i) => sum + (i === p.length - 1 ? 0 : c.up ? 0.3 : 0.12), 0))) } as CSSProperties}
          >
            {d.tableau.map((pile, col) => (
              <div
                key={col}
                className="sol-pile"
                onDragOver={allowDrop}
                onDrop={dropOn({ pile: 'tableau', col })}
                onClick={(e) => e.target === e.currentTarget && clickEmpty({ pile: 'tableau', col })}
                data-sol-pile={col}
              >
                {!pile.length && <span className="sol-slot sol-empty" onClick={() => clickEmpty({ pile: 'tableau', col })} />}
                {pile.map((card, index) => {
                  const from: From = { pile: 'tableau', col, index }
                  const downAbove = pile.slice(0, index).filter((c) => !c.up).length
                  const upAbove = index - downAbove
                  return card.up ? (
                    <div
                      key={`${card.suit}-${card.rank}`}
                      className={`sol-card up ${isRed(card.suit) ? 'red' : ''} ${isSel(from) ? 'selected' : ''}`}
                      style={{ '--down': downAbove, '--up': upAbove } as CSSProperties}
                      draggable
                      onDragStart={dragStart(from)}
                      onClick={() => clickFrom(from)}
                      onDoubleClick={() => apply(bestMove(d, from))}
                      aria-label={cardLabel(card)}
                      data-card={`${rankName(card.rank)}${SUITS[card.suit]}`}
                    >
                      <CardFace card={card} />
                    </div>
                  ) : (
                    <div key={`${card.suit}-${card.rank}`} className="sol-card back" style={{ '--down': downAbove, '--up': upAbove } as CSSProperties} aria-label="Face-down card" />
                  )
                })}
              </div>
            ))}
          </div>

          {won && (
            <div className="sudoku-won sol-result" data-sol-result>
              <Trophy size={30} />
              <strong>You won!</strong>
              <span>
                {formatTime(game.seconds)} · {game.moves} moves{record?.bestTime === game.seconds ? ' · your best yet' : ''}
                {record && record.streak > 1 ? ` · ${record.streak} in a row` : ''}
              </span>
              <button className="btn btn-primary" onClick={() => restart()}>
                Deal again
              </button>
            </div>
          )}
        </div>

        <GameStats title={`Solitaire, draw ${d.draw}`} record={record} />

        <p className="sudoku-help">
          Build each suit from Ace to King on the four spaces at the top right. On the seven piles, put cards one lower in the other colour (a red 6 on a black
          7); only a King fills an empty pile. Click the stock to turn over cards. Drag cards, or click one then click where it goes; double-click sends a card
          home. Space draws, U undoes, N deals again. Dealing again before this game is won counts as a loss.
        </p>
      </div>
    </div>
  )
}
