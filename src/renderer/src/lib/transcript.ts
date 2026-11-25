import { parseFrontmatter } from './tags'
import { findMarkers, type Marker } from './script'
import type { SpokenWord } from '@shared/transcribe'

/**
 * Auto transcripts, lined up with the script. A transcript is what Whisper heard in a recording,
 * word by word with times (main/transcriber.ts makes it). Lining it up with the script finds each
 * script word in it, so every line and every marker of the script gets the time it was said at,
 * words that were skipped show as skipped, and anything said that isn't in the script shows too.
 *
 * Saved in the notes folder as .notesapp/transcript-<recording item id>.json, so it follows your
 * notes to other computers like the video projects do.
 */

export interface Transcript {
  /** The recording it's of (a path in the notes folder) when it was made. */
  recording: string
  made: number
  model: string
  /** How long the recording is, in seconds. */
  length: number
  /** The recording file's time and size when it was made, so a changed recording can be noticed. */
  fileTime: number
  fileSize: number
  words: SpokenWord[]
  /** Anything else (from a newer Orbit), kept as it was. */
  [more: string]: unknown
}

export const transcriptFile = (itemId: string): string | null => (/^[a-z0-9]{1,40}$/.test(itemId) ? `transcript-${itemId}.json` : null)

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Reads a transcript file (null if it's missing or broken). Words are stored as [text, start, end]. */
export function readTranscript(text: string | null): Transcript | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const { version: _version, ...r } = raw as Record<string, unknown>
  if (!Array.isArray(r.words)) return null
  const words: SpokenWord[] = []
  for (const w of r.words) {
    if (!Array.isArray(w) || typeof w[0] !== 'string' || !w[0]) continue
    const s = num(w[1])
    words.push({ w: w[0].slice(0, 100), s, e: Math.max(s, num(w[2])) })
  }
  return {
    ...r,
    recording: typeof r.recording === 'string' ? r.recording : '',
    made: num(r.made),
    model: typeof r.model === 'string' ? r.model : '',
    length: num(r.length),
    fileTime: num(r.fileTime),
    fileSize: num(r.fileSize),
    words
  }
}

export const transcriptJson = (t: Transcript): string =>
  JSON.stringify({
    ...t,
    version: 1,
    words: t.words.map((w) => [w.w, w.s, w.e])
  })

// ---------- Words of the script ----------

/** A word that's read out of the script, and where it is in the note. */
export interface ScriptWord {
  /** The word as it's compared ("don't" → "dont"). */
  key: string
  from: number
  to: number
}

/** A word made comparable: lower case, no apostrophes, hyphens or punctuation. */
export const wordKey = (w: string): string =>
  w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')

const blank = (s: string): string => s.replace(/[^\n]/g, ' ')

/**
 * The script with everything that isn't read out turned into spaces (so every word keeps its place
 * in the note). The same rules as spokenText in lib/script.ts.
 */
export function spokenMask(text: string): string {
  const fm = parseFrontmatter(text).end
  const body = text.slice(fm)
  const masked = body
    .replace(/<!--[\s\S]*?(-->|$)/g, blank)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/^\$\$[\s\S]*?\$\$/gm, blank)
    .replace(/^#{1,6}\s.*$/gm, blank)
    .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, blank)
    // Markers: only an emphasis marker's words are read out.
    .replace(/\[(IMAGE|CLIP|PAUSE|EMPHASIS|SECTION|SOURCE|NOTE)(?::[ \t]*((?:[^[\]\n]|\[\[[^[\]\n]*\]\])*?))?[ \t]*\](?!\()/g, (m, type: string, value?: string) => {
      if (type !== 'EMPHASIS' || !value) return blank(m)
      const at = m.indexOf(value)
      return blank(m.slice(0, at)) + value + blank(m.slice(at + value.length))
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/!\[\[[^\]]*\]\]/g, blank)
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (m, target: string, alias: string) => {
      const shown = alias || target.replace(/#.*$/, '')
      const at = m.indexOf(shown, alias ? m.indexOf('|') : 0)
      return blank(m.slice(0, at)) + shown + blank(m.slice(at + shown.length))
    })
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (m, shown: string) => ' ' + shown + blank(m.slice(shown.length + 1)))
    .replace(/https?:\/\/\S+/g, blank)
  return blank(text.slice(0, fm)) + masked
}

/** Every word that's read out of a script, in order. */
export function scriptWords(text: string): ScriptWord[] {
  const masked = spokenMask(text)
  const out: ScriptWord[] = []
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
  for (let m; (m = re.exec(masked)); ) {
    const key = wordKey(m[0])
    if (key) out.push({ key, from: m.index, to: m.index + m[0].length })
  }
  return out
}

