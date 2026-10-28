import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, GripVertical, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import type { MusicItem } from '@shared/spotify'
import { musicPlay, useMusic } from '../../store/music'
import { errorMessage } from '../../lib/paths'
import { ItemArt, ItemList } from './ItemList'

/** The Playlists tab: your playlists (press one to play it), making new ones, and opening yours to change. */
export function Playlists() {
  const [items, setItems] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<MusicItem | null>(null)
  const [making, setMaking] = useState(false)

  const load = (): void => {
    window.api.musicPlaylists().then(
      (list) => {
        setItems(list)
        setError(null)
      },
      (err) => setError(errorMessage(err))
    )
  }
  useEffect(load, [])

  if (open) {
    return (
      <PlaylistView
        playlist={open}
        onBack={() => {
          setOpen(null)
          load()
        }}
      />
    )
  }
  return (
    <div className="music-results">
      {making ? (
        <NameInput
          placeholder="Name your playlist"
          onCancel={() => setMaking(false)}
          onDone={async (name) => {
            const made = await window.api.musicCreatePlaylist(name)
            setMaking(false)
            setOpen(made)
          }}
        />
      ) : (
        <button className="music-new" onClick={() => setMaking(true)} data-music-new-playlist>
          <Plus size={14} /> New playlist
        </button>
      )}
      {error && <p className="music-panel-note">{error}</p>}
      {!items && !error && <p className="music-panel-note">Loading your playlists…</p>}
      {items && !items.length && <p className="music-panel-note">You don’t have any playlists yet.</p>}
      {items && (
        <ItemList
          items={items}
          actions={(item) =>
            item.editable && (
              <button className="icon-btn music-row-btn" onClick={() => setOpen(item)} title="See the songs and change them" data-music-open-playlist={item.name}>
                <ChevronRight size={15} />
              </button>
            )
          }
        />
      )}
    </div>
  )
}

/** A one-line name box: Enter saves, Escape cancels. */
function NameInput({ initial = '', placeholder, onDone, onCancel }: { initial?: string; placeholder: string; onDone: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onDone(name.trim())
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <>
      <div className="music-link-row">
        <input
          autoFocus
          className="music-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder={placeholder}
          maxLength={100}
          data-music-playlist-name
        />
        <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={save}>
          Save
        </button>
      </div>
      {error && <p className="music-panel-note">{error}</p>}
    </>
  )
}

