import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  session,
  shell,
  webContents,
  type DownloadItem,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents
} from 'electron'
import { firefoxUserAgent, isGoogleSignIn, isWebUrl, plainUserAgent, searchUrl, WEB_PARTITION } from '@shared/web'
import { isMessagesUrl, MESSAGES_PARTITION } from '@shared/messages'
import { shortcutFromEvent } from '@shared/shortcuts'
import { isAdRequest, PAGE_AD_CSS, YOUTUBE_AD_CSS, YOUTUBE_AD_SCRIPT } from '@shared/adblock'
import { isYouTubeUrl } from '@shared/youtube'
import { IS_MAC } from '@shared/platform'
import type { Prefs } from '@shared/prefs'
import type { MixerApp } from '@shared/mixer'
import {
  cookieBelongsTo,
  freeFileName,
  permissionFor,
  PRIVATE_PARTITION,
  safeDownloadName,
  searchHistory,
  siteOf,
  stepZoom,
  suggestions,
  type Bookmark,
  type Decision,
  type SitePermission,
  type SiteSettings,
  type WebDownload
} from '@shared/browser'
import {
  defaultDownloadFolder,
  flushBrowserData,
  forgetSite,
  getBookmarks,
  getHistory,
  getMisc,
  getProfile,
  getSites,
  loadDownloads,
  recordPage,
  recordVisit,
  saveDownloads,
  setBookmarks,
  setHistory,
  setMisc,
  setProfile,
  setSite,
  siteSettings
} from './browserData'
import { openInOtherBrowser } from './defaultBrowser'
import { logError } from './log'

/**
 * The web browser tab. Each one is a <webview>: a web page running in its own locked-down process,
 * in its own storage (WEB_PARTITION), so a site can't reach your notes, the app, or your computer.
 * Sign-ins are remembered in that storage until you clear it. Private tabs use storage that's only
 * in memory (PRIVATE_PARTITION), and nothing they do is written down.
 *
 * Here: what pages may do, the site settings (zoom, volume, permissions), downloads, history,
 * notifications from sites you've allowed, and the right-click menu. The window's side is
 * components/Web; what runs inside each page is src/preload/web.ts.
 *
 * The messages hub (WhatsApp, Discord) uses the same walled-off pages, in storage of its own
 * (MESSAGES_PARTITION), and may also show desktop notifications for new messages.
 */

/** Web pages may always go full screen (videos) and copy text; anything else they have to ask for. */
const WEB_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])
/** The messages hub's sites may also tell you about new messages. */
const MESSAGES_PERMISSIONS = new Set([...WEB_PERMISSIONS, 'notifications'])

/** The app's own shortcuts (sent over by the UI), so they still work while a web page has focus. */
let appShortcuts = new Set<string>()

/** What Google's sign-in pages are told the browser is (see isGoogleSignIn). */
const SIGN_IN_AGENT = firefoxUserAgent(process.platform)

/** Whether Google's sign-in pages are told "Firefox" (the "Sign in with Google as Firefox" setting). */
let asFirefox: () => boolean = () => false
const firefoxFor = (url: string): boolean => isGoogleSignIn(url) && asFirefox()

export interface BrowserDeps {
  /** Streamer mode is on: sites (and WhatsApp and Discord) don't pop up notifications. */
  quiet: () => boolean
  prefs: () => Prefs
  /** Saves a picture into the notes folder's attachments; returns its path there. */
  saveImage: (name: string, data: Uint8Array) => Promise<string>
  showMain: () => void
  /** The "Sign in with Google as Firefox" setting. */
  googleAsFirefox?: () => boolean
}

let deps: BrowserDeps = { quiet: () => false, prefs: () => ({}) as Prefs, saveImage: () => Promise.reject(new Error('No notes folder is open.')), showMain: () => undefined }

type PageKind = 'web' | 'private' | 'hub' | 'other'

const webSession = (): Session => session.fromPartition(WEB_PARTITION)
const privateSession = (): Session => session.fromPartition(PRIVATE_PARTITION)

function kindOf(page: WebContents): PageKind {
  if (page.isDestroyed()) return 'other'
  if (page.session === webSession()) return 'web'
  if (page.session === privateSession()) return 'private'
  if (page.session === session.fromPartition(MESSAGES_PARTITION)) return 'hub'
  return 'other'
}

/** The app window a page is in (a web tab's), to tell about it. */
const hostOf = (page: WebContents): WebContents | null => {
  const host = page.hostWebContents
  return host && !host.isDestroyed() ? host : null
}

/** Every web tab's page that's open now (not the hub's). */
function webPages(): WebContents[] {
  return webContents.getAllWebContents().filter((c) => !c.isDestroyed() && c.getType() === 'webview' && (kindOf(c) === 'web' || kindOf(c) === 'private'))
}

// ---------- site settings ----------

/** Private tabs' changes (zoom, decisions…) last until Orbit closes and are never written down. */
const privateSites: Record<string, SiteSettings> = {}

