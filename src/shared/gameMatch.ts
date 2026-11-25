/**
 * Finding the game someone means by name (for Claude Desktop's "start Minecraft"). Starting the
 * wrong game is worse than asking, so this only picks a game when the name clearly points at one:
 * the whole name, the same words, or the name's initials ("gta 5", "cs2"). A few letters from the
 * middle of a name ("craft") never start anything; they come back as suggestions instead.
 */

export interface MatchableGame {
  id: string
  name: string
  hidden?: boolean
}

export type GameMatch<T> =
  /** One game, and how it matched. */
  | { kind: 'one'; game: T; how: 'id' | 'name' | 'words' | 'initials' }
  /** More than one game fits just as well: ask which. */
  | { kind: 'several'; games: T[] }
  /** Nothing fits well enough to start; these are the nearest names, if any. */
  | { kind: 'none'; close: T[] }

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12' }

/** A name as words: lower case, no ™/®, punctuation as spaces, "&" as "and", II as 2. */
export function gameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
}

const FILLER = new Set(['the', 'game', 'my'])

/** The first letter of each word, keeping numbers whole: Grand Theft Auto V → gta5. */
function initials(words: string[]): string {
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('')
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]
}

/**
 * The game `want` means. An id (from a list) matches exactly. Otherwise the shown games are tried
 * first, best way first, and a hidden one only when its whole name is given.
 */
export function findGame<T extends MatchableGame>(games: readonly T[], want: string): GameMatch<T> {
  const raw = want.trim()
  const byId = games.filter((g) => g.id === raw)
  if (byId.length === 1) return { kind: 'one', game: byId[0], how: 'id' }

  const words = gameWords(raw)
  const asked = words.filter((w) => !FILLER.has(w))
  if (!asked.length) return { kind: 'none', close: [] }
  const compact = words.join('')
  const named = games.map((g) => ({ g, words: gameWords(g.name) }))
  const shown = named.filter((n) => !n.g.hidden)

  const decide = (hits: { g: T }[], how: 'name' | 'words' | 'initials'): GameMatch<T> | null => {
    if (hits.length === 1) return { kind: 'one', game: hits[0].g, how }
    if (hits.length > 1) return { kind: 'several', games: hits.map((h) => h.g) }
    return null
  }

  // The whole name (ignoring case, spaces and punctuation): shown games, then hidden ones.
  const sameName = (list: typeof named): typeof named => list.filter((n) => n.words.join('') === compact)
  const exact = decide(sameName(shown), 'name') ?? decide(sameName(named), 'name')
  if (exact) return exact

  // Every word asked for is a whole word of the name, or the name's initials ("gta 5", "cs2").
  const hits = shown.filter((n) => asked.every((w) => n.words.includes(w)) || (compact.length >= 2 && initials(n.words) === compact))
  const fits = decide(
    hits,
    hits.length === 1 && !asked.every((w) => hits[0].words.includes(w)) ? 'initials' : 'words'
  )
  if (fits) return fits

  // Nothing clear: offer the names that are close (part of a word, or a small typo), never start one.
  const close = shown
    .map((n) => {
      const joined = n.words.join('')
      const part = joined.includes(compact) || asked.some((w) => w.length >= 3 && n.words.some((nw) => nw.startsWith(w) || nw.includes(w)))
      // A typo in the whole name (a third of its letters at most), or in one longer word (a quarter).
      const whole = distance(compact, joined)
      const typo = whole <= Math.max(1, Math.floor(compact.length / 3)) ? whole : Math.min(99, ...asked.filter((w) => w.length >= 4).flatMap((w) => n.words.map((nw) => distance(w, nw)).filter((d) => d <= Math.floor(w.length / 4))))
      return { g: n.g, score: part ? 0 : typo }
    })
    .filter((c) => c.score < 99)
    .sort((a, b) => a.score - b.score || a.g.name.localeCompare(b.g.name))
    .slice(0, 5)
    .map((c) => c.g)
  return { kind: 'none', close }
}
