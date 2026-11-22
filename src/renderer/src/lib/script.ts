import { parseFrontmatter } from './tags'

/**
 * Video scripts: markers for what happens alongside the words (an image on screen, a pause, a new
 * section) and how long the script will take to read out.
 *
 * Markers are plain text in square brackets, so a script still reads fine anywhere else:
 *
 *   [IMAGE: rick-s1-hospital.png]   a picture to show here (a file in your attachments)
 *   [CLIP: Rick wakes up]           a bit of footage to cut to
 *   [PAUSE] or [PAUSE: 2s]          a breath (1 second unless you say)
 *   [EMPHASIS: never]               words to lean on (they're still read out)
 *   [SECTION: The prison]           starts a new part of the video
 *   [SOURCE: [[Research note]]]     where a fact comes from (a note, an episode, a link)
 *   [NOTE: check this date]         a note to yourself; not read out
 *
 * The keyword is always in capitals, which keeps ordinary writing in brackets from being taken for one.
 */

export const MARKER_TYPES = ['IMAGE', 'CLIP', 'PAUSE', 'EMPHASIS', 'SECTION', 'SOURCE', 'NOTE'] as const
export type MarkerType = (typeof MARKER_TYPES)[number]

export const MARKER_INFO: Record<MarkerType, { label: string; icon: string; hint: string }> = {
  IMAGE: { label: 'Image', icon: '🖼', hint: 'A picture to show here' },
  CLIP: { label: 'Clip note', icon: '🎬', hint: 'Footage to cut to' },
  PAUSE: { label: 'Pause', icon: '⏸️', hint: 'A breath before going on' },
  EMPHASIS: { label: 'Emphasis', icon: '❗', hint: 'Words to lean on' },
  SECTION: { label: 'Section', icon: '§', hint: 'A new part of the video' },
  SOURCE: { label: 'Source', icon: '📚', hint: 'Where this comes from' },
  NOTE: { label: 'Note to self', icon: '✎', hint: 'Only for you; not read out' }
}

export interface Marker {
  type: MarkerType
  /** What's after the colon, trimmed ('' for a bare [PAUSE]). */
  value: string
  from: number
  to: number
}

/**
 * [TYPE] or [TYPE: value]. The value can hold [[wiki links]] but no other brackets, and a marker
 * followed by "(" is a markdown link's text, not a marker.
 */
const MARKER_RE = /\[(IMAGE|CLIP|PAUSE|EMPHASIS|SECTION|SOURCE|NOTE)(?::[ \t]*((?:[^[\]\n]|\[\[[^[\]\n]*\]\])*?))?[ \t]*\](?!\()/g

export function findMarkers(text: string, offset = 0): Marker[] {
  const out: Marker[] = []
  MARKER_RE.lastIndex = 0
  for (let m; (m = MARKER_RE.exec(text)); ) {
    out.push({ type: m[1] as MarkerType, value: (m[2] ?? '').trim(), from: offset + m.index, to: offset + m.index + m[0].length })
  }
  return out
}

/** The text of a marker, e.g. markerText('IMAGE', 'a.png') → "[IMAGE: a.png]". */
export function markerText(type: MarkerType, value = ''): string {
  const clean = value.replace(/[[\]\n]/g, (c) => (c === '\n' ? ' ' : '')).trim()
  return clean ? `[${type}: ${clean}]` : `[${type}]`
}

/** How long a pause marker lasts: "2s", "2", "1.5 sec", "500ms"; 1 second if it doesn't say. */
export function pauseSeconds(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)?$/i.exec(value.trim())
  if (!m) return 1
  const n = parseFloat(m[1])
  const secs = m[2]?.toLowerCase() === 'ms' ? n / 1000 : n
  return Math.min(60, Math.max(0, secs))
}

