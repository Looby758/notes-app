import { shell } from 'electron'
import { existsSync } from 'fs'
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { uniqueName } from '@shared/explorer'
import type { BinItem, BinListing } from '@shared/recycleBin'
import { forgetHeld, heldItems, restoreHeld } from './undoBin'

/**
 * The Recycle Bin (Windows) / Bin (Mac) in the Files tab: what's in it, putting things back
 * where they came from, deleting for good, and emptying it.
 *
 * - Windows keeps each deleted item in X:\$Recycle.Bin\<your user id>\ as a $R… file (the item)
 *   and a $I… file that says where it was, when, and how big it is.
 * - A Mac keeps them in ~/.Trash; where they came from is only known to Finder, so Put Back is
 *   done there. macOS asks for Full Disk Access before any app can look in the Bin.
 * - Linux (freedesktop): ~/.local/share/Trash/files, with a .trashinfo for each in info/.
 * Things deleted in Orbit in the last little while are still in Orbit's own undo bin (undoBin.ts)
 * and show here too.
 */

// ---- Windows ----

const FILETIME_EPOCH = 11644473600000n

/** Reads a $I file: where the item was, when it was deleted, and its size. */
export function parseWindowsInfo(buf: Buffer): { from: string; deletedAt: number; size: number } | null {
  if (buf.length < 24) return null
  const version = Number(buf.readBigInt64LE(0))
  const size = Number(buf.readBigInt64LE(8))
  const deletedAt = Number(buf.readBigInt64LE(16) / 10000n - FILETIME_EPOCH)
  let from: string
  if (version === 2) {
    if (buf.length < 28) return null
    const chars = buf.readInt32LE(24)
    from = buf.toString('utf16le', 28, Math.min(buf.length, 28 + chars * 2))
  } else if (version === 1) {
    from = buf.toString('utf16le', 24, Math.min(buf.length, 24 + 520))
  } else return null
  from = from.replace(/\0[\s\S]*$/, '')
  return from ? { from, deletedAt, size } : null
}

async function windowsItems(): Promise<BinItem[]> {
  const items: BinItem[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const bin = `${letter}:\\$Recycle.Bin`
    if (!existsSync(bin)) continue
    // One folder per user; only your own can be read.
    for (const sid of await readdir(bin).catch(() => [] as string[])) {
      const dir = join(bin, sid)
      const names = await readdir(dir).catch(() => null)
      if (!names) continue
      for (const name of names) {
        if (!name.startsWith('$I')) continue
        const rest = name.slice(2)
        const item = join(dir, `$R${rest}`)
        if (!names.includes(`$R${rest}`)) continue
        try {
          const file = await open(join(dir, name), 'r')
          const buf = Buffer.alloc(1100)
          const { bytesRead } = await file.read(buf, 0, buf.length, 0)
          await file.close()
          const info = parseWindowsInfo(buf.subarray(0, bytesRead))
          if (!info) continue
          const isDir = (await lstat(item)).isDirectory()
          items.push({ id: `win:${item}`, name: basename(info.from), from: info.from, at: item, deletedAt: info.deletedAt, size: info.size, isDir, kind: 'system' })
        } catch {
          // Being emptied, or not ours.
        }
      }
    }
  }
  return items
}

// ---- Linux (freedesktop trash) ----

const linuxTrash = (): string => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'Trash')

export function parseTrashInfo(text: string): { from: string; deletedAt: number } | null {
  const path = /^Path=(.*)$/m.exec(text)?.[1]
  if (!path) return null
  const date = /^DeletionDate=(.*)$/m.exec(text)?.[1]
  let from: string
  try {
    from = decodeURIComponent(path)
  } catch {
    from = path
  }
  return { from, deletedAt: date ? new Date(date).getTime() || 0 : 0 }
}

async function linuxItems(): Promise<BinItem[]> {
  const root = linuxTrash()
  const items: BinItem[] = []
  for (const name of await readdir(join(root, 'files')).catch(() => [] as string[])) {
    const at = join(root, 'files', name)
    try {
      const info = parseTrashInfo(await readFile(join(root, 'info', `${name}.trashinfo`), 'utf8'))
      const st = await lstat(at)
      items.push({ id: `lin:${at}`, name: info ? basename(info.from) : name, from: info?.from ?? null, at, deletedAt: info?.deletedAt || st.ctimeMs, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory(), kind: 'system' })
    } catch {
      // Gone already.
    }
  }
  return items
}

