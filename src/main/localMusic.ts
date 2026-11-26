import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { parseFile } from 'music-metadata'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { guessFromName, LOCAL_AUDIO, LOCAL_LIMIT, sortSongs, type LocalLibrary, type LocalSong } from '@shared/localMusic'
import { logError } from './log'
import { looksTimed, lyricsPathFor } from '@shared/lyrics'

/**
 * Your own music files (see shared/localMusic.ts). The folder you chose is kept in local-music.json in
 * the settings folder, with what was read from each file, so opening the list again is quick and only
 * new or changed files are read.
 */

interface Cached extends LocalSong {
  mtime: number
  size: number
}

interface Saved {
  folder?: string | null
  songs?: Cached[]
  /** What was read from each file changes now and then (year and genre were added); older lists are read again. */
  v?: number
  /** The folder `songs` were last read from. */
  scanned?: string
}

const CACHE_VERSION = 2

const file = (): string => join(app.getPath('userData'), 'local-music.json')
let saved: Saved | null = null

// A folder in Google Drive, iCloud or on a network drive can stop answering (Drive signed out or
// still starting, the Mac just woke up, a file that's only in the cloud). Every look in the folder
// gives up after a while, so one stuck file or folder can't leave the Music page waiting for ever.
/** How long one folder listing or file may take. */
const LIST_WAIT = 15_000
const READ_WAIT = 20_000
/** After this, files not read yet keep what was read last time instead of being read now. */
const SCAN_BUDGET = 90_000
/** How long the page waits for a look through the folder before showing the songs from last time. */
const ANSWER_WAIT = 6_000

/** `p`'s answer, or `fallback` if it takes longer than `ms` (the work itself carries on). */
export function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolveIt, rejectIt) => {
    const timer = setTimeout(() => resolveIt(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolveIt(v)
      },
      (err) => {
        clearTimeout(timer)
        rejectIt(err)
      }
    )
  })
}

class FolderNotAnswering extends Error {}

function load(): Saved {
  if (saved) return saved
  saved = {}
  try {
    if (existsSync(file())) saved = JSON.parse(readFileSync(file(), 'utf8')) as Saved
  } catch (err) {
    logError('reading local-music.json', err)
  }
  return saved!
}

function store(): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(saved), 'utf8')
  renameSync(tmp, file())
}

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The folder you chose, or your Music folder if you haven't chosen one. */
export function musicFolder(): string | null {
  const s = load()
  if (s.folder === null) return null
  const folder = s.folder ?? app.getPath('music')
  return folder && isDir(folder) ? folder : null
}

/** A file inside the music folder, from its path there; null if it would be outside it. */
export function musicFile(path: string): string | null {
  const folder = musicFolder()
  if (!folder || !path || isAbsolute(path)) return null
  const full = resolve(folder, path)
  const inside = relative(folder, full)
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? full : null
}

/**
 * Every music file under the folder (skipping hidden folders), up to the limit. `stuck` are folders
 * that didn't answer in time (as paths inside the music folder), so their songs from last time are kept.
 */
async function findFiles(folder: string): Promise<{ files: string[]; truncated: boolean; stuck: string[] }> {
  const files: string[] = []
  const stuck: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || files.length >= LOCAL_LIMIT) return
    let entries
    try {
      entries = await within(readdir(dir, { withFileTypes: true }), LIST_WAIT, null)
    } catch {
      return
    }
    if (!entries) {
      if (dir === folder) throw new FolderNotAnswering(`Your music folder (${folder}) isn’t answering. If it’s in Google Drive or iCloud, check that it’s running and signed in, then press Try again.`)
      logError('reading the music folder', new Error(`${dir} didn’t answer in time`))
      stuck.push(relative(folder, dir).split(sep).join('/'))
      return
    }
    for (const e of entries) {
      if (files.length >= LOCAL_LIMIT) return
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && LOCAL_AUDIO.includes(extname(e.name).toLowerCase())) files.push(full)
    }
  }
  await walk(folder, 0)
  return { files, truncated: files.length >= LOCAL_LIMIT, stuck }
}

/** A song's details from its file name alone. */
function guessSong(path: string): LocalSong {
  const guess = guessFromName(path)
  return { path, title: guess.title, artist: guess.artist, album: '', track: guess.track, durationMs: 0, art: false }
}

async function readSong(full: string, path: string): Promise<LocalSong> {
  const guess = guessFromName(path)
  try {
    const { common, format } = await parseFile(full, { duration: false, skipCovers: false })
    return {
      path,
      title: common.title?.trim() || guess.title,
      artist: (common.artist ?? common.albumartist)?.trim() || guess.artist,
      album: common.album?.trim() || '',
      track: common.track?.no ?? guess.track,
      durationMs: Math.round((format.duration ?? 0) * 1000),
      art: !!common.picture?.length,
      ...(common.year ? { year: String(common.year) } : {}),
      ...(common.genre?.[0]?.trim() ? { genre: common.genre[0].trim() } : {})
    }
  } catch {
    return { path, title: guess.title, artist: guess.artist, album: '', track: guess.track, durationMs: 0, art: false }
  }
}