function settingsFor(page: WebContents, site: string): SiteSettings {
  const saved = siteSettings(site)
  if (kindOf(page) !== 'private') return saved
  const mine = privateSites[site] ?? {}
  return { ...saved, ...mine, permissions: { ...saved.permissions, ...mine.permissions } }
}

function changeSite(page: WebContents | null, site: string, patch: Partial<SiteSettings>): void {
  if (page && kindOf(page) === 'private') {
    const old = privateSites[site] ?? {}
    privateSites[site] = { ...old, ...patch, permissions: { ...old.permissions, ...patch.permissions } }
  } else {
    setSite(site, patch)
    broadcast('web:sites-changed', getSites())
  }
}

/** Tabs you've muted from their tab (not the whole site). */
const tabMuted = new Set<number>()

function sendVolume(page: WebContents, volume: number): void {
  for (const frame of page.mainFrame.framesInSubtree) {
    try {
      frame.send('orbit:volume', Math.max(0, Math.min(100, volume)) / 100)
    } catch {
      // the frame went away
    }
  }
}

/** A page's site's zoom, volume and mute, as it arrives on the site. */
function applySite(page: WebContents): void {
  const site = siteOf(page.getURL())
  if (!site) return
  const s = settingsFor(page, site)
  const zoom = s.zoom ?? 1
  if (Math.abs(page.getZoomFactor() - zoom) > 0.001) page.setZoomFactor(zoom)
  page.setAudioMuted(tabMuted.has(page.id) || !!s.muted)
  sendVolume(page, s.volume ?? 100)
  tellAudio(page)
  hostOf(page)?.send('web:zoomed', { wcId: page.id, zoom })
}

function zoomPage(page: WebContents, by: 1 | -1 | 0): void {
  const site = siteOf(page.getURL())
  const zoom = stepZoom(page.getZoomFactor(), by)
  page.setZoomFactor(zoom)
  if (site) changeSite(page, site, { zoom })
  // Every tab on the same site follows.
  for (const other of webPages()) if (other !== page && siteOf(other.getURL()) === site && kindOf(other) === kindOf(page)) other.setZoomFactor(zoom)
  for (const p of [page, ...webPages().filter((o) => o !== page && siteOf(o.getURL()) === site)]) hostOf(p)?.send('web:zoomed', { wcId: p.id, zoom })
}

function tellAudio(page: WebContents): void {
  if (page.isDestroyed()) return
  hostOf(page)?.send('web:audio', { wcId: page.id, audible: page.isCurrentlyAudible(), muted: page.isAudioMuted(), site: siteOf(page.getURL()) })
}

