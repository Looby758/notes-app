import { readdir } from 'fs/promises'
import { join } from 'path'
import { isHiddenFile } from './rules'

/**
 * Orbit's list of every file name on the computer, so "Whole PC" search answers as you type (the
 * way the Everything app does). It's built once by walking the drives, kept up to date as files
 * change (see fileIndexWorker.ts), and searched in memory.
 *
 * To stay small with a million or more files, names aren't kept as separate strings: they're
 * joined into one long string (plus a lowercase copy to search), with each entry's start in a
 * number array. Each entry knows its folder's entry, so full paths are put back together only
 * for the results shown. Files found after the list was built go in a small "extra" list until
 * the next `freeze()`.
 */

const DIR = 1
const GONE = 2
const HIDDEN = 4

export interface IndexHit {
  path: string
  isDir: boolean
}

export interface SearchOptions {
  limit: number
  showHidden: boolean
  /** Only what's inside this folder (Subfolders search), when it's in the list. */
  under?: string
  /** Results under this folder (the home folder) come first among equally good matches. */
  prefer?: string
  /** Stop looking after this long, in milliseconds (a one-letter search on a huge disk). */
  budgetMs?: number
}

export interface CrawlOptions {
  /** Folders not walked into (and not listed): system folders, app caches, node_modules… */
  skipDir: (lowerName: string, parentPath: string, depth: number) => boolean
  /** Folders listed (so they can be found) but not walked into, like Mac apps. */
  leafDir?: (lowerName: string) => boolean
  /** Called now and then while building, with the number of entries so far. */
  onProgress?: (count: number) => void
  /** How many folders are read at once. */
  concurrency?: number
  /** Asked between folders; true stops the walk (Orbit is closing, or a newer build started). */
  cancelled?: () => boolean
}

/** Lowercase without changing the length (a few letters, like "İ", grow when lowercased). */
export function lowerSameLength(s: string): string {
  const l = s.toLowerCase()
  if (l.length === s.length) return l
  let out = ''
  for (const ch of s) {
    const c = ch.toLowerCase()
    out += c.length === ch.length ? c : ch
  }
  return out
}

/** Windows and Mac paths ignore capitals, so the folder lookup does too. */
const keyOf = (path: string): string => path.toLowerCase().replace(/[\\/]+$/, '') || '/'

export class FileIndex {
  readonly sep: string
  /** The folders the list starts from (each one an entry whose name is its whole path). */
  roots: string[] = []

  // The frozen part.
  private text = ''
  private lower = ''
  private starts = new Int32Array(1)
  private parents = new Int32Array(0)
  private flags = new Uint8Array(0)
  private frozenCount = 0

  // Added since (and everything while building).
  private extraNames: string[] = []
  private extraParents: number[] = []
  private extraFlags: number[] = []

  /** Gone-ness of frozen entries changes in place, so flags for them are kept here once touched. */
  private flagEdits = new Map<number, number>()

  /** Folder path (lowercased) → its entry. Can hold stale ones; `alive` is always checked. */
  private dirs = new Map<string, number>()

  builtAt = 0

  constructor(sep: string) {
    this.sep = sep
  }

  get count(): number {
    return this.frozenCount + this.extraNames.length
  }