const toLibrary = (folder: string, songs: Cached[], truncated?: boolean): LocalLibrary => ({
  folder,
  songs: sortSongs(songs.map(({ mtime, size: _s, ...song }) => ({ ...song, added: Math.round(mtime) }))),
  truncated
})

/** What was read from `folder` last time (kept in local-music.json), if anything. */
function lastTime(folder: string): Cached[] | null {
  const s = load()
  if (s.v !== CACHE_VERSION || !s.songs?.length) return null
  // Lists saved before `scanned` was kept were read from the folder chosen then.
  const from = s.scanned ?? (s.folder ?? app.getPath('music'))
  return from === folder ? s.songs : null
}

/** Looks through the folder, reading only files that are new or changed since last time. */
async function scan(folder: string | null): Promise<LocalLibrary> {
  if (!folder) return { folder: null, songs: [] }
  const started = Date.now()
  const s = load()
  const known = new Map((s.v === CACHE_VERSION ? (s.songs ?? []) : []).map((c) => [c.path, c]))
  const { files, truncated, stuck } = await findFiles(folder)
  const songs: Cached[] = []
  const seen = new Set<string>()
  for (const full of files) {
    const path = relative(folder, full).split(sep).join('/')
    seen.add(path)
    const old = known.get(path)
    // Out of time: keep what was read last time, and read the rest on the next look.
    if (Date.now() - started > SCAN_BUDGET) {
      songs.push(old ?? { ...guessSong(path), mtime: 0, size: -1 })
      continue
    }
    let info
    try {
      info = await within(stat(full), READ_WAIT, null)
    } catch {
      continue
    }
    if (!info) {
      if (old) songs.push(old)
      continue
    }
    if (old && old.mtime === info.mtimeMs && old.size === info.size) {
      songs.push(old)
      continue
    }
    const read = await within(readSong(full, path), READ_WAIT, null)
    // A file that's only in the cloud and slow to come down: its name for now, read again next time.
    if (read) songs.push({ ...read, mtime: info.mtimeMs, size: info.size })
    else songs.push(old ?? { ...guessSong(path), mtime: 0, size: -1 })
  }
  // Songs in folders that didn't answer this time are still there, as far as anyone knows.
  for (const dir of stuck) {
    for (const old of known.values()) if (!seen.has(old.path) && old.path.startsWith(`${dir}/`)) songs.push(old)
  }
  s.songs = songs
  s.v = CACHE_VERSION
  s.scanned = folder
  try {
    store()
  } catch (err) {
    logError('saving local-music.json', err)
  }
  return toLibrary(folder, songs, truncated)
}

/** Your songs; `fresh` looks through the folder again even if it was read already this session. */
let last: LocalLibrary | null = null
/** The look through the folder going on now; `early` is set once someone was given last time's songs instead. */
let scanning: { folder: string | null; done: Promise<LocalLibrary>; early: boolean } | null = null

const withChosen = (lib: LocalLibrary): LocalLibrary => ({ ...lib, chosen: typeof load().folder === 'string' })

export async function library(fresh = false): Promise<LocalLibrary> {
  const folder = musicFolder()
  if (last && !fresh && last.folder === folder) return withChosen(last)
  // A look through another folder (you just chose a new one) doesn't answer for this one.
  if (!scanning || scanning.folder !== folder) {
    const run: { folder: string | null; done: Promise<LocalLibrary>; early: boolean } = { folder, done: scan(folder), early: false }
    scanning = run
    run.done.then(
      (lib) => {
        if (scanning !== run) return
        scanning = null
        last = lib
        watch(lib.folder)
        // The page was shown last time's songs: now it gets the real list.
        if (run.early) for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('localMusic:changed', withChosen(lib))
      },
      (err) => {
        if (scanning === run) scanning = null
        logError('reading the music folder', err)
      }
    )
  }
  const run = scanning
  const before = folder ? lastTime(folder) : null
  if (!before) return withChosen(await run.done)
  // A slow folder: show the songs from last time now, and the fresh list when it's ready.
  const lib = await within(run.done, ANSWER_WAIT, null).catch((err) => {
    if (err instanceof FolderNotAnswering) return null
    throw err
  })
  if (lib) return withChosen(lib)
  run.early = true
  watch(folder)
  return withChosen(toLibrary(folder!, before))
}

/** Reads the folder again and tells every window (after a song is added, changed or removed). */
export async function refreshLibrary(force = false): Promise<LocalLibrary> {
  const before = last ? JSON.stringify(last.songs) : ''
  last = null
  const lib = await library(true)
  if (!force && JSON.stringify(lib.songs) === before) return lib
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('localMusic:changed', lib)
  return lib
}

