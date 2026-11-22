import { BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync, renameSync, statSync, unwatchFile, watchFile, writeFileSync } from 'fs'
import { join } from 'path'
import { applyMusicEdit, emptyMusicData, MUSIC_DATA_FILE, normalizeMusicData, type MusicData, type MusicEdit } from '@shared/musicLibrary'
import { musicFolder } from './localMusic'
import { logError } from './log'

/**
 * orbit-music.json in your music folder: playlists, liked songs, ratings and play counts
 * (shared/musicLibrary.ts). Each change is applied to the file as it is on disk at that moment, so
 * the phone app changing it through Google Drive in between isn't lost. When the file changes from
 * outside (Drive bringing the phone's changes), every window is told.
 */

const fileIn = (folder: string): string => join(folder, MUSIC_DATA_FILE)

let cache: { path: string; mtime: number; data: MusicData } | null = null
let watching: string | null = null

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** The data, read again only when the file has changed since. */
export function readMusicData(): MusicData {
  const folder = musicFolder()
  if (!folder) return emptyMusicData()
  const path = fileIn(folder)
  watch(path)
  const mtime = mtimeOf(path)
  if (cache && cache.path === path && cache.mtime === mtime) return cache.data
  let data = emptyMusicData()
  try {
    if (existsSync(path)) data = normalizeMusicData(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    // Google Drive can be part-way through bringing a new copy: keep what we had rather than nothing.
    logError('reading orbit-music.json', err)
    if (cache && cache.path === path) return cache.data
  }
  cache = { path, mtime, data }
  return data
}

function write(path: string, data: MusicData): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8')
  renameSync(tmp, path)
  cache = { path, mtime: mtimeOf(path), data }
}

/** Makes the changes and saves them; returns the data afterwards. */
export function editMusicData(edits: MusicEdit[]): MusicData {
  const folder = musicFolder()
  if (!folder) throw new Error('Choose your music folder first (My music).')
  const path = fileIn(folder)
  let data = readMusicData()
  for (const edit of edits) data = applyMusicEdit(data, edit)
  write(path, data)
  broadcast(data)
  return data
}

function broadcast(data: MusicData): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('musicData:changed', data)
}

/** Notices the file changing from outside (every few seconds is plenty for Drive sync). */
function watch(path: string): void {
  if (watching === path) return
  if (watching) unwatchFile(watching)
  watching = path
  watchFile(path, { interval: 4000 }, (now) => {
    if (cache && cache.path === path && cache.mtime === now.mtimeMs) return
    broadcast(readMusicData())
  })
}

export function setupMusicData(): void {
  ipcMain.handle('musicData:get', () => readMusicData())
  ipcMain.handle('musicData:edit', (_e, edits: MusicEdit[]) => editMusicData(Array.isArray(edits) ? edits : []))
}
