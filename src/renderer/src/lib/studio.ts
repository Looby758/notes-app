import { fitRect, pickRecordingType, qualityById, type StudioItem } from '@shared/studio'
import { autoMakeupDb, ClipWatch, cleanSummary, cleansAnything, compressorFor, LIMIT_DB, pickAudioType } from '@shared/studioAudio'
import voiceWorkletUrl from './voiceWorklet.ts?worker&url'
import type { LiveService } from '@shared/live'
import { IS_MAC } from '@shared/platform'
import { activePreset, activeScene, loadPreset, micDevices, useMonitor, useStudio } from '../store/studio'
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
let stopMonitorWatch: (() => void) | null = null

// Audio
let audio: AudioContext | null = null
let mixOut: MediaStreamAudioDestinationNode | null = null
interface Channel {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  /** The low-cut (rumble) filter: a high-pass that's set to almost nothing when it's off. */
  filter: BiquadFilterNode
  gain: GainNode
  /** Before Orbit's gain: how loud the mic itself is. */
  input: AnalyserNode
  /** After it: what's recorded. */
  meter: AnalyserNode
  key: string
  /** The mic's voice effects (null for desktop sound). */
  fx: VoiceChain | null
}

/** The mic's voice effects, as audio nodes (see VoiceFx in shared/studioAudio for what each does). */
interface VoiceChain {
  /** The noise gate and de-esser (null if the audio thread couldn't load them). */
  worklet: AudioWorkletNode | null
  mud: BiquadFilterNode
  warmth: BiquadFilterNode
  clarity: BiquadFilterNode
  comp: DynamicsCompressorNode
  makeup: GainNode
  limiter: DynamicsCompressorNode
  /** Takes back the limiter's own automatic boost, so its ceiling really is just under the top. */
  ceiling: GainNode
  /** To your headphones, when "Hear yourself" is on. */
  monitor: GainNode
}

const worklets = new WeakMap<AudioContext, Promise<boolean>>()

/** Loads the gate and de-esser into the audio thread (once per AudioContext). */
function loadVoiceWorklet(ctx: AudioContext): Promise<boolean> {
  let p = worklets.get(ctx)
  if (!p) {
    p = ctx.audioWorklet
      .addModule(voiceWorkletUrl)
      .then(() => true)
      .catch((err) => {
        console.error('[studio] voice effects', err)
        return false
      })
    worklets.set(ctx, p)
  }
  return p
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
  // Audio only: no screens or webcams running at all.
  if (useStudio.getState().audioOnly) return keys
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
  if (useStudio.getState().audioOnly) return
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
  ch.filter.disconnect()
  ch.gain.disconnect()
  if (ch.fx) for (const n of [ch.fx.worklet, ch.fx.mud, ch.fx.warmth, ch.fx.clarity, ch.fx.comp, ch.fx.makeup, ch.fx.limiter, ch.fx.ceiling, ch.fx.monitor]) n?.disconnect()
  channels[which] = null
}

function applyGains(): void {
  const s = useStudio.getState()
  if (channels.mic) {
    channels.mic.gain.gain.value = s.micMuted ? 0 : s.micGain
    channels.mic.filter.frequency.value = s.micClean.lowCut ? s.micClean.voice.lowCutHz : 5
    if (channels.mic.fx) applyVoice(channels.mic.fx)
  }
  if (channels.desktop) channels.desktop.gain.gain.value = s.desktopMuted ? 0 : s.desktopGain
}

