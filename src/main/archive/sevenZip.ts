import { basename, dirname } from 'path'
import type { ArchiveEntry } from '@shared/archive'
import type { SevenZipJob, SevenZipResult } from './sevenZipRun'

/**
 * 7z files, plus anything the comic reader's own zip code can't do (zips with a password, or
 * squashed in rarer ways), and making new zip and 7z files. All of it is done by 7-Zip itself,
 * built for WebAssembly (sevenZipRun.ts), in a worker thread so the app never freezes.
 */

export type Runner = (job: SevenZipJob) => Promise<SevenZipResult>

/** The app's runner: a worker thread per command. Loaded lazily (it needs electron-vite's ?modulePath). */
let runner: Runner = async (job) => (await import('./sevenZipThread')).runInWorker(job)

/** Tests run 7-Zip in the same thread. */
export function setSevenZipRunner(next: Runner): void {
  runner = next
}

/** The password switch: always given, so 7-Zip never stops to ask. */
const passwordArg = (password?: string): string => `-p${password ?? ''}`

function explain(r: SevenZipResult, password: string | undefined): Error {
  const text = `${r.err}\n${r.out}`
  if (/wrong password|encrypted archive|data error in encrypted/i.test(text)) return new Error(password ? 'That password isn’t right.' : 'This archive has a password.')
  if (/can ?not open the file as archive|is not archive|unexpected end of archive|headers error/i.test(text)) return new Error('This archive is damaged, or isn’t really an archive.')
  if (/no such file|errno=44/i.test(text)) return new Error('That file isn’t there any more.')
  if (/no space|errno=51/i.test(text)) return new Error('There isn’t enough space on the drive.')
  // 7-Zip stops without a word when it needs a password for the list of files and none was given.
  if (r.code === null && /(Listing|Extracting|Updating) archive/.test(r.out)) return new Error(password ? 'That password isn’t right.' : 'This archive has a password.')
  const line = r.err.split('\n').map((l) => l.trim()).find((l) => l && !/^ERROR:?$/.test(l))
  return new Error(line ? `7-Zip: ${line.replace(/^ERROR:\s*/, '')}` : 'Something went wrong with this archive.')
}

async function run(job: SevenZipJob, password?: string): Promise<SevenZipResult> {
  const r = await runner(job)
  // 1 is a warning (say, a file that couldn't be read) and still made something. So is a shortcut
  // pointing outside the archive, which 7-Zip skips (and unpack.ts drops any others).
  const problems = r.err.split('\n').filter((l) => /^ERROR:/.test(l.trim()))
  const onlyLinksSkipped = r.code === 2 && problems.length > 0 && problems.every((l) => /dangerous link path was ignored/i.test(l))
  if (r.code !== 0 && r.code !== 1 && !onlyLinksSkipped) throw explain(r, password)
  return r
}

/** Reads 7-Zip's "-slt" list (one "Key = value" block per file) into entries. */
export function parseList(out: string): ArchiveEntry[] {
  const start = out.indexOf('\n----------')
  if (start < 0) return []
  const entries: ArchiveEntry[] = []
  for (const block of out.slice(start + 11).split(/\n\s*\n/)) {
    const fields = new Map<string, string>()
    for (const line of block.split('\n')) {
      const eq = line.indexOf(' = ')
      if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 3))
    }
    const name = fields.get('Path')
    if (!name) continue
    const isDir = fields.get('Folder') === '+' || /^D/.test(fields.get('Attributes') ?? '')
    entries.push({
      name: name.replace(/\\/g, '/') + (isDir ? '/' : ''),
      size: Number(fields.get('Size')) || 0,
      packedSize: Number(fields.get('Packed Size')) || 0,
      isDir,
      encrypted: fields.get('Encrypted') === '+'
    })
  }
  return entries
}

/** What's inside a 7z (or any archive 7-Zip reads). Folder names end in "/", like zip's. */
export async function listSevenZip(path: string, password?: string): Promise<ArchiveEntry[]> {
  const r = await run({ args: ['l', '-slt', '-sccUTF-8', passwordArg(password), `/a/${basename(path)}`], mounts: [{ at: '/a', root: dirname(path) }] }, password)
  return parseList(r.out)
}

/**
 * Unpacks an archive (or just the files named) into `dest`, which should be a new, empty folder:
 * a wrong password leaves half-made files behind, and anything already there may be replaced.
 */
export async function extractSevenZip(path: string, dest: string, opts: { names?: string[]; password?: string } = {}): Promise<void> {
  // -spd: names are names, not wildcards (a file can be called "*.txt").
  const names = opts.names?.map((n) => n.replace(/\/$/, '')) ?? []
  await run(
    {
      args: ['x', '-y', '-spd', '-sccUTF-8', passwordArg(opts.password), '-o/o', `/a/${basename(path)}`, ...names],
      mounts: [
        { at: '/a', root: dirname(path) },
        { at: '/o', root: dest }
      ]
    },
    opts.password
  )
}

export type NewArchiveFormat = 'zip' | '7z'

/**
 * Makes a new zip or 7z at `out` from files and folders (each goes in under its own name, with
 * everything inside it). A password locks a zip with AES-256; a 7z also hides its list of names.
 */
export async function createArchive(paths: string[], out: string, format: NewArchiveFormat, password?: string): Promise<void> {
  // Each different folder the items come from gets its own mount.
  const roots: string[] = []
  const items = paths.map((p) => {
    const root = dirname(p)
    let i = roots.indexOf(root)
    if (i < 0) i = roots.push(root) - 1
    return `/s${i}/${basename(p)}`
  })
  const args = ['a', `-t${format}`, '-y', '-spd', '-sccUTF-8', '-mx=5']
  if (format === 'zip') args.push('-mcu=on')
  if (password) args.push(`-p${password}`, ...(format === 'zip' ? ['-mem=AES256'] : ['-mhe=on']))
  args.push(`/o/${basename(out)}`, ...items)
  await run({ args, mounts: [{ at: '/o', root: dirname(out) }, ...roots.map((root, i) => ({ at: `/s${i}`, root }))] })
}
