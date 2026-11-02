import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ChartColumn, Delete, Flag, RotateCcw, Skull, SpellCheck2, Trophy } from 'lucide-react'
import {
  keyboardMarks,
  markGuess,
  maxGuesses,
  pickAnswer,
  recordResult,
  walkingDeadKind,
  winCount,
  wordleModeOf,
  WORDLE_MODES,
  type LetterMark,
  type WordleMode,
  type WordleStats
} from '../../lib/wordle'
import { petCheer } from '../../lib/pet'

/** A round in progress (or just finished). */
interface Game {
  mode: WordleMode
  length: number
  answer: string
  guesses: string[]
  typing: string
  result: 'won' | 'lost' | null
}

type Key = `${WordleMode}-${number}`
const keyOf = (mode: WordleMode, length: number): Key => `${mode}-${length}`

// Games, stats and recent answers live on this computer only (not in the notes folder): it's just for fun.
// There's a round kept for every mode and length, so switching between them never loses one.
const PICK_KEY = 'notesapp.wordle.pick'
const GAMES_KEY = 'notesapp.wordle.games'
const STATS_KEY = 'notesapp.wordle.stats'
const RECENT_KEY = 'notesapp.wordle.recent'
const MAX_RECENT = 400

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

/** A saved round from an older or damaged save is thrown away rather than played wrong. */
function validGame(g: Game | undefined, mode: WordleMode, length: number): g is Game {
  return (
    !!g &&
    g.mode === mode &&
    g.length === length &&
    typeof g.answer === 'string' &&
    g.answer.length === length &&
    Array.isArray(g.guesses) &&
    g.guesses.length <= maxGuesses(length) &&
    g.guesses.every((w) => typeof w === 'string' && w.length === length) &&
    typeof g.typing === 'string'
  )
}

function loadPick(): { mode: WordleMode; length: number } {
  const p = load<{ mode: WordleMode; length: number }>(PICK_KEY)
  const mode = WORDLE_MODES.find((m) => m.id === p?.mode)
  return mode && p && mode.lengths.includes(p.length) ? { mode: mode.id, length: p.length } : { mode: 'classic', length: 5 }
}

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** A fresh round, with an answer that hasn't come up lately. */
function newGame(mode: WordleMode, length: number): Game {
  const k = keyOf(mode, length)
  const recent = load<Partial<Record<Key, string[]>>>(RECENT_KEY) ?? {}
  const answer = pickAnswer(mode, length, recent[k] ?? [])
  save(RECENT_KEY, { ...recent, [k]: [...(recent[k] ?? []), answer].slice(-MAX_RECENT) })
  return { mode, length, answer, guesses: [], typing: '', result: null }
}

type Games = Partial<Record<Key, Game>>

/** The saved round for a mode and length, or a new one if there isn't one (or it's damaged). */
const withGame = (games: Games, mode: WordleMode, length: number): Games =>
  validGame(games[keyOf(mode, length)], mode, length) ? games : { ...games, [keyOf(mode, length)]: newGame(mode, length) }

const MARK_WORDS: Record<LetterMark, string> = { right: 'right place', close: 'in the word, wrong place', out: 'not in the word' }

