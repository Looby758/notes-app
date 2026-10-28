import './music.css'
import { useEffect, useState } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { formatTime } from '@shared/spotify'
import type { MusicMiniCommand, MusicMiniState } from '@shared/types'
import { currentPosition } from '../../store/music'

const send = (command: MusicMiniCommand): void => window.api.sendMusicMiniCommand(command)

/**
 * The floating mini player (its own small window, opened with #music): the song, play/pause and skip,
 * and a progress bar to click. You drag the window by its background.
 */
export default function MusicMini() {
  const [mini, setMini] = useState<MusicMiniState | null>(null)
  const [, setNow] = useState(0)
  useEffect(() => {
    void window.api.musicMiniLast().then((s) => s && setMini(s))
    return window.api.onMusicMiniState(setMini)
  }, [])
  const state = mini?.state
  useEffect(() => {
    if (!state?.playing) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state?.playing])

  const track = state?.track
  const duration = track?.durationMs ?? 0
  const pos = state && mini ? currentPosition(state, mini.at) : 0
  // Shown straight away, before the notes window catches up.
  const press = (action: 'toggle' | 'next' | 'previous'): void => {
    if (action === 'toggle' && mini?.state) setMini({ state: { ...mini.state, playing: !mini.state.playing, positionMs: pos }, at: Date.now() })
    send({ action })
  }

  return (
    <div className="music-mini" data-music-mini>
      <div className="music-art">{track?.art ? <img src={track.art} alt="" /> : <Music size={18} />}</div>
      <div className="music-text">
        <strong title={track?.name}>{track?.name ?? 'Nothing playing'}</strong>
        <span title={track?.artist}>{track ? track.artist : 'Pick something in the Notes player.'}</span>
        {track && (
          <div
            className="music-bar"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              if (duration) send({ seek: ((e.clientX - box.left) / box.width) * duration })
            }}
            title={`${formatTime(pos)} / ${formatTime(duration)}`}
          >
            <div style={{ width: `${duration ? (pos / duration) * 100 : 0}%` }} />
          </div>
        )}
      </div>
      <div className="music-controls">
        <button className="icon-btn" onClick={() => press('previous')} title="Previous">
          <SkipBack size={15} />
        </button>
        <button className="music-play" onClick={() => press('toggle')} title={state?.playing ? 'Pause' : 'Play'} data-music-mini-toggle>
          {state?.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn" onClick={() => press('next')} title="Next" data-music-mini-next>
          <SkipForward size={15} />
        </button>
      </div>
      <button className="icon-btn music-mini-close" onClick={() => window.api.setMusicMini(false)} title="Close the mini player (music keeps playing)">
        <X size={12} />
      </button>
    </div>
  )
}
