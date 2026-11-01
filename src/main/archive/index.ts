import { mkdir, open, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { archiveKindOf, archiveKindOfName, safeRelative, type ArchiveEntry, type ArchiveKind } from '@shared/archive'
import { extractRar, listRar } from './rar'
import { extractSevenZip, listSevenZip } from './sevenZip'
import { ZipArchive } from './zip'

/**
 * Opening archives, whatever kind: what's inside, and unpacking some or all of it. Used by the
 * comic reader and the file explorer's zip / RAR / 7z opener. Zips are read by Orbit's own code
 * (zip.ts) and RARs by unrar (rar.ts); 7z files, and zips with a password or squashed in a way
 * zip.ts can't read, go to 7-Zip (sevenZip.ts).
 */

export { ZipArchive } from './zip'
export { extractRar, listRar } from './rar'
export { createArchive, extractSevenZip, listSevenZip, type NewArchiveFormat } from './sevenZip'

/** What an archive really is, from its first bytes (falling back to its name). */
export async function archiveKind(path: string): Promise<ArchiveKind | null> {
  const file = await open(path, 'r')
  try {
    const head = Buffer.alloc(8)
    await file.read(head, 0, 8, 0)
    return archiveKindOf(head) ?? archiveKindOfName(path)
  } finally {
    await file.close()
  }
}

const unsupported = (): Error => new Error('This isn’t a zip, RAR or 7z file.')

export async function listArchive(path: string, password?: string): Promise<ArchiveEntry[]> {
  const kind = await archiveKind(path)
  if (kind === 'rar') return listRar(path, password)
  if (kind === '7z') return listSevenZip(path, password)
  if (kind !== 'zip') throw unsupported()
  const zip = await ZipArchive.open(path)
  try {
    return zip.entries
  } finally {
    await zip.close()
  }
}

export interface ExtractOptions {
  only?: (name: string) => boolean
  rename?: (name: string) => string
  onFile?: (name: string, done: number, total: number) => void
  cancelled?: () => boolean
  /** For an archive with a password. */
  password?: string
}

/** Zip methods zip.ts reads itself: stored and deflate. */
const ZIP_METHODS_READ = new Set([0, 8])

/** Unpacks an archive (or the files picked) into a folder. Resolves with the names unpacked. */
export async function extractArchive(path: string, dest: string, opts: ExtractOptions = {}): Promise<string[]> {
  const kind = await archiveKind(path)
  await mkdir(dest, { recursive: true })
  if (kind === 'rar') return extractRar(path, dest, opts)
  if (kind === '7z') return extractWithSevenZip(path, dest, await listSevenZip(path, opts.password), opts)
  if (kind !== 'zip') throw unsupported()
  const zip = await ZipArchive.open(path)
  try {
    const files = zip.entries.filter((e) => !e.isDir && (!opts.only || opts.only(e.name)))
    // A password, or a rarer way of squashing: 7-Zip does those.
    if (files.some((e) => e.encrypted || !ZIP_METHODS_READ.has(zip.methodOf(e.name)))) return extractWithSevenZip(path, dest, zip.entries, opts)
    const done: string[] = []
    for (const entry of files) {
      if (opts.cancelled?.()) break
      const rel = safeRelative(opts.rename ? opts.rename(entry.name) : entry.name) || '_'
      const target = join(dest, ...rel.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await zip.read(entry.name))
      done.push(entry.name)
      opts.onFile?.(entry.name, done.length, files.length)
    }
    return done
  } finally {
    await zip.close()
  }
}

/**
 * 7-Zip unpacks straight into `dest` under each file's own path (it already refuses ".." and
 * other escapes), so `rename` isn't used here and `only` picks by name.
 */
async function extractWithSevenZip(path: string, dest: string, entries: ArchiveEntry[], opts: ExtractOptions): Promise<string[]> {
  const files = entries.filter((e) => !e.isDir && (!opts.only || opts.only(e.name))).map((e) => e.name)
  if (!files.length) return []
  await extractSevenZip(path, dest, { names: opts.only ? files : undefined, password: opts.password })
  opts.onFile?.(files[files.length - 1], files.length, files.length)
  return files
}
