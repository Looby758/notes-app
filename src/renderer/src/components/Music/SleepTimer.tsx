import { useEffect, useState } from 'react'
import { Check, Moon } from 'lucide-react'
import { formatTime } from '@shared/spotify'
import { setSleepTimer, sleepLeft, useMusic } from '../../store/music'

const MINUTES = [15, 30, 45, 60, 90]

/** Re-draws every second while a timer is counting down. */
function useCountdown(): number | null {
  const sleep = useMusic((s) => s.sleep)
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!sleep || !('until' in sleep)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [sleep])
  return sleepLeft()
}

/** The moon in the player: shows how long is left when the timer is on. */
export function SleepButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const sleep = useMusic((s) => s.sleep)
  const left = useCountdown()
  return (
    <button
      className={`icon-btn music-shuffle music-sleep ${sleep ? 'active' : ''} ${open ? 'open' : ''}`}
      onClick={onClick}
      title={sleep ? (left === null ? 'Pausing at the end of this song' : `Pausing in ${formatTime(left)}`) : 'Sleep timer'}
      data-music-sleep
    >
      <Moon size={13} />
      {left !== null && <span>{Math.ceil(left / 60_000)}m</span>}
    </button>
  )
}

/** Choosing when the music stops. */
export function SleepTimer({ onPicked }: { onPicked: () => void }) {
  const sleep = useMusic((s) => s.sleep)
  const hasSong = useMusic((s) => !!s.state?.track?.uri)
  const left = useCountdown()
  const pick = (when: number | 'song' | null): void => {
    setSleepTimer(when)
    onPicked()
  }
  const option = (label: string, when: number | 'song' | null, on: boolean) => (
    <li key={label}>
      <button className={on ? 'active' : ''} onClick={() => pick(when)} data-music-sleep-option={label}>
        <span className="music-sleep-check">{on && <Check size={13} />}</span>
        <span className="music-item-text">
          <strong>{label}</strong>
        </span>
      </button>
    </li>
  )
  return (
    <>
      <h4 className="music-panel-heading">Sleep timer</h4>
      <p className="music-panel-note music-sleep-status">
        {!sleep ? 'Pause the music after a while.' : left === null ? 'Pausing when this song ends.' : `Pausing in ${formatTime(left)}.`}
      </p>
      <ul className="music-items">
        {MINUTES.map((m) => option(m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`, m, false))}
        {hasSong && option('End of this song', 'song', !!sleep && 'song' in sleep)}
        {sleep && option('Turn off', null, false)}
      </ul>
    </>
  )
}
