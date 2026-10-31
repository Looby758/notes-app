import type { CamQuality } from '@shared/phoneCam'

/**
 * The page the phone opens to be the webcam. Plain HTML and JavaScript, like the paired phone
 * page, served over https (a phone only lets a page use its camera on a secure address). It films
 * with the camera, draws each frame onto a canvas, and posts it to Orbit as a JPEG, keeping at
 * most two frames on the way so a slow Wi-Fi moment drops frames instead of lagging behind.
 */
export function phoneCamHtml(base: string, quality: CamQuality): string {
  return PAGE.replace('__BASE__', JSON.stringify(base)).replace('__QUALITY__', JSON.stringify(quality))
}

const PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Orbit Cam">
<meta name="theme-color" content="#000000"><title>Orbit webcam</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:#000;color:#e8e8ee;font:16px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden}
video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
video.mirror{transform:scaleX(-1)}
#top{position:fixed;left:0;right:0;top:0;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;display:flex;align-items:center;gap:8px;background:linear-gradient(#000c,#0000)}
#dot{width:10px;height:10px;border-radius:50%;background:#e5534b;flex:none}#dot.on{background:#3fb950;box-shadow:0 0 8px #3fb950}
#state{font-size:14px;flex:1;min-width:0}
#fps{font-size:12px;color:#9a9aa8;font-variant-numeric:tabular-nums}
#bar{position:fixed;left:0;right:0;bottom:0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;background:linear-gradient(#0000,#000c)}
button,select{font:inherit;border:0;border-radius:14px;padding:14px 16px;background:#2a2a33cc;color:#e8e8ee;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
select{flex:1;min-width:0;-webkit-appearance:none;appearance:none}
#go{background:#7c6cf0;color:#fff;font-weight:600;flex:1}#go.stop{background:#e5534bcc;flex:none}
#intro{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;gap:10px}
#intro h1{font-size:24px;margin:0}#intro p{color:#9a9aa8;margin:0;max-width:340px}
#intro .big{font-size:56px}
#flip[hidden],#cams[hidden]{display:none}
</style></head><body>
<video id="video" playsinline muted autoplay></video>
<div id="intro"><div class="big">📷</div><h1>Orbit webcam</h1><p id="introText">Tap Start and your phone becomes the webcam on your computer. Keep this page open, and turn the phone sideways to fill the picture.</p></div>
<div id="top"><span id="dot"></span><span id="state">Not started</span><span id="fps"></span></div>
<div id="bar"><select id="cams" hidden></select><button id="flip" hidden title="Switch camera">⇄</button><button id="go">Start</button></div>
<script>
var BASE = __BASE__;
var quality = __QUALITY__;
var SIZES = { sd: [1280, 720], hd: [1920, 1080] };
function $(id) { return document.getElementById(id) }
var video = $('video'), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
var stream = null, running = false, inFlight = 0, sent = 0, lastSent = 0, wakeLock = null, failures = 0;
var facing = localStorage.getItem('facing') || 'user';
var chosen = localStorage.getItem('camera') || '';

function setState(text, on) { $('state').textContent = text; $('dot').classList.toggle('on', !!on) }

if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  $('introText').textContent = 'Your phone only lets a secure page use the camera. Open this page from the code in Orbit (its address starts with https).';
  $('go').disabled = true;
}

function stopTracks() { if (stream) stream.getTracks().forEach(function (t) { t.stop() }); stream = null }

