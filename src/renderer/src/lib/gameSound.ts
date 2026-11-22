/**
 * Sound effects for the mini games, made in code with the Web Audio API (no sound files). Each
 * effect is a few oscillators and filtered noise through little envelopes, sent through a short
 * room reverb and a compressor so they sit together nicely.
 *
 * Sound is on by default and can be turned off or down with the speaker button in a game (the
 * setting lives on this computer only, like the games themselves).
 */

export type GameSound =
  | 'tap' // a button or picker
  | 'place' // a number, letter or mark goes in
  | 'erase'
  | 'select'
  | 'wrong' // a mistake or a wrong guess
  | 'right' // a good guess
  | 'flag'
  | 'open' // a square opens
  | 'boom'
  | 'unit' // a row, column or box finished
  | 'found' // a word found
  | 'type' // a key in Wordle
  | 'flip' // a tile or card turns over
  | 'deal'
  | 'chip'
  | 'slide' // tiles slide
  | 'merge' // 2048 tiles join (pitch from `level`)
  | 'combo'
  | 'paddle'
  | 'brick' // pitch from `level` (the row)
  | 'crack' // a tough brick takes a hit
  | 'wall'
  | 'launch'
  | 'lifeLost'
  | 'levelUp'
  | 'move' // a chess piece
  | 'capture'
  | 'check'
  | 'snap' // a jigsaw piece fits
  | 'pickup'
  | 'win'
  | 'bigWin'
  | 'lose'
  | 'push' // a draw

export interface SoundSettings {
  on: boolean
  /** 0 to 1. */
  volume: number
}

const KEY = 'notesapp.minigames.sound'
const DEFAULTS: SoundSettings = { on: true, volume: 0.6 }

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null
    if (!raw) return { ...DEFAULTS }
    return {
      on: typeof raw.on === 'boolean' ? raw.on : DEFAULTS.on,
      volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : DEFAULTS.volume
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings = typeof localStorage !== 'undefined' ? loadSoundSettings() : { ...DEFAULTS }
const listeners = new Set<() => void>()

export const soundSettings = (): SoundSettings => settings

export function setSoundSettings(next: Partial<SoundSettings>): void {
  settings = { ...settings, ...next, volume: Math.max(0, Math.min(1, next.volume ?? settings.volume)) }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Not remembered, but still used this time.
  }
  if (master && ctx) master.gain.setTargetAtTime(gainFor(settings), ctx.currentTime, 0.02)
  listeners.forEach((l) => l())
}

export function onSoundSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** A gentle curve, so the low end of the slider is still usable. */
const gainFor = (s: SoundSettings): number => (s.on ? s.volume * s.volume * 0.9 : 0)

/** A note `semis` semitones above A4 (440 Hz). */
export const noteHz = (semis: number): number => 440 * Math.pow(2, semis / 12)

/** The pitch for a merged 2048 tile: up a step of a major scale for each doubling. */
export function mergeHz(value: number): number {
  const step = Math.max(0, Math.round(Math.log2(Math.max(2, value))) - 2)
  const scale = [0, 2, 4, 7, 9]
  const semis = scale[step % scale.length] + 12 * Math.floor(step / scale.length)
  return noteHz(-9 + semis) // from C4 upwards
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let dry: GainNode | null = null
let wet: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' ? window.AudioContext : undefined
  if (!AC) return null
  try {
    ctx = new AC()
  } catch {
    return null
  }
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 4
  comp.attack.value = 0.003
  comp.release.value = 0.15
  master = ctx.createGain()
  master.gain.value = gainFor(settings)
  master.connect(comp).connect(ctx.destination)

  dry = ctx.createGain()
  dry.connect(master)
  // A small, bright room: a few hundred ms of decaying noise.
  const verb = ctx.createConvolver()
  const len = Math.floor(ctx.sampleRate * 0.6)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  verb.buffer = ir
  wet = ctx.createGain()
  wet.gain.value = 0.22
  wet.connect(verb).connect(master)

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const n = noiseBuf.getChannelData(0)
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1
  return ctx
}

interface Tone {
  type?: OscillatorType
  freq: number
  /** Where the pitch glides to by the end. */
  to?: number
  at?: number
  dur: number
  gain?: number
  attack?: number
  /** How much goes to the reverb (0 to 1). */
  verb?: number
  detune?: number
}

function out(c: AudioContext, node: AudioNode, verb: number): void {
  node.connect(dry!)
  if (verb > 0) {
    const send = c.createGain()
    send.gain.value = verb
    node.connect(send).connect(wet!)
  }
}

function tone(c: AudioContext, t0: number, { type = 'sine', freq, to, at = 0, dur, gain = 0.3, attack = 0.004, verb = 0.3, detune = 0 }: Tone): void {
  const start = t0 + at
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur)
  osc.detune.value = detune
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  out(c, g, verb)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