async function openChannel(which: 'mic' | 'desktop', key: string): Promise<void> {
  ensureAudio()
  try {
    let stream: MediaStream
    if (which === 'mic') {
      await window.api.micAccess()
      const { micId, micClean } = useStudio.getState()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micId ? { deviceId: { exact: micId } } : {}),
          echoCancellation: micClean.echoCancellation,
          noiseSuppression: micClean.noiseSuppression,
          autoGainControl: micClean.autoGain,
          sampleRate: { ideal: 48000 }
        },
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
    const ctx = audio
    if (which === 'mic' && ctx) await loadVoiceWorklet(ctx)
    if (!audio || audio !== ctx || !mixOut || desiredKey(which) !== key) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    closeChannel(which)
    const source = audio.createMediaStreamSource(stream)
    const filter = audio.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 5
    const gain = audio.createGain()
    const input = audio.createAnalyser()
    const meter = audio.createAnalyser()
    input.fftSize = 2048
    meter.fftSize = 2048
    source.connect(input)
    source.connect(filter)
    let fx: VoiceChain | null = null
    if (which === 'mic') {
      // Mic: low cut → gate and de-esser → EQ → compressor → your volume → limiter → recorded.
      const built = await buildVoice(audio, filter)
      fx = built.fx
      built.out.connect(gain)
      gain.connect(fx.limiter)
      fx.limiter.connect(fx.ceiling)
      fx.ceiling.connect(meter)
      fx.ceiling.connect(mixOut)
      fx.ceiling.connect(fx.monitor)
      fx.monitor.connect(audio.destination)
    } else {
      filter.connect(gain)
      gain.connect(meter)
      gain.connect(mixOut)
    }
    channels[which] = { stream, source, filter, gain, input, meter, key, fx }
    applyGains()
    useStudio.setState({ audioProblem: null })
  } catch (err) {
    useStudio.setState({ audioProblem: `${which === 'mic' ? 'Microphone' : 'Desktop sound'}: ${errorMessage(err)}` })
  }
}

/** Sets the voice effects' knobs from the settings. */
function applyVoice(fx: VoiceChain): void {
  const v = useStudio.getState().micClean.voice
  fx.worklet?.port.postMessage({ gate: { on: v.gate, threshold: v.gateThreshold, range: 22 }, deess: { on: v.deess, amount: v.deessAmount } })
  fx.mud.gain.value = -v.mudCut
  fx.warmth.gain.value = v.warmth
  fx.clarity.gain.value = v.clarity
  const c = compressorFor(v.compressAmount)
  fx.comp.threshold.value = v.compress ? c.threshold : 0
  fx.comp.ratio.value = v.compress ? c.ratio : 1
  fx.comp.knee.value = 0
  fx.comp.attack.value = c.attack
  fx.comp.release.value = c.release
  // The browser's compressor turns itself up afterwards on its own: allow for that, so the
  // volume given back is only what compressorFor asks for.
  fx.makeup.gain.value = v.compress ? Math.pow(10, (c.makeup - autoMakeupDb(c.threshold, c.ratio)) / 20) : 1
  // The limiter: catches peaks just under the top so nothing distorts.
  const lim = { threshold: v.limiter ? LIMIT_DB : 0, ratio: v.limiter ? 20 : 1 }
  fx.limiter.threshold.value = lim.threshold
  fx.limiter.ratio.value = lim.ratio
  fx.limiter.knee.value = 0
  fx.limiter.attack.value = 0.001
  fx.limiter.release.value = 0.08
  fx.ceiling.gain.value = Math.pow(10, -autoMakeupDb(lim.threshold, lim.ratio) / 20)
  fx.monitor.gain.value = useMonitor.getState().on ? 1 : 0
}

/** Builds the mic's voice effects between the low cut and your volume. Returns the chain and its last node. */
async function buildVoice(ctx: AudioContext, from: AudioNode): Promise<{ fx: VoiceChain; out: AudioNode }> {
  const worklet = (await loadVoiceWorklet(ctx)) ? new AudioWorkletNode(ctx, 'orbit-voice-fx', { outputChannelCount: [1] }) : null
  const filt = (type: BiquadFilterType, freq: number, q = 0.9): BiquadFilterNode => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }
  const mud = filt('peaking', 300, 1)
  const warmth = filt('lowshelf', 150)
  const clarity = filt('peaking', 4500, 0.8)
  const comp = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  const ceiling = ctx.createGain()
  const monitor = ctx.createGain()
  monitor.gain.value = 0
  let node: AudioNode = from
  for (const n of [worklet, mud, warmth, clarity, comp, makeup]) {
    if (!n) continue
    node.connect(n)
    node = n
  }
  return { fx: { worklet, mud, warmth, clarity, comp, makeup, limiter, ceiling, monitor }, out: node }
}

