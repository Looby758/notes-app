import { app, BrowserWindow, ipcMain, net } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { gunzip, gzip } from 'zlib'
import { promisify } from 'util'
import MiniSearch from 'minisearch'
import { localComplete } from './localAi'
import { logError } from './log'
import { cleanReply, LOCAL_CONTEXT_CHARS } from '@shared/localAi'
import {
  chunkSections,
  citedNumbers,
  DEFAULT_PICTURES,
  findImages,
  htmlToSections,
  imageExtension,
  normaliseTitle,
  pageUrl,
  parseWikiAddress,
  picturesToGet,
  plainTitle,
  searchTerm,
  WIKI_ASK_SYSTEM,
  wikiAskPrompt,
  type StoredWikiPage,
  type WikiAddress,
  type WikiAnswer,
  type WikiCheck,
  type WikiExtract,
  type WikiHit,
  type WikiInfo,
  type WikiPageView,
  type WikiPictureChoice,
  type WikiSource
} from '@shared/wiki'

/**
 * Downloaded wikis. Each is a folder in the app's settings folder (wikis/<id>/), kept on this
 * computer only (they're big, so they aren't shared through the notes folder):
 *   wiki.json    what it is and how far the download got
 *   list.json    every page's id and title, and the redirects ("Rick" → "Rick Grimes")
 *   pages/       one gzipped file per page (its HTML, text in sections, which pictures it has)
 *   img/         the pictures you chose to download
 *   search.json.gz  the search index the wiki brain uses
 *
 * The download uses the wiki's MediaWiki API, one request at a time with a pause between, and
 * picks up where it left off (each finished page is a file, so nothing is downloaded twice).
 * Wiki text goes to the offline AI only, and only when you ask a question.
 */

const zip = promisify(gzip)
const unzip = promisify(gunzip)

/** At least this long between requests to the wiki, and to its picture server. */
const API_GAP_MS = 500
const IMAGE_GAP_MS = 200
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
/** Rebuild the search index when this many more pages have arrived since it was made. */
const REINDEX_AFTER = 200

interface Meta extends Omit<WikiInfo, 'running' | 'done' | 'failed' | 'bytes'> {
  address: WikiAddress
}

interface PageList {
  pages: { id: number; title: string }[]
  redirects: Record<string, string>
  listed: boolean
  apcontinue?: string
  redirected: boolean
  gapcontinue?: string
  failed: number[]
}

interface Loaded {
  meta: Meta
  done: Set<number>
  failed: number
  bytes: number
}

const root = (): string => join(app.getPath('userData'), 'wikis')
const dirOf = (id: string): string => join(root(), id)
const userAgent = (): string => `${app.getName()}/${app.getVersion()} (personal offline wiki reader; one request at a time)`

const wikis = new Map<string, Loaded>()
const jobs = new Map<string, AbortController>()
const lists = new Map<string, PageList>()
const titleMaps = new Map<string, Map<string, number>>()
let loadedAll = false

// ---------- storing ----------

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, file)
}

function loadAll(): void {
  if (loadedAll) return
  loadedAll = true
  if (!existsSync(root())) return
  for (const id of readdirSync(root())) {
    try {
      const meta = JSON.parse(readFileSync(join(dirOf(id), 'wiki.json'), 'utf8')) as Meta
      // A download that was going when Orbit closed waits for you to carry on.
      if (meta.status === 'listing' || meta.status === 'pages' || meta.status === 'indexing') meta.status = 'paused'
      const pages = existsSync(join(dirOf(id), 'pages')) ? readdirSync(join(dirOf(id), 'pages')) : []
      const done = new Set(pages.filter((f) => f.endsWith('.json.gz')).map((f) => Number(f.slice(0, -8))))
      wikis.set(id, { meta, done, failed: 0, bytes: 0 })
      void sizeOf(id)
      void listOf(id).then((l) => {
        const w = wikis.get(id)
        if (w) w.failed = l.failed.length
      })
    } catch (err) {
      logError('wiki', err)
    }
  }
}

