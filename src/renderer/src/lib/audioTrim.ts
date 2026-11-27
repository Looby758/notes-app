/**
 * The audio editor's arithmetic (components/AudioEditor): what part of the sound is kept, how it
 * sounds while you listen, and the trimmed sound itself. Times are in seconds.
 */

/** Keep what's picked, or cut it out and join what's either side. */
export type TrimMode = 'keep' | 'cut'

export interface Selection {
  start: number
  end: number
}

/** The shortest part that can be picked. */
export const MIN_LENGTH = 0.05
/** Where a cut joins two parts, each side fades this much so there's no click. */
const JOIN_FADE = 0.005

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** A selection inside the sound, the right way round and never shorter than MIN_LENGTH. */
export function fixSelection(sel: Selection, duration: number): Selection {
  let start = clamp(Math.min(sel.start, sel.end), 0, duration)
  let end = clamp(Math.max(sel.start, sel.end), 0, duration)
  const min = Math.min(MIN_LENGTH, duration)
  if (end - start < min) {
    if (start + min <= duration) end = start + min
    else start = Math.max(0, end - min)
  }
  return { start, end }
}

/** The parts of the original that end up in the saved sound, in order. */
export function keptParts(sel: Selection, mode: TrimMode, duration: number): [number, number][] {
  if (mode === 'keep') return [[sel.start, sel.end]]
  return ([[0, sel.start], [sel.end, duration]] as [number, number][]).filter(([a, b]) => b - a > 1e-6)
}

/** How long the saved sound will be. */
export const resultLength = (sel: Selection, mode: TrimMode, duration: number): number =>
  keptParts(sel, mode, duration).reduce((n, [a, b]) => n + b - a, 0)

/**
 * What to play to hear the result from `from` (a time in the original) onwards: the kept parts
 * from there. Starting outside what's kept starts at the next kept part, or the first one if
 * there's none after it.
 */
export function partsFrom(from: number, sel: Selection, mode: TrimMode, duration: number): [number, number][] {
  const parts = keptParts(sel, mode, duration)
  const at = parts.findIndex(([, b]) => from < b - 1e-6)
  if (at < 0) return parts
  const [a, b] = parts[at]
  return [[Math.max(a, from), b], ...parts.slice(at + 1)]
}

/** Where a time in the original is in the saved sound (times that are cut out land on the join). */
export function resultTime(t: number, sel: Selection, mode: TrimMode, duration: number): number {
  let out = 0
  for (const [a, b] of keptParts(sel, mode, duration)) {
    if (t <= a) return out
    if (t < b) return out + t - a
    out += b - a
  }
  return out
}

/** How loud the saved sound is at time `t` of itself, with the fades (0…1). */
export function fadeGain(t: number, length: number, fadeIn: number, fadeOut: number): number {
  let g = 1
  if (fadeIn > 0 && t < fadeIn) g = Math.min(g, Math.max(0, t / fadeIn))
  if (fadeOut > 0 && t > length - fadeOut) g = Math.min(g, Math.max(0, (length - t) / fadeOut))
  return g
}

/** Fades that fit: neither longer than the sound, and together no longer than it. */
export function fitFades(length: number, fadeIn: number, fadeOut: number): { fadeIn: number; fadeOut: number } {
  const total = fadeIn + fadeOut
  if (total <= length || total === 0) return { fadeIn, fadeOut }
  const k = length / total
  return { fadeIn: fadeIn * k, fadeOut: fadeOut * k }
}

