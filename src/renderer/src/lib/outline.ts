export interface Heading {
  level: number
  text: string
  /** Offset of the heading line in the note. */
  from: number
}

/** Strips markdown so headings read cleanly: "**Big** [[Plan|idea]]" → "Big idea". */
function plain(text: string): string {
  return text
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

/** ATX headings (# … ######) outside code blocks and frontmatter, in document order. */
export function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  let pos = 0
  let fence: string | null = null
  let inFrontmatter = text.startsWith('---\n') || text.startsWith('---\r\n')
  let first = true
  for (const line of text.split('\n')) {
    if (inFrontmatter) {
      if (!first && /^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false
    } else {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1][0]
        else if (fenceMatch[1][0] === fence) fence = null
      } else if (!fence) {
        const m = /^ {0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/.exec(line)
        if (m && m[2].trim()) headings.push({ level: m[1].length, text: plain(m[2]), from: pos })
      }
    }
    first = false
    pos += line.length + 1
  }
  return headings
}

/**
 * The part of a note under `heading` (matched case-insensitively), from that heading down to
 * the next heading of the same or a higher level. Null if there's no such heading.
 */
export function extractSection(text: string, heading: string): string | null {
  const headings = extractHeadings(text)
  const wanted = heading.trim().toLowerCase()
  const i = headings.findIndex((h) => h.text.toLowerCase() === wanted)
  if (i === -1) return null
  const level = headings[i].level
  const end = headings.slice(i + 1).find((h) => h.level <= level)
  return text.slice(headings[i].from, end ? end.from : text.length).replace(/\s+$/, '')
}

/** A note without its YAML frontmatter (embeds show just the content). */
export function withoutFrontmatter(text: string): string {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text)
  return m ? text.slice(m[0].length) : text
}

/** Index of the heading the cursor is under (the last one at or before `pos`), or -1. */
export function currentHeadingIndex(headings: Heading[], pos: number): number {
  let lo = 0
  let hi = headings.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (headings[mid].from <= pos) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}
