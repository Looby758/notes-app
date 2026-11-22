import { useMemo, type ComponentType, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bomb, BrickWall, ChevronLeft, Club, Crown, Grid2x2Check, Grid3x3, Joystick, Puzzle, Spade, SpellCheck2, SquareStack, TextSearch, Type } from 'lucide-react'
import SudokuPage from '../Sudoku/SudokuPage'
import MinesweeperPage from '../Minesweeper/MinesweeperPage'
import NonogramPage from './NonogramPage'
import JigsawPage from './JigsawPage'
import WordlePage from './WordlePage'
import WordSearchPage from './WordSearchPage'
import HangmanPage from './HangmanPage'
import BreakoutPage from './BreakoutPage'
import BlackjackPage from './BlackjackPage'
import SolitairePage from './SolitairePage'
import Game2048Page from './Game2048Page'
import ChessPage from './ChessPage'
import { playMiniGame, useMiniGames, type MiniGameId } from '../../store/miniGames'
import { loadRecords, type GameRecord } from '../../lib/gameStats'
import Confetti from './Confetti'
import './polish.css'

export type MiniGameGroup = 'Puzzles' | 'Words' | 'Cards' | 'Arcade and board'

export const MINI_GAMES: { id: MiniGameId; name: string; blurb: string; icon: LucideIcon; group: MiniGameGroup; colour: string }[] = [
  { id: 'sudoku', name: 'Sudoku', blurb: 'Fill the grid so every row, column and box has 1 to 9 once', icon: Grid3x3, group: 'Puzzles', colour: '#4c8dff' },
  { id: 'minesweeper', name: 'Minesweeper', blurb: 'Open every square that isn’t a mine', icon: Bomb, group: 'Puzzles', colour: '#ff6b5b' },
  { id: 'nonogram', name: 'Nonograms', blurb: 'Use the number clues to reveal a hidden picture', icon: Grid2x2Check, group: 'Puzzles', colour: '#b37bff' },
  { id: 'jigsaw', name: 'Jigsaw', blurb: 'Turn one of your photos into a jigsaw puzzle', icon: Puzzle, group: 'Puzzles', colour: '#ff9f43' },
  { id: 'wordle', name: 'Wordle', blurb: 'Guess the hidden word, 2 to 8 letters, or play Walking Dead mode', icon: SpellCheck2, group: 'Words', colour: '#3fbf6a' },
  { id: 'wordsearch', name: 'Word search', blurb: 'Find the hidden words, endless puzzles, including a Walking Dead theme', icon: TextSearch, group: 'Words', colour: '#22c3b5' },
  { id: 'hangman', name: 'Hangman', blurb: 'Guess the word a letter at a time, any words or a theme, Walking Dead too', icon: Type, group: 'Words', colour: '#ef5a6f' },
  { id: 'solitaire', name: 'Solitaire', blurb: 'Classic Klondike patience, draw one or draw three', icon: Spade, group: 'Cards', colour: '#2fb36b' },
  { id: 'blackjack', name: 'Blackjack', blurb: 'Beat the dealer to 21 with pretend chips: hit, stand, double or split', icon: Club, group: 'Cards', colour: '#f5a524' },
  { id: 'g2048', name: '2048', blurb: 'Slide the tiles so matching numbers join, and make 2048', icon: SquareStack, group: 'Arcade and board', colour: '#ff8a3d' },
  { id: 'breakout', name: 'Breakout', blurb: 'Bounce the ball to smash every brick, level after level', icon: BrickWall, group: 'Arcade and board', colour: '#ff4fa3' },
  { id: 'chess', name: 'Chess', blurb: 'Play the computer (easy, medium or hard) or a friend on this computer', icon: Crown, group: 'Arcade and board', colour: '#d4a85a' }
]

const GROUPS: MiniGameGroup[] = ['Puzzles', 'Words', 'Cards', 'Arcade and board']

/** Where each game keeps its played and won counts (lib/gameStats), if it uses them. */
const STATS_PREFIX: Partial<Record<MiniGameId, string>> = {
  wordsearch: 'wordsearch',
  hangman: 'hangman',
  solitaire: 'solitaire',
  blackjack: 'blackjack',
  g2048: '2048',
  chess: 'chess'
}

/** Games played and won across every way of playing one game. */
function totals(records: Record<string, GameRecord>, id: MiniGameId): { played: number; won: number } | null {
  const prefix = STATS_PREFIX[id]
  if (!prefix) return null
  let played = 0
  let won = 0
  for (const [key, r] of Object.entries(records)) {
    if (key !== prefix && !key.startsWith(`${prefix}:`)) continue
    played += r.played
    won += r.won
  }
  return played ? { played, won } : null
}

export const miniGameName = (id: MiniGameId | null): string => MINI_GAMES.find((g) => g.id === id)?.name ?? 'Mini games'

const PAGES: Record<MiniGameId, ComponentType> = {
  sudoku: SudokuPage,
  minesweeper: MinesweeperPage,
  nonogram: NonogramPage,
  jigsaw: JigsawPage,
  wordle: WordlePage,
  wordsearch: WordSearchPage,
  hangman: HangmanPage,
  solitaire: SolitairePage,
  blackjack: BlackjackPage,
  g2048: Game2048Page,
  breakout: BreakoutPage,
  chess: ChessPage
}

/** Mini games: pick a game for a quick break, and get back to the list from inside it. */
export default function MiniGamesPage() {
  const playing = useMiniGames((s) => s.playing)
  // Read again each time you come back to the list, so the counts are up to date.
  const records = useMemo(() => (playing ? {} : loadRecords()), [playing])

  if (playing) {
    const Game = PAGES[playing]
    const info = MINI_GAMES.find((g) => g.id === playing)
    return (
      <div className="minigames-page playing" style={{ '--game': info?.colour } as CSSProperties} data-minigames-page={playing}>
        <div className="minigames-glow" aria-hidden="true" />
        <div className="minigames-bar">
          <button className="minigames-back" onClick={() => playMiniGame(null)} data-minigames-back>
            <ChevronLeft size={15} /> All games
          </button>
        </div>
        <Game key={playing} />
        <Confetti />
      </div>
    )
  }

  let n = 0
  return (
    <div className="minigames-page" data-minigames-page>
      <div className="minigames-glow" aria-hidden="true" />
      <div className="minigames-inner">
        <header className="minigames-hero">
          <span className="minigames-hero-icon">
            <Joystick size={26} />
          </span>
          <div>
            <h2>Mini games</h2>
            <p className="minigames-intro">
              {MINI_GAMES.length} games for a quick break. Each one remembers where you were.
            </p>
          </div>
        </header>
        {GROUPS.map((group) => (
          <section key={group} className="minigames-group">
            <h3>{group}</h3>
            <div className="minigames-grid">
              {MINI_GAMES.filter((g) => g.group === group).map(({ id, name, blurb, icon: Icon, colour }) => {
                const t = totals(records, id)
                return (
                  <button
                    key={id}
                    className="minigames-card"
                    style={{ '--game': colour, '--n': n++ } as CSSProperties}
                    onClick={() => playMiniGame(id)}
                    data-minigame={id}
                  >
                    <span className="minigames-icon">
                      <Icon size={26} />
                    </span>
                    <strong>{name}</strong>
                    <span>{blurb}</span>
                    {t && (
                      <em className="minigames-played">
                        {t.played} played · {t.won} won
                      </em>
                    )}
                    <span className="minigames-play">Play</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
