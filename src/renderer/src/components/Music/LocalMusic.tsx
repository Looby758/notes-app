import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, RefreshCw, Shuffle } from 'lucide-react'
import { filterSongs, localArtUrl, type LocalSong } from '@shared/localMusic'
import { formatTime } from '@shared/spotify'
import { loadLocalLibrary, localJump, localUpNext, localUri, playLocal, useLocalMusic } from '../../store/localMusic'
import { useMusic } from '../../store/music'
import { ItemArt } from './ItemList'

/** Only this many rows are drawn at once; typing narrows it down. */
const SHOWN = 200

/** The My music tab: your own music files. */
export function LocalMusic() {
  const library = useLocalMusic((s) => s.library)
  const loading = useLocalMusic((s) => s.loading)
  const error = useLocalMusic((s) => s.error)
  const playing = useMusic((s) => (s.local ? s.state?.track?.uri : undefined))
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!useLocalMusic.getState().library) void loadLocalLibrary()
  }, [])
  const songs = useMemo(() => filterSongs(library?.songs ?? [], query), [library, query])

  if (!library) return <p className="music-panel-note">{error ?? 'Looking for your music…'}</p>
  if (!library.folder) {
    return (
      <div className="music-panel-note">
        <p>Play your own music files (MP3, M4A, FLAC, WAV, OGG) here, with no Spotify needed. Choose the folder they’re in.</p>
        <button className="btn btn-primary" onClick={() => loadLocalLibrary(true, true)} data-music-choose-folder>
          <FolderOpen size={13} /> Choose music folder
        </button>
      </div>
    )
  }
  return (
    <div className="music-results" data-music-local>
      <input className="music-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a song, artist or album" spellCheck={false} data-music-local-search />
      <div className="music-local-bar">
        <button className="btn" disabled={!songs.length} onClick={() => playLocal(songs, 'shuffle')} data-music-shuffle-all>
          <Shuffle size={12} /> Shuffle {query ? 'these' : 'all'}
        </button>
        <span title={library.folder}>
          {loading ? 'Looking…' : `${songs.length.toLocaleString()} ${songs.length === 1 ? 'song' : 'songs'}`}
          {library.truncated && !query ? ' (the first 20,000)' : ''}
        </span>
        <button className="icon-btn" onClick={() => loadLocalLibrary(true)} disabled={loading} title="Look for new songs">
          <RefreshCw size={13} />
        </button>
        <button className="icon-btn" onClick={() => loadLocalLibrary(true, true)} disabled={loading} title={`Your music folder: ${library.folder}. Press to choose another.`}>
          <FolderOpen size={13} />
        </button>
      </div>
      {error && <p className="music-panel-note">{error}</p>}
      {!songs.length && <p className="music-panel-note">{query ? 'Nothing found.' : 'No music files in this folder yet.'}</p>}
      <SongList songs={songs.slice(0, SHOWN)} playing={playing} onPlay={(i) => playLocal(songs, i)} />
      {songs.length > SHOWN && <p className="music-panel-note">Type above to find the other {(songs.length - SHOWN).toLocaleString()}.</p>}
    </div>
  )
}

function SongList({ songs, playing, onPlay }: { songs: LocalSong[]; playing?: string; onPlay: (index: number) => void }) {
  return (
    <ul className="music-items">
      {songs.map((song, i) => (
        <li key={`${song.path}:${i}`}>
          <button className={playing === localUri(song) ? 'active' : ''} onClick={() => onPlay(i)} title={`Play ${song.title}`} data-music-local-song={song.title}>
            <ItemArt art={song.art ? localArtUrl(song.path) : undefined} />
            <span className="music-item-text">
              <strong>{song.title}</strong>
              <span>{[song.artist, song.album].filter(Boolean).join(' · ') || song.path}</span>
            </span>
            {song.durationMs > 0 && <span className="music-item-time">{formatTime(song.durationMs)}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Up next, when your own music is playing. */
export function LocalUpNext() {
  const index = useLocalMusic((s) => s.index)
  const queue = useLocalMusic((s) => s.queue)
  const next = useMemo(() => localUpNext(), [index, queue])
  if (!next.length) return <p className="music-panel-note">This is the last song. Pick more under My music.</p>
  return (
    <div className="music-results">
      <h4>Next up</h4>
      <SongList songs={next.slice(0, SHOWN)} onPlay={(i) => localJump(index + 1 + i)} />
    </div>
  )
}
