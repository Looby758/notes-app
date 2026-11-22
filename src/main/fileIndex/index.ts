import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { IndexHit, SearchOptions } from './core'
import type { IndexStatus } from './service'
import { indexFile, rootsFor } from './roots'

/**
 * Whole PC search, from the main process's side: starts the worker thread that keeps the list
 * of every file (fileIndexWorker.ts), asks it, and adds what the system's own search knows:
 * Spotlight on a Mac, and the Everything app on Windows when it's installed and running.
 */

export type { IndexHit, IndexStatus }

const OFF: IndexStatus = { state: 'off', count: 0, builtAt: 0, progress: 0, live: false, roots: [] }

let worker: Worker | null = null
let status: IndexStatus = OFF
let nextId = 1
const waiting = new Map<number, (hits: IndexHit[] | null) => void>()
let onStatus: (s: IndexStatus) => void = () => undefined

const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

export interface IndexSetup {
  userData: string
  home: string
  drives: string[]
  /** The worker's script (electron-vite's ?modulePath), passed in so tests can skip it. */
  workerPath: string
  statusChanged?: (s: IndexStatus) => void
}

export function startFileIndex(setup: IndexSetup): void {
  if (worker) return
  if (setup.statusChanged) onStatus = setup.statusChanged
  const roots = rootsFor(process.platform, setup.home, setup.drives)
  status = { ...OFF, state: 'loading', roots }
  const w = new Worker(unpacked(setup.workerPath), {
    workerData: { roots, home: setup.home, platform: process.platform, savePath: indexFile(setup.userData) },
    // Walking the drives is the least important thing Orbit does.
    resourceLimits: { maxOldGenerationSizeMb: 1024 }
  })
  worker = w
  w.on('message', (m: { type: 'status'; status: IndexStatus } | { type: 'result'; id: number; hits: IndexHit[] | null }) => {
    if (m.type === 'status') {
      status = m.status
      onStatus(status)
    } else {
      waiting.get(m.id)?.(m.hits)
      waiting.delete(m.id)
    }
  })
  const gone = (): void => {
    if (worker !== w) return
    worker = null
    status = OFF
    for (const done of waiting.values()) done(null)
    waiting.clear()
    onStatus(status)
  }
  w.on('error', gone)
  w.on('exit', gone)
}

export function stopFileIndex(): void {
  const w = worker
  if (!w) return
  w.postMessage({ type: 'stop' })
  setTimeout(() => void w.terminate(), 2000)
  worker = null
  status = OFF
  onStatus(status)
}

export const fileIndexStatus = (): IndexStatus => status

/** Walks the drives again now (the "Update now" button). */
export function rebuildFileIndex(): void {
  worker?.postMessage({ type: 'rebuild' })
}

/** Orbit changed these (made, renamed, moved, deleted): the list catches up without waiting for the system to say. */
export function touchedFiles(paths: string[]): void {
  if (worker && paths.length) worker.postMessage({ type: 'touched', paths })
}

/** Asks the list; null when it isn't ready or doesn't cover `opts.under`. */
export function searchIndex(query: string, opts: SearchOptions): Promise<IndexHit[] | null> {
  const w = worker
  if (!w) return Promise.resolve(null)
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => (waiting.delete(id), resolve(null)), 3000)
    waiting.set(id, (hits) => (clearTimeout(timer), resolve(hits)))
    w.postMessage({ type: 'search', id, query, opts })
  })
}

// ---- the system's own search ----

const run = (file: string, args: string[], timeout: number): Promise<string> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout)))
  })

/** Spotlight's answer on a Mac: names containing the longest word (the rest are checked by the caller). Live, and covers the whole disk. */
async function spotlight(words: string[], limit: number): Promise<IndexHit[]> {
  const anchor = words.reduce((a, b) => (b.length > a.length ? b : a))
  // -name matches part of a file's name, ignoring capitals.
  const out = await run('/usr/bin/mdfind', ['-name', anchor], 1500)
  const hits: IndexHit[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    hits.push({ path: line, isDir: false })
    if (hits.length >= limit * 4) break
  }
  return hits
}

let esPath: string | null | undefined
/** Everything's command-line helper (es.exe), when it's installed. */
function findEs(): string | null {
  if (esPath !== undefined) return esPath
  const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter((d): d is string => !!d)
  const found = dirs.flatMap((d) => [join(d, 'Everything', 'es.exe'), join(d, 'Everything 1.5a', 'es.exe')]).find((p) => existsSync(p))
  esPath = found ?? null
  return esPath
}

/** Everything's answer on Windows (it reads the drive's own file table, so it's instant and live). Nothing when it isn't installed or running. */
async function everything(words: string[], limit: number): Promise<IndexHit[]> {
  const es = findEs()
  if (!es) return []
  const out = await run(es, ['-n', String(limit), ...words], 1500)
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => ({ path, isDir: false }))
}

export const hasEverything = (): boolean => process.platform === 'win32' && !!findEs()

/** What the system's own search finds too (marked as files; the caller looks each one up). */
export function systemSearch(query: string, limit: number): Promise<IndexHit[]> {
  const words = query.split(/\s+/).filter(Boolean)
  if (!words.length) return Promise.resolve([])
  if (process.platform === 'darwin') return spotlight(words, limit)
  if (process.platform === 'win32') return everything(words, limit)
  return Promise.resolve([])
}
