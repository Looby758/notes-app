import { useEffect, useRef, useState } from 'react'
import { ChartColumn } from 'lucide-react'
import { winPercent, type GameRecord } from '../../lib/gameStats'
import { formatTime } from '../../lib/sudoku'
import { motionLevel } from '../../lib/motion'

/** A number that counts up to its value when it first shows or goes up ("12", "75%"); anything else shows as it is. */
function CountUp({ value }: { value: string }) {
  const m = /^(\d+)(%?)$/.exec(value)
  const target = m ? Number(m[1]) : 0
  const [shown, setShown] = useState(() => (m && motionLevel() !== 'off' ? 0 : target))
  const from = useRef(shown)
  useEffect(() => {
    if (!m) return
    const begin = from.current
    if (begin >= target || motionLevel() === 'off') {
      from.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    let raf = 0
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 700)
      const v = Math.round(begin + (target - begin) * (1 - (1 - t) ** 3))
      from.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, !!m])
  return <>{m ? `${shown}${m[2]}` : value}</>
}

/** Played, win %, streak, best streak and fastest win for one game (or one way of playing it). */
export default function GameStats({
  title,
  record,
  extra,
  noTime
}: {
  title: string
  record: GameRecord | undefined
  extra?: { label: string; value: string }
  /** Leave out the best time (for games that aren't against the clock). */
  noTime?: boolean
}) {
  const r = record
  const cells = [
    { label: 'Played', value: String(r?.played ?? 0) },
    { label: 'Won', value: `${winPercent(r)}%` },
    { label: 'Streak', value: String(r?.streak ?? 0), hot: (r?.streak ?? 0) >= 3 },
    { label: 'Best streak', value: String(r?.bestStreak ?? 0) },
    ...(noTime ? [] : [{ label: 'Best time', value: r?.bestTime !== undefined ? formatTime(r.bestTime) : '–' }]),
    ...(extra ? [extra] : [])
  ]
  return (
    <section className="wordle-stats games-stats" aria-label="Stats" data-game-stats>
      <h3>
        <ChartColumn size={15} /> {title}
      </h3>
      <div className="games-numbers" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
        {cells.map((c) => (
          <div key={c.label} className={'hot' in c && c.hot ? 'hot' : ''}>
            <strong>
              <CountUp value={c.value} />
            </strong>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
