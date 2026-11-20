import { parseFrontmatter } from './tags'
import { findMarkers, markerText, pauseSeconds, spokenText, countWords, type MarkerType } from './script'

/**
 * The Studio's teleprompter (components/Studio/Teleprompter): turns a script note into what scrolls
 * past the reading line, works out how fast to scroll for a speaking pace, and remembers when each
 * marker reached the line while recording (the ".cues.json" saved beside the recording, which the
 * shot list reads). Plain functions, so they can be tested.
 */

/** A bit of a line: words to read, or a marker shown as a small coloured icon. */
export type PrompterPart = { kind: 'text'; text: string } | { kind: 'marker'; type: MarkerType; value: string; from: number; text: string }

export type PrompterBlock =
  | { kind: 'section'; title: string; from: number; text: string }
  | { kind: 'heading'; text: string; from: number }
  | { kind: 'para'; parts: PrompterPart[]; from: number }

/** Markdown that shouldn't show on the prompter: **bold**, _italics_, `code`, links (their words stay). */
export function plainInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, target: string, alias: string) => alias || target.replace(/#.*$/, ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/==(.+?)==/g, '$1')
}

/**
 * The script, ready for the prompter. Notes to self, comments and code blocks are left out; a
 * Section marker becomes a heading of its own; everything else stays where it is in the line.
 * Every marker keeps `from`, its place in the note's text, so the cue times line up with the script.
 */
export function prompterBlocks(text: string): PrompterBlock[] {
  const start = parseFrontmatter(text).end
  const blocks: PrompterBlock[] = []
  // Blank out what's never read, keeping every other character where it is.
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  const body = text
    .slice(start)
    .replace(/<!--[\s\S]*?(-->|$)/g, blank)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/^\$\$[\s\S]*?\$\$/gm, blank)

  let para: PrompterPart[] = []
  let paraFrom = -1
  const endPara = (): void => {
    // Trim the spaces off the ends, and drop a paragraph that has nothing left in it.
    while (para.length && para[0].kind === 'text' && !para[0].text.trim()) para.shift()
    while (para.length && para[para.length - 1].kind === 'text' && !(para[para.length - 1] as { text: string }).text.trim()) para.pop()
    if (para.length) {
      if (para[0].kind === 'text') para[0] = { kind: 'text', text: para[0].text.trimStart() }
      const last = para[para.length - 1]
      if (last.kind === 'text') para[para.length - 1] = { kind: 'text', text: last.text.trimEnd() }
      blocks.push({ kind: 'para', parts: para, from: paraFrom })
    }
    para = []
    paraFrom = -1
  }
  const addText = (s: string): void => {
    const clean = plainInline(s)
    if (!clean) return
    const last = para[para.length - 1]
    if (last?.kind === 'text') para[para.length - 1] = { kind: 'text', text: (last.text + clean).replace(/[ \t]{2,}/g, ' ') }
    else para.push({ kind: 'text', text: clean.replace(/[ \t]{2,}/g, ' ') })
  }

  let pos = start
  for (const raw of body.split('\n')) {
    const lineFrom = pos
    pos += raw.length + 1
    const line = raw.trimEnd()
    if (!line.trim()) {
      endPara()
      continue
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      endPara()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      endPara()
      const t = plainInline(heading[2]).trim()
      if (t) blocks.push({ kind: 'heading', text: t, from: lineFrom })
      continue
    }
    // List bullets and quote marks aren't read out.
    const lead = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)*/.exec(line)?.[0] ?? ''
    const content = line.slice(lead.length)
    const contentFrom = lineFrom + lead.length
    if (paraFrom < 0) paraFrom = contentFrom
    else addText(' ')
    let at = 0
    for (const m of findMarkers(content, contentFrom)) {
      const rel = m.from - contentFrom
      addText(content.slice(at, rel))
      at = m.to - contentFrom
      if (m.type === 'NOTE') continue
      if (m.type === 'SECTION') {
        endPara()
        blocks.push({ kind: 'section', title: m.value, from: m.from, text: markerText('SECTION', m.value) })
        paraFrom = m.to
        continue
      }
      if (paraFrom < 0) paraFrom = m.from
      para.push({ kind: 'marker', type: m.type, value: m.value, from: m.from, text: markerText(m.type, m.value) })
    }
    addText(content.slice(at))
  }
  endPara()
  return blocks
}

/** How many words get read out in some blocks (for the scroll speed). */
export function prompterWords(blocks: PrompterBlock[]): number {
  let n = 0
  for (const b of blocks) {
    if (b.kind === 'para') for (const p of b.parts) n += p.kind === 'text' ? countWords(p.text) : p.type === 'EMPHASIS' ? countWords(spokenText(p.value)) : 0
  }
  return n
}

/**
 * How fast to scroll, in pixels a second, so the reading line moves at `wpm` words a minute:
 * the words take up `height` pixels between them. `speed` is the extra nudge (1 = your pace).
 */
export function scrollSpeed(height: number, words: number, wpm: number, speed = 1): number {
  if (height <= 0 || words <= 0 || wpm <= 0) return 0
  return (height / words) * (wpm / 60) * speed
}

/** A marker on the prompter: where it is in the note, and how far down the page it is (px). */
export interface PlacedMarker {
  from: number
  text: string
  type: MarkerType
  value: string
  y: number
}

/** The markers that reached the reading line as it moved from `before` down to `after` (px, page top). */
export function crossed(markers: readonly PlacedMarker[], before: number, after: number): PlacedMarker[] {
  if (after <= before) return []
  return markers.filter((m) => m.y > before && m.y <= after)
}

/** Where to scroll to for the section before (-1) or after (+1) the reading line. */
export function sectionJump(sectionTops: readonly number[], at: number, dir: 1 | -1): number | null {
  const sorted = [...sectionTops].sort((a, b) => a - b)
  if (dir > 0) return sorted.find((y) => y > at + 2) ?? null
  // Back: the start of this section if you're well into it, otherwise the one before.
  const before = sorted.filter((y) => y < at - 2)
  if (!before.length) return 0
  const here = before[before.length - 1]
  return at - here > 40 || before.length < 2 ? here : before[before.length - 2]
}

/** How long a pause marker holds the scroll still, in seconds. */
export const holdFor = (m: Pick<PlacedMarker, 'type' | 'value'>): number => (m.type === 'PAUSE' ? pauseSeconds(m.value) : 0)

// ---------- cue times, for the shot list ----------

export interface Cue {
  /** Where the marker is in the script note's text. */
  at: number
  /** The marker as written, e.g. "[IMAGE: rick.png]". */
  marker: string
  /** Seconds into the recording when it reached the reading line. */
  t: number
}

export interface CuesFile {
  version: 1
  /** The script note's path in your notes folder. */
  script: string
  cues: Cue[]
}

/** "<recording>.cues.json", saved beside the recording. */
export const cuesPath = (recording: string): string => `${recording}.cues.json`

/** The file's contents: each marker once (the first time it was reached), in the order they were reached. */
export function cuesFile(script: string, cues: readonly Cue[]): CuesFile {
  const seen = new Set<number>()
  const out: Cue[] = []
  for (const c of [...cues].sort((a, b) => a.t - b.t)) {
    if (seen.has(c.at)) continue
    seen.add(c.at)
    out.push({ at: c.at, marker: c.marker, t: Math.round(Math.max(0, c.t) * 100) / 100 })
  }
  return { version: 1, script, cues: out }
}
