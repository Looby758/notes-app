import { fitRect, pickRecordingType, qualityById, type StudioItem } from '@shared/studio'
import type { LiveService } from '@shared/live'
import { IS_MAC } from '@shared/platform'
import { activeScene, useStudio } from '../store/studio'
import { useMusic, watchMusic } from '../store/music'
import { notify } from '../store/notify'
import { errorMessage } from './paths'

/**
 * The Studio's engine: keeps the screens and webcams in your scenes running, draws the active
 * scene onto a canvas (the picture that's recorded), mixes the mic and desktop sound, and records
 * both with MediaRecorder, sending the file to the main process a second at a time.
 *
 * It wakes when the Studio page opens and sleeps when it closes, unless it's recording: then it
 * keeps going (the bar in the corner shows it) until you stop.
 */

interface Feed {
  stream: MediaStream
  video: HTMLVideoElement
}

const feeds = new Map<string, Feed>()
const starting = new Map<string, Promise<void>>()
const pictures = new Map<string, HTMLImageElement>()
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let loop: ReturnType<typeof setInterval> | undefined
let unsubscribe: (() => void) | null = null
let stopWatchingMusic: (() => void) | null = null
let pageOpen = false

// Audio
let audio: AudioContext | null = null
let mixOut: MediaStreamAudioDestinationNode | null = null
interface Channel {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  gain: GainNode
  meter: AnalyserNode
  key: string
}
const channels: { mic: Channel | null; desktop: Channel | null } = { mic: null, desktop: null }

// Recording
let recorder: MediaRecorder | null = null
let recordingId = 0
let writes: Promise<unknown> = Promise.resolve()

export const desktopAudioSupported = !IS_MAC

const feedKey = (item: StudioItem): string | null =>
  item.kind === 'screen' && item.deviceId ? `screen:${item.deviceId}` : item.kind === 'camera' ? `camera:${item.deviceId ?? ''}` : null

export function studioCanvas(): HTMLCanvasElement {
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.className = 'studio-canvas'
    ctx = canvas.getContext('2d')
  }
  const q = qualityById(useStudio.getState().quality)
  if (canvas.width !== q.width || canvas.height !== q.height) {
    canvas.width = q.width
    canvas.height = q.height
  }
  return canvas
}

// ---------- sources ----------

function setProblem(itemIds: string[], problem: string | null): void {
  useStudio.setState((s) => {
    const problems = { ...s.problems }
    for (const id of itemIds) {
      if (problem) problems[id] = problem
      else delete problems[id]
    }
    return { problems }
  })
}

const itemsUsing = (key: string): string[] =>
  useStudio
    .getState()
    .scenes.flatMap((s) => s.items)
    .filter((i) => feedKey(i) === key)
    .map((i) => i.id)

async function openFeed(key: string): Promise<void> {
  const q = qualityById(useStudio.getState().quality)
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  try {
    let stream: MediaStream
    if (kind === 'screen') {
      if (!(await window.api.studioAccess('screen'))) throw new Error('Orbit isn’t allowed to record the screen. Turn it on in System Settings → Privacy & Security → Screen Recording.')
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: q.width, maxHeight: q.height, maxFrameRate: q.fps } }
      } as unknown as MediaStreamConstraints)
    } else {
      if (!(await window.api.studioAccess('camera'))) throw new Error('Orbit isn’t allowed to use the camera. Turn it on in System Settings → Privacy & Security → Camera.')
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: q.fps } }
      })
    }
    if (!wanted().has(key)) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play().catch(() => undefined)
    feeds.set(key, { stream, video })
    setProblem(itemsUsing(key), null)
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      closeFeed(key)
      setProblem(itemsUsing(key), kind === 'screen' ? 'This window or screen was closed. Pick it again.' : 'The camera was unplugged.')
    })
  } catch (err) {
    const msg = errorMessage(err)
    setProblem(
      itemsUsing(key),
      /NotReadable|Could not start/i.test(msg)
        ? 'Another app is using this. Close it there and pick it again.'
        : /NotFound|Requested device not found/i.test(msg)
          ? kind === 'camera'
            ? 'No camera found.'
            : 'That window or screen isn’t there any more. Pick it again.'
          : msg
    )
  }
}

