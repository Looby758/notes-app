import { maskCode } from './links'
import { parseFrontmatter } from './tags'

/**
 * Unlinked mentions: places where a note's name appears as plain text in another note, without
 * a link. Only the exact name counts (any capitalisation, as a whole word): "Dentist" matches
 * "dentist" but not "Dentists" or "dentist's".
 */

export interface Mention {
  /** Offsets of the mentioned text in the note. */
  from: number
  to: number
  /** 0-based line. */
  line: number
  /** The text as written ("dentist"). */
  text: string
  /** The whole line, and where the mention sits in it. */
  snippet: string
  snipFrom: number
  snipTo: number
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Places where a mention can't be: code, frontmatter, links, embeds, URLs and HTML tags. */
function blockedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const fm = parseFrontmatter(text).end
  if (fm) ranges.push([0, fm])
  const masked = maskCode(text)
  for (let i = 0; i < text.length; i++) {
    if (masked[i] !== text[i]) {
      const start = i
      while (i < text.length && masked[i] !== text[i]) i++
      ranges.push([start, i])
    }
  }
  const patterns = [
    /!?\[\[[^\]\n]*\]\]/g, // [[links]] and ![[embeds]]
    /!?\[[^\]\n]*\]\([^)\n]*\)/g, // [text](links) and ![images](…)
    /<[^>\n]+>/g, // <html> and <autolinks>
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/gi // bare URLs
  ]
  for (const re of patterns) for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

export function findMentions(text: string, title: string): Mention[] {
  const name = title.trim()
  if (name.length < 2) return []
  // Whole words only, and not part of a #tag or a path.
  const re = new RegExp(`(?<![\\p{L}\\p{N}_#/\\\\])${escape(name)}(?![\\p{L}\\p{N}_]|'s\\b|’s\\b)`, 'giu')
  const blocked = blockedRanges(text)
  const isBlocked = (from: number, to: number): boolean => blocked.some(([a, b]) => from < b && to > a)
  const out: Mention[] = []
  for (const m of text.matchAll(re)) {
    const from = m.index
    const to = from + m[0].length
    if (isBlocked(from, to)) continue
    const lineStart = text.lastIndexOf('\n', from - 1) + 1
    const lineEndRaw = text.indexOf('\n', from)
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
    out.push({
      from,
      to,
      line: text.slice(0, lineStart).split('\n').length - 1,
      text: m[0],
      snippet: text.slice(lineStart, lineEnd),
      snipFrom: from - lineStart,
      snipTo: to - lineStart
    })
  }
  return out
}

/**
 * Turns mentions into links: "dentist" → `[[Dentist|dentist]]` (or `[[Dentist]]` when written the
 * same). `linkName` is how to write the target ("Dentist", or "Health/Dentist" if the name isn't
 * unique). `which` picks mentions (default: all). Returns the new text, or null if nothing changed.
 */
export function linkMentions(
  text: string,
  title: string,
  linkName: string,
  which: (m: Mention, index: number) => boolean = () => true
): string | null {
  const picked = findMentions(text, title).filter(which)
  if (picked.length === 0) return null
  let out = ''
  let last = 0
  for (const m of picked) {
    const link = m.text === title.trim() && linkName === title.trim() ? `[[${linkName}]]` : `[[${linkName}|${m.text}]]`
    out += text.slice(last, m.from) + link
    last = m.to
  }
  return out + text.slice(last)
}