/** A note is a script if it's called "Script…" (Script.md, Script 2.md) or its properties say `type: script`. */
export function isScriptNote(path: string | null | undefined, text = ''): boolean {
  if (!path || !/\.md$/i.test(path)) return false
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (/^script\b/i.test(name)) return true
  const fm = parseFrontmatter(text.slice(0, 4000))
  return fm.end > 0 && /^type\s*:\s*["']?script["']?\s*$/im.test(text.slice(0, fm.end))
}

/** The words that get read out of some script text (markers, markdown and notes to self taken out). */
export function spokenText(text: string): string {
  return (
    text
      .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
      // Code blocks and maths blocks aren't read out.
      .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, ' ')
      .replace(/^\$\$[\s\S]*?\$\$/gm, ' ')
      // Headings are for you to find your way; the section markers split the video.
      .replace(/^#{1,6}\s.*$/gm, ' ')
      .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, ' ')
      .replace(MARKER_RE, (_m, type: string, value?: string) => (type === 'EMPHASIS' ? ` ${value ?? ''} ` : ' '))
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, target: string, alias: string) => ` ${alias || target.replace(/#.*$/, '')} `)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
      .replace(/https?:\/\/\S+/g, ' ')
  )
}

/** Words in some text: anything with a letter or a number in it ("don't", "S4E9" and "2010" are one word each). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export interface ScriptSection {
  /** From the [SECTION: …] marker; '' for the part before the first one. */
  title: string
  /** Where it starts in the note (its marker, or the top). */
  from: number
  words: number
  pauses: number
  /** Pause time, in seconds. */
  pauseSeconds: number
  seconds: number
  images: number
}

export interface ScriptStats {
  words: number
  seconds: number
  pauses: number
  images: number
  sections: ScriptSection[]
}

export const DEFAULT_WPM = 150
export const MIN_WPM = 80
export const MAX_WPM = 250

/** Words, length and the parts of a script, at `wpm` words a minute. */
export function scriptStats(text: string, wpm = DEFAULT_WPM): ScriptStats {
  const pace = Math.min(MAX_WPM, Math.max(MIN_WPM, wpm || DEFAULT_WPM))
  const start = parseFrontmatter(text).end
  const body = text.slice(start)
  const markers = findMarkers(body, start)
  // Split at section markers.
  const cuts = markers.filter((m) => m.type === 'SECTION')
  const parts: { title: string; from: number; to: number }[] = []
  parts.push({ title: '', from: start, to: cuts[0]?.from ?? text.length })
  cuts.forEach((c, i) => parts.push({ title: c.value || `Section ${i + 1}`, from: c.from, to: cuts[i + 1]?.from ?? text.length }))

  const sections: ScriptSection[] = parts.map((p) => {
    const inside = markers.filter((m) => m.from >= p.from && m.from < p.to)
    const pauses = inside.filter((m) => m.type === 'PAUSE')
    const pauseSecs = pauses.reduce((sum, m) => sum + pauseSeconds(m.value), 0)
    const words = countWords(spokenText(text.slice(p.from, p.to)))
    return {
      title: p.title,
      from: p.from,
      words,
      pauses: pauses.length,
      pauseSeconds: pauseSecs,
      seconds: (words / pace) * 60 + pauseSecs,
      images: inside.filter((m) => m.type === 'IMAGE').length
    }
  })
  // Nothing before the first section: leave that part out.
  const shown = sections.filter((s, i) => i > 0 || s.words > 0 || s.pauses > 0 || s.images > 0 || cuts.length === 0)
  return {
    words: sections.reduce((n, s) => n + s.words, 0),
    seconds: sections.reduce((n, s) => n + s.seconds, 0),
    pauses: sections.reduce((n, s) => n + s.pauses, 0),
    images: sections.reduce((n, s) => n + s.images, 0),
    sections: shown
  }
}

/** "8:16", "1:02:05" (rounded to the second). */
export function formatLength(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The file an image marker names: a path in your notes, or a file name looked up among your pictures. */
export function resolveImage(value: string, images: readonly string[], attachmentFolder = ''): string | null {
  const v = value.trim().replace(/^\.?\//, '')
  if (!v) return null
  const lower = v.toLowerCase()
  const exact = images.find((p) => p.toLowerCase() === lower)
  if (exact) return exact
  if (v.includes('/')) return null
  const named = images.filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === lower)
  if (named.length <= 1) return named[0] ?? null
  // Same name in two places: the attachments folder wins.
  const folder = attachmentFolder.toLowerCase()
  const inFolder = (p: string): boolean => (folder ? p.toLowerCase().startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/') : !p.includes('/'))
  return named.find(inFolder) ?? named[0]
}

/** What an image marker should say for a file: just its name when that's enough to find it again. */
export function imageMarkerValue(path: string, images: readonly string[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const same = images.filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === name.toLowerCase())
  return same.length > 1 ? path : name
}

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i
