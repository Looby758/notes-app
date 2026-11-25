import { ipcMain, net } from 'electron'
import { deezerSearchUrl, firstVideoId, itunesSearchUrl, mergeSearches, parseDeezer, parseItunes, youtubeQuery, youtubeWatchUrl, type FoundTrack } from '@shared/songSearch'
import { youTubeSearchUrl } from '@shared/youtube'
import { parseSpotifyEmbed, parseSpotifyLink, spotifyEmbedUrl, type SpotifyList } from '@shared/spotifyImport'
import {
  deezerArtistSearchUrl,
  deezerRelatedUrl,
  deezerTopUrl,
  matchArtist,
  parseDeezerArtists,
  parseDeezerTop,
  rankRelated,
  type DiscoverGroup,
  type DiscoverSeed
} from '@shared/musicDiscover'
import { logError } from './log'

/**
 * Song search on the Music page (shared/songSearch.ts): any song, from Deezer's and Apple's free
 * search APIs, and the YouTube video for one. Only the words you search for are sent, nothing else.
 */

const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** One catalogue's songs, or null if it couldn't be reached. */
async function ask(url: string, parse: (json: unknown) => FoundTrack[], what: string): Promise<FoundTrack[] | null> {
  try {
    const res = await net.fetch(url)
    if (!res.ok) {
      logError(`searching ${what}`, new Error(`status ${res.status}`))
      return null
    }
    return parse(await res.json())
  } catch (err) {
    logError(`searching ${what}`, err)
    return null
  }
}

/** Songs from Deezer and Apple together (each has songs the other is missing). */
async function search(query: string): Promise<FoundTrack[]> {
  if (!query.trim()) return []
  const [deezer, itunes] = await Promise.all([ask(deezerSearchUrl(query), parseDeezer, 'Deezer'), ask(itunesSearchUrl(query), parseItunes, 'iTunes')])
  if (!deezer && !itunes) throw new Error('Couldn’t reach the song search. Check you’re online, then try again.')
  return mergeSearches(deezer ?? [], itunes ?? [])
}

/** Videos already found this session. */
const videos = new Map<string, string>()

/** The song's YouTube video; if none can be found, YouTube's search for it. */
async function youtube(artist: string, title: string): Promise<{ url: string; exact: boolean }> {
  const q = youtubeQuery(artist, title)
  const known = videos.get(q)
  if (known) return { url: known, exact: true }
  try {
    const res = await net.fetch(youTubeSearchUrl(q), { headers: { 'User-Agent': BROWSER_AGENT, 'Accept-Language': 'en' } })
    const id = res.ok ? firstVideoId(await res.text()) : null
    if (id) {
      videos.set(q, youtubeWatchUrl(id))
      return { url: youtubeWatchUrl(id), exact: true }
    }
  } catch (err) {
    logError('finding a song on YouTube', err)
  }
  return { url: youTubeSearchUrl(q), exact: false }
}

/** Deezer's answer as JSON, or null if it couldn't be reached. */
async function deezer(url: string): Promise<unknown> {
  try {
    const res = await net.fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { error?: unknown }
    return json && !json.error ? json : null
  } catch {
    return null
  }
}

/** Runs the jobs a few at a time (Deezer allows about 50 asks every 5 seconds). */
async function fewAtATime<T, R>(items: T[], job: (item: T) => Promise<R>, at = 6): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(at, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await job(items[i])
      }
    })
  )
  return out
}

/** New songs found for the same favourite artists in the last few hours. */
const discovered = new Map<string, { at: number; groups: DiscoverGroup[] }>()
const DISCOVER_KEEP = 6 * 3_600_000

/**
 * Songs by artists like your favourites, and your favourites' popular songs, from Deezer (shared/musicDiscover.ts).
 * The renderer leaves out the ones you already have.
 */
async function discover(seeds: DiscoverSeed[]): Promise<DiscoverGroup[]> {
  const clean = seeds.filter((s) => s && typeof s.name === 'string' && s.name.trim()).slice(0, 8).map((s) => ({ name: s.name, weight: Number(s.weight) || 0.1 }))
  if (!clean.length) return []
  const key = JSON.stringify(clean.map((s) => s.name.toLowerCase()))
  const had = discovered.get(key)
  if (had && Date.now() - had.at < DISCOVER_KEEP) return had.groups

  const found = await fewAtATime(clean, async (seed) => {
    const artist = matchArtist(parseDeezerArtists(await deezer(deezerArtistSearchUrl(seed.name))), seed.name)
    if (!artist) return null
    return { seed, artist, related: parseDeezerArtists(await deezer(deezerRelatedUrl(artist.id))) }
  })
  const known = found.filter((f): f is NonNullable<typeof f> => !!f)
  if (!known.length) {
    if (found.length && !(await deezer(deezerArtistSearchUrl(clean[0].name)))) throw new Error('Couldn’t reach Deezer to find new music. Check you’re online, then try again.')
    return []
  }
  const similar = rankRelated(known)
  const jobs: { id: number; because: string; weight: number; limit: number }[] = [
    ...similar.map((r) => ({ id: r.artist.id, because: r.because, weight: r.score, limit: 8 })),
    // Songs by your favourites you don't have yet count a little less than new artists.
    ...known.map((k) => ({ id: k.artist.id, because: `More from ${k.artist.name}`, weight: k.seed.weight * 0.6, limit: 15 }))
  ]
  const groups = await fewAtATime(jobs, async (j) => ({ because: j.because, weight: j.weight, tracks: parseDeezerTop(await deezer(deezerTopUrl(j.id, j.limit))) }))
  const out = groups.filter((g) => g.tracks.length)
  discovered.set(key, { at: Date.now(), groups: out })
  return out
}

export function setupSongSearch(): void {
  ipcMain.handle('songSearch:search', (_e, query: string) => search(String(query ?? '')))
  ipcMain.handle('songSearch:discover', (_e, seeds: DiscoverSeed[]) => discover(Array.isArray(seeds) ? seeds : []))
  ipcMain.handle('songSearch:spotifyList', (_e, link: string) => spotifyList(String(link ?? '')))
  ipcMain.handle('songSearch:youtube', (_e, artist: string, title: string) => youtube(String(artist ?? ''), String(title ?? '')))
}

/** A public Spotify playlist or album, from its embed page (no sign-in; the first 100 songs). */
async function spotifyList(link: string): Promise<SpotifyList> {
  const parsed = parseSpotifyLink(link)
  if (!parsed) throw new Error('That isn’t a Spotify playlist or album link. In Spotify: Share → Copy link.')
  let res: Response
  try {
    res = await net.fetch(spotifyEmbedUrl(parsed), { headers: { 'User-Agent': BROWSER_AGENT, 'Accept-Language': 'en' } })
  } catch (err) {
    logError('reading a Spotify playlist', err)
    throw new Error('Couldn’t reach Spotify. Check you’re online, then try again.')
  }
  if (res.status === 404) throw new Error('Spotify says that playlist doesn’t exist, or it’s private.')
  if (!res.ok) throw new Error(`Spotify didn’t answer (${res.status}). Try again in a moment.`)
  const list = parseSpotifyEmbed(await res.text())
  if (!list) throw new Error('Couldn’t read that playlist. If it’s private, make it public in Spotify for a moment, or paste its songs instead.')
  return list
}