function closeFeed(key: string): void {
  const f = feeds.get(key)
  if (!f) return
  f.stream.getTracks().forEach((t) => t.stop())
  f.video.srcObject = null
  feeds.delete(key)
}

/** The feeds any scene uses, so switching scenes is instant. */
function wanted(): Set<string> {
  const keys = new Set<string>()
  for (const s of useStudio.getState().scenes) for (const i of s.items) {
    const k = feedKey(i)
    if (k) keys.add(k)
  }
  return keys
}

function syncFeeds(): void {
  const want = wanted()
  for (const key of [...feeds.keys()]) if (!want.has(key)) closeFeed(key)
  for (const key of want) {
    if (feeds.has(key) || starting.has(key)) continue
    const p = openFeed(key).finally(() => starting.delete(key))
    starting.set(key, p)
  }
}

/** Tries a source again (after "Another app is using this", say). */
export function retrySource(item: StudioItem): void {
  const k = feedKey(item)
  if (!k) return
  closeFeed(k)
  setProblem([item.id], null)
  syncFeeds()
}

function picture(src: string, crossOrigin = false): HTMLImageElement | null {
  let img = pictures.get(src)
  if (!img) {
    img = new Image()
    // Album pictures come from Spotify: asked for with CORS so the canvas can still be recorded.
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.src = src
    pictures.set(src, img)
    if (pictures.size > 60) pictures.delete(pictures.keys().next().value as string)
  }
  return img.complete && img.naturalWidth ? img : null
}

// ---------- drawing ----------

function roundedPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

function drawItem(c: CanvasRenderingContext2D, item: StudioItem, W: number, H: number): void {
  const box = { x: item.x * W, y: item.y * H, w: item.w * W, h: item.h * H }
  const r = item.radius * Math.min(box.w, box.h)
  c.save()
  if (item.kind === 'screen' || item.kind === 'camera') {
    const key = feedKey(item)
    const feed = key ? feeds.get(key) : undefined
    const v = feed?.video
    if (!v || !v.videoWidth) {
      c.restore()
      return
    }
    roundedPath(c, box.x, box.y, box.w, box.h, r)
    c.clip()
    const at = fitRect(v.videoWidth, v.videoHeight, box, item.fit)
    if (item.mirror) {
      c.translate(at.x * 2 + at.w, 0)
      c.scale(-1, 1)
    }
    c.drawImage(v, at.x, at.y, at.w, at.h)
  } else if (item.kind === 'image' && item.image) {
    const img = picture(item.image)
    if (img) {
      roundedPath(c, box.x, box.y, box.w, box.h, r)
      c.clip()
      const at = fitRect(img.naturalWidth, img.naturalHeight, box, item.fit)
      c.drawImage(img, at.x, at.y, at.w, at.h)
    }
  } else if (item.kind === 'text') {
    drawText(c, item, box)
  } else if (item.kind === 'nowPlaying') {
    drawNowPlaying(c, box, r)
  }
  c.restore()
}

const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif'

