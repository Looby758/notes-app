/**
 * How your own music sounds: crossfading from one song into the next, the equaliser, and which
 * visualiser shows. These are kept in Settings (prefs), so they follow you to your other computer
 * with the rest of your settings. The sound itself is made in renderer/src/store/localMusic.ts.
 */

/** The equaliser's bands, in Hz: low notes first. */
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

/** How far a band (or the preamp) can go up or down, in dB. */
export const EQ_LIMIT = 12

export interface MusicEq {
  on: boolean
  /** A preset's id, or 'custom' once you've moved a band yourself. */
  preset: string
  /** One gain per band in EQ_BANDS, in dB. */
  bands: number[]
  /** Turns everything down (or up) to make room for the boosts, in dB. */
  preamp: number
}

export interface EqPreset {
  id: string
  label: string
  bands: number[]
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', label: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass boost', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'treble', label: 'Treble boost', bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: 'vocal', label: 'Vocals', bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'rock', label: 'Rock', bands: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4] },
  { id: 'pop', label: 'Pop', bands: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  { id: 'dance', label: 'Dance', bands: [6, 5, 2, 0, -1, 1, 2, 3, 4, 4] },
  { id: 'hiphop', label: 'Hip-hop', bands: [5, 5, 2, 3, -1, -1, 1, 0, 2, 3] },
  { id: 'classical', label: 'Classical', bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: 'acoustic', label: 'Acoustic', bands: [4, 4, 3, 1, 2, 2, 3, 3, 2, 1] },
  { id: 'night', label: 'Quiet listening', bands: [5, 4, 2, 0, -1, 0, 1, 2, 3, 3] },
  { id: 'speakers', label: 'Laptop speakers', bands: [-6, -4, -1, 2, 3, 3, 2, 1, 0, 0] }
]

const clampDb = (v: number): number => Math.round(Math.min(EQ_LIMIT, Math.max(-EQ_LIMIT, v)) * 10) / 10

/** Enough headroom that the biggest boost doesn't make the loud parts crackle. */
export const presetPreamp = (bands: number[]): number => clampDb(-Math.max(0, ...bands) * 0.6) || 0

export const DEFAULT_EQ: MusicEq = { on: false, preset: 'flat', bands: [...EQ_PRESETS[0].bands], preamp: 0 }

/** The equaliser set to a preset (and turned on). */
export function eqFromPreset(id: string): MusicEq {
  const p = EQ_PRESETS.find((x) => x.id === id) ?? EQ_PRESETS[0]
  return { on: true, preset: p.id, bands: [...p.bands], preamp: presetPreamp(p.bands) }
}

/** One band moved by hand: the preset becomes "Custom". */
export function eqWithBand(eq: MusicEq, band: number, db: number): MusicEq {
  if (band < 0 || band >= EQ_BANDS.length) return eq
  const bands = [...eq.bands]
  bands[band] = clampDb(db)
  return { ...eq, on: true, bands, preset: 'custom' }
}

/** Anything (a hand-edited settings file, an older version) as a valid equaliser. */
export function cleanEq(raw: unknown): MusicEq {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EQ, bands: [...DEFAULT_EQ.bands] }
  const r = raw as Record<string, unknown>
  const bands = EQ_BANDS.map((_, i) => {
    const v = Array.isArray(r.bands) ? r.bands[i] : 0
    return typeof v === 'number' && Number.isFinite(v) ? clampDb(v) : 0
  })
  const preset = typeof r.preset === 'string' && (r.preset === 'custom' || EQ_PRESETS.some((p) => p.id === r.preset)) ? r.preset : 'custom'
  const preamp = typeof r.preamp === 'number' && Number.isFinite(r.preamp) ? clampDb(r.preamp) : 0
  return { on: r.on === true, preset, bands, preamp }
}

/** The gains actually used: all flat while the equaliser is off. */
export function activeGains(eq: MusicEq): { bands: number[]; preamp: number } {
  return eq.on ? { bands: eq.bands, preamp: eq.preamp } : { bands: EQ_BANDS.map(() => 0), preamp: 0 }
}

/** "1 kHz", "250 Hz" */
export const bandLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz))

// ---------- Crossfade ----------

/** Longest crossfade, in seconds (0 is off). */
export const CROSSFADE_MAX = 12

/**
 * How long the fade into the next song is, in seconds: never more than a third of either song, so
 * a short song isn't all fade.
 */
export function fadeLength(crossfade: number, thisSong: number, nextSong: number): number {
  if (!(crossfade > 0)) return 0
  const limit = Math.min(thisSong > 0 ? thisSong / 3 : crossfade, nextSong > 0 ? nextSong / 3 : crossfade)
  return Math.max(0, Math.min(crossfade, CROSSFADE_MAX, limit))
}

/** Whether it's time to start fading into the next song. */
export function shouldCrossfade(o: { fade: number; position: number; duration: number; repeatOne: boolean; hasNext: boolean }): boolean {
  if (o.fade < 0.5 || o.repeatOne || !o.hasNext || !(o.duration > 0)) return false
  return o.duration - o.position <= o.fade
}

/**
 * An equal-power fade (so the sound doesn't dip in the middle): `n` gains from silent to full for
 * the song coming in, or from full to silent for the one going out.
 */
export function fadeCurve(n: number, direction: 'in' | 'out'): Float32Array {
  const out = new Float32Array(Math.max(2, n))
  for (let i = 0; i < out.length; i++) {
    const t = i / (out.length - 1)
    out[i] = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2)
  }
  return out
}

// ---------- Visualisers ----------

export const VISUALISER_STYLES = [
  { id: 'bars', label: 'Bars' },
  { id: 'wave', label: 'Wave' },
  { id: 'mountain', label: 'Mountains' },
  { id: 'circle', label: 'Circle' },
  { id: 'dots', label: 'Lights' }
] as const

export type VisualiserStyle = (typeof VISUALISER_STYLES)[number]['id']

export const nextVisualiser = (style: VisualiserStyle): VisualiserStyle => {
  const i = VISUALISER_STYLES.findIndex((s) => s.id === style)
  return VISUALISER_STYLES[(i + 1) % VISUALISER_STYLES.length].id
}
