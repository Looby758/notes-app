import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { uniqueName } from '@shared/explorer'
import { releaseFiles } from './fileLocks'

/**
 * Orbit's own short-term bin, so deleting can be undone with Ctrl+Z.
 *
 * Something you delete is moved in here instead of straight to the Recycle Bin / Bin (an instant
 * rename on the same drive). Undo moves it back. Once it can't be undone any more (it fell off the
 * end of the undo list, or Orbit is closing) it goes on to the Recycle Bin / Bin as before, put back
 * where it was first so the Bin's "Restore" still knows where it came from.
 *
 * On another drive than Orbit's own data (a USB stick, say) a move would be a slow copy, so the
 * item goes to the Recycle Bin / Bin straight away and a copy is kept here for undo (only for
 * things under COPY_LIMIT; bigger ones just go to the Bin, without undo).
 */

const COPY_LIMIT = 300 * 1024 * 1024

interface Held {
  /** Where it was. */
  from: string
  /** Where it is now, in the bin. */
  at: string
  /** Its slot folder in the bin (deleted once it's dealt with). */
  slot: string
  /** A copy (the original went to the Recycle Bin / Bin already), not the item itself. */
  copy: boolean
}

/** The newest last, for each place something was deleted from. */
const held = new Map<string, Held[]>()

const binDir = (): string => join(app.getPath('userData'), 'undo-bin')
const keyOf = (path: string): string => (process.platform === 'linux' ? path : path.toLowerCase())

async function sizeOf(path: string, limit: number): Promise<number> {
  const info = await lstat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const name of await readdir(path)) {
    total += await sizeOf(join(path, name), limit - total)
    if (total > limit) break
  }
  return total
}

