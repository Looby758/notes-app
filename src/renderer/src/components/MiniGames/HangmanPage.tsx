import { useEffect, useRef, useState } from 'react'
import { Flag, Lightbulb, RotateCcw, Skull, Trophy, Type } from 'lucide-react'
import { HANGMAN_THEMES, hangmanClue, hangmanState, hangmanThemeOf, MAX_WRONG, pickHangmanWord, shownLetters, wrongGuesses, type HangmanTheme } from '../../lib/hangman'
import { loadRecords, saveGame, type GameRecord } from '../../lib/gameStats'
import { petCheer } from '../../lib/pet'
import GameStats from './GameStats'
import { useGameKeys } from './useGameKeys'

/** A round in progress (or just finished). */
interface Game {
  theme: HangmanTheme
  word: string
  guessed: string[]
  /** The clue was shown this round. */
  clue: boolean
  /** Gave up: shows the word and counts as a loss. */
  gaveUp: boolean
  counted: boolean
}

// Rounds and recent words live on this computer only (not in the notes folder): it's just for fun.
const GAME_KEY = 'notesapp.hangman.game'
const RECENT_KEY = 'notesapp.hangman.recent'
const MAX_RECENT = 300

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

function newGame(theme: HangmanTheme): Game {
  const recent = load<Partial<Record<HangmanTheme, string[]>>>(RECENT_KEY) ?? {}
  const word = pickHangmanWord(theme, recent[theme] ?? [])
  save(RECENT_KEY, { ...recent, [theme]: [...(recent[theme] ?? []), word].slice(-MAX_RECENT) })
  return { theme, word, guessed: [], clue: false, gaveUp: false, counted: false }
}

function loadGame(): Game | null {
  const g = load<Game>(GAME_KEY)
  return g && HANGMAN_THEMES.some((t) => t.id === g.theme) && typeof g.word === 'string' && /^[a-z]+$/.test(g.word) && Array.isArray(g.guessed) ? g : null
}

const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const statsId = (theme: HangmanTheme): string => `hangman:${theme}`

/** The drawing: gallows always, then one part per wrong letter. Walking Dead mode draws a walker. */
function Drawing({ wrong, walker, lost }: { wrong: number; walker: boolean; lost: boolean }) {
  const show = (n: number): string => (wrong >= n ? 'on' : '')
  return (
    <svg className={`hangman-drawing ${walker ? 'walker' : ''} ${lost ? 'lost' : ''}`} viewBox="0 0 200 220" aria-label={`${wrong} of ${MAX_WRONG} wrong`}>
      <g className="hangman-gallows">
        <line x1="20" y1="210" x2="140" y2="210" />
        <line x1="50" y1="210" x2="50" y2="20" />
        <line x1="50" y1="20" x2="130" y2="20" />
        <line x1="50" y1="50" x2="80" y2="20" />
        <line x1="130" y1="20" x2="130" y2="45" />
      </g>
      <g className="hangman-man">
        <circle className={show(1)} cx="130" cy="65" r="20" />
        {walker && wrong >= 1 && (
          <g className="hangman-eyes">
            <circle cx="123" cy="62" r="3" />
            <circle cx="137" cy="62" r="3" />
          </g>
        )}
        <line className={show(2)} x1="130" y1="85" x2="130" y2="145" />
        {/* A walker reaches out; a person's arms hang down. */}
        <line className={show(3)} x1="130" y1="100" x2={walker ? 165 : 105} y2={walker ? 100 : 125} />
        <line className={show(4)} x1="130" y1="100" x2={walker ? 168 : 155} y2={walker ? 110 : 125} />
        <line className={show(5)} x1="130" y1="145" x2="108" y2="185" />
        <line className={show(6)} x1="130" y1="145" x2="152" y2="185" />
      </g>
    </svg>
  )
}

