import { ChartColumn } from 'lucide-react'
import { winPercent, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'

/** Played, win %, streak, best streak and fastest win for one game (or one way of playing it). */
export default function GameStats({ title, record, extra }: { title: string; record: GameRecord | undefined; extra?: { label: string; value: string } }) {
  const r = record
  const cells = [
    { label: 'Played', value: String(r?.played ?? 0) },
    { label: 'Won', value: `${winPercent(r)}%` },
    { label: 'Streak', value: String(r?.streak ?? 0) },
    { label: 'Best streak', value: String(r?.bestStreak ?? 0) },
    { label: 'Best time', value: r?.bestTime !== undefined ? formatTime(r.bestTime) : '–' },
    ...(extra ? [extra] : [])
  ]
  return (
    <section className="wordle-stats games-stats" aria-label="Stats" data-game-stats>
      <h3>
        <ChartColumn size={15} /> {title}
      </h3>
      <div className="games-numbers" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
        {cells.map((c) => (
          <div key={c.label}>
            <strong>{c.value}</strong>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
