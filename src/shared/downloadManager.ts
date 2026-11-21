/**
 * The download manager's plain parts (no Electron), so they can be tested: reading pasted links,
 * the overnight window, picking what starts next, a file's name from its link, and the words for
 * sizes, speeds and time left. main/downloadManager.ts runs the downloads.
 */

import { safeDownloadName } from './browser'
import type { DownloadQuality } from './videoDownload'
import { parseVideoLink } from './videoDownload'

/** "file": any link to a file (a zip, an installer, a film…). "video": a YouTube/TikTok… page, downloaded by the video downloader. */
export type DmKind = 'file' | 'video'

export type DmStatus = 'queued' | 'downloading' | 'paused' | 'done' | 'failed'

export interface DmItem {
  id: string
  kind: DmKind
  url: string
  /** The file's name (a guess from the link until the site says). For a video, its title once known. */
  name: string
  /** file: the folder on the computer it goes to. video: a folder in the notes folder ('' is the top). */
  folder: string
  quality?: DownloadQuality
  status: DmStatus
  /** Waits for the overnight hours before it starts. */
  overnight: boolean
  received: number
  /** 0 when the site didn't say. */
  total: number
  /** Bytes a second, while it's downloading. */
  speed?: number
  /** A video's progress (0–1); files use received/total. */
  progress?: number
  /** What it's doing, in words ("Putting it together…"), for videos. */
  stage?: string
  error?: string
  /** Where it ended up: a full path for a file, a notes-folder path for a video. */
  path?: string
  added: number
  finished?: number
  /** The server's version tag, so carrying on only joins pieces of the same file. */
  etag?: string
  modified?: string
  /** It can carry on where it stopped (the site allows it). False: it starts over. */
  resumable?: boolean
}

export interface DmSettings {
  /** How many download at the same time. */
  atOnce: number
  /** "HH:MM", 24-hour. */
  nightStart: string
  nightEnd: string
  /** Overnight downloads that haven't finished pause when the night ends (and carry on the next night). */
  pauseAtNightEnd: boolean
  /** Kilobytes a second for everything together; 0 is no limit. */
  speedLimitKb: number
}

export interface DmState {
  items: DmItem[]
  settings: DmSettings
  /** Inside the overnight hours right now. */
  night: boolean
  /** When the next overnight hours start (ms), or when the current ones end if it's night now. */
  nextChange: number
  /** The web browser's download folder, where files go unless you pick another. */
  defaultFolder: string
}

export interface DmAddRequest {
  urls: string[]
  kind?: DmKind | 'auto'
  folder?: string
  /** The folder in the notes folder that videos go to. */
  videoFolder?: string
  quality?: DownloadQuality
  overnight?: boolean
}

export const DEFAULT_DM_SETTINGS: DmSettings = { atOnce: 2, nightStart: '01:00', nightEnd: '07:00', pauseAtNightEnd: true, speedLimitKb: 0 }

const isTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** Settings read from disk or the window, with anything odd put back to normal. */
export function cleanSettings(s: Partial<DmSettings> | null | undefined): DmSettings {
  const d = DEFAULT_DM_SETTINGS
  const atOnce = Math.round(Number(s?.atOnce))
  const limit = Math.round(Number(s?.speedLimitKb))
  return {
    atOnce: atOnce >= 1 && atOnce <= 6 ? atOnce : d.atOnce,
    nightStart: isTime(s?.nightStart) ? s.nightStart : d.nightStart,
    nightEnd: isTime(s?.nightEnd) ? s.nightEnd : d.nightEnd,
    pauseAtNightEnd: typeof s?.pauseAtNightEnd === 'boolean' ? s.pauseAtNightEnd : d.pauseAtNightEnd,
    speedLimitKb: limit > 0 && limit < 10_000_000 ? limit : 0
  }
}

const minutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Inside the overnight hours (which can cross midnight, like 23:00–07:00). Start = end means all day. */
export function isNight(now: Date, start: string, end: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes()
  const a = minutes(start)
  const b = minutes(end)
  if (a === b) return true
  return a < b ? m >= a && m < b : m >= a || m < b
}

/** The next time (ms) the clock reads `time`, after `now`. Daylight saving is the computer's own. */
export function nextTime(now: Date, time: string): number {
  const at = new Date(now)
  at.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at.getTime()
}

/** When the night next starts, or (during the night) when it ends. */
export function nextNightChange(now: Date, s: DmSettings): number {
  return nextTime(now, isNight(now, s.nightStart, s.nightEnd) ? s.nightEnd : s.nightStart)
}

