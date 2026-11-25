import type { LocalSong, SongTagPatch } from '@shared/localMusic'
import type { MusicFileResult } from '@shared/types'
import { errorMessage } from '../lib/paths'
import { recordUndo } from '../lib/undo'
import { applyLibrary } from './localMusic'
import { forgetSongs, movePaths } from './musicData'
import { notify } from './notify'

/**
 * Changes to your music files themselves (main/musicTags.ts): details and covers written into the
 * MP3s, songs added, files tidied and spare copies binned. The song list updates straight after.
 */

const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const songsWord = (n: number): string => (n === 1 ? 'song' : `${n} songs`)

function report(result: MusicFileResult, done: string): boolean {
  applyLibrary(result.library)
  if (result.failed.length) {
    notify(result.failed.length === 1 ? result.failed[0].why : `${result.failed.length} songs couldn’t be changed. ${result.failed[0].why}`)
    return false
  }
  if (done) notify(done, 'info')
  return true
}

const oldDetails = (s: LocalSong, patch: SongTagPatch): SongTagPatch => {
  const back: SongTagPatch = {}
  if (patch.title !== undefined) back.title = s.title
  if (patch.artist !== undefined) back.artist = s.artist
  if (patch.album !== undefined) back.album = s.album
  if (patch.year !== undefined) back.year = s.year ?? ''
  if (patch.genre !== undefined) back.genre = s.genre ?? ''
  if (patch.track !== undefined) back.track = s.track
  return back
}

/** Writes the same changes into each song (Ctrl+Z puts back what each one had). */
export async function editSongs(songs: LocalSong[], patch: SongTagPatch): Promise<boolean> {
  if (!songs.length || !Object.keys(patch).length) return false
  const changes = songs.map((s) => ({ path: s.path, patch }))
  const back = songs.map((s) => ({ path: s.path, patch: oldDetails(s, patch) }))
  try {
    const ok = report(await window.api.musicTagsEdit(changes), `Saved the details of ${songs.length === 1 ? `“${patch.title ?? songs[0].title}”` : songsWord(songs.length)}.`)
    recordUndo({
      label: `Changed the details of ${songsWord(songs.length)}`,
      undo: async () => void report(await window.api.musicTagsEdit(back), ''),
      redo: async () => void report(await window.api.musicTagsEdit(changes), '')
    })
    return ok
  } catch (err) {
    notify(clean(err))
    return false
  }
}

export async function fillFromNames(songs: LocalSong[]): Promise<void> {
  try {
    report(await window.api.musicTagsFillFromNames(songs.map((s) => s.path)), `Filled in empty details from the file names of ${songsWord(songs.length)}.`)
  } catch (err) {
    notify(clean(err))
  }
}

export async function setCover(songs: LocalSong[], source: { file?: string; url?: string }): Promise<boolean> {
  if (!songs.length) return false
  try {
    return report(await window.api.musicTagsSetCover(songs.map((s) => s.path), source), songs.length === 1 ? `New cover saved into “${songs[0].title}”.` : `New cover saved into ${songs.length} songs.`)
  } catch (err) {
    notify(clean(err))
    return false
  }
}

/** Copies music files into your music folder; returns where they are now. */
export async function importSongs(files: string[] | null): Promise<string[]> {
  try {
    const result = files ? await window.api.localMusicImport(files) : await window.api.localMusicChooseImport()
    if (!result) return []
    applyLibrary(result.library)
    const n = result.added.length
    if (n) notify(`Added ${n === 1 ? 'a song' : `${n} songs`} to your music${result.skipped.length ? ` (${result.skipped.length} weren’t music files)` : ''}.`, 'info')
    else if (result.skipped.length) notify('Only music files can be added (MP3, M4A, FLAC, WAV, OGG).')
    return result.added
  } catch (err) {
    notify(clean(err))
    return []
  }
}

async function move(moves: { from: string; to: string }[]): Promise<Record<string, string>> {
  const result = await window.api.localMusicMove(moves)
  const map = Object.fromEntries(result.done.map((m) => [m.from, m.to]))
  applyLibrary(result.library, map)
  await movePaths(map)
  if (result.failed.length) notify(`${result.failed.length} ${result.failed.length === 1 ? 'file' : 'files'} couldn’t be moved (maybe open in another app).`)
  return map
}

/** Renames and moves songs; playlists, likes and plays follow them. Ctrl+Z moves them back. */
export async function moveSongs(moves: { from: string; to: string }[], label: string): Promise<boolean> {
  if (!moves.length) return false
  try {
    const map = await move(moves)
    const done = Object.entries(map).map(([from, to]) => ({ from, to }))
    if (!done.length) return false
    notify(`${label}: ${done.length === 1 ? 'one file' : `${done.length} files`}. Ctrl+Z puts them back.`, 'info')
    recordUndo({
      label,
      undo: async () => void (await move(done.map((m) => ({ from: m.to, to: m.from })))),
      redo: async () => void (await move(done))
    })
    return true
  } catch (err) {
    notify(clean(err))
    return false
  }
}

/** Keeps one copy of a song and bins the others; their plays, likes and playlist places go to the one kept. */
export async function keepOne(keep: LocalSong, others: LocalSong[]): Promise<boolean> {
  try {
    const ok = await window.api.confirm({
      message: `Keep “${keep.path}” and put ${others.length === 1 ? 'the other copy' : `the other ${others.length} copies`} in the Recycle Bin?`,
      detail: others.map((o) => o.path).join('\n'),
      ok: 'Move to the bin'
    })
    if (!ok) return false
    await movePaths(Object.fromEntries(others.map((o) => [o.path, keep.path])))
    applyLibrary(await window.api.localMusicTrash(others.map((o) => o.path)))
    notify('Done. The spare copies are in the Recycle Bin if you need them.', 'info')
    return true
  } catch (err) {
    notify(clean(err))
    return false
  }
}

/** A playlist song that went missing is this song now. */
export async function relink(oldPath: string, song: LocalSong): Promise<void> {
  await movePaths({ [oldPath]: song.path })
  notify(`Found it: “${song.title}”.`, 'info')
}

/** Deletes songs from your music: the files go in the Recycle Bin, and out of your playlists. */
export async function deleteSongs(songs: LocalSong[]): Promise<boolean> {
  if (!songs.length) return false
  try {
    const one = songs.length === 1 ? songs[0] : null
    const ok = await window.api.confirm({
      message: one ? `Delete “${one.title}” from your music?` : `Delete ${songs.length} songs from your music?`,
      detail: 'The files go in the Recycle Bin (you can get them back from there), and they’re taken out of your playlists.',
      ok: 'Delete',
      type: 'warning'
    })
    if (!ok) return false
    const paths = songs.map((s) => s.path)
    applyLibrary(await window.api.localMusicTrash(paths))
    await forgetSongs(paths)
    notify(one ? `Deleted “${one.title}”. It’s in the Recycle Bin.` : `Deleted ${songs.length} songs. They’re in the Recycle Bin.`, 'info')
    return true
  } catch (err) {
    notify(clean(err))
    return false
  }
}
