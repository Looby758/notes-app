import { useEffect, useRef, useState } from 'react'
import { Heart, Volume1, Volume2, VolumeX } from 'lucide-react'
import { musicSetVolume, musicToggleLike, useMusic } from '../../store/music'

/** Small controls shared by the Home page's "Now playing" box, the full-screen player and the Music page. */

/** The heart for a Spotify song (in your Liked Songs or not). */
export function LikeButton({ uri }: { uri: string }) {
  const liked = useMusic((s) => s.liked)
  const connected = useMusic((s) => !!s.status?.connected)
  const on = liked?.uri === uri && liked.liked
  if (!/^spotify:(track|episode):/.test(uri)) return null
  return (
    <button
      className={`icon-btn music-like ${on ? 'active' : ''}`}
      onClick={() => (connected ? musicToggleLike() : useMusic.setState({ error: 'Connect your Spotify account in Settings → Music to like songs.' }))}
      title={on ? 'In your Liked Songs (click to remove)' : 'Add to Liked Songs'}
      data-music-like
    >
      <Heart size={14} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

/** A volume slider with a mute button (Spotify's volume, or your own music's). */
export function VolumeSlider({ volume }: { volume: number }) {
  // While you drag, the slider follows your hand rather than what Spotify last said.
  const [dragging, setDragging] = useState<number | null>(null)
  const [beforeMute, setBeforeMute] = useState(50)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const shown = dragging ?? volume
  const send = (v: number): void => {
    setDragging(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void musicSetVolume(v).finally(() => setTimeout(() => setDragging(null), 1500))
    }, 150)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const Icon = shown === 0 ? VolumeX : shown < 50 ? Volume1 : Volume2
  return (
    <div className="music-volume">
      <button
        className="icon-btn"
        onClick={() => {
          if (shown > 0) {
            setBeforeMute(shown)
            send(0)
          } else send(beforeMute || 50)
        }}
        title={shown === 0 ? 'Unmute' : 'Mute'}
      >
        <Icon size={13} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        onChange={(e) => send(Number(e.target.value))}
        style={{ '--fill': `${shown}%` } as React.CSSProperties}
        title={`Volume ${shown}%`}
        aria-label="Volume"
        data-music-volume
      />
    </div>
  )
}