// ---- Mac ----

async function macItems(): Promise<{ items: BinItem[]; blocked: boolean }> {
  const dir = join(homedir(), '.Trash')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    return { items: [], blocked: ['EPERM', 'EACCES'].includes((err as NodeJS.ErrnoException).code ?? '') }
  }
  const items: BinItem[] = []
  for (const name of names) {
    if (name === '.DS_Store' || name === '.localized') continue
    const at = join(dir, name)
    try {
      const st = await lstat(at)
      // When it went in the Bin: the last time its details changed, which moving it there does.
      items.push({ id: `mac:${at}`, name, from: null, at, deletedAt: st.ctimeMs, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory(), kind: 'system' })
    } catch {
      // Gone already.
    }
  }
  return { items, blocked: false }
}

// ---- together ----

export async function listBin(): Promise<BinListing> {
  const held: BinItem[] = []
  for (const h of heldItems()) {
    try {
      const st = await lstat(h.at)
      held.push({ id: `orbit:${h.at}`, name: basename(h.from), from: h.from, at: h.at, deletedAt: st.ctimeMs, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory(), kind: 'orbit' })
    } catch {
      // Already put back.
    }
  }
  if (process.platform === 'win32') return { items: [...held, ...(await windowsItems())], canRestore: true, blocked: false }
  if (process.platform === 'darwin') {
    const mac = await macItems()
    return { items: [...held, ...mac.items], canRestore: false, blocked: mac.blocked }
  }
  return { items: [...held, ...(await linuxItems())], canRestore: true, blocked: false }
}

/** Where `from` can go back to: its own path, or "name (2)" when something's there now. */
async function freeSpot(from: string, isDir: boolean): Promise<string> {
  const dir = dirname(from)
  await mkdir(dir, { recursive: true })
  return existsSync(from) ? join(dir, uniqueName(basename(from), await readdir(dir), isDir)) : from
}

/** Puts items back where they came from. Returns where each went. */
export async function restoreFromBin(ids: string[]): Promise<string[]> {
  const listing = await listBin()
  const done: string[] = []
  for (const id of ids) {
    const item = listing.items.find((i) => i.id === id)
    if (!item) continue
    if (item.kind === 'orbit') {
      const to = await restoreHeld(item.at)
      if (to) done.push(to)
      continue
    }
    if (!item.from) throw new Error('Only Finder knows where that came from: open the Bin in Finder and choose Put Back.')
    const to = await freeSpot(item.from, item.isDir)
    await rename(item.at, to)
    if (id.startsWith('win:')) await rm(join(dirname(item.at), `$I${basename(item.at).slice(2)}`), { force: true })
    else if (id.startsWith('lin:')) await rm(join(linuxTrash(), 'info', `${basename(item.at)}.trashinfo`), { force: true })
    done.push(to)
  }
  return done
}

/** Deletes items for good (no getting them back). */
export async function deleteFromBin(ids: string[]): Promise<number> {
  const listing = await listBin()
  let n = 0
  for (const id of ids) {
    const item = listing.items.find((i) => i.id === id)
    if (!item) continue
    if (item.kind === 'orbit') {
      if (await forgetHeld(item.at)) n++
      continue
    }
    await rm(item.at, { recursive: true, force: true })
    if (id.startsWith('win:')) await rm(join(dirname(item.at), `$I${basename(item.at).slice(2)}`), { force: true })
    else if (id.startsWith('lin:')) await rm(join(linuxTrash(), 'info', `${basename(item.at)}.trashinfo`), { force: true })
    n++
  }
  return n
}

export async function emptyBin(): Promise<number> {
  const listing = await listBin()
  return deleteFromBin(listing.items.map((i) => i.id))
}

/** The system's own Recycle Bin / Bin window. */
export async function openSystemBin(): Promise<void> {
  if (process.platform === 'win32') {
    const { spawn } = await import('child_process')
    spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref()
  } else if (process.platform === 'darwin') {
    const { spawn } = await import('child_process')
    spawn('open', [join(homedir(), '.Trash')], { detached: true, stdio: 'ignore' }).unref()
  } else await shell.openPath(join(linuxTrash(), 'files'))
}

/** System Settings → Privacy & Security → Full Disk Access, so Orbit can look in the Bin. */
export async function openMacPrivacy(): Promise<void> {
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')
}
