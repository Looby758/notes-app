import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, GripVertical, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import type { MusicItem } from '@shared/spotify'
import { musicPlay, useMusic } from '../../store/music'
import { errorMessage } from '../../lib/paths'
import { ItemArt, ItemList } from './ItemList'
import { recordUndo, undoChanged, useUndoChanges } from '../../lib/undo'
import type { UndoStep } from '../../lib/undoHistory'

// ---- undo (Ctrl+Z outside a text box; lib/undo.ts) ----

/** After an undo or redo here: the list of playlists and the open playlist reload. */
const changed = (uri: string): void => undoChanged('playlists', `playlist:${uri}`)

/** Where a song is in a playlist (it can be in more than once). */
const positionsOf = (songs: MusicItem[], uri: string): number[] => songs.flatMap((s, i) => (s.uri === uri ? [i] : []))

/** Puts a song back at each of its old positions (lowest first, so each lands where it was). */
async function addAt(playlist: string, song: string, positions: number[]): Promise<void> {
  for (const at of positions) await window.api.musicAddToPlaylist(playlist, [song], at)
}

function recordNewPlaylist(made: MusicItem): void {
  recordUndo({
    label: `Made the playlist “${made.name}”`,
    undo: async () => {
      await window.api.musicDeletePlaylist(made.uri)
      changed(made.uri)
    },
    redo: async () => {
      await window.api.musicRestorePlaylist(made.uri)
      changed(made.uri)
    }
  })
}