/** The volume mixer's rows for websites playing sound in web tabs (main/mixer.ts adds them). */
export function siteSounds(): MixerApp[] {
  const bySite = new Map<string, MixerApp>()
  for (const page of webPages()) {
    const site = siteOf(page.getURL())
    if (!site) continue
    const s = settingsFor(page, site)
    const audible = page.isCurrentlyAudible()
    if (!audible && !s.muted && s.volume === undefined && !bySite.has(site)) continue
    bySite.set(site, bySite.get(site) ?? { id: `site:${site}`, name: site, kind: 'site' as const, volume: s.volume ?? 100, muted: !!s.muted })
  }
  return [...bySite.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Changes a website's volume (0 to 100) and/or mute, for every tab it's open in. */
export function setSiteSound(site: string, volume: number | null, muted: boolean | null): boolean {
  const patch: Partial<SiteSettings> = {}
  if (volume !== null) patch.volume = Math.round(volume) >= 100 ? undefined : Math.max(0, Math.round(volume))
  if (muted !== null) patch.muted = muted || undefined
  changeSite(null, site, patch)
  for (const page of webPages()) if (siteOf(page.getURL()) === site) applySite(page)
  return true
}

// ---------- permissions ----------

interface PendingAsk {
  page: WebContents
  site: string
  permissions: SitePermission[]
  answer: (allow: boolean) => void
}
const asks = new Map<string, PendingAsk>()
let nextAsk = 1

function decided(page: WebContents, site: string, permissions: SitePermission[]): Decision | null {
  const perms = settingsFor(page, site).permissions ?? {}
  if (permissions.some((p) => perms[p] === 'block')) return 'block'
  if (permissions.every((p) => perms[p] === 'allow')) return 'allow'
  return null
}

function permissionCheck(page: WebContents | null, permission: string, origin: string, details: { mediaType?: string }): boolean {
  if (WEB_PERMISSIONS.has(permission)) return true
  const wanted = permissionFor(permission, details.mediaType ? [details.mediaType] : [])
  if (!page || !wanted) return false
  const site = siteOf(origin || page.getURL())
  return !!site && decided(page, site, wanted) === 'allow' && !(permission === 'notifications' && deps.quiet())
}

/** A site asks for something: allowed or blocked if you've said so before, otherwise its tab asks you. */
function permissionRequest(page: WebContents, permission: string, details: { requestingUrl?: string; mediaTypes?: string[] }, callback: (allow: boolean) => void): void {
  if (WEB_PERMISSIONS.has(permission)) return callback(true)
  const wanted = permissionFor(permission, details.mediaTypes ?? [])
  const site = siteOf(details.requestingUrl || page.getURL())
  const host = hostOf(page)
  if (!wanted || !site) return callback(false)
  const already = decided(page, site, wanted)
  if (already) return callback(already === 'allow')
  // Pop-up windows have no tab to ask in.
  if (!host) return callback(false)
  const id = String(nextAsk++)
  let done = false
  const answer = (allow: boolean): void => {
    if (done) return
    done = true
    asks.delete(id)
    callback(allow)
  }
  asks.set(id, { page, site, permissions: wanted, answer })
  page.once('destroyed', () => answer(false))
  page.once('did-start-navigation', () => answer(false))
  host.send('web:permission-ask', { id, wcId: page.id, site, permissions: wanted })
}

function answerAsk(id: string, allow: boolean): void {
  const ask = asks.get(id)
  if (!ask) return
  if (!ask.page.isDestroyed()) {
    const permissions = Object.fromEntries(ask.permissions.map((p) => [p, allow ? 'allow' : 'block'])) as Partial<Record<SitePermission, Decision>>
    changeSite(ask.page, ask.site, { permissions })
  }
  ask.answer(allow)
}

// ---------- notifications from sites ----------

const shownNotifications = new Set<Notification>()
const recentNotes = new Map<string, number[]>()

/** A site you've allowed sends a notification: it's shown as Orbit's own, and clicking it opens the tab. */
function siteNotification(page: WebContents, frameUrl: string, payload: unknown): void {
  const kind = kindOf(page)
  if (kind !== 'web' && kind !== 'private') return
  const site = siteOf(frameUrl || page.getURL())
  if (!site || decided(page, site, ['notifications']) !== 'allow' || deps.quiet() || !Notification.isSupported()) return
  // No more than five every ten seconds from one site.
  const now = Date.now()
  const times = (recentNotes.get(site) ?? []).filter((t) => now - t < 10_000)
  if (times.length >= 5) return
  recentNotes.set(site, [...times, now])
  const p = (payload && typeof payload === 'object' ? payload : {}) as { id?: unknown; title?: unknown; body?: unknown; silent?: unknown }
  const title = String(p.title ?? '').slice(0, 200) || site
  const body = String(p.body ?? '').slice(0, 500)
  const n = new Notification({ title, body: body ? `${body}\n${site}` : site, silent: p.silent === true })
  n.on('click', () => {
    deps.showMain()
    if (page.isDestroyed()) return
    hostOf(page)?.send('web:focus', page.id)
    page.send('orbit:notification-click', String(p.id ?? ''))
  })
  n.on('failed', (_e, error) => logError('site notification', new Error(error)))
  n.on('close', () => shownNotifications.delete(n))
  shownNotifications.add(n)
  n.show()
}

// ---------- downloads ----------

let downloads: WebDownload[] = []
interface Running {
  item: DownloadItem | null
  temp: string
  /** The folder it goes to once it's finished (null: waiting for you to pick). */
  folder: string | null
  finished: boolean
}
const running = new Map<string, Running>()

const downloadingFolder = (): string => join(app.getPath('userData'), 'browser', 'downloading')

let tellTimer: NodeJS.Timeout | undefined
function tellDownloads(now = false): void {
  const send = (): void => {
    tellTimer = undefined
    broadcast('web:downloads', downloads)
  }
  if (now) {
    clearTimeout(tellTimer)
    send()
  } else tellTimer ??= setTimeout(send, 250)
}

async function moveInto(d: WebDownload, r: Running): Promise<void> {
  if (!r.folder) return
  await fs.mkdir(r.folder, { recursive: true })
  const name = freeFileName(d.name, (n) => existsSync(join(r.folder!, n)))
  const target = join(r.folder, name)
  try {
    await fs.rename(r.temp, target)
  } catch {
    // Another drive: copy it over instead.
    await fs.copyFile(r.temp, target)
    await fs.rm(r.temp, { force: true })
  }
  d.name = name
  d.path = target
  d.state = 'done'
  d.asking = undefined
  running.delete(d.id)
  if (!d.private) saveDownloads(downloads)
  tellDownloads(true)
}

function startDownload(item: DownloadItem, page: WebContents | null, isPrivate: boolean): void {
  const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const name = safeDownloadName(item.getFilename() || 'download')
  const temp = join(downloadingFolder(), `${id}-${name}`)
  item.setSavePath(temp)
  const ask = deps.prefs().webAskDownloadFolder !== false
  const d: WebDownload = {
    id,
    url: item.getURL(),
    name,
    path: ask ? '' : join(defaultDownloadFolder(), name),
    state: 'downloading',
    received: 0,
    total: item.getTotalBytes(),
    started: Date.now(),
    ...(ask ? { asking: true } : {}),
    ...(isPrivate ? { private: true } : {})
  }
  const r: Running = { item, temp, folder: ask ? null : defaultDownloadFolder(), finished: false }
  running.set(id, r)
  downloads = [d, ...downloads].slice(0, 100)
  void fs.mkdir(downloadingFolder(), { recursive: true }).catch(() => undefined)
  item.on('updated', (_e, state) => {
    d.received = item.getReceivedBytes()
    d.total = item.getTotalBytes()
    d.state = state === 'interrupted' ? 'failed' : item.isPaused() ? 'paused' : 'downloading'
    tellDownloads()
  })
  item.once('done', (_e, state) => {
    r.item = null
    d.received = item.getReceivedBytes()
    if (state === 'completed') {
      r.finished = true
      if (r.folder) void moveInto(d, r).catch((err) => failDownload(d, err))
      else tellDownloads(true)
    } else {
      d.state = state === 'cancelled' ? 'cancelled' : 'failed'
      d.asking = undefined
      running.delete(id)
      void fs.rm(temp, { force: true }).catch(() => undefined)
      if (!d.private) saveDownloads(downloads)
      tellDownloads(true)
    }
  })
  tellDownloads(true)
  // The window asks where to save it (or shows that it's started), in the tab it came from if it can.
  broadcast('web:download-started', { id, wcId: page && !page.isDestroyed() ? page.id : null })
}

function failDownload(d: WebDownload, err: unknown): void {
  logError('download', err)
  d.state = 'failed'
  d.asking = undefined
  tellDownloads(true)
}

async function downloadTo(id: string, folder: string, remember: boolean): Promise<void> {
  const d = downloads.find((x) => x.id === id)
  const r = running.get(id)
  if (!d || !r || typeof folder !== 'string' || !folder) return
  r.folder = folder
  if (remember) setMisc({ downloadFolder: folder })
  d.asking = undefined
  d.path = join(folder, d.name)
  if (r.finished) await moveInto(d, r).catch((err) => failDownload(d, err))
  else tellDownloads(true)
}

function cancelDownload(id: string): void {
  const d = downloads.find((x) => x.id === id)
  const r = running.get(id)
  if (!d || !r) return
  if (r.item) return r.item.cancel()
  // Finished but never given a folder.
  running.delete(id)
  d.state = 'cancelled'
  d.asking = undefined
  void fs.rm(r.temp, { force: true }).catch(() => undefined)
  tellDownloads(true)
}

// ---------- history ----------

/** Remembers the pages a web tab visits (never a private tab's), and the words on them for searching. */
function keepHistory(page: WebContents): void {
  if (kindOf(page) !== 'web' || page.getType() !== 'webview') return
  let textTimer: NodeJS.Timeout | undefined
  const readText = (): void => {
    clearTimeout(textTimer)
    textTimer = setTimeout(() => {
      if (page.isDestroyed()) return
      const url = page.getURL()
      page
        .executeJavaScript(`(document.body && document.body.innerText || '').slice(0, 6000)`, false)
        .then((text: unknown) => typeof text === 'string' && recordPage(url, { text, title: page.getTitle() }))
        .catch(() => undefined)
    }, 1500)
  }
  page.on('did-navigate', (_e, url) => {
    if (isWebUrl(url)) recordVisit(url, '')
  })
  page.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame && isWebUrl(url)) {
      recordVisit(url, page.getTitle())
      readText()
    }
  })
  page.on('page-title-updated', (_e, title) => recordPage(page.getURL(), { title }))
  page.on('did-stop-loading', readText)
  page.once('destroyed', () => clearTimeout(textTimer))
}

