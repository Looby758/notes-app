import { useEffect, useState } from 'react'
import { Check, ChevronDown, Ear, ExternalLink, Heart, Loader2, Mic, Monitor, Music, NotebookPen, Play, Plus, Square, X } from 'lucide-react'
import { LISTEN_SECONDS, spotifyPage, type FoundSong } from '@shared/songId'
import type { MusicItem } from '@shared/spotify'
import { songMarkdown } from '@shared/songLinks'
import { findSong, forgetFoundSong, setListenSource, useSongId } from '../../store/songId'
import { musicPlay, openMusicSettings, useMusic } from '../../store/music'
import { notify } from '../../store/notify'
import { desktopListenSupported } from '../../lib/songListen'
import { insertBlockIntoActiveNote, openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { errorMessage } from '../../lib/paths'
import { ItemArt } from './ItemList'

/**
 * The "What's this?" tab: listen to what's playing (a video, a game, a stream) for a few seconds,
 * see what song it is, and put it in one of your playlists. Songs found before are listed below.
 */
export function SongFinder() {
  const phase = useSongId((s) => s.phase)
  const song = useSongId((s) => s.song)
  const error = useSongId((s) => s.error)
  const history = useSongId((s) => s.history)
  const [picked, setPicked] = useState<FoundSong | null>(null)
  const shown = picked ?? (phase === 'found' ? song : null)

  // A new answer replaces the one you'd picked from the list.
  useEffect(() => setPicked(null), [song])

  return (
    <div className="song-finder" data-song-finder>
      <ListenButton />
      {phase === 'nothing' && !picked && <p className="music-panel-note">Couldn’t tell what song that was. Try again during a louder part, without talking over it.</p>}
      {phase === 'error' && error && !picked && <p className="music-error song-finder-error">{error}</p>}
      {shown && <FoundCard song={shown} />}
      {history.length > 0 && (
        <>
          <div className="music-panel-heading">Found before</div>
          <ul className="music-items song-finder-history">
            {history.map((s) => (
              <li key={`${s.at}:${s.title}`}>
                <button className={shown === s ? 'active' : ''} onClick={() => setPicked(s)} title="Show this song">
                  <ItemArt art={s.art} />
                  <span className="music-item-text">
                    <strong>{s.title}</strong>
                    <span>
                      {s.artist} · {foundWhen(s.at)}
                    </span>
                  </span>
                </button>
                <button
                  className="icon-btn music-row-btn"
                  onClick={() => {
                    if (picked === s) setPicked(null)
                    forgetFoundSong(s)
                  }}
                  title="Take off this list"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** "2 min ago", "yesterday", "3 Oct". */
function foundWhen(at: number, now = Date.now()): string {
  const mins = Math.round((now - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const d = new Date(at)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (new Date(now - 86400000).toDateString() === d.toDateString()) return 'yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function ListenButton() {
  const phase = useSongId((s) => s.phase)
  const level = useSongId((s) => s.level)
  const startedAt = useSongId((s) => s.startedAt)
  const source = useSongId((s) => s.source)
  const [, tick] = useState(0)
  useEffect(() => {
    if (phase !== 'listening') return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [phase])

  const left = Math.max(0, Math.ceil(LISTEN_SECONDS - (Date.now() - startedAt) / 1000))
  const label =
    phase === 'listening' ? `Listening… ${left}s` : phase === 'thinking' ? 'Finding the song…' : phase === 'idle' ? 'What’s this song?' : 'Listen again'
  return (
    <div className="song-finder-top">
      <button
        className={`song-finder-listen ${phase}`}
        onClick={() => void findSong()}
        disabled={phase === 'thinking'}
        style={{ '--level': phase === 'listening' ? level : 0 } as React.CSSProperties}
        title={phase === 'listening' ? 'Stop listening' : `Listen for ${LISTEN_SECONDS} seconds and find the song`}
        data-song-listen
      >
        <span className="song-finder-ring" />
        {phase === 'thinking' ? <Loader2 size={20} className="spin" /> : phase === 'listening' ? <Square size={16} /> : <Ear size={20} />}
      </button>
      <div className="song-finder-text">
        <strong>{label}</strong>
        <span>
          {phase === 'listening'
            ? source === 'mic'
              ? 'Hold the microphone near the music.'
              : 'Keep the video, game or stream playing.'
            : source === 'mic'
              ? 'Listens through the microphone.'
              : 'Listens to whatever this PC is playing: a video, game or stream.'}
        </span>
        {desktopListenSupported && phase !== 'listening' && phase !== 'thinking' && (
          <span className="song-finder-sources">
            <button className={source === 'desktop' ? 'active' : ''} onClick={() => setListenSource('desktop')} title="Listen to the sound this PC is playing">
              <Monitor size={11} /> This PC
            </button>
            <button className={source === 'mic' ? 'active' : ''} onClick={() => setListenSource('mic')} title="Listen through the microphone (music in the room)">
              <Mic size={11} /> Microphone
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

function FoundCard({ song }: { song: FoundSong }) {
  const connected = useMusic((s) => !!s.status?.connected)
  const uri = song.spotifyUri
  const toNote = (): void => {
    const md = uri ? songMarkdown(song.title, song.artist, uri, song.art) : null
    const text = md ?? `🎵 ${song.title} · ${song.artist}${song.link ? ` (${song.link})` : ''}`
    if (insertBlockIntoActiveNote(`${text}\n`)) notify(`Added “${song.title}” to the note.`, 'info')
    else notify('Open a note first, then press this to add the song to it.')
  }
  return (
    <div className="song-found" data-song-found>
      <div className="song-found-head">
        <div className="music-art">{song.art ? <img src={song.art} alt="" /> : <Music size={18} />}</div>
        <div className="music-text">
          <strong title={song.title}>{song.title}</strong>
          <span title={song.artist}>{song.artist}</span>
          {(song.album || song.released) && <span className="song-found-album">{[song.album, song.released?.slice(0, 4)].filter(Boolean).join(' · ')}</span>}
        </div>
      </div>
      <div className="song-found-actions">
        {uri && connected && (
          <button className="btn" onClick={() => void musicPlay(uri)} title="Play it on Spotify">
            <Play size={12} /> Play
          </button>
        )}
        {uri && connected && <AddToPlaylist uri={uri} />}
        <button className="icon-btn" onClick={toNote} title="Add the song to the note you have open">
          <NotebookPen size={13} />
        </button>
        {(song.link || (uri && spotifyPage(uri))) && (
          <button className="icon-btn" onClick={() => window.open(uri ? spotifyPage(uri)! : song.link!)} title={uri ? 'Open on Spotify' : 'Open the song’s page (links to every music app)'}>
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      {!connected && uri && (
        <p className="music-panel-note">
          <button
            className="link-btn"
            onClick={() => {
              openSpecialTab(SETTINGS_TAB)
              openMusicSettings()
            }}
          >
            Connect your Spotify account
          </button>{' '}
          to play it and add it to a playlist.
        </p>
      )}
      {!uri && <p className="music-panel-note">Spotify doesn’t seem to have this one, so it can’t go in a playlist. The link above has it on other music apps.</p>}
    </div>
  )
}

/** Your playlists you can add to (and Liked Songs); press one to add the song. */
function AddToPlaylist({ uri }: { uri: string }) {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [making, setMaking] = useState<string | null>(null)

  useEffect(() => {
    setAdded([])
  }, [uri])
  useEffect(() => {
    if (!open || lists) return
    window.api.musicPlaylists().then(
      (all) => setLists(all.filter((p) => p.liked || p.editable)),
      (err) => setError(errorMessage(err))
    )
  }, [open, lists])

  const add = async (list: MusicItem): Promise<void> => {
    setBusy(list.uri)
    setError(null)
    try {
      if (list.liked) await window.api.musicSetLiked(uri, true)
      else await window.api.musicAddToPlaylist(list.uri, [uri])
      setAdded((a) => [...a, list.uri])
      notify(`Added to ${list.name}.`, 'info')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const makeAndAdd = async (name: string): Promise<void> => {
    const n = name.trim()
    if (!n) return
    setBusy('new')
    setError(null)
    try {
      const made = await window.api.musicCreatePlaylist(n)
      await window.api.musicAddToPlaylist(made.uri, [uri])
      setLists((l) => [...(l ?? []).filter((p) => p.liked), made, ...(l ?? []).filter((p) => !p.liked)])
      setAdded((a) => [...a, made.uri])
      setMaking(null)
      notify(`Made “${made.name}” and added the song.`, 'info')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button className={`btn btn-primary ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} data-song-add>
        <Plus size={12} /> Add to playlist <ChevronDown size={11} />
      </button>
      {open && (
        <div className="song-found-lists">
          {error && <p className="music-error">{error}</p>}
          {!lists && !error && <p className="music-panel-note">Loading your playlists…</p>}
          {lists && (
            <ul className="music-items">
              {lists.map((p) => (
                <li key={p.uri}>
                  <button onClick={() => void add(p)} disabled={busy !== null || added.includes(p.uri)} className={added.includes(p.uri) ? 'active' : ''}>
                    {p.liked ? (
                      <span className="music-item-art">
                        <Heart size={14} fill="currentColor" />
                      </span>
                    ) : (
                      <ItemArt art={p.art} />
                    )}
                    <span className="music-item-text">
                      <strong>{p.name}</strong>
                      <span>{added.includes(p.uri) ? 'Added' : p.detail}</span>
                    </span>
                    {busy === p.uri ? <Loader2 size={13} className="spin" /> : added.includes(p.uri) ? <Check size={13} /> : null}
                  </button>
                </li>
              ))}
              <li>
                {making === null ? (
                  <button onClick={() => setMaking('')} disabled={busy !== null}>
                    <span className="music-item-art">
                      <Plus size={14} />
                    </span>
                    <span className="music-item-text">
                      <strong>New playlist…</strong>
                    </span>
                  </button>
                ) : (
                  <input
                    className="music-input song-found-new"
                    autoFocus
                    placeholder="Playlist name, then Enter"
                    value={making}
                    disabled={busy === 'new'}
                    onChange={(e) => setMaking(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void makeAndAdd(making)
                      if (e.key === 'Escape') setMaking(null)
                    }}
                  />
                )}
              </li>
            </ul>
          )}
        </div>
      )}
    </>
  )
}