/** One of your playlists: play it, rename or delete it, add songs, take them out, and drag them into order. */
function PlaylistView({ playlist, onBack }: { playlist: MusicItem; onBack: () => void }) {
  const [name, setName] = useState(playlist.name)
  const [songs, setSongs] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const playingNow = useMusic((s) => (s.state?.source !== 'none' && s.state?.track?.uri?.startsWith('spotify:track:') ? s.state.track : undefined))

  const load = (): void => {
    window.api.musicPlaylistSongs(playlist.uri).then(setSongs, (err) => setError(errorMessage(err)))
  }
  useEffect(load, [playlist.uri])

  /** Changes the list straight away, and puts it back the way Spotify has it if the change didn't work. */
  const change = async (next: MusicItem[], job: () => Promise<void>): Promise<void> => {
    setSongs(next)
    setError(null)
    try {
      await job()
    } catch (err) {
      setError(errorMessage(err))
      load()
    }
  }
  const add = (song: MusicItem): Promise<void> => change([...(songs ?? []), song], () => window.api.musicAddToPlaylist(playlist.uri, [song.uri]))
  const remove = (song: MusicItem): Promise<void> =>
    change(
      (songs ?? []).filter((s) => s.uri !== song.uri),
      () => window.api.musicRemoveFromPlaylist(playlist.uri, song.uri)
    )
  const move = (from: number, to: number): Promise<void> => {
    const next = [...(songs ?? [])]
    const [song] = next.splice(from, 1)
    next.splice(to, 0, song)
    return change(next, () => window.api.musicMoveInPlaylist(playlist.uri, from, to))
  }

  return (
    <div className="music-results music-playlist" data-music-playlist>
      <div className="music-playlist-head">
        <button className="icon-btn" onClick={onBack} title="Back to your playlists" data-music-back>
          <ChevronLeft size={15} />
        </button>
        {renaming ? (
          <div className="music-playlist-rename">
            <NameInput
              initial={name}
              placeholder="Playlist name"
              onCancel={() => setRenaming(false)}
              onDone={async (n) => {
                await window.api.musicRenamePlaylist(playlist.uri, n)
                setName(n)
                setRenaming(false)
              }}
            />
          </div>
        ) : (
          <>
            <strong title={name}>{name}</strong>
            <button className="icon-btn" onClick={() => setRenaming(true)} title="Rename" data-music-rename>
              <Pencil size={13} />
            </button>
            {confirmDelete ? (
              <button
                className="btn music-delete"
                onClick={async () => {
                  try {
                    await window.api.musicDeletePlaylist(playlist.uri)
                    onBack()
                  } catch (err) {
                    setError(errorMessage(err))
                  }
                }}
                onMouseLeave={() => setConfirmDelete(false)}
                data-music-delete-confirm
              >
                Delete?
              </button>
            ) : (
              <button className="icon-btn" onClick={() => setConfirmDelete(true)} title="Delete this playlist" data-music-delete>
                <Trash2 size={13} />
              </button>
            )}
            <button className="music-play music-play-small" onClick={() => musicPlay(playlist.uri)} title="Play this playlist" disabled={!songs?.length}>
              <Play size={13} />
            </button>
          </>
        )}
      </div>

      <AddSongs onAdd={add} have={songs ?? []} />
      {playingNow?.uri && songs && !songs.some((s) => s.uri === playingNow.uri) && (
        <button
          className="music-new"
          onClick={() => add({ kind: 'track', name: playingNow.name, detail: playingNow.artist, art: playingNow.art, uri: playingNow.uri! })}
          data-music-add-playing
        >
          <Plus size={14} /> Add “{playingNow.name}”
        </button>
      )}
      {error && <p className="music-panel-note">{error}</p>}
      {!songs && !error && <p className="music-panel-note">Loading the songs…</p>}
      {songs && !songs.length && <p className="music-panel-note">No songs yet. Search above to add some.</p>}
      {songs && songs.length > 0 && (
        <ul className="music-items">
          {songs.map((song, i) => (
            <li
              key={`${song.uri}:${i}`}
              draggable
              className={`${dragFrom === i ? 'dragging' : ''} ${dragOver === i && dragFrom !== null && dragFrom !== i ? (dragFrom < i ? 'drop-below' : 'drop-above') : ''}`}
              onDragStart={(e) => {
                setDragFrom(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                setDragOver(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragFrom !== null && dragFrom !== i) void move(dragFrom, i)
                setDragFrom(null)
                setDragOver(null)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
            >
              <span className="music-grip" title="Drag to move">
                <GripVertical size={12} />
              </span>
              <button onClick={() => musicPlay(song.uri, playlist.uri)} title={`Play ${song.name}`}>
                <ItemArt art={song.art} />
                <span className="music-item-text">
                  <strong>{song.name}</strong>
                  <span>{song.detail}</span>
                </span>
              </button>
              <button className="icon-btn music-row-btn" onClick={() => remove(song)} title="Take out of this playlist" data-music-remove={song.name}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Search Spotify for songs to add. */
function AddSongs({ onAdd, have }: { onAdd: (song: MusicItem) => Promise<void>; have: MusicItem[] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const added = useRef(new Set<string>())

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
          setResults(r.tracks)
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

  return (
    <>
      <input className="music-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add songs: search Spotify" spellCheck={false} data-music-add-search />
      {error && <p className="music-panel-note">{error}</p>}
      {results && !results.length && <p className="music-panel-note">Nothing found.</p>}
      {results && results.length > 0 && (
        <div className="music-add-results">
          <ItemList
            items={results}
            actions={(item) => {
              const isIn = added.current.has(item.uri) || have.some((s) => s.uri === item.uri)
              return (
                <button
                  className={`icon-btn music-row-btn ${isIn ? 'done' : ''}`}
                  onClick={async () => {
                    added.current.add(item.uri)
                    await onAdd(item)
                  }}
                  title={isIn ? 'In this playlist (press to add it again)' : 'Add to this playlist'}
                  data-music-add={item.name}
                >
                  {isIn ? <Check size={14} /> : <Plus size={14} />}
                </button>
              )
            }}
          />
          <button className="music-new" onClick={() => setQuery('')}>
            Done adding
          </button>
        </div>
      )}
    </>
  )
}
