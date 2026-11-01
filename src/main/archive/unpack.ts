import { lstat, mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { archiveFolderName } from '@shared/archive'
import { uniqueName } from '@shared/explorer'
import { createArchive, type NewArchiveFormat } from './sevenZip'
import { extractArchive } from './index'

/**
 * The file explorer's unpacking and packing. Everything is unpacked into a hidden folder first
 * and only moved into place once it's all there, so a wrong password or a damaged archive never
 * leaves half a folder behind, and nothing already in the folder is ever replaced (a name that's
 * taken gets " (2)", like the rest of the explorer).
 */

export interface UnpackOptions {
  /** Only these (names inside the archive; a folder brings everything in it). */
  names?: string[]
  password?: string
  /** true: into a new folder named after the archive. false: straight into the folder it's in. */
  intoFolder?: boolean
  /** Where to; the archive's own folder when left out. */
  dest?: string
}

/** Shortcuts (symlinks) inside an archive could point anywhere on the computer, so they're dropped. */
async function dropLinks(dir: string): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isSymbolicLink() || (await lstat(path)).isSymbolicLink()) await rm(path, { force: true })
    else if (item.isDirectory()) await dropLinks(path)
  }
}

/** Unpacks an archive. Resolves with what was made at the top: one folder, or the items unpacked "here". */
export async function unpack(path: string, opts: UnpackOptions = {}): Promise<string[]> {
  const target = opts.dest ?? dirname(path)
  const temp = join(target, `.orbit-unpacking-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(temp)
  try {
    const picked = opts.names?.map((n) => n.replace(/\/$/, ''))
    const only = picked?.length ? (name: string) => picked.some((p) => name === p || name.startsWith(`${p}/`)) : undefined
    const files = await extractArchive(path, temp, { only, password: opts.password })
    if (!files.length && only) throw new Error('Nothing picked could be unpacked.')
    await dropLinks(temp)
    const top = await readdir(temp)
    const taken = await readdir(target)
    const intoFolder = opts.intoFolder ?? true
    if (intoFolder) {
      // An archive that's all one folder ("Photos.zip" holding "Photos/…") isn't wrapped in another.
      const only1 = top.length === 1 && (await stat(join(temp, top[0]))).isDirectory() ? top[0] : null
      const name = uniqueName(only1 ?? archiveFolderName(basename(path)), taken, true)
      const to = join(target, name)
      await rename(only1 ? join(temp, only1) : temp, to)
      return [to]
    }
    const made: string[] = []
    for (const item of top) {
      const isDir = (await stat(join(temp, item))).isDirectory()
      const name = uniqueName(item, taken, isDir)
      taken.push(name)
      await rename(join(temp, item), join(target, name))
      made.push(join(target, name))
    }
    return made
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

/** Packs files and folders into a new zip or 7z next to them (or in `dir`). Resolves with its path. */
export async function pack(paths: string[], format: NewArchiveFormat, opts: { name: string; dir?: string; password?: string }): Promise<string> {
  if (!paths.length) throw new Error('Nothing was picked.')
  const dir = opts.dir ?? dirname(paths[0])
  const name = uniqueName(opts.name, await readdir(dir))
  const out = join(dir, name)
  try {
    await createArchive(paths, out, format, opts.password)
  } catch (err) {
    await rm(out, { force: true })
    throw err
  }
  return out
}
