/**
 * Grok, xAI's chat bot, inside Orbit: the real grok.com in a walled-off web page (like the web
 * browser tab), either in a tab of its own or in a small panel that floats over your notes inside
 * the Orbit window, so it isn't another window to keep track of.
 */

export const GROK_URL = 'https://grok.com/'

/** Grok's own addresses, which the tab and the panel remember as the place to come back to. */
const GROK_HOSTS = ['grok.com']

/** Whether `url` is a page on grok.com (a chat, the home page…), not a sign-in page or a link out. */
export function isGrokUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && GROK_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** Where the floating panel sits in the Orbit window, in CSS pixels from its top-left corner. */
export interface FloatRect {
  x: number
  y: number
  width: number
  height: number
}

/** The panel's smallest size: enough for Grok's chat box and a few lines of answer. */
export const FLOAT_MIN = { width: 320, height: 360 }

/** How much of the panel's top bar stays inside the window, so it can always be dragged back. */
const KEEP = 48

/** The panel's place the first time: the bottom-right corner, out of the way of the note. */
export function defaultFloat(view: { width: number; height: number }): FloatRect {
  const width = Math.min(420, Math.max(FLOAT_MIN.width, view.width - 32))
  const height = Math.min(600, Math.max(FLOAT_MIN.height, view.height - 96))
  return clampFloat({ x: view.width - width - 24, y: view.height - height - 40, width, height }, view)
}

/**
 * The panel kept usable in a window of size `view`: no smaller than FLOAT_MIN, no bigger than the
 * window, and with its top bar on screen (the window may have shrunk since it was put there).
 */
export function clampFloat(r: FloatRect, view: { width: number; height: number }): FloatRect {
  const num = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)
  const width = Math.round(Math.max(FLOAT_MIN.width, Math.min(num(r.width, FLOAT_MIN.width), view.width)))
  const height = Math.round(Math.max(FLOAT_MIN.height, Math.min(num(r.height, FLOAT_MIN.height), view.height)))
  const x = Math.round(Math.min(Math.max(num(r.x, 0), KEEP - width), view.width - KEEP))
  const y = Math.round(Math.min(Math.max(num(r.y, 0), 0), Math.max(0, view.height - KEEP)))
  return { x, y, width, height }
}