async function sizeOf(id: string): Promise<void> {
  let bytes = 0
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(join(dir, e.name))
      else bytes += (await stat(join(dir, e.name)).catch(() => null))?.size ?? 0
    }
  }
  await walk(dirOf(id))
  const w = wikis.get(id)
  if (w) {
    w.bytes = bytes
    tellSoon()
  }
}

const saveMeta = (w: Loaded): Promise<void> => writeJson(join(dirOf(w.meta.id), 'wiki.json'), w.meta)

async function listOf(id: string): Promise<PageList> {
  let l = lists.get(id)
  if (!l) {
    try {
      l = JSON.parse(await readFile(join(dirOf(id), 'list.json'), 'utf8')) as PageList
    } catch {
      l = { pages: [], redirects: {}, listed: false, redirected: false, failed: [] }
    }
    lists.set(id, l)
  }
  return l
}

const saveList = (id: string, l: PageList): Promise<void> => writeJson(join(dirOf(id), 'list.json'), l)

function info(w: Loaded): WikiInfo {
  const { address: _address, ...meta } = w.meta
  return { ...meta, running: jobs.has(w.meta.id), done: w.done.size, failed: w.failed, bytes: w.bytes }
}

export function wikiList(): WikiInfo[] {
  loadAll()
  return [...wikis.values()].map(info).sort((a, b) => a.name.localeCompare(b.name))
}

let tellTimer: ReturnType<typeof setTimeout> | undefined
function tellSoon(): void {
  if (tellTimer) return
  tellTimer = setTimeout(() => {
    tellTimer = undefined
    const list = wikiList()
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('wiki:changed', list)
  }, 400)
}

function wiki(id: string): Loaded {
  loadAll()
  const w = wikis.get(String(id))
  if (!w) throw new Error('That wiki isn’t downloaded.')
  return w
}

async function readPage(id: string, pageId: number): Promise<StoredWikiPage | null> {
  try {
    return JSON.parse((await unzip(await readFile(join(dirOf(id), 'pages', `${pageId}.json.gz`)))).toString('utf8')) as StoredWikiPage
  } catch {
    return null
  }
}

// ---------- talking to the wiki ----------

const lastAt = new Map<string, number>()

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('stopped'))
    const t = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', stop)
      resolve()
    }
    function stop(): void {
      clearTimeout(t)
      reject(new Error('stopped'))
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}

/** Waits its turn, so the wiki gets at most one request every `gap` ms from us. */
async function politely(host: string, gap: number, signal: AbortSignal): Promise<void> {
  const wait = (lastAt.get(host) ?? 0) + gap - Date.now()
  lastAt.set(host, Math.max(Date.now(), (lastAt.get(host) ?? 0) + gap))
  if (wait > 0) await sleep(wait, signal)
}

class WikiError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(address: WikiAddress, params: Record<string, string | number>, signal: AbortSignal): Promise<any> {
  const url = new URL(address.api)
  for (const [k, v] of Object.entries({ format: 'json', formatversion: 2, maxlag: 5, ...params })) url.searchParams.set(k, String(v))
  let lastProblem = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    await politely(address.host, API_GAP_MS, signal)
    let res: Response
    try {
      res = await net.fetch(url.href, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal })
    } catch (err) {
      if (signal.aborted) throw err
      lastProblem = 'Couldn’t reach the wiki. Check the internet connection.'
      await sleep(3000 * 2 ** attempt, signal)
      continue
    }
    // Busy: wait as long as it asks (or longer each time), then try again.
    if (res.status === 429 || res.status === 503) {
      const after = Number(res.headers.get('retry-after')) || 5 * 2 ** attempt
      lastProblem = 'The wiki is busy.'
      await sleep(Math.min(after, 120) * 1000, signal)
      continue
    }
    if (res.status === 404) throw new WikiError('That address isn’t a wiki Orbit can read (no wiki was found there).')
    if (!res.ok) {
      lastProblem = `The wiki had a problem (${res.status}).`
      await sleep(3000 * 2 ** attempt, signal)
      continue
    }
    const data = await res.json().catch(() => null)
    if (!data) throw new WikiError('The wiki sent back something Orbit couldn’t read.')
    if (data.error?.code === 'maxlag') {
      await sleep(5000 * 2 ** attempt, signal)
      continue
    }
    if (data.error) throw new WikiError(String(data.error.info ?? data.error.code ?? 'The wiki said no.'))
    return data
  }
  throw new WikiError(lastProblem || 'The wiki didn’t answer.')
}

