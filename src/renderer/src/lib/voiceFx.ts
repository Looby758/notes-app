import { pitchShiftSettings, voiceEffect, type VoiceEffectId } from '@shared/soundboard'

/**
 * The voice changer's effects, made from plain Web Audio nodes (so they run on the audio thread
 * with no extra code to load). Each one is a little chain with an input and an output.
 */

export interface Effect {
  input: AudioNode
  output: AudioNode
  /** Stops its oscillators and loops. */
  stop: () => void
}

// The pitch shifter: two delay lines whose delay slides steadily (which changes the pitch, like a
// passing siren), each restarting while the other is faded in. After Chris Wilson's "Jungle".
const DELAY = 0.1
const FADE = 0.05
const BUFFER = 0.1

function fadeBuffer(ctx: BaseAudioContext): AudioBuffer {
  const active = BUFFER * ctx.sampleRate
  const quiet = (BUFFER - 2 * FADE) * ctx.sampleRate
  const fade = FADE * ctx.sampleRate
  const buf = ctx.createBuffer(1, Math.max(1, Math.round(active + quiet)), ctx.sampleRate)
  const p = buf.getChannelData(0)
  for (let i = 0; i < active; i++) {
    if (i < fade) p[i] = Math.sqrt(i / fade)
    else if (i >= active - fade) p[i] = Math.sqrt(1 - (i - (active - fade)) / fade)
    else p[i] = 1
  }
  return buf
}

function rampBuffer(ctx: BaseAudioContext, up: boolean): AudioBuffer {
  const active = BUFFER * ctx.sampleRate
  const quiet = (BUFFER - 2 * FADE) * ctx.sampleRate
  const buf = ctx.createBuffer(1, Math.max(1, Math.round(active + quiet)), ctx.sampleRate)
  const p = buf.getChannelData(0)
  const len = active + quiet
  for (let i = 0; i < active; i++) p[i] = up ? (active - i) / len : i / active
  return buf
}

export function pitchShifter(ctx: AudioContext, ratio: number): Effect {
  const input = ctx.createGain()
  const output = ctx.createGain()
  // The two lines' fades overlap a little louder than the voice was.
  output.gain.value = 0.8
  const { up, amount } = pitchShiftSettings(ratio)
  const ramp = rampBuffer(ctx, up)
  const loop = (buffer: AudioBuffer): AudioBufferSourceNode => {
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.loop = true
    return s
  }
  const mod1 = loop(ramp)
  const mod2 = loop(ramp)
  const depth1 = ctx.createGain()
  const depth2 = ctx.createGain()
  depth1.gain.value = 0.5 * DELAY * amount
  depth2.gain.value = 0.5 * DELAY * amount
  const delay1 = ctx.createDelay(1)
  const delay2 = ctx.createDelay(1)
  delay1.delayTime.value = 0
  delay2.delayTime.value = 0
  mod1.connect(depth1).connect(delay1.delayTime)
  mod2.connect(depth2).connect(delay2.delayTime)
  const fades = fadeBuffer(ctx)
  const fade1 = loop(fades)
  const fade2 = loop(fades)
  const mix1 = ctx.createGain()
  const mix2 = ctx.createGain()
  mix1.gain.value = 0
  mix2.gain.value = 0
  fade1.connect(mix1.gain)
  fade2.connect(mix2.gain)
  input.connect(delay1).connect(mix1).connect(output)
  input.connect(delay2).connect(mix2).connect(output)
  const t = ctx.currentTime + 0.05
  const t2 = t + BUFFER - FADE
  mod1.start(t)
  fade1.start(t)
  mod2.start(t2)
  fade2.start(t2)
  return {
    input,
    output,
    stop: () => {
      for (const s of [mod1, mod2, fade1, fade2]) {
        try {
          s.stop()
        } catch {
          // Already stopped.
        }
      }
    }
  }
}

/** A gentle overdrive curve. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(n)
  const k = amount * 50
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

function filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, gain = 0, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.gain.value = gain
  f.Q.value = q
  return f
}

/** Chains effects one after another. */
function chain(parts: Effect[]): Effect {
  for (let i = 0; i < parts.length - 1; i++) parts[i].output.connect(parts[i + 1].input)
  return { input: parts[0].input, output: parts[parts.length - 1].output, stop: () => parts.forEach((p) => p.stop()) }
}