/** Hangman: guess the word a letter at a time, any words or a theme (Walking Dead too). */
export default function HangmanPage() {
  const [game, setGame] = useState<Game>(() => loadGame() ?? newGame('everyday'))
  const [records, setRecords] = useState<Record<string, GameRecord>>(loadRecords)
  const page = useRef<HTMLDivElement>(null)

  const state = game.gaveUp ? 'lost' : hangmanState(game.word, game.guessed)
  const wrong = wrongGuesses(game.word, game.guessed)
  const twd = game.theme === 'walkingDead'
  const theme = hangmanThemeOf(game.theme)

  useEffect(() => save(GAME_KEY, game), [game])
  useEffect(() => page.current?.focus(), [])

  // Count each round once, when it ends.
  useEffect(() => {
    if (state === 'playing' || game.counted) return
    const rec = saveGame(statsId(game.theme), state === 'won')
    setRecords((r) => ({ ...r, [statsId(game.theme)]: rec }))
    setGame((g) => ({ ...g, counted: true }))
    if (state === 'won') petCheer()
  }, [state, game.counted, game.theme])

  const guess = (letter: string): void => {
    if (state !== 'playing' || game.guessed.includes(letter)) return
    setGame((g) => ({ ...g, guessed: [...g.guessed, letter] }))
  }

  const start = (themeId: HangmanTheme): void => {
    // A round left part way through counts as a loss, so the streak means something.
    if (state === 'playing' && game.guessed.length > 0) {
      const rec = saveGame(statsId(game.theme), false)
      setRecords((r) => ({ ...r, [statsId(game.theme)]: rec }))
    }
    setGame(newGame(themeId))
    page.current?.focus()
  }

  useGameKeys(page, (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter' && state !== 'playing') {
      e.preventDefault()
      start(game.theme)
    } else if (/^[a-z]$/i.test(e.key)) {
      e.preventDefault()
      guess(e.key.toLowerCase())
    }
  })

  const letters = shownLetters(game.word, game.guessed)
  const left = MAX_WRONG - wrong.length

  return (
    <div ref={page} className={`sudoku-page hangman-page ${twd ? 'twd' : ''}`} tabIndex={0} data-hangman-page>
      <div className="sudoku-inner hangman-inner">
        <header className="sudoku-head">
          <h2>
            {twd ? <Skull size={20} /> : <Type size={20} />} Hangman
          </h2>
        </header>

        <div className="sudoku-levels hangman-themes" role="group" aria-label="Words">
          {HANGMAN_THEMES.map((t) => (
            <button
              key={t.id}
              className={`sudoku-level ${game.theme === t.id ? 'active' : ''}`}
              onClick={() => start(t.id)}
              title={t.id === 'walkingDead' ? 'Characters, places, groups and more from the main Walking Dead TV show' : `${t.words.length} words`}
              data-hangman-theme={t.id}
            >
              {t.id === 'walkingDead' && <Skull size={13} />} {t.label}
            </button>
          ))}
        </div>

        <div className="sudoku-status">
          <span data-hangman-left>
            {state === 'playing' ? (
              <>
                <strong>{left}</strong> wrong guess{left === 1 ? '' : 'es'} left
              </>
            ) : (
              ''
            )}
          </span>
          <span className="mines-tools">
            {game.clue || state !== 'playing' ? (
              <span className="hangman-clue" data-hangman-clue>
                {hangmanClue(game.theme, game.word)}
              </span>
            ) : (
              <button className="sudoku-tool" onClick={() => setGame((g) => ({ ...g, clue: true }))} title="Show what kind of word it is" data-hangman-show-clue>
                <Lightbulb size={15} /> Clue
              </button>
            )}
            {state === 'playing' && game.guessed.length > 0 ? (
              <button className="sudoku-tool" onClick={() => setGame((g) => ({ ...g, gaveUp: true }))} title="Show the word (counts as a loss)" data-hangman-give-up>
                <Flag size={15} /> Give up
              </button>
            ) : (
              <button className="sudoku-tool" onClick={() => start(game.theme)} title="A new word (Enter when a round is over)" data-hangman-new>
                <RotateCcw size={15} /> New word
              </button>
            )}
          </span>
        </div>

        <div className="hangman-play">
          <Drawing wrong={state === 'lost' ? MAX_WRONG : wrong.length} walker={twd} lost={state === 'lost'} />
          <div className="hangman-side">
            <div className="hangman-word" aria-label="The word so far" data-hangman-word>
              {letters.map((l, i) => (
                <span key={i} className={`hangman-letter ${l ? 'shown' : ''} ${!l && state === 'lost' ? 'missed' : ''}`}>
                  {(l ?? (state === 'lost' ? game.word[i] : '')).toUpperCase()}
                </span>
              ))}
            </div>
            <div className="hangman-wrong" aria-label="Wrong letters">
              {wrong.length ? wrong.map((l) => <span key={l}>{l.toUpperCase()}</span>) : <em>No wrong letters yet</em>}
            </div>
            {state !== 'playing' && (
              <div className="nono-result" data-hangman-result={state}>
                {state === 'won' ? <Trophy size={26} /> : twd ? <Skull size={26} /> : <Flag size={26} />}
                <strong>{state === 'won' ? (wrong.length === 0 ? 'Perfect!' : 'Got it!') : 'Out of guesses'}</strong>
                <span>
                  The word was <b>{game.word.toUpperCase()}</b>
                </span>
                <button className="btn btn-primary" onClick={() => start(game.theme)} data-hangman-again>
                  Next word
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="wordle-keyboard hangman-keyboard" aria-label="Keyboard">
          {KEYBOARD.map((row) => (
            <div key={row} className="wordle-keys">
              {[...row].map((k) => {
                const used = game.guessed.includes(k)
                const mark = used ? (game.word.includes(k) ? 'right' : 'out') : ''
                return (
                  <button
                    key={k}
                    className={`wordle-key ${mark}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => guess(k)}
                    tabIndex={-1}
                    disabled={used || state !== 'playing'}
                    data-key={k}
                  >
                    {k.toUpperCase()}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <GameStats title={`Hangman, ${theme.label}`} record={records[statsId(game.theme)]} noTime />

        <p className="sudoku-help">
          Guess the word one letter at a time, by typing or clicking the keys. Each wrong letter adds to the drawing, and {MAX_WRONG} wrong letters
          ends the round. Clue tells you what kind of word it is. Every theme keeps its own stats.
          {twd && ' Walking Dead words are all from the main TV show, and a walker comes for you instead.'}
        </p>
      </div>
    </div>
  )
}
