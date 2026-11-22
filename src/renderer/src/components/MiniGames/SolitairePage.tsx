import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { MousePointerClick, RotateCcw, Sparkles, Spade, Trophy } from 'lucide-react'
import { bestMove, canFinish, deal, drawCards, finishStep, isRed, isWon, move, picked, rankName, SUITS, type Card, type Deal, type From, type To } from '../../lib/solitaire'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'
import GameStats from './GameStats'
import { useGameKeys } from './useGameKeys'

interface Game {
  deal: Deal
  moves: number
  seconds: number
  /** Already counted in the stats. */
  counted: boolean
}

// The game and the double-click setting live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.solitaire.game'
const DOUBLE_KEY = 'notesapp.solitaire.doubleClick'
const statsId = (draw: 1 | 3): string => `solitaire:${draw}`

function loadGame(): Game | null {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Game | null
    return g && g.deal && Array.isArray(g.deal.tableau) ? g : null
  } catch {
    return null
  }
}

const fresh = (draw: 1 | 3): Game => ({ deal: deal(draw), moves: 0, seconds: 0, counted: false })

const cardKey = (c: Card): string => `${c.suit}-${c.rank}`

const sameFrom = (a: From | null, b: From): boolean => JSON.stringify(a) === JSON.stringify(b)

export function CardFace({ card }: { card: Card }) {
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

export const cardLabel = (c: Card): string => `${['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'][c.rank - 1]} of ${['spades', 'hearts', 'diamonds', 'clubs'][c.suit]}`

interface Drag {
  from: From
  cards: Card[]
  pointer: number
  startX: number
  startY: number
  x: number
  y: number
  /** Where the pointer grabbed the top card. */
  grabX: number
  grabY: number
  width: number
  moving: boolean
  /** The pile under the pointer, if any. */
  over: To | null
}

/** The pile (or foundation) under a point on the screen. */
function pileAt(x: number, y: number): To | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const pile = (el as HTMLElement).closest?.('[data-sol-pile], [data-sol-home]') as HTMLElement | null
    if (!pile) continue
    if (pile.dataset.solPile !== undefined) return { pile: 'tableau', col: Number(pile.dataset.solPile) }
    return { pile: 'foundation', f: Number(pile.dataset.solHome) }
  }
  return null
}

