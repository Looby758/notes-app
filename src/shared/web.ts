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
  // Firefox has no userAgentData (Chrome's "which browser am I" details), and no window.chrome.
  define('userAgentData', undefined)
  try {
    delete (window as { chrome?: unknown }).chrome
  } catch {
    // leave it
  }
}

// ---------------------------------------------------------------------------------------------
// Looking like Google Chrome

/**
 * Electron says "Chrome/136" in its browser name, but sends none of the "client hints" real Chrome
 * sends with every secure request (which browser, what version, on what), and tells pages it's plain
 * "Chromium" with an empty `window.chrome`. Google's sign-in treats that mismatch as a browser built
 * into an app: "This browser or app may not be secure". So web pages get what Google Chrome sends.
 */

/** The platform name Chrome's client hints use. */
export function hintPlatform(platform: string): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : 'Unknown'
}

/** Chrome's brand list for a version ("136.0.7103.177"): with `full`, the full versions. */
export function chromeBrands(version: string, full = false): { brand: string; version: string }[] {
  const major = version.split('.')[0] || '0'
  const v = full ? version : major
  return [
    { brand: 'Chromium', version: v },
    { brand: 'Google Chrome', version: v },
    { brand: 'Not.A/Brand', version: full ? '99.0.0.0' : '99' }
  ]
}

const brandHeader = (brands: { brand: string; version: string }[]): string => brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')

/**
 * The client hints Google Chrome sends with a secure request: the usual three always, and the
 * fuller ones a site asked for (Accept-CH) only when Chromium already sends them (it fills those in
 * itself, just with the wrong brands, which are put right here). Headers already there are corrected.
 */
export function chromeHints(headers: Record<string, string>, version: string, platform: string): Record<string, string> {
  const out = { ...headers }
  const find = (name: string): string | undefined => Object.keys(out).find((k) => k.toLowerCase() === name)
  const set = (name: string, value: string): void => {
    const have = find(name)
    if (have && have !== name) delete out[have]
    out[name] = value
  }
  set('sec-ch-ua', brandHeader(chromeBrands(version)))
  if (!find('sec-ch-ua-mobile')) set('sec-ch-ua-mobile', '?0')
  if (!find('sec-ch-ua-platform')) set('sec-ch-ua-platform', `"${hintPlatform(platform)}"`)
  if (find('sec-ch-ua-full-version-list')) set('sec-ch-ua-full-version-list', brandHeader(chromeBrands(version, true)))
  return out
}

/**
 * Runs in each web page before the site's own code (src/preload/web.ts): the page sees Google
 * Chrome's brands, and a `window.chrome` like Chrome's. Self-contained: it's copied into the page.
 */
export function chromeInPage(version: string, platform: string): void {
  const major = version.split('.')[0] || '0'
  const brands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not.A/Brand', version: '99' }
  ]
  const fullList = [
    { brand: 'Chromium', version },
    { brand: 'Google Chrome', version },
    { brand: 'Not.A/Brand', version: '99.0.0.0' }
  ]
  const proto = (window as { NavigatorUAData?: { prototype: object } }).NavigatorUAData?.prototype as
    | { getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>> }
    | undefined
  if (proto) {
    try {
      Object.defineProperty(proto, 'brands', { get: () => brands.map((b) => ({ ...b })), configurable: true })
      Object.defineProperty(proto, 'platform', { get: () => platform, configurable: true })
      const high = proto.getHighEntropyValues
      if (high) {
        proto.getHighEntropyValues = function (this: unknown, hints: string[]) {
          return high.call(this, hints).then((v) => ({
            ...v,
            brands: brands.map((b) => ({ ...b })),
            platform,
            ...(hints.includes('fullVersionList') ? { fullVersionList: fullList.map((b) => ({ ...b })) } : {}),
            ...(hints.includes('uaFullVersion') ? { uaFullVersion: version } : {})
          }))
        }
      }
    } catch {
      // leave it
    }
  }
  // Chrome gives every page window.chrome with app, csi and loadTimes; Electron's is empty.
  const w = window as { chrome?: Record<string, unknown> }
  const chrome = (w.chrome ??= {})
  if (!chrome.app) {
    chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run'
    }
  }
  if (!chrome.csi) {
    const start = performance.timeOrigin
    chrome.csi = () => ({ onloadT: Math.round(start + performance.now()), pageT: performance.now(), startE: Math.round(start), tran: 15 })
  }
  if (!chrome.loadTimes) {
    chrome.loadTimes = () => {
      const t = performance.timeOrigin / 1000
      return {
        commitLoadTime: t,
        connectionInfo: 'h2',
        finishDocumentLoadTime: t,
        finishLoadTime: t,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: t,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: t,
        startLoadTime: t,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      }
    }
  }
}

/**
 * Google's "Couldn't sign you in: This browser or app may not be secure" page, which it shows
 * after you type your email when it decides the browser is one built into an app.
 */
export function isGoogleRejection(url: string): boolean {
  if (!isGoogleSignIn(url)) return false
  try {
    return /\/signin\/(.*\/)?(rejected|deniedsigninrejected)\b/i.test(new URL(url).pathname)
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
