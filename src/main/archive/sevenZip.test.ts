import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { archiveFolderName, describeContents, newArchiveName } from '@shared/archive'
import { archiveKind, extractArchive, listArchive } from './index'
import { createArchive, parseList, setSevenZipRunner } from './sevenZip'
import { runSevenZip, type SevenZipFactory } from './sevenZipRun'
import { storedRar } from './testArchives'
import { pack, unpack } from './unpack'

beforeAll(() => {
  const factory = createRequire(__filename)('7z-wasm') as SevenZipFactory
  setSevenZipRunner((job) => runSevenZip(factory, job))
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sevenzip-test-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

/** A name 7-Zip could read as a wildcard. Windows doesn't allow * in file names, so it gets brackets there. */
const ODD = process.platform === 'win32' ? 'ünïcode [star].txt' : 'ünïcode *star*.txt'

/** A small folder of things to pack: two files and a folder with one in it. */
async function makeFiles(): Promise<string[]> {
  const src = join(dir, 'src')
  await mkdir(join(src, 'Holiday'), { recursive: true })
  await writeFile(join(src, 'notes.txt'), 'hello '.repeat(50))
  await writeFile(join(src, ODD), 'ü')
  await writeFile(join(src, 'Holiday', 'day 1.txt'), 'beach')
  return ['notes.txt', ODD, 'Holiday'].map((n) => join(src, n))
}

const tree = async (at: string, base = ''): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(at, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(`${rel}/`, ...(await tree(join(at, e.name), rel)))
    else out.push(rel)
  }
  return out.sort()
}

describe('7z', () => {
  it('makes a 7z, lists it and unpacks it', async () => {
    const out = join(dir, 'Pack.7z')
    await createArchive(await makeFiles(), out, '7z')
    expect(await archiveKind(out)).toBe('7z')
    const names = (await listArchive(out)).map((e) => e.name).sort()
    expect(names).toEqual(['Holiday/', 'Holiday/day 1.txt', 'notes.txt', ODD])
    const dest = join(dir, 'out')
    await extractArchive(out, dest)
    expect(await tree(dest)).toEqual(['Holiday/', 'Holiday/day 1.txt', 'notes.txt', ODD])
    expect(await readFile(join(dest, 'notes.txt'), 'utf8')).toBe('hello '.repeat(50))
  })

  it('unpacks only the files picked, names with * included', async () => {
    const out = join(dir, 'Pack.7z')
    await createArchive(await makeFiles(), out, '7z')
    const dest = join(dir, 'out')
    await extractArchive(out, dest, { only: (n) => n === ODD })
    expect(await tree(dest)).toEqual([ODD])
  })

  it('locks a 7z with a password, names and all', async () => {
    const out = join(dir, 'Secret.7z')
    await createArchive(await makeFiles(), out, '7z', 'hunter2')
    await expect(listArchive(out)).rejects.toThrow('This archive has a password.')
    await expect(listArchive(out, 'wrong')).rejects.toThrow('That password isn’t right.')
    expect((await listArchive(out, 'hunter2')).length).toBe(4)
    const made = await unpack(out, { password: 'hunter2' })
    expect(made).toEqual([join(dir, 'Secret')])
    expect(await readFile(join(dir, 'Secret', 'Holiday', 'day 1.txt'), 'utf8')).toBe('beach')
  })
})

describe('zip made by 7-Zip', () => {
  it('makes a zip Orbit’s own zip reader opens', async () => {
    const out = join(dir, 'Pack.zip')
    await createArchive(await makeFiles(), out, 'zip')
    expect(await archiveKind(out)).toBe('zip')
    const names = (await listArchive(out)).filter((e) => !e.isDir).map((e) => e.name).sort()
    expect(names).toEqual(['Holiday/day 1.txt', 'notes.txt', ODD])
  })

  it('unpacks a zip with a password through 7-Zip, and says when it’s wrong', async () => {
    const out = join(dir, 'Locked.zip')
    await createArchive(await makeFiles(), out, 'zip', 'pw')
    expect((await listArchive(out)).some((e) => e.encrypted)).toBe(true)
    await expect(unpack(out)).rejects.toThrow('This archive has a password.')
    await expect(unpack(out, { password: 'nope' })).rejects.toThrow('That password isn’t right.')
    // A wrong password leaves nothing behind.
    expect((await readdir(dir)).sort()).toEqual(['Locked.zip', 'src'])
    await unpack(out, { password: 'pw' })
    expect(await readFile(join(dir, 'Locked', 'notes.txt'), 'utf8')).toBe('hello '.repeat(50))
  })
})

describe('unpack (the file explorer’s Extract)', () => {
  it('unpacks into a new folder, never over one that’s there', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'a')
    zip.file('b/c.txt', 'c')
    const path = join(dir, 'Stuff.zip')
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
    await mkdir(join(dir, 'Stuff'))
    expect(await unpack(path)).toEqual([join(dir, 'Stuff (2)')])
    expect(await tree(join(dir, 'Stuff (2)'))).toEqual(['a.txt', 'b/', 'b/c.txt'])
  })

  it('doesn’t wrap a zip that’s all one folder in another folder', async () => {
    const zip = new JSZip()
    zip.file('Photos/1.txt', '1')
    zip.file('Photos/2.txt', '2')
    const path = join(dir, 'Photos backup.zip')
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
    expect(await unpack(path)).toEqual([join(dir, 'Photos')])
  })

  it('unpacks “here”, renaming what clashes, and only what’s picked', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'new a')
    zip.file('b/c.txt', 'c')
    zip.file('d.txt', 'd')
    const path = join(dir, 'Stuff.zip')
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
    await writeFile(join(dir, 'a.txt'), 'old a')
    const made = await unpack(path, { intoFolder: false, names: ['a.txt', 'b/'] })
    expect(made.sort()).toEqual([join(dir, 'a (2).txt'), join(dir, 'b')])
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('old a')
    expect(await readdir(dir)).not.toContain('d.txt')
  })

  it('unpacks a RAR with the comic reader’s unrar', async () => {
    const path = join(dir, 'Old.rar')
    await writeFile(path, storedRar([{ name: 'x/y.txt', data: Buffer.from('rar!') }, { name: 'z.txt', data: Buffer.from('z') }]))
    const [folder] = await unpack(path)
    expect(folder).toBe(join(dir, 'Old'))
    expect(await readFile(join(folder, 'x', 'y.txt'), 'utf8')).toBe('rar!')
  })

  it('drops shortcuts (symlinks) that come out of an archive', async () => {
    // 7-Zip keeps links in a 7z when asked (-snl isn't used by Orbit, so make one by hand).
    const src = join(dir, 'linky')
    await mkdir(src)
    await writeFile(join(src, 'real.txt'), 'real')
    await symlink('/etc/hosts', join(src, 'link'))
    // One that points at a file next to it, which 7-Zip itself would let through.
    await symlink('real.txt', join(src, 'inside'))
    const out = join(dir, 'Links.7z')
    const factory = createRequire(__filename)('7z-wasm') as SevenZipFactory
    await runSevenZip(factory, { args: ['a', '-t7z', '-snl', '/o/Links.7z', 'real.txt', 'link', 'inside'], mounts: [{ at: '/o', root: dir }, { at: '/s', root: src }], cwd: '/s' })
    const [folder] = await unpack(out)
    expect(await readdir(folder)).toEqual(['real.txt'])
  })
})

