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
  // Only what Chrome itself sends: any other "Name/1.2.3" (the app's own name, whatever it's
  // called this release, and Electron's) makes sites like WhatsApp say "use Google Chrome".
  return agent
    .replace(/\s([A-Za-z][\w.-]*)\/\S+/g, (token, name: string) => (/^(AppleWebKit|Chrome|Safari)$/.test(name) ? token : ''))
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Google turns away sign-ins from browsers built into other apps ("This browser or app may not be
 * secure" / "unsupported browser"), judging by the browser's name. Its sign-in pages are told the
 * browser is Firefox, which Google accepts.
 *
 * That's every page the sign-in passes through, not just accounts.google.com: once you pick an
 * account, Google sets the sign-in on its other addresses too (accounts.youtube.com,
 * google.com/accounts/…, accounts.google.co.uk…). If any of them hears a different browser, Google
 * drops the sign-in and shows "Choose an account" again.
 */
export function isGoogleSignIn(url: string): boolean {
  try {
    const { protocol, hostname, pathname } = new URL(url)
    if (protocol !== 'https:') return false
    if (/^accounts\.google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(hostname)) return true
    if (hostname === 'accounts.youtube.com') return true
    return /^(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(hostname) && pathname.startsWith('/accounts/')
  } catch {
    return false
  }
}

/**
 * Runs in each web page before the site's own code (src/preload/web.ts). On a Google sign-in page
 * the page itself sees the same Firefox as the request said (`agent`), however the page was opened:
 * a sign-in pop-up's first page, or Google's sign-in button inside another site. Chrome-only details
 * that would contradict it are hidden. Every other page is left alone.
 */
export function firefoxOnGoogleSignIn(agent: string): void {
  // Self-contained: it's copied into the page, so it can't use anything from this file.
  const google = (): boolean => {
    const { protocol, hostname, pathname } = location
    if (protocol !== 'https:') return false
    const tld = '(com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})'
    if (new RegExp(`^accounts\\.google\\.${tld}$`).test(hostname) || hostname === 'accounts.youtube.com') return true
    return new RegExp(`^(www\\.)?google\\.${tld}$`).test(hostname) && pathname.startsWith('/accounts/')
  }
  if (!google()) return
  const define = (name: string, value: unknown): void => {
    try {
      Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
    } catch {
      // Already locked down: leave it.
    }
  }
  define('userAgent', agent)
  define('appVersion', agent.replace(/^Mozilla\//, ''))
  define('vendor', '')
  // Firefox has no userAgentData (Chrome's "which browser am I" details).
  define('userAgentData', undefined)
}

/** Firefox's browser name on this kind of computer. */
export function firefoxUserAgent(platform: string): string {
  const system =
    platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${system}; rv:140.0) Gecko/20100101 Firefox/140.0`
}

/**
 * An address as the sign-in log writes it: the site and the page, without the "?…" and "#…" parts,
 * which is where sign-in codes and tokens travel. Long paths are cut short.
 */
export function traceUrl(url: string): string {
  try {
    const { protocol, host, pathname } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return protocol.replace(/:$/, '')
    const path = pathname.length > 60 ? `${pathname.slice(0, 60)}…` : pathname
    return `${host}${path}`
  } catch {
    return '(not an address)'
  }
}
