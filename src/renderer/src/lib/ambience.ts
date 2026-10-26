/**
 * Background sounds for zen mode, made on the fly (no audio files, works offline):
 *   rain        soft hiss with drops
 *   café        low room rumble, a murmur that comes and goes, the odd cup clink
 *   white noise steady, gentle hiss
 */

export type Sound = 'rain' | 'cafe' | 'white'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let stopCurrent: (() => void) | null = null
let current: Sound | null = null
let volume = 0.5

function context(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return { ctx, master: master! }
}

/** A few seconds of noise to loop: white, or "brown" (deeper, like a distant rumble). */
function noiseBuffer(c: AudioContext, colour: 'white' | 'brown' | 'pink'): AudioBuffer {
  const length = c.sampleRate * 4
  const buf = c.createBuffer(2, length, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let last = 0
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      if (colour === 'white') data[i] = w * 0.5
      else if (colour === 'brown') {
        last = (last + 0.02 * w) / 1.02
        data[i] = last * 3.5
      } else {
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11
      }
    }
  }
  return buf
}

function loop(c: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = c.createBufferSource()
  src.buffer = buffer
  src.loop = true
  return src
}

function filter(c: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = q
  return f
}

function gain(c: AudioContext, value: number): GainNode {
  const g = c.createGain()
  g.gain.value = value
  return g
}

function rain(c: AudioContext, out: AudioNode): () => void {
  const hiss = loop(c, noiseBuffer(c, 'pink'))
  const hp = filter(c, 'highpass', 400)
  const lp = filter(c, 'lowpass', 7000)
  hiss.connect(hp).connect(lp).connect(gain(c, 0.9)).connect(out)
  hiss.start()
  // Drops: tiny filtered clicks at random.
  const white = noiseBuffer(c, 'white')
  let alive = true
  const drop = (): void => {
    if (!alive) return
    const s = c.createBufferSource()
    s.buffer = white
    const bp = filter(c, 'bandpass', 2500 + Math.random() * 4000, 4)
    const g = gain(c, 0)
    const t = c.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.35, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.06)
    s.connect(bp).connect(g).connect(out)
    s.start(t, Math.random() * 3, 0.15)
    setTimeout(drop, 20 + Math.random() * 120)
  }
  drop()
  return () => {
    alive = false
    hiss.stop()
  }
}

function cafe(c: AudioContext, out: AudioNode): () => void {
  const room = loop(c, noiseBuffer(c, 'brown'))
  room.connect(filter(c, 'lowpass', 350)).connect(gain(c, 0.8)).connect(out)
  // Murmur: voice-range noise that swells and fades, like people talking at other tables.
  const murmur = loop(c, noiseBuffer(c, 'pink'))
  const voice = filter(c, 'bandpass', 520, 1.2)
  const swell = gain(c, 0.35)
  const lfo = c.createOscillator()
  const depth = gain(c, 0.22)
  lfo.frequency.value = 0.17
  lfo.connect(depth).connect(swell.gain)
  murmur.connect(voice).connect(swell).connect(out)
  room.start()
  murmur.start()
  lfo.start()
  // Now and then, a cup or spoon.
  let alive = true
  const clink = (): void => {
    if (!alive) return
    const t = c.currentTime
    for (const f of [2600 + Math.random() * 1500, 4100 + Math.random() * 1500]) {
      const o = c.createOscillator()
      o.frequency.value = f
      const g = gain(c, 0)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.03, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.connect(g).connect(out)
      o.start(t)
      o.stop(t + 0.4)
    }
    setTimeout(clink, 3000 + Math.random() * 9000)
  }
  setTimeout(clink, 2000)
  return () => {
    alive = false
    room.stop()
    murmur.stop()
    lfo.stop()
  }
}

function whiteNoise(c: AudioContext, out: AudioNode): () => void {
  const n = loop(c, noiseBuffer(c, 'white'))
  n.connect(filter(c, 'lowpass', 6000)).connect(gain(c, 0.35)).connect(out)
  n.start()
  return () => n.stop()
}

export function playSound(sound: Sound | null): void {
  stopCurrent?.()
  stopCurrent = null
  current = sound
  if (!sound) return
  const { ctx: c, master: m } = context()
  stopCurrent = sound === 'rain' ? rain(c, m) : sound === 'cafe' ? cafe(c, m) : whiteNoise(c, m)
}

export const playingSound = (): Sound | null => current

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05)
}

/** A soft two-note chime (focus timer finished). */
export function chime(): void {
  const { ctx: c, master: m } = context()
  const t = c.currentTime
  ;[784, 1046.5].forEach((f, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const g = gain(c, 0)
    g.gain.setValueAtTime(0, t + i * 0.25)
    g.gain.linearRampToValueAtTime(0.4, t + i * 0.25 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 1.6)
    o.connect(g).connect(m)
    o.start(t + i * 0.25)
    o.stop(t + i * 0.25 + 1.7)
  })
}
