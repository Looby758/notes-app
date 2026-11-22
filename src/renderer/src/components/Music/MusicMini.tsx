import './music.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, ListMusic, Music, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { formatTime } from '@shared/spotify'
import type { MusicMiniCommand, MusicMiniLayout, MusicMiniState } from '@shared/types'
import { currentPosition } from '../../store/music'
import { Visualiser } from './Visualiser'

const send = (command: MusicMiniCommand): void => window.api.sendMusicMiniCommand(command)

/**
 * The floating mini player (its own small window, opened with #music): the song, play/pause and skip,
 * and a progress bar to click, with the visualiser and Up next under it (each can be hidden). You
 * drag the window by its background.
 */
export default function MusicMini() {
  const [mini, setMini] = useState<MusicMiniState | null>(null)
  const [, setNow] = useState(0)
  const [layout, setLayout] = useState<MusicMiniLayout>({ visualiser: true, upNext: true })
  // The visualiser's bars arrive from the notes window, where the music plays.
  const bars = useRef<number[] | null>(null)
  const levels = useCallback(() => (bars.current ? bars.current.map((v) => v / 100) : null), [])
  useEffect(() => {
    void window.api.musicMiniLast().then((s) => s && setMini(s))
    void window.api.musicMiniLayout().then(setLayout)
    const offLevels = window.api.onMusicMiniLevels((l) => (bars.current = l))
    const offLayout = window.api.onMusicMiniLayout(setLayout)
    const offState = window.api.onMusicMiniState(setMini)
    return () => {
      offLevels()
      offLayout()
      offState()
    }
  }, [])
  const toggle = (part: keyof MusicMiniLayout): void => {
    const next = { ...layout, [part]: !layout[part] }
    setLayout(next)
    void window.api.setMusicMiniLayout(next)
  }
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

  const local = state?.source === 'local'
  const upNext = mini?.upNext ?? []
  return (
    <div className="music-mini-window">
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
        <div className="music-mini-parts">
          <button
            className={`icon-btn ${layout.visualiser ? 'on' : ''}`}
            onClick={() => toggle('visualiser')}
            title={layout.visualiser ? 'Hide the visualiser' : 'Show the visualiser'}
            data-music-mini-part="visualiser"
          >
            <AudioLines size={11} />
          </button>
          <button className={`icon-btn ${layout.upNext ? 'on' : ''}`} onClick={() => toggle('upNext')} title={layout.upNext ? 'Hide Up next' : 'Show Up next'} data-music-mini-part="upNext">
            <ListMusic size={11} />
          </button>
        </div>
      </div>
      {layout.visualiser && <div className="music-mini-visualiser">{local ? <Visualiser playing={!!state?.playing} levels={levels} /> : <span>The visualiser shows your own music.</span>}</div>}
      {layout.upNext && (
        <div className="music-mini-next" data-music-mini-next-list>
          <span className="music-mini-heading">Up next</span>
          {!local ? (
            <p>Up next shows here when your own music is playing.</p>
          ) : upNext.length === 0 ? (
            <p>Nothing after this song.</p>
          ) : (
            <ul>
              {upNext.map((s, i) => (
                <li key={i}>
                  <button onClick={() => send({ jump: i })} title={`Play ${s.title} now`} data-music-mini-jump={s.title}>
                    <span className="music-mini-next-art">{s.art ? <img src={s.art} alt="" /> : <Music size={12} />}</span>
                    <span className="music-mini-next-text">
                      <strong>{s.title}</strong>
                      <span>{s.artist || 'Unknown artist'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
