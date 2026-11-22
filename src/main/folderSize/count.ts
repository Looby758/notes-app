import { lstat, readdir } from 'fs/promises'
import { join } from 'path'

/**
 * Adds up everything inside a folder (the size Windows only shows under Properties), for the
 * Files tab's size column. Shortcuts aren't followed, so nothing is counted twice and a loop
 * can't trap it. Runs in its own worker thread (folderSizeWorker.ts).
 */

export interface FolderSize {
  bytes: number
  files: number
  folders: number
  /** False while still counting, or when part of it couldn't be read (shown as "at least"). */
  complete: boolean
}

export interface CountOptions {
  /** Asked now and then; true stops counting (you left the folder). */
  cancelled?: () => boolean
  /** Called about once a second with the total so far, for big folders. */
  onProgress?: (so: FolderSize) => void
  /** How many folders are read at once. */
  concurrency?: number
}

export async function countFolder(root: string, opts: CountOptions = {}): Promise<FolderSize | null> {
  const total: FolderSize = { bytes: 0, files: 0, folders: 0, complete: true }
  const queue = [root]
  const concurrency = opts.concurrency ?? 8
  let lastReport = Date.now()
  let running = 0
  let stopped = false

  const one = async (dir: string): Promise<void> => {
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      // A folder that's private to the system: what can be read is still counted.
      if (dir !== root) total.complete = false
      else throw new Error('unreadable')
      return
    }
    const files: string[] = []
    for (const item of items) {
      if (item.isSymbolicLink()) continue
      if (item.isDirectory()) {
        total.folders++
        queue.push(join(dir, item.name))
      } else files.push(join(dir, item.name))
    }
    // Sizes are looked up a few at a time.
    for (let i = 0; i < files.length; i += 64) {
      const sizes = await Promise.all(files.slice(i, i + 64).map((f) => lstat(f).then((s) => s.size, () => -1)))
      for (const s of sizes) {
        if (s < 0) total.complete = false
        else {
          total.bytes += s
          total.files++
        }
      }
    }
  }

  try {
    await one(queue.shift()!)
  } catch {
    return null
  }
  await new Promise<void>((resolve) => {
    const next = (): void => {
      if (opts.cancelled?.()) stopped = true
      while (!stopped && running < concurrency && queue.length) {
        running++
        void one(queue.shift()!).finally(() => {
          running--
          if (opts.onProgress && Date.now() - lastReport > 1000) {
            lastReport = Date.now()
            opts.onProgress({ ...total, complete: false })
          }
          next()
        })
      }
      if (!running && (stopped || !queue.length)) resolve()
    }
    next()
  })
  if (stopped) return null
  return total
}
