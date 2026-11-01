import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { createHash } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { archiveKind, extractRar, listArchive, ZipArchive } from './archive'
import { readPrintedText } from './handwriting'
import { logError } from './log'
import {
  comicDay,
  comicTitle,
  DEFAULT_COMIC_SETTINGS,
  detectChapters,
  imageSize,
  isComicFile,
  isPageImage,
  sortPages,
  syncKey,
  type ComicBook,
  type ComicChapter,
  type ComicOpened,
  type ComicPage,
  type ComicProgress,
  type ComicSettings,
  type ComicShelf,
  type ComicShelfItem
} from '@shared/comics'

/**
 * The comic book reader's side of things: the shelf (comics.json in the app's settings folder),
 * reading the pages out of .cbz / .cbr files, the covers, and where you're up to.
 *
 * Zip comics are read a page at a time, straight from the file. RAR comics can't be, so the first
 * time one's opened its pages are unpacked into the app's settings folder (only the last few
 * comics you read are kept unpacked, so it doesn't fill the disk). Your comics are never changed.
 *
 * Progress and how you like to read each comic are kept by the file's name and size rather than
 * where it is, so they'll carry over to another computer once Orbit syncs its settings.
 */

interface Stored {
  books: Record<string, ComicBook>
  /** By syncKey. */
  progress: Record<string, ComicProgress>
  /** By syncKey. */
  settings: Record<string, ComicSettings>
  /** Pages turned on each day ("2026-10-31"). */
  daily: Record<string, number>
}

/** Kept beside each comic's unpacked pages, so a changed file is noticed. */
interface PageIndex {
  size: number
  modified: number
  pages: ComicPage[]
  foundChapters: ComicChapter[]
  /** RAR: the file each page was unpacked to. */
  files?: string[]
  /** RAR: how much space the unpacked pages take. */
  bytes?: number
}

/** Keep at most this many RAR comics unpacked, and this much space. */
const KEEP_UNPACKED = 6
const KEEP_BYTES = 8 * 1024 ** 3

let stored: Stored | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
const root = (): string => join(app.getPath('userData'), 'comics')
const storeFile = (): string => join(app.getPath('userData'), 'comics.json')
const bookDir = (id: string): string => join(root(), id)

function load(): Stored {
  if (stored) return stored
  try {
    const s = JSON.parse(readFileSync(storeFile(), 'utf8'))
    const obj = <T>(v: unknown): Record<string, T> => (v && typeof v === 'object' ? (v as Record<string, T>) : {})
    stored = { books: obj(s.books), progress: obj(s.progress), settings: obj(s.settings), daily: obj(s.daily) }
  } catch {
    stored = { books: {}, progress: {}, settings: {}, daily: {} }
  }
  return stored
}

function saveNow(): void {
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    const file = storeFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(load()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving the comic shelf', err)
  }
}

/** Page turns come thick and fast; write a second after the last one. */
function saveSoon(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 1000)
}

const keyOf = (b: ComicBook): string => syncKey(b.fileName, b.size)
const idOf = (path: string): string => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)

function settingsOf(b: ComicBook): ComicSettings {
  return { ...DEFAULT_COMIC_SETTINGS, ...(load().settings[keyOf(b)] ?? {}) }
}

function shelfItem(b: ComicBook): ComicShelfItem {
  return { ...b, progress: load().progress[keyOf(b)] ?? null, settings: settingsOf(b) }
}

function shelf(): ComicShelf {
  const s = load()
  return { books: Object.values(s.books).map(shelfItem), pagesToday: s.daily[comicDay(new Date())] ?? 0 }
}

function changed(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('comics:changed')
}

function book(id: unknown): ComicBook {
  const b = typeof id === 'string' ? load().books[id] : undefined
  if (!b) throw new Error('That comic isn’t on the shelf any more.')
  return b
}

// ---- adding ----

async function addFile(path: string): Promise<ComicBook | null> {
  const s = load()
  const id = idOf(path)
  if (s.books[id]) return s.books[id]
  const info = await stat(path)
  if (!info.isFile()) return null
  const kind = await archiveKind(path)
  if (kind !== 'zip' && kind !== 'rar') return null
  const fileName = basename(path)
  const b: ComicBook = { id, path, fileName, title: comicTitle(fileName), size: info.size, modified: info.mtimeMs, kind, pageCount: 0, added: Date.now(), lastRead: 0, hasCover: false }
  s.books[id] = b
  return b
}

