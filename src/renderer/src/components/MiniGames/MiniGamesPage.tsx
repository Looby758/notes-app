import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bomb, ChevronLeft, Grid2x2Check, Grid3x3, Joystick, Puzzle } from 'lucide-react'
import SudokuPage from '../Sudoku/SudokuPage'
import MinesweeperPage from '../Minesweeper/MinesweeperPage'
import NonogramPage from './NonogramPage'
import JigsawPage from './JigsawPage'
import { playMiniGame, useMiniGames, type MiniGameId } from '../../store/miniGames'

export const MINI_GAMES: { id: MiniGameId; name: string; blurb: string; icon: LucideIcon }[] = [
  { id: 'sudoku', name: 'Sudoku', blurb: 'Fill the grid so every row, column and box has 1 to 9 once', icon: Grid3x3 },
  { id: 'minesweeper', name: 'Minesweeper', blurb: 'Open every square that isn’t a mine', icon: Bomb },
  { id: 'nonogram', name: 'Nonograms', blurb: 'Use the number clues to reveal a hidden picture', icon: Grid2x2Check },
  { id: 'jigsaw', name: 'Jigsaw', blurb: 'Turn one of your photos into a jigsaw puzzle', icon: Puzzle }
]

export const miniGameName = (id: MiniGameId | null): string => MINI_GAMES.find((g) => g.id === id)?.name ?? 'Mini games'

const PAGES: Record<MiniGameId, ComponentType> = {
  sudoku: SudokuPage,
  minesweeper: MinesweeperPage,
  nonogram: NonogramPage,
  jigsaw: JigsawPage
}

/** Mini games: pick a game for a quick break, and get back to the list from inside it. */
export default function MiniGamesPage() {
  const playing = useMiniGames((s) => s.playing)

  if (playing) {
    const Game = PAGES[playing]
    return (
      <div className="minigames-page playing" data-minigames-page={playing}>
        <div className="minigames-bar">
          <button className="minigames-back" onClick={() => playMiniGame(null)} data-minigames-back>
            <ChevronLeft size={15} /> All games
          </button>
        </div>
        <Game key={playing} />
      </div>
    )
  }

  return (
    <div className="minigames-page" data-minigames-page>
      <div className="minigames-inner">
        <header className="sudoku-head">
          <h2>
            <Joystick size={20} /> Mini games
          </h2>
        </header>
        <p className="minigames-intro">Pick a game for a quick break. Each one remembers where you were.</p>
        <div className="minigames-grid">
          {MINI_GAMES.map(({ id, name, blurb, icon: Icon }) => (
            <button key={id} className="minigames-card" onClick={() => playMiniGame(id)} data-minigame={id}>
              <span className="minigames-icon">
                <Icon size={26} />
              </span>
              <strong>{name}</strong>
              <span>{blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
