/**
 * Working out which show, season and episode a video file is from its name and folders, so Claude
 * Desktop can play "episode 3 of season 2" or "the next episode". Understands the usual ways
 * they're saved:
 *
 *   Breaking Bad/Season 1/Breaking.Bad.S01E03.mkv
 *   Breaking Bad/S1/1x03 - ...and the Bag's in the River.mp4
 *   Breaking Bad/Season 2/Episode 4.mp4
 *   Breaking Bad/Season 2/04 Down.mp4
 */

export interface Episode {
  show: string
  season: number
  episode: number
}

const SXE = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?![0-9])/i
const NXN = /(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?![0-9])/i
const SEASON_FOLDER = /^(?:season|series|s)[ ._-]*(\d{1,2})$/i
const EPISODE_WORD = /(?:^|[^a-z])(?:episode|ep|e)[ ._-]*(\d{1,3})(?![0-9])/i
const LEADING_NUMBER = /^(\d{1,3})(?![0-9])(?:\s*[-._ ]|$)/

const stem = (name: string): string => name.replace(/\.[a-z0-9]{2,4}$/i, '')

/** "Breaking.Bad.2008" / "breaking_bad" → "Breaking Bad" (dots and underscores as spaces, a trailing year dropped). */
export function cleanShowName(text: string): string {
  return text
    .replace(/[._]+/g, ' ')
    .replace(/\s*[[(]?\b(19|20)\d{2}\b[\])]?\s*$/, '')
    .replace(/[\s-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The show, season and episode a video's path says, or null for a video that isn't an episode. */
export function episodeOf(path: string): Episode | null {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const file = stem(parts[parts.length - 1] ?? '')
  const folders = parts.slice(0, -1)
  const parent = folders[folders.length - 1] ?? ''
  const seasonFolder = SEASON_FOLDER.exec(parent.trim())
  const showFromFolders = (): string => cleanShowName((seasonFolder ? folders[folders.length - 2] : parent) ?? '')

  const sxe = SXE.exec(file) ?? NXN.exec(file)
  if (sxe) {
    const before = cleanShowName(file.slice(0, sxe.index + (/^[^a-z0-9]/i.test(sxe[0]) ? 1 : 0)))
    const show = before || showFromFolders()
    return show ? { show, season: Number(sxe[1]), episode: Number(sxe[2]) } : null
  }
  if (!seasonFolder) return null
  const n = EPISODE_WORD.exec(file) ?? LEADING_NUMBER.exec(file)
  const show = showFromFolders()
  return n && show ? { show, season: Number(seasonFolder[1]), episode: Number(n[1]) } : null
}

export const sameShow = (a: string, b: string): boolean => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')

export const compareEpisodes = (a: Episode, b: Episode): number => a.season - b.season || a.episode - b.episode

export const episodeLabel = (e: Pick<Episode, 'season' | 'episode'>): string => `S${e.season}E${e.episode}`

/** The episodes of one show among some videos, in order (a path for each; the first copy wins). */
export function showEpisodes<T extends { path: string }>(videos: T[], show: string): (T & Episode)[] {
  const seen = new Set<string>()
  const out: (T & Episode)[] = []
  for (const v of videos) {
    const e = episodeOf(v.path)
    if (!e || !sameShow(e.show, show)) continue
    const key = episodeLabel(e)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...v, ...e })
  }
  return out.sort(compareEpisodes)
}
