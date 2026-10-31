import { describe, expect, it } from 'vitest'
import { archiveKindOf, archiveKindOfName, safeRelative } from './archive'
import {
  chapterAt,
  comicTitle,
  detectChapters,
  imageSize,
  isComicFile,
  isPageImage,
  markChapter,
  percentRead,
  sortPages,
  spreads,
  syncKey,
  viewOf,
  type ComicPage
} from './comics'

const page = (w = 1000, h = 1500): ComicPage => ({ name: 'p.jpg', w, h })

describe('archives', () => {
  it('tells a zip from a RAR by its first bytes, whatever the name says', () => {
    expect(archiveKindOf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('zip')
    expect(archiveKindOf(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).toBe('rar')
    expect(archiveKindOf(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z')
    expect(archiveKindOf(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(archiveKindOfName('Comic.CBR')).toBe('rar')
    expect(archiveKindOfName('Comic.cbz')).toBe('zip')
  })

  it('never lets a name inside an archive escape the folder it goes in', () => {
    expect(safeRelative('../../etc/passwd')).toBe('etc/passwd')
    expect(safeRelative('/abs/file.jpg')).toBe('abs/file.jpg')
    expect(safeRelative('C:\\Windows\\evil.dll')).toBe('C_/Windows/evil.dll')
    expect(safeRelative('Issue 1/./page?.jpg')).toBe('Issue 1/page_.jpg')
    expect(safeRelative('con.txt')).toBe('_con.txt')
    expect(safeRelative('..')).toBe('')
  })
})

describe('comic files', () => {
  it('knows comics and pages', () => {
    expect(isComicFile('Walking Dead.cbr')).toBe(true)
    expect(isComicFile('x.cbz')).toBe(true)
    expect(isComicFile('x.pdf')).toBe(false)
    expect(isPageImage('Issue 1/001.jpg')).toBe(true)
    expect(isPageImage('__MACOSX/Issue 1/._001.jpg')).toBe(false)
    expect(isPageImage('._001.jpg')).toBe(false)
    expect(isPageImage('ComicInfo.xml')).toBe(false)
    expect(isPageImage('Thumbs.db')).toBe(false)
  })

  it('sorts pages the way people count, folder by folder', () => {
    expect(sortPages(['p10.jpg', 'p2.jpg', 'p1.jpg'])).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg'])
    expect(sortPages(['Issue 10/01.jpg', 'Issue 2/01.jpg', 'Issue 2/02.jpg', 'cover.jpg'])).toEqual(['cover.jpg', 'Issue 2/01.jpg', 'Issue 2/02.jpg', 'Issue 10/01.jpg'])
  })

  it('makes tidy titles and keys progress by name and size', () => {
    expect(comicTitle('The_Walking_Dead_Compendium_01 (2009) (Digital) (Zone-Empire).cbr')).toBe('The Walking Dead Compendium 01')
    expect(comicTitle('C:\\Comics\\Saga #1 [HD].cbz')).toBe('Saga #1')
    expect(comicTitle('(2009).cbz')).toBe('(2009)')
    expect(syncKey('C:\\Comics\\Saga.CBZ', 123)).toBe('saga.cbz|123')
    expect(syncKey('/Users/me/Saga.cbz', 123)).toBe('saga.cbz|123')
  })
})

describe('issues and chapters', () => {
  it('uses folders when the pages are in folders', () => {
    const pages = sortPages(['TWD/Issue 001/01.jpg', 'TWD/Issue 001/02.jpg', 'TWD/Issue_002/01.jpg', 'TWD/Issue_002/02.jpg', 'TWD/Issue 003/01.jpg'])
    expect(detectChapters(pages)).toEqual([
      { title: 'Issue 001', page: 0 },
      { title: 'Issue 002', page: 2 },
      { title: 'Issue 003', page: 4 }
    ])
  })

  it('calls the pages beside the issue folders the start', () => {
    const pages = sortPages(['TWD/Issue 01/01.jpg', 'TWD/cover.jpg', 'TWD/Issue 02/01.jpg'])
    expect(detectChapters(pages).map((c) => c.title)).toEqual(['Start', 'Issue 01', 'Issue 02'])
  })

  it('finds issue numbers in flat file names', () => {
    const pages: string[] = []
    for (const issue of [1, 2, 3]) for (let p = 1; p <= 22; p++) pages.push(`Walking Dead ${String(issue).padStart(3, '0')} - ${String(p).padStart(2, '0')}.jpg`)
    const found = detectChapters(['00 cover.jpg', ...pages])
    expect(found.map((c) => c.title)).toEqual(['Start', 'Issue 1', 'Issue 2', 'Issue 3'])
    expect(found.map((c) => c.page)).toEqual([0, 1, 23, 45])
  })

  it('calls them chapters when the names do', () => {
    const pages = ['c001p01.png', 'c001p02.png', 'c001p03.png', 'c002p01.png', 'c002p02.png', 'c002p03.png']
    expect(detectChapters(pages).map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('finds nothing when the names are just page numbers', () => {
    expect(detectChapters(['TWD_Comp1_001.jpg', 'TWD_Comp1_002.jpg', 'TWD_Comp1_003.jpg', 'TWD_Comp1_004.jpg'])).toEqual([])
    expect(detectChapters(['1.jpg', '2.jpg', '3.jpg'])).toEqual([])
  })

  it('marks your own chapters and knows which one a page is in', () => {
    let marks = markChapter([], 10, 'Issue 2')
    marks = markChapter(marks, 0, 'Issue 1')
    marks = markChapter(marks, 10, 'Issue two')
    expect(marks).toEqual([
      { title: 'Issue 1', page: 0 },
      { title: 'Issue two', page: 10 }
    ])
    expect(chapterAt(marks, 5)).toBe(0)
    expect(chapterAt(marks, 10)).toBe(1)
    expect(chapterAt([], 3)).toBe(-1)
  })
})

describe('reading', () => {
  it('pairs pages into spreads, with the cover and wide pages on their own', () => {
    const pages = [page(), page(), page(), page(3000, 1500), page(), page()]
    expect(spreads(pages, true)).toEqual([[0], [1, 2], [3], [4, 5]])
    expect(spreads(pages, false)).toEqual([[0, 1], [2], [3], [4, 5]])
    expect(viewOf(spreads(pages, true), 2)).toBe(1)
    expect(viewOf(spreads(pages, true), 5)).toBe(3)
  })

  it('works out how far through you are', () => {
    expect(percentRead(null, 100)).toBe(0)
    expect(percentRead({ page: 49, offset: 0, updated: 0, finished: false }, 100)).toBe(50)
    expect(percentRead({ page: 1, offset: 0, updated: 0, finished: true }, 100)).toBe(100)
  })
})

describe('picture sizes', () => {
  const bytes = (...parts: (number[] | string)[]): Uint8Array =>
    new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(new Array(40).fill(0)))

  it('reads PNG, GIF and BMP sizes', () => {
    expect(imageSize(bytes([0x89], 'PNG', [13, 10, 26, 10, 0, 0, 0, 13], 'IHDR', [0, 0, 7, 128, 0, 0, 11, 184]))).toEqual({ w: 1920, h: 3000 })
    expect(imageSize(bytes('GIF89a', [0x20, 0x03, 0x58, 0x02]))).toEqual({ w: 800, h: 600 })
    expect(imageSize(bytes('BM', new Array(16).fill(0), [100, 0, 0, 0, 0x38, 0xff, 0xff, 0xff]))).toEqual({ w: 100, h: 200 })
  })

  it('walks JPEG markers to the size', () => {
    // SOI, an APP0 segment of 16 bytes, then SOF0 with height 2400 and width 1600.
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)]
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x09, 0x60, 0x06, 0x40, 0x03]
    expect(imageSize(bytes([0xff, 0xd8], app0, sof))).toEqual({ w: 1600, h: 2400 })
  })

  it('reads WebP sizes', () => {
    // VP8X: canvas size minus one, 24-bit little endian.
    expect(imageSize(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, 0, 0, 0, 0], [0x7f, 0x07, 0x00, 0xb7, 0x0b, 0x00]))).toEqual({ w: 1920, h: 3000 })
  })

  it('gives up on anything else', () => {
    expect(imageSize(bytes('hello world, not a picture'))).toBeNull()
  })
})
