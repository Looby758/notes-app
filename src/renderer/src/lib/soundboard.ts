import type { SoundboardAction, SoundboardStatus } from '@shared/soundboard'
import { useSoundboard, type SoundboardState } from '../store/soundboard'
import { localMusicStream } from '../store/localMusic'
import { useMusic } from '../store/music'
import { buildEffect, type Effect } from './voiceFx'

/**
 * The soundboard's sound. Everything your friends should hear (your mic through the voice changer,
 * the clips, your music) is mixed in one AudioContext that plays into the virtual cable. What you
 * hear yourself (the clips, and your own voice with "Hear yourself") goes to your headphones
 * through a second path, so it never ends up in the call twice.
 *
 *   mic → voice changer → mic level ─┬──────────────┐
 *   clips ──────────── sounds level ─┼── limiter → to the cable (the call)
 *   your music ─────── music level ──┘              │
 *   (mic, clips) → monitor level → your headphones (Hear yourself / hear the sounds)
 */

interface Graph {
  ctx: AudioContext
  /** Everything for the call, before the limiter. */
  send: GainNode
  /** The call's sound, for the level meter. */
  meter: AnalyserNode
  /** The voice after the changer (into it go the mic and the effect). */
  voice: GainNode
  /** Into this goes the mic, before the effect. */
  micIn: GainNode
  micMeter: AnalyserNode
  clips: GainNode
  music: GainNode
  /** What you hear: these feed it. */
  voiceToMonitor: GainNode
  clipsToMonitor: GainNode
  monitor: GainNode
  monitorOut: HTMLAudioElement
}

let graph: Graph | null = null
let mic: { stream: MediaStream; source: MediaStreamAudioSourceNode; key: string } | null = null
let micOpening: Promise<void> | null = null
let effect: Effect | null = null
let musicSource: MediaStreamAudioSourceNode | null = null
const buffers = new Map<string, Promise<AudioBuffer>>()
const voices = new Map<string, AudioBufferSourceNode[]>()

const st = (): SoundboardState => useSoundboard.getState()
const problem = (message: string | null): void => useSoundboard.setState({ problem: message })

type SinkContext = AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void> }

function makeGraph(): Graph {
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  const g = (value = 1): GainNode => {
    const n = ctx.createGain()
    n.gain.value = value
    return n
  }
  const send = g()
  // Stops several loud sounds at once from crackling.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
  send.connect(limiter).connect(ctx.destination)
  const meter = ctx.createAnalyser()
  meter.fftSize = 512
  limiter.connect(meter)

  const micIn = g()
  const micMeter = ctx.createAnalyser()
  micMeter.fftSize = 512
  micIn.connect(micMeter)
  const voice = g()
  const clips = g()
  const music = g()
  voice.connect(send)
  clips.connect(send)
  music.connect(send)

  const monitor = g()
  const voiceToMonitor = g(0)
  const clipsToMonitor = g(0)
  voice.connect(voiceToMonitor).connect(monitor)
  clips.connect(clipsToMonitor).connect(monitor)
  const monitorDest = ctx.createMediaStreamDestination()
  monitor.connect(monitorDest)
  const monitorOut = new Audio()
  monitorOut.srcObject = monitorDest.stream
  void monitorOut.play().catch(() => undefined)

  graph = { ctx, send, meter, voice, micIn, micMeter, clips, music, voiceToMonitor, clipsToMonitor, monitor, monitorOut }
  applyEffect()
  applyLevels()
  void applySend()
  void applyMonitor()
  useSoundboard.setState({ running: true })
  return graph
}

function ensure(): Graph {
  const g = graph ?? makeGraph()
  if (g.ctx.state === 'suspended') void g.ctx.resume()
  return g
}

const smooth = (param: AudioParam, value: number): void => {
  if (graph) param.setTargetAtTime(value, graph.ctx.currentTime, 0.02)
}

function applyLevels(): void {
  if (!graph) return
  const s = st()
  smooth(graph.micIn.gain, s.micMuted ? 0 : s.micVolume)
  smooth(graph.clips.gain, s.soundsVolume)
  smooth(graph.music.gain, s.musicOn ? s.musicVolume : 0)
  smooth(graph.monitor.gain, s.monitorVolume)
  smooth(graph.voiceToMonitor.gain, s.hearYourself && s.micOn ? 1 : 0)
  smooth(graph.clipsToMonitor.gain, s.hearSounds ? 1 : 0)
}

