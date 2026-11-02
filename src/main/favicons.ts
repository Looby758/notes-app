import { app, BrowserWindow, session, type Session, type WebContents } from 'electron'
import { promises as fs, readFileSync } from 'fs'
import { join } from 'path'
import { hostOf, iconLinkFromHtml } from '@shared/browser'
import { WEB_PARTITION } from '@shared/web'
import { logError } from './log'

/**
 * Site icons (favicons) for bookmarks, history and web tabs: the YouTube logo on the YouTube
 * bookmark. Kept by host in the settings folder's browser/favicons.json, as small data: pictures,
 * so they show straight away and offline. They come from:
 * - pages you visit in web tabs (never private tabs);
 * - Opera GX's own icon store, when you import from it (operaImport.ts);
 * - looking them up for bookmarks Orbit hasn't seen yet: the site's /favicon.ico, or the icon its
 *   home page points to.
 */

const file = (): string => join(app.getPath('userData'), 'browser', 'favicons.json')

/** The largest icon kept (anything bigger is a photo, not an icon). */
const MAX_BYTES = 150 * 1024
/** A site that had no icon isn't asked again for a week. */
const RETRY_MS = 7 * 24 * 60 * 60 * 1000

interface Saved {
  icons: Record<string, string>
  /** When looking a host's icon up last failed. */
  missing: Record<string, number>
}

let saved: Saved | null = null

function load(): Saved {
  if (!saved) {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Saved>
      saved = { icons: raw.icons && typeof raw.icons === 'object' ? raw.icons : {}, missing: raw.missing && typeof raw.missing === 'object' ? raw.missing : {} }
    } catch {
      saved = { icons: {}, missing: {} }
    }
  }
  return saved
}

let saveTimer: NodeJS.Timeout | undefined
function saveSoon(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(join(app.getPath('userData'), 'browser'), { recursive: true })
      const tmp = `${file()}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify(load()))
      await fs.rename(tmp, file())
    } catch (err) {
      logError('site icons', err)
    }
  }, 2000)
}

export const getFavicons = (): Record<string, string> => load().icons

/** Keeps a host's icon and tells the windows. */
export function rememberFavicon(host: string, dataUrl: string): void {
  if (!host || !/^data:image\//i.test(dataUrl) || dataUrl.length > MAX_BYTES * 1.4) return
  const s = load()
  if (s.icons[host] === dataUrl) return
  s.icons[host] = dataUrl
  delete s.missing[host]
  saveSoon()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('web:favicons', { [host]: dataUrl })
}

const looksLikeImage = (type: string, bytes: Buffer): boolean =>
  /^image\//i.test(type) ||
  // Some sites send icons as "application/octet-stream": .ico starts 00 00 01 00, PNG 89 50 4E 47.
  (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) ||
  (bytes[0] === 0x89 && bytes[1] === 0x50)

/** An icon at `url`, as a data: picture (null if it isn't a small picture). */
async function fetchIcon(ses: Session, url: string): Promise<string | null> {
  if (/^data:image\//i.test(url)) return url.length <= MAX_BYTES * 1.4 ? url : null
  try {
    const res = await ses.fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!bytes.length || bytes.length > MAX_BYTES || !looksLikeImage(type, bytes)) return null
    if (!/^image\//.test(type)) type = bytes[0] === 0x89 ? 'image/png' : 'image/x-icon'
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** A web tab's page told us its icon: keep it for its host. */
export function watchFavicons(page: WebContents): void {
  page.on('page-favicon-updated', (_e, favicons) => {
    const host = hostOf(page.getURL())
    const first = favicons.find((f) => /^(https?:|data:image\/)/i.test(f))
    if (!host || !first) return
    void fetchIcon(page.session, first).then((icon) => icon && rememberFavicon(host, icon))
  })
}

/** Looks up a site's icon: its /favicon.ico, or the one its page points to. */
async function lookUp(url: string): Promise<string | null> {
  const ses = session.fromPartition(WEB_PARTITION)
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return null
  }
  // The page's own choice first (it's often better than /favicon.ico), then /favicon.ico.
  for (const page of [url, `${origin}/`]) {
    try {
      const res = await ses.fetch(page, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') ?? '')) continue
      const html = (await res.text()).slice(0, 300_000)
      const link = iconLinkFromHtml(html, res.url || page)
      const icon = link ? await fetchIcon(ses, link) : null
      if (icon) return icon
    } catch {
      // try the next
    }
  }
  return fetchIcon(ses, `${origin}/favicon.ico`)
}

const lookingUp = new Set<string>()

/** Finds icons for the sites in `urls` that don't have one yet (a few at a time, in the background). */
export async function findMissingFavicons(urls: string[]): Promise<void> {
  const s = load()
  const now = Date.now()
  const byHost = new Map<string, string>()
  for (const url of urls) {
    const host = hostOf(url)
    if (!host || s.icons[host] || lookingUp.has(host) || now - (s.missing[host] ?? 0) < RETRY_MS) continue
    if (!byHost.has(host)) byHost.set(host, url)
  }
  const queue = [...byHost]
  for (const [host] of queue) lookingUp.add(host)
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [host, url] = next
      const icon = await lookUp(url)
      lookingUp.delete(host)
      if (icon) rememberFavicon(host, icon)
      else {
        load().missing[host] = Date.now()
        saveSoon()
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}