function drawText(c: CanvasRenderingContext2D, item: StudioItem, box: { x: number; y: number; w: number; h: number }): void {
  const lines = (item.text || ' ').split('\n')
  const pad = item.background ? box.h * 0.12 : 0
  let size = (box.h - pad * 2) / lines.length / 1.2
  c.font = `600 ${size}px ${FONT}`
  const widest = Math.max(...lines.map((l) => c.measureText(l).width), 1)
  // Shrink to fit the box's width as well.
  if (widest > box.w - pad * 2) {
    size *= (box.w - pad * 2) / widest
    c.font = `600 ${size}px ${FONT}`
  }
  const textW = Math.max(...lines.map((l) => c.measureText(l).width))
  if (item.background) {
    c.fillStyle = 'rgba(0, 0, 0, 0.55)'
    roundedPath(c, box.x, box.y, textW + pad * 2, size * 1.2 * lines.length + pad * 2, item.radius * box.h || pad)
    c.fill()
  }
  c.fillStyle = item.color || '#ffffff'
  c.textBaseline = 'middle'
  c.shadowColor = item.background ? 'transparent' : 'rgba(0,0,0,0.6)'
  c.shadowBlur = item.background ? 0 : size * 0.15
  lines.forEach((l, i) => c.fillText(l, box.x + pad, box.y + pad + size * 1.2 * (i + 0.5)))
}

function drawNowPlaying(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, r: number): void {
  const track = useMusic.getState().state?.track
  if (!track) return
  c.fillStyle = 'rgba(10, 10, 14, 0.72)'
  roundedPath(c, box.x, box.y, box.w, box.h, r)
  c.fill()
  const pad = box.h * 0.12
  const art = track.art ? picture(track.art, true) : null
  const side = box.h - pad * 2
  let textX = box.x + pad
  if (art) {
    c.save()
    roundedPath(c, box.x + pad, box.y + pad, side, side, side * 0.12)
    c.clip()
    c.drawImage(art, box.x + pad, box.y + pad, side, side)
    c.restore()
    textX += side + pad
  }
  const maxW = box.x + box.w - pad - textX
  c.textBaseline = 'middle'
  c.fillStyle = '#ffffff'
  c.font = `700 ${side * 0.36}px ${FONT}`
  c.fillText(clip(c, track.name, maxW), textX, box.y + box.h * 0.38)
  c.fillStyle = 'rgba(255,255,255,0.7)'
  c.font = `500 ${side * 0.28}px ${FONT}`
  c.fillText(clip(c, track.artist, maxW), textX, box.y + box.h * 0.68)
}

function clip(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function draw(): void {
  const cv = studioCanvas()
  const c = ctx
  if (!c) return
  c.fillStyle = '#000'
  c.fillRect(0, 0, cv.width, cv.height)
  for (const item of activeScene().items) if (item.visible) drawItem(c, item, cv.width, cv.height)
}

function startLoop(): void {
  clearInterval(loop)
  loop = setInterval(draw, 1000 / qualityById(useStudio.getState().quality).fps)
}

// ---------- audio ----------

function ensureAudio(): void {
  if (audio) return
  audio = new AudioContext()
  mixOut = audio.createMediaStreamDestination()
}

function closeChannel(which: 'mic' | 'desktop'): void {
  const ch = channels[which]
  if (!ch) return
  ch.stream.getTracks().forEach((t) => t.stop())
  ch.source.disconnect()
  ch.gain.disconnect()
  channels[which] = null
}

function applyGains(): void {
  const s = useStudio.getState()
  if (channels.mic) channels.mic.gain.gain.value = s.micMuted ? 0 : s.micGain
  if (channels.desktop) channels.desktop.gain.gain.value = s.desktopMuted ? 0 : s.desktopGain
}

async function openChannel(which: 'mic' | 'desktop', key: string): Promise<void> {
  ensureAudio()
  try {
    let stream: MediaStream
    if (which === 'mic') {
      await window.api.micAccess()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(key ? { deviceId: { exact: key } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false
      })
    } else {
      // Windows records everything you hear alongside a screen; the picture part is thrown away.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
        video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } }
      } as unknown as MediaStreamConstraints)
      stream.getVideoTracks().forEach((t) => {
        t.stop()
        stream.removeTrack(t)
      })
    }
    if (!audio || !mixOut || desiredKey(which) !== key) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    closeChannel(which)
    const source = audio.createMediaStreamSource(stream)
    const gain = audio.createGain()
    const meter = audio.createAnalyser()
    meter.fftSize = 1024
    source.connect(gain)
    gain.connect(meter)
    gain.connect(mixOut)
    channels[which] = { stream, source, gain, meter, key }
    applyGains()
    useStudio.setState({ audioProblem: null })
  } catch (err) {
    useStudio.setState({ audioProblem: `${which === 'mic' ? 'Microphone' : 'Desktop sound'}: ${errorMessage(err)}` })
  }
}

