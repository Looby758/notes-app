import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { parseFile } from 'music-metadata'
import { guessFromName, LOCAL_AUDIO, LOCAL_LIMIT, sortSongs, type LocalLibrary, type LocalSong } from '@shared/localMusic'
import { logError } from './log'

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
}

const file = (): string => join(app.getPath('userData'), 'local-music.json')
let saved: Saved | null = null
let scanning: Promise<LocalLibrary> | null = null

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

/** Every music file under the folder (skipping hidden folders), up to the limit. */
async function findFiles(folder: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || files.length >= LOCAL_LIMIT) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
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
  return { files, truncated: files.length >= LOCAL_LIMIT }
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
      art: !!common.picture?.length
    }
  } catch {
    return { path, title: guess.title, artist: guess.artist, album: '', track: guess.track, durationMs: 0, art: false }
  }
}

/** Looks through the folder, reading only files that are new or changed since last time. */
async function scan(): Promise<LocalLibrary> {
  const folder = musicFolder()
  if (!folder) return { folder: null, songs: [] }
  const s = load()
  const known = new Map((s.songs ?? []).map((c) => [c.path, c]))
  const { files, truncated } = await findFiles(folder)
  const songs: Cached[] = []
  for (const full of files) {
    const path = relative(folder, full).split(sep).join('/')
    let info
    try {
      info = await stat(full)
    } catch {
      continue
    }
    const old = known.get(path)
    if (old && old.mtime === info.mtimeMs && old.size === info.size) songs.push(old)
    else songs.push({ ...(await readSong(full, path)), mtime: info.mtimeMs, size: info.size })
  }
  s.songs = songs
  try {
    store()
  } catch (err) {
    logError('saving local-music.json', err)
  }
  return { folder, songs: sortSongs(songs.map(({ mtime: _m, size: _s, ...song }) => song)), truncated }
}

/** Your songs; `fresh` looks through the folder again even if it was read already this session. */
let last: LocalLibrary | null = null
export async function library(fresh = false): Promise<LocalLibrary> {
  if (last && !fresh && last.folder === musicFolder()) return last
  scanning ??= scan().finally(() => (scanning = null))
  last = await scanning
  return last
}

/** The album picture inside a file, if it has one. */
export async function cover(path: string): Promise<{ data: Uint8Array; type: string } | null> {
  const full = musicFile(path)
  if (!full) return null
  const { common } = await parseFile(full, { duration: false, skipCovers: false })
  const pic = common.picture?.[0]
  return pic ? { data: pic.data, type: pic.format.includes('/') ? pic.format : `image/${pic.format}` } : null
}

export function setupLocalMusic(): void {
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
}