// New songs appear on their own: the folder is watched, and also looked through every few minutes
// (a Google Drive folder doesn't always say when the phone or another computer added something).
let watcher: FSWatcher | null = null
let watchedFolder: string | null = null
let soon: ReturnType<typeof setTimeout> | null = null
let poll: ReturnType<typeof setInterval> | null = null

function changedSoon(): void {
  if (soon) clearTimeout(soon)
  soon = setTimeout(() => {
    soon = null
    void refreshLibrary().catch((err) => logError('reading the music folder again', err))
  }, 1500)
}

function watch(folder: string | null): void {
  if (folder === watchedFolder) return
  void watcher?.close()
  watcher = null
  watchedFolder = folder
  if (poll) clearInterval(poll)
  poll = null
  if (!folder) return
  try {
    watcher = chokidarWatch(folder, {
      ignoreInitial: true,
      depth: 12,
      ignored: (path: string) => /(^|[\\/])\.[^\\/]/.test(relative(folder, path)) || path.endsWith('.tmp'),
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 300 }
    })
    watcher.on('all', (_event, path) => {
      if (LOCAL_AUDIO.includes(extname(path).toLowerCase()) || !extname(path)) changedSoon()
    })
    watcher.on('error', (err) => logError('watching the music folder', err))
  } catch (err) {
    logError('watching the music folder', err)
  }
  poll = setInterval(() => {
    if (BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())) changedSoon()
  }, 3 * 60_000)
}

/** The album picture inside a file, if it has one. */
export async function cover(path: string): Promise<{ data: Uint8Array; type: string } | null> {
  const full = musicFile(path)
  if (!full) return null
  const { common } = await parseFile(full, { duration: false, skipCovers: false })
  const pic = common.picture?.[0]
  return pic ? { data: pic.data, type: pic.format.includes('/') ? pic.format : `image/${pic.format}` } : null
}

/**
 * A song's lyrics as text: from a .lrc or .txt file next to it (same name), or saved inside the file.
 * Timed lyrics inside a file come back as .lrc lines.
 */
export async function lyrics(path: string): Promise<{ text: string; source: 'lrc' | 'txt' | 'tag' } | null> {
  const full = musicFile(path)
  if (!full) return null
  for (const ext of ['lrc', 'txt'] as const) {
    const side = musicFile(lyricsPathFor(path, ext))
    if (side && existsSync(side)) return { text: readFileSync(side, 'utf8'), source: ext }
  }
  try {
    const { common } = await parseFile(full, { duration: false, skipCovers: true })
    for (const tag of common.lyrics ?? []) {
      if (tag.syncText?.length && tag.syncText.some((l) => typeof l.timestamp === 'number')) {
        const lrc = tag.syncText
          .map((l) => {
            const t = Math.max(0, l.timestamp ?? 0)
            const m = Math.floor(t / 60000)
            const sec = ((t % 60000) / 1000).toFixed(2).padStart(5, '0')
            return `[${String(m).padStart(2, '0')}:${sec}]${l.text}`
          })
          .join('\n')
        return { text: lrc, source: 'tag' }
      }
      if (tag.text?.trim()) return { text: tag.text, source: 'tag' }
    }
  } catch {
    // No lyrics, then.
  }
  return null
}

/** Saves lyrics next to the song (timed ones as .lrc, plain as .txt); empty text removes them. */
export function saveLyrics(path: string, text: string): void {
  if (!musicFile(path)) throw new Error('That song isn’t in your music folder.')
  const clean = text.replace(/\r\n?/g, '\n').trim()
  const keep = clean ? (looksTimed(clean) ? 'lrc' : 'txt') : null
  for (const ext of ['lrc', 'txt'] as const) {
    const side = musicFile(lyricsPathFor(path, ext))
    if (!side) continue
    if (ext === keep) writeFileSync(side, `${clean}\n`, 'utf8')
    else if (existsSync(side)) unlinkSync(side)
  }
}

export function setupLocalMusic(): void {
  ipcMain.handle('localMusic:lyrics', (_e, path: string) => lyrics(String(path)))
  ipcMain.handle('localMusic:saveLyrics', (_e, path: string, text: string) => saveLyrics(String(path), String(text ?? '').slice(0, 200_000)))
  ipcMain.handle('localMusic:library', (_e, fresh?: boolean) => library(fresh === true))
  ipcMain.handle('localMusic:chooseFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { title: 'Choose your music folder', defaultPath: musicFolder() ?? app.getPath('music'), properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return library()
    load().folder = result.filePaths[0]
    last = null
    return library(true)
  })
  // Back to the computer's own Music folder.
  ipcMain.handle('localMusic:defaultFolder', () => {
    delete load().folder
    try {
      store()
    } catch (err) {
      logError('saving local-music.json', err)
    }
    last = null
    return library(true)
  })
}
