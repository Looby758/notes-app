import type { ArchiveEntry } from '@shared/archive'
import { safeRelative } from '@shared/archive'

/**
 * Reads RAR files (RAR 4 and 5, solid or not; .cbr comics are RARs of pictures) with the official
 * unrar code built for WebAssembly (node-unrar-js), so there's nothing to install. RAR can't be
 * read a file at a time the way zip can (a "solid" RAR has to be unpacked from the start), so
 * files are unpacked to a folder on disk.
 *
 * The unrar code is synchronous, and one step (a file deep inside a solid RAR) can take seconds, so
 * it runs in a worker thread, never in the main process. Jobs queue up, one archive at a time.
 * Worker threads can't load files from inside app.asar, so node-unrar-js is unpacked next to it
 * (electron-builder.yml) and loaded from there.
 */

export interface RarProgress {
  name: string
  done: number
  total: number
}

export interface RarJob {
  kind: 'list' | 'extract'
  path: string
  password?: string
  /** extract: the folder to unpack into. */
  dest?: string
  /** extract: the files to unpack (by their name in the archive) and where each goes inside the folder. */
  targets?: Record<string, string>
}

let queue: Promise<unknown> = Promise.resolve()

function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

function explain(err: unknown, password?: string): Error {
  const reason = (err as { reason?: string })?.reason
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') return new Error(password ? 'That password isn’t right.' : 'This RAR has a password.')
  if (reason === 'ERAR_BAD_ARCHIVE' || reason === 'ERAR_UNKNOWN_FORMAT' || reason === 'ERAR_BAD_DATA') return new Error('This RAR is damaged, or isn’t really a RAR.')
  if (reason === 'ERAR_EOPEN') return new Error('Couldn’t open this RAR (is it still downloading, or part of a set?).')
  const message = (err as { message?: string })?.message
  return err instanceof Error ? err : new Error(message ?? String(err))
}

export type RarRunner = <T>(job: RarJob, onProgress?: (p: RarProgress) => void, cancelled?: () => boolean) => Promise<T>

/** The app's runner: a worker thread per job. Loaded lazily (it needs electron-vite's ?modulePath). */
let runInWorker: RarRunner = async (job, onProgress, cancelled) => (await import('./rarThread')).runInThread(job, onProgress, cancelled)

/** Tests run unrar in the same thread. */
export function setRarRunner(next: RarRunner): void {
  runInWorker = next
}

export function listRar(path: string, password?: string): Promise<ArchiveEntry[]> {
  return inTurn(async () => {
    try {
      return await runInWorker<ArchiveEntry[]>({ kind: 'list', path, password })
    } catch (err) {
      throw explain(err, password)
    }
  })
}

export interface RarExtractOptions {
  /** Which files to unpack (by their name in the archive); all of them when left out. */
  only?: (name: string) => boolean
  /** Where each one goes, relative to the folder; by default its own path, made safe. */
  rename?: (name: string) => string
  /** After each file. */
  onFile?: (name: string, done: number, total: number) => void
  /** Asked between files; true stops early. */
  cancelled?: () => boolean
  /** For a RAR with a password. */
  password?: string
}

/** Unpacks files from a RAR into `dest` (made if needed). Resolves with the names unpacked. */
export function extractRar(path: string, dest: string, opts: RarExtractOptions = {}): Promise<string[]> {
  return inTurn(async () => {
    try {
      // The worker can't call back into functions, so which files and where they go is worked out here.
      const targets: Record<string, string> = {}
      for (const e of await runInWorker<ArchiveEntry[]>({ kind: 'list', path, password: opts.password })) {
        if (e.isDir || (opts.only && !opts.only(e.name))) continue
        targets[e.name] = safeRelative(opts.rename ? opts.rename(e.name) : e.name) || '_'
      }
      return await runInWorker<string[]>({ kind: 'extract', path, password: opts.password, dest, targets }, (p) => opts.onFile?.(p.name, p.done, p.total), opts.cancelled)
    } catch (err) {
      throw explain(err, opts.password)
    }
  })
}
