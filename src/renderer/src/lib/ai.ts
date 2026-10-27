import { readFrontmatter } from './properties'

/** The AI helper's text handling that doesn't need the app: splitting notes, adding summaries, picking context. */

/** A note's frontmatter (kept as is, never sent for tidying) and the rest. */
export function splitFrontmatter(text: string): { head: string; body: string } {
  const fm = readFrontmatter(text)
  return fm ? { head: text.slice(0, fm.to), body: text.slice(fm.to) } : { head: '', body: text }
}

/** The note with a "Summary" callout added at the top, below its properties. */
export function withSummary(text: string, summary: string): string {
  const { head, body } = splitFrontmatter(text)
  const quoted = summary
    .trim()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
  return `${head}> [!summary] Summary\n${quoted}\n\n${body.replace(/^\n+/, '')}`
}

/** The note with its body swapped for a tidied one, properties untouched. */
export function withTidiedBody(text: string, tidied: string): string {
  const { head, body } = splitFrontmatter(text)
  const leading = /^\n*/.exec(body)![0]
  const trailing = /\n*$/.exec(body)![0]
  return head + leading + tidied.trim() + (trailing || '\n')
}

/**
 * Takes notes in the order given (best match first) until about `budget` characters, so a
 * question costs a few cents rather than sending every note. A long note is cut, not skipped.
 */
export function pickContext<T extends { text: string }>(ranked: T[], budget = 60000, maxNotes = 25): T[] {
  const picked: T[] = []
  let used = 0
  for (const note of ranked) {
    if (picked.length >= maxNotes || used >= budget) break
    const text = note.text.trim()
    if (!text) continue
    const room = budget - used
    const cut = text.length > room ? text.slice(0, room) + '\n…' : text
    picked.push({ ...note, text: cut })
    used += cut.length
  }
  return picked
}

/** Splits an answer into plain text and [[links]], so the links can be clickable. */
export function answerParts(answer: string): ({ text: string } | { link: string; label: string })[] {
  const parts: ({ text: string } | { link: string; label: string })[] = []
  const re = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g
  let last = 0
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) })
    parts.push({ link: m[1].trim(), label: (m[2] ?? m[1]).trim() })
    last = m.index + m[0].length
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) })
  return parts
}