/** The trimmed sound: each channel cut down to what's kept, with the fades put on. */
export function trimChannels(
  channels: Float32Array[],
  sampleRate: number,
  sel: Selection,
  mode: TrimMode,
  fades: { fadeIn: number; fadeOut: number } = { fadeIn: 0, fadeOut: 0 }
): Float32Array[] {
  const frames = channels[0]?.length ?? 0
  const duration = frames / sampleRate
  const parts = keptParts(sel, mode, duration).map(([a, b]) => [clamp(Math.round(a * sampleRate), 0, frames), clamp(Math.round(b * sampleRate), 0, frames)] as const)
  const length = parts.reduce((n, [a, b]) => n + b - a, 0)
  const { fadeIn, fadeOut } = fitFades(length / sampleRate, fades.fadeIn, fades.fadeOut)
  const inFrames = Math.round(fadeIn * sampleRate)
  const outFrames = Math.round(fadeOut * sampleRate)
  const join = Math.round(JOIN_FADE * sampleRate)
  return channels.map((ch) => {
    const out = new Float32Array(length)
    let at = 0
    parts.forEach(([a, b], p) => {
      out.set(ch.subarray(a, b), at)
      // Soften the join between two parts.
      if (p > 0) {
        const n = Math.min(join, b - a, at)
        for (let i = 0; i < n; i++) {
          out[at + i] *= i / n
          out[at - 1 - i] *= i / n
        }
      }
      at += b - a
    })
    for (let i = 0; i < Math.min(inFrames, length); i++) out[i] *= i / inFrames
    for (let i = 0; i < Math.min(outFrames, length); i++) out[length - 1 - i] *= i / outFrames
    return out
  })
}

/**
 * The waveform between two times, `columns` wide: the quietest and loudest point in each column
 * (both channels together). Long stretches are sampled rather than read in full, so it stays quick.
 */
export function peaks(channels: Float32Array[], sampleRate: number, from: number, to: number, columns: number): Float32Array {
  const out = new Float32Array(columns * 2)
  const frames = channels[0]?.length ?? 0
  if (!frames || columns <= 0 || to <= from) return out
  const perColumn = ((to - from) * sampleRate) / columns
  const step = Math.max(1, Math.floor(perColumn / 400))
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(from * sampleRate + c * perColumn)
    const b = Math.max(a + 1, Math.floor(from * sampleRate + (c + 1) * perColumn))
    let lo = 0
    let hi = 0
    for (const ch of channels) {
      for (let i = Math.max(0, a); i < Math.min(frames, b); i += step) {
        const v = ch[i]
        if (v < lo) lo = v
        else if (v > hi) hi = v
      }
    }
    out[c * 2] = lo
    out[c * 2 + 1] = hi
  }
  return out
}

/** 75.25 → "1:15.25"; an hour or more → "1:02:03.50". */
export function formatTime(t: number, places = 2): string {
  const safe = Math.max(0, t)
  const total = Math.round(safe * 10 ** places) / 10 ** places
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = (total % 60).toFixed(places).padStart(places ? places + 3 : 2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** What you typed in a time box ("1:15.5", "75.5", "1:02:03") in seconds, or null if it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d*)?$|^\d+:\d{1,2}(\.\d*)?$|^\d+:\d{1,2}:\d{1,2}(\.\d*)?$/.test(t)) return null
  const parts = t.split(':').map(Number)
  if (parts.slice(1).some((p) => p >= 60)) return null
  return parts.reduce((n, p) => n * 60 + p, 0)
}

/** "song.m4a" saved as MP3 → "song (trimmed).mp3". */
export function trimmedName(name: string, format: 'mp3' | 'wav'): string {
  const dot = name.lastIndexOf('.')
  const base = (dot >= 0 ? name.slice(0, dot) : name).trim() || 'Audio'
  return `${base} (trimmed).${format}`
}

/** Sound files the editor can open (anything this computer plays usually works; these are the usual ones). */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'weba', 'mp4', 'mov', 'aif', 'aiff']

export const isAudioName = (name: string): boolean => AUDIO_EXTENSIONS.includes(name.slice(name.lastIndexOf('.') + 1).toLowerCase())

/** Steps for the time ruler: the smallest of these that keeps the labels about `minGap` seconds apart. */
export function rulerStep(minGap: number): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  return steps.find((s) => s >= minGap) ?? 3600
}