// ---------- clearing a site ----------

async function clearSite(site: string): Promise<void> {
  for (const ses of [webSession(), privateSession()]) {
    const cookies = await ses.cookies.get({})
    await Promise.all(
      cookies
        .filter((c) => c.domain && cookieBelongsTo(c.domain, site))
        .map((c) => ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain!.replace(/^\./, '')}${c.path ?? '/'}`, c.name).catch(() => undefined))
    )
    // The usual addresses, and the exact ones of its open tabs (a site on its own port, like localhost:3000).
    const origins = new Set([`https://${site}`, `https://www.${site}`, `http://${site}`, `http://www.${site}`])
    for (const page of webPages()) if (siteOf(page.getURL()) === site) origins.add(new URL(page.getURL()).origin)
    for (const origin of origins) {
      await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql', 'shadercache'] }).catch(() => undefined)
    }
  }
  await webSession().cookies.flushStore().catch(() => undefined)
  for (const page of webPages()) if (siteOf(page.getURL()) === site) page.reload()
}

// ---------- setting up ----------

function broadcast(channel: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, value)
}

/** The same walled-off setup for the web tabs' storage and the private tabs'. */
function setupWebSession(ses: Session, isPrivate: boolean, preload: { type: 'frame'; filePath: string }): void {
  ses.registerPreloadScript(preload)
  ses.setUserAgent(plainUserAgent(ses.getUserAgent()))
  ses.setPermissionRequestHandler((wc, permission, callback, details) => permissionRequest(wc, permission, details as { requestingUrl?: string; mediaTypes?: string[] }, callback))
  ses.setPermissionCheckHandler((wc, permission, origin, details) => permissionCheck(wc, permission, origin, details as { mediaType?: string }))
  // With "Sign in with Google as Firefox" on, Google's sign-in pages (every one the sign-in passes
  // through, see isGoogleSignIn) hear "Firefox", without the Chrome-only hints that would give it away.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    if (!firefoxFor(details.url)) return callback({})
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).filter(([name]) => !/^sec-ch-ua/i.test(name)))
    callback({ requestHeaders: { ...headers, 'User-Agent': SIGN_IN_AGENT } })
  })
  // The ad blocker: requests for ads and trackers are refused (the page side is in blockAds).
  // (YouTube's pages are left alone: see isAdRequest.)
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let page = ''
    try {
      // The frame asking (a YouTube player embedded in another site counts as YouTube), else its tab.
      page = details.frame?.url || (details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : '')
    } catch {
      // the page went away
    }
    callback({ cancel: isAdRequest(details.url, details.resourceType, page || details.referrer) })
  })
  ses.on('will-download', (_e, item, wc) => startDownload(item, wc ?? null, isPrivate))
}

