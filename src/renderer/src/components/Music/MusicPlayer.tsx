import './music.css'
import { useEffect, useRef, useState } from 'react'
import {
  Heart,
  Laptop,
  ListMusic,
  ListPlus,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  Tv,
  Volume1,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { formatTime, spotifyUri, type MusicDevice, type MusicItem, type MusicQueue, type MusicSearchResults, type MusicState } from '@shared/spotify'
import { IS_MAC } from '@shared/platform'
import {
  currentPosition,
  musicAddToQueue,
  musicControl,
  musicPlay,
  musicSeek,
  musicSetVolume,
  musicToggleLike,
  musicTransfer,
  openMusicSettings,
  refreshMusicStatus,
  setMusicOpen,
  startMusic,
  useMusic
} from '../../store/music'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { errorMessage } from '../../lib/paths'

type Tab = 'playlists' | 'search' | 'queue' | 'recent' | 'link' | 'devices'

const setUp = (): void => {
  openSpecialTab(SETTINGS_TAB)
  openMusicSettings()
}

/** The small Spotify player in the bottom-left corner (♫ at the top shows and hides it). */
export default function MusicPlayer() {
  const open = useMusic((s) => s.open)
  useEffect(() => startMusic(), [])
  if (!open) return null
  return <Player />
}

function Player() {
  const state = useMusic((s) => s.state)
  const error = useMusic((s) => s.error)
  const status = useMusic((s) => s.status)
  const [tab, setTab] = useState<Tab | null>(null)

  const toggleTab = (t: Tab): void => setTab(tab === t ? null : t)

  return (
    <div className="music-player" data-music-player>
      {tab && (
        <div className="music-panel">
          <div className="music-tabs">
            <button className={tab === 'playlists' ? 'active' : ''} onClick={() => setTab('playlists')}>
              Playlists
            </button>
            <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
              Search
            </button>
            <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')} data-music-tab="queue">
              Up next
            </button>
            <button className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')} data-music-tab="recent">
              Recent
            </button>
            <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>
              Link
            </button>
          </div>
          {tab === 'link' ? (
            <LinkBox />
          ) : !status?.connected ? (
            <NeedsAccount />
          ) : tab === 'search' ? (
            <SearchBox />
          ) : tab === 'queue' ? (
            <UpNext />
          ) : tab === 'recent' ? (
            <Recent />
          ) : tab === 'devices' ? (
            <Devices onPicked={() => setTab(null)} />
          ) : (
            <Playlists />
          )}
        </div>
      )}

      <div className="music-main">
        {state ? <NowPlaying state={state} /> : <div className="music-empty">Looking for Spotify…</div>}
        <div className="music-side">
          <button className={`icon-btn ${tab ? 'active' : ''}`} onClick={() => toggleTab(tab ?? 'playlists')} title="Playlists, search and links" data-music-browse>
            <ListMusic size={15} />
          </button>
          <button className="icon-btn" onClick={() => setMusicOpen(false)} title="Hide the player (music keeps playing)">
            <X size={14} />
          </button>
        </div>
      </div>
      {state?.track && <Progress state={state} />}
      {state?.track && <Footer state={state} devicesOpen={tab === 'devices'} onDevices={() => toggleTab('devices')} />}
      {(error || state?.error) && <p className="music-error">{error ?? state?.error}</p>}
    </div>
  )
}

function NowPlaying({ state }: { state: MusicState }) {
  if (state.hint === 'not-running') {
    return (
      <div className="music-empty">
        <span>Spotify isn’t open.</span>
        <button className="btn btn-primary" onClick={() => window.api.musicOpen('app')}>
          Open Spotify
        </button>
      </div>
    )
  }
  if (state.hint === 'automation') {
    return (
      <div className="music-empty">
        <span>
          Let Notes control Spotify: in <strong>Privacy &amp; Security → Automation</strong>, turn on <strong>Spotify</strong> under Notes (or Electron, if you started Notes with npm run dev).
        </span>
        <button className="btn" onClick={() => window.api.musicOpen('automation')}>
          Open
        </button>
      </div>
    )
  }
  if (state.hint === 'setup') {
    return (
      <div className="music-empty">
        <span>Connect your Spotify account to control it from here.</span>
        <button className="btn btn-primary" onClick={setUp}>
          Set up
        </button>
      </div>
    )
  }
  if (state.hint === 'no-device') {
    return (
      <div className="music-empty">
        <span>Spotify isn’t playing anywhere. Open it here or on your phone, or pick a playlist.</span>
        <button className="btn" onClick={() => window.api.musicOpen('app')}>
          Open
        </button>
      </div>
    )
  }

  const track = state.track
  return (
    <>
      <div className="music-art">{track?.art ? <img src={track.art} alt="" /> : <Music size={18} />}</div>
      <div className="music-text">
        <strong title={track?.name}>{track?.name ?? 'Nothing playing'}</strong>
        <span title={track?.artist}>{track ? track.artist : 'Pick a playlist or search.'}</span>
      </div>
      {track?.uri && <LikeButton uri={track.uri} />}
      <div className="music-controls">
        <button className="icon-btn" onClick={() => musicControl('previous')} title="Previous" data-music-previous>
          <SkipBack size={15} />
        </button>
        <button className="music-play" onClick={() => musicControl('toggle')} title={state.playing ? 'Pause' : 'Play'} data-music-toggle>
          {state.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn" onClick={() => musicControl('next')} title="Next" data-music-next>
          <SkipForward size={15} />
        </button>
      </div>
    </>
  )
}

function Progress({ state }: { state: MusicState }) {
  const at = useMusic((s) => s.at)
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!state.playing) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state.playing])
  const duration = state.track?.durationMs ?? 0
  const pos = currentPosition(state, at)
  const pct = duration ? (pos / duration) * 100 : 0
  return (
    <div className="music-progress">
      <span>{formatTime(pos)}</span>
      <div
        className="music-bar"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          if (duration) musicSeek(((e.clientX - box.left) / box.width) * duration)
        }}
        title="Jump to here"
      >
        <div style={{ width: `${pct}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  )
}

function LikeButton({ uri }: { uri: string }) {
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

/** Volume, shuffle and repeat, and where it's playing. */
function Footer({ state, devicesOpen, onDevices }: { state: MusicState; devicesOpen: boolean; onDevices: () => void }) {
  const connected = useMusic((s) => !!s.status?.connected)
  return (
    <div className="music-footer">
      {state.volume !== undefined && <VolumeSlider volume={state.volume} />}
      <div className="music-modes">
        <button className={`icon-btn music-shuffle ${state.shuffle ? 'active' : ''}`} onClick={() => musicControl('shuffle')} title={state.shuffle ? 'Shuffle is on' : 'Shuffle'}>
          <Shuffle size={13} />
        </button>
        <button
          className={`icon-btn music-shuffle ${state.repeat && state.repeat !== 'off' ? 'active' : ''}`}
          onClick={() => musicControl('repeat')}
          title={state.repeat === 'track' ? 'Repeating this song' : state.repeat === 'context' ? 'Repeating all' : 'Repeat'}
          data-music-repeat
        >
          {state.repeat === 'track' ? <Repeat1 size={13} /> : <Repeat size={13} />}
        </button>
      </div>
      {(connected || state.device) && (
        <button className={`music-device ${devicesOpen ? 'active' : ''}`} onClick={onDevices} title="Choose where it plays" data-music-devices>
          {state.source === 'app' ? <Laptop size={12} /> : deviceIcon(state.device ?? '')}
          <span>{state.source === 'app' ? 'This computer' : state.device ?? 'Choose a device'}</span>
        </button>
      )}
    </div>
  )
}

function VolumeSlider({ volume }: { volume: number }) {
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

function deviceIcon(type: string) {
  if (/phone|tablet/i.test(type)) return <Smartphone size={12} />
  if (/speaker|cast|avr|stb|automobile/i.test(type)) return <Speaker size={12} />
  if (/tv|game/i.test(type)) return <Tv size={12} />
  return <Laptop size={12} />
}

function Devices({ onPicked }: { onPicked: () => void }) {
  const [devices, setDevices] = useState<MusicDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.musicDevices().then(setDevices, (err) => setError(errorMessage(err)))
  }, [])
  if (error) return <p className="music-panel-note">{error}</p>
  if (!devices) return <p className="music-panel-note">Looking for your devices…</p>
  if (!devices.length) return <p className="music-panel-note">No devices found. Open Spotify on your computer, phone or speaker and it’ll show up here.</p>
  return (
    <>
      <h4 className="music-panel-heading">Play on</h4>
      <ul className="music-items">
        {devices.map((d) => (
          <li key={d.id}>
            <button
              className={d.active ? 'active' : ''}
              onClick={async () => {
                if (!d.active && (await musicTransfer(d.id))) onPicked()
              }}
              title={d.active ? 'Playing here now' : `Play on ${d.name}`}
              data-music-device={d.name}
            >
              <span className="music-item-art">{deviceIcon(d.type)}</span>
              <span className="music-item-text">
                <strong>{d.name}</strong>
                <span>{d.active ? 'Playing here' : d.type}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function UpNext() {
  const uri = useMusic((s) => s.state?.track?.uri)
  const [queue, setQueue] = useState<MusicQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Look again whenever the song changes.
  useEffect(() => {
    window.api.musicQueue().then(
      (q) => {
        setQueue(q)
        setError(null)
      },
      (err) => setError(errorMessage(err))
    )
  }, [uri])
  if (error) return <p className="music-panel-note">{error}</p>
  if (!queue) return <p className="music-panel-note">Loading what’s next…</p>
  if (!queue.next.length) return <p className="music-panel-note">Nothing’s queued. Use + next to a song in Search or Recent to add it.</p>
  return (
    <div className="music-results">
      {queue.current && (
        <>
          <h4>Now playing</h4>
          <ItemList items={[queue.current]} />
        </>
      )}
      <h4>Next up</h4>
      <ItemList items={queue.next} />
    </div>
  )
}

function Recent() {
  const [items, setItems] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.musicRecent().then(setItems, (err) => setError(errorMessage(err)))
  }, [])
  if (error) return <p className="music-panel-note">{error}</p>
  if (!items) return <p className="music-panel-note">Loading what you’ve played…</p>
  if (!items.length) return <p className="music-panel-note">Nothing played yet.</p>
  return (
    <div className="music-results">
      <ItemList items={items} queueable />
    </div>
  )
}

function NeedsAccount() {
  useEffect(() => {
    void refreshMusicStatus()
  }, [])
  return (
    <div className="music-panel-note">
      <p>To search Spotify, see your playlists, what’s up next and what you’ve played, and choose where it plays, connect your Spotify account (Spotify only allows this with Premium).</p>
      <button className="btn btn-primary" onClick={setUp}>
        Set up
      </button>
      {IS_MAC && <p>You can still paste a Spotify link under Link.</p>}
    </div>
  )
}

/** `queueable`: songs get a + to play them next. */
function ItemList({ items, queueable }: { items: MusicItem[]; queueable?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [queued, setQueued] = useState<string[]>([])
  return (
    <ul className="music-items">
      {items.map((item, i) => (
        // The queue can hold the same song twice.
        <li key={`${item.uri}:${i}`}>
          <button
            className={playing === item.uri ? 'active' : ''}
            onClick={async () => {
              setPlaying(item.uri)
              await musicPlay(item.uri)
            }}
            title={`Play ${item.name}`}
          >
            <span className="music-item-art">{item.art ? <img src={item.art} alt="" /> : <Music size={14} />}</span>
            <span className="music-item-text">
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </span>
          </button>
          {queueable && item.kind === 'track' && (
            <button
              className={`icon-btn music-queue-add ${queued.includes(item.uri) ? 'done' : ''}`}
              onClick={async () => {
                if (await musicAddToQueue(item.uri)) setQueued((q) => [...q, item.uri])
              }}
              title={queued.includes(item.uri) ? 'Added to the queue' : 'Play next (add to the queue)'}
              data-music-queue-add
            >
              <ListPlus size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Playlists() {
  const [items, setItems] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api.musicPlaylists().then(setItems, (err) => setError(errorMessage(err)))
  }, [])
  if (error) return <p className="music-panel-note">{error}</p>
  if (!items) return <p className="music-panel-note">Loading your playlists…</p>
  if (!items.length) return <p className="music-panel-note">You don’t have any playlists yet.</p>
  return <ItemList items={items} />
}

function SearchBox() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MusicSearchResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  // Search as you type, once you pause.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    let stale = false
    const id = setTimeout(() => {
      window.api.musicSearch(q).then(
        (r) => {
          if (stale) return
          setResults(r)
          setError(null)
        },
        (err) => !stale && setError(errorMessage(err))
      )
    }, 350)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [query])

  const empty = results && !results.tracks.length && !results.playlists.length && !results.albums.length
  return (
    <>
      <input ref={input} className="music-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Songs, artists, albums, playlists" spellCheck={false} data-music-search />
      {error && <p className="music-panel-note">{error}</p>}
      {empty && <p className="music-panel-note">Nothing found.</p>}
      {results && (
        <div className="music-results">
          {results.tracks.length > 0 && <h4>Songs</h4>}
          <ItemList items={results.tracks} queueable />
          {results.playlists.length > 0 && <h4>Playlists</h4>}
          <ItemList items={results.playlists} />
          {results.albums.length > 0 && <h4>Albums</h4>}
          <ItemList items={results.albums} />
        </div>
      )}
    </>
  )
}

function LinkBox() {
  const [text, setText] = useState('')
  const uri = spotifyUri(text)
  const play = async (): Promise<void> => {
    if (uri && (await musicPlay(uri))) setText('')
  }
  return (
    <div className="music-link">
      <p className="music-panel-note">In Spotify, choose <strong>Share → Copy link</strong> on a song, album or playlist, and paste it here.</p>
      <div className="music-link-row">
        <input
          className="music-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && play()}
          placeholder="https://open.spotify.com/…"
          spellCheck={false}
          data-music-link
        />
        <button className="btn btn-primary" disabled={!uri} onClick={play}>
          <Play size={13} /> Play
        </button>
      </div>
      {text.trim() && !uri && <p className="music-panel-note">That isn’t a Spotify link.</p>}
    </div>
  )
}
