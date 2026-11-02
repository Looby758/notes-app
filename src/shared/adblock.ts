/**
 * The ad blocker for the web tabs and the YouTube mini window. Three parts:
 *  - requests to ad and tracking servers are refused outright (except from YouTube's pages, see isAdRequest);
 *  - every page gets CSS that hides the usual ad boxes (and the gaps they'd leave);
 *  - YouTube pages also get a little script that mutes and speeds through ads and presses Skip,
 *    and CSS that hides the ad boxes in the feed and beside videos.
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

/** YouTube's pages (the site, YouTube Music, the embedded player). */
const isYouTubePage = (url: string): boolean => {
  try {
    return /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Whether a page's request is for an ad or tracker, so it's refused. A page you open yourself
 * (`mainFrame`, such as clicking an ad) still loads, so a link never just goes blank.
 *
 * Nothing YouTube's pages ask for is refused (`pageUrl` is the page asking). YouTube notices when
 * its ad requests fail, or when the ads have been taken out of what its player is told, and then
 * holds the video on "loading" for about as long as the ad would have run. Its ads are dealt with
 * in the player instead (YOUTUBE_AD_SCRIPT).
 */
export function isAdRequest(url: string, resourceType = '', pageUrl = ''): boolean {
  if (resourceType === 'mainFrame') return false
  if (pageUrl && isYouTubePage(pageUrl)) return false
  try {
    return isAdHost(new URL(url).hostname)
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
 * Runs in YouTube's page. Leaves what YouTube sends alone (changing it is what makes YouTube hold
 * videos on "loading"); when an ad starts, it's muted and run through at top speed, and Skip is
 * pressed as soon as there is one. The sound and speed you had come back when the video returns.
 * Safe to run twice.
 */
export const YOUTUBE_AD_SCRIPT = `(() => {
  if (window.__notesAdBlock) return
  window.__notesAdBlock = true
  let saved = null
  const check = () => {
    const player = document.querySelector('.html5-video-player')
    const video = player && player.querySelector('video')
    if (!video) return
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')
    if (ad) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate }
      if (!video.muted) video.muted = true
      if (video.playbackRate !== 16) video.playbackRate = 16
      for (const button of document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[id^="skip-button"]')) button.click()
    } else if (saved) {
      video.muted = saved.muted
      video.playbackRate = saved.rate
      saved = null
    }
  }
  setInterval(check, 250)
  new MutationObserver(check).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] })
})()`
