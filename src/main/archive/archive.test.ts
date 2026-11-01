import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { archiveKind, extractArchive, listArchive, ZipArchive } from './index'
import { storedRar, tinyPng } from './testArchives'

const fixture = (name: string): string => join(__dirname, 'fixtures', name)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'archive-test-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function makeZip(name: string, files: Record<string, string | Uint8Array>, compression: 'STORE' | 'DEFLATE' = 'DEFLATE'): Promise<string> {
  const zip = new JSZip()
  for (const [n, data] of Object.entries(files)) zip.file(n, data)
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', compression }))
  return path
}

describe('zip', () => {
  it('lists and reads files, squashed or stored', async () => {
    for (const compression of ['STORE', 'DEFLATE'] as const) {
      const path = await makeZip(`a-${compression}.zip`, { 'Issue 1/01.txt': 'hello '.repeat(100), 'Issue 1/02.txt': 'two', 'ünïcode.txt': 'ü' }, compression)
      const zip = await ZipArchive.open(path)
      const names = zip.entries.filter((e) => !e.isDir).map((e) => e.name)
      expect(names.sort()).toEqual(['Issue 1/01.txt', 'Issue 1/02.txt', 'ünïcode.txt'])
      expect((await zip.read('Issue 1/01.txt')).toString()).toBe('hello '.repeat(100))
      expect((await zip.read('ünïcode.txt')).toString()).toBe('ü')
      await expect(zip.read('nope.txt')).rejects.toThrow()
      await zip.close()
    }
  })

  it('says so when a file isn’t a zip', async () => {
    const path = join(dir, 'fake.cbz')
    await writeFile(path, 'not a zip at all')
    await expect(ZipArchive.open(path)).rejects.toThrow(/isn’t a zip/)
  })

  it('unpacks safely, never outside the folder', async () => {
    const path = await makeZip('evil.zip', { '../../outside.txt': 'x', 'ok/in.txt': 'y' })
    const out = join(dir, 'out')
    await extractArchive(path, out)
    expect((await readdir(out)).sort()).toEqual(['ok', 'outside.txt'])
    expect(await readdir(dir)).not.toContain('outside.txt')
  })
})

describe('RAR', () => {
  it('knows a RAR by its bytes even when it’s called .cbz, and a zip called .cbr', async () => {
    const rar = join(dir, 'really-a-rar.cbz')
    await writeFile(rar, await readFile(fixture('rar5-solid.rar')))
    expect(await archiveKind(rar)).toBe('rar')
    const zip = await makeZip('really-a-zip.cbr', { 'a.txt': 'a' })
    expect(await archiveKind(zip)).toBe('zip')
    expect((await listArchive(zip)).map((e) => e.name)).toEqual(['a.txt'])
  })

  it('lists and unpacks a solid RAR 5', async () => {
    const list = await listArchive(fixture('rar5-solid.rar'))
    expect(list.map((e) => [e.name, e.size])).toEqual([
      ['stest1.txt', 2048],
      ['stest2.txt', 2048]
    ])
    const seen: number[] = []
    const done = await extractArchive(fixture('rar5-solid.rar'), join(dir, 'solid'), { onFile: (_n, d) => seen.push(d) })
    expect(done).toEqual(['stest1.txt', 'stest2.txt'])
    expect(seen).toEqual([1, 2])
    expect((await readFile(join(dir, 'solid', 'stest2.txt'))).length).toBe(2048)
  })

  it('unpacks folders and non-English names from a RAR 3, or only the files asked for', async () => {
    const done = await extractArchive(fixture('rar3-subdirs.rar'), join(dir, 'sub'), { only: (n) => n.includes('ü') || n.endsWith('file1.txt') })
    expect(done.sort()).toEqual(['sub/dir1/file1.txt', 'sub/üȵĩöḋè/file.txt'])
    expect((await readFile(join(dir, 'sub', 'sub', 'dir1', 'file1.txt'), 'utf8')).trim()).toBe('file1')
  })

  it('can rename what it unpacks, and stops early when asked', async () => {
    let stop = false
    const done = await extractArchive(fixture('rar3-subdirs.rar'), join(dir, 'renamed'), {
      rename: (n) => n.replace(/[\\/]/g, '-'),
      onFile: () => (stop = true),
      cancelled: () => stop
    })
    expect(done).toHaveLength(1)
    expect(await readdir(join(dir, 'renamed'))).toHaveLength(1)
    // The next job still works after stopping early.
    expect(await listArchive(fixture('rar5-solid.rar'))).toHaveLength(2)
  })

  it('keeps a RAR that tries to write outside the folder inside it', async () => {
    const out = join(dir, 'evil')
    await extractArchive(fixture('rar5-evil-symlink-traversal.rar'), out).catch(() => undefined)
    expect(await readdir(dir)).toEqual(['evil'])
  })

  it('reads the RARs the tests make (stored pictures, like a .cbr)', async () => {
    const path = join(dir, 'comic.cbr')
    await writeFile(path, storedRar([
      { name: 'Issue 1/01.png', data: tinyPng(20, 30) },
      { name: 'Issue 1/02.png', data: tinyPng(20, 30) }
    ]))
    expect((await listArchive(path)).map((e) => e.name)).toEqual(['Issue 1/01.png', 'Issue 1/02.png'])
    await extractArchive(path, join(dir, 'pics'))
    expect(await readFile(join(dir, 'pics', 'Issue 1', '02.png'))).toEqual(tinyPng(20, 30))
  })
})