/** What each channel should be listening to (null = nothing). */
function desiredKey(which: 'mic' | 'desktop'): string | null {
  const s = useStudio.getState()
  // The clean-up switches are part of the key: changing one opens the mic again with them.
  if (which === 'mic') return s.micId === 'off' ? null : `${s.micId}|${+s.micClean.noiseSuppression}${+s.micClean.echoCancellation}${+s.micClean.autoGain}`
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
export function level(which: 'mic' | 'desktop', stage: 'meter' | 'input' = 'meter'): number {
  const m = channels[which]?.[stage]
  if (!m) return 0
  const data = new Float32Array(m.fftSize)
  m.getFloatTimeDomainData(data)
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  return Math.min(1, peak)
}

export const hasChannel = (which: 'mic' | 'desktop'): boolean => !!channels[which]

// ---------- clipping ----------

const micClip = new ClipWatch()
const gainClip = new ClipWatch()
let clipTimer: ReturnType<typeof setInterval> | undefined

/** Checks the mic for clipping 20 times a second while the Studio is awake. */
function watchClipping(on: boolean): void {
  clearInterval(clipTimer)
  clipTimer = undefined
  if (!on) {
    if (useStudio.getState().clipping) useStudio.setState({ clipping: null })
    return
  }
  clipTimer = setInterval(() => {
    const now = performance.now()
    const muted = useStudio.getState().micMuted
    micClip.push(muted ? 0 : level('mic', 'input'), now)
    gainClip.push(muted ? 0 : level('mic'), now)
    const clipping = micClip.clipping(now) ? 'mic' : gainClip.clipping(now) ? 'gain' : null
    const s = useStudio.getState()
    const clips = s.recording ? Math.max(micClip.clips, gainClip.clips) : s.clips
    if (clipping !== s.clipping || clips !== s.clips) useStudio.setState({ clipping, clips })
  }, 50)
}

/** Starts counting clips from zero (when a recording starts). */
function resetClips(): void {
  micClip.reset()
  gainClip.reset()
  useStudio.setState({ clips: 0 })
}

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
  void refreshPresetMic()
  watchClipping(true)
  stopMonitorWatch = useMonitor.subscribe(() => applyGains())
  stopWatchingMusic = watchMusic()
  unsubscribe = useStudio.subscribe((s, prev) => {
    if (s.scenes !== prev.scenes || s.audioOnly !== prev.audioOnly) syncFeeds()
    if (s.quality !== prev.quality) {
      studioCanvas()
      startLoop()
    }
    if (s.micId !== prev.micId || s.desktopOn !== prev.desktopOn || s.micClean !== prev.micClean) syncAudio()
    else if (s.micGain !== prev.micGain || s.micMuted !== prev.micMuted || s.desktopGain !== prev.desktopGain || s.desktopMuted !== prev.desktopMuted) applyGains()
  })
}

function sleep(): void {
  if (pageOpen || recorder || liveRecorder) return
  clearInterval(loop)
  loop = undefined
  window.removeEventListener('keydown', onSceneKey, true)
  watchClipping(false)
  stopMonitorWatch?.()
  stopMonitorWatch = null
  // Never leave you hearing yourself after the Studio closes.
  useMonitor.setState({ on: false })
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

/**
 * Mic presets load again each session: if the last preset's mic came back with a new id (a
 * different USB port, a Windows update), it's found again by its name.
 */
async function refreshPresetMic(): Promise<void> {
  const s = useStudio.getState()
  const p = activePreset(s)
  if (!p || !p.micId || p.micId === 'off') return
  const devices = await micDevices()
  if (devices.length && !devices.some((d) => d.deviceId === p.micId)) loadPreset(p.id, devices)
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
  if (useStudio.getState().audioOnly) return startAudioRecording()
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
  beginWriting(rec, file, video, false)
}

/** Audio only (voiceovers): just the mic (and desktop sound, if it's on), saved as an .m4a. */
async function startAudioRecording(): Promise<void> {
  const type = pickAudioType((m) => MediaRecorder.isTypeSupported(m))
  if (!type) {
    notify('This computer can’t record sound.')
    return
  }
  wake()
  await audioReady()
  if (!channels.mic && !channels.desktop) {
    notify(useStudio.getState().micId === 'off' ? 'Pick a microphone first (Sound, on the right).' : 'The microphone isn’t working yet. Check Sound, on the right.')
    return
  }
  const s = useStudio.getState()
  let file: { id: number; path: string }
  try {
    file = await window.api.studioStart(s.folder, type.ext, 'voiceover')
  } catch (err) {
    notify(`Couldn’t start recording: ${errorMessage(err)}`)
    return
  }
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(new MediaStream(mixOut?.stream.getAudioTracks() ?? []), { mimeType: type.mime, audioBitsPerSecond: 256_000 })
  } catch (err) {
    await window.api.studioStop(file.id)
    notify(`Couldn’t start recording: ${errorMessage(err)}`)
    return
  }
  beginWriting(rec, file, [], true)
}

