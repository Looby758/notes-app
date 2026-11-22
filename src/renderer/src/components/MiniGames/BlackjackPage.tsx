import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Club, Coins, Hand, Layers, Plus, RotateCcw, Split } from 'lucide-react'
import {
  canDouble,
  canSplit,
  CHIPS,
  deal,
  double,
  handValue,
  hit,
  netResult,
  newTable,
  split,
  stand,
  START_BANK,
  type Outcome,
  type Round
} from '../../lib/blackjack'
import { isRed, type Card } from '../../lib/solitaire'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { celebrate } from '../../lib/celebrate'
import { playSound } from '../../lib/gameSound'
import { CardFace, cardLabel } from './SolitairePage'
import GameStats from './GameStats'
import { useGameKeys } from './useGameKeys'

// The table (chips, shoe, hand in play) lives on this computer only: it's just for fun.
const TABLE_KEY = 'notesapp.blackjack.table'
const MOST_KEY = 'notesapp.blackjack.most'
const STATS_ID = 'blackjack'

function loadTable(): Round | null {
  try {
    const r = JSON.parse(localStorage.getItem(TABLE_KEY) ?? 'null') as Round | null
    return r && Array.isArray(r.shoe) && Array.isArray(r.hands) && typeof r.bank === 'number' ? r : null
  } catch {
    return null
  }
}

function loadMost(): number {
  try {
    return Number(localStorage.getItem(MOST_KEY)) || START_BANK
  } catch {
    return START_BANK
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Storage full or blocked: the game still works, it just won't be remembered.
  }
}

const OUTCOME_TEXT: Record<Outcome, string> = { blackjack: 'Blackjack!', win: 'Win', push: 'Push', lose: 'Lose' }

function CardView({ card, i }: { card: Card; i: number }) {
  return card.up ? (
    <div className={`sol-card up still bj-card ${isRed(card.suit) ? 'red' : ''}`} style={{ '--i': i } as CSSProperties} aria-label={cardLabel(card)}>
      <CardFace card={card} />
    </div>
  ) : (
    <div className="sol-card back bj-card" style={{ '--i': i } as CSSProperties} aria-label="Face-down card" />
  )
}

/** What to show for a hand's total: "17", "soft 17", "Bust" or "Blackjack". */
function totalText(cards: Card[]): string {
  const shown = cards.filter((c) => c.up)
  const { total, soft } = handValue(shown)
  if (total > 21) return `Bust (${total})`
  if (shown.length === 2 && cards.length === 2 && total === 21) return 'Blackjack'
  return soft && total < 21 ? `Soft ${total}` : String(total)
}