  /** How many entries are still there (not deleted since). */
  liveCount(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) if (this.alive(i)) n++
    return n
  }

  private nameAt(i: number): string {
    return i < this.frozenCount ? this.text.slice(this.starts[i], this.starts[i + 1] - 1) : this.extraNames[i - this.frozenCount]
  }

  private parentAt(i: number): number {
    return i < this.frozenCount ? this.parents[i] : this.extraParents[i - this.frozenCount]
  }

  private flagsAt(i: number): number {
    if (i < this.frozenCount) return this.flagEdits.get(i) ?? this.flags[i]
    return this.extraFlags[i - this.frozenCount]
  }

  private setFlags(i: number, f: number): void {
    if (i < this.frozenCount) this.flagEdits.set(i, f)
    else this.extraFlags[i - this.frozenCount] = f
  }

  /** Not deleted, and nor is any folder above it. */
  private alive(i: number): boolean {
    for (let at = i; at >= 0; at = this.parentAt(at)) if (this.flagsAt(at) & GONE) return false
    return true
  }

  pathOf(i: number): string {
    const parts: string[] = []
    let at = i
    for (; this.parentAt(at) >= 0; at = this.parentAt(at)) parts.push(this.nameAt(at))
    const root = this.nameAt(at)
    if (!parts.length) return root
    parts.reverse()
    return root.endsWith(this.sep) || root.endsWith('/') ? root + parts.join(this.sep) : root + this.sep + parts.join(this.sep)
  }

  private add(name: string, parent: number, isDir: boolean): number {
    const i = this.count
    this.extraNames.push(name)
    this.extraParents.push(parent)
    this.extraFlags.push((isDir ? DIR : 0) | (isHiddenFile(name) ? HIDDEN : 0))
    if (isDir) this.dirs.set(keyOf(parent < 0 ? name : this.pathOf(i)), i)
    return i
  }

  /** The entry for a folder in the list, or -1. */
  dirEntry(path: string): number {
    const i = this.dirs.get(keyOf(path))
    return i !== undefined && this.alive(i) && this.flagsAt(i) & DIR ? i : -1
  }

  /** Whether a folder is in the list (so Subfolders search can use it). */
  covers(path: string): boolean {
    return this.dirEntry(path) >= 0
  }

  /** Walks each root and lists everything in it (replacing nothing: call on a new, empty index). */
  async build(roots: string[], opts: CrawlOptions): Promise<void> {
    this.roots = roots
    const queue: { i: number; path: string; depth: number }[] = []
    for (const root of roots) queue.push({ i: this.add(root, -1, true), path: root, depth: 0 })
    await this.walk(queue, opts)
    this.builtAt = Date.now()
    this.freeze()
  }

  private async walk(queue: { i: number; path: string; depth: number }[], opts: CrawlOptions): Promise<void> {
    const concurrency = opts.concurrency ?? 16
    let lastReport = 0
    const worker = async (): Promise<void> => {
      while (queue.length) {
        if (opts.cancelled?.()) return
        const { i, path, depth } = queue.shift()!
        const items = await readdir(path, { withFileTypes: true }).catch(() => [])
        for (const item of items) {
          // Shortcuts (symlinks, junctions) aren't followed, so a loop can't trap the walk.
          const isDir = item.isDirectory() && !item.isSymbolicLink()
          const lower = item.name.toLowerCase()
          if (isDir && (lower.startsWith('.') || opts.skipDir(lower, path, depth + 1))) continue
          const child = this.add(item.name, i, isDir)
          if (isDir && !opts.leafDir?.(lower)) queue.push({ i: child, path: join(path, item.name), depth: depth + 1 })
        }
        if (opts.onProgress && this.count - lastReport > 20000) {
          lastReport = this.count
          opts.onProgress(this.count)
        }
      }
    }
    // Several folders are read at once; a worker that finds the queue empty waits for the others to add more.
    let running = 0
    await new Promise<void>((resolve) => {
      const start = (): void => {
        while (running < concurrency && queue.length && !opts.cancelled?.()) {
          running++
          void worker().finally(() => {
            running--
            if (!queue.length && !running) resolve()
            else start()
          })
        }
        if (!running) resolve()
      }
      start()
    })
  }

  /** Packs the extra list into the long strings, dropping deleted entries. */
  freeze(): void {
    const n = this.count
    const keep = new Int32Array(n).fill(-1)
    let m = 0
    for (let i = 0; i < n; i++) if (this.alive(i)) keep[i] = m++
    const names: string[] = new Array(m)
    const parents = new Int32Array(m)
    const flags = new Uint8Array(m)
    for (let i = 0; i < n; i++) {
      const j = keep[i]
      if (j < 0) continue
      names[j] = this.nameAt(i)
      const p = this.parentAt(i)
      parents[j] = p < 0 ? -1 : keep[p]
      flags[j] = this.flagsAt(i)
    }
    const starts = new Int32Array(m + 1)
    let at = 0
    for (let j = 0; j < m; j++) {
      starts[j] = at
      at += names[j].length + 1
    }
    starts[m] = at
    this.text = names.length ? `${names.join('\n')}\n` : ''
    this.lower = lowerSameLength(this.text)
    this.starts = starts
    this.parents = parents
    this.flags = flags
    this.frozenCount = m
    this.extraNames = []
    this.extraParents = []
    this.extraFlags = []
    this.flagEdits.clear()
    this.dirs.clear()
    for (let j = 0; j < m; j++) if (flags[j] & DIR) this.dirs.set(keyOf(this.pathOf(j)), j)
  }

  /** How many have been added since the last freeze (search slows a little as this grows). */
  get unfrozen(): number {
    return this.extraNames.length + this.flagEdits.size
  }

  /**
   * Reads a folder again and brings its entries up to date: gone ones are marked, new ones added
   * (new folders are walked into). Returns false when the folder isn't in the list.
   */
  async refreshDir(path: string, opts: CrawlOptions): Promise<boolean> {
    const i = this.dirEntry(path)
    if (i < 0) return false
    const items = await readdir(path, { withFileTypes: true }).catch(() => null)
    if (!items) {
      // The folder itself has gone (its parent's refresh marks it); nothing to compare.
      return true
    }
    const had = new Map<string, number>()
    for (let c = 0; c < this.count; c++) if (this.parentAt(c) === i && !(this.flagsAt(c) & GONE)) had.set(this.nameAt(c), c)
    const queue: { i: number; path: string; depth: number }[] = []
    const depth = this.depthOf(i)
    for (const item of items) {
      const isDir = item.isDirectory() && !item.isSymbolicLink()
      const lower = item.name.toLowerCase()
      if (isDir && (lower.startsWith('.') || opts.skipDir(lower, path, depth + 1))) continue
      const old = had.get(item.name)
      if (old !== undefined && !!(this.flagsAt(old) & DIR) === isDir) {
        had.delete(item.name)
        continue
      }
      const child = this.add(item.name, i, isDir)
      if (isDir && !opts.leafDir?.(lower)) queue.push({ i: child, path: join(path, item.name), depth: depth + 1 })
    }
    for (const gone of had.values()) this.setFlags(gone, this.flagsAt(gone) | GONE)
    if (queue.length) await this.walk(queue, { ...opts, onProgress: undefined })
    return true
  }

  private depthOf(i: number): number {
    let d = 0
    for (let at = this.parentAt(i); at >= 0; at = this.parentAt(at)) d++
    return d
  }

  /** The nearest folder in the list at or above `path` (to refresh when something changes deep down). */
  nearestDir(path: string): string | null {
    let at = path.replace(/[\\/]+$/, '')
    for (let n = 0; n < 64 && at; n++) {
      if (this.dirEntry(at) >= 0) return at
      const cut = Math.max(at.lastIndexOf('/'), at.lastIndexOf('\\'))
      if (cut < 0) break
      at = at.slice(0, cut) || '/'
      if (/^[a-z]:$/i.test(at)) at += '\\'
    }
    return null
  }

  private isUnder(i: number, ancestor: number): boolean {
    for (let at = this.parentAt(i); at >= 0; at = this.parentAt(at)) if (at === ancestor) return true
    return false
  }

  /** Names containing every word typed, best matches first. */
  search(query: string, opts: SearchOptions): IndexHit[] {
    const words = lowerSameLength(query).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const anchor = words.reduce((a, b) => (b.length > a.length ? b : a))
    const others = words.filter((w) => w !== anchor)
    const under = opts.under ? this.dirEntry(opts.under) : -1
    if (opts.under && under < 0) return []
    const preferAt = opts.prefer ? this.dirEntry(opts.prefer) : -1
    const until = Date.now() + (opts.budgetMs ?? 250)
    // More are collected than shown, so the best ones can be picked out.
    const cap = Math.max(opts.limit * 8, 2000)
    const found: { i: number; score: number }[] = []
    const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u')

    const consider = (i: number, lowerName: string): void => {
      const f = this.flagsAt(i)
      if (f & GONE) return
      if (!opts.showHidden && f & HIDDEN) return
      for (const w of others) if (!lowerName.includes(w)) return
      if (!this.alive(i)) return
      if (under >= 0 && !this.isUnder(i, under)) return
      if (this.parentAt(i) < 0) return
      found.push({ i, score: this.score(i, lowerName, words, wordStart, preferAt) })
    }

    const lower = this.lower
    let pos = lower.indexOf(anchor)
    while (pos >= 0 && found.length < cap) {
      const i = this.entryAt(pos)
      const end = this.starts[i + 1] - 1
      const lowerName = lower.slice(this.starts[i], end)
      // A word typed with a space never spans two names (they're split by line breaks).
      consider(i, lowerName)
      pos = lower.indexOf(anchor, end + 1)
      if ((found.length & 255) === 0 && Date.now() > until) break
    }
    for (let k = 0; k < this.extraNames.length && found.length < cap; k++) {
      const name = lowerSameLength(this.extraNames[k])
      if (name.includes(anchor)) consider(this.frozenCount + k, name)
    }
    found.sort((a, b) => a.score - b.score || this.nameAt(a.i).length - this.nameAt(b.i).length)
    return found.slice(0, opts.limit).map(({ i }) => ({ path: this.pathOf(i), isDir: !!(this.flagsAt(i) & DIR) }))
  }

  /** Lower is better: the whole name, then the start of the name, then the start of a word, then anywhere. */
  private score(i: number, name: string, words: string[], wordStart: RegExp, preferAt: number): number {
    const bare = name.replace(/\.[^.]*$/, '')
    const whole = words.join(' ')
    let s = name === whole || bare === whole ? 0 : name.startsWith(words[0]) ? 10 : wordStart.test(name) ? 20 : 30
    if (preferAt >= 0 && !this.isUnder(i, preferAt)) s += 5
    // Deep down in a folder tree usually means an app's own files.
    s += Math.min(this.depthOf(i), 12) * 0.25
    return s
  }

  /** Which frozen entry a position in the long string belongs to. */
  private entryAt(pos: number): number {
    let lo = 0
    let hi = this.frozenCount - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** What's saved to disk between launches (see fileIndexWorker.ts). Call `freeze()` first. */
  toJSON(): { v: 1; sep: string; roots: string[]; builtAt: number; text: string; parents: number[]; flags: number[] } {
    if (this.unfrozen) this.freeze()
    return { v: 1, sep: this.sep, roots: this.roots, builtAt: this.builtAt, text: this.text, parents: Array.from(this.parents), flags: Array.from(this.flags) }
  }

  static fromJSON(data: unknown): FileIndex | null {
    const d = data as ReturnType<FileIndex['toJSON']> | null
    if (!d || d.v !== 1 || typeof d.text !== 'string' || !Array.isArray(d.parents) || !Array.isArray(d.flags) || !Array.isArray(d.roots)) return null
    const index = new FileIndex(d.sep === '\\' ? '\\' : '/')
    const names = d.text ? d.text.slice(0, -1).split('\n') : []
    if (names.length !== d.parents.length || names.length !== d.flags.length) return null
    index.roots = d.roots
    index.builtAt = typeof d.builtAt === 'number' ? d.builtAt : 0
    index.extraNames = names
    index.extraParents = d.parents
    index.extraFlags = d.flags
    index.freeze()
    return index
  }
}
