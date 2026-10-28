import './music.css'
import { useEffect, useRef, useState } from 'react'
import { Link2, ListMusic, Music, Pause, Play, Search, Shuffle, SkipBack, SkipForward, X } from 'lucide-react'
import { formatTime, spotifyUri, type MusicItem, type MusicSearchResults, type MusicState } from '@shared/spotify'
import { IS_MAC } from '@shared/platform'
import { currentPosition, musicControl, musicPlay, musicSeek, openMusicSettings, refreshMusicStatus, setMusicOpen, startMusic, useMusic } from '../../store/music'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { errorMessage } from '../../lib/paths'
import { addHomeCard } from '../../lib/home'
import MusicHomeCard from './MusicHomeCard'

addHomeCard({ id: 'music', order: 35, title: 'Now playing', Card: MusicHomeCard })

type Tab = 'playlists' | 'search' | 'link'

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
              <ListMusic size={13} /> Playlists
            </button>
            <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
              <Search size={13} /> Search
            </button>
            <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>
              <Link2 size={13} /> Link
            </button>
          </div>
          {tab === 'link' ? <LinkBox /> : !status?.connected ? <NeedsAccount /> : tab === 'search' ? <SearchBox /> : <Playlists />}
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
        <span title={track?.artist}>{track ? [track.artist, state.device].filter(Boolean).join(' · ') : 'Pick a playlist or search.'}</span>
      </div>
      <div className="music-controls">
        <button className={`icon-btn music-shuffle ${state.shuffle ? 'active' : ''}`} onClick={() => musicControl('shuffle')} title={state.shuffle ? 'Shuffle is on' : 'Shuffle'}>
          <Shuffle size={13} />
        </button>
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

function NeedsAccount() {
  useEffect(() => {
    void refreshMusicStatus()
  }, [])
  return (
    <div className="music-panel-note">
      <p>To search Spotify and see your playlists here, connect your Spotify account (Spotify only allows this with Premium).</p>
      <button className="btn btn-primary" onClick={setUp}>
        Set up
      </button>
      {IS_MAC && <p>You can still paste a Spotify link under Link.</p>}
    </div>
  )
}

function ItemList({ items }: { items: MusicItem[] }) {
  const [playing, setPlaying] = useState<string | null>(null)
  return (
    <ul className="music-items">
      {items.map((item) => (
        <li key={item.uri}>
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
          <ItemList items={results.tracks} />
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