// ---------- Lining up ----------

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  first: '1st',
  second: '2nd',
  third: '3rd'
}
const asNumber = (k: string): string => NUMBER_WORDS[k] ?? k

/** Edit distance, stopping early once it's over `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How alike two words are: 2 the same, 1 close (a name spelt differently, "Rick" and "Rick's"), 0 not. */
export function likeness(a: string, b: string): number {
  if (a === b || asNumber(a) === asNumber(b)) return 2
  if (a.length < 3 || b.length < 3) return 0
  // "ask" and "asked", "Rick" and "Ricks"
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (long.startsWith(short) && long.length - short.length <= 2) return 1
  const max = Math.min(a.length, b.length) >= 6 ? 2 : 1
  return distance(a, b, max) <= max ? 1 : 0
}

const MATCH = 3
const CLOSE = 2
const MISS = -1
const GAP = -1

/**
 * Lines up script words `s[s0..s1)` with heard words `h[h0..h1)` (Needleman–Wunsch), writing what
 * matched into `out`. `freeStart`/`freeEnd`: script words before (after) everything heard cost
 * nothing, for a recording of only part of the script.
 */
function lineUpPart(s: string[], h: string[], s0: number, s1: number, h0: number, h1: number, out: Int32Array, freeStart: boolean, freeEnd: boolean): void {
  const n = s1 - s0
  const m = h1 - h0
  if (!n || !m) return
  const W = m + 1
  const score = new Int32Array((n + 1) * W)
  // 0 diagonal, 1 skip a script word, 2 skip a heard word
  const move = new Uint8Array((n + 1) * W)
  for (let i = 1; i <= n; i++) {
    score[i * W] = freeStart ? 0 : i * GAP
    move[i * W] = 1
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP
    move[j] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const like = likeness(s[s0 + i - 1], h[h0 + j - 1])
      const diag = score[(i - 1) * W + j - 1] + (like === 2 ? MATCH : like === 1 ? CLOSE : MISS)
      const up = score[(i - 1) * W + j] + (freeEnd && j === m ? 0 : GAP)
      const left = score[i * W + j - 1] + GAP
      const best = Math.max(diag, up, left)
      score[i * W + j] = best
      move[i * W + j] = best === diag ? 0 : best === up ? 1 : 2
    }
  }
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const d = move[i * W + j]
    if (d === 0) {
      if (likeness(s[s0 + i - 1], h[h0 + j - 1])) out[s0 + i - 1] = h0 + j - 1
      i--
      j--
    } else if (d === 1) i--
    else j--
  }
}

/** The biggest part lined up in one go (script words × heard words); bigger ones are cut down. */
const MAX_CELLS = 6_000_000

/**
 * Which heard word each script word is (-1 for a word that wasn't said). Works for a recording of
 * the whole script or of only part of it (one section, a retake), and with words added or skipped.
 *
 * It first finds runs of three words that appear once in each (anchors), keeps the longest chain
 * of them that's in the same order in both, then lines up the bits between anchors word by word.
 */
export function alignWords(script: string[], heard: string[]): Int32Array {
  const out = new Int32Array(script.length).fill(-1)
  if (!script.length || !heard.length) return out
  const tri = (list: string[], i: number): string => `${list[i]} ${list[i + 1]} ${list[i + 2]}`
  const once = (list: string[]): Map<string, number> => {
    const seen = new Map<string, number>()
    for (let i = 0; i + 2 < list.length; i++) {
      const k = tri(list, i)
      seen.set(k, seen.has(k) ? -1 : i)
    }
    return seen
  }
  const inScript = once(script)
  const inHeard = once(heard)
  const pairs: [number, number][] = []
  for (const [k, i] of inScript) {
    const j = inHeard.get(k)
    if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j])
  }
  pairs.sort((a, b) => a[0] - b[0])
  // Longest chain that goes forward in both (patience sorting).
  const tails: number[] = []
  const back = new Int32Array(pairs.length).fill(-1)
  for (let p = 0; p < pairs.length; p++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < pairs[p][1]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) back[p] = tails[lo - 1]
    tails[lo] = p
  }
  const chain: [number, number][] = []
  for (let p = tails.length ? tails[tails.length - 1] : -1; p >= 0; p = back[p]) chain.unshift(pairs[p])
  // Anchored runs of three can overlap: keep ones that start after the last one ended.
  const anchors: [number, number][] = []
  for (const [i, j] of chain) {
    const last = anchors[anchors.length - 1]
    if (!last || (i >= last[0] + 3 && j >= last[1] + 3)) anchors.push([i, j])
  }

  const part = (s0: number, s1: number, h0: number, h1: number, freeStart: boolean, freeEnd: boolean): void => {
    // A recording of part of the script: only the script near what was heard is looked at.
    if ((s1 - s0) * (h1 - h0) > MAX_CELLS) {
      const room = Math.max(20, Math.floor(MAX_CELLS / Math.max(1, h1 - h0)))
      if (freeStart && !freeEnd) s0 = Math.max(s0, s1 - room)
      else if (freeEnd && !freeStart) s1 = Math.min(s1, s0 + room)
      else if ((s1 - s0) * (h1 - h0) > MAX_CELLS * 4) return
    }
    lineUpPart(script, heard, s0, s1, h0, h1, out, freeStart, freeEnd)
  }

  if (!anchors.length) {
    part(0, script.length, 0, heard.length, true, true)
    return out
  }
  part(0, anchors[0][0], 0, anchors[0][1], true, false)
  anchors.forEach(([i, j], k) => {
    for (let d = 0; d < 3; d++) out[i + d] = j + d
    const next = anchors[k + 1]
    if (next) part(i + 3, next[0], j + 3, next[1], false, false)
  })
  const [li, lj] = anchors[anchors.length - 1]
  part(li + 3, script.length, lj + 3, heard.length, false, true)
  return out
}

