/**
 * The Studio's sound settings for voiceovers (components/Studio, lib/studio): mic presets, the mic
 * clean-up switches, the clipping warning, audio-only recordings and trimming the silences out
 * afterwards. Plain data and maths (no DOM), so it can be tested.
 */

/** How the mic is cleaned up before it's recorded. */
export interface MicSettings {
  /** 0–2 (1 = as it comes in). */
  gain: number
  /** The computer's background-noise remover (fans, hum, keyboard). */
  noiseSuppression: boolean
  /** Removes your speakers' sound coming back into the mic. Off is best with headphones. */
  echoCancellation: boolean
  /** Lets the computer turn the mic up and down by itself. Off gives steadier voiceovers. */
  autoGain: boolean
  /** Cuts low rumble (desk knocks, traffic, air con) below about 80 Hz. */
  lowCut: boolean
}

/** A saved set of mic settings, e.g. "HyperX QuadCast 2". */
export interface MicPreset extends MicSettings {
  id: string
  name: string
  /** The mic's device id ('' = the default mic). */
  micId: string
  /** Its name, to find it again if Windows or macOS gives it a new id. */
  micLabel: string
}

export const DEFAULT_MIC: MicSettings = {
  gain: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: false,
  lowCut: false
}

/** The low-cut filter's corner frequency, in Hz. */
export const LOW_CUT_HZ = 80

/** Trimming silences after a recording. */
export interface TrimSettings {
  /** Trim every audio-only recording as soon as it stops. */
  auto: boolean
  /** Pauses longer than this (seconds) get shortened... */
  longerThan: number
  /** ...down to this (seconds), so it still sounds natural. */
  keep: number
  /** Quieter than this (dB) counts as silence. */
  threshold: number
}

export const DEFAULT_TRIM: TrimSettings = {
  auto: false,
  longerThan: 0.8,
  keep: 0.35,
  threshold: -45
}

const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

export function cleanMicSettings(raw: unknown): MicSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MicSettings>
  return {
    gain: num(r.gain, DEFAULT_MIC.gain, 0, 2),
    noiseSuppression: bool(r.noiseSuppression, DEFAULT_MIC.noiseSuppression),
    echoCancellation: bool(r.echoCancellation, DEFAULT_MIC.echoCancellation),
    autoGain: bool(r.autoGain, DEFAULT_MIC.autoGain),
    lowCut: bool(r.lowCut, DEFAULT_MIC.lowCut)
  }
}

export function cleanTrim(raw: unknown): TrimSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TrimSettings>
  const longerThan = num(r.longerThan, DEFAULT_TRIM.longerThan, 0.2, 10)
  return {
    auto: bool(r.auto, DEFAULT_TRIM.auto),
    longerThan,
    keep: num(r.keep, DEFAULT_TRIM.keep, 0, longerThan),
    threshold: num(r.threshold, DEFAULT_TRIM.threshold, -80, -10)
  }
}

/** Makes saved presets safe to use: drops anything malformed and repeated ids. */
export function cleanPresets(raw: unknown): MicPreset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MicPreset[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Partial<MicPreset>
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue
    seen.add(r.id)
    out.push({
      ...cleanMicSettings(r),
      id: r.id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : 'Mic preset',
      micId: typeof r.micId === 'string' ? r.micId : '',
      micLabel: typeof r.micLabel === 'string' ? r.micLabel : ''
    })
  }
  return out
}

/** Whether the settings in use are exactly a preset's (so the picker shows it, not "Changed"). */
export function matchesPreset(p: MicPreset, micId: string, s: MicSettings): boolean {
  return (
    p.micId === micId &&
    Math.abs(p.gain - s.gain) < 0.001 &&
    p.noiseSuppression === s.noiseSuppression &&
    p.echoCancellation === s.echoCancellation &&
    p.autoGain === s.autoGain &&
    p.lowCut === s.lowCut
  )
}