export function setupBrowser(options: BrowserDeps): void {
  deps = options
  asFirefox = options.googleAsFirefox ?? (() => false)
  downloads = loadDownloads()

  app.on('web-contents-created', (_e, contents) => {
    // However a web page tab is asked for, it gets the same walled-off setup.
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete prefs.preload
      // Only the messages hub's own sites get its storage, and private tabs theirs; every other page gets the web tabs'.
      const hub = prefs.partition === MESSAGES_PARTITION && isMessagesUrl(params.src)
      prefs.partition = hub ? MESSAGES_PARTITION : prefs.partition === PRIVATE_PARTITION ? PRIVATE_PARTITION : WEB_PARTITION
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.webSecurity = true
      prefs.allowRunningInsecureContent = false
      if (!isWebUrl(params.src) && params.src !== 'about:blank') event.preventDefault()
    })
    if (contents.getType() === 'webview') {
      guardPage(contents, () => hostOf(contents))
      blockAds(contents)
      // The page's own setup has to wait until it's attached to its tab (and has its storage).
      contents.once('did-start-loading', () => {
        const kind = kindOf(contents)
        if (kind !== 'web' && kind !== 'private') return
        keepHistory(contents)
        contents.on('did-navigate', () => applySite(contents))
        contents.on('dom-ready', () => applySite(contents))
        contents.on('audio-state-changed', () => tellAudio(contents))
        contents.on('zoom-changed', (_ev, direction) => zoomPage(contents, direction === 'in' ? 1 : -1))
        contents.once('destroyed', () => tabMuted.delete(contents.id))
      })
    }
  })

  // Every web page gets src/preload/web.ts before its own code runs.
  const pagePreload = { type: 'frame' as const, filePath: join(__dirname, '../preload/web.js') }
  setupWebSession(webSession(), false, pagePreload)
  setupWebSession(privateSession(), true, pagePreload)

  const messages = session.fromPartition(MESSAGES_PARTITION)
  messages.registerPreloadScript(pagePreload)
  messages.setUserAgent(plainUserAgent(messages.getUserAgent()))
  const allowed = (permission: string): boolean => MESSAGES_PERMISSIONS.has(permission) && !(permission === 'notifications' && deps.quiet())
  messages.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)))
  messages.setPermissionCheckHandler((_wc, permission) => allowed(permission))

  // What the hub's sites have stored goes to disk every minute, and before the computer sleeps or
  // shuts down, so the app being stopped without closing properly (Windows shutting down while it's
  // in the tray, a crash) doesn't lose a sign-in.
  setInterval(saveMessages, 60_000).unref?.()
  powerMonitor.on('suspend', saveMessages)
  powerMonitor.on('shutdown', () => void releaseMessages())
  app.on('before-quit', () => void flushBrowserData())

  // What kind of page the page's own script is in (it only offers to save passwords and so on in web tabs).
  ipcMain.on('web:pageKind', (e) => {
    e.returnValue = kindOf(e.sender)
  })
  ipcMain.on('web:notify', (e, payload: unknown) => siteNotification(e.sender, e.senderFrame?.url ?? '', payload))

  ipcMain.handle('messages:release', () => releaseMessages())
  ipcMain.handle('messages:clear', async () => {
    await messages.clearStorageData()
    await messages.clearCache()
    await messages.clearAuthCache()
  })
  ipcMain.handle('web:clear', async () => {
    const web = webSession()
    await web.clearStorageData()
    await web.clearCache()
    await web.clearAuthCache()
    setHistory([])
  })
  // The mouse's back or forward button in a web page (src/preload/web.ts): the app window it's in decides
  // whether the page or the app goes back.
  ipcMain.on('web:mouseNav', (e, dir: unknown) => {
    const page = e.sender
    if ((dir !== 1 && dir !== -1) || page.getType() !== 'webview') return
    const host = page.hostWebContents
    if (host && !host.isDestroyed()) host.send('web:mouseNav', page.id, dir)
  })
  ipcMain.on('web:googleAsFirefox', (e) => {
    e.returnValue = asFirefox()
  })
  ipcMain.on('web:shortcuts', (_e, list: unknown) => {
    appShortcuts = new Set(Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [])
  })

  // Bookmarks: the window works out the changes (with @shared/browser) and sends the whole list back.
  ipcMain.handle('web:bookmarks', () => getBookmarks())
  ipcMain.handle('web:setBookmarks', (_e, list: Bookmark[]) => {
    setBookmarks(list)
    broadcast('web:bookmarks-changed', getBookmarks())
    return getBookmarks()
  })

  ipcMain.handle('web:history', (_e, query: string, limit?: number) => searchHistory(getHistory(), String(query ?? ''), Math.min(Number(limit) || 200, 1000)))
  ipcMain.handle('web:historyRemove', (_e, url: string) => setHistory(getHistory().filter((h) => h.url !== url)))
  ipcMain.handle('web:historyClear', () => setHistory([]))
  ipcMain.handle('web:suggest', (_e, typed: string) => suggestions(getBookmarks(), getHistory(), String(typed ?? '')))

  ipcMain.handle('web:sites', () => getSites())
  ipcMain.handle('web:siteSet', (_e, site: string, patch: Partial<SiteSettings>) => {
    changeSite(null, String(site), patch && typeof patch === 'object' ? patch : {})
    for (const page of webPages()) if (siteOf(page.getURL()) === site) applySite(page)
    return getSites()
  })
  ipcMain.handle('web:siteForget', (_e, site: string) => {
    forgetSite(String(site))
    broadcast('web:sites-changed', getSites())
    for (const page of webPages()) if (siteOf(page.getURL()) === site) applySite(page)
    return getSites()
  })
  ipcMain.handle('web:clearSite', (_e, site: string) => clearSite(String(site)))

  ipcMain.handle('web:downloads', () => downloads)
  ipcMain.handle('web:downloadTo', (_e, id: string, folder: string, remember: boolean) => downloadTo(String(id), String(folder), remember === true))
  ipcMain.handle('web:downloadCancel', (_e, id: string) => cancelDownload(String(id)))
  ipcMain.handle('web:downloadPause', (_e, id: string, paused: boolean) => {
    const item = running.get(String(id))?.item
    if (!item) return
    if (paused) item.pause()
    else if (item.canResume()) item.resume()
  })
  ipcMain.handle('web:downloadForget', (_e, id: string) => {
    if (running.has(String(id))) cancelDownload(String(id))
    downloads = downloads.filter((d) => d.id !== id)
    saveDownloads(downloads)
    tellDownloads(true)
  })
  ipcMain.handle('web:downloadsClear', () => {
    downloads = downloads.filter((d) => running.has(d.id))
    saveDownloads(downloads)
    tellDownloads(true)
  })
  ipcMain.handle('web:downloadFolder', () => ({ folder: defaultDownloadFolder(), chosen: !!getMisc().downloadFolder }))
  ipcMain.handle('web:setDownloadFolder', (_e, folder: string) => setMisc({ downloadFolder: typeof folder === 'string' ? folder : '' }))

  ipcMain.handle('web:autofill', () => getProfile())
  ipcMain.handle('web:setAutofill', async (_e, profile: unknown) => {
    const result = await setProfile(profile)
    broadcast('web:autofill-changed', result.profile)
    return result
  })

  ipcMain.handle('web:zoom', (_e, wcId: number, by: number) => {
    const page = webContents.fromId(Number(wcId))
    if (page && !page.isDestroyed()) zoomPage(page, by > 0 ? 1 : by < 0 ? -1 : 0)
  })
  ipcMain.handle('web:muteTab', (_e, wcId: number, muted: boolean) => {
    const page = webContents.fromId(Number(wcId))
    if (!page || page.isDestroyed()) return
    if (muted) tabMuted.add(page.id)
    else tabMuted.delete(page.id)
    const site = siteOf(page.getURL())
    page.setAudioMuted(muted || (!!site && !!settingsFor(page, site).muted))
    tellAudio(page)
  })
  ipcMain.handle('web:permissionAnswer', (_e, id: string, allow: boolean) => answerAsk(String(id), allow === true))
}

