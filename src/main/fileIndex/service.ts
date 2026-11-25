import { watch, type FSWatcher } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join, sep as pathSep } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import { FileIndex, type IndexHit, type SearchOptions } from './core'
import { isMacBundle, skipDirFor } from './rules'
import type { PcIndexStatus } from '@shared/explorer'

/**
 * Keeps the Whole PC list (core.ts) for one run of Orbit: loads last time's from disk so search
 * works straight away, walks the drives again in the background, and watches them so files made,
 * renamed or deleted show up (or drop out) within a couple of seconds. Runs in a worker thread
 * (fileIndexWorker.ts), so none of it slows the window down.
 */

export type IndexStatus = PcIndexStatus

export interface ServiceOptions {
  roots: string[]
  home: string
  platform: NodeJS.Platform
  /** The saved list (file-index.json.gz), or null to keep nothing on disk (tests). */
  savePath: string | null
  onStatus: (s: IndexStatus) => void
  /** How long changes are gathered before the folders are read again. */
  settleMs?: number
  /** A saved list younger than this isn't walked again at launch. */
  freshMs?: number
  /** Wait this long after launch before walking the drives, so Orbit starts quickly. */
  buildDelayMs?: number
}

/** Too many changes at once (a big copy, an install): walk everything again instead. */
const TOO_MANY = 3000

export class IndexService {
  private index: FileIndex | null = null
  private building: FileIndex | null = null
  private stopped = false
  private watchers: FSWatcher[] = []
  private dirty = new Set<string>()
  private settleTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private buildTimer: NodeJS.Timeout | null = null
  private changedSinceSave = false
  private progress = 0
  private refreshing: Promise<void> = Promise.resolve()
  private readonly skipDir: ReturnType<typeof skipDirFor>
  private readonly leafDir: (lowerName: string) => boolean

  constructor(private readonly opts: ServiceOptions) {
    this.skipDir = skipDirFor(opts.platform, opts.home)
    this.leafDir = (name) => isMacBundle(opts.platform, name)
  }

  status(): IndexStatus {
    const idx = this.index
    return {
      state: this.stopped ? 'off' : this.building ? (idx ? 'ready' : 'building') : idx ? 'ready' : 'loading',
      count: idx ? idx.count : 0,
      builtAt: idx?.builtAt ?? 0,
      progress: this.building ? this.progress : 0,
      live: this.watchers.length > 0,
      roots: this.opts.roots
    }
  }

  private report(): void {
    if (!this.stopped) this.opts.onStatus(this.status())
  }

