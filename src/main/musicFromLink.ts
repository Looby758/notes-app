import { app, ipcMain, net, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { copyFile, rename, rm } from 'fs/promises'
import { extname, join, relative, sep } from 'path'
import type NodeID3 from 'node-id3'
import { safeName } from '@shared/localMusic'
import { catalogueMatch, itunesSearchUrl, parseItunes, sameSong, songFromVideoTitle, type FoundTrack } from '@shared/songSearch'
import type { MusicLinkProgress } from '@shared/types'
import { downloadSoundTo } from './videoDownload'
import { youTubeVideoId } from '@shared/youtube'
import { musicFolder, refreshLibrary } from './localMusic'
import { freeName, imageFrom, writeTags } from './musicTags'
import { logError } from './log'

/**
 * "Save MP3 to my music": paste a YouTube (or TikTok, SoundCloud…) link and the song lands in your
 * music folder as an MP3, using the same downloader as the Downloads page. Its title, artist,
 * album, year and cover come from Apple's free catalogue when the song is found there, otherwise
 * from the video's title.
 */

const tempFolder = (): string => join(app.getPath('temp'), 'orbit-music-links')
const cancels = new Map<string, () => void>()

/** The song in Apple's catalogue, if it's clearly the same one. */
async function lookUp(videoTitle: string, want: { artist: string; title: string }): Promise<FoundTrack | null> {
  try {
    const res = await net.fetch(itunesSearchUrl(`${want.artist} ${want.title}`, 40))
    if (!res.ok) return null
    return catalogueMatch(parseItunes(await res.json()), videoTitle)
  } catch (err) {
    logError('looking up a downloaded song', err)
    return null
  }
}

async function lookUpKnown(known: FoundTrack): Promise<FoundTrack | null> {
  try {
    const res = await net.fetch(itunesSearchUrl(`${known.artist} ${known.title}`, 15))
    if (!res.ok) return null
    return parseItunes(await res.json()).find((t) => sameSong(t, known)) ?? null
  } catch {
    return null
  }
}

/** The song you picked, with anything it's missing filled in from the catalogue's copy. */
const withGaps = (known: FoundTrack, more: FoundTrack | null): FoundTrack =>
  more ? { ...known, album: known.album || more.album, year: known.year || more.year, genre: known.genre || more.genre, art: known.art ?? more.art } : known

async function save(sender: WebContents, id: string, link: string, known: FoundTrack | null): Promise<void> {
  const tell = (p: Omit<MusicLinkProgress, 'id'>): void => {
    if (!sender.isDestroyed()) sender.send('musicLink:progress', { id, ...p })
  }
  const folder = musicFolder()
  if (!folder) return tell({ stage: 'error', error: 'Choose your music folder first (Settings → Music).' })
  const dir = join(tempFolder(), id)
  try {
    tell({ stage: 'downloading', done: null })
    const job = downloadSoundTo(link, dir, (done) => tell({ stage: 'downloading', done }))
    cancels.set(id, job.cancel)
    const { file, title: videoTitle } = await job.done
    cancels.delete(id)

    tell({ stage: 'details', done: null, title: videoTitle })
    const guess = songFromVideoTitle(videoTitle)
    // Saved from Search: the song you picked there is the one. Otherwise, look it up.
    // A song known only by its name and artist (from a Spotify list): its album and cover are looked up.
    // A song picked from Deezer's results has no year or genre: Apple's catalogue fills them in if it has the song.
    const found = known?.album && known.year ? known : known ? withGaps(known, await lookUpKnown(known)) : await lookUp(videoTitle, guess)
    const song = {
      title: found?.title ?? guess.title,
      artist: found?.artist ?? guess.artist,
      album: found?.album ?? '',
      year: found?.year ?? '',
      genre: found?.genre ?? ''
    }
    const ext = extname(file).toLowerCase() || '.mp3'
    if (ext === '.mp3') {
      const tags: NodeID3.Tags = { title: song.title, artist: song.artist, album: song.album, year: song.year, genre: song.genre }
      // The catalogue's cover, or else the video's own picture (on YouTube Music that's the album cover).
      const videoId = youTubeVideoId(link)
      const pictures = found?.art ? [found.art.replace('/300x300bb.', '/600x600bb.').replace('/500x500-', '/1000x1000-')] : videoId ? [`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`] : []
      for (const url of pictures) {
        try {
          const { data, mime } = await imageFrom({ url })
          tags.image = { mime, type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: data }
          break
        } catch (err) {
          logError('getting a downloaded song’s cover', err)
        }
      }
      await writeTags(file, tags).catch((err) => logError('writing a downloaded song’s details', err))
    }
    const name = safeName(song.artist ? `${song.artist} - ${song.title}` : song.title) || 'Song'
    const to = freeName(join(folder, `${name}${ext}`))
    try {
      await rename(file, to)
    } catch {
      // Another drive (Google Drive): copy across instead.
      await copyFile(file, to)
    }
    await refreshLibrary(true)
    tell({ stage: 'done', title: song.title, artist: song.artist, path: relative(folder, to).split(sep).join('/'), matched: !!found })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    tell({ stage: message === 'Stopped.' ? 'cancelled' : 'error', error: message })
  } finally {
    cancels.delete(id)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The song picked in Search, checked over (it comes from the window). */
function knownSong(t: unknown): FoundTrack | null {
  const r = t as Partial<FoundTrack> | null
  if (!r || typeof r.title !== 'string' || !r.title.trim()) return null
  const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 300) : '')
  const art = text(r.art)
  return { id: text(r.id), title: text(r.title), artist: text(r.artist), album: text(r.album), year: text(r.year), genre: text(r.genre), durationMs: 0, art: art.startsWith('https://') ? art : undefined }
}

export function setupMusicFromLink(): void {
  ipcMain.handle('musicLink:save', (e, link: string, known?: FoundTrack) => {
    const id = randomUUID()
    void save(e.sender, id, String(link ?? ''), knownSong(known))
    return id
  })
  ipcMain.handle('musicLink:cancel', (_e, id: string) => cancels.get(String(id))?.())
}