function start() {
  stopTracks();
  var size = SIZES[quality] || SIZES.sd;
  var video_ = { width: { ideal: size[0] }, height: { ideal: size[1] }, frameRate: { ideal: 30, max: 30 } };
  if (chosen) video_.deviceId = { exact: chosen }; else video_.facingMode = facing;
  setState('Starting the camera…');
  return navigator.mediaDevices.getUserMedia({ video: video_, audio: false }).then(function (s) {
    stream = s;
    video.srcObject = s;
    var settings = s.getVideoTracks()[0].getSettings ? s.getVideoTracks()[0].getSettings() : {};
    video.classList.toggle('mirror', settings.facingMode ? settings.facingMode === 'user' : facing === 'user');
    s.getVideoTracks()[0].onended = function () { if (running) setTimeout(start, 500) };
    $('intro').style.display = 'none';
    return video.play().catch(function () {}).then(listCameras);
  }).catch(function (err) {
    if (chosen) { chosen = ''; localStorage.removeItem('camera'); return start() }
    running = false;
    $('go').textContent = 'Start'; $('go').classList.remove('stop');
    setState(err && err.name === 'NotAllowedError' ? 'Camera not allowed. Allow it for this page, then tap Start.' : 'Couldn’t start the camera: ' + (err && err.message || err));
  });
}

// The phone's cameras by name, once it has said yes (before that the names are hidden).
function listCameras() {
  return navigator.mediaDevices.enumerateDevices().then(function (list) {
    var cams = list.filter(function (d) { return d.kind === 'videoinput' });
    var select = $('cams');
    select.innerHTML = '';
    var current = stream && stream.getVideoTracks()[0].getSettings ? stream.getVideoTracks()[0].getSettings().deviceId : '';
    cams.forEach(function (c, i) {
      var o = document.createElement('option');
      o.value = c.deviceId; o.textContent = c.label || ('Camera ' + (i + 1));
      if (c.deviceId === current) o.selected = true;
      select.appendChild(o);
    });
    select.hidden = cams.length < 2 || !cams[0].label;
    $('flip').hidden = cams.length < 2 || !select.hidden;
  }).catch(function () {});
}

$('cams').onchange = function () { chosen = this.value; localStorage.setItem('camera', chosen); if (running) start() };
$('flip').onclick = function () {
  facing = facing === 'user' ? 'environment' : 'user'; chosen = '';
  localStorage.setItem('facing', facing); localStorage.removeItem('camera');
  if (running) start();
};

function keepAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then(function (l) { wakeLock = l }).catch(function () {});
}

$('go').onclick = function () {
  if (running) {
    running = false; stopTracks(); video.srcObject = null;
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null }
    this.textContent = 'Start'; this.classList.remove('stop');
    $('intro').style.display = ''; $('fps').textContent = '';
    setState('Stopped');
    return;
  }
  running = true; failures = 0;
  this.textContent = 'Stop'; this.classList.add('stop');
  keepAwake();
  start();
};

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible' || !running) return;
  keepAwake();
  // The phone stops the camera while this page is in the background; start it again on return.
  if (!stream || stream.getVideoTracks().every(function (t) { return t.readyState === 'ended' })) start();
});

function send() {
  var w = video.videoWidth, h = video.videoHeight;
  if (!w || !h || inFlight >= 2) return;
  var long = (SIZES[quality] || SIZES.sd)[0], scale = Math.min(1, long / Math.max(w, h));
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  inFlight++;
  canvas.toBlob(function (blob) {
    if (!blob) { inFlight--; return }
    fetch(BASE + '/frame', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
      .then(function (r) { return r.json() })
      .then(function (r) {
        failures = 0; sent++;
        if (!r.on) { setState('Phone webcam is off in Orbit. Turn it on there.', false); return }
        setState('Live: this is your webcam now', true);
        if (r.quality && r.quality !== quality) { quality = r.quality; start() }
      })
      .catch(function () { if (++failures > 3) setState('Can’t reach Orbit. Is it open, on the same Wi-Fi?', false) })
      .then(function () { inFlight-- });
  }, 'image/jpeg', quality === 'hd' ? 0.7 : 0.75);
}

setInterval(function () { $('fps').textContent = running ? (sent - lastSent) + ' fps' : ''; lastSent = sent }, 1000);

setInterval(function () { if (running && stream) send() }, 33);
</script></body></html>`
