/**
 * Episode references: "S4E9" for season 4, episode 9 of a show, and "Issue 115" for a comic issue.
 * Written the way you'd type them ("S04E09", "s4e9", "Issue #115", "TWD 115") and always shown and
 * stored the short way ("S4E9", "Issue 115"), so everything from one episode can be found together.
 */

export type EpisodeRef = { kind: 'show'; season: number; episode: number } | { kind: 'comic'; issue: number }

const SHOW = /^S(\d{1,2})\s?E(\d{1,3})$/i
const COMIC = /^(?:issue|comic|twd|#)\s*#?\s*(\d{1,4})$/i

/** "S04E09" → { season 4, episode 9 }; null if it isn't an episode or issue. */
export function parseEpisode(text: string): EpisodeRef | null {
  const t = text.trim()
  const show = SHOW.exec(t)
  if (show) {
    const season = Number(show[1])
    const episode = Number(show[2])
    return season > 0 && episode > 0 ? { kind: 'show', season, episode } : null
  }
  const comic = COMIC.exec(t)
  if (comic && Number(comic[1]) > 0) return { kind: 'comic', issue: Number(comic[1]) }
  return null
}

export function episodeLabel(ref: EpisodeRef): string {
  return ref.kind === 'show' ? `S${ref.season}E${ref.episode}` : `Issue ${ref.issue}`
}

/** The short way of writing an episode or issue ("s04e09" → "S4E9"), or null. */
export function normalizeEpisode(text: string): string | null {
  const ref = parseEpisode(text)
  return ref && episodeLabel(ref)
}

/** Show episodes in order, then comic issues in order. */
export function compareEpisodes(a: string, b: string): number {
  const ra = parseEpisode(a)
  const rb = parseEpisode(b)
  if (!ra || !rb) return ra ? -1 : rb ? 1 : a.localeCompare(b)
  if (ra.kind !== rb.kind) return ra.kind === 'show' ? -1 : 1
  if (ra.kind === 'show' && rb.kind === 'show') return ra.season - rb.season || ra.episode - rb.episode
  return (ra as { issue: number }).issue - (rb as { issue: number }).issue
}

export interface EpisodeMention {
  label: string
  from: number
  to: number
}

/** Episode references written in some text ("in S4E9 …", "comic Issue #115"). */
export const EPISODE_IN_TEXT = /\b(S\d{1,2}\s?E\d{1,3})\b|\b((?:Issue|TWD)\s*#?\s*\d{1,4})\b/gi

export function findEpisodes(text: string, offset = 0): EpisodeMention[] {
  const out: EpisodeMention[] = []
  EPISODE_IN_TEXT.lastIndex = 0
  for (let m; (m = EPISODE_IN_TEXT.exec(text)); ) {
    const label = normalizeEpisode(m[0])
    if (label) out.push({ label, from: offset + m.index, to: offset + m.index + m[0].length })
  }
  return out
}

/**
 * Whether an episode matches what's searched for: "S4E9" only that episode, "S4" (or "season 4")
 * every episode of season 4, "Issue 115" that issue.
 */
export function episodeMatches(label: string, query: string): boolean {
  const q = query.trim()
  const exact = normalizeEpisode(q)
  if (exact) return exact === label
  const season = /^(?:S|season\s*)(\d{1,2})$/i.exec(q)
  if (season) return label.startsWith(`S${Number(season[1])}E`)
  return false
}

/** "S4E9" or "Issue 115" (or a whole season, "S4") typed into a search box, or null. */
export function isEpisodeQuery(query: string): boolean {
  const q = query.trim()
  return !!normalizeEpisode(q) || /^(?:S|season\s*)\d{1,2}$/i.test(q)
}

/** Every episode a note refers to: in its text and in an `episodes:` (or `episode:`) property. */
export function noteEpisodes(text: string, properties: { key: string; value: unknown }[] = []): string[] {
  const out = new Set(findEpisodes(text).map((e) => e.label))
  for (const p of properties) {
    if (!/^episodes?$/i.test(p.key)) continue
    const values = Array.isArray(p.value) ? p.value : typeof p.value === 'string' ? p.value.split(',') : []
    for (const v of values) {
      const label = typeof v === 'string' ? normalizeEpisode(v) : null
      if (label) out.add(label)
    }
  }
  return [...out].sort(compareEpisodes)
}
