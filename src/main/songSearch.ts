import { ipcMain, net } from 'electron'
import { firstVideoId, itunesSearchUrl, parseItunes, youtubeQuery, youtubeWatchUrl, type FoundTrack } from '@shared/songSearch'
import { youTubeSearchUrl } from '@shared/youtube'
import { parseSpotifyEmbed, parseSpotifyLink, spotifyEmbedUrl, type SpotifyList } from '@shared/spotifyImport'
import { logError } from './log'

/**
 * Song search on the Music page (shared/songSearch.ts): any song, from Apple's free iTunes Search
 * API, and the YouTube video for one. Only the words you search for are sent, nothing else.
 */

const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function search(query: string): Promise<FoundTrack[]> {
  if (!query.trim()) return []
  let res: Response
  try {
    res = await net.fetch(itunesSearchUrl(query))
  } catch (err) {
    logError('searching for songs', err)
    throw new Error('Couldn’t reach the song search. Check you’re online, then try again.')
  }
  if (!res.ok) throw new Error(`The song search didn’t answer (${res.status}). Try again in a moment.`)
  return parseItunes(await res.json())
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

export function setupSongSearch(): void {
  ipcMain.handle('songSearch:search', (_e, query: string) => search(String(query ?? '')))
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
