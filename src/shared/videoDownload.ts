/**
 * The video downloader's plain parts (no Electron), so they can be tested: reading a pasted link,
 * the yt-dlp options for each quality, reading its progress lines, putting its errors into plain
 * words, and the sign-in cookies file it reads. main/videoDownload.ts runs it.
 */

export type DownloadQuality = '1080' | '720' | 'audio'

export const DOWNLOAD_QUALITIES: { id: DownloadQuality; label: string }[] = [
  { id: '1080', label: 'Best (up to 1080p)' },
  { id: '720', label: 'Smaller (720p)' },
  { id: 'audio', label: 'Sound only (MP3)' }
]

/** The yt-dlp program for each kind of computer, as named in its GitHub releases. */
export const YTDLP_ASSETS: Record<string, string> = {
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-x64': 'yt-dlp_macos',
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64'
}

/** Finds a file's SHA-256 in a release's SHA2-256SUMS list ("<hash>  <name>" lines). */
export function checksumFor(sums: string, asset: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim())
    if (m && m[2] === asset) return m[1].toLowerCase()
  }
  return null
}

/** A pasted link as a web address, or null if it isn't one ("youtu.be/abc" gets its https:// added). */
export function parseVideoLink(text: string): URL | null {
  let t = text.trim()
  if (!t || /\s/.test(t)) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = `https://${t}`
  try {
    const url = new URL(t)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.') || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

const SITES: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, 'YouTube'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'],
  [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, 'Reddit'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)dailymotion\.com$/, 'Dailymotion'],
  [/(^|\.)streamable\.com$/, 'Streamable'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest'],
  [/(^|\.)kick\.com$/, 'Kick']
]

/** "YouTube", "TikTok"… or the site's address for anywhere else. */
export function siteName(url: URL): string {
  const host = url.hostname.toLowerCase()
  for (const [re, name] of SITES) if (re.test(host)) return name
  return host.replace(/^www\./, '')
}

export const isYouTube = (url: URL): boolean => siteName(url) === 'YouTube'

/** yt-dlp's -f (and friends) for a quality. Without ffmpeg, only files that come ready-joined can be used. */
export function formatArgs(quality: DownloadQuality, ffmpeg: boolean): string[] {
  if (quality === 'audio') {
    return ffmpeg ? ['-f', 'ba[ext=m4a]/ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'] : ['-f', 'ba[ext=m4a]/ba[ext=mp3]/ba/b']
  }
  const h = `[height<=${quality}]`
  if (!ffmpeg) return ['-f', `b${h}[ext=mp4]/b${h}/b`]
  // H.264 and AAC in an MP4 first: those play everywhere (Orbit, phones, Discord, WhatsApp).
  return ['-f', `bv*${h}[vcodec^=avc1]+ba[ext=m4a]/bv*${h}[ext=mp4]+ba[ext=m4a]/bv*${h}+ba/b${h}/b`, '--merge-output-format', 'mp4']
}

export const PROGRESS_TAG = '[orbit]'

export interface DownloadArgsInput {
  url: string
  quality: DownloadQuality
  outDir: string
  ffmpeg?: string | null
  cookies?: string | null
  /** A JavaScript runtime for YouTube's player code ("node:/path/to/it"). */
  jsRuntime?: string | null
}

/** Everything yt-dlp is told for one download. The link goes last, after "--", so it can't be read as an option. */
export function downloadArgs(i: DownloadArgsInput): string[] {
  return [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--no-colors',
    '--no-mtime',
    '--windows-filenames',
    '--progress-template',
    `download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
    '-P',
    i.outDir,
    '-o',
    '%(title).120B.%(ext)s',
    ...formatArgs(i.quality, !!i.ffmpeg),
    ...(i.ffmpeg ? ['--ffmpeg-location', i.ffmpeg] : []),
    ...(i.jsRuntime ? ['--js-runtimes', i.jsRuntime] : []),
    ...(i.cookies ? ['--cookies', i.cookies] : []),
    '--',
    i.url
  ]
}

export type DownloadStage = 'starting' | 'video' | 'sound' | 'joining' | 'saving'

export type DownloadLine =
  | { kind: 'progress'; done: number | null }
  | { kind: 'part'; title: string }
  | { kind: 'joining' }
  | null

/** Reads one line of yt-dlp's output. */
export function readLine(line: string): DownloadLine {
  const t = line.trim()
  if (t.startsWith(PROGRESS_TAG)) {
    const [got, total, estimate] = t.slice(PROGRESS_TAG.length).trim().split(/\s+/).map(Number)
    const of = total > 0 ? total : estimate > 0 ? estimate : 0
    return { kind: 'progress', done: of && Number.isFinite(got) ? Math.min(1, Math.max(0, got / of)) : null }
  }
  const dest = /^\[download\] Destination: (.+)$/.exec(t)
  if (dest) return { kind: 'part', title: titleOf(dest[1]) }
  if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|FixupStretched|FixupM4a)\]/.test(t)) return { kind: 'joining' }
  return null
}

/** "C:\x\My clip.f137.mp4" → "My clip" */
export function titleOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return name.replace(/(\.f[\w-]+)?\.\w+$/, '') || name
}

/** yt-dlp's error lines in plain words. */
export function explainDownloadError(log: string, site: string): string {
  const errors = log
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ERROR:'))
    .join('\n')
  const text = errors || log
  if (/Unsupported URL/i.test(text)) return 'Orbit couldn’t find a video at that link.'
  if (/No space left/i.test(text)) return 'There’s no room left on this computer for the video.'
  if (/not a bot/i.test(text)) return `${site} wants to check you’re not a robot. Try again in a little while.`
  if (/private/i.test(text)) return 'That video is private, so it can’t be downloaded.'
  if (/confirm your age|age.?restrict|inappropriate for some users/i.test(text)) return 'That video is age-restricted, so it can’t be downloaded.'
  if (/log ?in|sign ?in|login required|cookies|rate.?limit|authenticat/i.test(text))
    return `${site} wants you signed in for this one. Sign in to ${site} in an Orbit web tab, then try again.`
  if (/Requested format is not available/i.test(text)) return 'That quality isn’t available for this video. Try another one.'
  if (/unavailable|removed|deleted|not found|HTTP Error 404|does not exist/i.test(text)) return 'That video isn’t there any more (it may have been deleted).'
  if (/live event will begin|is upcoming|Premieres in/i.test(text)) return 'That video hasn’t started yet.'
  if (/getaddrinfo|Unable to download|timed out|Connection|Network is unreachable/i.test(text)) return 'Orbit couldn’t reach the site. Check your internet and try again.'
  const last = (errors.split('\n').pop() ?? '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '').trim()
  return last ? `The video couldn’t be downloaded: ${last.slice(0, 200)}` : 'The video couldn’t be downloaded.'
}

export interface WebCookie {
  name: string
  value: string
  domain?: string
  hostOnly?: boolean
  path?: string
  secure?: boolean
  expirationDate?: number
}

/** "www.instagram.com" → "instagram.com" (good enough for the sites this is for). */
export function baseDomain(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').split('.').slice(-2).join('.')
}

/**
 * A cookies.txt (the Netscape format yt-dlp reads) with only the cookies for the link's own site,
 * so sites that need you signed in (Instagram, X…) see your Orbit web tab sign-in. Null if there are none.
 */
export function cookiesFile(cookies: WebCookie[], host: string): string | null {
  const site = baseDomain(host)
  const lines: string[] = []
  for (const c of cookies) {
    const domain = (c.domain ?? '').toLowerCase()
    const bare = domain.replace(/^\./, '')
    if (!bare || (bare !== site && !bare.endsWith(`.${site}`))) continue
    if (/[\t\r\n]/.test(c.name + c.value)) continue
    const sub = !c.hostOnly
    lines.push([sub && !domain.startsWith('.') ? `.${domain}` : domain, sub ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate ?? 0), c.name, c.value].join('\t'))
  }
  return lines.length ? `# Netscape HTTP Cookie File\n${lines.join('\n')}\n` : null
}