async function siteInfo(address: WikiAddress, signal: AbortSignal): Promise<{ name: string; mainPage: string; licence: { text: string; url: string }; articles: number }> {
  const q = await api(address, { action: 'query', meta: 'siteinfo', siprop: 'general|rightsinfo|statistics' }, signal)
  const g = q.query?.general ?? {}
  const r = q.query?.rightsinfo ?? {}
  return {
    name: String(g.sitename ?? address.host),
    mainPage: normaliseTitle(String(g.mainpage ?? 'Main Page')),
    licence: { text: String(r.text || 'CC BY-SA'), url: String(r.url || 'https://www.fandom.com/licensing') },
    articles: Number(q.query?.statistics?.articles) || 0
  }
}

/** What the download screen shows about a wiki: its name, size, licence and biggest categories. */
export async function checkWiki(input: string): Promise<WikiCheck> {
  const address = parseWikiAddress(input)
  if (!address) throw new Error('That isn’t a Fandom wiki address. Paste one like walkingdead.fandom.com, or any page’s link from the wiki.')
  loadAll()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 60_000)
  try {
    const site = await siteInfo(address, abort.signal)
    const c = await api(address, { action: 'query', list: 'allcategories', acprop: 'size|hidden', aclimit: 500, acmin: 5 }, abort.signal).catch(() => null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories = ((c?.query?.allcategories ?? []) as any[])
      .filter((x) => !x.hidden)
      .map((x) => ({ name: normaliseTitle(String(x.category ?? x['*'] ?? '')), pages: Number(x.pages ?? x.size) || 0 }))
      .filter((x) => x.name && x.pages > 0)
      .sort((a, b) => b.pages - a.pages)
      .slice(0, 80)
    return { base: address.base, name: site.name, articles: site.articles, licence: site.licence, categories, already: wikis.has(address.id) }
  } catch (err) {
    if (abort.signal.aborted) throw new Error('The wiki took too long to answer. Try again in a bit.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ---------- downloading ----------

function cleanChoice(p: Partial<WikiPictureChoice> | undefined): WikiPictureChoice {
  return {
    main: p?.main !== false,
    categories: Array.isArray(p?.categories) ? p!.categories.map((c) => String(c).slice(0, 200)).slice(0, 200) : DEFAULT_PICTURES.categories
  }
}

/** Starts downloading a wiki (or carries on with one already started). */
export async function addWiki(input: string, pictures: Partial<WikiPictureChoice>): Promise<WikiInfo> {
  const address = parseWikiAddress(input)
  if (!address) throw new Error('That isn’t a Fandom wiki address.')
  loadAll()
  let w = wikis.get(address.id)
  if (!w) {
    const abort = new AbortController()
    const site = await siteInfo(address, abort.signal)
    await mkdir(join(dirOf(address.id), 'pages'), { recursive: true })
    await mkdir(join(dirOf(address.id), 'img'), { recursive: true })
    w = {
      meta: { id: address.id, address, name: site.name, base: address.base, mainPage: site.mainPage, licence: site.licence, pictures: cleanChoice(pictures), status: 'listing', total: site.articles, added: Date.now() },
      done: new Set(),
      failed: 0,
      bytes: 0
    }
    wikis.set(address.id, w)
    await saveMeta(w)
  } else if (pictures) {
    w.meta.pictures = cleanChoice(pictures)
    await saveMeta(w)
  }
  startJob(address.id)
  return info(w)
}

export function resumeWiki(id: string): WikiInfo {
  const w = wiki(id)
  startJob(w.meta.id)
  return info(w)
}

export async function pauseWiki(id: string): Promise<WikiInfo> {
  const w = wiki(id)
  jobs.get(w.meta.id)?.abort()
  jobs.delete(w.meta.id)
  if (w.meta.status !== 'done') {
    w.meta.status = 'paused'
    await saveMeta(w)
  }
  tellSoon()
  return info(w)
}

export async function removeWiki(id: string): Promise<WikiInfo[]> {
  const w = wiki(id)
  jobs.get(w.meta.id)?.abort()
  jobs.delete(w.meta.id)
  wikis.delete(w.meta.id)
  lists.delete(w.meta.id)
  titleMaps.delete(w.meta.id)
  indexes.delete(w.meta.id)
  await rm(dirOf(w.meta.id), { recursive: true, force: true })
  tellSoon()
  return wikiList()
}

function startJob(id: string): void {
  if (jobs.has(id)) return
  const abort = new AbortController()
  jobs.set(id, abort)
  const w = wikis.get(id)!
  delete w.meta.error
  tellSoon()
  void download(w, abort.signal)
    .catch(async (err) => {
      if (abort.signal.aborted) return
      logError('wiki', err)
      w.meta.status = 'error'
      w.meta.error = err instanceof WikiError ? err.message : 'The download stopped. Press Carry on to try again.'
      await saveMeta(w).catch(() => undefined)
    })
    .finally(() => {
      if (jobs.get(id) === abort) jobs.delete(id)
      void sizeOf(id)
      tellSoon()
    })
}

async function download(w: Loaded, signal: AbortSignal): Promise<void> {
  const id = w.meta.id
  const address = w.meta.address
  const list = await listOf(id)

  // 1. Every page's title (500 at a time), then the redirects.
  if (!list.listed || !list.redirected) {
    w.meta.status = 'listing'
    await saveMeta(w)
    tellSoon()
  }
  while (!list.listed) {
    const q = await api(address, { action: 'query', list: 'allpages', apnamespace: 0, apfilterredir: 'nonredirects', aplimit: 500, ...(list.apcontinue ? { apcontinue: list.apcontinue } : {}) }, signal)
    for (const p of q.query?.allpages ?? []) list.pages.push({ id: Number(p.pageid), title: String(p.title) })
    list.apcontinue = q.continue?.apcontinue
    if (!list.apcontinue) list.listed = true
    w.meta.total = list.listed ? list.pages.length : Math.max(w.meta.total, list.pages.length)
    await saveList(id, list)
    titleMaps.delete(id)
    tellSoon()
  }
  while (!list.redirected) {
    const q = await api(
      address,
      { action: 'query', generator: 'allpages', gapnamespace: 0, gapfilterredir: 'redirects', gaplimit: 500, redirects: 1, ...(list.gapcontinue ? { gapcontinue: list.gapcontinue } : {}) },
      signal
    )
    for (const r of q.query?.redirects ?? []) list.redirects[normaliseTitle(String(r.from))] = normaliseTitle(String(r.to))
    list.gapcontinue = q.continue?.gapcontinue
    if (!list.gapcontinue) list.redirected = true
    await saveList(id, list)
    titleMaps.delete(id)
  }

  // 2. The pages, one at a time.
  w.meta.status = 'pages'
  w.meta.total = list.pages.length
  await saveMeta(w)
  tellSoon()
  const failed = new Set(list.failed)
  let sinceSave = 0
  for (const p of list.pages) {
    if (signal.aborted) throw new Error('stopped')
    if (w.done.has(p.id) || failed.has(p.id)) continue
    try {
      await downloadPage(w, p.id, signal)
      w.done.add(p.id)
    } catch (err) {
      if (signal.aborted) throw err
      // One page that won't come is skipped, not the whole wiki.
      if (err instanceof WikiError && /couldn’t reach/i.test(err.message)) throw err
      logError('wiki', `page ${p.title}: ${err instanceof Error ? err.message : err}`)
      failed.add(p.id)
      list.failed = [...failed]
      w.failed = failed.size
      await saveList(id, list)
    }
    tellSoon()
    if (++sinceSave >= 50) {
      sinceSave = 0
      void sizeOf(id)
    }
  }

  // 3. The search index for the wiki brain.
  w.meta.status = 'indexing'
  await saveMeta(w)
  tellSoon()
  await buildIndex(id, signal)
  w.meta.status = 'done'
  w.meta.finished = Date.now()
  await saveMeta(w)
}

async function downloadPage(w: Loaded, pageId: number, signal: AbortSignal): Promise<void> {
  const id = w.meta.id
  const q = await api(
    w.meta.address,
    { action: 'parse', pageid: pageId, prop: 'text|categories|displaytitle|revid', disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 },
    signal
  )
  const parsed = q.parse ?? {}
  const html = String(parsed.text ?? '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = ((parsed.categories ?? []) as any[]).filter((c) => !c.hidden).map((c) => normaliseTitle(String(c.category ?? c['*'] ?? '')))
  const images: Record<string, string> = {}
  for (const url of picturesToGet(findImages(html), categories, w.meta.pictures)) {
    const file = await downloadImage(id, url, signal).catch((err) => {
      if (signal.aborted) throw err
      return null
    })
    if (file) images[url] = file
  }
  const title = String(parsed.title ?? '')
  const page: StoredWikiPage = {
    id: pageId,
    title,
    displayTitle: plainTitle(String(parsed.displaytitle ?? ''), title),
    revid: Number(parsed.revid) || 0,
    html,
    categories,
    images,
    sections: htmlToSections(html)
  }
  const file = join(dirOf(id), 'pages', `${pageId}.json.gz`)
  await writeFile(`${file}.tmp`, await zip(JSON.stringify(page)))
  await rename(`${file}.tmp`, file)
}

async function downloadImage(id: string, url: string, signal: AbortSignal): Promise<string | null> {
  const file = `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.${imageExtension(url)}`
  const full = join(dirOf(id), 'img', file)
  // Pictures used on more than one page are downloaded once.
  if (existsSync(full)) return file
  const host = new URL(url).hostname
  await politely(host, IMAGE_GAP_MS, signal)
  const res = await net.fetch(url, { headers: { 'User-Agent': userAgent() }, signal })
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return null
  if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) return null
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > MAX_IMAGE_BYTES || !data.length) return null
  await writeFile(full, data)
  return file
}

// ---------- reading ----------

async function titleMap(id: string): Promise<Map<string, number>> {
  let map = titleMaps.get(id)
  if (!map) {
    const l = await listOf(id)
    map = new Map(l.pages.map((p) => [normaliseTitle(p.title).toLowerCase(), p.id]))
    for (const [from, to] of Object.entries(l.redirects)) {
      const target = map.get(to.toLowerCase())
      if (target !== undefined && !map.has(from.toLowerCase())) map.set(from.toLowerCase(), target)
    }
    titleMaps.set(id, map)
  }
  return map
}

/** The titles of every downloaded page, for the reader's search box. */
export async function wikiTitles(id: string): Promise<string[]> {
  const w = wiki(id)
  const l = await listOf(w.meta.id)
  return l.pages.filter((p) => w.done.has(p.id)).map((p) => p.title)
}

/** A downloaded page by its title (or a redirect to it). Null when it isn't downloaded. */
export async function wikiPage(id: string, title: string): Promise<WikiPageView | null> {
  const w = wiki(id)
  const pageId = (await titleMap(w.meta.id)).get(normaliseTitle(String(title)).toLowerCase())
  if (pageId === undefined || !w.done.has(pageId)) return null
  const p = await readPage(w.meta.id, pageId)
  if (!p) return null
  return { wikiId: w.meta.id, title: p.title, displayTitle: p.displayTitle, html: p.html, images: p.images, categories: p.categories, url: pageUrl(w.meta.base, p.title) }
}

/** vault://wiki/<id>/<picture>: a downloaded picture. */
export async function wikiImageResponse(url: URL): Promise<Response> {
  const [id, file] = url.pathname.slice(1).split('/')
  loadAll()
  if (!wikis.has(id) || !/^[0-9a-f]{20}\.[a-z]{3,4}$/.test(file ?? '')) return new Response('Not found', { status: 404 })
  const data = await readFile(join(dirOf(id), 'img', file)).catch(() => null)
  if (!data) return new Response('Not found', { status: 404 })
  const ext = file.split('.').pop()
  const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } })
}