/** What each channel should be listening to (null = nothing). */
function desiredKey(which: 'mic' | 'desktop'): string | null {
  const s = useStudio.getState()
  if (which === 'mic') return s.micId === 'off' ? null : s.micId
  return s.desktopOn && desktopAudioSupported ? 'desktop' : null
}

function syncAudio(): void {
  for (const which of ['mic', 'desktop'] as const) {
    const want = desiredKey(which)
    const have = channels[which]?.key ?? null
    if (want === have) continue
    if (want === null) closeChannel(which)
    else void openChannel(which, want)
  }
  applyGains()
}

/** How loud a channel is right now, 0–1 (for the meters). */
export function level(which: 'mic' | 'desktop'): number {
  const m = channels[which]?.meter
  if (!m) return 0
  const data = new Float32Array(m.fftSize)
  m.getFloatTimeDomainData(data)
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  return Math.min(1, peak)
}

export const hasChannel = (which: 'mic' | 'desktop'): boolean => !!channels[which]

// ---------- wake / sleep ----------

/** Ctrl+Shift+1…9 switches to that scene while the Studio is running. */
function onSceneKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return
  const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (!n) return
  const scene = useStudio.getState().scenes[Number(n[1]) - 1]
  if (!scene) return
  e.preventDefault()
  useStudio.setState({ activeScene: scene.id, selected: null })
}

function wake(): void {
  if (loop) return
  window.addEventListener('keydown', onSceneKey, true)
  studioCanvas()
  ensureAudio()
  void audio?.resume()
  startLoop()
  syncFeeds()
  syncAudio()
  stopWatchingMusic = watchMusic()
  unsubscribe = useStudio.subscribe((s, prev) => {
    if (s.scenes !== prev.scenes) syncFeeds()
    if (s.quality !== prev.quality) {
      studioCanvas()
      startLoop()
    }
    if (s.micId !== prev.micId || s.desktopOn !== prev.desktopOn) syncAudio()
    else if (s.micGain !== prev.micGain || s.micMuted !== prev.micMuted || s.desktopGain !== prev.desktopGain || s.desktopMuted !== prev.desktopMuted) applyGains()
  })
}

function sleep(): void {
  if (pageOpen || recorder || liveRecorder) return
  clearInterval(loop)
  loop = undefined
  window.removeEventListener('keydown', onSceneKey, true)
  unsubscribe?.()
  unsubscribe = null
  stopWatchingMusic?.()
  stopWatchingMusic = null
  for (const key of [...feeds.keys()]) closeFeed(key)
  closeChannel('mic')
  closeChannel('desktop')
  void audio?.close()
  audio = null
  mixOut = null
}

/** The Studio page opened (true) or closed (false). */
export function studioPage(open: boolean): void {
  pageOpen = open
  if (open) wake()
  else sleep()
}

// ---------- recording ----------

