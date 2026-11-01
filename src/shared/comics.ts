import type { ArchiveKind } from './archive'

/**
 * The comic book reader: a shelf of .cbz / .cbr comics (zips and RARs of page pictures), read a
 * page, a two-page spread or a long scroll at a time. The main process keeps the shelf and reads
 * the files (main/comics.ts); these are the parts both sides share.
 */

/** A comic on the shelf. */
export interface ComicBook {
  id: string
  /** Where the file is on this computer. */
  path: string
  /** Its file name ("The Walking Dead Compendium 1.cbr"). */
  fileName: string
  title: string
  size: number
  /** When the file last changed (ms), to notice it's been replaced. */
  modified: number
  kind: ArchiveKind
  /** 0 until it's been opened once. */
  pageCount: number
  added: number
  /** When it was last opened (ms), 0 if never. */
  lastRead: number
  hasCover: boolean
  /** The file has gone (moved, deleted, a drive that isn't plugged in). */
  missing?: boolean
}

/** Where you are in a comic. Kept by file name and size (not path) so it can follow you to another computer. */
export interface ComicProgress {
  /** 0-based page. */
  page: number
  /** How far down that page (0–1), for the long scroll. */
  offset: number
  /** When (ms). */
  updated: number
  finished: boolean
}

export type ComicLayout = 'single' | 'spread' | 'scroll'
export type ComicFit = 'page' | 'width'

export interface ComicPlaylist {
  uri: string
  name: string
}

/** How you like to read one comic. Kept with its progress. */
export interface ComicSettings {
  layout: ComicLayout
  fit: ComicFit
  /** Right to left (manga). */
  rtl: boolean
  /** In two-page spreads, the cover on its own (so left and right pages pair up as printed). */
  coverAlone: boolean
  /** Your own issue / chapter marks; when null, the ones found from the file names are used. */
  chapters: ComicChapter[] | null
  /** The playlist zen mode starts with for this comic, if you chose to remember one. */
  playlist: ComicPlaylist | null
}

export const DEFAULT_COMIC_SETTINGS: ComicSettings = { layout: 'single', fit: 'page', rtl: false, coverAlone: true, chapters: null, playlist: null }

export interface ComicChapter {
  title: string
  /** 0-based page it starts on. */
  page: number
}

export interface ComicPage {
  name: string
  /** Its size in pixels, 0 when it couldn't be read. */
  w: number
  h: number
}

export interface ComicShelfItem extends ComicBook {
  progress: ComicProgress | null
  settings: ComicSettings
}

export interface ComicShelf {
  books: ComicShelfItem[]
  /** Pages turned today, in every comic. */
  pagesToday: number
}

/** A comic ready to read. */
export interface ComicOpened {
  book: ComicShelfItem
  pages: ComicPage[]
  /** The issues / chapters found from the folders or file names inside it. */
  foundChapters: ComicChapter[]
}

/** Opening a RAR comic the first time unpacks it; this says how far along that is. */
export interface ComicPreparing {
  id: string
  done: number
  total: number
}

export const COMIC_EXTENSIONS = ['cbz', 'cbr', 'zip', 'rar'] as const

export const isComicFile = (name: string): boolean => (COMIC_EXTENSIONS as readonly string[]).includes(name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '')

const PAGE_IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif|jfif)$/i

/** A picture that's a page, not a Mac leftover ("__MACOSX/…", "._page.jpg") or a hidden file. */
export function isPageImage(name: string): boolean {
  const parts = name.replace(/\\/g, '/').split('/')
  const file = parts[parts.length - 1]
  return PAGE_IMAGE.test(file) && !file.startsWith('.') && !parts.some((p) => p === '__MACOSX' || p.startsWith('.'))
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Pages the way people count: "page 2" before "page 10", folder by folder. */
export function sortPages(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const pa = a.split('/')
    const pb = b.split('/')
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      // A file comes before a folder beside it (a cover at the top, then the issues).
      const lastA = i === pa.length - 1
      const lastB = i === pb.length - 1
      if (lastA !== lastB) return lastA ? -1 : 1
      const c = collator.compare(pa[i].replace(/_/g, ' '), pb[i].replace(/_/g, ' '))
      if (c) return c
    }
    return pa.length - pb.length
  })
}

/** A tidy title from a file name: "The_Walking_Dead_Compendium_01 (2009) (Digital) (Zone-Empire).cbr" → "The Walking Dead Compendium 01". */
export function comicTitle(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '')
  const plain = base
    .replace(/[_]+/g, ' ')
    .replace(/(\s*[([][^)\]]*[)\]])+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain || base
}

/** What a comic's progress is kept under: its file name and size, the same on every computer. */
export const syncKey = (fileName: string, size: number): string => `${fileName.replace(/^.*[\\/]/, '').toLowerCase()}|${size}`

const cleanFolder = (name: string): string => name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The issues or chapters in a comic, from how its pages are named: one per folder when the pages
 * are in folders, otherwise from a number in the names that changes now and then ("TWD 012 - 05"),
 * not with every page. [] when there's nothing to go on (you can mark them yourself).
 */
