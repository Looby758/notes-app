import { useEffect, useRef, useState } from 'react'
import { CloudRain, Coffee, LogOut, Timer, Volume2, Waves, X } from 'lucide-react'
import { useUI, toggleZen } from '../store/ui'
import { chime, playSound, playingSound, setVolume, type Sound } from '../lib/ambience'
import { notify } from '../store/notify'

const SOUNDS: { id: Sound; label: string; icon: typeof CloudRain }[] = [
  { id: 'rain', label: 'Rain', icon: CloudRain },
  { id: 'cafe', label: 'Café', icon: Coffee },
  { id: 'white', label: 'White noise', icon: Waves }
]

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Zen mode's controls: sounds, a focus timer, and the way out. They fade away while you write and
 * come back when you move the mouse.
 */
export default function ZenBar() {
  const zen = useUI((s) => s.zen)
  const [visible, setVisible] = useState(true)
  const [sound, setSound] = useState<Sound | null>(playingSound())
  const [vol, setVol] = useState(0.5)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Show on mouse movement; hide after a few quiet seconds.
  useEffect(() => {
    if (!zen) return
    const wake = (): void => {
      setVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setVisible(false), 2500)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      clearTimeout(hideTimer.current)
    }
  }, [zen])

  // Leaving zen stops the sound and the timer.
  useEffect(() => {
    if (zen) return
    playSound(null)
    setSound(null)
    setEndsAt(null)
  }, [zen])

  // The countdown.
  useEffect(() => {
    if (!endsAt) return
    const tick = (): void => {
      const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) {
        setEndsAt(null)
        chime()
        notify('Focus session done. Nice work.', 'info')
        setVisible(true)
      }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [endsAt])

  if (!zen) return null

  const pick = (s: Sound): void => {
    const next = sound === s ? null : s
    playSound(next)
    setSound(next)
  }

  return (
    <div className={`zen-bar ${visible || endsAt ? 'show' : ''} ${visible ? '' : 'quiet'}`} data-zen-bar>
      <div className="zen-group">
        {SOUNDS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`zen-btn ${sound === id ? 'on' : ''}`} onClick={() => pick(id)} title={sound === id ? `Stop ${label.toLowerCase()}` : label} data-sound={id}>
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
        <label className="zen-volume" title="Volume">
          <Volume2 size={14} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            onChange={(e) => {
              setVol(Number(e.target.value))
              setVolume(Number(e.target.value))
            }}
          />
        </label>
      </div>
      <div className="zen-group">
        <Timer size={15} className="zen-timer-icon" />
        {endsAt ? (
          <>
            <span className="zen-time" data-zen-time>
              {fmt(left)}
            </span>
            <button className="zen-btn" onClick={() => setEndsAt(null)} title="Stop the timer">
              <X size={14} />
            </button>
          </>
        ) : (
          [15, 25, 50].map((m) => (
            <button key={m} className="zen-btn" onClick={() => setEndsAt(Date.now() + m * 60_000)} title={`Focus for ${m} minutes`} data-timer={m}>
              {m} min
            </button>
          ))
        )}
      </div>
      <button className="zen-btn zen-exit" onClick={toggleZen} title="Leave zen mode (Esc)">
        <LogOut size={14} /> Leave
      </button>
    </div>
  )
}
