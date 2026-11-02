import { app, safeStorage } from 'electron'
import { promises as fs, readFileSync } from 'fs'
import { join } from 'path'
import {
  addVisit,
  cleanBookmarks,
  cleanProfile,
  cleanSites,
  EMPTY_PROFILE,
  patchSite,
  updateVisit,
  type AutofillProfile,
  type Bookmark,
  type HistoryEntry,
  type SiteSettings,
  type WebDownload
} from '@shared/browser'
import { logError } from './log'

/**
 * What the web browser remembers, in the settings folder's "browser" folder (on this computer
 * only, not in your notes):
 *
 * - bookmarks.json, history.json and sites.json (zoom, volume and what each site may use);
 * - downloads.json: the recent downloads list;
 * - autofill.bin: your name, email and address for filling in forms, encrypted with the system's
 *   own protection (Windows' data protection, or the Mac Keychain).
 *
 * Private tabs never write anything here.
 */

const dir = (): string => join(app.getPath('userData'), 'browser')
const file = (name: string): string => join(dir(), name)

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(file(name), 'utf8'))
  } catch {
    return null
  }
}

const timers = new Map<string, NodeJS.Timeout>()
const pendingWrites = new Map<string, () => string>()

/** Writes a file a moment later (so a burst of changes is one write), safely via a temporary file. */
function saveSoon(name: string, content: () => string, delay = 1500): void {
  pendingWrites.set(name, content)
  clearTimeout(timers.get(name))
  timers.set(
    name,
    setTimeout(() => void writeNow(name), delay)
  )
}

async function writeNow(name: string): Promise<void> {
  const content = pendingWrites.get(name)
  if (!content) return
  pendingWrites.delete(name)
  clearTimeout(timers.get(name))
  timers.delete(name)
  try {
    await fs.mkdir(dir(), { recursive: true })
    const tmp = `${file(name)}.${process.pid}.tmp`
    await fs.writeFile(tmp, content(), 'utf8')
    await fs.rename(tmp, file(name))
  } catch (err) {
    logError(`browser ${name}`, err)
  }
}

/** Writes everything that's waiting (before Orbit quits). */
export async function flushBrowserData(): Promise<void> {
  await Promise.all([...pendingWrites.keys()].map(writeNow))
}

// ---------- bookmarks ----------

let bookmarks: Bookmark[] | null = null

export function getBookmarks(): Bookmark[] {
  bookmarks ??= cleanBookmarks(readJson('bookmarks.json'))
  return bookmarks
}

export function setBookmarks(next: Bookmark[]): void {
  bookmarks = cleanBookmarks(next)
  saveSoon('bookmarks.json', () => JSON.stringify(bookmarks), 300)
}

// ---------- history ----------

let history: HistoryEntry[] | null = null

export function getHistory(): HistoryEntry[] {
  if (!history) {
    const raw = readJson('history.json')
    history = Array.isArray(raw)
      ? raw.filter((e): e is HistoryEntry => !!e && typeof e.url === 'string' && typeof e.visited === 'number').map((e) => ({
          url: e.url,
          title: typeof e.title === 'string' ? e.title : '',
          visited: e.visited,
          visits: typeof e.visits === 'number' ? e.visits : 1,
          text: typeof e.text === 'string' ? e.text : ''
        }))
      : []
  }
  return history
}

const saveHistory = (): void => saveSoon('history.json', () => JSON.stringify(history), 5000)

export function recordVisit(url: string, title: string): void {
  history = addVisit(getHistory(), url, title)
  saveHistory()
}

export function recordPage(url: string, patch: { title?: string; text?: string }): void {
  history = updateVisit(getHistory(), url, patch)
  saveHistory()
}

export function setHistory(next: HistoryEntry[]): void {
  history = next
  saveHistory()
}

// ---------- site settings ----------

let sites: Record<string, SiteSettings> | null = null

export function getSites(): Record<string, SiteSettings> {
  sites ??= cleanSites(readJson('sites.json'))
  return sites
}

export const siteSettings = (site: string): SiteSettings => getSites()[site] ?? {}

export function setSite(site: string, patch: Partial<SiteSettings>): void {
  sites = patchSite(getSites(), site, patch)
  saveSoon('sites.json', () => JSON.stringify(sites, null, 1), 500)
}

export function forgetSite(site: string): void {
  const { [site]: _gone, ...rest } = getSites()
  sites = rest
  saveSoon('sites.json', () => JSON.stringify(sites, null, 1), 500)
}

// ---------- downloads ----------

export interface BrowserMisc {
  /** The folder downloads go to unless you pick another ('' for the computer's Downloads folder). */
  downloadFolder: string
}

let misc: BrowserMisc | null = null

export function getMisc(): BrowserMisc {
  if (!misc) {
    const raw = (readJson('browser.json') ?? {}) as Partial<BrowserMisc>
    misc = { downloadFolder: typeof raw.downloadFolder === 'string' ? raw.downloadFolder : '' }
  }
  return misc
}

export function setMisc(patch: Partial<BrowserMisc>): void {
  misc = { ...getMisc(), ...patch }
  saveSoon('browser.json', () => JSON.stringify(misc), 200)
}

export const defaultDownloadFolder = (): string => getMisc().downloadFolder || app.getPath('downloads')

/** The last downloads (finished ones are remembered between launches). */
export function loadDownloads(): WebDownload[] {
  const raw = readJson('downloads.json')
  if (!Array.isArray(raw)) return []
  return raw
    .filter((d): d is WebDownload => !!d && typeof d.id === 'string' && typeof d.path === 'string' && typeof d.name === 'string')
    .map((d) => ({ ...d, asking: undefined, state: d.state === 'done' ? 'done' : d.state === 'cancelled' ? 'cancelled' : 'failed' }))
}

export function saveDownloads(list: WebDownload[]): void {
  saveSoon('downloads.json', () => JSON.stringify(list.filter((d) => d.state !== 'downloading' && d.state !== 'paused').slice(0, 50)), 1000)
}

// ---------- autofill ----------

let profile: AutofillProfile | null = null

export function getProfile(): AutofillProfile {
  if (profile) return profile
  try {
    const data = readFileSync(file('autofill.bin'))
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : ''
    profile = cleanProfile(JSON.parse(text))
  } catch {
    profile = { ...EMPTY_PROFILE }
  }
  return profile
}

/** Keeps your details; `saved` is false when this computer can't encrypt them (they last until Orbit closes). */
export async function setProfile(next: unknown): Promise<{ profile: AutofillProfile; saved: boolean }> {
  profile = cleanProfile(next)
  if (!safeStorage.isEncryptionAvailable()) return { profile, saved: false }
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(file('autofill.bin'), safeStorage.encryptString(JSON.stringify(profile)))
  return { profile, saved: true }
}