  async start(): Promise<void> {
    const saved = await this.load()
    if (saved) {
      this.index = saved
      this.report()
    }
    this.watchAll()
    const fresh = saved && Date.now() - saved.builtAt < (this.opts.freshMs ?? 60 * 60_000)
    if (!fresh) {
      if (saved) this.buildTimer = setTimeout(() => void this.rebuild(), this.opts.buildDelayMs ?? 20_000)
      else await this.rebuild()
    }
    this.report()
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const t of [this.settleTimer, this.saveTimer, this.buildTimer]) if (t) clearTimeout(t)
  }

  /** Walks every root again into a new list, which replaces the old one when it's done. */
  async rebuild(): Promise<void> {
    if (this.building || this.stopped) return
    const next = new FileIndex(pathSep)
    this.building = next
    this.progress = 0
    this.report()
    try {
      await next.build(this.opts.roots, {
        skipDir: this.skipDir,
        leafDir: this.leafDir,
        cancelled: () => this.stopped,
        onProgress: (n) => {
          this.progress = n
          this.report()
        }
      })
      if (this.stopped) return
      this.index = next
      // What changed while it was walking might have been missed in folders already read.
      for (const d of this.dirty) await next.refreshDir(d, { skipDir: this.skipDir, leafDir: this.leafDir }).catch(() => undefined)
      this.changedSinceSave = true
      void this.save()
    } finally {
      this.building = null
      this.report()
    }
  }

  search(query: string, opts: SearchOptions): IndexHit[] | null {
    const idx = this.index
    if (!idx) return null
    // A Subfolders search in a folder that isn't in the list (say, inside AppData) is left to the explorer.
    if (opts.under && !idx.covers(opts.under)) return null
    return idx.search(query, opts)
  }

  covers(path: string): boolean {
    return !!this.index?.covers(path)
  }

  /** Something changed here (Orbit made, moved or deleted it): read these folders again soon. */
  touched(paths: string[]): void {
    for (const p of paths) this.markDirty(p)
  }

  /** Waits for changes noticed so far to be in the list (tests). */
  async settled(): Promise<void> {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
      await this.applyChanges()
    }
    await this.refreshing
  }

  private watchAll(): void {
    for (const root of this.opts.roots) {
      try {
        const w = watch(root, { recursive: true, persistent: false }, (_event, name) => {
          if (!name) return
          const rel = name.toString()
          // Changes inside left-out folders (caches, AppData, .git…) are ignored before anything else.
          const parts = rel.split(/[\\/]/)
          for (let k = 0; k < parts.length - 1; k++) {
            const p = parts[k]
            if (p.startsWith('.') || this.leafDir(p.toLowerCase()) || this.skipDir(p.toLowerCase(), join(root, ...parts.slice(0, k)), k + 1)) return
          }
          this.markDirty(dirname(join(root, rel)))
        })
        w.on('error', () => {
          // A drive went away: stop watching it; the next walk picks it up again.
          w.close()
          this.watchers = this.watchers.filter((x) => x !== w)
          this.report()
        })
        this.watchers.push(w)
      } catch {
        // This system can't watch a whole drive: the list is still walked again at each launch.
      }
    }
  }

  private markDirty(path: string): void {
    if (this.stopped) return
    this.dirty.add(path)
    if (this.dirty.size > TOO_MANY) {
      this.dirty.clear()
      if (this.settleTimer) clearTimeout(this.settleTimer)
      this.settleTimer = null
      if (!this.buildTimer) this.buildTimer = setTimeout(() => ((this.buildTimer = null), void this.rebuild()), 30_000)
      return
    }
    if (!this.settleTimer) this.settleTimer = setTimeout(() => ((this.settleTimer = null), void this.applyChanges()), this.opts.settleMs ?? 1500)
  }

  private async applyChanges(): Promise<void> {
    const idx = this.index
    const dirs = [...this.dirty]
    // While a walk is going, the dirty ones are kept for it to read again when it's done.
    if (!this.building) this.dirty.clear()
    if (!idx) return
    const run = async (): Promise<void> => {
      const seen = new Set<string>()
      for (const d of dirs) {
        const at = idx.nearestDir(d)
        if (!at || seen.has(at)) continue
        seen.add(at)
        await idx.refreshDir(at, { skipDir: this.skipDir, leafDir: this.leafDir }).catch(() => undefined)
      }
      if (idx.unfrozen > 50_000) idx.freeze()
      this.changedSinceSave = true
      this.scheduleSave()
      this.report()
    }
    this.refreshing = this.refreshing.then(run, run)
    await this.refreshing
  }

  private scheduleSave(): void {
    if (this.saveTimer || !this.opts.savePath) return
    this.saveTimer = setTimeout(() => ((this.saveTimer = null), void this.save()), 10 * 60_000)
  }

  private async load(): Promise<FileIndex | null> {
    if (!this.opts.savePath) return null
    try {
      const data = JSON.parse(gunzipSync(await readFile(this.opts.savePath)).toString('utf8'))
      const idx = FileIndex.fromJSON(data)
      // Saved for other drives (one was plugged in or taken out): walk again.
      return idx && JSON.stringify(idx.roots) === JSON.stringify(this.opts.roots) ? idx : null
    } catch {
      return null
    }
  }

  async save(): Promise<void> {
    const path = this.opts.savePath
    const idx = this.index
    if (!path || !idx || !this.changedSinceSave || this.stopped) return
    this.changedSinceSave = false
    try {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      await writeFile(tmp, gzipSync(JSON.stringify(idx.toJSON()), { level: 4 }))
      await rename(tmp, path)
    } catch {
      // Not saved: it's walked again next launch.
    }
  }
}