/** Each web page gets the ad blocker's CSS; YouTube (in a web tab or the mini window) its script too. */
export function blockAds(page: WebContents): void {
  page.on('dom-ready', () => {
    if (page.session !== webSession() && page.session !== privateSession()) return
    page.insertCSS(PAGE_AD_CSS).catch(() => undefined)
    if (!isYouTubeUrl(page.getURL())) return
    page.insertCSS(YOUTUBE_AD_CSS).catch(() => undefined)
    page.executeJavaScript(YOUTUBE_AD_SCRIPT).catch((err) => logError('youtube ad blocker', err))
  })
}

/**
 * Closes the messages hub's pages properly, then writes what they stored to disk. Discord keeps your
 * sign-in in memory while it's open and only saves it as its page closes, so a page that's simply
 * thrown away (closing the app or the Messages tab) leaves Discord signed out next time.
 * Called before the hub's pages go away. Never takes more than a couple of seconds.
 */
export async function releaseMessages(): Promise<void> {
  const hub = session.fromPartition(MESSAGES_PARTITION)
  const pages = webContents.getAllWebContents().filter((c) => !c.isDestroyed() && c.getType() === 'webview' && c.session === hub)
  // Leaving the page runs its "page is closing" code, as closing a browser tab would.
  const leave = (page: WebContents): Promise<unknown> => page.loadURL('about:blank').catch(() => undefined)
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000))
  await Promise.race([Promise.all(pages.map(leave)), timeout])
  saveMessages()
}