/** Moves (or copies) something into the bin. Returns false if it went straight to the Recycle Bin / Bin instead. */
export async function hold(full: string): Promise<boolean> {
  // A video or comic still open in Orbit would stop Windows moving it.
  await releaseFiles(full)
  const slot = join(binDir(), `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const at = join(slot, basename(full))
  await mkdir(slot, { recursive: true })
  await writeFile(join(slot, 'from.json'), JSON.stringify({ from: full }))
  let copy = false
  try {
    await rename(full, at)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const tooBig = code === 'EXDEV' && (await sizeOf(full, COPY_LIMIT).catch(() => Infinity)) > COPY_LIMIT
    if (code !== 'EXDEV' || tooBig) {
      await rm(slot, { recursive: true, force: true })
      await shell.trashItem(full)
      return false
    }
    await cp(full, at, { recursive: true, preserveTimestamps: true })
    await shell.trashItem(full)
    copy = true
  }
  const key = keyOf(full)
  held.set(key, [...(held.get(key) ?? []), { from: full, at, slot, copy }])
  return true
}

export const isHeld = (full: string): boolean => !!held.get(keyOf(full))?.length

/** Puts the newest thing deleted from `full` back (as "name (2)" if something's there now). Returns where it went. */
export async function restore(full: string): Promise<string> {
  const key = keyOf(full)
  const list = held.get(key)
  const item = list?.at(-1)
  if (!item || !existsSync(item.at)) throw new Error(`"${basename(full)}" can't be brought back any more. Look in the Recycle Bin / Bin.`)
  const dir = dirname(full)
  await mkdir(dir, { recursive: true })
  const isDir = (await lstat(item.at)).isDirectory()
  const target = existsSync(full) ? join(dir, uniqueName(basename(full), await readdir(dir), isDir)) : full
  try {
    await rename(item.at, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await cp(item.at, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  }
  list!.pop()
  if (!list!.length) held.delete(key)
  await rm(item.slot, { recursive: true, force: true }).catch(() => undefined)
  return target
}

/** Sends a held item on to the Recycle Bin / Bin (or drops the copy, whose original is there already). */
async function finish(item: Held): Promise<void> {
  try {
    if (!item.copy && existsSync(item.at)) {
      // Back where it was first, so the Bin's "Restore" puts it back there too.
      let from = item.at
      if (!existsSync(item.from) && existsSync(dirname(item.from))) {
        try {
          await rename(item.at, item.from)
          from = item.from
        } catch {
          // Then it goes to the Bin from here.
        }
      }
      await shell.trashItem(from)
    }
  } finally {
    await rm(item.slot, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** It can't be undone any more: the oldest held item from `full` goes on to the Recycle Bin / Bin. */
export async function release(full: string): Promise<void> {
  const key = keyOf(full)
  const list = held.get(key)
  const item = list?.shift()
  if (!item) return
  if (!list!.length) held.delete(key)
  await finish(item).catch((err) => console.error('[undo bin]', err))
}

/** Everything still held goes on to the Recycle Bin / Bin, including anything left from last time. */
export async function releaseAll(leftoversOnly = false): Promise<void> {
  if (!leftoversOnly) {
    const all = [...held.values()].flat()
    held.clear()
    for (const item of all) await finish(item).catch((err) => console.error('[undo bin]', err))
  }
  // Left from a crash: each slot says where its item came from.
  const inUse = new Set([...held.values()].flat().map((h) => h.slot))
  for (const name of await readdir(binDir()).catch(() => [] as string[])) {
    const slot = join(binDir(), name)
    if (inUse.has(slot)) continue
    try {
      const { from } = JSON.parse(await readFile(join(slot, 'from.json'), 'utf8')) as { from: string }
      const at = join(slot, basename(from))
      if (existsSync(at)) await finish({ from, at, slot, copy: false })
      else await rm(slot, { recursive: true, force: true })
    } catch (err) {
      console.error('[undo bin]', err)
    }
  }
}

/** A path from the renderer: absolute, or inside the notes folder when `inVault`. */
function fullPath(path: unknown, inVault: unknown, vaultRoot: () => string | null): string {
  if (typeof path !== 'string') throw new Error('That isn’t a file.')
  if (inVault !== true) {
    if (!isAbsolute(path)) throw new Error('That isn’t a place on this computer.')
    return resolve(path)
  }
  const root = vaultRoot()
  if (!root) throw new Error('No notes folder is open.')
  if (!path) throw new Error('The notes folder itself cannot be deleted here.')
  const full = resolve(root, path)
  const r = relative(root, full)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('That path is outside the notes folder.')
  return full
}

const backTo = (full: string, inVault: unknown, vaultRoot: () => string | null): string =>
  inVault === true ? relative(vaultRoot()!, full).split(/[\\/]/).join('/') : full

const list = (paths: unknown): unknown[] => (Array.isArray(paths) ? paths : [])

export function setupUndoBin(vaultRoot: () => string | null): void {
  // Anything left from last time (if Orbit didn't close properly) goes on to the Recycle Bin / Bin.
  void releaseAll(true)

  /** Deletes without asking (redoing a delete, or undoing a new file). Returns the ones held for undo. */
  ipcMain.handle('undo:hold', async (_e, paths: unknown, inVault: unknown) => {
    const done: string[] = []
    for (const p of list(paths)) {
      const full = fullPath(p, inVault, vaultRoot)
      if (dirname(full) === full) continue
      if (await hold(full)) done.push(backTo(full, inVault, vaultRoot))
    }
    return done
  })
  /** Which of these were deleted in a way that can be undone. */
  ipcMain.handle('undo:held', (_e, paths: unknown, inVault: unknown) =>
    list(paths).filter((p) => {
      try {
        return isHeld(fullPath(p, inVault, vaultRoot))
      } catch {
        return false
      }
    })
  )
  /** Puts deleted things back. Returns where each went (the same order). */
  ipcMain.handle('undo:restore', async (_e, paths: unknown, inVault: unknown) => {
    const done: string[] = []
    for (const p of list(paths)) done.push(backTo(await restore(fullPath(p, inVault, vaultRoot)), inVault, vaultRoot))
    return done
  })
  ipcMain.handle('undo:release', async (_e, paths: unknown, inVault: unknown) => {
    for (const p of list(paths)) {
      try {
        await release(fullPath(p, inVault, vaultRoot))
      } catch (err) {
        console.error('[undo bin]', err)
      }
    }
  })
  /** Moves things back where they were (undoing a move). Returns where each went. */
  ipcMain.handle('undo:moveBack', async (_e, items: unknown) => {
    const done: { from: string; to: string }[] = []
    for (const item of list(items)) {
      const { from, to } = (item ?? {}) as { from?: unknown; to?: unknown }
      const now = fullPath(to, false, vaultRoot)
      const back = fullPath(from, false, vaultRoot)
      const dir = dirname(back)
      await mkdir(dir, { recursive: true })
      const isDir = (await lstat(now)).isDirectory()
      const target = existsSync(back) && keyOf(back) !== keyOf(now) ? join(dir, uniqueName(basename(back), await readdir(dir), isDir)) : back
      try {
        await rename(now, target)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
        await cp(now, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
        await rm(now, { recursive: true, force: true })
      }
      done.push({ from: now, to: target })
    }
    return done
  })

  // On the way out, what's still held goes on to the Recycle Bin / Bin.
  let finished = false
  app.on('will-quit', (e) => {
    if (finished || !held.size) return
    e.preventDefault()
    finished = true
    const done = (): void => app.quit()
    Promise.race([releaseAll(), new Promise((r) => setTimeout(r, 8000))]).then(done, done)
  })
}