function applyEffect(): void {
  if (!graph) return
  const s = st()
  graph.micIn.disconnect()
  graph.micIn.connect(graph.micMeter)
  effect?.output.disconnect()
  effect?.stop()
  effect = buildEffect(graph.ctx, s.voiceOn ? s.voice : 'none')
  graph.micIn.connect(effect.input)
  effect.output.connect(graph.voice)
}

/** Points the call's sound at the virtual cable (or nowhere, until one's picked). */
async function applySend(): Promise<void> {
  if (!graph) return
  const ctx = graph.ctx as SinkContext
  const id = st().sendId
  if (!ctx.setSinkId) {
    problem('This version of Orbit can’t pick where the call’s sound goes. Update Orbit and try again.')
    return
  }
  try {
    await ctx.setSinkId(id ? id : { type: 'none' })
    if (st().problem?.startsWith('Couldn’t send')) problem(null)
  } catch {
    problem('Couldn’t send sound to the cable you picked. Is it still installed? Pick it again under “Send to the call”.')
    await ctx.setSinkId({ type: 'none' }).catch(() => undefined)
  }
}

async function applyMonitor(): Promise<void> {
  if (!graph) return
  const el = graph.monitorOut as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  try {
    await el.setSinkId?.(st().monitorId)
  } catch {
    await el.setSinkId?.('').catch(() => undefined)
  }
  void el.play().catch(() => undefined)
}

function closeMic(): void {
  if (!mic) return
  mic.source.disconnect()
  mic.stream.getTracks().forEach((t) => t.stop())
  mic = null
}

/** Opens (or reopens) the mic when it should be on, closes it when not. */
async function applyMic(): Promise<void> {
  const s = st()
  const key = `${s.micId}|${s.noiseSuppression}`
  if (!s.micOn) {
    closeMic()
    return
  }
  if (mic?.key === key) return
  if (micOpening) {
    await micOpening
    return applyMic()
  }
  micOpening = (async () => {
    closeMic()
    const g = ensure()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(s.micId ? { deviceId: { exact: s.micId } } : {}),
          // Echo cancelling would try to remove the soundboard's own sounds from your voice.
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: s.noiseSuppression,
          channelCount: 1
        }
      })
      if (!st().micOn) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const source = g.ctx.createMediaStreamSource(stream)
      source.connect(g.micIn)
      mic = { stream, source, key }
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (mic?.stream === stream) {
          closeMic()
          problem('The microphone stopped (was it unplugged?). Pick it again, or turn the mic off and on.')
        }
      })
      if (st().problem?.includes('microphone')) problem(null)
    } catch (err) {
      const name = (err as { name?: string }).name
      problem(
        name === 'NotAllowedError'
          ? 'Orbit isn’t allowed to use the microphone. Turn it on in your system’s privacy settings, then try again.'
          : name === 'OverconstrainedError' || name === 'NotFoundError'
            ? 'That microphone isn’t plugged in. Pick another one.'
            : 'Couldn’t start the microphone.'
      )
    }
  })()
  try {
    await micOpening
  } finally {
    micOpening = null
  }
}

/** Your Orbit music into the call (only songs Orbit plays itself; Spotify plays in its own app). */
function applyMusic(): void {
  const s = st()
  if (!s.musicOn) {
    musicSource?.disconnect()
    musicSource = null
    applyLevels()
    return
  }
  const g = ensure()
  if (!musicSource) {
    const stream = localMusicStream()
    if (stream) {
      musicSource = g.ctx.createMediaStreamSource(stream)
      musicSource.connect(g.music)
    }
  }
  applyLevels()
}

// ---------------------------------------------------------------------------------------------
// Clips

function setPlaying(): void {
  useSoundboard.setState({ playing: [...voices].filter(([, list]) => list.length > 0).map(([id]) => id) })
}

function buffer(file: string, ctx: AudioContext): Promise<AudioBuffer> {
  let p = buffers.get(file)
  if (!p) {
    p = fetch(`vault://sound/${encodeURIComponent(file)}`)
      .then((r) => {
        if (!r.ok) throw new Error('missing')
        return r.arrayBuffer()
      })
      .then((data) => ctx.decodeAudioData(data))
    p.catch(() => buffers.delete(file))
    buffers.set(file, p)
  }
  return p
}

export function stopClip(id: string): void {
  for (const src of voices.get(id) ?? []) {
    try {
      src.stop()
    } catch {
      // Already stopped.
    }
  }
  voices.delete(id)
  setPlaying()
}

export function stopAll(): void {
  for (const id of [...voices.keys()]) stopClip(id)
}

