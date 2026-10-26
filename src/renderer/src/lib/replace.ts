/**
 * Find and replace across notes. A search is plain text (optionally whole words / matching case)
 * or a regular expression, where the replacement can use $1, $2… for captured groups.
 */

export interface FindOptions {
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
}

export interface Match {
  from: number
  to: number
  /** 0-based line number. */
  line: number
  /** The line, and where the match sits in it. */
  snippet: string
  snipFrom: number
  snipTo: number
  /** What this match would become. */
  replacement: string
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The search as a RegExp, or an error message if a regular expression doesn't make sense. */
export function buildPattern(query: string, opts: FindOptions): RegExp | string {
  if (!query) return 'Type something to find.'
  let source = opts.regex ? query : escapeRegex(query)
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(source, `g${opts.matchCase ? '' : 'i'}u`)
  } catch (err) {
    return `That pattern doesn't work: ${(err as Error).message.replace(/^Invalid regular expression: /, '')}`
  }
}

/** What one match becomes: $1… for groups (regex only), $& for the whole match, $$ for a $. */
function expand(replacement: string, m: RegExpExecArray, regex: boolean): string {
  if (!regex) return replacement
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (_s, k: string) => (k === '$' ? '$' : k === '&' ? m[0] : (m[Number(k)] ?? '')))
}

export function findMatches(text: string, pattern: RegExp, replacement: string, opts: Pick<FindOptions, 'regex'>, limit = 500): Match[] {
  const out: Match[] = []
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) && out.length < limit) {
    if (m[0] === '') {
      // An empty match would loop forever; step past it.
      pattern.lastIndex++
      continue
    }
    const from = m.index
    const to = from + m[0].length
    const lineStart = text.lastIndexOf('\n', from - 1) + 1
    const lineEndRaw = text.indexOf('\n', from)
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
    out.push({
      from,
      to,
      line: text.slice(0, lineStart).split('\n').length - 1,
      snippet: text.slice(lineStart, Math.max(lineEnd, Math.min(to, text.length))),
      snipFrom: from - lineStart,
      snipTo: Math.min(to, lineEnd) - lineStart,
      replacement: expand(replacement, m, opts.regex)
    })
  }
  return out
}

/** Replaces the chosen matches (by position, as found in `text`). */
export function applyMatches(text: string, matches: Pick<Match, 'from' | 'to' | 'replacement'>[]): string {
  let out = ''
  let last = 0
  for (const m of [...matches].sort((a, b) => a.from - b.from)) {
    if (m.from < last) continue
    out += text.slice(last, m.from) + m.replacement
    last = m.to
  }
  return out + text.slice(last)
}