// ---------- searching (and the wiki brain) ----------

interface ChunkDoc {
  id: string
  title: string
  section: string
  text: string
}

const SEARCH_OPTIONS = {
  fields: ['title', 'section', 'text'],
  processTerm: (term: string) => searchTerm(term),
  searchOptions: { boost: { title: 4, section: 1.5 }, prefix: (t: string) => t.length > 3, fuzzy: (t: string) => (t.length > 4 ? 0.2 : false), combineWith: 'OR' as const }
}

interface Index {
  search: MiniSearch<ChunkDoc>
  pages: number
  used: number
}

const indexes = new Map<string, Index>()
const building = new Map<string, Promise<Index>>()
let dropTimer: ReturnType<typeof setTimeout> | undefined

/** Makes the search index from every downloaded page (a little at a time, so Orbit stays quick), and saves it. */
async function buildIndex(id: string, signal?: AbortSignal): Promise<Index> {
  const w = wiki(id)
  const search = new MiniSearch<ChunkDoc>(SEARCH_OPTIONS)
  let n = 0
  for (const pageId of [...w.done]) {
    if (signal?.aborted) throw new Error('stopped')
    const p = await readPage(id, pageId)
    if (!p) continue
    search.addAll(chunkSections(p.sections).map((c) => ({ id: `${pageId}:${c.n}`, title: p.title, section: c.section, text: c.text })))
    if (++n % 40 === 0) await new Promise((r) => setImmediate(r))
  }
  const index = { search, pages: w.done.size, used: Date.now() }
  const file = join(dirOf(id), 'search.json.gz')
  await writeFile(`${file}.tmp`, await zip(JSON.stringify({ pages: index.pages, index: search })))
  await rename(`${file}.tmp`, file)
  indexes.set(id, index)
  return index
}

