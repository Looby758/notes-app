/**
 * The ad blocker for the web tabs and the YouTube mini window. Three parts:
 *  - requests to ad and tracking servers (and YouTube's own ad addresses) are refused outright;
 *  - every page gets CSS that hides the usual ad boxes (and the gaps they'd leave);
 *  - YouTube pages also get a little script that takes the ads out of what the player is told to
 *    play, skips any that still start, and CSS that hides the ad boxes in the feed and beside videos.
 */

/** Ad and tracking servers: nothing from these (or their subdomains) is ever loaded, on any page. */
const AD_HOSTS = new Set([
  // Google
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'imasdk.googleapis.com',
  'google-analytics.com', 'googletagservices.com', 'googletagmanager.com',
  // Ad exchanges and networks
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com', 'criteo.com',
  'criteo.net', 'amazon-adsystem.com', 'advertising.com', 'adform.net', 'smartadserver.com', 'yieldmo.com',
  'sharethrough.com', 'teads.tv', 'triplelift.com', '3lift.com', 'indexww.com', 'bidswitch.net', 'contextweb.com',
  'adroll.com', 'media.net', 'moatads.com', 'serving-sys.com', 'zedo.com', 'yieldlab.net', 'spotxchange.com',
  'adition.com', 'adsafeprotected.com', 'doubleverify.com', 'adtech.de', 'popads.net', 'popcash.net',
  'propellerads.com', 'adcash.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'mgid.com',
  // "Recommended for you" link farms
  'taboola.com', 'outbrain.com', 'revcontent.com', 'zergnet.com',
  // Trackers
  'scorecardresearch.com', 'quantserve.com', 'hotjar.com', 'mouseflow.com', 'crazyegg.com', 'chartbeat.com',
  'chartbeat.net', 'bluekai.com', 'demdex.net', 'krxd.net', 'exelator.com', 'agkn.com', 'rlcdn.com', 'tapad.com',
  'mathtag.com', 'adsymptotic.com', 'everesttech.net', 'omtrdc.net', 'ads-twitter.com', 'ads.linkedin.com',
  'analytics.tiktok.com', 'bat.bing.com'
])

function isAdHost(hostname: string): boolean {
  const parts = hostname.toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) if (AD_HOSTS.has(parts.slice(i).join('.'))) return true
  return false
}

/** YouTube's own addresses that only serve or count ads. */
const YOUTUBE_AD_PATHS = /^\/(pagead\/|api\/stats\/ads|get_midroll_|ptracking|pcs\/activeview)/i

/**
 * Whether a page's request is for an ad or tracker, so it's refused. A page you open yourself
 * (`mainFrame`, such as clicking an ad) still loads, so a link never just goes blank.
 */
export function isAdRequest(url: string, resourceType = ''): boolean {
  if (resourceType === 'mainFrame') return false
  try {
    const { hostname, pathname } = new URL(url)
    if (isAdHost(hostname)) return true
    return /(^|\.)youtube\.com$/i.test(hostname) && YOUTUBE_AD_PATHS.test(pathname)
  } catch {
    return false
  }
}

/** Hides the usual ad boxes on any site (the gaps left where a blocked ad would have been). */
export const PAGE_AD_CSS = `
ins.adsbygoogle, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[id^="google_ads_iframe"],
div[id^="div-gpt-ad"], div[id^="google_ads_"], [data-google-query-id], .GoogleActiveViewElement, .adsbygoogle,
.trc_rbox_container, .OUTBRAIN, [data-widget-id^="AR_"], #taboola-below-article-thumbnails, amp-ad, amp-embed[type="taboola"]
{ display: none !important; }
`

/** Hides the ad boxes on YouTube's pages (home feed, search, beside and under a video). */
export const YOUTUBE_AD_CSS = `
ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer,
ytd-promoted-video-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer, ytd-companion-slot-renderer,
ytd-player-legacy-desktop-watch-ads-renderer, ytd-merch-shelf-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
#masthead-ad, #player-ads, .ytp-ad-overlay-container, .ytp-ad-module .ytp-ad-image-overlay { display: none !important; }
`

/**
 * Runs in YouTube's page. Takes the ad breaks out of every player response YouTube reads (so most
 * ads never start), and if one starts anyway, jumps to its end and presses Skip. Safe to run twice.
 */
export const YOUTUBE_AD_SCRIPT = `(() => {
  if (window.__notesAdBlock) return
  window.__notesAdBlock = true
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']
  const strip = (data) => {
    if (data && typeof data === 'object') {
      for (const key of AD_KEYS) if (key in data) delete data[key]
      if (data.playerResponse) strip(data.playerResponse)
    }
    return data
  }
  const parse = JSON.parse
  JSON.parse = function (...args) { return strip(parse.apply(this, args)) }
  const json = Response.prototype.json
  Response.prototype.json = function () { return json.call(this).then(strip) }
  strip(window.ytInitialPlayerResponse)

  setInterval(() => {
    const player = document.querySelector('.html5-video-player.ad-showing')
    if (!player) return
    const video = player.querySelector('video')
    if (video && Number.isFinite(video.duration) && video.currentTime < video.duration) video.currentTime = video.duration
    for (const button of document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')) button.click()
  }, 300)
})()`
