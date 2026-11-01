import { createExtractorFromFile } from 'node-unrar-js'
import type { ArchiveEntry } from '@shared/archive'
import { safeRelative } from '@shared/archive'

/**
 * Reads RAR files (RAR 4 and 5, solid or not; .cbr comics are RARs of pictures) with the official
 * unrar code built for WebAssembly (node-unrar-js), so there's nothing to install. RAR can't be
 * read a file at a time the way zip can (a "solid" RAR has to be unpacked from the start), so
 * files are unpacked to a folder on disk.
 *
 * The unpacking runs here in the main process, one file at a time with a pause between, so the app
 * stays responsive. The unrar code can only work on one archive at once, so jobs queue up.
 */

let queue: Promise<unknown> = Promise.resolve()

function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/** The archive is only closed by reading to its end; this closes it after stopping early. */
function closeQuietly(extractor: object): void {
  try {
    ;(extractor as unknown as { closeArc: () => void }).closeArc()
  } catch {
    // Already closed.
  }
}

const pause = (): Promise<void> => new Promise((r) => setImmediate(r))

function explain(err: unknown, password?: string): Error {
  const reason = (err as { reason?: string })?.reason
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') return new Error(password ? 'That password isn’t right.' : 'This RAR has a password.')
  if (reason === 'ERAR_BAD_ARCHIVE' || reason === 'ERAR_UNKNOWN_FORMAT' || reason === 'ERAR_BAD_DATA') return new Error('This RAR is damaged, or isn’t really a RAR.')
  if (reason === 'ERAR_EOPEN') return new Error('Couldn’t open this RAR (is it still downloading, or part of a set?).')
  return err instanceof Error ? err : new Error(String(err))
}

export function listRar(path: string, password?: string): Promise<ArchiveEntry[]> {
  return inTurn(async () => {
    try {
      const extractor = await createExtractorFromFile({ filepath: path, password })
      try {
        return [...extractor.getFileList().fileHeaders].map((h) => ({
          name: h.name.replace(/\\/g, '/'),
          size: h.unpSize,
          packedSize: h.packSize,
          isDir: h.flags.directory,
          encrypted: h.flags.encrypted
        }))
      } finally {
        // Reading the list to its end closes the RAR, but a wrong password stops it part way.
        closeQuietly(extractor)
      }
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
    const rename = (name: string): string => safeRelative(opts.rename ? opts.rename(name.replace(/\\/g, '/')) : name) || '_'
    try {
      const counting = await createExtractorFromFile({ filepath: path, password: opts.password })
      const wanted = (name: string, isDir: boolean): boolean => !isDir && (!opts.only || opts.only(name.replace(/\\/g, '/')))
      let total: number
      try {
        total = [...counting.getFileList().fileHeaders].filter((h) => wanted(h.name, h.flags.directory)).length
      } finally {
        closeQuietly(counting)
      }

      const extractor = await createExtractorFromFile({ filepath: path, password: opts.password, targetPath: dest, filenameTransform: rename })
      const done: string[] = []
      const files = extractor.extract({ files: (h) => wanted(h.name, h.flags.directory) }).files
      try {
        // Each step of the loop unpacks the next file.
        while (done.length < total && !opts.cancelled?.()) {
          const next = files.next()
          if (next.done) break
          const name = next.value.fileHeader.name.replace(/\\/g, '/')
          done.push(name)
          opts.onFile?.(name, done.length, total)
          await pause()
        }
      } finally {
        // Stopping before the end of the archive leaves it open; close it for the next job.
        closeQuietly(extractor)
      }
      return done
    } catch (err) {
      throw explain(err, opts.password)
    }
  })
}