/** Writes the messages hub's storage and cookies to disk now, rather than whenever Chromium gets to it. */
export function saveMessages(): void {
  const hub = session.fromPartition(MESSAGES_PARTITION)
  hub.flushStorageData()
  hub.cookies.flushStore().catch(() => undefined)
}

/** A picture on a page, saved into the notes folder's attachments. */
async function saveImage(page: WebContents, src: string): Promise<void> {
  const host = hostOf(page)
  try {
    let data: Buffer
    let type = ''
    if (/^data:/i.test(src)) {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(src)
      if (!m) throw new Error('That picture can’t be saved.')
      type = m[1]
      data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    } else {
      const res = await page.session.fetch(src)
      if (!res.ok) throw new Error(`The site wouldn’t send the picture (${res.status}).`)
      type = res.headers.get('content-type') ?? ''
      data = Buffer.from(await res.arrayBuffer())
    }
    const ext = /png/.test(type) ? 'png' : /gif/.test(type) ? 'gif' : /webp/.test(type) ? 'webp' : /svg/.test(type) ? 'svg' : /avif/.test(type) ? 'avif' : 'jpg'
    // A web picture keeps its file name; an inline "data:" one (Google Images' thumbnails) is just "image".
    let name = 'image'
    if (!/^data:/i.test(src)) {
      try {
        name = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'image')
      } catch {
        // not a usable address: "image" it is
      }
    }
    name = safeDownloadName(name.replace(/\.[a-z0-9]{2,5}$/i, '')) || 'image'
    const saved = await deps.saveImage(`${name}.${ext}`, data)
    host?.send('web:image-saved', saved)
  } catch (err) {
    logError('save image', err)
    host?.send('web:image-saved', null, err instanceof Error ? err.message : String(err))
  }
}

/** Browser keys while a page has focus (they'd otherwise go to the page, or be the app's own shortcuts). */
function browserKey(input: Electron.Input): string | null {
  const mod = IS_MAC ? input.meta : input.control
  const key = input.key.toLowerCase()
  if (input.key === 'F3') return input.shift ? 'find-previous' : 'find-next'
  if (input.key === 'F5') return 'reload'
  if (input.alt && !mod && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) return input.key === 'ArrowLeft' ? 'back' : 'forward'
  if (!mod || input.alt) return null
  if (key === 'f') return 'find'
  if (key === 'g') return input.shift ? 'find-previous' : 'find-next'
  if (key === 'd') return 'bookmark'
  if (key === 'h' && !IS_MAC) return 'history'
  if (key === 'y' && IS_MAC) return 'history'
  if (key === 'j') return 'downloads'
  if (key === 'l') return 'address'
  if (key === 'r') return 'reload'
  if (key === 'n' && input.shift) return 'private'
  if (key === 's' && input.shift) return 'clip'
  if (input.key === '=' || input.key === '+') return 'zoom-in'
  if (input.key === '-' || input.key === '_') return 'zoom-out'
  if (input.key === '0') return 'zoom-reset'
  return null
}

/**
 * What a web page may do: stay on the web, and open new windows as new web tabs. `host` is the
 * app window it belongs to. With `appShortcuts: false` the app's shortcuts stay with the page (for a
 * page in a window of its own, where Ctrl+W shouldn't close a tab in the notes window).
 */
