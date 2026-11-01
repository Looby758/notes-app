/**
 * The page a paired phone opens: Deck, Screen, Send, Clipboard, Remote, Touchpad, Talk and Scan. It's plain
 * HTML and JavaScript (no framework) so it loads instantly from Notes over the Wi-Fi, and works in
 * the phone's own browser with nothing installed. `base` is the paired session's address.
 */
export function phoneAppHtml(base: string): string {
  return PAGE.replace('__BASE__', JSON.stringify(base))
}

const PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Orbit">
<meta name="theme-color" content="#16161c"><title>Notes</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:#16161c;color:#e8e8ee;font:16px/1.4 system-ui,-apple-system,sans-serif}
body{display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)}
header{display:flex;align-items:center;gap:8px;padding:12px 16px;font-weight:600}
#dot{width:9px;height:9px;border-radius:50%;background:#e5534b}#dot.on{background:#3fb950}
#state{font-weight:400;color:#9a9aa8;font-size:13px}
main{flex:1;overflow-y:auto;padding:4px 16px 16px}
section{display:none}section.on{display:block}
nav{display:flex;border-top:1px solid #2a2a33;padding-bottom:env(safe-area-inset-bottom);background:#1c1c24}
nav button{flex:1;min-width:0;background:none;border:0;color:#9a9aa8;font-size:10px;padding:8px 0 10px}
nav button b{display:block;font-size:20px;line-height:26px;font-weight:400}
nav button.on{color:#a99cff}
h2{font-size:15px;color:#9a9aa8;font-weight:500;margin:18px 0 8px}
.btn{display:block;width:100%;background:#7c6cf0;color:#fff;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin:8px 0}
.btn.alt{background:#2a2a33;color:#e8e8ee}
.row{display:flex;gap:8px}.row .btn{flex:1}
textarea,input[type=text]{width:100%;background:#22222b;color:#e8e8ee;border:1px solid #33333d;border-radius:12px;padding:12px;font:inherit}
textarea{min-height:110px;resize:vertical}
.note{color:#9a9aa8;font-size:13px;margin:6px 0}
.log div{font-size:14px;padding:6px 0;border-bottom:1px solid #26262e;color:#c8c8d0}
.card{display:flex;align-items:center;gap:12px;background:#22222b;border-radius:14px;padding:12px}
.card img{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#33333d}
.card div{min-width:0}.card b,.card span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card span{color:#9a9aa8;font-size:14px}
.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}
.keys button{background:#2a2a33;color:#e8e8ee;border:0;border-radius:10px;padding:12px 0;font-size:15px}
#pad{height:46vh;background:#22222b;border-radius:16px;touch-action:none;display:flex;align-items:center;justify-content:center;color:#55555f;font-size:14px;text-align:center;padding:20px}
#scanWrap{position:relative;touch-action:none;margin:8px 0}#scanCanvas{width:100%;display:block;border-radius:10px}
.corner{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:3px solid #a99cff;background:rgba(124,108,240,.25)}
#deckGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}
#deckGrid button{aspect-ratio:1;border:0;border-radius:18px;background:linear-gradient(160deg,#2c2c38,#1f1f28);color:#e8e8ee;font-size:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:6px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 4px 12px rgba(0,0,0,.25);transition:transform .08s}
#deckGrid button b{font-size:30px;line-height:1;font-weight:400}
#deckGrid button:active{transform:scale(.94);background:#7c6cf0}
.modes{display:flex;gap:6px;margin:6px 0 10px}.modes button{flex:1;background:#22222b;color:#9a9aa8;border:0;border-radius:10px;padding:9px 0;font-size:13px}.modes button.on{background:#7c6cf0;color:#fff}
#clock{font-size:64px;font-weight:200;text-align:center;letter-spacing:1px;margin:10px 0 0}#date{text-align:center;color:#9a9aa8;margin-bottom:12px}
.plan div{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #26262e;font-size:15px}.plan div span{color:#a99cff;min-width:46px;font-variant-numeric:tabular-nums}.plan div.done{opacity:.45;text-decoration:line-through}
#noteView{white-space:pre-wrap;word-wrap:break-word;font-size:16px;line-height:1.55;background:#1c1c24;border-radius:14px;padding:14px}#noteView h1,#noteView h2,#noteView h3{margin:10px 0 4px;color:#fff}
#timerBig{font-size:84px;font-weight:200;text-align:center;font-variant-numeric:tabular-nums;margin:24px 0 4px}#timerLabel{text-align:center;color:#a99cff;font-size:18px}
#banner{position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));background:#2c2c3a;border:1px solid #7c6cf0;border-radius:16px;padding:12px 14px;display:none;box-shadow:0 10px 30px rgba(0,0,0,.5);z-index:5}#banner b{display:block}#banner span{color:#c8c8d0;font-size:14px}
#toast{position:fixed;left:16px;right:16px;bottom:90px;background:#33333d;padding:12px 14px;border-radius:12px;display:none;text-align:center}
</style></head><body>
<header><span id="dot"></span>Notes <span id="state">Connecting…</span></header>
<main>
<section id="deck">
  <h2>Deck</h2>
  <div id="deckGrid"></div>
  <p class="note">Each button runs on your computer. Choose the buttons in Orbit: Settings → Finding features → Phone deck.</p>
</section>
<section id="screen">
  <div class="modes"><button data-mode="today" class="on">Today</button><button data-mode="note">Open note</button><button data-mode="timer">Timer</button></div>
  <div data-view="today"><div id="clock"></div><div id="date"></div><div class="plan" id="plan"></div></div>
  <div data-view="note" hidden><h2 id="noteTitle">Open note</h2><div id="noteView"></div></div>
  <div data-view="timer" hidden><div id="timerBig">–</div><div id="timerLabel">No timer running. Start one in Zen mode.</div></div>
</section>
<section id="send" class="on">
  <h2>Send to your computer</h2>
  <button class="btn" data-pick="note">Into the open note</button>
  <button class="btn alt" data-pick="folder">Into the attachments folder</button>
  <input id="files" type="file" multiple hidden>
  <p class="note">Photos, videos and files go straight to Notes over your Wi-Fi.</p>
  <div class="log" id="sent"></div>
</section>
<section id="clip">
  <h2>On your computer's clipboard</h2>
  <textarea id="fromPc" readonly placeholder="Copy something on your computer and it shows here."></textarea>
  <button class="btn alt" id="copy">Copy to this phone</button>
  <h2>Send to your computer's clipboard</h2>
  <textarea id="toPc" placeholder="Tap here, then tap Paste (or type)."></textarea>
  <button class="btn" id="sendClip">Send to computer</button>
</section>
<section id="remote">
  <h2>Music</h2>
  <div class="card"><img id="art" alt=""><div><b id="song">Nothing playing</b><span id="artist"></span></div></div>
  <div class="row"><button class="btn alt" data-music="previous">⏮</button><button class="btn" data-music="toggle" id="playBtn">⏯</button><button class="btn alt" data-music="next">⏭</button></div>
  <h2>YouTube mini window</h2>
  <div class="row"><button class="btn alt" data-yt="back">−10s</button><button class="btn" data-yt="toggle">⏯</button><button class="btn alt" data-yt="forward">+10s</button><button class="btn alt" data-yt="next">⏭</button></div>
</section>
<section id="touch">
  <div id="pad">Drag to move · tap to click<br>two-finger tap to right-click · two fingers to scroll</div>
  <div class="row"><button class="btn alt" id="lclick">Click</button><button class="btn alt" id="rclick">Right-click</button></div>
  <input type="text" id="kbd" placeholder="Tap to type on your computer" autocapitalize="off" autocomplete="off" autocorrect="off">
  <div class="keys">
    <button data-key="escape">Esc</button><button data-key="tab">Tab</button><button data-key="backspace">⌫</button><button data-key="enter">⏎</button>
    <button data-key="left">←</button><button data-key="up">↑</button><button data-key="down">↓</button><button data-key="right">→</button>
  </div>
</section>
<section id="talk">
  <h2>Talk into a note</h2>
  <textarea id="speech" placeholder="Open a note on your computer, tap here, then tap the microphone on your keyboard and talk. The words appear in the note as you speak."></textarea>
  <button class="btn" id="talkDone">Done, start a new bit</button>
</section>
<section id="scan">
  <h2>Scan a page or receipt</h2>
  <button class="btn" id="takePhoto">Take a photo</button>
  <input id="photo" type="file" accept="image/*" capture="environment" hidden>
  <div id="scanEdit" hidden>
    <p class="note">Drag the corners onto the page's corners.</p>
    <div id="scanWrap"><canvas id="scanCanvas"></canvas></div>
    <div class="row"><button class="btn alt" id="rotate">Rotate</button><button class="btn alt" id="enhance">Enhance: on</button></div>
    <div class="row"><button class="btn" id="saveScan">Save scan</button><button class="btn" id="saveReceipt">Add receipt to Money</button></div>
  </div>
</section>
</main>
<div id="toast"></div>
<div id="banner"><b id="bannerTitle"></b><span id="bannerBody"></span></div>
<nav>
  <button data-tab="deck"><b>▦</b>Deck</button><button data-tab="screen"><b>◫</b>Screen</button>
  <button data-tab="send" class="on"><b>⇪</b>Send</button><button data-tab="clip"><b>⎘</b>Clipboard</button><button data-tab="remote"><b>▶︎</b>Remote</button>
  <button data-tab="touch"><b>⌨︎</b>Touchpad</button><button data-tab="talk"><b>🎙</b>Talk</button><button data-tab="scan"><b>⧉</b>Scan</button>
</nav>
<script>
var BASE = __BASE__;
function $(id) { return document.getElementById(id) }
function toast(text) { var t = $('toast'); t.textContent = text; t.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.style.display = 'none' }, 2600) }
function cmd(data) {
  return fetch(BASE + '/cmd', { method: 'POST', body: JSON.stringify(data) }).then(function (r) { return r.json() }).then(function (r) { if (r.error) toast(r.error) }).catch(function () {})
}

// Tabs (the last one is remembered).
function show(tab) {
  document.querySelectorAll('section').forEach(function (s) { s.classList.toggle('on', s.id === tab) })
  document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab) })
  try { localStorage.setItem('tab', tab) } catch (e) {}
}
document.querySelectorAll('nav button').forEach(function (b) { b.onclick = function () { show(b.dataset.tab) } })
try { if (localStorage.getItem('tab')) show(localStorage.getItem('tab')) } catch (e) {}

// Live link to the computer: reconnects by itself.
var events
function listen() {
  events = new EventSource(BASE + '/events')
  events.onopen = function () { $('dot').className = 'on'; $('state').textContent = 'Connected' }
  events.onerror = function () { $('dot').className = ''; $('state').textContent = 'Reconnecting… (is Notes open?)' }
  events.onmessage = function (e) {
    var m = JSON.parse(e.data)
    if (m.type === 'clip') $('fromPc').value = m.text
    if (m.type === 'deck') drawDeck(m.buttons)
    if (m.type === 'screen') { screen = m; drawScreen() }
    if (m.type === 'notify') heads(m.title, m.body)
    if (m.type === 'music') {
      $('song').textContent = m.name || 'Nothing playing'
      $('artist').textContent = m.artist || ''
      if (m.art) $('art').src = m.art; else $('art').removeAttribute('src')
      $('playBtn').textContent = m.playing ? '⏸' : '▶︎'
    }
  }
}
listen()

// Deck: big buttons that run things on the computer.
function drawDeck(buttons) {
  var grid = $('deckGrid'); grid.innerHTML = ''
  buttons.forEach(function (b) {
    var el = document.createElement('button')
    var icon = document.createElement('b'); icon.textContent = b.icon
    var label = document.createElement('span'); label.textContent = b.label
    el.appendChild(icon); el.appendChild(label)
    el.onclick = function () { if (navigator.vibrate) navigator.vibrate(12); cmd({ kind: 'deck', id: b.id }) }
    grid.appendChild(el)
  })
  if (!buttons.length) grid.innerHTML = '<p class="note">No buttons yet.</p>'
}

// Screen: today's plan with a big clock, the open note, or the focus timer.
var screen = null, mode = 'today'
try { mode = localStorage.getItem('screenMode') || 'today' } catch (e) {}
function setMode(m) {
  mode = m
  document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m) })
  document.querySelectorAll('[data-view]').forEach(function (v) { v.hidden = v.dataset.view !== m })
  try { localStorage.setItem('screenMode', m) } catch (e) {}
  drawScreen()
}
document.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode) } })
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
function drawScreen() {
  var now = new Date()
  $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  if (!screen) return
  $('plan').innerHTML = screen.today.length
    ? screen.today.map(function (i) { return '<div class="' + (i.done ? 'done' : '') + '"><span>' + esc(i.time || 'All day') + '</span>' + esc(i.title) + '</div>' }).join('')
    : '<p class="note">Nothing planned for today.</p>'
  if (screen.note) {
    $('noteTitle').textContent = screen.note.title
    $('noteView').innerHTML = esc(screen.note.text).replace(/^(#{1,3}) (.*)$/gm, function (_, h, t) { return '<h' + h.length + '>' + t + '</h' + h.length + '>' }).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^- \[x\] /gim, '☑ ').replace(/^- \[ \] /gm, '☐ ').replace(/^- /gm, '• ').replace(/(<\/h\d>)\n+/g, '$1')
  } else {
    $('noteTitle').textContent = 'Open note'
    $('noteView').innerHTML = '<p class="note">Open a note on your computer and it shows here. (Locked notes stay on the computer.)</p>'
  }
  var t = screen.timer
  if (t) {
    var left = t.endsAt ? t.endsAt - Date.now() : t.left
    var s = Math.max(0, Math.round((left || 0) / 1000))
    $('timerBig').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
    $('timerLabel').textContent = t.label + (t.endsAt ? '' : ' (paused)')
  } else { $('timerBig').textContent = '–'; $('timerLabel').textContent = 'No timer running. Start one in Zen mode.' }
}
setInterval(drawScreen, 1000)
setMode(mode)

// Heads-ups from the computer (reminders, new messages) while this page is open.
var beepCtx = null
document.addEventListener('touchstart', function () { if (!beepCtx && window.AudioContext) beepCtx = new AudioContext() }, { once: true })
function heads(title, body) {
  $('bannerTitle').textContent = title; $('bannerBody').textContent = body || ''
  var b = $('banner'); b.style.display = 'block'
  clearTimeout(heads.timer); heads.timer = setTimeout(function () { b.style.display = 'none' }, 8000)
  if (navigator.vibrate) navigator.vibrate([120, 60, 120])
  if (beepCtx) { try { var o = beepCtx.createOscillator(), g = beepCtx.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(beepCtx.destination); o.start(); o.stop(beepCtx.currentTime + 0.15) } catch (e) {} }
}
$('banner').onclick = function () { $('banner').style.display = 'none' }

document.addEventListener('visibilitychange', function () { if (!document.hidden && events.readyState === 2) listen() })

// Send files.
var into = 'note'
document.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { into = b.dataset.pick; $('files').click() } })
function upload(blob, name, where) {
  return new Promise(function (resolve) {
    var row = document.createElement('div'); row.textContent = name + ' …'; $('sent').prepend(row)
    var x = new XMLHttpRequest()
    x.open('POST', BASE + '/upload?into=' + where + '&name=' + encodeURIComponent(name))
    x.upload.onprogress = function (e) { if (e.lengthComputable) row.textContent = name + ' ' + Math.round(e.loaded / e.total * 100) + '%' }
    x.onload = function () { var r = {}; try { r = JSON.parse(x.responseText) } catch (e) {} row.textContent = (r.ok ? '✓ ' : '✗ ') + name + (r.error ? ' (' + r.error + ')' : ''); resolve(r.ok) }
    x.onerror = function () { row.textContent = '✗ ' + name + ' (not sent)'; resolve(false) }
    x.send(blob)
  })
}
$('files').onchange = function () {
  var list = Array.prototype.slice.call(this.files); this.value = ''
  list.reduce(function (p, f) { return p.then(function () { return upload(f, f.name, into) }) }, Promise.resolve())
}

// Clipboard: phones only let a page copy or paste when you tap, so there's a button each way.
$('copy').onclick = function () {
  var t = $('fromPc'); t.removeAttribute('readonly'); t.select(); t.setSelectionRange(0, t.value.length)
  var ok = false; try { ok = document.execCommand('copy') } catch (e) {}
  t.setAttribute('readonly', ''); t.blur(); toast(ok ? 'Copied' : 'Press and hold the text to copy it')
}
$('sendClip').onclick = function () { cmd({ kind: 'clip', text: $('toPc').value }).then(function () { toast('On your computer’s clipboard'); $('toPc').value = '' }) }

// Remote.
document.querySelectorAll('[data-music]').forEach(function (b) { b.onclick = function () { cmd({ kind: 'music', action: b.dataset.music }) } })
document.querySelectorAll('[data-yt]').forEach(function (b) { b.onclick = function () { cmd({ kind: 'youtube', action: b.dataset.yt }) } })

// Touchpad: movement is gathered up and sent a few dozen times a second.
var pad = $('pad'), touches = {}, moved = 0, startT = 0, fingers = 0, mx = 0, my = 0, sy = 0, flushing = false
function flush() {
  flushing = false
  if (mx || my) { var dx = mx, dy = my; mx = my = 0; cmd({ kind: 'move', dx: dx, dy: dy }) }
  if (sy) { var s = sy; sy = 0; cmd({ kind: 'scroll', dy: s }) }
}
function later() { if (!flushing) { flushing = true; setTimeout(flush, 30) } }
pad.addEventListener('touchstart', function (e) {
  e.preventDefault()
  if (Object.keys(touches).length === 0) { moved = 0; startT = Date.now(); fingers = 0 }
  for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; touches[t.identifier] = { x: t.clientX, y: t.clientY } }
  fingers = Math.max(fingers, Object.keys(touches).length)
}, { passive: false })
pad.addEventListener('touchmove', function (e) {
  e.preventDefault()
  var n = Object.keys(touches).length
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i], p = touches[t.identifier]; if (!p) continue
    var dx = t.clientX - p.x, dy = t.clientY - p.y; p.x = t.clientX; p.y = t.clientY
    moved += Math.abs(dx) + Math.abs(dy)
    if (n >= 2) { if (i === 0) sy += -dy * 2 } else { var speed = 1.6 + Math.min(2, Math.hypot(dx, dy) / 12); mx += dx * speed; my += dy * speed }
  }
  later()
}, { passive: false })
function end(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) delete touches[e.changedTouches[i].identifier]
  if (Object.keys(touches).length === 0 && moved < 10 && Date.now() - startT < 300) cmd({ kind: 'click', button: fingers >= 2 ? 'right' : 'left' })
}
pad.addEventListener('touchend', end, { passive: false }); pad.addEventListener('touchcancel', end, { passive: false })
$('lclick').onclick = function () { cmd({ kind: 'click', button: 'left' }) }
$('rclick').onclick = function () { cmd({ kind: 'click', button: 'right' }) }
document.querySelectorAll('[data-key]').forEach(function (b) { b.onclick = function () { cmd({ kind: 'key', key: b.dataset.key }) } })
var kbd = $('kbd')
kbd.addEventListener('input', function () { if (kbd.value) { cmd({ kind: 'type', text: kbd.value }); kbd.value = '' } })
kbd.addEventListener('keydown', function (e) {
  var map = { Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'escape' }
  if (map[e.key]) { e.preventDefault(); cmd({ kind: 'key', key: map[e.key] }) }
})