/** The links in pasted text, one per line or separated by spaces, without repeats. */
export function parseLinks(text: string): string[] {
  const out: string[] = []
  for (const word of text.split(/\s+/)) {
    const url = parseVideoLink(word.replace(/^[<("']+|[>)"',]+$/g, ''))
    if (url && !out.includes(url.href)) out.push(url.href)
  }
  return out
}

const VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|x\.com|twitter\.com|instagram\.com|tiktok\.com|facebook\.com|fb\.watch|reddit\.com|redd\.it|twitch\.tv|vimeo\.com|dailymotion\.com|streamable\.com|soundcloud\.com|bsky\.app|threads\.net|threads\.com|kick\.com)$/i

/** Ends like a file (".zip", ".mp4"…) rather than a page. */
export function looksLikeFile(url: URL): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.(html?|php|aspx?|jsp)$/i.test(url.pathname)
}

/** A link to a video page the video downloader understands (a YouTube video), not a file. */
export function isVideoPage(link: string): boolean {
  const url = parseVideoLink(link)
  if (!url) return false
  return VIDEO_SITES.test(url.hostname) && !looksLikeFile(url)
}

/** The name in a Content-Disposition header (filename* first, as it can hold any letters). */
export function nameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (star) {
    const v = star[1].trim().replace(/^"|"$/g, '')
    const m = /^[\w-]*'[^']*'(.*)$/.exec(v)
    try {
      return decodeURIComponent(m ? m[1] : v)
    } catch {
      // fall through to the plain one
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  if (plain) return (plain[2] ?? plain[1]).trim()
  return null
}

/** A file name for a download: what the site says, else the end of the link, else the site's name. */
export function fileNameFor(link: string, disposition?: string | null): string {
  const said = nameFromDisposition(disposition)
  if (said) return safeDownloadName(said.split(/[\\/]/).pop() ?? said)
  try {
    const url = new URL(link)
    const last = url.pathname.split('/').filter(Boolean).pop()
    if (last) {
      let name = last
      try {
        name = decodeURIComponent(last)
      } catch {
        // keep it as it is
      }
      return safeDownloadName(name)
    }
    return safeDownloadName(`${url.hostname.replace(/^www\./, '')} download`)
  } catch {
    return 'download'
  }
}

/** The whole size from a 206 reply's Content-Range ("bytes 100-199/5000"), or null. */
export function totalFromRange(header: string | null | undefined): number | null {
  const m = /\/(\d+)\s*$/.exec(header ?? '')
  return m ? Number(m[1]) : null
}

/** Should wait for the night (and it isn't night). */
const waiting = (item: DmItem, night: boolean): boolean => item.overnight && !night

/**
 * Which queued downloads start now: in list order, up to `atOnce` running together, overnight
 * ones only during the night.
 */
export function pickNext(items: DmItem[], atOnce: number, night: boolean): string[] {
  const running = items.filter((i) => i.status === 'downloading').length
  const free = Math.max(0, atOnce - running)
  return items
    .filter((i) => i.status === 'queued' && !waiting(i, night))
    .slice(0, free)
    .map((i) => i.id)
}

/** Overnight downloads to pause because the night has ended. */
export function pauseForMorning(items: DmItem[], night: boolean, pauseAtNightEnd: boolean): string[] {
  if (night || !pauseAtNightEnd) return []
  return items.filter((i) => i.status === 'downloading' && i.overnight).map((i) => i.id)
}

/** Moves an item up (-1) or down (1) the list, or to the top ('top'). */
export function moveItem(items: DmItem[], id: string, by: -1 | 1 | 'top'): DmItem[] {
  const i = items.findIndex((x) => x.id === id)
  if (i < 0) return items
  const out = items.slice()
  const [item] = out.splice(i, 1)
  const to = by === 'top' ? 0 : Math.max(0, Math.min(out.length, i + by))
  out.splice(to, 0, item)
  return out
}

/** How far through it is (0–1), or null when nobody knows. */
export function progressOf(item: DmItem): number | null {
  if (item.status === 'done') return 1
  if (item.kind === 'video') return item.progress ?? null
  return item.total > 0 ? Math.min(1, item.received / item.total) : null
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u++
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[u]}`
}

export const speedText = (bytesPerSecond: number): string => `${sizeText(Math.round(bytesPerSecond))}/s`

/** "About 3 min left", "1 hr 20 min left"… or '' when it can't tell. */
export function timeLeft(remaining: number, speed: number | undefined): string {
  if (!speed || speed < 1 || remaining <= 0) return ''
  const s = Math.round(remaining / speed)
  if (s < 60) return `${Math.max(1, s)} sec left`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min left`
  const h = Math.floor(m / 60)
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ''} left`
}

/** "1:00 AM" in the computer's own clock style. */
export function clockText(time: string, locale?: string): string {
  const d = new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3, 5)))
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/** Plain words for a failed download's HTTP status. */
export function explainStatus(status: number): string {
  if (status === 401 || status === 403) return 'The site wouldn’t let Orbit download it. If it needs you signed in, sign in once in an Orbit web tab and try again.'
  if (status === 404 || status === 410) return 'The file isn’t there any more (the link may have run out).'
  if (status === 429) return 'The site says too many downloads at once. Try again in a while.'
  if (status >= 500) return `The site had a problem (${status}). Try again later.`
  return `The download didn’t work (${status}).`
}