// ---------- What the view shows ----------

export interface LinedUp {
  words: ScriptWord[]
  /** For each script word, the heard word it is (-1: not said). */
  match: Int32Array
  /** For each script word, when it was said (or about when, between the words around it); null if it can't be told. */
  times: (number | null)[]
  markers: { marker: Marker; time: number | null }[]
  /** Heard words that aren't in the script, after the script word they follow (-1: before the first). */
  extras: Map<number, SpokenWord[]>
  /** How much of the script was found in the recording (0–1). */
  found: number
  /** The first and last script words said (null if none). */
  first: number | null
  last: number | null
}

/** Lines a transcript up with a script. */
export function lineUp(text: string, heard: SpokenWord[]): LinedUp {
  const words = scriptWords(text)
  const match = alignWords(
    words.map((w) => w.key),
    heard.map((h) => wordKey(h.w))
  )
  // Times: matched words have their own; the ones between get spread out between those.
  const times: (number | null)[] = new Array(words.length).fill(null)
  let first: number | null = null
  let last: number | null = null
  let found = 0
  for (let i = 0; i < words.length; i++)
    if (match[i] >= 0) {
      times[i] = heard[match[i]].s
      first ??= i
      last = i
      found++
    }
  if (first !== null && last !== null) {
    for (let i = first; i <= last; i++) {
      if (times[i] !== null) continue
      let j = i
      while (times[j] === null) j++
      const from = heard[match[i - 1]].e
      const to = times[j]!
      for (let k = i; k < j; k++) times[k] = Math.round((from + ((to - from) * (k - i + 1)) / (j - i + 1)) * 100) / 100
      i = j
    }
  }
  // Markers: at the next word said after them, or (at the end) when the last word before them ended.
  const markers = findMarkers(text, 0)
    .filter((m) => m.from >= parseFrontmatter(text).end)
    .map((marker) => {
      let i = words.findIndex((w) => w.from >= marker.to)
      if (marker.type === 'EMPHASIS') i = words.findIndex((w) => w.from >= marker.from)
      if (i >= 0 && first !== null && i < first) return { marker, time: null }
      let time: number | null = i >= 0 && times[i] !== null ? times[i] : null
      if (time === null && last !== null && (i < 0 || i > last)) time = heard[match[last]].e
      return { marker, time }
    })
  // Heard words that aren't in the script.
  const used = new Set<number>()
  for (const j of match) if (j >= 0) used.add(j)
  const extras = new Map<number, SpokenWord[]>()
  let after = -1
  const byHeard = new Int32Array(heard.length).fill(-1)
  for (let i = 0; i < match.length; i++) if (match[i] >= 0) byHeard[match[i]] = i
  for (let j = 0; j < heard.length; j++) {
    if (byHeard[j] >= 0) {
      after = byHeard[j]
      continue
    }
    const list = extras.get(after) ?? []
    list.push(heard[j])
    extras.set(after, list)
  }
  return {
    words,
    match,
    times,
    markers,
    extras,
    found: words.length ? found / words.length : 0,
    first,
    last
  }
}

/** What was said, as sentences with their start time (for reading the transcript on its own). */
export function sentences(heard: SpokenWord[]): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  let cur: SpokenWord[] = []
  const flush = (): void => {
    if (cur.length)
      out.push({
        start: cur[0].s,
        end: cur[cur.length - 1].e,
        text: cur.map((w) => w.w).join(' ')
      })
    cur = []
  }
  heard.forEach((w, i) => {
    const prev = heard[i - 1]
    if (cur.length && prev && w.s - prev.e > 1.5) flush()
    cur.push(w)
    if (/[.?!]["”’)]*$/.test(w.w) || cur.length >= 40) flush()
  })
  flush()
  return out
}
