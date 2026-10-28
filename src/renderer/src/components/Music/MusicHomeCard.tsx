import { useEffect, useState } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { currentPosition, musicControl, musicSeek, setMusicOpen, useMusic, watchMusic } from '../../store/music'
import { HomeBox } from '../Home/HomePage'

/** The Home page's "Now playing" box: nothing until Spotify can be controlled (the Mac app, or your account). */
export default function MusicHomeCard() {
  const status = useMusic((s) => s.status)
  const usable = !!status && (status.appControl || status.connected)
  useEffect(() => (usable ? watchMusic() : undefined), [usable])
  if (!usable) return null
  return (
    <HomeBox
      icon={<Music size={15} />}
      title="Now playing"
      action={
        <button className="link-button home-box-action" onClick={() => setMusicOpen(true)}>
          Player
        </button>
      }
    >
      <Playing />
    </HomeBox>
  )
}

function Playing() {
  const state = useMusic((s) => s.state)
  const error = useMusic((s) => s.error)
  if (!state) return <p className="home-empty">Looking for Spotify…</p>
  if (state.hint === 'not-running' || state.hint === 'no-device') {
    return (
      <div className="music-home-empty">
        <span>{state.hint === 'not-running' ? 'Spotify isn’t open.' : 'Spotify isn’t playing anywhere.'}</span>
        <button className="btn" onClick={() => window.api.musicOpen('app')}>
          Open Spotify
        </button>
      </div>
    )
  }
  // Automation permission, account setup and so on: the corner player explains those.
  if (state.hint) {
    return (
      <div className="music-home-empty">
        <span>Spotify needs setting up.</span>
        <button className="btn" onClick={() => setMusicOpen(true)}>
          Show player
        </button>
      </div>
    )
  }
  const track = state.track
  if (!track) {
    return (
      <div className="music-home-empty">
        <span>Nothing playing.</span>
        <button className="btn" onClick={() => setMusicOpen(true)}>
          Pick a playlist
        </button>
      </div>
    )
  }
  return (
    <>
      <div className="music-home" data-music-home>
        <div className="music-home-art">{track.art ? <img src={track.art} alt="" /> : <Music size={22} />}</div>
        <div className="music-home-text">
          <strong title={track.name}>{track.name}</strong>
          <span title={track.artist}>{[track.artist, state.device].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="music-controls">
          <button className="icon-btn" onClick={() => musicControl('previous')} title="Previous">
            <SkipBack size={15} />
          </button>
          <button className="music-play" onClick={() => musicControl('toggle')} title={state.playing ? 'Pause' : 'Play'} data-music-home-toggle>
            {state.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn" onClick={() => musicControl('next')} title="Next">
            <SkipForward size={15} />
          </button>
        </div>
      </div>
      <HomeProgress />
      {(error || state.error) && <p className="music-error">{error ?? state.error}</p>}
    </>
  )
}

/** A thin bar showing how far through the song you are; click to jump. */
function HomeProgress() {
  const state = useMusic((s) => s.state)
  const at = useMusic((s) => s.at)
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!state?.playing) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state?.playing])
  const duration = state?.track?.durationMs ?? 0
  if (!state || !duration) return null
  const pct = (currentPosition(state, at) / duration) * 100
  return (
    <div
      className="music-bar music-home-bar"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        musicSeek(((e.clientX - box.left) / box.width) * duration)
      }}
      title="Jump to here"
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}
