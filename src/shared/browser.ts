/**
 * The web browser's own data and the rules around it, shared by the main process (which keeps it)
 * and the window (which shows it). Nothing here uses Electron, so it can be tested.
 *
 * - Bookmarks: a bookmarks bar and "Other bookmarks", with folders, like Chrome and Opera GX.
 * - History: the pages you've visited, searchable by title, address or the words on the page.
 * - Site settings: per site, its zoom, volume and mute, and what it may use (notifications, mic…).
 * - Downloads, autofill (your name, email and address), and importing from Opera GX.
 */

// ---------------------------------------------------------------------------------------------
// Addresses

/** The web tab's own storage for private tabs: kept in memory only, gone when Orbit closes. */
export const PRIVATE_PARTITION = 'web-private'

/** "https://www.bbc.co.uk/news" → "www.bbc.co.uk" ('' for anything that isn't a web address). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** "https://www.bbc.co.uk/news" → "https://www.bbc.co.uk" ('' for anything that isn't a web address). */
export function originOf(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : ''
  } catch {
    return ''
  }
}

/** The site a setting belongs to: the host without "www." ("www.bbc.co.uk" → "bbc.co.uk"). */
export function siteOf(url: string): string {
  return hostOf(url).replace(/^www\./, '')
}

/** Whether a cookie set for `domain` (".google.com", "accounts.google.com") belongs to `site`. */
export function cookieBelongsTo(domain: string, site: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase()
  const s = site.replace(/^www\./, '').toLowerCase()
  if (!d || !s) return false
  return d === s || d.endsWith(`.${s}`) || s.endsWith(`.${d}`)
}

// ---------------------------------------------------------------------------------------------
// Bookmarks

export type BookmarkRoot = 'bar' | 'other'

export interface Bookmark {
  id: string
  kind: 'link' | 'folder'
  title: string
  /** Links only. */
  url?: string
  /** 'bar', 'other', or the id of the folder it's in. */
  parent: string
  created: number
}

export const ROOT_NAMES: Record<BookmarkRoot, string> = { bar: 'Bookmarks bar', other: 'Other bookmarks' }

export const isRoot = (id: string): id is BookmarkRoot => id === 'bar' || id === 'other'

/** What's directly in a folder (or root), in their order. */
export function childrenOf(all: Bookmark[], parent: string): Bookmark[] {
  return all.filter((b) => b.parent === parent)
}

/** The bookmark for this page, if it's bookmarked (the address compared without a trailing "/"). */
export function bookmarkFor(all: Bookmark[], url: string): Bookmark | undefined {
  const key = sameUrlKey(url)
  return all.find((b) => b.kind === 'link' && b.url && sameUrlKey(b.url) === key)
}

const sameUrlKey = (url: string): string => url.trim().replace(/#.*$/, '').replace(/\/$/, '').toLowerCase()

/** A folder and everything inside it, at any depth (for deleting it). */
export function descendantIds(all: Bookmark[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const b of all) {
      if (!out.has(b.id) && out.has(b.parent)) {
        out.add(b.id)
        grew = true
      }
    }
  }
  return out
}