/** The wiki's search index: in memory, else from its file, else made now (or again, when lots more pages have come since). */
async function indexOf(id: string): Promise<Index | null> {
  const w = wiki(id)
  if (!w.done.size) return null
  let index = indexes.get(id) ?? null
  if (!index) {
    try {
      const saved = JSON.parse((await unzip(await readFile(join(dirOf(id), 'search.json.gz')))).toString('utf8')) as { pages: number; index: unknown }
      index = { search: MiniSearch.loadJS<ChunkDoc>(saved.index as never, SEARCH_OPTIONS), pages: saved.pages, used: Date.now() }
      indexes.set(id, index)
    } catch {
      index = null
    }
  }
  if (!index || w.done.size - index.pages >= REINDEX_AFTER || (w.meta.status === 'done' && index.pages !== w.done.size)) {
    let job = building.get(id)
    if (!job) {
      job = buildIndex(id).finally(() => building.delete(id))
      building.set(id, job)
    }
    // A slightly old index is fine while a new one is made.
    if (!index) index = await job
  }
  index.used = Date.now()
  // Indexes are big: let go of them after a while unused.
  clearTimeout(dropTimer)
  dropTimer = setTimeout(() => {
    for (const [k, v] of indexes) if (Date.now() - v.used > 10 * 60_000) indexes.delete(k)
  }, 11 * 60_000)
  return index
}