interface Noise {
  at?: number
  dur: number
  gain?: number
  filter?: BiquadFilterType
  freq: number
  /** Where the filter sweeps to. */
  to?: number
  q?: number
  attack?: number
  verb?: number
}

function noise(c: AudioContext, t0: number, { at = 0, dur, gain = 0.3, filter = 'bandpass', freq, to, q = 1, attack = 0.002, verb = 0.2 }: Noise): void {
  const start = t0 + at
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.playbackRate.value = 0.9 + Math.random() * 0.2
  const f = c.createBiquadFilter()
  f.type = filter
  f.frequency.setValueAtTime(freq, start)
  if (to) f.frequency.exponentialRampToValueAtTime(to, start + dur)
  f.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(f).connect(g)
  out(c, g, verb)
  src.start(start, Math.random() * 0.5)
  src.stop(start + dur + 0.05)
}

/** A soft bell: a sine with a quieter, higher partial on top. */
function bell(c: AudioContext, t0: number, freq: number, at: number, dur = 0.5, gain = 0.22, verb = 0.45): void {
  tone(c, t0, { freq, at, dur, gain, verb })
  tone(c, t0, { freq: freq * 2.01, at, dur: dur * 0.6, gain: gain * 0.35, verb })
  tone(c, t0, { type: 'triangle', freq: freq * 3.99, at, dur: dur * 0.25, gain: gain * 0.12, verb })
}

/** A wooden knock (chess pieces, flags). */
function knock(c: AudioContext, t0: number, freq: number, gain = 0.35, at = 0): void {
  tone(c, t0, { type: 'sine', freq, to: freq * 0.6, at, dur: 0.09, gain, attack: 0.001, verb: 0.25 })
  tone(c, t0, { type: 'triangle', freq: freq * 2.7, to: freq * 1.8, at, dur: 0.04, gain: gain * 0.3, attack: 0.001, verb: 0.15 })
  noise(c, t0, { at, dur: 0.03, gain: gain * 0.5, filter: 'bandpass', freq: freq * 6, q: 2, verb: 0.1 })
}

const jitter = (amount = 0.03): number => 1 + (Math.random() * 2 - 1) * amount

type Recipe = (c: AudioContext, t: number, level?: number) => void

