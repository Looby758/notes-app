import { create } from 'zustand'
import { emptyMusicData, type MusicData, type MusicEdit, type MusicPlaylist } from '@shared/musicLibrary'
import type { LocalSong } from '@shared/localMusic'
import { errorMessage } from '../lib/paths'
import { recordUndo } from '../lib/undo'
import { notify } from './notify'

/**
 * Your own music's playlists, liked songs, ratings and play counts (orbit-music.json in the music
 * folder, shared/musicLibrary.ts). Changes go through the main process, which saves them; it tells
 * every window when the file changes, including from the phone through Google Drive.
 */

interface MusicDataStore {
  data: MusicData
  loaded: boolean
}

export const useMusicData = create<MusicDataStore>(() => ({ data: emptyMusicData(), loaded: false }))

let started = false

/** Reads the file once and keeps up with changes to it. */
export function startMusicData(): void {
  if (started) return
  started = true
  window.api.onMusicDataChanged((data) => useMusicData.setState({ data, loaded: true }))
  void reloadMusicData()
}

export async function reloadMusicData(): Promise<void> {
  try {
    useMusicData.setState({ data: await window.api.musicDataGet(), loaded: true })
  } catch {
    useMusicData.setState({ loaded: true })
  }
}

async function edit(edits: MusicEdit[]): Promise<boolean> {
  try {
    useMusicData.setState({ data: await window.api.musicDataEdit(edits) })
    return true
  } catch (err) {
    notify(errorMessage(err))
    return false
  }
}

/** A change you can undo with Ctrl+Z. */
async function undoable(label: string, edits: MusicEdit[], back: MusicEdit[]): Promise<boolean> {
  const ok = await edit(edits)
  if (ok) recordUndo({ label, undo: () => edit(back).then(() => undefined), redo: () => edit(edits).then(() => undefined) })
  return ok
}

const playlist = (id: string): MusicPlaylist | undefined => useMusicData.getState().data.playlists.find((p) => p.id === id)
const newId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const paths = (songs: LocalSong[]): string[] => songs.map((s) => s.path)

/** Makes a playlist (with songs already in it, if given); returns its id. */
export async function createPlaylist(name: string, songs: LocalSong[] = []): Promise<string | null> {
  const id = newId()
  const ok = await undoable(`Made the playlist “${name}”`, [{ kind: 'createPlaylist', id, name, songs: paths(songs), at: Date.now() }], [{ kind: 'deletePlaylist', id }])
  return ok ? id : null
}

export function renamePlaylist(id: string, name: string): Promise<boolean> {
  const old = playlist(id)
  if (!old || !name.trim() || name.trim() === old.name) return Promise.resolve(false)
  return undoable(`Renamed “${old.name}”`, [{ kind: 'renamePlaylist', id, name, at: Date.now() }], [{ kind: 'renamePlaylist', id, name: old.name, at: Date.now() }])
}

export function deletePlaylist(id: string): Promise<boolean> {
  const { playlists } = useMusicData.getState().data
  const position = playlists.findIndex((p) => p.id === id)
  if (position < 0) return Promise.resolve(false)
  const old = playlists[position]
  return undoable(`Deleted the playlist “${old.name}”`, [{ kind: 'deletePlaylist', id }], [{ kind: 'restorePlaylist', playlist: old, position }])
}

export async function addToPlaylist(id: string, songs: LocalSong[]): Promise<boolean> {
  const old = playlist(id)
  if (!old || !songs.length) return false
  const ok = await undoable(
    `Added ${songs.length === 1 ? `“${songs[0].title}”` : `${songs.length} songs`} to “${old.name}”`,
    [{ kind: 'addToPlaylist', id, songs: paths(songs), at: Date.now() }],
    [{ kind: 'setPlaylistSongs', id, songs: old.songs, at: Date.now() }]
  )
  if (ok) notify(`Added to “${old.name}”.`, 'info')
  return ok
}

export function removeFromPlaylist(id: string, positions: number[]): Promise<boolean> {
  const old = playlist(id)
  if (!old || !positions.length) return Promise.resolve(false)
  return undoable(
    `Removed ${positions.length === 1 ? 'a song' : `${positions.length} songs`} from “${old.name}”`,
    [{ kind: 'removeFromPlaylist', id, positions, at: Date.now() }],
    [{ kind: 'setPlaylistSongs', id, songs: old.songs, at: Date.now() }]
  )
}

/** Drags a song to another place in the playlist. */
export function moveInPlaylist(id: string, from: number, to: number): Promise<boolean> {
  const old = playlist(id)
  if (!old || from === to || from < 0 || to < 0 || from >= old.songs.length || to >= old.songs.length) return Promise.resolve(false)
  const songs = [...old.songs]
  const [moved] = songs.splice(from, 1)
  songs.splice(to, 0, moved)
  return undoable(`Moved a song in “${old.name}”`, [{ kind: 'setPlaylistSongs', id, songs, at: Date.now() }], [{ kind: 'setPlaylistSongs', id, songs: old.songs, at: Date.now() }])
}

export const isLiked = (data: MusicData, song: LocalSong | undefined): boolean => !!song && song.path in data.liked

/** Likes the songs, or unlikes them if they're all liked already. */
export function toggleLike(songs: LocalSong[]): Promise<boolean> {
  if (!songs.length) return Promise.resolve(false)
  const { data } = useMusicData.getState()
  const liked = !songs.every((s) => isLiked(data, s))
  const label = `${liked ? 'Liked' : 'Unliked'} ${songs.length === 1 ? `“${songs[0].title}”` : `${songs.length} songs`}`
  return undoable(label, [{ kind: 'like', paths: paths(songs), liked, at: Date.now() }], [{ kind: 'like', paths: paths(songs), liked: !liked, at: Date.now() }])
}

export function rateSong(song: LocalSong, stars: number): Promise<boolean> {
  const old = useMusicData.getState().data.ratings[song.path] ?? 0
  const next = stars === old ? 0 : stars
  return undoable(`Rated “${song.title}”`, [{ kind: 'rate', path: song.path, stars: next }], [{ kind: 'rate', path: song.path, stars: old }])
}

/** Counts a play (after 30 seconds of a song, or its end if it's shorter). Not undoable. */
export function recordPlay(song: LocalSong): void {
  void window.api.musicDataEdit([{ kind: 'played', path: song.path, at: Date.now() }]).then(
    (data) => useMusicData.setState({ data }),
    () => undefined
  )
}
