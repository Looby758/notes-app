import { useEffect, useRef, useState } from 'react'
import { Music, X } from 'lucide-react'
import type { MusicTrack } from '@shared/spotify'
import { setMusicOpen, useMusic } from '../../store/music'
import { usePrefs } from '../../store/prefs'

const SHOW_MS = 4500

/** A pop-up in the top corner with the new song's name and picture whenever the music moves on to the next one. */
export function SongPopup() {
  const on = usePrefs((s) => s.prefs.musicSongPopup)
  const [song, setSong] = useState<MusicTrack | null>(null)
  const [leaving, setLeaving] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!on) return
    // The song you started yourself (or that was playing when Notes opened) doesn't need one.
    let last = useMusic.getState().state?.track?.uri
    return useMusic.subscribe(({ state }) => {
      const track = state?.track
      if (!track?.uri || track.uri === last) return
      const first = last === undefined
      // A new song that hasn't started yet gets its pop-up once it does.
      if (!first && !state?.playing) return
      last = track.uri
      if (first) return
      clearTimeout(hideTimer.current)
      setLeaving(false)
      setSong(track)
      hideTimer.current = setTimeout(() => setLeaving(true), SHOW_MS)
    })
  }, [on])
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  if (!song || !on) return null
  return (
    <div
      className={`music-popup ${leaving ? 'leaving' : ''}`}
      onAnimationEnd={() => leaving && setSong(null)}
      onClick={() => {
        setMusicOpen(true)
        setSong(null)
      }}
      title="Show the music player"
      data-music-popup
    >
      <div className="music-art">{song.art ? <img src={song.art} alt="" /> : <Music size={18} />}</div>
      <div className="music-text">
        <span className="music-popup-label">Now playing</span>
        <strong>{song.name}</strong>
        <span>{song.artist}</span>
      </div>
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation()
          setSong(null)
        }}
        title="Close"
      >
        <X size={12} />
      </button>
    </div>
  )
}
