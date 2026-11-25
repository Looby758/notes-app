/**
 * Popping a web page with a video on it out into a window of its own: finding where the video got
 * to in the web tab, and carrying on from there in the new window.
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

/** Plays the page's main video from `seconds` in, once it's there (it may take a moment to load). */
export const playVideoFrom = (seconds: number): string => `(() => {
  let tries = 0
  const t = setInterval(() => {
    const v = document.querySelector('video')
    if (v && v.readyState > 0) {
      clearInterval(t)
      if (${Math.max(0, Math.floor(seconds))} > 0) v.currentTime = ${Math.max(0, Math.floor(seconds))}
      v.play().catch(() => {})
    } else if (++tries > 40) clearInterval(t)
  }, 500)
})()`