/** Every folder, with its path for showing in a list ("Bookmarks bar / Recipes"). */
export function folderChoices(all: Bookmark[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = []
  const walk = (parent: string, prefix: string): void => {
    for (const f of childrenOf(all, parent).filter((b) => b.kind === 'folder')) {
      const label = `${prefix} / ${f.title || 'Folder'}`
      out.push({ id: f.id, label })
      walk(f.id, label)
    }
  }
  for (const root of ['bar', 'other'] as const) {
    out.push({ id: root, label: ROOT_NAMES[root] })
    walk(root, ROOT_NAMES[root])
  }
  return out
}

/** Moves a bookmark into `parent` (at `index`, or the end). A folder can't go inside itself. */
export function moveBookmark(all: Bookmark[], id: string, parent: string, index?: number): Bookmark[] {
  const item = all.find((b) => b.id === id)
  if (!item) return all
  if (!isRoot(parent) && !all.some((b) => b.id === parent && b.kind === 'folder')) return all
  if (item.kind === 'folder' && descendantIds(all, id).has(parent)) return all
  const rest = all.filter((b) => b.id !== id)
  const moved = { ...item, parent }
  const siblings = rest.filter((b) => b.parent === parent)
  if (index === undefined || index >= siblings.length) {
    const lastSibling = siblings[siblings.length - 1]
    const at = lastSibling ? rest.indexOf(lastSibling) + 1 : rest.length
    return [...rest.slice(0, at), moved, ...rest.slice(at)]
  }
  const before = siblings[Math.max(0, index)]
  const at = rest.indexOf(before)
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/**
 * Takes a folder apart: what was in it goes where the folder was (in the same place, in order),
 * and the folder goes.
 */
export function unwrapFolder(all: Bookmark[], folderId: string): Bookmark[] {
  const folder = all.find((b) => b.id === folderId && b.kind === 'folder')
  if (!folder) return all
  const inside = all.filter((b) => b.parent === folderId).map((b) => ({ ...b, parent: folder.parent }))
  const out: Bookmark[] = []
  for (const b of all) {
    if (b.id === folderId) out.push(...inside)
    else if (b.parent !== folderId) out.push(b)
  }
  return out
}

/**
 * The folders Orbit's own Opera GX import used to wrap bookmarks in ("Imported from Opera GX", and
 * a "Speed Dial" folder inside it), taken apart so their bookmarks sit on the bar themselves.
 * A bookmark that's now there twice keeps its first place.
 */
export function unwrapImportFolders(all: Bookmark[]): Bookmark[] {
  let list = all
  for (;;) {
    const wrapper = list.find((b) => b.kind === 'folder' && /^Imported from Opera GX$/.test(b.title))
    if (!wrapper) break
    const dials = list.filter((b) => b.kind === 'folder' && b.parent === wrapper.id && b.title === 'Speed Dial')
    for (const d of dials) list = unwrapFolder(list, d.id)
    list = unwrapFolder(list, wrapper.id)
  }
  const seen = new Set<string>()
  return list.filter((b) => {
    if (b.kind !== 'link' || !b.url) return true
    const key = b.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Bookmarks matching a search (title or address), links only. */
export function searchBookmarks(all: Bookmark[], query: string): Bookmark[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return all.filter((b) => b.kind === 'link' && words.every((w) => `${b.title} ${b.url ?? ''}`.toLowerCase().includes(w)))
}

/** Repairs a saved bookmarks list (from bookmarks.json), dropping anything broken or orphaned. */
export function cleanBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return []
  const items: Bookmark[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const b = r as Record<string, unknown>
    if (typeof b.id !== 'string' || !b.id || seen.has(b.id) || isRoot(b.id)) continue
    const kind = b.kind === 'folder' ? 'folder' : 'link'
    const url = typeof b.url === 'string' ? b.url : ''
    if (kind === 'link' && !hostOf(url)) continue
    seen.add(b.id)
    items.push({
      id: b.id,
      kind,
      title: typeof b.title === 'string' ? b.title.slice(0, 500) : '',
      ...(kind === 'link' ? { url } : {}),
      parent: typeof b.parent === 'string' ? b.parent : 'other',
      created: typeof b.created === 'number' ? b.created : 0
    })
  }
  const folders = new Set(items.filter((b) => b.kind === 'folder').map((b) => b.id))
  // Anything whose folder has gone goes to Other bookmarks; then any folder loop is broken there too.
  for (const b of items) if (!isRoot(b.parent) && !folders.has(b.parent)) b.parent = 'other'
  for (const b of items) {
    const path = new Set<string>()
    let at: string = b.parent
    while (!isRoot(at) && !path.has(at)) {
      path.add(at)
      at = items.find((x) => x.id === at)?.parent ?? 'other'
    }
    if (!isRoot(at)) b.parent = 'other'
  }
  return items
}

// ---------------------------------------------------------------------------------------------
// History

export interface HistoryEntry {
  url: string
  title: string
  /** Last visited, in milliseconds. */
  visited: number
  visits: number
  /** The start of the words on the page, for searching by what was on it. */
  text: string
}

/** A history search result: the entry without all its text, but with the part that matched. */
export interface HistoryHit {
  url: string
  title: string
  visited: number
  visits: number
  /** Where the words were found on the page, if it was the page's text that matched. */
  snippet?: string
}

/** How many pages history keeps, and how much of each page's text. */
export const HISTORY_LIMIT = 5000
export const HISTORY_TEXT = 2000

/** Records a visit (the newest first; the same address again moves to the top). */
export function addVisit(list: HistoryEntry[], url: string, title: string, now = Date.now()): HistoryEntry[] {
  if (!hostOf(url)) return list
  const old = list.find((e) => e.url === url)
  const entry: HistoryEntry = { url, title: title || old?.title || '', visited: now, visits: (old?.visits ?? 0) + 1, text: old?.text ?? '' }
  return [entry, ...list.filter((e) => e.url !== url)].slice(0, HISTORY_LIMIT)
}

/** Fills in a page's title or text once it's known. */
export function updateVisit(list: HistoryEntry[], url: string, patch: { title?: string; text?: string }): HistoryEntry[] {
  const i = list.findIndex((e) => e.url === url)
  if (i === -1) return list
  const next = [...list]
  next[i] = {
    ...next[i],
    ...(patch.title ? { title: patch.title.slice(0, 500) } : {}),
    ...(patch.text !== undefined ? { text: tidyText(patch.text).slice(0, HISTORY_TEXT) } : {})
  }
  return next
}

const tidyText = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * History matching a search: every word must be in the title, the address or the page's words.
 * Matches in the title or address come before ones only in the page's text; newest first within that.
 * An empty search gives the newest pages.
 */
export function searchHistory(list: HistoryEntry[], query: string, limit = 100): HistoryHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (e: HistoryEntry, snippet?: string): HistoryHit => ({ url: e.url, title: e.title, visited: e.visited, visits: e.visits, ...(snippet ? { snippet } : {}) })
  if (!words.length) return list.slice(0, limit).map((e) => hit(e))
  const strong: HistoryHit[] = []
  const weak: HistoryHit[] = []
  for (const e of list) {
    const head = `${e.title} ${e.url}`.toLowerCase()
    const body = e.text.toLowerCase()
    if (!words.every((w) => head.includes(w) || body.includes(w))) continue
    if (words.every((w) => head.includes(w))) strong.push(hit(e))
    else weak.push(hit(e, snippetAround(e.text, words.find((w) => !head.includes(w)) ?? words[0])))
    if (strong.length >= limit) break
  }
  return [...strong, ...weak].slice(0, limit)
}

/** A few words either side of where `word` is in `text`. */
export function snippetAround(text: string, word: string, room = 60): string {
  const at = text.toLowerCase().indexOf(word.toLowerCase())
  if (at === -1) return text.slice(0, room * 2)
  const from = Math.max(0, at - room)
  const to = Math.min(text.length, at + word.length + room)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`
}

/** Address bar suggestions: bookmarks first, then history, no address twice. */
export function suggestions(bookmarks: Bookmark[], history: HistoryEntry[], typed: string, limit = 6): { url: string; title: string; kind: 'bookmark' | 'history' }[] {
  const q = typed.trim().toLowerCase()
  if (q.length < 2) return []
  const out: { url: string; title: string; kind: 'bookmark' | 'history' }[] = []
  const seen = new Set<string>()
  const add = (url: string, title: string, kind: 'bookmark' | 'history'): void => {
    if (seen.has(url) || out.length >= limit) return
    seen.add(url)
    out.push({ url, title, kind })
  }
  for (const b of searchBookmarks(bookmarks, q)) add(b.url!, b.title, 'bookmark')
  // History by how often it's visited among the matches in the title or address.
  const words = q.split(/\s+/).filter(Boolean)
  const matching = history.filter((e) => words.every((w) => `${e.title} ${e.url}`.toLowerCase().includes(w)))
  matching.sort((a, b) => b.visits - a.visits || b.visited - a.visited)
  for (const e of matching) add(e.url, e.title, 'history')
  return out
}

// ---------------------------------------------------------------------------------------------
// Site settings

/** What a site can ask to use. */
export type SitePermission = 'notifications' | 'microphone' | 'camera' | 'location' | 'clipboard' | 'midi'

export const PERMISSION_NAMES: Record<SitePermission, string> = {
  notifications: 'Notifications',
  microphone: 'Microphone',
  camera: 'Camera',
  location: 'Location',
  clipboard: 'Read the clipboard',
  midi: 'MIDI devices'
}

/** How a site's request is described in the "wants to" bar. */
export const PERMISSION_ASKS: Record<SitePermission, string> = {
  notifications: 'show notifications',
  microphone: 'use your microphone',
  camera: 'use your camera',
  location: 'know your location',
  clipboard: 'see what you’ve copied',
  midi: 'use your MIDI devices'
}

export const SITE_PERMISSIONS = Object.keys(PERMISSION_NAMES) as SitePermission[]

export type Decision = 'allow' | 'block'

export interface SiteSettings {
  /** Page zoom, 1 = 100%. */
  zoom?: number
  /** 0 to 100 (100 when not set). */
  volume?: number
  muted?: boolean
  /** What you've said the site may or may not use (not asked yet when missing). */
  permissions?: Partial<Record<SitePermission, Decision>>
  /** Don't offer to save passwords here. */
  neverSavePasswords?: boolean
}

/** Zoom steps, like Chrome's. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

/** The next zoom step up (`by` 1) or down (-1) from `now`; 0 resets to 100%. */
export function stepZoom(now: number, by: 1 | -1 | 0): number {
  if (by === 0) return 1
  if (by > 0) return ZOOM_STEPS.find((z) => z > now + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((z) => z < now - 0.001) ?? ZOOM_STEPS[0]
}

/** Which of our permissions Chromium's request is for (null: not one a site may have). */
export function permissionFor(chromium: string, mediaTypes: string[] = []): SitePermission[] | null {
  switch (chromium) {
    case 'notifications':
      return ['notifications']
    case 'geolocation':
      return ['location']
    case 'clipboard-read':
      return ['clipboard']
    case 'midi':
    case 'midiSysex':
      return ['midi']
    case 'media': {
      const out: SitePermission[] = []
      if (mediaTypes.includes('audio')) out.push('microphone')
      if (mediaTypes.includes('video')) out.push('camera')
      return out.length ? out : ['microphone', 'camera']
    }
    default:
      return null
  }
}

/** Repairs the saved site settings (sites.json). */
export function cleanSites(raw: unknown): Record<string, SiteSettings> {
  const out: Record<string, SiteSettings> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [site, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!site || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const s: SiteSettings = {}
    if (typeof v.zoom === 'number' && v.zoom >= 0.25 && v.zoom <= 5 && v.zoom !== 1) s.zoom = v.zoom
    if (typeof v.volume === 'number' && v.volume >= 0 && v.volume < 100) s.volume = Math.round(v.volume)
    if (v.muted === true) s.muted = true
    if (v.neverSavePasswords === true) s.neverSavePasswords = true
    if (v.permissions && typeof v.permissions === 'object') {
      const perms: Partial<Record<SitePermission, Decision>> = {}
      for (const p of SITE_PERMISSIONS) {
        const d = (v.permissions as Record<string, unknown>)[p]
        if (d === 'allow' || d === 'block') perms[p] = d
      }
      if (Object.keys(perms).length) s.permissions = perms
    }
    if (Object.keys(s).length) out[site] = s
  }
  return out
}

/** A site's settings with one change made; a site left with nothing set is dropped. */
export function patchSite(all: Record<string, SiteSettings>, site: string, patch: Partial<SiteSettings>): Record<string, SiteSettings> {
  const merged: SiteSettings = { ...all[site], ...patch }
  if (patch.permissions) merged.permissions = { ...all[site]?.permissions, ...patch.permissions }
  const cleaned = cleanSites({ [site]: merged })[site]
  const { [site]: _old, ...rest } = all
  return cleaned ? { ...rest, [site]: cleaned } : rest
}

// ---------------------------------------------------------------------------------------------
// Downloads

export interface WebDownload {
  id: string
  url: string
  /** The file's name. */
  name: string
  /** Where it is (or will be, once it's finished and moved there). '' until you've picked a folder. */
  path: string
  state: 'downloading' | 'paused' | 'done' | 'cancelled' | 'failed'
  received: number
  /** 0 when the site didn't say how big it is. */
  total: number
  started: number
  /** Waiting for you to pick where it goes (it downloads meanwhile). */
  asking?: boolean
  /** From a private tab: not kept in the list after Orbit closes. */
  private?: boolean
}

/** "report.pdf" in a folder that already has one becomes "report (2).pdf". */
export function freeFileName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 2; ; n++) if (!taken(`${base} (${n})${ext}`)) return `${base} (${n})${ext}`
}

/** A name that's safe to save a file under on Windows and a Mac. */
export function safeDownloadName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180)
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean) || !clean ? `download${clean ? `-${clean}` : ''}` : clean
}

// ---------------------------------------------------------------------------------------------
// Autofill

export interface AutofillProfile {
  name: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  county: string
  postcode: string
  country: string
}

export const EMPTY_PROFILE: AutofillProfile = { name: '', email: '', phone: '', address1: '', address2: '', city: '', county: '', postcode: '', country: '' }

export function cleanProfile(raw: unknown): AutofillProfile {
  const out = { ...EMPTY_PROFILE }
  if (!raw || typeof raw !== 'object') return out
  for (const k of Object.keys(EMPTY_PROFILE) as (keyof AutofillProfile)[]) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string') out[k] = v.slice(0, 300)
  }
  return out
}

export const hasProfile = (p: AutofillProfile): boolean => Object.values(p).some((v) => v.trim())

/** What a form field asks for, as far as autofill is concerned. */
export type FieldKind = keyof AutofillProfile | 'given' | 'family' | 'username' | 'password' | 'newPassword'

/** What's known about a field: its type and autocomplete attributes, and the words around it. */
export interface FieldInfo {
  type: string
  autocomplete: string
  /** name, id, placeholder, aria-label and its label's text, run together. */
  words: string
}

const AUTOCOMPLETE: Record<string, FieldKind> = {
  name: 'name',
  'given-name': 'given',
  'family-name': 'family',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'street-address': 'address1',
  'address-line1': 'address1',
  'address-line2': 'address2',
  'address-level2': 'city',
  'address-level1': 'county',
  'postal-code': 'postcode',
  country: 'country',
  'country-name': 'country',
  username: 'username',
  'current-password': 'password',
  'new-password': 'newPassword'
}

/** What a field is for, from its attributes and the words around it (null: nothing autofill knows). */
export function classifyField(f: FieldInfo): FieldKind | null {
  const type = f.type.toLowerCase()
  if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'range', 'color', 'date', 'number'].includes(type)) return null
  const tokens = f.autocomplete.toLowerCase().split(/\s+/).filter(Boolean)
  // (Many sites say autocomplete="off" and mean nothing by it, so the words still count below.)
  for (const t of tokens) if (AUTOCOMPLETE[t]) return AUTOCOMPLETE[t]
  if (type === 'password') return /new|confirm|repeat|again|create/i.test(f.words) ? 'newPassword' : 'password'
  if (type === 'email') return 'email'
  if (type === 'tel') return 'phone'
  const w = f.words.toLowerCase()
  if (/e-?mail/.test(w)) return 'email'
  if (/user(name)?|login|log-in|account|identifier/.test(w)) return 'username'
  if (/phone|mobile|tel\b|telephone/.test(w)) return 'phone'
  if (/post\s*code|postcode|zip|postal/.test(w)) return 'postcode'
  if (/country/.test(w)) return 'country'
  if (/county|state|province|region/.test(w)) return 'county'
  if (/city|town|locality/.test(w)) return 'city'
  if (/address.?(line)?.?2|addr2|address2|flat|apartment|suite/.test(w)) return 'address2'
  if (/address|street|addr|house/.test(w)) return 'address1'
  const business = /company|business|organi[sz]ation|card|user/.test(w)
  // "fullname" before first and last names, since it has "lname" in it.
  if (/full.?name|your.?name/.test(w) && !business) return 'name'
  if (/first.?name|given|forename|(^|[^a-z])fname/.test(w)) return 'given'
  if (/last.?name|surname|family|(^|[^a-z])lname/.test(w)) return 'family'
  if (/\bname\b/.test(w) && !business) return 'name'
  return null
}

/** The value autofill puts in a field of this kind. */
export function profileValue(p: AutofillProfile, kind: FieldKind): string {
  const [given, ...rest] = p.name.trim().split(/\s+/)
  switch (kind) {
    case 'given':
      return given ?? ''
    case 'family':
      return rest.join(' ')
    case 'username':
    case 'password':
    case 'newPassword':
      return ''
    default:
      return p[kind]
  }
}

// ---------------------------------------------------------------------------------------------
// Saved logins on a page

/** Whether a saved login's website is this page's site (the same site, or one of its parts). */
export function loginMatchesPage(loginUrl: string, pageUrl: string): boolean {
  const page = siteOf(pageUrl)
  const raw = loginUrl.trim()
  if (!page || !raw) return false
  const saved = siteOf(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  if (!saved) return false
  return page === saved || page.endsWith(`.${saved}`) || saved.endsWith(`.${page}`)
}

// ---------------------------------------------------------------------------------------------
// Page tools

/** The page in Google Translate, into `language` ("en", "fr"…). */
export function translateUrl(url: string, language: string): string {
  const tl = (language || 'en').split('-')[0].toLowerCase()
  return `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(tl)}&u=${encodeURIComponent(url)}`
}

/** Whether a page in `pageLang` ("fr", "de-DE") is in another language than yours (`mine`, "en-GB"). */
export function isForeign(pageLang: string, mine: string): boolean {
  const a = pageLang.trim().toLowerCase().split(/[-_]/)[0]
  const b = mine.trim().toLowerCase().split(/[-_]/)[0]
  return !!a && !!b && a !== b && /^[a-z]{2,3}$/.test(a)
}

/** Already a Google Translate page (so it isn't offered again). */
export const isTranslated = (url: string): boolean => /(^|\.)translate\.(goog|google\.com)$/.test(hostOf(url))

/**
 * Streaming services that only play protected (DRM) video. Orbit's browser doesn't have Widevine,
 * the protection they need, so their videos won't play here; Orbit says so and offers your other browser.
 */
const DRM_SITES: { site: string; name: string; path?: RegExp }[] = [
  { site: 'nowtv.com', name: 'NOW' },
  { site: 'now.com', name: 'NOW' },
  { site: 'netflix.com', name: 'Netflix' },
  { site: 'disneyplus.com', name: 'Disney+' },
  { site: 'primevideo.com', name: 'Prime Video' },
  { site: 'amazon.co.uk', name: 'Prime Video', path: /^\/(gp\/video|Prime-Video)/i },
  { site: 'amazon.com', name: 'Prime Video', path: /^\/(gp\/video|Prime-Video)/i },
  { site: 'max.com', name: 'Max' },
  { site: 'hbomax.com', name: 'Max' },
  { site: 'hulu.com', name: 'Hulu' },
  { site: 'paramountplus.com', name: 'Paramount+' },
  { site: 'peacocktv.com', name: 'Peacock' },
  { site: 'tv.apple.com', name: 'Apple TV+' },
  { site: 'skygo.sky.com', name: 'Sky Go' },
  { site: 'britbox.com', name: 'BritBox' },
  { site: 'discoveryplus.com', name: 'discovery+' },
  { site: 'dazn.com', name: 'DAZN' },
  { site: 'itvx.com', name: 'ITVX' },
  { site: 'crunchyroll.com', name: 'Crunchyroll' }
]

/** The streaming service this page is on, if it's one that needs protected video. */
export function drmService(url: string): string | null {
  const host = siteOf(url)
  if (!host) return null
  let path = '/'
  try {
    path = new URL(url).pathname
  } catch {
    // just the host, then
  }
  const hit = DRM_SITES.find((d) => (host === d.site || host.endsWith(`.${d.site}`)) && (!d.path || d.path.test(path)))
  return hit?.name ?? null
}

/** The note a clipped page (or part of one) becomes. */
export function clipToNote(clip: { title: string; url: string; text: string; selection: string; saved: Date; summary?: string }): string {
  const date = `${clip.saved.getFullYear()}-${String(clip.saved.getMonth() + 1).padStart(2, '0')}-${String(clip.saved.getDate()).padStart(2, '0')}`
  const title = clip.title.trim() || hostOf(clip.url) || 'Web page'
  const props = ['---', `source: ${clip.url}`, `saved: ${date}`, 'tags: [clipped]', '---', '']
  const link = `[${title.replace(/[[\]]/g, '')}](${clip.url.replace(/\)/g, '%29')})`
  const parts = [`# ${title}`, '', link, '']
  if (clip.summary?.trim()) parts.push('## Summary', '', clip.summary.trim(), '')
  const body = (clip.selection.trim() ? clip.selection : clip.text).trim()
  if (body) {
    if (clip.selection.trim()) parts.push(body.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n'), '')
    else parts.push(body, '')
  }
  return [...props, ...parts].join('\n')
}

/** A note's file name from a page title. */
export function clipName(title: string, url: string): string {
  const clean = (title || hostOf(url) || 'Web page')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return clean || 'Web page'
}

// ---------------------------------------------------------------------------------------------
// Being the default browser

/** What Windows starts Orbit with to open a link (see main/defaultBrowser.ts). */
export const URL_FLAG = '--orbit-url'

/** The web addresses on a command line: `--orbit-url=<address>`, or an address on its own. */
export function urlsFromArgv(argv: string[]): string[] {
  const out: string[] = []
  argv.forEach((a, i) => {
    let url = ''
    if (a.startsWith(`${URL_FLAG}=`)) url = a.slice(URL_FLAG.length + 1)
    else if (a === URL_FLAG && argv[i + 1]) url = argv[i + 1]
    else if (i > 0 && /^https?:\/\//i.test(a) && argv[i - 1] !== URL_FLAG) url = a
    url = url.replace(/^"(.*)"$/, '$1')
    if (url && hostOf(url) && !out.includes(url)) out.push(url)
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// Importing from Opera GX (and other Chromium browsers)

export interface ImportedBookmark {
  title: string
  url?: string
  /** For folders. */
  children?: ImportedBookmark[]
}

/**
 * Chromium's "Bookmarks" file → the bookmarks bar and the rest. Opera's Speed Dial (the start page's
 * tiles, where most Opera GX users keep their sites) goes on the bar too; Opera's trash is left out.
 */
export function parseChromiumBookmarks(json: string): { bar: ImportedBookmark[]; other: ImportedBookmark[] } {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { bar: [], other: [] }
  }
  const roots = (data as { roots?: Record<string, unknown> })?.roots ?? {}
  const isTrash = (name: string): boolean => /^trash$/i.test(name.trim())
  const convert = (node: unknown): ImportedBookmark | null => {
    if (!node || typeof node !== 'object') return null
    const n = node as { type?: string; name?: string; url?: string; children?: unknown[] }
    if (n.type === 'url') return hostOf(n.url ?? '') ? { title: n.name ?? '', url: n.url } : null
    if (n.type === 'folder' || Array.isArray(n.children)) {
      if (isTrash(n.name ?? '')) return null
      return { title: n.name ?? '', children: (n.children ?? []).map(convert).filter((c): c is ImportedBookmark => !!c) }
    }
    return null
  }
  const childrenOfRoot = (key: string): ImportedBookmark[] => convert(roots[key])?.children ?? []
  const bar = childrenOfRoot('bookmark_bar')
  const other = [...childrenOfRoot('other'), ...childrenOfRoot('synced')]
  // Opera keeps its Speed Dial, "Unsorted bookmarks" and its own folders under custom_root.
  const custom = roots.custom_root
  if (custom && typeof custom === 'object') {
    for (const [key, node] of Object.entries(custom as Record<string, unknown>)) {
      if (/trash/i.test(key)) continue
      const c = convert(node)
      if (!c?.children?.length) continue
      if (/speed ?dial/i.test(key)) bar.push(...c.children)
      else other.push({ title: c.title || (key === 'unsorted' ? 'Unsorted bookmarks' : key), children: c.children })
    }
  }
  return { bar, other }
}

/** Chromium's times are microseconds since 1601; this is milliseconds since 1970. */
export const chromiumTime = (t: number | bigint): number => Math.max(0, Math.round(Number(t) / 1000 - 11644473600000))

export interface ImportedLogin {
  url: string
  username: string
  password: string
}

/** Splits a CSV file (quotes and all) into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

/** Logins from a passwords CSV exported by Opera GX, Chrome, Edge or Firefox. */
export function loginsFromCsv(text: string): ImportedLogin[] {
  const [head, ...rows] = parseCsv(text)
  if (!head) return []
  const col = (...names: string[]): number => head.findIndex((h) => names.includes(h.trim().toLowerCase()))
  const url = col('url', 'origin', 'website', 'login_uri')
  const user = col('username', 'login', 'user', 'login_username')
  const pass = col('password', 'login_password')
  if (url === -1 || pass === -1) return []
  return rows
    .map((r) => ({ url: (r[url] ?? '').trim(), username: user === -1 ? '' : (r[user] ?? '').trim(), password: r[pass] ?? '' }))
    .filter((l) => l.password && hostOf(/^[a-z]+:/i.test(l.url) ? l.url : `https://${l.url}`))
}

// ---------------------------------------------------------------------------------------------
// Site icons (favicons)

/** Site icons are kept by host ("www.youtube.com"). */
export const iconKey = (url: string): string => hostOf(url)

/** A site's icon from the ones Orbit has: its own host, then with or without "www.", then the site it's part of. */
export function iconFor(icons: Record<string, string>, url: string): string | undefined {
  const host = hostOf(url)
  if (!host) return undefined
  const bare = host.replace(/^www\./, '')
  const tries = [host, bare, `www.${bare}`]
  const parts = bare.split('.')
  for (let i = 1; i < parts.length - 1; i++) tries.push(parts.slice(i).join('.'), `www.${parts.slice(i).join('.')}`)
  for (const t of tries) if (icons[t]) return icons[t]
  return undefined
}

/** The icon a page's HTML points to (<link rel="icon">), as a full address; null if it names none. */
export function iconLinkFromHtml(html: string, baseUrl: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  let best: { href: string; score: number } | null = null
  for (const tag of links) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1].toLowerCase() ?? ''
    if (!/\bicon\b/.test(rel) || /mask-icon/.test(rel)) continue
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]
    if (!href) continue
    const size = Number(/\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0)
    // Something around 32px looks best on the bar; anything beats nothing.
    const score = size ? 100 - Math.abs(size - 32) : rel.includes('apple-touch') ? 20 : 50
    if (!best || score > best.score) best = { href, score }
  }
  if (!best) return null
  try {
    const full = new URL(best.href.replace(/&amp;/g, '&'), baseUrl).href
    return /^(https?:|data:image\/)/i.test(full) ? full : null
  } catch {
    return null
  }
}
