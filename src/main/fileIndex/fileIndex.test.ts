import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileIndex, lowerSameLength } from './core'
import { IndexService } from './service'
import { isHiddenFile, skipDirFor } from './rules'
import { isHiddenName } from '@shared/explorer'
import { rootsFor } from './roots'

let root: string
const make = (rel: string, text = 'x'): void => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}
const skipDir = skipDirFor(process.platform, '/nowhere')
const names = (hits: { path: string }[]): string[] => hits.map((h) => h.path.slice(root.length + 1).split(sep).join('/'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orbit-index-'))
  make('Documents/School/Maths homework.docx')
  make('Documents/School/History essay.docx')
  make('Documents/Taxes 2026.pdf')
  make('Pictures/Holiday/beach.jpg')
  make('Pictures/Holiday/BEACH sunset.png')
  make('Music/skyblock theme.mp3')
  make('code/app/node_modules/left-pad/index.js')
  make('code/app/.git/HEAD')
  make('.hidden-notes.txt')
  mkdirSync(join(root, 'Empty folder'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function built(): Promise<FileIndex> {
  const index = new FileIndex(sep)
  await index.build([root], { skipDir })
  return index
}

describe('FileIndex', () => {
  it('finds names containing every word, ignoring capitals', async () => {
    const index = await built()
    expect(names(index.search('beach', { limit: 50, showHidden: false })).sort()).toEqual(['Pictures/Holiday/BEACH sunset.png', 'Pictures/Holiday/beach.jpg'])
    expect(names(index.search('sunset beach', { limit: 50, showHidden: false }))).toEqual(['Pictures/Holiday/BEACH sunset.png'])
    expect(names(index.search('school', { limit: 50, showHidden: false }))).toEqual(['Documents/School'])
    expect(index.search('nothing-like-this', { limit: 50, showHidden: false })).toEqual([])
  })

  it('knows folders from files', async () => {
    const index = await built()
    expect(index.search('empty folder', { limit: 5, showHidden: false })).toEqual([{ path: join(root, 'Empty folder'), isDir: true }])
    expect(index.search('taxes', { limit: 5, showHidden: false })[0].isDir).toBe(false)
  })

  it('leaves out node_modules and dot folders, and hidden files unless asked', async () => {
    const index = await built()
    expect(index.search('left-pad', { limit: 5, showHidden: true })).toEqual([])
    expect(index.search('HEAD', { limit: 5, showHidden: true })).toEqual([])
    expect(index.search('hidden-notes', { limit: 5, showHidden: false })).toEqual([])
    expect(names(index.search('hidden-notes', { limit: 5, showHidden: true }))).toEqual(['.hidden-notes.txt'])
  })

  it('puts whole-name and start-of-name matches first', async () => {
    make('Archive/old beach photos backup/x.txt')
    make('beach')
    const index = await built()
    const hits = names(index.search('beach', { limit: 10, showHidden: false }))
    expect(hits[0]).toBe('beach')
    expect(hits.indexOf('Pictures/Holiday/beach.jpg')).toBeLessThan(hits.indexOf('Archive/old beach photos backup'))
  })

  it('searches only inside a folder for Subfolders search', async () => {
    const index = await built()
    expect(names(index.search('docx', { limit: 10, showHidden: false, under: join(root, 'Documents', 'School') })).sort()).toEqual([
      'Documents/School/History essay.docx',
      'Documents/School/Maths homework.docx'
    ])
    expect(index.search('beach', { limit: 10, showHidden: false, under: join(root, 'Documents') })).toEqual([])
    expect(index.covers(join(root, 'Documents'))).toBe(true)
    expect(index.covers(join(root, 'code', 'app', 'node_modules'))).toBe(false)
  })

  it('catches up with a folder that changed', async () => {
    const index = await built()
    make('Documents/School/Science notes.txt')
    rmSync(join(root, 'Documents', 'Taxes 2026.pdf'))
    renameSync(join(root, 'Pictures', 'Holiday'), join(root, 'Pictures', 'Greece 2026'))
    await index.refreshDir(join(root, 'Documents', 'School'), { skipDir })
    await index.refreshDir(join(root, 'Documents'), { skipDir })
    await index.refreshDir(join(root, 'Pictures'), { skipDir })
    expect(names(index.search('science', { limit: 5, showHidden: false }))).toEqual(['Documents/School/Science notes.txt'])
    expect(index.search('taxes', { limit: 5, showHidden: false })).toEqual([])
    expect(names(index.search('beach.jpg', { limit: 5, showHidden: false }))).toEqual(['Pictures/Greece 2026/beach.jpg'])
    // Packing the new ones in changes nothing that's found.
    index.freeze()
    expect(names(index.search('beach.jpg', { limit: 5, showHidden: false }))).toEqual(['Pictures/Greece 2026/beach.jpg'])
    expect(index.search('holiday', { limit: 5, showHidden: false })).toEqual([])
  })

  it('saves and loads', async () => {
    const index = await built()
    const again = FileIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())))!
    expect(again.count).toBe(index.count)
    expect(names(again.search('skyblock', { limit: 5, showHidden: false }))).toEqual(['Music/skyblock theme.mp3'])
    expect(FileIndex.fromJSON({ v: 2 })).toBeNull()
  })

  it('copes with letters that change length when lowercased', () => {
    expect(lowerSameLength('İstanbul Trip')).toHaveLength('İstanbul Trip'.length)
    expect(lowerSameLength('ABC')).toBe('abc')
  })

  it('searches a big list quickly', async () => {
    const index = new FileIndex(sep)
    // 300,000 made-up names, without touching the disk.
    const data = { v: 1, sep, roots: [root], builtAt: Date.now(), text: '', parents: [] as number[], flags: [] as number[] }
    const lines = [root]
    data.parents.push(-1)
    data.flags.push(1)
    for (let i = 1; i < 300_000; i++) {
      lines.push(i % 1000 === 0 ? `folder ${i}` : `file number ${i} report.txt`)
      data.parents.push(i % 1000 === 0 ? 0 : i - (i % 1000) || 0)
      data.flags.push(i % 1000 === 0 ? 1 : 0)
    }
    data.text = `${lines.join('\n')}\n`
    const big = FileIndex.fromJSON(data)!
    expect(big.count).toBe(300_000)
    const t = performance.now()
    const hits = big.search('number 123456', { limit: 300, showHidden: false })
    const took = performance.now() - t
    expect(hits.map((h) => h.path.split(sep).pop())).toContain('file number 123456 report.txt')
    expect(took).toBeLessThan(500)
    void index
  })
})

describe('Whole PC roots and rules', () => {
  it('lists every drive on Windows, and the home folder, Applications and other drives on a Mac', () => {
    expect(rootsFor('win32', 'C:\\Users\\me', ['C:\\', 'D:\\'])).toEqual(['C:\\', 'D:\\'])
    expect(rootsFor('darwin', '/Users/me', ['/', '/Volumes/USB'])).toEqual(['/Users/me', '/Applications', '/Volumes/USB'])
  })

  it('hides the same files as the explorer does', () => {
    for (const n of ['.git', 'desktop.ini', 'Thumbs.db', '~$report.docx', 'NTUSER.DAT.LOG1', 'Icon\r', 'notes.txt', 'My .hidden thing']) expect(isHiddenFile(n)).toBe(isHiddenName(n))
  })

  it('leaves out the system’s own folders', () => {
    const win = skipDirFor('win32', 'C:\\Users\\me')
    expect(win('windows', 'C:\\', 1)).toBe(true)
    expect(win('windows', 'C:\\Users\\me\\Documents', 4)).toBe(false)
    expect(win('appdata', 'C:\\Users\\me', 3)).toBe(true)
    expect(win('program files', 'C:\\', 1)).toBe(false)
    const mac = skipDirFor('darwin', '/Users/me')
    expect(mac('library', '/Users/me', 1)).toBe(true)
    expect(mac('library', '/Users/me/Documents', 2)).toBe(false)
  })
})

describe('IndexService', () => {
  it('builds, then picks up new and deleted files as they happen', async () => {
    const statuses: string[] = []
    const service = new IndexService({ roots: [root], home: root, platform: process.platform, savePath: join(root, '..', `${root.split(sep).pop()}-index.json.gz`), onStatus: (s) => statuses.push(s.state), settleMs: 50 })
    await service.start()
    expect(statuses.at(-1)).toBe('ready')
    expect(service.search('maths', { limit: 5, showHidden: false })?.length).toBe(1)
    make('Documents/brand new plan.txt')
    rmSync(join(root, 'Music', 'skyblock theme.mp3'))
    // The watcher hears about it; give it a moment, then apply.
    for (let i = 0; i < 40 && !service.search('brand new', { limit: 5, showHidden: false })?.length; i++) {
      await new Promise((r) => setTimeout(r, 100))
      await service.settled()
    }
    expect(names(service.search('brand new', { limit: 5, showHidden: false }) ?? [])).toEqual(['Documents/brand new plan.txt'])
    expect(service.search('skyblock', { limit: 5, showHidden: false })).toEqual([])
    // Orbit telling it directly works too (no waiting for the system).
    make('Pictures/told directly.png')
    service.touched([join(root, 'Pictures')])
    await service.settled()
    expect(service.search('told directly', { limit: 5, showHidden: false })?.length).toBe(1)
    await service.save()
    service.stop()

    // Next launch: the saved list answers straight away.
    const next = new IndexService({ roots: [root], home: root, platform: process.platform, savePath: join(root, '..', `${root.split(sep).pop()}-index.json.gz`), onStatus: () => undefined })
    await next.start()
    expect(next.search('told directly', { limit: 5, showHidden: false })?.length).toBe(1)
    next.stop()
    rmSync(join(root, '..', `${root.split(sep).pop()}-index.json.gz`), { force: true })
  })

  it('says when a folder isn’t in the list, so the explorer can walk it instead', async () => {
    const service = new IndexService({ roots: [join(root, 'Documents')], home: root, platform: process.platform, savePath: null, onStatus: () => undefined })
    await service.start()
    expect(service.search('beach', { limit: 5, showHidden: false, under: join(root, 'Pictures') })).toBeNull()
    expect(service.search('maths', { limit: 5, showHidden: false, under: join(root, 'Documents') })?.length).toBe(1)
    service.stop()
  })
})
