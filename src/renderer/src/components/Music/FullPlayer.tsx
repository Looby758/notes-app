import './fullPlayer.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { AudioLines, ChevronDown, Expand, Heart, ListMusic, Mic2, X, Minimize, Music, Pause, Pencil, Play, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Smartphone } from 'lucide-react'
import { formatTime } from '@shared/spotify'
import { activeLine, parseLyrics, type Lyrics } from '@shared/lyrics'
import { currentPosition, musicControl, musicSeek, useMusic } from '../../store/music'
import { clearUpNext, localJump, moveInQueue, removeFromQueue, useLocalMusic } from '../../store/localMusic'
import { localArtUrl } from '@shared/localMusic'
import { isLiked, toggleLike, useMusicData } from '../../store/musicData'
import { setPrefs, usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { errorMessage } from '../../lib/paths'
import { Visualiser } from './Visualiser'
import { VolumeSlider } from './Controls'
import { RemotePanel, SoundPanel } from './SoundPanel'

/**
 * The full-screen Now playing view: the cover big, the song's name, a large visualiser, the lyrics
 * (lit up line by line when they have times), and the controls. Esc or the arrow at the top closes it.
 */

/** What shows beside the cover: the lyrics, Up next, or nothing. */
type Side = 'lyrics' | 'queue' | null

export const useFullPlayer = create<{ open: boolean; side: Side }>(() => ({ open: false, side: readSidePref() }))

const SIDE_KEY = 'orbit.fullPlayerSide'
function readSidePref(): Side {
  try {
    const v = localStorage.getItem(SIDE_KEY)
    return v === 'queue' ? 'queue' : v === 'none' ? null : 'lyrics'
  } catch {
    return 'lyrics'
  }
}

export const openFullPlayer = (): void => useFullPlayer.setState({ open: true })

export function closeFullPlayer(): void {
  useFullPlayer.setState({ open: false })
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
}

export function FullPlayer() {
  const open = useFullPlayer((s) => s.open)
  return open ? <Full /> : null
}

function Full() {
  const state = useMusic((s) => s.state)
  const at = useMusic((s) => s.at)
  const local = useMusic((s) => s.local)
  const queue = useLocalMusic((s) => s.queue)
  const index = useLocalMusic((s) => s.index)
  const data = useMusicData((s) => s.data)
  const side = useFullPlayer((s) => s.side)
  const visualiserOn = usePrefs((s) => s.prefs.musicVisualiser)
  const [panel, setPanel] = useState<'sound' | 'remote' | null>(null)
  const [screen, setScreen] = useState(!!document.fullscreenElement)
  const box = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)

  const song = local && state?.source === 'local' ? queue[index] : undefined
  const track = state?.track
  const playing = !!state?.playing
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [playing])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (panel) setPanel(null)
        else closeFullPlayer()
      } else if (e.key === ' ') {
        e.preventDefault()
        void musicControl('toggle')
      }
    }
    const fs = (): void => setScreen(!!document.fullscreenElement)
    window.addEventListener('keydown', key, true)
    document.addEventListener('fullscreenchange', fs)
    return () => {
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('fullscreenchange', fs)
    }
  }, [panel])

  const duration = track?.durationMs ?? 0
  const pos = state ? currentPosition(state, at) : 0
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? pos
  const liked = song ? isLiked(data, song) : false
  const setSide = (next: Side): void => {
    useFullPlayer.setState({ side: next })
    try {
      localStorage.setItem(SIDE_KEY, next ?? 'none')
    } catch {
      // Only a convenience.
    }
  }
  const toggleSide = (which: Exclude<Side, null>): void => setSide(side === which ? null : which)

  return (
    <div className={`full-player ${side && song ? 'with-lyrics' : ''}`} ref={box} role="dialog" aria-label="Now playing" data-full-player>
      <div className="fp-backdrop" style={track?.art ? { backgroundImage: `url("${track.art}")` } : undefined} />
      <header className="fp-top">
        <button className="icon-btn" onClick={closeFullPlayer} title="Close (Esc)" data-fp-close>
          <ChevronDown size={22} />
        </button>
        <span>Now playing{song?.album ? ` · ${song.album}` : ''}</span>
        <button
          className="icon-btn"
          onClick={() => (screen ? void document.exitFullscreen().catch(() => undefined) : void box.current?.requestFullscreen().catch(() => undefined))}
          title={screen ? 'Leave full screen' : 'Fill the whole screen'}
          data-fp-screen
        >
          {screen ? <Minimize size={18} /> : <Expand size={18} />}
        </button>
      </header>

      <div className="fp-body">
        <div className="fp-cover-side">
          <div className="fp-cover">{track?.art ? <img src={track.art} alt="" /> : <Music size={96} />}</div>
          <div className="fp-title">
            <div>
              <h1 title={track?.name}>{track?.name ?? 'Nothing playing'}</h1>
              <p>{track ? track.artist || 'Unknown artist' : 'Play something from your music.'}</p>
            </div>
            {song && (
              <button className={`icon-btn fp-heart ${liked ? 'on' : ''}`} onClick={() => void toggleLike([song])} title={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} data-fp-like>
                <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>
        </div>
        {side === 'lyrics' && song && <LyricsPane path={song.path} title={song.title} artist={song.artist} positionMs={shown} />}
        {side === 'queue' && song && <UpNextPane />}
      </div>

      {state?.source === 'local' && visualiserOn && <Visualiser playing={playing} big className="fp-visualiser" />}

      <footer className="fp-controls">
        <div className="fp-progress">
          <span>{formatTime(shown)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(shown, duration)}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (scrub !== null) void musicSeek(scrub)
              setScrub(null)
            }}
            onKeyUp={() => {
              if (scrub !== null) void musicSeek(scrub)
              setScrub(null)
            }}
            style={{ '--fill': `${duration ? (Math.min(shown, duration) / duration) * 100 : 0}%` } as React.CSSProperties}
            disabled={!track}
            aria-label="Where in the song"
            data-fp-seek
          />
          <span>{duration ? formatTime(duration) : '0:00'}</span>
        </div>
        <div className="fp-buttons">
          <div className="fp-left">
            {song && (
              <button className={`icon-btn ${side === 'lyrics' ? 'fp-on' : ''}`} onClick={() => toggleSide('lyrics')} title={side === 'lyrics' ? 'Hide lyrics' : 'Show lyrics'} data-fp-lyrics>
                <Mic2 size={18} />
              </button>
            )}
            {song && (
              <button className={`icon-btn ${side === 'queue' ? 'fp-on' : ''}`} onClick={() => toggleSide('queue')} title={side === 'queue' ? 'Hide Up next' : 'Show Up next'} data-fp-queue>
                <ListMusic size={18} />
              </button>
            )}
            {state?.source === 'local' && (
              <button className={`icon-btn ${visualiserOn ? 'fp-on' : ''}`} onClick={() => setPrefs({ musicVisualiser: !visualiserOn })} title={visualiserOn ? 'Hide the visualiser' : 'Show the visualiser'}>
                <AudioLines size={18} />
              </button>
            )}
          </div>
          <div className="fp-middle">
            <button className={`icon-btn ${state?.shuffle ? 'fp-on' : ''}`} onClick={() => musicControl('shuffle')} title="Shuffle">
              <Shuffle size={20} />
            </button>
            <button className="icon-btn" onClick={() => musicControl('previous')} title="Previous">
              <SkipBack size={26} fill="currentColor" />
            </button>
            <button className="fp-play" onClick={() => musicControl('toggle')} title={playing ? 'Pause' : 'Play'} data-fp-toggle>
              {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
            </button>
            <button className="icon-btn" onClick={() => musicControl('next')} title="Next" data-fp-next>
              <SkipForward size={26} fill="currentColor" />
            </button>
            <button className={`icon-btn ${state?.repeat && state.repeat !== 'off' ? 'fp-on' : ''}`} onClick={() => musicControl('repeat')} title="Repeat">
              {state?.repeat === 'track' ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>
          <div className="fp-right">
            {state?.source === 'local' && (
              <>
                <button className={`icon-btn ${panel === 'remote' ? 'fp-on' : ''}`} onClick={() => setPanel(panel === 'remote' ? null : 'remote')} title="Phone remote" data-fp-remote>
                  <Smartphone size={18} />
                </button>
                <button className={`icon-btn ${panel === 'sound' ? 'fp-on' : ''}`} onClick={() => setPanel(panel === 'sound' ? null : 'sound')} title="Sound: crossfade, equaliser, visualiser" data-fp-sound>
                  <SlidersHorizontal size={18} />
                </button>
              </>
            )}
            {state?.volume !== undefined && <VolumeSlider volume={state.volume} />}
          </div>
        </div>
        {panel === 'sound' && <SoundPanel onClose={() => setPanel(null)} />}
        {panel === 'remote' && <RemotePanel onClose={() => setPanel(null)} />}
      </footer>
    </div>
  )
}

/** Up next beside the cover: click a song to play it now, × to take it out, drag to change the order. */
function UpNextPane() {
  const queue = useLocalMusic((s) => s.queue)
  const index = useLocalMusic((s) => s.index)
  const repeat = useLocalMusic((s) => s.repeat)
  const next = queue.slice(index + 1, index + 201)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const from = useRef<number | null>(null)
  return (
    <div className="fp-queue" data-fp-queue-pane>
      <div className="fp-queue-head">
        <h2>Up next</h2>
        {next.length > 0 && (
          <button className="link-btn" onClick={clearUpNext} data-fp-queue-clear>
            Clear
          </button>
        )}
      </div>
      {next.length === 0 ? (
        <p className="fp-queue-empty">{repeat === 'context' ? 'Your list starts again from the top after this song.' : 'Nothing after this song. Right-click songs on the Music page → Play next or Add to Up next.'}</p>
      ) : (
        <ol>
          {next.map((s, i) => {
            const at = index + 1 + i
            return (
              <li
                key={`${s.path}:${at}`}
                className={dropAt === at ? 'drop-above' : ''}
                draggable
                onDragStart={(e) => {
                  from.current = at
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', s.title)
                }}
                onDragOver={(e) => {
                  if (from.current === null) return
                  e.preventDefault()
                  setDropAt(at)
                }}
                onDragLeave={() => setDropAt(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  if (from.current !== null) moveInQueue(from.current, at)
                  from.current = null
                  setDropAt(null)
                }}
                onDragEnd={() => {
                  from.current = null
                  setDropAt(null)
                }}
                onClick={() => void localJump(at)}
                title="Click to play it now; drag to change the order"
                data-fp-queue-song={s.title}
              >
                <span className="fp-queue-art">{s.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={16} />}</span>
                <span className="fp-queue-text">
                  <strong>{s.title}</strong>
                  <span>{s.artist || 'Unknown artist'}</span>
                </span>
                <span className="fp-queue-time">{s.durationMs ? formatTime(s.durationMs) : ''}</span>
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFromQueue(at)
                  }}
                  title="Take it out of Up next"
                >
                  <X size={15} />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** The lyrics beside the cover: lit up as they're sung when they have times, and editable. */
function LyricsPane({ path, title, artist, positionMs }: { path: string; title: string; artist: string; positionMs: number }) {
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined)
  const [raw, setRaw] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)

  const load = (): void => {
    setLyrics(undefined)
    window.api.localMusicLyrics(path).then(
      (found) => {
        setRaw(found?.text ?? '')
        setLyrics(found ? parseLyrics(found.text, found.source) : null)
      },
      () => setLyrics(null)
    )
  }
  useEffect(() => {
    setEditing(false)
    load()
  }, [path])

  const line = useMemo(() => (lyrics ? activeLine(lyrics, positionMs + 250) : -1), [lyrics, positionMs])
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-line="${line}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [line])

  const save = async (): Promise<void> => {
    try {
      await window.api.localMusicSaveLyrics(path, draft)
      setEditing(false)
      load()
      notify(draft.trim() ? 'Saved the lyrics next to the song.' : 'Removed the lyrics.', 'info')
    } catch (err) {
      notify(errorMessage(err))
    }
  }

  if (editing) {
    return (
      <div className="fp-lyrics editing" data-fp-lyrics-pane>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste the lyrics here. Lines starting with a time like [01:23.45] light up as they're sung." autoFocus data-fp-lyrics-text />
        <div className="fp-lyrics-actions">
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} data-fp-lyrics-save>
            Save
          </button>
        </div>
        <p className="fp-lyrics-note">Saved as a .lrc or .txt file next to the song, so the lyrics come with it to your other computer.</p>
      </div>
    )
  }

  const edit = (
    <button
      className="icon-btn fp-lyrics-edit"
      onClick={() => {
        setDraft(raw)
        setEditing(true)
      }}
      title={lyrics ? 'Edit the lyrics' : 'Add lyrics'}
      data-fp-lyrics-edit
    >
      <Pencil size={14} />
    </button>
  )
  if (lyrics === undefined) return <div className="fp-lyrics fp-lyrics-empty">Looking for lyrics…</div>
  if (!lyrics) {
    return (
      <div className="fp-lyrics fp-lyrics-empty" data-fp-lyrics-pane>
        <Mic2 size={30} />
        <p>No lyrics for this song yet.</p>
        <div className="fp-lyrics-actions">
          <button className="btn" onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(`${artist} ${title} lyrics`)}`)}>
            <Search size={13} /> Find them online
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setDraft('')
              setEditing(true)
            }}
            data-fp-lyrics-add
          >
            <Pencil size={13} /> Paste lyrics
          </button>
        </div>
        <p className="fp-lyrics-note">Or put a .lrc file with the same name next to the song.</p>
      </div>
    )
  }
  return (
    <div className={`fp-lyrics ${lyrics.synced ? 'synced' : ''}`} ref={list} data-fp-lyrics-pane>
      {edit}
      {lyrics.lines.map((l, i) => (
        <p
          key={i}
          data-line={i}
          className={lyrics.synced ? (i === line ? 'now' : i < line ? 'past' : '') : ''}
          onClick={lyrics.synced && l.at !== null ? () => void musicSeek(l.at!) : undefined}
        >
          {l.text || ' '}
        </p>
      ))}
    </div>
  )
}