// Talk: the phone's own dictation fills the box; each change is sent so the note fills as you speak.
var talkId = String(Date.now()), talkTimer = 0
function sendTalk(done) { clearTimeout(talkTimer); cmd({ kind: 'dictate', id: talkId, text: $('speech').value, done: !!done }) }
$('speech').addEventListener('input', function () { clearTimeout(talkTimer); talkTimer = setTimeout(sendTalk, 150) })
$('talkDone').onclick = function () { sendTalk(true); $('speech').value = ''; talkId = String(Date.now()) }

// Scan: you place the corners, then the page is straightened (a perspective warp) and cleaned up.
var img = null, corners = [], enhance = true, view = $('scanCanvas'), wrap = $('scanWrap'), rot = 0
$('takePhoto').onclick = function () { $('photo').click() }
$('photo').onchange = function () {
  var f = this.files[0]; this.value = ''; if (!f) return
  var im = new Image()
  im.onload = function () {
    var max = 2400, k = Math.min(1, max / Math.max(im.width, im.height))
    var c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k)
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height)
    img = c; rot = 0; resetCorners(); $('scanEdit').hidden = false; draw()
  }
  im.src = URL.createObjectURL(f)
}
function resetCorners() { var w = img.width, h = img.height, m = 0.06; corners = [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]] }
function draw() {
  view.width = img.width; view.height = img.height
  var g = view.getContext('2d'); g.drawImage(img, 0, 0)
  g.fillStyle = 'rgba(124,108,240,0.18)'; g.strokeStyle = '#a99cff'; g.lineWidth = Math.max(3, img.width / 300)
  g.beginPath(); corners.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]) }); g.closePath(); g.fill(); g.stroke()
  wrap.querySelectorAll('.corner').forEach(function (d) { d.remove() })
  var scale = view.clientWidth / img.width
  corners.forEach(function (p, i) {
    var d = document.createElement('div'); d.className = 'corner'; d.style.left = p[0] * scale + 'px'; d.style.top = p[1] * scale + 'px'
    d.addEventListener('touchmove', function (e) {
      e.preventDefault(); var r = view.getBoundingClientRect(), t = e.touches[0], s = img.width / r.width
      corners[i] = [Math.max(0, Math.min(img.width, (t.clientX - r.left) * s)), Math.max(0, Math.min(img.height, (t.clientY - r.top) * s))]
      requestAnimationFrame(draw)
    }, { passive: false })
    wrap.appendChild(d)
  })
}
$('rotate').onclick = function () {
  var c = document.createElement('canvas'); c.width = img.height; c.height = img.width
  var g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0)
  img = c; resetCorners(); draw()
}
$('enhance').onclick = function () { enhance = !enhance; this.textContent = 'Enhance: ' + (enhance ? 'on' : 'off') }
// Solves for the 3×3 matrix taking the output rectangle's corners onto the picked corners.
function homography(src, dst) {
  var a = [], b = []
  for (var i = 0; i < 4; i++) {
    var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  for (var c = 0; c < 8; c++) {
    var p = c; for (var r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    var t = a[c]; a[c] = a[p]; a[p] = t; t = b[c]; b[c] = b[p]; b[p] = t
    for (r = c + 1; r < 8; r++) { var f = a[r][c] / a[c][c]; for (var k = c; k < 8; k++) a[r][k] -= f * a[c][k]; b[r] -= f * b[c] }
  }
  var h = new Array(8)
  for (c = 7; c >= 0; c--) { var s = b[c]; for (k = c + 1; k < 8; k++) s -= a[c][k] * h[k]; h[c] = s / a[c][c] }
  return h
}
function straighten() {
  var q = corners, d = function (p, r) { return Math.hypot(p[0] - r[0], p[1] - r[1]) }
  var w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]))
  var k = Math.min(1, 2200 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k)
  var m = homography([[0, 0], [w, 0], [w, h], [0, h]], q)
  var from = img.getContext('2d').getImageData(0, 0, img.width, img.height).data, sw = img.width, sh = img.height
  var out = document.createElement('canvas'); out.width = w; out.height = h
  var og = out.getContext('2d'), od = og.createImageData(w, h), o = od.data
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var z = m[6] * x + m[7] * y + 1, sx = Math.round((m[0] * x + m[1] * y + m[2]) / z), sy2 = Math.round((m[3] * x + m[4] * y + m[5]) / z)
    var i = (y * w + x) * 4
    if (sx < 0 || sy2 < 0 || sx >= sw || sy2 >= sh) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue }
    var j = (sy2 * sw + sx) * 4; o[i] = from[j]; o[i + 1] = from[j + 1]; o[i + 2] = from[j + 2]; o[i + 3] = 255
  }
  if (enhance) {
    // Greys, then stretch so the paper goes white and the ink goes dark.
    var hist = new Array(256).fill(0), n = w * h
    for (i = 0; i < o.length; i += 4) { var gr = Math.round(0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2]); o[i] = gr; hist[gr]++ }
    var lo = 0, hi = 255, acc = 0
    for (lo = 0, acc = 0; lo < 255 && acc < n * 0.02; lo++) acc += hist[lo]
    for (hi = 255, acc = 0; hi > 0 && acc < n * 0.1; hi--) acc += hist[hi]
    var span = Math.max(1, hi - lo)
    for (i = 0; i < o.length; i += 4) { var vv = Math.max(0, Math.min(255, (o[i] - lo) * 255 / span)); o[i] = o[i + 1] = o[i + 2] = vv }
  }
  og.putImageData(od, 0, 0)
  return new Promise(function (resolve) { out.toBlob(resolve, 'image/jpeg', 0.85) })
}
function stamp() { var t = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n }; return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + '.' + p(t.getMinutes()) }
function saveScan(kind) {
  toast('Straightening…')
  setTimeout(function () {
    straighten().then(function (blob) {
      return upload(blob, (kind === 'receipt' ? 'Receipt ' : 'Scan ') + stamp() + '.jpg', kind === 'receipt' ? 'receipt' : 'note')
    }).then(function (ok) { if (ok) { toast(kind === 'receipt' ? 'Sent. Orbit is reading the receipt…' : 'Saved in Orbit'); $('scanEdit').hidden = true; img = null } })
  }, 30)
}
$('saveScan').onclick = function () { saveScan('scan') }
$('saveReceipt').onclick = function () { saveScan('receipt') }
window.addEventListener('resize', function () { if (img) draw() })
</script></body></html>`