export function detectChapters(pages: string[]): ComicChapter[] {
  if (pages.length < 2) return []
  // Folders.
  const dirs = pages.map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))
  const distinct = new Set(dirs)
  if (distinct.size >= 2) {
    const out: ComicChapter[] = []
    dirs.forEach((d, i) => {
      if (i > 0 && d === dirs[i - 1]) return
      // Pages in the folder that holds the issues (a cover at the top) are the start, not an issue.
      const holdsOthers = !d || [...distinct].some((o) => o.startsWith(`${d}/`))
      out.push({ title: holdsOthers ? 'Start' : cleanFolder(d.slice(d.lastIndexOf('/') + 1)), page: i })
    })
    return out
  }

  // Numbers in the file names.
  const files = pages.map((p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, ''))
  const groups = files.map((f) => [...f.matchAll(/\d+/g)].map((m) => ({ value: Number(m[0]), before: f.slice(0, m.index) })))
  const counts = new Map<number, number>()
  for (const g of groups) counts.set(g.length, (counts.get(g.length) ?? 0) + 1)
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  if (usual < 2) return []
  const typical = groups.filter((g) => g.length === usual)
  if (typical.length < pages.length * 0.8) return []

  // The last number is the page; look for one before it that steps up every so often.
  for (let k = 0; k < usual - 1; k++) {
    const values = typical.map((g) => g[k].value)
    const steps = values.filter((v, i) => i > 0 && v !== values[i - 1]).length
    const rising = values.every((v, i) => i === 0 || v >= values[i - 1])
    if (!rising || steps < 1 || steps > pages.length / 3) continue
    const out: ComicChapter[] = []
    let last: number | null = null
    groups.forEach((g, i) => {
      if (g.length !== usual) return
      const { value, before } = g[k]
      if (value === last) return
      last = value
      const word = /(ch|chap|chapter|c)[\s._-]*$/i.test(before) ? 'Chapter' : 'Issue'
      out.push({ title: `${word} ${value}`, page: i })
    })
    // Pages before the first issue (a cover, an introduction) are their own part.
    if (out[0].page > 0) out.unshift({ title: 'Start', page: 0 })
    return out
  }
  return []
}

/** Which chapter a page is in (its index), or -1. */
export function chapterAt(chapters: ComicChapter[], page: number): number {
  let at = -1
  chapters.forEach((c, i) => {
    if (c.page <= page) at = i
  })
  return at
}

/** Adds (or renames) a chapter mark, keeping them in page order. */
export function markChapter(chapters: ComicChapter[], page: number, title: string): ComicChapter[] {
  return [...chapters.filter((c) => c.page !== page), { title: title.trim() || `Part ${chapters.length + 1}`, page }].sort((a, b) => a.page - b.page)
}

/** A page is shown on its own in spreads when it's wider than it is tall (a double-page picture). */
export const isWide = (p: ComicPage): boolean => p.w > 0 && p.h > 0 && p.w > p.h * 1.1

/** The pages shown together in two-page spreads: [[0], [1, 2], [3, 4], [5] (a wide one), …]. */
export function spreads(pages: ComicPage[], coverAlone: boolean): number[][] {
  const views: number[][] = []
  let pending: number | null = null
  pages.forEach((p, i) => {
    if ((i === 0 && coverAlone) || isWide(p)) {
      if (pending !== null) views.push([pending])
      pending = null
      views.push([i])
    } else if (pending === null) pending = i
    else {
      views.push([pending, i])
      pending = null
    }
  })
  if (pending !== null) views.push([pending])
  return views
}

/** The spread a page is in. */
export const viewOf = (views: number[][], page: number): number => Math.max(0, views.findIndex((v) => v.includes(page)))

/** How far through, 0–100. */
export function percentRead(progress: ComicProgress | null, pageCount: number): number {
  if (!progress || pageCount <= 0) return 0
  if (progress.finished) return 100
  return Math.min(100, Math.round(((progress.page + 1) / pageCount) * 100))
}

/** A picture's width and height from its first bytes (JPEG, PNG, GIF, WebP, BMP), or null. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (i: number): number => (b[i] << 8) | b[i + 1]
  const u16le = (i: number): number => b[i] | (b[i + 1] << 8)
  const u24le = (i: number): number => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
  const u32be = (i: number): number => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
  const u32le = (i: number): number => ((b[i + 3] << 24) >>> 0) + (b[i + 2] << 16) + (b[i + 1] << 8) + b[i]
  const text = (i: number, s: string): boolean => [...s].every((c, j) => b[i + j] === c.charCodeAt(0))
  if (b.length < 26) return null
  // PNG
  if (b[0] === 0x89 && text(1, 'PNG')) return { w: u32be(16), h: u32be(20) }
  // GIF
  if (text(0, 'GIF8')) return { w: u16le(6), h: u16le(8) }
  // BMP
  if (text(0, 'BM')) {
    const h = u32le(22) | 0
    return { w: u32le(18) | 0, h: Math.abs(h) }
  }
  // WebP
  if (text(0, 'RIFF') && text(8, 'WEBP')) {
    if (text(12, 'VP8 ')) return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff }
    if (text(12, 'VP8L')) {
      const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]]
      return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
    }
    if (text(12, 'VP8X') && b.length >= 30) return { w: 1 + u24le(24), h: 1 + u24le(27) }
    return null
  }
  // JPEG: walk the markers to the one that gives the size.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: u16be(i + 7), h: u16be(i + 5) }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2
        continue
      }
      i += 2 + u16be(i + 2)
    }
  }
  return null
}

/** "2025-10-31", for counting pages read per day. */
export const comicDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