/** Solitaire (Klondike), draw one or draw three. */
export default function SolitairePage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? fresh(1))
  const [records, setRecords] = useState<Record<string, GameRecord>>(() => loadRecords())
  const [selected, setSelected] = useState<From | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The cards turned over by the last draw, which slide in from the stock. */
  const [justDrawn, setJustDrawn] = useState<string[]>([])
  // Double-click to send a card home: off unless you turn it on.
  const [doubleClick, setDoubleClick] = useState(() => localStorage.getItem(DOUBLE_KEY) === '1')
  const lastClick = useRef<{ from: string; at: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    try {
      localStorage.setItem(DOUBLE_KEY, doubleClick ? '1' : '0')
    } catch {
      // Not remembered.
    }
  }, [doubleClick])
  useEffect(() => root.current?.focus(), [])

  // The clock starts with the first move and keeps running even when you click away.
  const running = game.moves > 0 && !won
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => {
      setGame((g) => (isWon(g.deal) ? g : { ...g, seconds: g.seconds + 1 }))
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
    const t = setTimeout(
      () =>
        setGame((g) => {
          const next = finishStep(g.deal)
          return next ? { ...g, deal: next, moves: g.moves + 1 } : g
        }),
      90
    )
    return () => clearTimeout(t)
  }, [finishing, d])

  const apply = (next: Deal | null): boolean => {
    if (!next) return false
    setGame((g) => ({ ...g, deal: next, moves: g.moves + 1 }))
    setSelected(null)
    setJustDrawn([])
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
    setDrag(null)
    root.current?.focus()
  }

  const draw = (): void => {
    const next = drawCards(d)
    if (!apply(next) || !next || !d.stock.length) return
    // Only the cards just turned over slide in; the rest stay put.
    setJustDrawn(next.waste.slice(next.waste.length - (next.waste.length - d.waste.length)).map(cardKey))
  }

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

  // Dragging: press on a face-up card and the cards on top of it come with you.
  const grab = (from: From) => (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || won || finishing) return
    const cards = picked(d, from)
    if (!cards) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    table.current?.setPointerCapture(e.pointerId)
    setDrag({
      from,
      cards,
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      width: r.width,
      moving: false,
      over: null
    })
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return
    const moving = drag.moving || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moving, over: moving ? pileAt(e.clientX, e.clientY) : null })
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return
    const g = drag
    setDrag(null)
    if (g.moving) {
      // Let go over a pile: the cards go there if they're allowed to, otherwise they go back.
      if (g.over) apply(move(d, g.from, g.over))
      return
    }
    // A press without moving is a click (and two quick ones are a double-click, if that's on).
    const key = JSON.stringify(g.from)
    const now = performance.now()
    const double = lastClick.current?.from === key && now - lastClick.current.at < 380
    lastClick.current = { from: key, at: now }
    if (double && doubleClick) {
      lastClick.current = null
      if (apply(bestMove(d, g.from))) return
    }
    clickFrom(g.from)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'd') return void (e.preventDefault(), draw())
    if (k === 'n') return void (e.preventDefault(), restart())
    if (k === 'escape') setSelected(null)
  }
  useGameKeys(root, onKey)

  const isSel = (from: From): boolean => {
    if (!selected) return false
    if (selected.pile === 'tableau' && from.pile === 'tableau') return selected.col === from.col && from.index >= selected.index
    return sameFrom(selected, from)
  }

  /** Is this card being dragged (so it's drawn under the pointer instead)? */
  const isLifted = (from: From): boolean => {
    if (!drag?.moving) return false
    const f = drag.from
    if (f.pile === 'tableau' && from.pile === 'tableau') return f.col === from.col && from.index >= f.index
    return sameFrom(f, from)
  }

  /** Would the dragged cards be allowed on this pile? */
  const dropState = (to: To): string => {
    if (!drag?.moving || !drag.over || JSON.stringify(drag.over) !== JSON.stringify(to)) return ''
    return move(d, drag.from, to) ? 'drop-ok' : 'drop-no'
  }

  // The top one (or three, fanned) of the waste, with the card under them showing beneath.
  const fan = d.waste.slice(d.draw === 3 ? -3 : -1)
  const under = d.waste.length > fan.length ? d.waste[d.waste.length - fan.length - 1] : null

  const cardEl = (card: Card, from: From, style?: CSSProperties, extra = '') => (
    <div
      key={`${card.suit}-${card.rank}`}
      className={`sol-card up ${isRed(card.suit) ? 'red' : ''} ${isSel(from) ? 'selected' : ''} ${isLifted(from) ? 'lifted' : ''} ${extra}`}
      style={style}
      onPointerDown={grab(from)}
      aria-label={cardLabel(card)}
      data-card={`${rankName(card.rank)}${SUITS[card.suit]}`}
    >
      <CardFace card={card} />
    </div>
  )

  return (
    <div className="sudoku-page sol-page" data-solitaire-page>
      <div className="sudoku-inner sol-inner" ref={root} tabIndex={-1}>
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
          <span title="Moves so far">
            {game.moves} {game.moves === 1 ? 'move' : 'moves'}
          </span>
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
            <button
              className={`sudoku-tool ${doubleClick ? 'active' : ''}`}
              onClick={() => setDoubleClick((v) => !v)}
              aria-pressed={doubleClick}
              title="When on, double-clicking a card sends it where it can go. When off, you drag every card yourself."
              data-sol-double
            >
              <MousePointerClick size={15} /> Double-click moves {doubleClick ? 'on' : 'off'}
            </button>
            <button className="sudoku-tool" onClick={() => restart()} title="Deal a new game (N)">
              <RotateCcw size={15} /> New
            </button>
          </span>
        </div>

        <div className={`sol-table ${drag?.moving ? 'dragging' : ''}`} ref={table} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)} data-sol-table>
          <div className="sol-top">
            <button className={`sol-slot sol-stock ${d.stock.length ? 'has' : ''}`} onClick={draw} aria-label={d.stock.length ? `Stock, ${d.stock.length} cards` : 'Turn the waste back over'} data-sol-stock>
              {d.stock.length ? (
                <>
                  {d.stock.length > 1 && <span className="sol-card back under" />}
                  <span className="sol-card back" />
                  <span className="sol-count">{d.stock.length}</span>
                </>
              ) : (
                <RotateCcw size={22} />
              )}
            </button>
            <div className="sol-waste">
              {[...(under ? [under] : []), ...fan].map((card) => {
                const i = Math.max(0, fan.indexOf(card))
                const k = justDrawn.indexOf(cardKey(card))
                const style = { '--i': i, '--k': Math.max(0, k) } as CSSProperties
                const extra = k >= 0 ? 'fresh' : ''
                return card === fan[fan.length - 1] ? (
                  cardEl(card, { pile: 'waste' }, style, extra)
                ) : (
                  <div key={cardKey(card)} className={`sol-card up still ${isRed(card.suit) ? 'red' : ''} ${extra}`} style={style} aria-label={cardLabel(card)}>
                    <CardFace card={card} />
                  </div>
                )
              })}
            </div>
            <span className="sol-gap" />
            {d.foundations.map((pile, f) => {
              const top = pile[pile.length - 1]
              const to: To = { pile: 'foundation', f }
              return (
                <div key={f} className={`sol-slot sol-home ${dropState(to)}`} onClick={top ? undefined : () => clickEmpty(to)} data-sol-home={f}>
                  <span className="sol-home-mark">A</span>
                  {pile.length > 1 && <div className={`sol-card up still ${isRed(pile[pile.length - 2].suit) ? 'red' : ''}`}>{<CardFace card={pile[pile.length - 2]} />}</div>}
                  {top && cardEl(top, { pile: 'foundation', f })}
                </div>
              )
            })}
          </div>

          <div
            className="sol-piles"
            // Tall enough for the longest pile, measured in card widths.
            style={{ '--extent': Math.max(0, ...d.tableau.map((p) => p.reduce((sum, c, i) => sum + (i === p.length - 1 ? 0 : c.up ? 0.3 : 0.12), 0))) } as CSSProperties}
          >
            {d.tableau.map((pile, col) => {
              const to: To = { pile: 'tableau', col }
              return (
                <div key={col} className={`sol-pile ${dropState(to)}`} onClick={(e) => e.target === e.currentTarget && clickEmpty(to)} data-sol-pile={col}>
                  <span className="sol-slot sol-empty" onClick={() => clickEmpty(to)} />
                  {pile.map((card, index) => {
                    const downAbove = pile.slice(0, index).filter((c) => !c.up).length
                    const style = { '--down': downAbove, '--up': index - downAbove } as CSSProperties
                    return card.up ? (
                      cardEl(card, { pile: 'tableau', col, index }, style)
                    ) : (
                      <div key={`${card.suit}-${card.rank}`} className="sol-card back" style={style} aria-label="Face-down card" />
                    )
                  })}
                </div>
              )
            })}
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

        {drag?.moving && (
          <div className="sol-drag" style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, '--card-w': `${drag.width}px` } as CSSProperties}>
            {drag.cards.map((card, i) => (
              <div key={i} className={`sol-card up ${isRed(card.suit) ? 'red' : ''}`} style={{ '--down': 0, '--up': i } as CSSProperties}>
                <CardFace card={card} />
              </div>
            ))}
          </div>
        )}

        <GameStats title={`Solitaire, draw ${d.draw}`} record={record} />

        <p className="sudoku-help">
          Build each suit from Ace to King on the four spaces at the top right. On the seven piles, put cards one lower in the other colour (a red 6 on a black
          7); only a King fills an empty pile. Click the stock to turn over cards. Drag a card (and any cards on top of it) to where it goes, or click it and then
          click the pile. Turn on double-click moves if you'd like double-clicking to send a card where it can go. Space draws, N deals again. Dealing again
          before this game is won counts as a loss.
        </p>
      </div>
    </div>
  )
}
