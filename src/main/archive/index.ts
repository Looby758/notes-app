import { mkdir, open, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { archiveKindOf, archiveKindOfName, safeRelative, type ArchiveEntry, type ArchiveKind } from '@shared/archive'
import { extractRar, listRar } from './rar'
import { ZipArchive } from './zip'

/**
 * Opening archives, whatever kind: what's inside, and unpacking some or all of it. Used by the
 * comic reader now, and meant for the zip / RAR opener in the file explorer next.
 */

export { ZipArchive } from './zip'
export { extractRar, listRar } from './rar'

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

const unsupported = (kind: ArchiveKind | null): Error =>
  new Error(kind === '7z' ? '7z files can’t be opened yet.' : 'This isn’t a zip or RAR file.')

export async function listArchive(path: string): Promise<ArchiveEntry[]> {
  const kind = await archiveKind(path)
  if (kind === 'rar') return listRar(path)
  if (kind !== 'zip') throw unsupported(kind)
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
}

/** Unpacks an archive (or the files picked) into a folder. Resolves with the names unpacked. */
export async function extractArchive(path: string, dest: string, opts: ExtractOptions = {}): Promise<string[]> {
  const kind = await archiveKind(path)
  await mkdir(dest, { recursive: true })
  if (kind === 'rar') return extractRar(path, dest, opts)
  if (kind !== 'zip') throw unsupported(kind)
  const zip = await ZipArchive.open(path)
  try {
    const files = zip.entries.filter((e) => !e.isDir && (!opts.only || opts.only(e.name)))
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