const RECIPES: Record<GameSound, Recipe> = {
  tap: (c, t) => tone(c, t, { type: 'triangle', freq: 1250 * jitter(), to: 900, dur: 0.05, gain: 0.12, verb: 0.1 }),
  select: (c, t) => tone(c, t, { type: 'sine', freq: 990 * jitter(), dur: 0.07, gain: 0.14, verb: 0.15 }),
  place: (c, t, level) => {
    const f = (level === undefined ? 660 : noteHz(level + 12)) * jitter(0.01)
    tone(c, t, { type: 'triangle', freq: f * 1.5, to: f, dur: 0.12, gain: 0.22, attack: 0.002, verb: 0.25 })
    tone(c, t, { freq: f * 2, dur: 0.06, gain: 0.06, verb: 0.2 })
  },
  erase: (c, t) => noise(c, t, { dur: 0.09, gain: 0.12, filter: 'highpass', freq: 2500, to: 6000, verb: 0.05 }),
  wrong: (c, t) => {
    tone(c, t, { type: 'square', freq: 196, to: 150, dur: 0.18, gain: 0.07, verb: 0.15 })
    tone(c, t, { type: 'sawtooth', freq: 207, to: 155, dur: 0.18, gain: 0.05, verb: 0.15 })
    tone(c, t, { freq: 98, to: 70, dur: 0.2, gain: 0.25, verb: 0 })
  },
  right: (c, t) => {
    bell(c, t, noteHz(7), 0, 0.35, 0.18)
    bell(c, t, noteHz(14), 0.07, 0.45, 0.16)
  },
  flag: (c, t) => {
    knock(c, t, 520, 0.3)
    tone(c, t, { freq: 1568, at: 0.03, dur: 0.12, gain: 0.08, verb: 0.3 })
  },
  open: (c, t) => {
    noise(c, t, { dur: 0.05, gain: 0.14, filter: 'bandpass', freq: 1800 * jitter(0.2), q: 3, verb: 0.15 })
    tone(c, t, { type: 'sine', freq: 520 * jitter(0.08), to: 780, dur: 0.06, gain: 0.08, verb: 0.15 })
  },
  boom: (c, t) => {
    tone(c, t, { freq: 140, to: 32, dur: 0.9, gain: 0.7, attack: 0.002, verb: 0.2 })
    tone(c, t, { type: 'triangle', freq: 70, to: 28, dur: 1.1, gain: 0.35, verb: 0.2 })
    noise(c, t, { dur: 1.2, gain: 0.6, filter: 'lowpass', freq: 3200, to: 120, q: 0.7, verb: 0.5 })
    noise(c, t, { at: 0.03, dur: 0.25, gain: 0.25, filter: 'highpass', freq: 3000, verb: 0.3 })
  },
  unit: (c, t) => [0, 4, 7, 12].forEach((s, i) => bell(c, t, noteHz(3 + s), i * 0.055, 0.5, 0.14)),
  found: (c, t) => {
    ;[0, 4, 7, 11, 14].forEach((s, i) => bell(c, t, noteHz(3 + s), i * 0.045, 0.45, 0.13))
    noise(c, t, { dur: 0.35, gain: 0.05, filter: 'highpass', freq: 7000, verb: 0.5 })
  },
  type: (c, t) => {
    noise(c, t, { dur: 0.035, gain: 0.18, filter: 'bandpass', freq: 3200 * jitter(0.15), q: 1.5, verb: 0.05 })
    tone(c, t, { type: 'square', freq: 180 * jitter(0.1), dur: 0.03, gain: 0.04, verb: 0 })
  },
  flip: (c, t, level) => {
    noise(c, t, { dur: 0.07, gain: 0.16, filter: 'bandpass', freq: 2400, to: 900, q: 1.2, verb: 0.1 })
    if (level !== undefined) tone(c, t, { type: 'triangle', freq: noteHz(level + 12), at: 0.03, dur: 0.18, gain: 0.12, verb: 0.3 })
  },
  deal: (c, t) => {
    noise(c, t, { dur: 0.11, gain: 0.2, filter: 'bandpass', freq: 1400, to: 4200, q: 0.9, attack: 0.01, verb: 0.1 })
    noise(c, t, { at: 0.09, dur: 0.03, gain: 0.12, filter: 'lowpass', freq: 900, verb: 0.05 })
  },
  chip: (c, t) => {
    const f = jitter(0.04)
    tone(c, t, { freq: 2950 * f, dur: 0.12, gain: 0.08, attack: 0.001, verb: 0.2 })
    tone(c, t, { freq: 4320 * f, dur: 0.09, gain: 0.05, attack: 0.001, verb: 0.2 })
    tone(c, t, { freq: 3100 * f, at: 0.045, dur: 0.1, gain: 0.06, attack: 0.001, verb: 0.2 })
    noise(c, t, { dur: 0.02, gain: 0.12, filter: 'highpass', freq: 5000, verb: 0 })
  },
  slide: (c, t) => noise(c, t, { dur: 0.1, gain: 0.07, filter: 'bandpass', freq: 600, to: 1600, q: 0.8, attack: 0.02, verb: 0.05 }),
  merge: (c, t, level) => {
    const f = mergeHz(level ?? 4)
    tone(c, t, { type: 'sine', freq: f * 0.5, to: f, dur: 0.16, gain: 0.26, attack: 0.002, verb: 0.3 })
    tone(c, t, { type: 'triangle', freq: f, dur: 0.22, gain: 0.1, at: 0.02, verb: 0.35 })
    if ((level ?? 0) >= 128) bell(c, t, f * 2, 0.05, 0.5, 0.08)
  },
  combo: (c, t, level) => [0, 4, 7, 12].slice(0, Math.min(4, 1 + (level ?? 1))).forEach((s, i) => bell(c, t, noteHz(8 + s), i * 0.05, 0.35, 0.12)),
  paddle: (c, t) => {
    tone(c, t, { freq: 220, to: 140, dur: 0.1, gain: 0.3, attack: 0.001, verb: 0.15 })
    tone(c, t, { type: 'square', freq: 440, dur: 0.03, gain: 0.04, verb: 0 })
  },
  brick: (c, t, level) => {
    const f = noteHz([15, 12, 10, 7, 5, 3, 0, -2][(level ?? 0) % 8])
    tone(c, t, { type: 'square', freq: f, dur: 0.07, gain: 0.07, attack: 0.001, verb: 0.2 })
    tone(c, t, { type: 'triangle', freq: f * 2, dur: 0.12, gain: 0.08, verb: 0.3 })
    noise(c, t, { dur: 0.06, gain: 0.08, filter: 'highpass', freq: 4000, verb: 0.1 })
  },
  crack: (c, t) => {
    knock(c, t, 340, 0.25)
    noise(c, t, { dur: 0.05, gain: 0.1, filter: 'bandpass', freq: 5000, q: 4, verb: 0.05 })
  },
  wall: (c, t) => tone(c, t, { type: 'triangle', freq: 330, to: 300, dur: 0.04, gain: 0.07, attack: 0.001, verb: 0.05 }),
  launch: (c, t) => tone(c, t, { type: 'triangle', freq: 300, to: 900, dur: 0.15, gain: 0.15, verb: 0.2 }),
  lifeLost: (c, t) => {
    tone(c, t, { type: 'sawtooth', freq: 440, to: 110, dur: 0.6, gain: 0.08, verb: 0.3 })
    tone(c, t, { type: 'square', freq: 330, to: 82, dur: 0.6, gain: 0.05, verb: 0.3 })
  },
  levelUp: (c, t) => {
    ;[0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(c, t, { type: 'square', freq: noteHz(3 + s), at: i * 0.055, dur: 0.12, gain: 0.06, verb: 0.3 }))
    bell(c, t, noteHz(27), 0.4, 0.7, 0.12)
  },
  move: (c, t) => knock(c, t, 300 * jitter(0.05), 0.4),
  capture: (c, t) => {
    knock(c, t, 260, 0.45)
    knock(c, t, 390, 0.3, 0.045)
    noise(c, t, { dur: 0.08, gain: 0.12, filter: 'bandpass', freq: 2000, q: 2, verb: 0.1 })
  },
  check: (c, t) => {
    bell(c, t, noteHz(10), 0, 0.3, 0.15)
    bell(c, t, noteHz(15), 0.11, 0.45, 0.16)
  },
  snap: (c, t) => {
    knock(c, t, 700, 0.3)
    tone(c, t, { freq: noteHz(19), at: 0.03, dur: 0.25, gain: 0.07, verb: 0.4 })
  },
  pickup: (c, t) => tone(c, t, { type: 'triangle', freq: 500, to: 720, dur: 0.07, gain: 0.08, verb: 0.1 }),
  win: (c, t) => {
    ;[0, 4, 7, 12].forEach((s, i) => bell(c, t, noteHz(3 + s), i * 0.09, 0.6, 0.18))
    ;[7, 12, 16].forEach((s) => tone(c, t, { type: 'triangle', freq: noteHz(3 + s), at: 0.36, dur: 0.9, gain: 0.06, attack: 0.02, verb: 0.6 }))
  },
  bigWin: (c, t) => {
    ;[0, 4, 7, 12, 16, 19, 24].forEach((s, i) => bell(c, t, noteHz(-2 + s), i * 0.07, 0.6, 0.15))
    // A held chord under it, then a sparkle on top.
    ;[0, 7, 12, 16].forEach((s) => {
      tone(c, t, { type: 'sawtooth', freq: noteHz(-14 + s), at: 0.45, dur: 1.4, gain: 0.025, attack: 0.08, verb: 0.6, detune: -6 })
      tone(c, t, { type: 'sawtooth', freq: noteHz(-14 + s), at: 0.45, dur: 1.4, gain: 0.025, attack: 0.08, verb: 0.6, detune: 6 })
    })
    for (let i = 0; i < 10; i++) bell(c, t, noteHz(24 + [0, 4, 7, 12, 16][i % 5]), 0.5 + i * 0.06, 0.3, 0.05, 0.7)
  },
  lose: (c, t) => {
    ;[7, 6, 5].forEach((s, i) => tone(c, t, { type: 'triangle', freq: noteHz(-5 + s), at: i * 0.22, dur: 0.3, gain: 0.16, verb: 0.35 }))
    tone(c, t, { type: 'triangle', freq: noteHz(-1), to: noteHz(-3), at: 0.66, dur: 0.8, gain: 0.16, verb: 0.45 })
  },
  push: (c, t) => {
    bell(c, t, noteHz(3), 0, 0.35, 0.12)
    bell(c, t, noteHz(3), 0.14, 0.4, 0.1)
  }
}