export async function startRecording(): Promise<void> {
  if (recorder) return
  const type = pickRecordingType((m) => MediaRecorder.isTypeSupported(m))
  if (!type) {
    notify('This computer can’t record video.')
    return
  }
  wake()
  const s = useStudio.getState()
  const q = qualityById(s.quality)
  let file: { id: number; path: string }
  try {
    file = await window.api.studioStart(s.folder, type.ext)
  } catch (err) {
    notify(`Couldn’t start recording: ${errorMessage(err)}`)
    return
  }
  const video = studioCanvas().captureStream(q.fps).getVideoTracks()
  const sound = mixOut?.stream.getAudioTracks() ?? []
  const stream = new MediaStream([...video, ...sound])
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: q.bitrate, audioBitsPerSecond: 192_000 })
  } catch (err) {
    await window.api.studioStop(file.id)
    notify(`Couldn’t start recording: ${errorMessage(err)}`)
    return
  }
  recorder = rec
  recordingId = file.id
  writes = Promise.resolve()
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    const id = file.id
    writes = writes.then(async () => {
      const res = await window.api.studioChunk(id, new Uint8Array(await e.data.arrayBuffer()))
      if (!res.ok && recorder === rec) {
        notify(`Recording stopped: ${res.error ?? 'couldn’t save it'}`)
        void stopRecording()
      }
    })
  }
  rec.onstop = () => {
    video.forEach((t) => t.stop())
    void writes.then(async () => {
      const path = await window.api.studioStop(file.id)
      useStudio.setState({ recording: null, lastRecording: path })
      if (path) notify(`Saved your recording: ${path.split(/[\\/]/).pop()}`, 'info')
      sleep()
    })
  }
  rec.start(1000)
  useStudio.setState({ recording: { startedAt: Date.now(), path: file.path } })
}

export async function stopRecording(): Promise<void> {
  const rec = recorder
  if (!rec || recordingId === 0) return
  recorder = null
  recordingId = 0
  if (rec.state !== 'inactive') rec.stop()
}

export const toggleRecording = (): Promise<void> => (recorder ? stopRecording() : startRecording())

// ---------- going live ----------

let liveRecorder: MediaRecorder | null = null
let liveSends: Promise<unknown> = Promise.resolve()

/** WebM pieces for ffmpeg: H.264 when the computer can make it (less work), otherwise VP8. */
const LIVE_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

window.api.onLiveStats((liveStats) => useStudio.setState({ liveStats }))
window.api.onLiveEnded((error) => {
  const rec = liveRecorder
  liveRecorder = null
  if (rec && rec.state !== 'inactive') rec.stop()
  useStudio.setState({ live: null, liveStats: null })
  if (error) notify(`Your stream stopped: ${error}`)
  sleep()
})

export async function goLive(service: LiveService): Promise<void> {
  if (liveRecorder) return
  const mime = LIVE_TYPES.find((m) => MediaRecorder.isTypeSupported(m))
  if (!mime) {
    notify('This computer can’t make video to stream.')
    return
  }
  wake()
  const q = qualityById(useStudio.getState().quality)
  try {
    await window.api.liveStart(service, q.id)
  } catch (err) {
    notify(errorMessage(err))
    return
  }
  const video = studioCanvas().captureStream(q.fps).getVideoTracks()
  const sound = mixOut?.stream.getAudioTracks() ?? []
  // Sent to ffmpeg nearly untouched (it re-encodes), so keep the quality high.
  const rec = new MediaRecorder(new MediaStream([...video, ...sound]), { mimeType: mime, videoBitsPerSecond: q.bitrate * 1.5, audioBitsPerSecond: 192_000 })
  liveRecorder = rec
  liveSends = Promise.resolve()
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    liveSends = liveSends.then(async () => {
      if (liveRecorder === rec) await window.api.liveChunk(new Uint8Array(await e.data.arrayBuffer()))
    })
  }
  rec.onstop = () => {
    video.forEach((t) => t.stop())
    void liveSends.then(() => window.api.liveStop())
  }
  rec.start(250)
  useStudio.setState({ live: { startedAt: Date.now(), service }, liveStats: null })
}

export function endLive(): void {
  const rec = liveRecorder
  liveRecorder = null
  useStudio.setState({ live: null, liveStats: null })
  if (rec && rec.state !== 'inactive') rec.stop()
  else void window.api.liveStop()
  sleep()
}

export const isLive = (): boolean => !!liveRecorder

// Close everything cleanly when the app is closing.
window.addEventListener('beforeunload', () => {
  void stopRecording()
  if (liveRecorder) endLive()
})