export function guardPage(page: WebContents, host: () => WebContents | null, { appShortcuts: passShortcuts = true } = {}): void {
  const openInTab = (url: string, privately = false): void => {
    if (isWebUrl(url)) host()?.send('web:open', url, privately || kindOf(page) === 'private')
  }
  // A messages hub page (or its sign-in pop-up) keeps to its own storage and its own site.
  const inHub = (): boolean => page.session === session.fromPartition(MESSAGES_PARTITION)
  const partition = (): string => (inHub() ? MESSAGES_PARTITION : kindOf(page) === 'private' ? PRIVATE_PARTITION : WEB_PARTITION)

  page.setWindowOpenHandler(({ url, disposition }) => {
    // A small pop-up window (how "Sign in with Google / Microsoft / Apple" buttons work) opens as
    // one, so it can hand the sign-in back to the page that opened it. Other links get a web tab.
    if (disposition === 'new-window' && isWebUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { partition: partition(), sandbox: true, contextIsolation: true, nodeIntegration: false }
        },
        // The pop-up is made here so it has the right browser name before its first page loads: a
        // Google sign-in pop-up that opened as "Chrome" and then became "Firefox" sends you back to
        // "Choose an account" each time you pick one.
        createWindow: (options) => {
          const popup = new BrowserWindow(options)
          if (firefoxFor(url)) popup.webContents.setUserAgent(SIGN_IN_AGENT)
          return popup.webContents
        }
      }
    }
    if (isWebUrl(url)) openInTab(url)
    else if (/^mailto:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  page.on('did-create-window', (popup) => guardPage(popup.webContents, host))

  // Google's sign-in pages see "Firefox" from the page's side too (the request side is in setupWebSession).
  const browserName = (url: string): void => {
    const agent = firefoxFor(url) ? SIGN_IN_AGENT : page.session.getUserAgent()
    if (page.getUserAgent() !== agent) page.setUserAgent(agent)
  }
  page.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) browserName(details.url)
  })

  // Only web pages: an email link goes to your email app, and anything else (files, other apps) is refused.
  const stayOnWeb = (e: { preventDefault(): void }, url: string): void => {
    if (isWebUrl(url) || url === 'about:blank') return
    e.preventDefault()
    if (/^mailto:/i.test(url)) void shell.openExternal(url)
  }
  page.on('will-navigate', (e, url) => {
    stayOnWeb(e, url)
    // A link out of WhatsApp or Discord opens in a web tab rather than taking over the hub (a
    // sign-in pop-up may go wherever it signs you in).
    if (inHub() && page.getType() === 'webview' && isWebUrl(url) && !isMessagesUrl(url)) {
      e.preventDefault()
      openInTab(url)
      return
    }
    browserName(url)
  })
  page.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
    stayOnWeb(e, url)
    if (isMainFrame) browserName(url)
  })

  // Browser keys (find, bookmark, zoom…) in web tabs; then the app's shortcuts (Ctrl+W, Ctrl+P…);
  // everything else goes to the page.
  page.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const kind = kindOf(page)
    if ((kind === 'web' || kind === 'private') && page.getType() === 'webview') {
      const key = browserKey(input)
      if (key) {
        e.preventDefault()
        if (key === 'zoom-in' || key === 'zoom-out' || key === 'zoom-reset') zoomPage(page, key === 'zoom-in' ? 1 : key === 'zoom-out' ? -1 : 0)
        else if (key === 'reload') page.reload()
        else if (key === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack()
        else if (key === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward()
        else host()?.send('web:key', { wcId: page.id, key })
        return
      }
      if (input.key === 'Escape') host()?.send('web:key', { wcId: page.id, key: 'escape' })
    }
    if (!passShortcuts || !appShortcuts.size) return
    const pressed = shortcutFromEvent({
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      altKey: input.alt,
      shiftKey: input.shift
    })
    if (pressed && appShortcuts.has(pressed)) {
      e.preventDefault()
      host()?.send('web:shortcut', pressed)
    }
  })

  page.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    const web = kindOf(page) === 'web' || kindOf(page) === 'private'
    if (params.linkURL && isWebUrl(params.linkURL)) {
      items.push(
        { label: 'Open link in new tab', click: () => openInTab(params.linkURL) },
        ...(kindOf(page) === 'private' ? [] : [{ label: 'Open link in private tab', click: () => openInTab(params.linkURL, true) }]),
        { label: 'Open link in your other browser', click: () => void openInOtherBrowser(params.linkURL) },
        { label: 'Copy link', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll' },
        { type: 'separator' }
      )
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      items.push(
        { role: 'copy' },
        { label: `Search Google for “${text.length > 30 ? `${text.slice(0, 30)}…` : text}”`, click: () => openInTab(searchUrl(text)) },
        ...(web && page.getType() === 'webview' ? [{ label: 'Save selection to Inbox', click: () => host()?.send('web:key', { wcId: page.id, key: 'clip' }) }] : []),
        { type: 'separator' }
      )
    }
    // Pictures, including Google Images' thumbnails, which are often inline "data:" pictures.
    if (params.mediaType === 'image' && (isWebUrl(params.srcURL) || /^data:image\//i.test(params.srcURL))) {
      items.push(
        ...(isWebUrl(params.srcURL) ? [{ label: 'Open image in new tab', click: () => openInTab(params.srcURL) }] : []),
        // Goes through Orbit's downloads, so you pick the folder inside Orbit.
        ...(web ? [{ label: 'Save image as…', click: () => page.downloadURL(params.srcURL) }] : []),
        ...(web ? [{ label: 'Save image to attachments', click: () => void saveImage(page, params.srcURL) }] : []),
        { label: 'Copy image', click: () => page.copyImageAt(params.x, params.y) },
        ...(isWebUrl(params.srcURL) ? [{ label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }] : []),
        { type: 'separator' }
      )
    }
    const history = page.navigationHistory
    items.push(
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      { label: 'Reload', click: () => page.reload() }
    )
    if (web && page.getType() === 'webview') {
      items.push(
        { type: 'separator' },
        { label: 'Save page to Inbox', click: () => host()?.send('web:key', { wcId: page.id, key: 'clip-page' }) },
        { label: 'Find on page…', click: () => host()?.send('web:key', { wcId: page.id, key: 'find' }) },
        { label: 'Translate page', click: () => host()?.send('web:key', { wcId: page.id, key: 'translate' }) }
      )
    }
    try {
      Menu.buildFromTemplate(items).popup()
    } catch (err) {
      logError('web page menu', err)
    }
  })
}
