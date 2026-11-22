/** YouTube's addresses: which pages are YouTube's, which video a link points at, and its watch page. */

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

/** The ordinary watch page for a video, starting `seconds` in. */
export function youTubeWatchUrl(id: string, seconds = 0): string {
  const start = Math.floor(seconds)
  return `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${start}s` : ''}`
}

export const youTubeSearchUrl = (query: string): string => `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`
