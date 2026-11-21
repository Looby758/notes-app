import { findMarkers, type Marker } from './script'
import { parseFrontmatter } from './tags'
import type { LinedUp } from './transcript'
import type { Cue } from './teleprompter'
import { clock } from '@shared/transcribe'

/**
 * The shot list: what goes on screen when, for one recording. Every picture ([IMAGE: …]) and clip
 * note ([CLIP: …]) in the script gets a time, from
 *  - the transcript (when the words right after the marker were said), or
 *  - the teleprompter (when the marker reached the reading line while recording; the
 *    "<recording>.cues.json" the Studio saves beside the recording), or
 *  - you (a time you set or nudged, which always wins).
 * Sections ([SECTION: …]) are kept too, as headings and chapter points.
 *
 * Times you set are saved in the notes folder (.notesapp/shots-<recording item id>.json) keyed by
 * the marker's text and which one of that text it is, so they survive edits elsewhere in the script.
 */

export type ShotKind = 'IMAGE' | 'CLIP' | 'SECTION'
export type TimeSource = 'transcript' | 'teleprompter' | 'you'

export interface Shot {
  /** Stable across script edits: "IMAGE:rick.png#1" (the first marker with that text). */
  key: string
  kind: ShotKind
  value: string
  /** Where the marker is in the script. */
  from: number
  /** Seconds into the recording, or null if it can't be told (not in this recording). */
  time: number | null
  source: TimeSource | null
  /** How long it's on screen: until the next picture or clip (or the end), in seconds. */
  length: number | null
}

/** Which source to prefer when both have a time. */
export type Prefer = 'transcript' | 'teleprompter'

const SHOT_TYPES = new Set(['IMAGE', 'CLIP', 'SECTION'])

/** Each picture, clip and section marker in a script, with its stable key. */
export function shotMarkers(text: string): (Marker & { key: string })[] {
  const start = parseFrontmatter(text).end
  const seen = new Map<string, number>()
  return findMarkers(text.slice(start), start)
    .filter((m) => SHOT_TYPES.has(m.type))
    .map((m) => {
      const base = `${m.type}:${m.value.toLowerCase()}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { ...m, key: `${base}#${n}` }
    })
}

/**
 * The teleprompter's time for each marker in the script now: the cue with the same marker text,
 * the one written nearest the same place if there are several (the script may have changed since).
 */
export function cueTimes(text: string, markers: Marker[], cues: readonly Cue[]): Map<number, number> {
  const out = new Map<number, number>()
  const byText = new Map<string, Cue[]>()
  for (const c of cues) {
    const k = c.marker.replace(/\s+/g, ' ').trim().toLowerCase()
    byText.set(k, [...(byText.get(k) ?? []), c])
  }
  const used = new Set<Cue>()
  for (const m of markers) {
    const list = (byText.get(text.slice(m.from, m.to).replace(/\s+/g, ' ').trim().toLowerCase()) ?? []).filter((c) => !used.has(c))
    if (!list.length) continue
    const best = list.reduce((a, b) => (Math.abs(b.at - m.from) < Math.abs(a.at - m.from) ? b : a))
    used.add(best)
    out.set(m.from, best.t)
  }
  return out
}

/** Reads a .cues.json file (null if it's missing or broken). */
export function readCues(text: string | null): Cue[] | null {
  if (!text) return null
  try {
    const raw = JSON.parse(text) as { cues?: unknown }
    if (!Array.isArray(raw.cues)) return null
    return raw.cues
      .filter(
        (c): c is Cue => !!c && typeof c === 'object' && typeof (c as Cue).at === 'number' && typeof (c as Cue).marker === 'string' && typeof (c as Cue).t === 'number' && Number.isFinite((c as Cue).t)
      )
      .map((c) => ({ at: c.at, marker: c.marker, t: Math.max(0, c.t) }))
  } catch {
    return null
  }
}

/** Builds the shot list. `length` is how long the recording is. */
export function buildShots(text: string, opts: { lined?: LinedUp | null; cues?: readonly Cue[] | null; overrides?: Record<string, number>; prefer?: Prefer; length?: number }): Shot[] {
  const markers = shotMarkers(text)
  const fromTranscript = new Map<number, number | null>()
  for (const m of opts.lined?.markers ?? []) fromTranscript.set(m.marker.from, m.time)
  const fromCues = opts.cues?.length ? cueTimes(text, markers, opts.cues) : new Map<number, number>()
  const prefer = opts.prefer ?? 'transcript'
  const shots: Shot[] = markers.map((m) => {
    const own = opts.overrides?.[m.key]
    const t = fromTranscript.get(m.from) ?? null
    const c = fromCues.get(m.from) ?? null
    let time: number | null = null
    let source: TimeSource | null = null
    if (typeof own === 'number') [time, source] = [own, 'you']
    else if (prefer === 'teleprompter' && c !== null) [time, source] = [c, 'teleprompter']
    else if (t !== null) [time, source] = [t, 'transcript']
    else if (c !== null) [time, source] = [c, 'teleprompter']
    return { key: m.key, kind: m.type as ShotKind, value: m.value, from: m.from, time, source, length: null }
  })
  // How long each picture or clip stays up: until the next one starts.
  const timed = shots.filter((s) => s.kind !== 'SECTION' && s.time !== null).sort((a, b) => a.time! - b.time!)
  timed.forEach((s, i) => {
    const next = timed[i + 1]?.time ?? opts.length ?? null
    s.length = next !== null ? Math.max(0, Math.round((next - s.time!) * 100) / 100) : null
  })
  return shots
}

/** The shot list as plain text, e.g. "02:14 – rick-s1-hospital.png", with sections as headings. */
export function shotListText(shots: readonly Shot[], title = ''): string {
  const lines: string[] = title ? [title, ''] : []
  for (const s of shots) {
    const at = s.time === null ? '--:--' : clock(s.time)
    if (s.kind === 'SECTION') lines.push('', `${at}  ${s.value || 'Section'}`.trimEnd())
    else lines.push(`${at} – ${s.kind === 'CLIP' ? 'Clip: ' : ''}${s.value}`)
  }
  return (
    lines
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n') + '\n'
  )
}

// ---------- times you set ----------

export interface ShotOverrides {
  /** By shot key: the time you set, in seconds. */
  times: Record<string, number>
  /** Which source to use when both have a time. */
  prefer?: Prefer
}

export const shotsFile = (itemId: string): string | null => (/^[a-z0-9]{1,40}$/.test(itemId) ? `shots-${itemId}.json` : null)

export function readShotOverrides(text: string | null): ShotOverrides {
  const out: ShotOverrides = { times: {} }
  if (!text) return out
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (raw.times && typeof raw.times === 'object') {
      for (const [k, v] of Object.entries(raw.times as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out.times[k.slice(0, 600)] = v
    }
    if (raw.prefer === 'transcript' || raw.prefer === 'teleprompter') out.prefer = raw.prefer
  } catch {
    // broken: start again
  }
  return out
}

export const shotOverridesJson = (o: ShotOverrides): string => JSON.stringify({ version: 1, ...o })

/** "1:05.4": a time to a tenth of a second, for fixing a shot's time. */
export const fineClock = (seconds: number): string => {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  return `${clock(Math.floor(tenths / 10))}.${tenths % 10}`
}

/** "1:05", "65", "1:02:03.5" → seconds (null if it isn't a time). */
export function parseClock(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null
  const parts = t.split(':').map(Number)
  const secs = parts.reduce((sum, p) => sum * 60 + p, 0)
  return Number.isFinite(secs) ? secs : null
}