async function chunkText(id: string, docId: string): Promise<{ title: string; section: string; text: string } | null> {
  const [pageId, n] = docId.split(':').map(Number)
  const p = await readPage(id, pageId)
  const c = p ? chunkSections(p.sections)[n] : undefined
  return p && c ? { title: p.title, section: c.section, text: c.text } : null
}

/** Pages whose text matches, best first (one result per page). */
export async function wikiSearch(id: string, query: string): Promise<WikiHit[]> {
  const w = wiki(id)
  const index = await indexOf(w.meta.id)
  if (!index || !query.trim()) return []
  const best = new Map<string, { id: string; score: number }>()
  for (const r of index.search.search(query.slice(0, 300))) {
    const page = String(r.id).split(':')[0]
    if (!best.has(page)) best.set(page, { id: String(r.id), score: r.score })
    if (best.size >= 30) break
  }
  const out: WikiHit[] = []
  for (const { id: docId } of best.values()) {
    const c = await chunkText(w.meta.id, docId)
    if (c) out.push({ wikiId: w.meta.id, wikiName: w.meta.name, title: c.title, section: c.section, snippet: c.text.replace(/\s+/g, ' ').slice(0, 220) })
  }
  return out
}

/**
 * The wiki brain: a question answered by the offline AI from the downloaded wiki only. It finds
 * the best-matching parts of the pages, gives the AI just those, and says which pages it used.
 * Nothing is sent anywhere: it runs on this computer.
 */
