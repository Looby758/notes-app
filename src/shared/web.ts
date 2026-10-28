/**
 * The web browser tab: what it may load, and how what you type in its address bar becomes a page.
 */

/** Web pages live in their own storage (sign-ins, cookies), apart from the app and your notes. */
export const WEB_PARTITION = 'persist:web'

/** Only real web pages open in the browser tab (not files, the notes folder or anything else). */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * What you typed in the address bar as a page to open: an address ("bbc.co.uk", "localhost:3000",
 * "https://…") as it is, anything else as a web search. '' for nothing typed.
 */
export function toWebUrl(typed: string): string {
  const text = typed.trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? text : searchUrl(text)
  // No spaces, and either a dot in the name or localhost (with or without a port): an address.
  if (!/\s/.test(text) && /^(localhost|[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+)(:\d+)?([/?#].*)?$/iu.test(text)) {
    const secure = !/^(localhost|127\.0\.0\.1)([:/?#]|$)/i.test(text)
    const url = `${secure ? 'https' : 'http'}://${text}`
    if (isWebUrl(url)) return url
  }
  return searchUrl(text)
}

export const searchUrl = (query: string): string => `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`

/** The address bar shows addresses without the "https://" in front, like other browsers. */
export function displayUrl(url: string): string {
  return url.replace(/^https:\/\//i, '').replace(/^([^/?#]+)\/$/, '$1')
}

/**
 * The browser's name as websites see it: the app's own name and Electron's are left out, since some
 * sites (Google sign-in among them) turn away browsers they don't recognise.
 */
export function plainUserAgent(agent: string): string {
  return agent
    .replace(/\s(Electron|notesapp|Notes)\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Google turns away sign-ins from browsers built into other apps ("This browser or app may not be
 * secure" / "unsupported browser"), judging by the browser's name. Its sign-in pages are told the
 * browser is Firefox, which Google accepts.
 */
export function isGoogleSignIn(url: string): boolean {
  try {
    return new URL(url).hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

/** Firefox's browser name on this kind of computer. */
export function firefoxUserAgent(platform: string): string {
  const system =
    platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${system}; rv:140.0) Gecko/20100101 Firefox/140.0`
}
