import { ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, rename, rm } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { releaseFiles } from './fileLocks'

/**
 * Recently deleted videos: a deleted video's folder (its script and research notes) is moved to
 * .notesapp/deleted-videos/<id>/ in the notes folder, so it syncs like the rest and can be put
 * back from the Videos page. After 30 days (or "Delete now") it goes on to the Recycle Bin / Bin.
 */

const ID = /^[a-z0-9]{4,40}$/

function inside(root: string, rel: string): string {
  const full = resolve(root, rel)
  const r = relative(root, full)
  if (!rel || r.startsWith('..') || isAbsolute(r) || r.split(sep)[0] === '.notesapp') throw new Error('That folder can’t be kept.')
  return full
}

function binFor(root: string, id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid video id.')
  return join(root, '.notesapp', 'deleted-videos', id)
}

const toRel = (root: string, full: string): string => relative(root, full).split(sep).join('/')

export function setupVideoBin(getRoot: () => string | null): void {
  const root = (): string => {
    const r = getRoot()
    if (!r) throw new Error('No notes folder is open.')
    return r
  }

  /** Moves a video's folder into the bin. False if there was nothing to keep. */
  ipcMain.handle('videoBin:keep', async (_e, rel: unknown, id: unknown) => {
    const r = root()
    if (typeof rel !== 'string') throw new Error('Invalid folder.')
    const src = inside(r, rel)
    if (!existsSync(src)) return false
    const dir = binFor(r, id)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await releaseFiles(src)
    await rename(src, join(dir, basename(src)))
    return true
  })

  /** Puts a kept folder back at `rel` (or "<name> (restored)" if that's taken). Returns where it went, or null if it's gone. */
  ipcMain.handle('videoBin:restore', async (_e, id: unknown, rel: unknown) => {
    const r = root()
    if (typeof rel !== 'string') throw new Error('Invalid folder.')
    const dir = binFor(r, id)
    const name = existsSync(dir) ? (await readdir(dir))[0] : undefined
    if (!name) return null
    let target = inside(r, rel)
    for (let i = 0; existsSync(target); i++) target = inside(r, `${rel} (restored${i ? ` ${i + 1}` : ''})`)
    await mkdir(dirname(target), { recursive: true })
    await rename(join(dir, name), target)
    await rm(dir, { recursive: true, force: true })
    return toRel(r, target)
  })

  /** Sends a kept folder on to the Recycle Bin / Bin. */
  ipcMain.handle('videoBin:drop', async (_e, id: unknown) => {
    const dir = binFor(root(), id)
    if (existsSync(dir)) await shell.trashItem(dir).catch(() => rm(dir, { recursive: true, force: true }))
  })
}
