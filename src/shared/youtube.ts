/**
 * The YouTube mini window: which addresses are YouTube's, and how a pasted link or a few typed
 * words become a page to show in it.
 */

export const YOUTUBE_HOME = 'https://www.youtube.com/'

const YOUTUBE_HOSTS = /^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$|^(www\.)?youtube-nocookie\.com$/i

/** A page on YouTube (any of its addresses). */
export function isYouTubeUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === 'https:' || protocol === 'http:') && YOUTUBE_HOSTS.test(hostname)
  } catch {
    return false
  }
}

const VIDEO_ID = /^[\w-]{11}$/

/** The video a YouTube link points at ("dQw4w9WgXcQ"), or null if it isn't a video. */
export function youTubeVideoId(url: string): string | null {
  if (!isYouTubeUrl(url)) return null
  const u = new URL(url)
  let id: string | null = null
  if (/^youtu\.be$/i.test(u.hostname)) id = u.pathname.split('/')[1] ?? null
  else if (u.pathname === '/watch') id = u.searchParams.get('v')
  else {
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/)
    id = m ? m[2] : null
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** Where in the video a link starts, in whole seconds ("t=90", "t=1m30s", "start=90"), or 0. */
export function youTubeStartTime(url: string): number {
  try {
    const u = new URL(url)
    const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? ''
    if (/^\d+s?$/.test(t)) return parseInt(t, 10)
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    return m ? (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0) : 0
  } catch {
    return 0
  }
}

/** The ordinary watch page for a video, starting `seconds` in. */
export function youTubeWatchUrl(id: string, seconds = 0): string {
  const start = Math.floor(seconds)
  return `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${start}s` : ''}`
}

export const youTubeSearchUrl = (query: string): string => `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`

/**
 * What you typed or pasted in the mini window as a page to show: a video link becomes its watch
 * page (shorts and youtu.be links too), any other YouTube page opens as it is, and anything else
 * is searched for on YouTube. '' for nothing typed.
 */
export function toYouTubeUrl(typed: string): string {
  const text = typed.trim()
  if (!text) return ''
  const link = /^https?:\/\//i.test(text) ? text : `https://${text}`
  const id = youTubeVideoId(link)
  if (id) return youTubeWatchUrl(id, youTubeStartTime(link))
  if (isYouTubeUrl(link) && !/\s/.test(text) && /\./.test(text)) return link
  return youTubeSearchUrl(text)
}
