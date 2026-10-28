/**
 * The ad blocker for YouTube (in the mini window and the web tabs). Two parts:
 *  - requests to ad servers (and YouTube's own ad and ad-tracking addresses) are refused outright;
 *  - YouTube pages get a little script that takes the ads out of what the player is told to play,
 *    skips any that still start, and CSS that hides the ad boxes in the feed and beside videos.
 */

/** Ad servers: nothing from these is ever loaded, on any page. */
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|imasdk\.googleapis\.com)$/i

/** YouTube's own addresses that only serve or count ads. */
const YOUTUBE_AD_PATHS = /^\/(pagead\/|api\/stats\/ads|get_midroll_|ptracking|pcs\/activeview)/i

/** Whether a page's request is for an ad, so it's refused. */
export function isAdRequest(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url)
    if (AD_HOSTS.test(hostname)) return true
    return /(^|\.)youtube\.com$/i.test(hostname) && YOUTUBE_AD_PATHS.test(pathname)
  } catch {
    return false
  }
}

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
