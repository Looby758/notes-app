import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import type { FolderSize } from './count'

/**
 * Folder sizes for the Files tab, from the main process's side: asks the worker thread
 * (folderSizeWorker.ts) to add folders up, remembers the answers for a while, and sends each
 * one to the windows as it comes ("explorer:folderSize"), with running totals for big ones.
 */

export type { FolderSize }

/** A size is counted again after this long (or straight away when Orbit changes something inside). */
const FRESH_MS = 10 * 60_000

const cache = new Map<string, { size: FolderSize; at: number }>()
const counting = new Set<string>()
let wanted = new Set<string>()
/** The path as it was asked for, by its key. */
const pathFor = new Map<string, string>()
let worker: Worker | null = null
let workerPath = ''

const keyOf = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

function send(path: string, size: (FolderSize & { counting?: boolean }) | null): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('explorer:folderSize', { path, size })
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(unpacked(workerPath))
  w.on('message', (m: { type: 'progress' | 'done'; path: string; size: FolderSize | null; cancelled?: boolean }) => {
    if (m.type === 'progress') return send(m.path, m.size && { ...m.size, counting: true })
    counting.delete(keyOf(m.path))
    if (m.cancelled) return
    if (m.size) cache.set(keyOf(m.path), { size: m.size, at: Date.now() })
    send(m.path, m.size)
  })
  const gone = (): void => {
    if (worker === w) worker = null
    counting.clear()
  }
  w.on('error', gone)
  w.on('exit', gone)
  worker = w
  return w
}

export function setupFolderSizes(path: string): void {
  workerPath = path
}

/**
 * The folders being shown now (in order). Known sizes are sent at once; the rest are counted.
 * Folders no longer shown stop being counted. `fresh`: count them again (Refresh).
 */
export function wantFolderSizes(paths: string[], fresh = false): void {
  const next = new Set(paths.map(keyOf))
  if (worker) for (const k of wanted) if (!next.has(k) && counting.has(k)) {
    counting.delete(k)
    worker.postMessage({ type: 'cancel', path: pathFor.get(k) ?? k })
  }
  wanted = next
  for (const p of paths) {
    const k = keyOf(p)
    pathFor.set(k, p)
    const hit = cache.get(k)
    if (hit && !fresh && Date.now() - hit.at < FRESH_MS) {
      send(p, hit.size)
      continue
    }
    if (counting.has(k)) continue
    counting.add(k)
    getWorker().postMessage({ type: 'count', path: p })
  }
}

/** Something changed in these places: the sizes of the folders holding them are out of date. */
export function folderSizesChanged(paths: string[]): void {
  const changed = paths.map(keyOf)
  for (const k of [...cache.keys()]) if (changed.some((c) => c === k || c.startsWith(`${k}/`) || c.startsWith(`${k}\\`))) cache.delete(k)
}
