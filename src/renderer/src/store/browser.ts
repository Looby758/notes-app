import { create } from 'zustand'
import {
  bookmarkFor,
  descendantIds,
  moveBookmark,
  type AutofillProfile,
  type Bookmark,
  type SitePermission,
  type SiteSettings,
  type WebDownload
} from '@shared/browser'
import { EMPTY_PROFILE } from '@shared/browser'
import { notify } from './notify'

/**
 * The web browser's shared state for the window: bookmarks, downloads, site settings, and what each
 * web tab's page is doing (playing sound, zoomed, asking for a permission). main/browser.ts keeps
 * the real copies and sends changes; web tabs are matched to their pages by the page's id (wcId).
 */

export interface PermissionAsk {
  id: string
  wcId: number
  site: string
  permissions: SitePermission[]
}

interface BrowserState {
  bookmarks: Bookmark[]
  downloads: WebDownload[]
  sites: Record<string, SiteSettings>
  profile: AutofillProfile
  /** By web tab id. */
  audio: Record<string, { audible: boolean; muted: boolean }>
  /** By page id (wcId). */
  zoom: Record<number, number>
  asks: PermissionAsk[]
  /** The download that was just started, and the page it came from, for its "Save to" question. */
  started: { id: string; wcId: number | null } | null
}

export const useBrowser = create<BrowserState>(() => ({
  bookmarks: [],
  downloads: [],
  sites: {},
  profile: { ...EMPTY_PROFILE },
  audio: {},
  zoom: {},
  asks: [],
  started: null
}))

/** Web tabs by their page's id (WebPage fills it in once the page is ready). */
export const tabsByPage = new Map<number, string>()

let started = false

/** Listens to the main process (once per window). */
export function startBrowser(): void {
  if (started) return
  started = true
  void window.api.webBookmarks().then((bookmarks) => useBrowser.setState({ bookmarks }))
  void window.api.webDownloads().then((downloads) => useBrowser.setState({ downloads }))
  void window.api.webSites().then((sites) => useBrowser.setState({ sites }))
  void window.api.webAutofill().then((profile) => useBrowser.setState({ profile })).catch(() => undefined)
  window.api.onWebBookmarks((bookmarks) => useBrowser.setState({ bookmarks }))
  window.api.onWebDownloads((downloads) => useBrowser.setState({ downloads }))
  window.api.onWebSites((sites) => useBrowser.setState({ sites }))
  window.api.onWebAutofill((profile) => useBrowser.setState({ profile }))
  window.api.onWebDownloadStarted((e) => useBrowser.setState({ started: e }))
  window.api.onWebZoomed(({ wcId, zoom }) => useBrowser.setState((s) => ({ zoom: { ...s.zoom, [wcId]: zoom } })))
  window.api.onWebAudio(({ wcId, audible, muted }) => {
    const tab = tabsByPage.get(wcId)
    if (tab) useBrowser.setState((s) => ({ audio: { ...s.audio, [tab]: { audible, muted } } }))
  })
  window.api.onWebPermissionAsk((ask) => useBrowser.setState((s) => ({ asks: [...s.asks.filter((a) => a.wcId !== ask.wcId || a.site !== ask.site), ask] })))
  window.api.onWebImageSaved((path, error) => notify(path ? `Picture saved to ${path}` : error || 'Couldn’t save that picture.', path ? 'info' : 'error'))
}

export function answerPermission(ask: PermissionAsk, allow: boolean): void {
  useBrowser.setState((s) => ({ asks: s.asks.filter((a) => a.id !== ask.id) }))
  void window.api.webPermissionAnswer(ask.id, allow)
}

// ---------- bookmarks ----------

const newId = (): string => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function saveBookmarks(list: Bookmark[]): void {
  useBrowser.setState({ bookmarks: list })
  window.api.webSetBookmarks(list).then(
    (saved) => useBrowser.setState({ bookmarks: saved }),
    (err) => notify(err)
  )
}

/** Bookmarks a page (on the bookmarks bar unless you say where); returns the bookmark. */
export function addBookmark(url: string, title: string, parent = 'bar'): Bookmark {
  const { bookmarks } = useBrowser.getState()
  const have = bookmarkFor(bookmarks, url)
  if (have) return have
  const b: Bookmark = { id: newId(), kind: 'link', title: title || url, url, parent, created: Date.now() }
  saveBookmarks([...bookmarks, b])
  return b
}

export function addFolder(title: string, parent = 'bar'): Bookmark {
  const f: Bookmark = { id: newId(), kind: 'folder', title: title || 'New folder', parent, created: Date.now() }
  saveBookmarks([...useBrowser.getState().bookmarks, f])
  return f
}

export function updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url'>>): void {
  saveBookmarks(useBrowser.getState().bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
}

export function placeBookmark(id: string, parent: string, index?: number): void {
  saveBookmarks(moveBookmark(useBrowser.getState().bookmarks, id, parent, index))
}

/** Removes a bookmark (a folder with everything in it). */
export function removeBookmark(id: string): void {
  const all = useBrowser.getState().bookmarks
  const gone = descendantIds(all, id)
  saveBookmarks(all.filter((b) => !gone.has(b.id)))
}

// ---------- sites ----------

export function setSite(site: string, patch: Partial<SiteSettings>): void {
  void window.api.webSiteSet(site, patch).then((sites) => useBrowser.setState({ sites }), notify)
}