/** Comics in a folder and the folders inside it (not too deep, and not for ever). */
async function findComics(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 6 || out.length >= 2000) return out
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await findComics(full, depth + 1, out)
    else if (isComicFile(e.name)) out.push(full)
  }
  return out
}

async function add(paths: string[]): Promise<{ shelf: ComicShelf; added: string[]; skipped: number }> {
  const added: string[] = []
  let skipped = 0
  for (const path of paths) {
    try {
      const b = await addFile(path)
      if (b) added.push(b.id)
      else skipped++
    } catch (err) {
      logError('adding a comic', err)
      skipped++
    }
  }
  saveNow()
  void makeCovers()
  return { shelf: shelf(), added, skipped }
}

// ---- covers ----

let makingCovers = false

async function firstPageBytes(b: ComicBook): Promise<Buffer | null> {
  const names = sortPages((await listArchive(b.path)).filter((e) => !e.isDir && !e.encrypted && isPageImage(e.name)).map((e) => e.name))
  if (!names.length) return null
  if (b.kind === 'zip') {
    const zip = await ZipArchive.open(b.path)
    try {
      return await zip.read(names[0])
    } finally {
      await zip.close()
    }
  }
  const dir = join(bookDir(b.id), 'cover-tmp')
  await rm(dir, { recursive: true, force: true })
  await extractRar(b.path, dir, { only: (n) => n === names[0], rename: () => `first${extname(names[0])}` })
  try {
    return await readFile(join(dir, `first${extname(names[0])}`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Makes the covers that are missing, one at a time, in the background. */
async function makeCovers(): Promise<void> {
  if (makingCovers) return
  makingCovers = true
  try {
    for (;;) {
      const b = Object.values(load().books).find((x) => !x.hasCover && !x.missing && !coverFailed.has(x.id))
      if (!b) break
      try {
        const bytes = await firstPageBytes(b)
        if (!bytes) throw new Error('no pictures')
        const img = nativeImage.createFromBuffer(bytes)
        // Pictures Electron can't shrink (WebP, say) are kept as they are; the window can show them.
        const out = img.isEmpty() ? bytes : img.resize({ width: Math.min(480, img.getSize().width), quality: 'good' }).toJPEG(85)
        await mkdir(bookDir(b.id), { recursive: true })
        await writeFile(join(bookDir(b.id), 'cover.jpg'), out)
        if (load().books[b.id]) load().books[b.id].hasCover = true
        saveSoon()
        changed()
      } catch (err) {
        logError(`making a cover for ${b.fileName}`, err)
        coverFailed.add(b.id)
      }
    }
  } finally {
    makingCovers = false
  }
}
const coverFailed = new Set<string>()

// ---- opening ----

const opening = new Map<string, Promise<ComicOpened>>()
const indexes = new Map<string, PageIndex>()
/** Zip comics being read, kept open (the last few). */
const zips = new Map<string, Promise<ZipArchive>>()

const HEAD_BYTES = 256 * 1024

async function sizeOfFile(path: string): Promise<{ w: number; h: number }> {
  const file = await open(path, 'r')
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await file.read(head, 0, HEAD_BYTES, 0)
    return imageSize(head.subarray(0, bytesRead)) ?? { w: 0, h: 0 }
  } finally {
    await file.close()
  }
}

function zipOf(b: ComicBook): Promise<ZipArchive> {
  let z = zips.get(b.id)
  if (!z) {
    z = ZipArchive.open(b.path)
    z.catch(() => zips.delete(b.id))
    zips.set(b.id, z)
    // Keep three open at most.
    while (zips.size > 3) {
      const [oldId, oldZip] = zips.entries().next().value as [string, Promise<ZipArchive>]
      zips.delete(oldId)
      void oldZip.then((x) => x.close()).catch(() => undefined)
    }
  }
  return z
}

async function readIndex(b: ComicBook): Promise<PageIndex | null> {
  const cached = indexes.get(b.id)
  const fresh = (i: PageIndex | null | undefined): i is PageIndex => !!i && i.size === b.size && i.modified === b.modified
  if (fresh(cached)) return cached
  try {
    const i = JSON.parse(await readFile(join(bookDir(b.id), 'pages.json'), 'utf8')) as PageIndex
    if (!fresh(i)) return null
    // An unpacked RAR whose pages have been cleared away to save space needs unpacking again.
    if (b.kind === 'rar' && !(await stat(join(bookDir(b.id), 'pages')).catch(() => null))) return null
    indexes.set(b.id, i)
    return i
  } catch {
    return null
  }
}

function sendPreparing(id: string, done: number, total: number): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('comics:preparing', { id, done, total })
}

async function buildIndex(b: ComicBook): Promise<PageIndex> {
  const names = sortPages((await listArchive(b.path)).filter((e) => !e.isDir && !e.encrypted && isPageImage(e.name)).map((e) => e.name))
  if (!names.length) throw new Error('There are no pages in this comic (no pictures inside it).')
  const dir = bookDir(b.id)
  await mkdir(dir, { recursive: true })
  const pages: ComicPage[] = []
  let files: string[] | undefined
  let bytes: number | undefined

  if (b.kind === 'zip') {
    const zip = await zipOf(b)
    for (let i = 0; i < names.length; i++) {
      // Only the start of each picture is needed for its size; reading the whole page is simplest.
      const data = await zip.read(names[i]).catch(() => null)
      const size = data ? (imageSize(data.subarray(0, HEAD_BYTES)) ?? { w: 0, h: 0 }) : { w: 0, h: 0 }
      pages.push({ name: names[i], ...size })
      if (i % 20 === 0) sendPreparing(b.id, i, names.length)
    }
  } else {
    const order = new Map(names.map((n, i) => [n, i]))
    const fileFor = (n: string): string => `${String(order.get(n) ?? 0).padStart(5, '0')}${extname(n).toLowerCase()}`
    const out = join(dir, 'pages')
    await rm(out, { recursive: true, force: true })
    await extractRar(b.path, out, {
      only: (n) => order.has(n),
      rename: fileFor,
      onFile: (_n, done, total) => done % 5 === 0 && sendPreparing(b.id, done, total)
    })
    files = names.map(fileFor)
    bytes = 0
    for (let i = 0; i < names.length; i++) {
      const path = join(out, files[i])
      const size = await sizeOfFile(path).catch(() => ({ w: 0, h: 0 }))
      bytes += (await stat(path).catch(() => ({ size: 0 }))).size
      pages.push({ name: names[i], ...size })
    }
    await tidyUnpacked(b.id)
  }
  sendPreparing(b.id, names.length, names.length)
  const index: PageIndex = { size: b.size, modified: b.modified, pages, foundChapters: detectChapters(names), files, bytes }
  await writeFile(join(dir, 'pages.json'), JSON.stringify(index))
  indexes.set(b.id, index)
  return index
}

/** Keeps the last few RAR comics read unpacked, and clears the rest away. */
async function tidyUnpacked(keep: string): Promise<void> {
  const rars = Object.values(load().books)
    .filter((b) => b.kind === 'rar' && b.id !== keep)
    .sort((a, b) => b.lastRead - a.lastRead)
  let total = indexes.get(keep)?.bytes ?? 0
  let count = 1
  for (const b of rars) {
    const pagesDir = join(bookDir(b.id), 'pages')
    if (!(await stat(pagesDir).catch(() => null))) continue
    let bytes = 0
    try {
      bytes = (JSON.parse(await readFile(join(bookDir(b.id), 'pages.json'), 'utf8')) as PageIndex).bytes ?? 0
    } catch {
      // No index: clear it.
    }
    count++
    total += bytes
    if (count > KEEP_UNPACKED || total > KEEP_BYTES || !bytes) {
      await rm(pagesDir, { recursive: true, force: true }).catch(() => undefined)
      indexes.delete(b.id)
    }
  }
}

async function openComic(id: string): Promise<ComicOpened> {
  const b = book(id)
  const info = await stat(b.path).catch(() => null)
  if (!info) {
    b.missing = true
    saveSoon()
    changed()
    throw new Error(`Can’t find “${b.fileName}”. It may have been moved, or be on a drive that isn’t plugged in.`)
  }
  if (b.missing) b.missing = false
  // A replaced file: start again (the progress for the old one is kept under its old size).
  if (info.size !== b.size || Math.round(info.mtimeMs) !== Math.round(b.modified)) {
    b.size = info.size
    b.modified = info.mtimeMs
    b.kind = ((await archiveKind(b.path)) as ComicBook['kind']) ?? b.kind
    indexes.delete(b.id)
    zips.delete(b.id)
  }
  const index = (await readIndex(b)) ?? (await buildIndex(b))
  b.pageCount = index.pages.length
  b.lastRead = Date.now()
  saveSoon()
  return { book: shelfItem(b), pages: index.pages, foundChapters: index.foundChapters }
}

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif' }

const picture = (data: Buffer, ext: string): Response =>
  new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': TYPES[ext.toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'max-age=3600',
      // The reader draws pages onto a canvas (panel zoom, scanning text), which needs this.
      'Access-Control-Allow-Origin': '*'
    }
  })