// The same sound can't stack up more often than this (a ripple of opening squares, say).
const MIN_GAP: Partial<Record<GameSound, number>> = { open: 0.035, brick: 0.03, wall: 0.05, paddle: 0.05, type: 0.02, deal: 0.05, chip: 0.05, slide: 0.06 }
const last = new Map<GameSound, number>()

/**
 * Plays a sound now (or `delay` seconds from now). `level` changes the pitch for the sounds that
 * use it: the tile value for `merge`, the row for `brick`, a semitone for `place` and `flip`.
 */
export function playSound(name: GameSound, level?: number, delay = 0): void {
  if (!settings.on || settings.volume <= 0) return
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime + 0.005 + delay
  const gap = MIN_GAP[name]
  if (gap && delay === 0) {
    const prev = last.get(name) ?? -1
    if (t - prev < gap) return
    last.set(name, t)
  }
  try {
    RECIPES[name](c, t, level)
  } catch {
    // A sound that can't play is never worth breaking a game over.
  }
}

/** The `n`th note (from 0) of a major pentatonic scale, as semitones from A4: tuneful whatever order. */
export function scaleNote(n: number): number {
  const scale = [0, 2, 4, 7, 9]
  return -9 + scale[((n % 5) + 5) % 5] + 12 * Math.floor(n / 5)
}