describe('pack (the file explorer’s Compress)', () => {
  it('names a new archive after its one item, or “Archive”, and never over another', async () => {
    const files = await makeFiles()
    const first = await pack([files[2]], 'zip', { name: newArchiveName(['Holiday'], 'zip') })
    expect(first).toBe(join(dir, 'src', 'Holiday.zip'))
    const second = await pack([files[2]], 'zip', { name: newArchiveName(['Holiday'], 'zip') })
    expect(second).toBe(join(dir, 'src', 'Holiday (2).zip'))
    expect(newArchiveName(['a.txt', 'b.txt'], '7z')).toBe('Archive.7z')
    expect(newArchiveName(['notes.txt'], '7z')).toBe('notes.7z')
    expect(newArchiveName(['.env'], 'zip')).toBe('.env.zip')
  })
})

describe('helpers', () => {
  it('names the folder an archive unpacks into', () => {
    expect(archiveFolderName('Holiday photos.zip')).toBe('Holiday photos')
    expect(archiveFolderName('Film.part1.rar')).toBe('Film')
    expect(archiveFolderName('a:b.7z')).toBe('a_b')
    expect(archiveFolderName('.zip')).toBe('Unpacked')
  })

  it('counts files and folders', () => {
    const e = (name: string, isDir = false) => ({ name, isDir, size: 0, packedSize: 0, encrypted: false })
    expect(describeContents([e('a.txt')])).toBe('1 file')
    expect(describeContents([e('x/', true), e('x/a.txt'), e('x/y/b.txt')])).toBe('2 files, 2 folders')
  })

  it('reads 7-Zip’s list', () => {
    const out = 'Listing archive: /a/x.7z\n--\nPath = /a/x.7z\nType = 7z\n\n----------\nPath = d\nSize = 0\nAttributes = D drwxr-xr-x\n\nPath = d/f.txt\nSize = 6\nPacked Size = 13\nEncrypted = +\n'
    expect(parseList(out)).toEqual([
      { name: 'd/', size: 0, packedSize: 0, isDir: true, encrypted: false },
      { name: 'd/f.txt', size: 6, packedSize: 13, isDir: false, encrypted: true }
    ])
  })
})