/** Waits (up to 2 seconds) for the mic to finish opening, so a recording doesn't start silent. */
async function audioReady(): Promise<void> {
  for (let i = 0; i < 40 && !channels.mic && desiredKey('mic') !== null && !useStudio.getState().audioProblem; i++) await new Promise((r) => setTimeout(r, 50))
}

/** Sends a recorder's pieces to the file as they're made, and tidies up when it stops. */
function beginWriting(rec: MediaRecorder, file: { id: number; path: string }, ownTracks: MediaStreamTrack[], audioOnly: boolean): void {
  recorder = rec
  recordingId = file.id
  writes = Promise.resolve()
  resetClips()
  const startedAt = Date.now()
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
    ownTracks.forEach((t) => t.stop())
    void writes.then(async () => {
      const path = await window.api.studioStop(file.id)
      const clips = useStudio.getState().clips
      useStudio.setState({ recording: null, lastRecording: path, lastRecordingInfo: { audioOnly, clips, length: (Date.now() - startedAt) / 1000 }, trimming: null })
      if (path) {
        const name = path.split(/[\\/]/).pop()
        notify(clips ? `Saved ${name}. Heads up: the mic was too loud ${clips === 1 ? 'once' : `${clips} times`}.` : `Saved your recording: ${name}`, 'info')
        if (audioOnly && useStudio.getState().trim.auto) void trimRecording(path)
      }
      sleep()
    })
  }
  rec.start(1000)
  useStudio.setState({ recording: { startedAt, path: file.path, audioOnly } })
}

// ---------- cleaning up a recording (silences, mouth clicks, hiss, loudness) ----------

/**
 * Makes a cleaned-up copy of a recording ("… (clean).wav", beside it): long pauses shortened,
 * mouth clicks and hiss taken out and the loudness evened out, as the clean-up settings say, using
 * the converter (ffmpeg). The original is never changed.
 */
export async function trimRecording(path: string): Promise<void> {
  if (useStudio.getState().trimming?.state === 'working') return
  const settings = useStudio.getState().trim
  if (!cleansAnything(settings)) {
    useStudio.setState({ trimming: { source: path, state: 'error', message: 'Every clean-up step is turned off (Recording settings, on the right).' } })
    return
  }
  const status = await window.api.videoConverterStatus().catch(() => null)
  if (status?.state !== 'ready') {
    useStudio.setState({
      trimming: {
        source: path,
        state: 'error',
        needsFfmpeg: status?.state === 'missing',
        message:
          status?.state === 'downloading'
            ? 'The sound and video converter is still downloading. Try again in a moment.'
            : status?.state === 'unsupported'
              ? 'Cleaning up needs the converter, which isn’t available for this computer.'
              : 'Cleaning up uses Orbit’s sound and video converter (ffmpeg). Download it once, then clean up.'
      }
    })
    return
  }
  useStudio.setState({ trimming: { source: path, state: 'working' } })
  try {
    const res = await window.api.studioTrim(path, settings)
    // A file that's written as it's recorded may not say how long it is: use how long the recording ran.
    const info = useStudio.getState().lastRecordingInfo
    const before = res.before > res.after + 0.05 || !info || useStudio.getState().lastRecording !== path ? res.before : Math.max(res.before, info.length)
    useStudio.setState({ trimming: { source: path, state: 'done', path: res.path, message: cleanSummary(before, res.after, settings) } })
  } catch (err) {
    useStudio.setState({ trimming: { source: path, state: 'error', message: errorMessage(err) } })
  }
}

/** Downloads the converter, then trims what was waiting for it. */
export async function getConverterAndTrim(): Promise<void> {
  const t = useStudio.getState().trimming
  if (!t) return
  useStudio.setState({ trimming: { source: t.source, state: 'working', message: 'Downloading the converter…' } })
  const state = await window.api.getVideoConverter().catch(() => null)
  if (state?.state !== 'ready') {
    useStudio.setState({ trimming: { source: t.source, state: 'error', needsFfmpeg: true, message: state?.error ? `The download didn’t work: ${state.error}` : 'The download didn’t work. Try again.' } })
    return
  }
  useStudio.setState({ trimming: null })
  await trimRecording(t.source)
}

/** Ctrl+K: cleans up the last audio-only recording. */
export function trimLastRecording(): void {
  const s = useStudio.getState()
  if (!s.lastRecording || !s.lastRecordingInfo?.audioOnly) return notify('Record something with Audio only turned on first (in the Studio).', 'info')
  void trimRecording(s.lastRecording)
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
