/**
 * The music remote page a phone opens (from the QR code on the Music page, from the paired phone
 * page, or from the Orbit Music phone app): the song and its cover, play/pause and skip, a bar to jump
 * around the song, shuffle and repeat, the volume, and Up next (tap one to play it). Plain HTML and
 * JavaScript so it loads straight away over the Wi-Fi with nothing installed. `base` is its address.
 */
export function musicRemoteHtml(base: string): string {
  return PAGE.replace('__BASE__', JSON.stringify(base))
}

const PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Orbit remote">
<meta name="theme-color" content="#121217"><title>Orbit music remote</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;min-height:100%;background:#121217;color:#ececf2;font:16px/1.4 system-ui,-apple-system,sans-serif}
body{padding:calc(10px + env(safe-area-inset-top)) 18px calc(18px + env(safe-area-inset-bottom));max-width:520px;margin:0 auto}
#bg{position:fixed;inset:-40px;background-size:cover;background-position:center;filter:blur(40px) brightness(.35) saturate(1.3);z-index:-1;transition:background-image .4s}
header{display:flex;align-items:center;gap:8px;font-size:13px;color:#a0a0ae;margin-bottom:12px}
#dot{width:8px;height:8px;border-radius:50%;background:#e5534b}#dot.on{background:#3fb950}
#art{width:100%;aspect-ratio:1;border-radius:16px;background:#26262f center/cover no-repeat;box-shadow:0 14px 40px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:64px;color:#4a4a57}
h1{font-size:22px;margin:18px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#artist{color:#a0a0ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{margin:18px 0 4px;height:28px;display:flex;align-items:center;touch-action:none}
.track{position:relative;flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.18)}
.fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:#fff}
.knob{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff}
.times{display:flex;justify-content:space-between;font-size:12px;color:#a0a0ae;font-variant-numeric:tabular-nums}
.controls{display:flex;align-items:center;justify-content:space-between;margin:14px 4px}
.controls button{background:none;border:0;color:#ececf2;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.controls button:active{background:rgba(255,255,255,.1)}
.controls button.small{width:44px;height:44px;color:#a0a0ae}.controls button.small.on{color:#a99cff}
#play{width:74px;height:74px;background:#fff;color:#121217}
#play:active{transform:scale(.95);background:#fff}
svg{width:28px;height:28px;fill:currentColor}.small svg{width:22px;height:22px}#play svg{width:34px;height:34px}
.vol{display:flex;align-items:center;gap:12px;color:#a0a0ae}.vol svg{width:20px;height:20px;flex:none}
input[type=range]{flex:1;accent-color:#fff;height:28px}
h2{font-size:14px;color:#a0a0ae;font-weight:500;margin:22px 0 6px}
#next button{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;color:inherit;text-align:left;padding:8px 4px;border-radius:10px;font:inherit}
#next button:active{background:rgba(255,255,255,.08)}
#next .pic{width:44px;height:44px;border-radius:6px;background:#26262f center/cover;flex:none}
#next b,#next span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#next b{font-weight:500}#next span{color:#a0a0ae;font-size:14px}
#next div{min-width:0}
.note{color:#80808e;font-size:13px}
#toast{position:fixed;left:16px;right:16px;bottom:calc(20px + env(safe-area-inset-bottom));background:#33333d;padding:12px 14px;border-radius:12px;display:none;text-align:center}
</style></head><body>
<div id="bg"></div>
<header><span id="dot"></span><span id="state">Connecting…</span></header>
<div id="art">♪</div>
<h1 id="title">Nothing playing</h1>
<div id="artist">Start some music in Orbit.</div>
<div class="bar" id="seek"><div class="track"><div class="fill" id="fill"></div><div class="knob" id="knob"></div></div></div>
<div class="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
<div class="controls">
  <button class="small" data-cmd="shuffle" id="shuffle" aria-label="Shuffle"><svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4h-5.5zm.3 9.4-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2-3.2-3.1z"/></svg></button>
  <button data-cmd="previous" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>
  <button id="play" data-cmd="toggle" aria-label="Play or pause"><svg viewBox="0 0 24 24" id="playIcon"><path d="M8 5v14l11-7z"/></svg></button>
  <button data-cmd="next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
  <button class="small" data-cmd="repeat" id="repeat" aria-label="Repeat"><svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg></button>
</div>
<div class="vol"><svg viewBox="0 0 24 24"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg><input type="range" id="vol" min="0" max="100" value="50" aria-label="Volume"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg></div>
<h2>Up next</h2>
<div id="next"><p class="note">Nothing queued.</p></div>
<div id="toast"></div>
<script>
var BASE = __BASE__
var $ = function (id) { return document.getElementById(id) }
var s = null, got = 0, dragging = null, volTimer = 0, volHeld = 0
var PLAY = '<path d="M8 5v14l11-7z"/>', PAUSE = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
function toast(t) { var el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none' }, 2600) }
function send(c) {
  return fetch(BASE + '/cmd', { method: 'POST', body: JSON.stringify(c) }).then(function (r) { return r.json() }).then(function (r) { if (r.error) toast(r.error) }).catch(function () { toast('Couldn’t reach Orbit. Is it open, on the same Wi-Fi?') })
}
function fmt(ms) { ms = Math.max(0, ms || 0); var t = Math.floor(ms / 1000), m = Math.floor(t / 60), x = t % 60; return m + ':' + (x < 10 ? '0' : '') + x }
function pos() { if (!s) return 0; var p = s.positionMs + (s.playing ? Date.now() - got : 0); return s.durationMs ? Math.min(p, s.durationMs) : p }
function bg(el, url) { el.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '' }
function render() {
  if (!s) return
  var has = !!s.title
  $('title').textContent = has ? s.title : 'Nothing playing'
  $('artist').textContent = has ? (s.artist || 'Unknown artist') : 'Start some music in Orbit.'
  bg($('art'), s.art); $('art').textContent = s.art ? '' : '♪'; bg($('bg'), s.art)
  $('playIcon').innerHTML = s.playing ? PAUSE : PLAY
  $('shuffle').className = 'small' + (s.shuffle ? ' on' : '')
  $('repeat').className = 'small' + (s.repeat && s.repeat !== 'off' ? ' on' : '')
  $('repeat').style.opacity = s.repeat === 'track' ? '1' : ''
  $('repeat').setAttribute('aria-label', s.repeat === 'track' ? 'Repeating this song' : s.repeat === 'context' ? 'Repeating all' : 'Repeat')
  if (s.volume === null) $('vol').disabled = true
  else if (Date.now() - volHeld > 1500) { $('vol').disabled = false; $('vol').value = s.volume }
  var list = $('next'); list.innerHTML = ''
  if (!s.upNext.length) list.innerHTML = '<p class="note">' + (s.source === 'local' ? 'Nothing queued.' : 'Up next shows for your own music.') + '</p>'
  s.upNext.forEach(function (u, i) {
    var b = document.createElement('button')
    var pic = document.createElement('span'); pic.className = 'pic'; bg(pic, u.art)
    var d = document.createElement('div'), t = document.createElement('b'), a = document.createElement('span')
    t.textContent = u.title; a.textContent = u.artist || 'Unknown artist'
    d.appendChild(t); d.appendChild(a); b.appendChild(pic); b.appendChild(d)
    b.onclick = function () { send({ jump: i }) }
    list.appendChild(b)
  })
  tick()
}
function tick() {
  var p = dragging !== null ? dragging : pos(), d = s ? s.durationMs : 0, pct = d ? Math.min(100, (p / d) * 100) : 0
  $('fill').style.width = pct + '%'; $('knob').style.left = pct + '%'
  $('pos').textContent = fmt(p); $('dur').textContent = fmt(d)
}
setInterval(tick, 500)
document.querySelectorAll('[data-cmd]').forEach(function (b) {
  b.onclick = function () {
    var c = b.dataset.cmd
    // Shown straight away; Orbit's answer follows.
    if (c === 'toggle' && s) { s.positionMs = pos(); got = Date.now(); s.playing = !s.playing; render() }
    send({ action: c })
  }
})
var seek = $('seek')
function at(e) { var r = seek.querySelector('.track').getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (s ? s.durationMs : 0) }
seek.addEventListener('pointerdown', function (e) { if (!s || !s.durationMs) return; seek.setPointerCapture(e.pointerId); dragging = at(e); tick() })
seek.addEventListener('pointermove', function (e) { if (dragging === null) return; dragging = at(e); tick() })
seek.addEventListener('pointerup', function (e) { if (dragging === null) return; var to = at(e); dragging = null; if (s) { s.positionMs = to; got = Date.now() } tick(); send({ seek: to }) })
$('vol').addEventListener('input', function () {
  volHeld = Date.now()
  var v = Number($('vol').value)
  clearTimeout(volTimer); volTimer = setTimeout(function () { send({ volume: v }) }, 120)
})
var events
function listen() {
  events = new EventSource(BASE + '/events')
  events.onopen = function () { $('dot').className = 'on'; $('state').textContent = 'Connected to Orbit' }
  events.onerror = function () { $('dot').className = ''; $('state').textContent = 'Reconnecting… (is Orbit open?)' }
  events.onmessage = function (e) { var m = JSON.parse(e.data); if (m.type === 'state') { s = m; got = Date.now(); render() } }
}
listen()
document.addEventListener('visibilitychange', function () { if (!document.hidden && events.readyState === 2) listen() })
</script></body></html>`