/** The Playlists tab: your playlists (press one to play it), making new ones, and opening yours to change. */
export function Playlists() {
  const [items, setItems] = useState<MusicItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<MusicItem | null>(null)
  const [making, setMaking] = useState(false)

  /** `closeGone`: an undo took away the open playlist (one you'd just made), so go back to the list. */
  const load = (closeGone = false): void => {
    window.api.musicPlaylists().then(
      (list) => {
        setItems(list)
        setError(null)
        if (closeGone) setOpen((o) => (o && !o.liked && !list.some((i) => i.uri === o.uri) ? null : o))
      },
      (err) => setError(errorMessage(err))
    )
  }
  useEffect(() => load(), [])
  useUndoChanges('playlists', () => load(true))

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
            recordNewPlaylist(made)
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
            (item.editable || item.liked) && (
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

/**
 * One of your playlists: play it, rename or delete it, add songs, take them out, and drag them into order.
 * Your Liked Songs open here too, to see and play them; taking a song out unlikes it.
 */
function PlaylistView({ playlist, onBack }: { playlist: MusicItem; onBack: () => void }) {
  const liked = playlist.liked === true
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
  useUndoChanges(`playlist:${playlist.uri}`, load)

  /** Changes the list straight away, and puts it back the way Spotify has it if the change didn't work. */
  const change = async (next: MusicItem[], job: () => Promise<void>, undo: UndoStep): Promise<void> => {
    setSongs(next)
    setError(null)
    try {
      await job()
      recordUndo(undo)
    } catch (err) {
      setError(errorMessage(err))
      load()
    }
  }
  const add = (song: MusicItem): Promise<void> => {
    // Undoing takes it out again: Spotify takes out every copy, so any earlier ones go back after.
    const earlier = positionsOf(songs ?? [], song.uri)
    const step: UndoStep = {
      label: `Added “${song.name}” to “${name}”`,
      undo: async () => {
        await window.api.musicRemoveFromPlaylist(playlist.uri, song.uri)
        await addAt(playlist.uri, song.uri, earlier)
        changed(playlist.uri)
      },
      redo: async () => {
        await window.api.musicAddToPlaylist(playlist.uri, [song.uri])
        changed(playlist.uri)
      }
    }
    return change([...(songs ?? []), song], () => window.api.musicAddToPlaylist(playlist.uri, [song.uri]), step)
  }
  const remove = (song: MusicItem): Promise<void> => {
    const at = positionsOf(songs ?? [], song.uri)
    const step: UndoStep = {
      label: liked ? `Unliked “${song.name}”` : `Took “${song.name}” out of “${name}”`,
      undo: async () => {
        if (liked) await window.api.musicSetLiked(song.uri, true)
        else await addAt(playlist.uri, song.uri, at)
        changed(playlist.uri)
      },
      redo: async () => {
        if (liked) await window.api.musicSetLiked(song.uri, false)
        else await window.api.musicRemoveFromPlaylist(playlist.uri, song.uri)
        changed(playlist.uri)
      }
    }
    return change(
      (songs ?? []).filter((s) => s.uri !== song.uri),
      () => (liked ? window.api.musicSetLiked(song.uri, false) : window.api.musicRemoveFromPlaylist(playlist.uri, song.uri)),
      step
    )
  }
  const move = (from: number, to: number): Promise<void> => {
    const next = [...(songs ?? [])]
    const [song] = next.splice(from, 1)
    next.splice(to, 0, song)
    const step: UndoStep = {
      label: `Moved “${song.name}” in “${name}”`,
      undo: async () => {
        await window.api.musicMoveInPlaylist(playlist.uri, to, from)
        changed(playlist.uri)
      },
      redo: async () => {
        await window.api.musicMoveInPlaylist(playlist.uri, from, to)
        changed(playlist.uri)
      }
    }
    return change(next, () => window.api.musicMoveInPlaylist(playlist.uri, from, to), step)
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
                const old = name
                setName(n)
                setRenaming(false)
                if (n === old) return
                recordUndo({
                  label: `Renamed “${old}” to “${n}”`,
                  undo: async () => {
                    await window.api.musicRenamePlaylist(playlist.uri, old)
                    setName(old)
                    changed(playlist.uri)
                  },
                  redo: async () => {
                    await window.api.musicRenamePlaylist(playlist.uri, n)
                    setName(n)
                    changed(playlist.uri)
                  }
                })
              }}
            />
          </div>
        ) : liked ? (
          <>
            <strong title={name}>{name}</strong>
            <button className="music-play music-play-small" onClick={() => musicPlay(playlist.uri)} title="Play your Liked Songs" disabled={!songs?.length}>
              <Play size={13} />
            </button>
          </>
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
                    recordUndo({
                      label: `Deleted the playlist “${name}”`,
                      undo: async () => {
                        await window.api.musicRestorePlaylist(playlist.uri)
                        changed(playlist.uri)
                      },
                      redo: async () => {
                        await window.api.musicDeletePlaylist(playlist.uri)
                        changed(playlist.uri)
                      }
                    })
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

      {!liked && <AddSongs onAdd={add} have={songs ?? []} />}
      {!liked && playingNow?.uri && songs && !songs.some((s) => s.uri === playingNow.uri) && (
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
      {songs && !songs.length && <p className="music-panel-note">{liked ? 'No liked songs yet. Press the heart on a song to add it here.' : 'No songs yet. Search above to add some.'}</p>}
      {songs && songs.length > 0 && (
        <ul className="music-items">
          {songs.map((song, i) => (
            <li
              key={`${song.uri}:${i}`}
              // Liked Songs are in the order you liked them, which Spotify doesn't let you change.
              draggable={!liked}
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
              {!liked && (
                <span className="music-grip" title="Drag to move">
                  <GripVertical size={12} />
                </span>
              )}
              <button onClick={() => musicPlay(song.uri, playlist.uri)} title={`Play ${song.name}`}>
                <ItemArt art={song.art} />
                <span className="music-item-text">
                  <strong>{song.name}</strong>
                  <span>{song.detail}</span>
                </span>
              </button>
              <button className="icon-btn music-row-btn" onClick={() => remove(song)} title={liked ? 'Unlike (take out of your Liked Songs)' : 'Take out of this playlist'} data-music-remove={song.name}>
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
