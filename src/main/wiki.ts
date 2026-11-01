import { app, BrowserWindow, ipcMain, net } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { gunzip, gzip } from 'zlib'
import { promisify } from 'util'
import MiniSearch from 'minisearch'
import { localComplete } from './localAi'
import type { AppDataStore } from './comics'
import { mergeSynced, readSynced, sameSynced, type Synced } from '@shared/progressSync'
import { logError } from './log'
import { cleanReply, LOCAL_CONTEXT_CHARS } from '@shared/localAi'
import {
  citedNumbers,
  findImages,
  htmlToSections,
  imageExtension,
  normaliseTitle,
  pageUrl,
  parseWikiAddress,
  pictureChoice,
  picturesToGet,
  plainTitle,
  searchTerm,
  WIKI_ASK_SYSTEM,
  WIKI_SPOILER_NOTE,
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
  type WikiSource,
  type WikiSpoilerView
} from '@shared/wiki'
import {
  allowed,
  buildTimeline,
  filterPage,
  forbiddenNames,
  mentionsHidden,
  pageAllowed,
  partShown,
  placedChunks,
  spoilerSettings,
  timelineFact,
  type PageFacts,
  type PlacedChunk,
  type TimelineFact,
  type UnitReq,
  type WikiPart,
  type WikiSpoilerSettings,
  type WikiTimeline
} from '@shared/wikiSpoilers'

const WIKI_SYNC_FILE = 'wiki-progress.json'

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
      meta.pictures = pictureChoice(meta.pictures)
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