/**
 * Which mic a preset means on this computer today: its saved id if that mic is plugged in,
 * otherwise one with the same name (ids can change after an update or a different USB port),
 * otherwise the default mic. `missing` says the preset's mic wasn't found.
 */
export function resolvePresetMic(p: Pick<MicPreset, 'micId' | 'micLabel'>, devices: { deviceId: string; label: string }[]): { micId: string; missing: boolean } {
  if (!p.micId) return { micId: '', missing: false }
  if (p.micId === 'off') return { micId: 'off', missing: false }
  if (devices.some((d) => d.deviceId === p.micId)) return { micId: p.micId, missing: false }
  const label = p.micLabel.trim().toLowerCase()
  const byName = label ? devices.find((d) => d.label.trim().toLowerCase() === label) : undefined
  if (byName) return { micId: byName.deviceId, missing: false }
  // No device list yet (the mic permission hasn't been given): trust the saved id.
  if (!devices.length) return { micId: p.micId, missing: false }
  return { micId: '', missing: true }
}

/**
 * The mic's own name from what the system calls it: Windows says "Microphone (2- HyperX QuadCast 2)",
 * Chromium adds USB ids like "HyperX QuadCast 2 (0951:16f9)", and the default one starts "Default - ".
 */
export function cleanMicLabel(label: string): string {
  let l = label.replace(/^(Default|Communications)\s*-\s*/i, '').trim()
  l = l.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
  const generic = /^(Microphone|Mic|Headset Microphone|Headset|Line In|Line)\s*\((.+)\)$/i.exec(l)
  if (generic) l = generic[2].replace(/^\d+\s*-\s*/, '').trim()
  return l
}

