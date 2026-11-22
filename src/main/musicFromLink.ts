import { app, ipcMain, net, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { copyFile, rename, rm } from 'fs/promises'
import { extname, join, relative, sep } from 'path'
import type NodeID3 from 'node-id3'
import { safeName } from '@shared/localMusic'
import { itunesSearchUrl, parseItunes, sameSong, songFromVideoTitle, type FoundTrack } from '@shared/songSearch'
import type { MusicLinkProgress } from '@shared/types'
import { downloadSoundTo } from './videoDownload'
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
async function lookUp(want: { artist: string; title: string }): Promise<FoundTrack | null> {
  try {
    const res = await net.fetch(itunesSearchUrl(`${want.artist} ${want.title}`, 8))
    if (!res.ok) return null
    return parseItunes(await res.json()).find((t) => sameSong(t, want)) ?? null
  } catch (err) {
    logError('looking up a downloaded song', err)
    return null
  }
}

async function save(sender: WebContents, id: string, link: string): Promise<void> {
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
    const found = await lookUp(guess)
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
      if (found?.art) {
        try {
          const { data, mime } = await imageFrom({ url: found.art.replace('/300x300bb.', '/600x600bb.') })
          tags.image = { mime, type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: data }
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

export function setupMusicFromLink(): void {
  ipcMain.handle('musicLink:save', (e, link: string) => {
    const id = randomUUID()
    void save(e.sender, id, String(link ?? ''))
    return id
  })
  ipcMain.handle('musicLink:cancel', (_e, id: string) => cancels.get(String(id))?.())
}
