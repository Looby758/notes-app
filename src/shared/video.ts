/**
 * Popping a video on any website (not just YouTube) out into the mini window: finding it in the
 * web tab, and in the mini window making it fill the window with the rest of the page hidden.
 */

/**
 * Run in a web tab: the biggest video (a playing one first) is paused and where it got to comes
 * back as { seconds }. If the video is in an embedded player from another site (which the page
 * can't reach into), that player's address comes back as { url } instead, and it's reloaded so it
 * stops. null when there's no video at all.
 */
export const FIND_VIDEO = `(() => {
  const size = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height }
  const videos = [...document.querySelectorAll('video')].filter((v) => size(v) > 0)
  videos.sort((a, b) => (a.paused - b.paused) || size(b) - size(a))
  if (videos[0]) { videos[0].pause(); return { seconds: videos[0].currentTime || 0 } }
  const players = [...document.querySelectorAll('iframe')]
    .filter((f) => /^https?:/i.test(f.src) && size(f) >= 200 * 120 && /video|player|embed|vimeo|stream|watch/i.test(f.src + ' ' + (f.allow || '')))
    .sort((a, b) => size(b) - size(a))
  if (players[0]) { const url = players[0].src; players[0].src = url; return { url } }
  return null
})()`

/** The mini window's video-only look for any site: just the marked video (see POP_VIDEO), filling the window. */
export const POP_VIDEO_CSS = `
html, body { overflow: hidden !important; }
body { visibility: hidden !important; }
[data-notes-pop-up] { transform: none !important; filter: none !important; perspective: none !important; contain: none !important; will-change: auto !important; backdrop-filter: none !important; }
video[data-notes-pop] {
  visibility: visible !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important; margin: 0 !important; z-index: 2147483647 !important;
  background: #000 !important; object-fit: contain !important;
}
`

/**
 * Marks the page's main video (and the boxes it sits in, so nothing traps it) for POP_VIDEO_CSS and
 * gives it the browser's own controls, since the site's are hidden. It keeps checking, for sites
 * that swap their video out. UNPOP_VIDEO puts the page back.
 */
export const POP_VIDEO = `(() => {
  if (window.__notesPop) return
  let marked = null, gaveControls = false
  const unmark = () => {
    document.querySelectorAll('[data-notes-pop-up]').forEach((el) => el.removeAttribute('data-notes-pop-up'))
    if (marked) { marked.removeAttribute('data-notes-pop'); if (gaveControls) marked.controls = false }
    marked = null
  }
  const size = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height }
  const check = () => {
    if (marked && marked.isConnected) return
    unmark()
    const videos = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 || size(v) > 0)
    videos.sort((a, b) => (a.paused - b.paused) || size(b) - size(a))
    const v = videos[0]
    if (!v) return
    marked = v
    v.setAttribute('data-notes-pop', '')
    for (let el = v.parentElement; el; el = el.parentElement) el.setAttribute('data-notes-pop-up', '')
    gaveControls = !v.controls
    v.controls = true
  }
  check()
  const timer = setInterval(check, 1500)
  window.__notesPop = { off: () => { clearInterval(timer); unmark(); delete window.__notesPop } }
})()`

export const UNPOP_VIDEO = `window.__notesPop && window.__notesPop.off()`

/** Plays the page's main video from `seconds` in, once it's there (it may take a moment to load). */
export const playVideoFrom = (seconds: number): string => `(() => {
  let tries = 0
  const t = setInterval(() => {
    const v = document.querySelector('video[data-notes-pop]') || document.querySelector('video')
    if (v && v.readyState > 0) {
      clearInterval(t)
      if (${Math.max(0, Math.floor(seconds))} > 0) v.currentTime = ${Math.max(0, Math.floor(seconds))}
      v.play().catch(() => {})
    } else if (++tries > 40) clearInterval(t)
  }, 500)
})()`