const node = (n: AudioNode): Effect => ({ input: n, output: n, stop: () => undefined })

function ringMod(ctx: AudioContext, frequency: number, wet: number): Effect {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const ring = ctx.createGain()
  ring.gain.value = 0
  const osc = ctx.createOscillator()
  osc.frequency.value = frequency
  osc.connect(ring.gain)
  osc.start()
  const dry = ctx.createGain()
  dry.gain.value = 1 - wet
  const wetGain = ctx.createGain()
  wetGain.gain.value = wet * 1.4
  input.connect(ring).connect(wetGain).connect(output)
  input.connect(dry).connect(output)
  return { input, output, stop: () => osc.stop() }
}

/** Short feedback delay: the metallic "tin can" ring. */
function comb(ctx: AudioContext, time: number, feedback: number): Effect {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const delay = ctx.createDelay(1)
  delay.delayTime.value = time
  const fb = ctx.createGain()
  fb.gain.value = feedback
  input.connect(output)
  input.connect(delay)
  delay.connect(fb).connect(delay)
  delay.connect(output)
  return { input, output, stop: () => undefined }
}

function echo(ctx: AudioContext): Effect {
  const input = ctx.createGain()
  const output = ctx.createGain()
  input.connect(output)
  for (const [time, level] of [
    [0.23, 0.45],
    [0.37, 0.3]
  ]) {
    const d = ctx.createDelay(2)
    d.delayTime.value = time
    const fb = ctx.createGain()
    fb.gain.value = level
    const dark = filter(ctx, 'lowpass', 2200)
    input.connect(d)
    d.connect(dark).connect(fb).connect(d)
    const out = ctx.createGain()
    out.gain.value = 0.6
    d.connect(out).connect(output)
  }
  return { input, output, stop: () => undefined }
}

/** A slow wobble in pitch (vibrato). */
function wobble(ctx: AudioContext, rate: number, depth: number): Effect {
  const d = ctx.createDelay(0.1)
  d.delayTime.value = 0.01
  const lfo = ctx.createOscillator()
  lfo.frequency.value = rate
  const amount = ctx.createGain()
  amount.gain.value = depth
  lfo.connect(amount).connect(d.delayTime)
  lfo.start()
  return { input: d, output: d, stop: () => lfo.stop() }
}

function drive(ctx: AudioContext, amount: number): Effect {
  const w = ctx.createWaveShaper()
  w.curve = driveCurve(amount)
  w.oversample = '2x'
  return node(w)
}

function level(ctx: AudioContext, gain: number): Effect {
  const g = ctx.createGain()
  g.gain.value = gain
  return node(g)
}

/** The chain for a voice. */
export function buildEffect(ctx: AudioContext, id: VoiceEffectId): Effect {
  const v = voiceEffect(id)
  switch (v.id) {
    case 'robot':
      return chain([node(filter(ctx, 'highpass', 140)), ringMod(ctx, 55, 0.85), comb(ctx, 0.009, 0.45), level(ctx, 0.55)])
    case 'deep':
      return chain([pitchShifter(ctx, v.pitch), node(filter(ctx, 'lowshelf', 220, 4))])
    case 'chipmunk':
      return chain([node(filter(ctx, 'highpass', 180)), pitchShifter(ctx, v.pitch)])
    case 'demon':
      return chain([pitchShifter(ctx, v.pitch), drive(ctx, 0.25), node(filter(ctx, 'lowshelf', 180, 6)), ringMod(ctx, 30, 0.25), level(ctx, 0.65)])
    case 'radio':
      return chain([node(filter(ctx, 'highpass', 450)), node(filter(ctx, 'lowpass', 3200)), node(filter(ctx, 'peaking', 1600, 6, 1)), drive(ctx, 0.5), level(ctx, 0.6)])
    case 'cave':
      return chain([echo(ctx), level(ctx, 0.6)])
    case 'alien':
      return chain([pitchShifter(ctx, v.pitch), wobble(ctx, 7, 0.0025), ringMod(ctx, 220, 0.3)])
    default:
      return node(ctx.createGain())
  }
}