/** What the download screen shows about a wiki: its name, size and licence. */
export async function checkWiki(input: string): Promise<WikiCheck> {
  const address = parseWikiAddress(input)
  if (!address) throw new Error('That isn’t a Fandom wiki address. Paste one like walkingdead.fandom.com, or any page’s link from the wiki.')
  loadAll()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 60_000)
  try {
    const site = await siteInfo(address, abort.signal)
    return { base: address.base, name: site.name, articles: site.articles, licence: site.licence, already: wikis.has(address.id) }
  } catch (err) {
    if (abort.signal.aborted) throw new Error('The wiki took too long to answer. Try again in a bit.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ---------- downloading ----------

/** Starts downloading a wiki (or carries on with one already started). */
export async function addWiki(input: string, pictures: WikiPictureChoice): Promise<WikiInfo> {
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
      meta: { id: address.id, address, name: site.name, base: address.base, mainPage: site.mainPage, licence: site.licence, pictures: pictureChoice(pictures), status: 'listing', total: site.articles, added: Date.now() },
      done: new Set(),
      failed: 0,
      bytes: 0
    }
    wikis.set(address.id, w)
    await saveMeta(w)
  } else {
    w.meta.pictures = pictureChoice(pictures)
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

  // 3. The timeline, the spoiler check and the search index for the wiki brain.
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
  for (const url of picturesToGet(findImages(html), pictureChoice(w.meta.pictures))) {
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

/** Turns any title (or a redirect to a page) into that page's key, as the timeline keeps them. */
async function keyFor(id: string): Promise<(title: string) => string> {
  const l = await listOf(id)
  const redirects = new Map(Object.entries(l.redirects).map(([from, to]) => [from.toLowerCase(), to.toLowerCase()]))
  return (title) => {
    const t = normaliseTitle(title).toLowerCase()
    return redirects.get(t) ?? t
  }
}

const settingsOf = (w: Loaded): WikiSpoilerSettings => spoilerSettings(w.meta.spoilers)

/** Whether a page can be shown with your settings ('unchecked': it arrived after the spoiler check last ran). */
function pageState(w: Loaded, index: Index | null, pageId: number): 'ok' | 'part' | 'later' | 'unchecked' | 'unplaced' {
  const s = settingsOf(w)
  if (!s.limit && s.parts === 'both') return 'ok'
  const facts = index?.facts[pageId]
  if (!facts) return s.limit ? 'unchecked' : 'ok'
  return pageAllowed(facts, s)
}

/** The titles of the downloaded pages you can see, for the reader's search box. */
export async function wikiTitles(id: string): Promise<string[]> {
  const w = wiki(id)
  const l = await listOf(w.meta.id)
  const s = settingsOf(w)
  const index = s.limit || s.parts !== 'both' ? await indexOf(w.meta.id) : null
  return l.pages.filter((p) => w.done.has(p.id) && pageState(w, index, p.id) === 'ok').map((p) => p.title)
}

/** A downloaded page by its title (or a redirect to it), with anything past where you are taken out. Null when it isn't downloaded. */
export async function wikiPage(id: string, title: string, showUnplaced = false): Promise<WikiPageView | null> {
  const w = wiki(id)
  const pageId = (await titleMap(w.meta.id)).get(normaliseTitle(String(title)).toLowerCase())
  if (pageId === undefined || !w.done.has(pageId)) return null
  const p = await readPage(w.meta.id, pageId)
  if (!p) return null
  const view: WikiPageView = { wikiId: w.meta.id, title: p.title, displayTitle: p.displayTitle, html: p.html, images: p.images, categories: p.categories, url: pageUrl(w.meta.base, p.title) }
  const s = settingsOf(w)
  if (!s.limit && s.parts === 'both') return view
  const index = await indexOf(w.meta.id)
  const state = pageState(w, index, pageId)
  if (state !== 'ok' && !(state === 'unplaced' && showUnplaced)) return { ...view, html: '', images: {}, blocked: state }
  if (!s.limit || !index) return view
  const filtered = filterPage(p.html, p.title, p.categories, { timeline: index.timeline, key: await keyFor(w.meta.id), base: w.meta.base }, s, showUnplaced)
  return { ...view, html: filtered.html, hiddenLater: filtered.hiddenLater, hiddenUnplaced: filtered.hiddenUnplaced }
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

// ---------- the spoiler limit ----------

/** Shows with fewer episodes than this (post-credits scenes, promos) aren't offered in the settings. */
const MIN_SERIES_POINTS = 6

export async function wikiSpoilers(id: string): Promise<WikiSpoilerView> {
  const w = wiki(id)
  const index = await indexOf(w.meta.id).catch(() => null)
  const series = (index?.timeline.series ?? []).filter((s) => s.points.length >= MIN_SERIES_POINTS)
  return { settings: settingsOf(w), series, ready: !!index, finished: w.meta.status === 'done' }
}

export async function setWikiSpoilers(id: string, patch: Partial<WikiSpoilerSettings>): Promise<WikiInfo> {
  const w = wiki(id)
  const now = settingsOf(w)
  w.meta.spoilers = spoilerSettings({ ...now, ...patch, progress: { ...now.progress, ...(patch.progress ?? {}) }, updated: Date.now() })
  await saveMeta(w)
  tellSoon()
  void shareWikiProgress()
  return info(w)
}

// ---- sharing "how far I am" with your other computers ----

let sharedStore: () => AppDataStore | null = () => null
let sharing = false
let shareAgain = false

/**
 * The spoiler settings (how far you are) go in the notes folder (.notesapp/wiki-progress.json), so
 * they're the same on the PC and the MacBook. The wikis themselves stay on each computer. The newest
 * change to each wiki wins, and settings for a wiki not downloaded here are kept for when it is.
 */
export async function shareWikiProgress(): Promise<void> {
  const store = sharedStore()
  if (!store) return
  if (sharing) {
    shareAgain = true
    return
  }
  sharing = true
  try {
    loadAll()
    const raw = await store.readAppData(WIKI_SYNC_FILE)
    const remote = readSynced<WikiSpoilerSettings>(raw ? JSON.parse(raw) : {}, (v): v is WikiSpoilerSettings => !!v && typeof v === 'object')
    const local: Synced<WikiSpoilerSettings> = {}
    for (const w of wikis.values()) {
      const s = settingsOf(w)
      if (s.updated) local[w.meta.id] = { updated: s.updated, value: s }
    }
    const merged = mergeSynced(local, remote)
    for (const [id, entry] of Object.entries(merged)) {
      const w = wikis.get(id)
      if (!w || !entry.value || (local[id] && local[id].updated >= entry.updated)) continue
      w.meta.spoilers = spoilerSettings({ ...entry.value, updated: entry.updated })
      await saveMeta(w)
      tellSoon()
    }
    if (!sameSynced(merged, remote)) await store.writeAppData(WIKI_SYNC_FILE, JSON.stringify(merged))
  } catch (err) {
    logError('sharing wiki progress', err)
  } finally {
    sharing = false
    if (shareAgain) {
      shareAgain = false
      void shareWikiProgress()
    }
  }
}

// ---------- searching (and the wiki brain) ----------

interface ChunkDoc {
  id: string
  title: string
  section: string
  text: string
  /** How far you need to be (JSON of UnitReq). */
  req: string
  part: WikiPart
}

const SEARCH_OPTIONS = {
  fields: ['title', 'section', 'text'],
  storeFields: ['req', 'part'],
  processTerm: (term: string) => searchTerm(term),
  searchOptions: { boost: { title: 4, section: 1.5 }, prefix: (t: string) => t.length > 3, fuzzy: (t: string) => (t.length > 4 ? 0.2 : false), combineWith: 'OR' as const }
}

/** Saved indexes from an older Orbit are made again. */
const INDEX_VERSION = 2

interface Index {
  search: MiniSearch<ChunkDoc>
  pages: number
  used: number
  timeline: WikiTimeline
  /** By page id: which part it's about and when it first appears. */
  facts: Record<number, PageFacts>
}

const indexes = new Map<string, Index>()
const building = new Map<string, Promise<Index>>()
let dropTimer: ReturnType<typeof setTimeout> | undefined

const chunkFile = (id: string, pageId: number): string => join(dirOf(id), 'chunks', `${pageId}.json.gz`)

/**
 * Makes the timeline (from the episode and issue pages), places every part of every page on it,
 * and makes the search index from those parts (a little at a time, so Orbit stays quick).
 */
async function buildIndex(id: string, signal?: AbortSignal): Promise<Index> {
  const w = wiki(id)
  const pageIds = [...w.done]
  const key = await keyFor(id)
  const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r))

  // 1. The timeline.
  const facts: TimelineFact[] = []
  let n = 0
  for (const pageId of pageIds) {
    if (signal?.aborted) throw new Error('stopped')
    const p = await readPage(id, pageId)
    const f = p && timelineFact(p.title, p.categories, p.html, w.meta.base)
    if (f) facts.push(f)
    if (++n % 50 === 0) await yieldNow()
  }
  const timeline = buildTimeline(facts, key)
  const ctx = { timeline, key, base: w.meta.base }

  // 2. Every page, placed and indexed.
  await mkdir(join(dirOf(id), 'chunks'), { recursive: true })
  const search = new MiniSearch<ChunkDoc>(SEARCH_OPTIONS)
  const pageFacts: Record<number, PageFacts> = {}
  for (const pageId of pageIds) {
    if (signal?.aborted) throw new Error('stopped')
    const p = await readPage(id, pageId)
    if (!p) continue
    let placed: ReturnType<typeof placedChunks>
    try {
      placed = placedChunks(p.html, p.title, p.categories, ctx)
    } catch (err) {
      logError('wiki', `placing ${p.title}: ${err instanceof Error ? err.message : err}`)
      continue
    }
    pageFacts[pageId] = placed.facts
    await writeFile(chunkFile(id, pageId), await zip(JSON.stringify(placed.chunks)))
    search.addAll(placed.chunks.map((c, i) => ({ id: `${pageId}:${i}`, title: p.title, section: c.section, text: c.text, req: JSON.stringify(c.req), part: placed.facts.part })))
    if (++n % 20 === 0) await yieldNow()
  }
  const index: Index = { search, pages: w.done.size, used: Date.now(), timeline, facts: pageFacts }
  const file = join(dirOf(id), 'search.json.gz')
  await writeFile(`${file}.tmp`, await zip(JSON.stringify({ version: INDEX_VERSION, pages: index.pages, timeline, facts: pageFacts, index: search })))
  await rename(`${file}.tmp`, file)
  indexes.set(id, index)
  tellSoon()
  return index
}

/** The wiki's search index: in memory, else from its file, else made now (or again, when lots more pages have come since). */
async function indexOf(id: string): Promise<Index | null> {
  const w = wiki(id)
  if (!w.done.size) return null
  let index = indexes.get(id) ?? null
  if (!index) {
    try {
      const saved = JSON.parse((await unzip(await readFile(join(dirOf(id), 'search.json.gz')))).toString('utf8')) as {
        version?: number
        pages: number
        timeline: WikiTimeline
        facts: Record<number, PageFacts>
        index: unknown
      }
      if (saved.version === INDEX_VERSION) {
        index = { search: MiniSearch.loadJS<ChunkDoc>(saved.index as never, SEARCH_OPTIONS), pages: saved.pages, used: Date.now(), timeline: saved.timeline, facts: saved.facts }
        indexes.set(id, index)
      }
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
  try {
    const chunks = JSON.parse((await unzip(await readFile(chunkFile(id, pageId)))).toString('utf8')) as PlacedChunk[]
    const c = chunks[n]
    const title = (await listOf(id)).pages.find((p) => p.id === pageId)?.title
    return c && title ? { title, section: c.section, text: c.text } : null
  } catch {
    return null
  }
}

/** Only the parts of pages you can see with your settings. */
function canSee(w: Loaded, index: Index): (r: { id: string; req?: string; part?: WikiPart }) => boolean {
  const s = settingsOf(w)
  return (r) => {
    const pageId = Number(String(r.id).split(':')[0])
    if (pageState(w, index, pageId) !== 'ok') return false
    if (!partShown(r.part ?? 'other', s.parts)) return false
    return allowed(JSON.parse(r.req ?? 'null') as UnitReq, s)
  }
}

/** Pages whose text matches, best first (one result per page). */
export async function wikiSearch(id: string, query: string): Promise<WikiHit[]> {
  const w = wiki(id)
  const index = await indexOf(w.meta.id)
  if (!index || !query.trim()) return []
  const best = new Map<string, { id: string; score: number }>()
  for (const r of index.search.search(query.slice(0, 300), { filter: canSee(w, index) as never })) {
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

/** Names the wiki brain's answer mustn't say, for each wiki with the spoiler limit on. */
async function hiddenNames(w: Loaded, index: Index): Promise<string[]> {
  const s = settingsOf(w)
  if (!s.limit) return []
  const l = await listOf(w.meta.id)
  const hidden: string[] = []
  const shown: string[] = []
  for (const p of l.pages) {
    const state = pageState(w, index, p.id)
    if (state === 'ok') shown.push(p.title)
    else if (state === 'later') hidden.push(p.title)
  }
  return forbiddenNames(hidden, shown)
}

/**
 * The wiki brain: a question answered by the offline AI from the downloaded wiki only. It finds
 * the best-matching parts of the pages you can see, gives the AI just those, and says which pages
 * it used. Before the answer is shown, it's checked for anything past where you are (the AI may
 * know the story from elsewhere). Nothing is sent anywhere: it runs on this computer.
 */
export async function wikiAsk(question: string, ids: string[]): Promise<WikiAnswer> {
  const q = String(question ?? '').trim().slice(0, 600)
  if (!q) throw new Error('Type a question first.')
  loadAll()
  const chosen = (ids.length ? ids : [...wikis.keys()]).map((i) => wiki(i))
  const hits: { w: Loaded; docId: string; score: number }[] = []
  const forbidden: string[] = []
  let limited = false
  for (const w of chosen) {
    const index = await indexOf(w.meta.id)
    if (!index) continue
    if (settingsOf(w).limit) {
      limited = true
      forbidden.push(...(await hiddenNames(w, index)))
    }
    const results = index.search.search(q, { filter: canSee(w, index) as never }).slice(0, 14)
    const top = results[0]?.score || 1
    // Scores from different wikis aren't alike, so each wiki's are out of its best.
    for (const r of results) hits.push({ w, docId: String(r.id), score: r.score / top })
  }
  if (!hits.length) throw new Error(chosen.some((w) => w.done.size) ? 'Nothing you can see in the downloaded wiki matches that. Try other words, like a name.' : 'Download a wiki first (or wait for some of its pages to arrive).')
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
      { role: 'system', content: WIKI_ASK_SYSTEM + (limited ? `\n${WIKI_SPOILER_NOTE}` : '') },
      { role: 'user', content: wikiAskPrompt(q, extracts) }
    ],
    { maxTokens: 700, temperature: 0.2 }
  )
  const text = cleanReply(reply).text
  // The final check: nothing named that you haven't reached.
  if (limited && mentionsHidden(text, forbidden)) {
    return { text: 'Orbit hid this answer because it mentioned something past where you are. Try asking in another way.', sources: [], cited: false, spoilerHidden: true }
  }
  const cited = citedNumbers(text, extracts.length)
  const source = (n: number): WikiSource => {
    const e = extracts[n - 1]
    return { n, wikiId: e.wikiId, wikiName: e.wikiName, title: e.title, section: e.section }
  }
  return { text, cited: cited.length > 0, sources: cited.length ? cited.map(source) : extracts.map((_, i) => source(i + 1)) }
}

// ---------- the app's side ----------

export function setupWiki(appData: () => AppDataStore | null): void {
  sharedStore = appData
  // Back at the window (maybe after changing it on the other computer): pick up how far you are.
  app.on('browser-window-focus', () => void shareWikiProgress())
  ipcMain.handle('wiki:list', () => wikiList())
  ipcMain.handle('wiki:check', (_e, address: string) => checkWiki(String(address ?? '').slice(0, 500)))
  ipcMain.handle('wiki:add', (_e, address: string, pictures: WikiPictureChoice) => addWiki(String(address ?? '').slice(0, 500), pictureChoice(pictures)))
  ipcMain.handle('wiki:pause', (_e, id: string) => pauseWiki(String(id)))
  ipcMain.handle('wiki:resume', (_e, id: string) => resumeWiki(String(id)))
  ipcMain.handle('wiki:remove', (_e, id: string) => removeWiki(String(id)))
  ipcMain.handle('wiki:titles', (_e, id: string) => wikiTitles(String(id)))
  ipcMain.handle('wiki:page', (_e, id: string, title: string, showUnplaced?: boolean) => wikiPage(String(id), String(title ?? '').slice(0, 300), showUnplaced === true))
  ipcMain.handle('wiki:spoilers', (_e, id: string) => wikiSpoilers(String(id)))
  ipcMain.handle('wiki:setSpoilers', (_e, id: string, patch: Partial<WikiSpoilerSettings>) => setWikiSpoilers(String(id), patch && typeof patch === 'object' ? patch : {}))
  ipcMain.handle('wiki:search', (_e, id: string, query: string) => wikiSearch(String(id), String(query ?? '')))
  ipcMain.handle('wiki:ask', (_e, question: string, ids: string[]) => wikiAsk(String(question ?? ''), Array.isArray(ids) ? ids.map(String) : []))
  app.on('will-quit', () => {
    for (const j of jobs.values()) j.abort()
  })
}