/** vault://comic/<id>/<page> and vault://comiccover/<id>. */
export async function comicResponse(url: URL): Promise<Response> {
  const [id, n] = url.pathname.slice(1).split('/')
  const b = load().books[id]
  if (!b) return new Response('Not found', { status: 404 })
  if (url.host === 'comiccover') {
    const data = await readFile(join(bookDir(id), 'cover.jpg')).catch(() => null)
    return data ? picture(data, '.jpg') : new Response('No cover', { status: 404 })
  }
  const index = await readIndex(b)
  const page = index?.pages[Number(n)]
  if (!index || !page) return new Response('Not found', { status: 404 })
  const ext = extname(page.name)
  if (b.kind === 'zip') return picture(await (await zipOf(b)).read(page.name), ext)
  const file = index.files?.[Number(n)]
  const data = file ? await readFile(join(bookDir(id), 'pages', file)).catch(() => null) : null
  return data ? picture(data, ext) : new Response('Not found', { status: 404 })
}

// ---- setup ----

export function setupComics(): void {
  ipcMain.handle('comics:shelf', () => {
    void makeCovers()
    return shelf()
  })
  ipcMain.handle('comics:add', async (event, paths?: string[]) => {
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : null
    if (!list) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        title: 'Add comics',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Comics (.cbz, .cbr)', extensions: ['cbz', 'cbr', 'zip', 'rar'] }]
      })
      if (result.canceled) return { shelf: shelf(), added: [], skipped: 0 }
      list = result.filePaths
    }
    return add(list)
  })
  ipcMain.handle('comics:addFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { title: 'Add a folder of comics', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { shelf: shelf(), added: [], skipped: 0 }
    return add(await findComics(result.filePaths[0]))
  })
  ipcMain.handle('comics:remove', async (_e, id: string) => {
    const b = book(id)
    delete load().books[b.id]
    indexes.delete(b.id)
    void zips.get(b.id)?.then((z) => z.close()).catch(() => undefined)
    zips.delete(b.id)
    await rm(bookDir(b.id), { recursive: true, force: true }).catch(() => undefined)
    // Where you were up to is kept, so adding it back carries on from there.
    saveNow()
    return shelf()
  })
  ipcMain.handle('comics:open', (_e, id: string) => {
    let p = opening.get(id)
    if (!p) {
      p = openComic(id).finally(() => opening.delete(id))
      opening.set(id, p)
    }
    return p
  })
  ipcMain.handle('comics:progress', (_e, id: string, page: number, offset: number, finished?: boolean) => {
    const b = book(id)
    const prev = load().progress[keyOf(b)]
    const p = Math.max(0, Math.min(Math.floor(Number(page) || 0), Math.max(0, b.pageCount - 1)))
    load().progress[keyOf(b)] = {
      page: p,
      offset: Math.max(0, Math.min(1, Number(offset) || 0)),
      updated: Date.now(),
      finished: finished ?? (prev?.finished || (b.pageCount > 0 && p >= b.pageCount - 1))
    }
    b.lastRead = Date.now()
    saveSoon()
  })
  ipcMain.handle('comics:resetProgress', (_e, id: string) => {
    delete load().progress[keyOf(book(id))]
    saveNow()
    return shelf()
  })
  ipcMain.handle('comics:turned', (_e, pages: number) => {
    const day = comicDay(new Date())
    const s = load()
    s.daily[day] = (s.daily[day] ?? 0) + Math.max(0, Math.min(50, Math.floor(Number(pages) || 0)))
    // Only the last couple of months are worth keeping.
    for (const d of Object.keys(s.daily).sort().slice(0, -60)) delete s.daily[d]
    saveSoon()
    return s.daily[day]
  })
  ipcMain.handle('comics:settings', (_e, id: string, patch: Partial<ComicSettings>) => {
    const b = book(id)
    const next = { ...settingsOf(b), ...(patch && typeof patch === 'object' ? patch : {}) }
    load().settings[keyOf(b)] = next
    saveSoon()
    return next
  })
  ipcMain.handle('comics:rename', (_e, id: string, title: string) => {
    const b = book(id)
    b.title = String(title).trim().slice(0, 200) || comicTitle(b.fileName)
    saveNow()
    return shelf()
  })
  ipcMain.handle('comics:reveal', (_e, id: string) => shell.showItemInFolder(book(id).path))
  ipcMain.handle('comics:readText', async (_e, png: Uint8Array) => (await readPrintedText(png)).replace(/[ \t]+\n/g, '\n').trim())
  app.on('will-quit', () => {
    if (saveTimer) saveNow()
  })
}
