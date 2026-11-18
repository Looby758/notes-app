import type { ArchiveEntry } from '@shared/archive'
import { safeRelative } from '@shared/archive'
import type { RarJob, RarProgress } from './rar'

/**
 * Runs one RAR job (list or unpack) in a worker thread, so a big or solid comic never freezes Orbit:
 * the unrar code is synchronous, and one step of it can take seconds. See rar.ts.
 */

export type Unrar = typeof import('node-unrar-js')

const slash = (name: string): string => name.replace(/\\/g, '/')
const pause = (): Promise<void> => new Promise((r) => setImmediate(r))

/** The archive is only closed by reading to its end; this closes it after stopping early. */
function closeQuietly(extractor: object): void {
  try {
    ;(extractor as unknown as { closeArc: () => void }).closeArc()
  } catch {
    // Already closed.
  }
}

async function list(unrar: Unrar, job: RarJob): Promise<ArchiveEntry[]> {
  const extractor = await unrar.createExtractorFromFile({ filepath: job.path, password: job.password })
  try {
    return [...extractor.getFileList().fileHeaders].map((h) => ({
      name: slash(h.name),
      size: h.unpSize,
      packedSize: h.packSize,
      isDir: h.flags.directory,
      encrypted: h.flags.encrypted
    }))
  } finally {
    // Reading the list to its end closes the RAR, but a wrong password stops it part way.
    closeQuietly(extractor)
  }
}

async function extract(unrar: Unrar, job: RarJob, onProgress: (p: RarProgress) => void, cancelled: () => boolean): Promise<string[]> {
  const targets = job.targets ?? {}
  const total = Object.keys(targets).length
  const extractor = await unrar.createExtractorFromFile({
    filepath: job.path,
    password: job.password,
    targetPath: job.dest,
    filenameTransform: (name) => safeRelative(targets[slash(name)] ?? name) || '_'
  })
  const done: string[] = []
  const files = extractor.extract({ files: (h) => !h.flags.directory && slash(h.name) in targets }).files
  try {
    // Each step of the loop unpacks the next file.
    while (done.length < total && !cancelled()) {
      const next = files.next()
      if (next.done) break
      const name = slash(next.value.fileHeader.name)
      done.push(name)
      onProgress({ name, done: done.length, total })
      await pause()
    }
  } finally {
    // Stopping before the end of the archive leaves it open; close it for the next job.
    closeQuietly(extractor)
  }
  return done
}

/** Does one job: the list of files, or the unpacking. Runs in the worker thread (rarWorker.ts), or in tests, right here. */
export function runRar(unrar: Unrar, job: RarJob, onProgress: (p: RarProgress) => void = () => undefined, cancelled: () => boolean = () => false): Promise<unknown> {
  return job.kind === 'list' ? list(unrar, job) : extract(unrar, job, onProgress, cancelled)
}
