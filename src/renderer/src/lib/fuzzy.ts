const isWordStart = (text: string, i: number): boolean =>
  i === 0 || /[\s/_\-.()]/.test(text[i - 1]) || (/\p{Lu}/u.test(text[i]) && /\p{Ll}/u.test(text[i - 1]))

/**
 * Picks a position for each query character. With `preferWordStarts`, each character jumps to
 * the next word start ("mn" → *M*eeting *n*otes) unless it can continue the current run.
 */
function locate(q: string, text: string, t: string, preferWordStarts: boolean): number[] | null {
  const positions: number[] = []
  let from = 0
  for (const ch of q) {
    let found = -1
    const last = positions[positions.length - 1]
    if (last !== undefined && t[last + 1] === ch) {
      found = last + 1
    } else if (preferWordStarts) {
      for (let i = t.indexOf(ch, from); i !== -1; i = t.indexOf(ch, i + 1)) {
        if (isWordStart(text, i)) {
          found = i
          break
        }
      }
    }
    if (found === -1) found = t.indexOf(ch, from)
    if (found === -1) return null
    positions.push(found)
    from = found + 1
  }
  return positions
}

/**
 * Small fuzzy matcher for the quick switcher and command palette. Every query character must
 * appear in order; matches at word starts and consecutive runs score higher.
 * Returns null for no match, else a score (higher is better) and the matched character positions.
 */
export function fuzzyMatch(query: string, text: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const t = text.toLowerCase()
  const positions = locate(q, text, t, true) ?? locate(q, text, t, false)
  if (!positions) return null
  let score = 0
  positions.forEach((pos, i) => {
    score += 1
    if (i > 0 && pos === positions[i - 1] + 1) score += 4 // consecutive
    if (isWordStart(text, pos)) score += 6
    if (pos === 0) score += 4
    score -= Math.min(pos - (i > 0 ? positions[i - 1] + 1 : 0), 6) * 0.3 // gaps
  })
  // Shorter texts with the same match feel more relevant.
  score -= text.length * 0.02
  return { score, positions }
}

/** Filters and ranks items by fuzzy-matching `query` against `key(item)`. */
export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): { item: T; positions: number[] }[] {
  const results: { item: T; positions: number[]; score: number }[] = []
  for (const item of items) {
    const m = fuzzyMatch(query, key(item))
    if (m) results.push({ item, ...m })
  }
  return results.sort((a, b) => b.score - a.score)
}