/** A name for a new preset: the mic's own name, or "Mic preset 2"… if that's taken. */
export function presetName(micLabel: string, taken: string[]): string {
  const base = cleanMicLabel(micLabel) || 'Mic preset'
  const used = new Set(taken.map((t) => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}

// ---------- level meter ----------

/** A peak this close to full scale counts as clipping (distorted). */
export const CLIP_LEVEL = 0.985

/** 0–1 linear level to dB (full scale = 0 dB). */
export const toDb = (v: number): number => (v <= 0.00001 ? -100 : 20 * Math.log10(v))

/** Where a level sits on a meter that shows −60 dB to 0 dB, 0–1. */
export const meterPosition = (v: number): number => Math.min(1, Math.max(0, (toDb(v) + 60) / 60))

/** The colour band for a level: fine, loud (getting close), or clipping. */
export function levelZone(v: number): 'quiet' | 'good' | 'loud' | 'clip' {
  if (v >= CLIP_LEVEL) return 'clip'
  const db = toDb(v)
  if (db >= -6) return 'loud'
  if (db >= -30) return 'good'
  return 'quiet'
}

/**
 * Watches the mic's peaks for clipping. `clipping` stays true for `holdMs` after the last clip, so
 * the warning doesn't flicker; `clips` counts separate clips (one long shout is one, not hundreds).
 */
export class ClipWatch {
  clips = 0
  private lastClip = -Infinity
  private inClip = false

  constructor(private readonly holdMs = 2000) {}

  /** Feeds in a peak (0–1) seen at time `now` (ms). */
  push(peak: number, now: number): void {
    if (peak >= CLIP_LEVEL) {
      if (!this.inClip) this.clips++
      this.inClip = true
      this.lastClip = now
    } else this.inClip = false
  }

  clipping(now: number): boolean {
    return now - this.lastClip < this.holdMs
  }

  reset(): void {
    this.clips = 0
    this.lastClip = -Infinity
    this.inClip = false
  }
}

// ---------- audio-only recordings ----------

/** Sound-only formats to try, best first: M4A (AAC) opens everywhere, WebM (Opus) is the fallback. */
export const AUDIO_TYPES: { mime: string; ext: 'm4a' | 'webm' }[] = [
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' }
]

export function pickAudioType(isSupported: (mime: string) => boolean): { mime: string; ext: 'm4a' | 'webm' } | null {
  return AUDIO_TYPES.find((t) => isSupported(t.mime)) ?? null
}

/** The extensions a Studio recording can have (checked again in the main process). */
export const RECORDING_EXTS = ['mp4', 'webm', 'm4a'] as const
export type RecordingExt = (typeof RECORDING_EXTS)[number]
export const isRecordingExt = (v: unknown): v is RecordingExt => typeof v === 'string' && (RECORDING_EXTS as readonly string[]).includes(v)

/** "Voiceover 2026-11-20 14-05-09 (trimmed).wav" beside the original. */
export function trimmedPath(path: string): string {
  return path.replace(/(\.[^./\\]+)?$/, ' (trimmed).wav')
}

const sec = (n: number): string => String(Math.round(n * 1000) / 1000)

/**
 * Trimming is two passes of ffmpeg, so it works the same with every ffmpeg version: first find the
 * pauses (silencedetect), then keep everything except the middle of each long pause (aselect).
 * This is the first pass: it reads the recording and writes nothing.
 */
export function detectArgs(input: string, t: TrimSettings): string[] {
  const s = cleanTrim(t)
  return ['-i', input, '-vn', '-af', `silencedetect=noise=${s.threshold}dB:d=${sec(s.longerThan)}`, '-f', 'null', '-']
}

/** The pauses silencedetect found, in seconds. A pause still going at the end runs to `length`. */
export function parseSilences(log: string, length: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let open: number | null = null
  for (const m of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Math.max(0, Number(m[2]))
    if (m[1] === 'start') open = at
    else if (open !== null) {
      out.push({ start: open, end: at })
      open = null
    }
  }
  if (open !== null && length > open) out.push({ start: open, end: length })
  return out
}

/**
 * The parts of a recording to keep: everything, except that each pause is shortened to `keep`
 * seconds (half left after the words before it, half before the words after it). A pause at the
 * very start or end is cut to `keep` too.
 */
export function keepSegments(silences: { start: number; end: number }[], length: number, keep: number): { start: number; end: number }[] {
  const segs: { start: number; end: number }[] = []
  let from = 0
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.end - s.start <= keep || s.start < from) continue
    const atStart = s.start <= 0.001
    const atEnd = s.end >= length - 0.001
    const cutFrom = atStart ? s.start : s.start + (atEnd ? keep : keep / 2)
    const cutTo = atEnd ? s.end : s.end - (atStart ? keep : keep / 2)
    if (cutTo - cutFrom <= 0.01) continue
    if (cutFrom > from) segs.push({ start: from, end: cutFrom })
    from = cutTo
  }
  if (length > from) segs.push({ start: from, end: length })
  return segs
}

/** How long the kept parts add up to, in seconds. */
export const keptLength = (segs: { start: number; end: number }[]): number => segs.reduce((n, s) => n + (s.end - s.start), 0)

/** The second pass: keeps only `segs` of the recording, joined up, saved as a WAV for editing. */
export function cutArgs(input: string, output: string, segs: { start: number; end: number }[]): string[] {
  const pick = segs.map((s) => `between(t,${sec(s.start)},${sec(s.end)})`).join('+') || '1'
  return ['-i', input, '-vn', '-af', `aselect='${pick}',asetpts=N/SR/TB`, '-c:a', 'pcm_s16le', output]
}

/** "Took out 1:12 of silence (8:40 → 7:28)". Lengths in seconds. */
export function trimSummary(before: number, after: number): string {
  const f = (s: number): string => {
    const t = Math.max(0, Math.round(s))
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  const cut = Math.max(0, before - after)
  if (cut < 0.5) return 'There weren’t any long pauses to take out.'
  return `Took out ${f(cut)} of silence (${f(before)} → ${f(after)}).`
}