export async function playClip(id: string): Promise<void> {
  const clip = st().board.clips.find((c) => c.id === id)
  if (!clip) return
  const g = ensure()
  const already = (voices.get(id)?.length ?? 0) > 0
  if (already && st().repeat === 'stop') return stopClip(id)
  if (already && st().repeat === 'restart') stopClip(id)
  let buf: AudioBuffer
  try {
    buf = await buffer(clip.file, g.ctx)
  } catch {
    problem(`Couldn’t play “${clip.name}”. The file may be damaged, or in a format this computer can’t play.`)
    return
  }
  const src = g.ctx.createBufferSource()
  src.buffer = buf
  const level = g.ctx.createGain()
  level.gain.value = clip.volume
  src.connect(level).connect(g.clips)
  src.onended = () => {
    level.disconnect()
    const list = (voices.get(id) ?? []).filter((s) => s !== src)
    if (list.length) voices.set(id, list)
    else voices.delete(id)
    setPlaying()
  }
  voices.set(id, [...(voices.get(id) ?? []), src])
  src.start()
  setPlaying()
}

/** A hotkey was pressed (in a game, Discord, anywhere). */
export function handleHotkey(action: SoundboardAction): void {
  if (action.kind === 'clip') void playClip(action.id)
  else if (action.kind === 'stopAll') stopAll()
  else if (action.kind === 'voiceToggle') useSoundboard.setState({ voiceOn: !st().voiceOn })
  else if (action.kind === 'muteToggle') useSoundboard.setState({ micMuted: !st().micMuted })
}

// ---------------------------------------------------------------------------------------------
// Meters

function rms(a: AnalyserNode | undefined): number {
  if (!a) return 0
  const data = new Float32Array(a.fftSize)
  a.getFloatTimeDomainData(data)
  let sum = 0
  for (const v of data) sum += v * v
  // Roughly 0…1 for speech and sounds.
  return Math.min(1, Math.sqrt(sum / data.length) * 4)
}

/** How loud what the call hears is right now (0…1). */
export const callLevel = (): number => rms(graph?.meter)
/** How loud your mic is, before the voice changer (0…1). */
export const micLevel = (): number => (mic ? rms(graph?.micMeter) : 0)

// ---------------------------------------------------------------------------------------------
// Start-up

function applyStatus(s: SoundboardStatus): void {
  // Clips whose file changed or went: forget the decoded sound.
  const files = new Set(s.board.clips.map((c) => c.file))
  for (const f of [...buffers.keys()]) if (!files.has(f)) buffers.delete(f)
  for (const id of [...voices.keys()]) if (!s.board.clips.some((c) => c.id === id)) stopClip(id)
  useSoundboard.setState({ board: s.board, hotkeyErrors: s.hotkeyErrors, loaded: true })
}

export const setBoardStatus = applyStatus

let started = false

/** Called once by the main window: listens for hotkeys and opens the mic if it was left on. */
export function startSoundboard(): () => void {
  if (started) return () => undefined
  started = true
  void window.api.soundboardGet().then(applyStatus)
  const offChanged = window.api.onSoundboardChanged(applyStatus)
  const offHotkey = window.api.onSoundboardHotkey(handleHotkey)
  const offStore = useSoundboard.subscribe((s, b) => {
    if (s.micOn !== b.micOn || s.micId !== b.micId || s.noiseSuppression !== b.noiseSuppression) void applyMic()
    if (s.voice !== b.voice || s.voiceOn !== b.voiceOn) applyEffect()
    if (s.sendId !== b.sendId) void applySend()
    if (s.monitorId !== b.monitorId) void applyMonitor()
    if (s.musicOn !== b.musicOn) applyMusic()
    if (
      s.micVolume !== b.micVolume ||
      s.soundsVolume !== b.soundsVolume ||
      s.musicVolume !== b.musicVolume ||
      s.monitorVolume !== b.monitorVolume ||
      s.hearYourself !== b.hearYourself ||
      s.hearSounds !== b.hearSounds ||
      s.micMuted !== b.micMuted ||
      s.micOn !== b.micOn
    )
      applyLevels()
  })
  // Your own music may only start after "music into the call" was turned on.
  const offMusic = useMusic.subscribe((s, b) => {
    if (s.local && !b.local && st().musicOn && !musicSource) applyMusic()
  })
  const s = st()
  if (s.micOn) void applyMic()
  if (s.musicOn) applyMusic()
  return () => {
    started = false
    offChanged()
    offHotkey()
    offStore()
    offMusic()
  }
}