/** Blackjack against the dealer, with pretend chips. */
export default function BlackjackPage() {
  const [round, setRound] = useState<Round>(() => loadTable() ?? newTable())
  const [most, setMost] = useState(loadMost)
  const [record, setRecord] = useState<GameRecord | undefined>(() => loadRecords()[STATS_ID])
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => save(TABLE_KEY, round), [round])
  useEffect(() => page.current?.focus(), [])

  /** Moves the table on, and counts the hand once it's over. */
  const play = (next: Round): void => {
    if (next === round) return
    // A card for every one that came out of the shoe, a little apart, and chips for a bigger bet.
    const dealt = round.shoe.length - next.shoe.length
    for (let k = 0; k < Math.min(dealt, 8); k++) playSound('deal', undefined, k * 0.13)
    const staked = next.hands.reduce((n, h) => n + h.bet, 0) - (round.phase === 'playing' ? round.hands.reduce((n, h) => n + h.bet, 0) : 0)
    if (staked > 0 && round.phase === 'playing') playSound('chip')
    if (next.phase === 'done' && round.phase !== 'done') {
      const net = netResult(next)
      const after = Math.min(dealt, 8) * 0.13 + 0.15
      if (next.dealer.length) playSound('flip', undefined, 0.1)
      if (net !== 0) setRecord(saveGame(STATS_ID, net > 0))
      if (net > 0) setTimeout(() => celebrate('small'), after * 1000)
      else if (net < 0) playSound('lose', undefined, after)
      else playSound('push', undefined, after)
      if (next.bank > most) {
        setMost(next.bank)
        save(MOST_KEY, String(next.bank))
      }
    }
    setRound(next)
    page.current?.focus()
  }

  const betting = round.phase !== 'playing'
  const broke = betting && round.bank < CHIPS[0]
  const bet = Math.min(round.bet, round.bank)

  const setBet = (n: number): void => {
    playSound(n > 0 ? 'chip' : 'erase')
    setRound((r) => ({ ...r, bet: Math.max(0, Math.min(n, r.bank)) }))
  }
  const dealHand = (): void => {
    if (betting && bet > 0) play(deal(round, bet))
  }
  const resetChips = (): void => {
    for (let k = 0; k < 4; k++) playSound('chip', undefined, k * 0.06)
    setRound(newTable())
    page.current?.focus()
  }

  useGameKeys(page, (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (betting) {
      if (k === 'enter' || k === ' ' || k === 'n') {
        e.preventDefault()
        if (broke) resetChips()
        else dealHand()
      }
      return
    }
    const action = { h: hit, s: stand, d: double, p: split }[k]
    if (action) {
      e.preventDefault()
      play(action(round))
    }
  })

  const net = round.phase === 'done' ? netResult(round) : 0
  const dealerShows = round.dealer.length > 0

  return (
    <div ref={page} className="sudoku-page blackjack-page" tabIndex={0} data-blackjack-page>
      <div className="sudoku-inner blackjack-inner">
        <header className="sudoku-head">
          <h2>
            <Club size={20} /> Blackjack
          </h2>
        </header>

        <div className="sudoku-status">
          <span>
            <Coins size={15} className="bj-coins" /> Chips <strong data-blackjack-bank>{round.bank}</strong>
          </span>
          {!betting && (
            <span>
              Bet <strong>{round.hands.reduce((n, h) => n + h.bet, 0)}</strong>
            </span>
          )}
          <span className="mines-tools">
            {round.phase === 'done' && (
              <span className={`bj-net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`} data-blackjack-net>
                {net > 0 ? `+${net}` : net < 0 ? `−${-net}` : 'Push, bet back'}
              </span>
            )}
            <button className="sudoku-tool" onClick={resetChips} title={`Start again with ${START_BANK} chips`} data-blackjack-reset>
              <RotateCcw size={15} /> Reset chips
            </button>
          </span>
        </div>

        <div className="bj-table" data-blackjack-table>
          <div className="bj-side">
            <div className="bj-label">
              Dealer {dealerShows && <span className="bj-total">{totalText(round.dealer)}</span>}
            </div>
            <div className="bj-cards" data-blackjack-dealer>
              {dealerShows ? round.dealer.map((c, i) => <CardView key={i} card={c} i={i} />) : <div className="bj-spot">Dealer stands on 17</div>}
            </div>
          </div>

          <div className="bj-hands">
            {round.hands.length ? (
              round.hands.map((h, n) => (
                <div
                  key={n}
                  className={`bj-side ${round.phase === 'playing' && n === round.active ? 'active' : ''} ${h.outcome ?? ''}`}
                  data-blackjack-hand={n}
                >
                  <div className="bj-label">
                    {round.hands.length > 1 ? `Hand ${n + 1}` : 'You'} <span className="bj-total">{totalText(h.cards)}</span>
                    <span className="bj-bet">
                      <Coins size={13} /> {h.bet}
                      {h.doubled ? ' (doubled)' : ''}
                    </span>
                    {h.outcome && <span className={`bj-outcome ${h.outcome}`}>{OUTCOME_TEXT[h.outcome]}</span>}
                  </div>
                  <div className="bj-cards">
                    {h.cards.map((c, i) => (
                      <CardView key={i} card={c} i={i} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="bj-side">
                <div className="bj-label">You</div>
                <div className="bj-cards">
                  <div className="bj-spot">Pick a bet and deal</div>
                </div>
              </div>
            )}
          </div>

          <div className="bj-controls">
            {betting ? (
              broke ? (
                <>
                  <span className="bj-hint">Out of chips.</span>
                  <button className="btn btn-primary" onClick={resetChips}>
                    Start again with {START_BANK}
                  </button>
                </>
              ) : (
                <>
                  <div className="bj-chips" role="group" aria-label="Bet">
                    {CHIPS.map((chip) => (
                      <button
                        key={chip}
                        className="bj-chip"
                        style={{ '--chip': chip } as CSSProperties}
                        onClick={() => setBet(bet + chip)}
                        disabled={chip > round.bank}
                        title={`Add ${chip} to the bet`}
                        data-chip={chip}
                      >
                        <Plus size={11} />
                        {chip}
                      </button>
                    ))}
                    <button className="bj-clear" onClick={() => setBet(0)} title="Clear the bet">
                      Clear
                    </button>
                  </div>
                  <span className="bj-bet-now">
                    Bet <strong key={bet} className="bj-bet-amount" data-blackjack-bet>{bet}</strong>
                  </span>
                  <button className="btn btn-primary" onClick={dealHand} disabled={bet <= 0} title="Deal (Enter)" data-blackjack-deal>
                    {round.phase === 'done' ? 'Deal again' : 'Deal'}
                  </button>
                </>
              )
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => play(hit(round))} title="Take another card (H)" data-blackjack-hit>
                  <Plus size={15} /> Hit
                </button>
                <button className="btn" onClick={() => play(stand(round))} title="Keep this hand (S)" data-blackjack-stand>
                  <Hand size={15} /> Stand
                </button>
                <button className="btn" onClick={() => play(double(round))} disabled={!canDouble(round)} title="Double the bet for one more card (D)" data-blackjack-double>
                  <Coins size={15} /> Double
                </button>
                <button className="btn" onClick={() => play(split(round))} disabled={!canSplit(round)} title="Split a pair into two hands (P)" data-blackjack-split>
                  <Split size={15} /> Split
                </button>
              </>
            )}
          </div>
        </div>

        <GameStats title="Blackjack" record={record} noTime extra={{ label: 'Most chips', value: String(most) }} />

        <p className="sudoku-help">
          <Layers size={13} className="bj-inline" /> Get closer to 21 than the dealer without going over. Picture cards count 10 and an Ace 1 or 11.
          Blackjack (an Ace and a ten-card) pays 3 to 2. The dealer draws to 17 and stands on all 17s. Double on your first two cards for one more
          card; split a pair into two hands. Keys: H hit, S stand, D double, P split, Enter deal. Chips are pretend, and Reset chips starts you
          again with {START_BANK}.
        </p>
      </div>
    </div>
  )
}