export async function wikiAsk(question: string, ids: string[]): Promise<WikiAnswer> {
  const q = String(question ?? '').trim().slice(0, 600)
  if (!q) throw new Error('Type a question first.')
  loadAll()
  const chosen = (ids.length ? ids : [...wikis.keys()]).map((i) => wiki(i))
  const hits: { w: Loaded; docId: string; score: number }[] = []
  for (const w of chosen) {
    const index = await indexOf(w.meta.id)
    if (!index) continue
    const results = index.search.search(q).slice(0, 14)
    const top = results[0]?.score || 1
    // Scores from different wikis aren't alike, so each wiki's are out of its best.
    for (const r of results) hits.push({ w, docId: String(r.id), score: r.score / top })
  }
  if (!hits.length) throw new Error(chosen.some((w) => w.done.size) ? 'Nothing in the downloaded wiki matches that. Try other words, like a name.' : 'Download a wiki first (or wait for some of its pages to arrive).')
  hits.sort((a, b) => b.score - a.score)

  const extracts: (WikiExtract & { wikiId: string })[] = []
  const perPage = new Map<string, number>()
  let used = 0
  const budget = LOCAL_CONTEXT_CHARS * 0.55
  for (const h of hits) {
    const pageKey = `${h.w.meta.id}/${h.docId.split(':')[0]}`
    if ((perPage.get(pageKey) ?? 0) >= 3) continue
    const c = await chunkText(h.w.meta.id, h.docId)
    if (!c) continue
    if (used + c.text.length > budget) {
      if (extracts.length) break
      c.text = c.text.slice(0, budget)
    }
    extracts.push({ wikiId: h.w.meta.id, wikiName: h.w.meta.name, ...c })
    perPage.set(pageKey, (perPage.get(pageKey) ?? 0) + 1)
    used += c.text.length
    if (extracts.length >= 12) break
  }

  const reply = await localComplete(
    [
      { role: 'system', content: WIKI_ASK_SYSTEM },
      { role: 'user', content: wikiAskPrompt(q, extracts) }
    ],
    { maxTokens: 700, temperature: 0.2 }
  )
  const text = cleanReply(reply).text
  const cited = citedNumbers(text, extracts.length)
  const source = (n: number): WikiSource => {
    const e = extracts[n - 1]
    return { n, wikiId: e.wikiId, wikiName: e.wikiName, title: e.title, section: e.section }
  }
  return { text, cited: cited.length > 0, sources: cited.length ? cited.map(source) : extracts.map((_, i) => source(i + 1)) }
}

// ---------- the app's side ----------

export function setupWiki(): void {
  ipcMain.handle('wiki:list', () => wikiList())
  ipcMain.handle('wiki:check', (_e, address: string) => checkWiki(String(address ?? '').slice(0, 500)))
  ipcMain.handle('wiki:add', (_e, address: string, pictures: Partial<WikiPictureChoice>) => addWiki(String(address ?? '').slice(0, 500), pictures ?? {}))
  ipcMain.handle('wiki:pause', (_e, id: string) => pauseWiki(String(id)))
  ipcMain.handle('wiki:resume', (_e, id: string) => resumeWiki(String(id)))
  ipcMain.handle('wiki:remove', (_e, id: string) => removeWiki(String(id)))
  ipcMain.handle('wiki:titles', (_e, id: string) => wikiTitles(String(id)))
  ipcMain.handle('wiki:page', (_e, id: string, title: string) => wikiPage(String(id), String(title ?? '').slice(0, 300)))
  ipcMain.handle('wiki:search', (_e, id: string, query: string) => wikiSearch(String(id), String(query ?? '')))
  ipcMain.handle('wiki:ask', (_e, question: string, ids: string[]) => wikiAsk(String(question ?? ''), Array.isArray(ids) ? ids.map(String) : []))
  app.on('will-quit', () => {
    for (const j of jobs.values()) j.abort()
  })
}