/** Wordle, as many rounds as you like: 2 to 8 letters, plus a Walking Dead mode. */
export default function WordlePage() {
  const [pick, setPick] = useState(loadPick)
  const [games, setGames] = useState<Games>(() => withGame(load<Games>(GAMES_KEY) ?? {}, pick.mode, pick.length))
  const [stats, setStats] = useState<Partial<Record<Key, WordleStats>>>(() => load(STATS_KEY) ?? {})
  const [message, setMessage] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  // The row that was just entered flips over; rows from before (or from a saved game) just show.
  const [revealRow, setRevealRow] = useState<number | null>(null)
  const page = useRef<HTMLDivElement>(null)

  const { mode, length } = pick
  const key = keyOf(mode, length)
  const tries = maxGuesses(length)

  // Always there: a round is made whenever a mode and length is picked (see withGame).
  const game = games[key]!

  useEffect(() => save(GAMES_KEY, games), [games])
  useEffect(() => save(PICK_KEY, pick), [pick])
  useEffect(() => page.current?.focus(), [])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 1800)
    return () => clearTimeout(t)
  }, [message, shake])

  const update = (next: Game): void => setGames((gs) => ({ ...gs, [key]: next }))

  const finish = (next: Game, won: boolean): void => {
    update(next)
    setStats((s) => {
      const updated = { ...s, [key]: recordResult(s[key], length, won ? next.guesses.length : null) }
      save(STATS_KEY, updated)
      return updated
    })
    if (won) petCheer()
  }

  const choose = (m: WordleMode, len: number): void => {
    // A mode and length you haven't played yet gets a fresh word, in the same render so focus stays put.
    const next = withGame(games, m, len)
    if (next !== games) setGames(next)
    setPick({ mode: m, length: len })
    setRevealRow(null)
    setMessage(null)
    page.current?.focus()
  }

  const chooseMode = (m: WordleMode): void => {
    const lengths = wordleModeOf(m).lengths
    choose(m, lengths.includes(length) ? length : 5)
  }

  const playAgain = (): void => {
    update(newGame(mode, length))
    setRevealRow(null)
    setMessage(null)
    page.current?.focus()
  }

  /** Giving up shows the word and counts as a loss; with no guesses made it's just a new word. */
  const giveUp = (): void => {
    if (game.result || !game.guesses.length) return playAgain()
    finish({ ...game, typing: '', result: 'lost' }, false)
    setRevealRow(null)
    page.current?.focus()
  }

  const type = (letter: string): void => {
    if (game.result || game.typing.length >= length) return
    update({ ...game, typing: game.typing + letter })
  }

  const erase = (all = false): void => {
    if (game.result || !game.typing) return
    update({ ...game, typing: all ? '' : game.typing.slice(0, -1) })
  }

  const enter = (): void => {
    if (game.result) return
    if (game.typing.length < length) {
      setMessage(`Type ${length} letters`)
      setShake((n) => n + 1)
      return
    }
    const guesses = [...game.guesses, game.typing]
    const won = game.typing === game.answer
    const next: Game = { ...game, guesses, typing: '', result: won ? 'won' : guesses.length >= tries ? 'lost' : null }
    setRevealRow(guesses.length - 1)
    setMessage(null)
    if (next.result) finish(next, won)
    else update(next)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.metaKey || (e.ctrlKey && e.key !== 'Backspace')) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (game.result) playAgain()
      else enter()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      erase(e.ctrlKey)
    } else if (/^[a-z]$/i.test(e.key)) {
      e.preventDefault()
      type(e.key.toLowerCase())
    }
  }

  const keys = keyboardMarks(game.guesses, game.answer)
  const modeInfo = wordleModeOf(mode)
  const s = stats[key]
  const wins = s ? winCount(s) : 0
  const kind = mode === 'walkingDead' && game.result ? walkingDeadKind(game.answer) : null
  const tile = length <= 5 ? 56 : length === 6 ? 52 : length === 7 ? 48 : 44
  const left = tries - game.guesses.length

  return (
    <div ref={page} className={`sudoku-page wordle-page ${mode === 'walkingDead' ? 'twd' : ''}`} tabIndex={0} onKeyDown={onKey} data-wordle-page>
      <div className="sudoku-inner wordle-inner">
        <header className="sudoku-head">
          <h2>
            {mode === 'walkingDead' ? <Skull size={20} /> : <SpellCheck2 size={20} />} Wordle
          </h2>
          <div className="sudoku-levels" role="group" aria-label="Mode">
            {WORDLE_MODES.map((m) => (
              <button
                key={m.id}
                className={`sudoku-level ${mode === m.id ? 'active' : ''}`}
                onClick={() => chooseMode(m.id)}
                title={m.id === 'walkingDead' ? 'Words from the main Walking Dead TV show: characters, places, groups and more' : 'Everyday words'}
                data-wordle-mode={m.id}
              >
                {m.id === 'walkingDead' && <Skull size={13} />} {m.label}
              </button>
            ))}
          </div>
        </header>

        <div className="sudoku-status wordle-status">
          <div className="sudoku-levels wordle-lengths" role="group" aria-label="Letters">
            {modeInfo.lengths.map((len) => (
              <button
                key={len}
                className={`sudoku-level ${length === len ? 'active' : ''}`}
                onClick={() => choose(mode, len)}
                title={`${len}-letter words, ${maxGuesses(len)} guesses`}
                data-wordle-length={len}
              >
                {len}
              </button>
            ))}
          </div>
          <span>letters</span>
          <span className="mines-tools">
            {message ? (
              <span className="wordle-message" role="status" data-wordle-message>
                {message}
              </span>
            ) : (
              <span className="wordle-left">{game.result ? '' : `${left} guess${left === 1 ? '' : 'es'} left`}</span>
            )}
            {game.result || !game.guesses.length ? (
              <button className="sudoku-tool" onClick={playAgain} title="Start a new word (Enter when a round is over)">
                <RotateCcw size={15} /> New word
              </button>
            ) : (
              <button className="sudoku-tool" onClick={giveUp} title="Show the word and start again (counts as a loss)" data-wordle-give-up>
                <Flag size={15} /> Give up
              </button>
            )}
          </span>
        </div>

        <div className="wordle-play">
          <div
            className="wordle-board"
            role="grid"
            aria-label={`Wordle board: ${length} letters, ${tries} guesses`}
            style={{ '--wordle-tile': `${tile}px`, '--wordle-cols': length } as CSSProperties}
            data-wordle-board
          >
            {Array.from({ length: tries }, (_, r) => {
              const done = r < game.guesses.length
              const current = r === game.guesses.length && !game.result
              const word = done ? game.guesses[r] : current ? game.typing : ''
              const marks = done ? markGuess(word, game.answer) : null
              return (
                <div
                  key={current ? `typing-${shake}` : r}
                  className={`wordle-row ${current && shake ? 'shake' : ''} ${r === revealRow ? 'reveal' : ''}`}
                  role="row"
                  data-wordle-row={r}
                >
                  {Array.from({ length }, (_, c) => {
                    const letter = word[c] ?? ''
                    const mark = marks?.[c]
                    return (
                      <div
                        key={c}
                        className={`wordle-tile ${mark ?? ''} ${letter && !mark ? 'filled' : ''}`}
                        style={{ '--wordle-delay': `${c * 0.12}s` } as CSSProperties}
                        role="gridcell"
                        aria-label={letter ? `${letter.toUpperCase()}${mark ? `, ${MARK_WORDS[mark]}` : ''}` : 'empty'}
                        data-mark={mark}
                      >
                        {letter.toUpperCase()}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {game.result && (
            <div className="nono-result wordle-result" data-wordle-result={game.result}>
              {game.result === 'won' ? <Trophy size={26} /> : mode === 'walkingDead' ? <Skull size={26} /> : <Flag size={26} />}
              <strong>{game.result === 'won' ? (game.guesses.length === 1 ? 'First try!' : 'Got it!') : 'Out of guesses'}</strong>
              <span>
                The word was <b className="wordle-answer">{game.answer.toUpperCase()}</b>
                {kind ? `: ${kind}` : ''}
                {game.result === 'won' ? ` · ${game.guesses.length} of ${tries}` : ''}
              </span>
              <button className="btn btn-primary" onClick={playAgain} data-wordle-again>
                Play again
              </button>
            </div>
          )}

          <div className="wordle-keyboard" aria-label="Keyboard">
            {KEYBOARD.map((row, i) => (
              <div key={row} className="wordle-keys">
                {i === 2 && (
                  <button className="wordle-key wide" onMouseDown={(e) => e.preventDefault()} onClick={enter} tabIndex={-1} disabled={!!game.result}>
                    Enter
                  </button>
                )}
                {[...row].map((k) => (
                  <button
                    key={k}
                    className={`wordle-key ${keys[k] ?? ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => type(k)}
                    tabIndex={-1}
                    disabled={!!game.result}
                    aria-label={`${k.toUpperCase()}${keys[k] ? `, ${MARK_WORDS[keys[k]]}` : ''}`}
                    data-key={k}
                  >
                    {k.toUpperCase()}
                  </button>
                ))}
                {i === 2 && (
                  <button
                    className="wordle-key wide"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => erase()}
                    tabIndex={-1}
                    disabled={!!game.result}
                    aria-label="Backspace"
                  >
                    <Delete size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <section className="wordle-stats" aria-label="Stats" data-wordle-stats>
          <h3>
            <ChartColumn size={15} /> {modeInfo.label}, {length} letters
          </h3>
          <div className="wordle-numbers">
            <div>
              <strong>{s?.played ?? 0}</strong>
              <span>Played</span>
            </div>
            <div>
              <strong>{s?.played ? Math.round((wins / s.played) * 100) : 0}%</strong>
              <span>Won</span>
            </div>
            <div>
              <strong>{s?.streak ?? 0}</strong>
              <span>Streak</span>
            </div>
            <div>
              <strong>{s?.bestStreak ?? 0}</strong>
              <span>Best streak</span>
            </div>
          </div>
          <div className="wordle-spread" aria-label="Wins by number of guesses">
            {Array.from({ length: tries }, (_, i) => {
              const n = s?.wins[i] ?? 0
              const most = Math.max(1, ...(s?.wins ?? []))
              const now = game.result === 'won' && game.guesses.length === i + 1
              return (
                <div key={i} className="wordle-bar-row">
                  <span>{i + 1}</span>
                  <div className={`wordle-bar ${now ? 'now' : ''}`} style={{ width: `${Math.max(6, (n / most) * 100)}%` }}>
                    {n}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <p className="sudoku-help">
          Guess the hidden word in {tries} tries. After each guess, green letters are in the right place, yellow ones are in the word somewhere
          else, and grey ones aren’t in it (or not that many times). Any letters count as a guess, so you can try vowels or common letters to narrow
          it down. Type on your keyboard or click the keys. Each mode and length keeps its own round and stats.
        </p>
      </div>
    </div>
  )
}
