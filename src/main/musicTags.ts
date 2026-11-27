import { BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'path'
import NodeID3 from 'node-id3'
import { parseFile } from 'music-metadata'
import { canTag, guessFromName, LOCAL_AUDIO, safeName, type LocalLibrary, type SongTagPatch } from '@shared/localMusic'
import { musicFile, musicFolder, refreshLibrary } from './localMusic'
import { logError } from './log'
import { execFile } from 'child_process'
import { downloadFfmpeg, ffmpegPath } from './ffmpeg'

/**
 * Changing your music files from the Music page (plan part 3): song details and covers written into
 * the MP3s themselves (so they show the same everywhere, including the phone), adding songs by
 * dragging them in, tidying file names, and taking out spare copies. Every file stays inside the
 * music folder; anything outside it is refused.
 */

const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const MAX_IMAGE = 8 * 1024 * 1024

function inFolder(path: string): string {
  const full = musicFile(String(path ?? ''))
  if (!full) throw new Error('That song isn’t in your music folder.')
  return full
}

/** Writes ID3 details into an MP3, through a copy so a half-written file never replaces the song. */
export async function writeTags(full: string, tags: NodeID3.Tags): Promise<void> {
  if (!canTag(full)) throw new Error(`Only MP3 files can be changed (“${basename(full)}”).`)
  const before = await readFile(full)
  const after = NodeID3.update(tags, before)
  if (!Buffer.isBuffer(after)) throw new Error(`Couldn’t write into “${basename(full)}”.`)
  const tmp = `${full}.orbit-tmp`
  await writeFile(tmp, after)
  await rename(tmp, full)
}

function toId3(patch: SongTagPatch): NodeID3.Tags {
  const tags: NodeID3.Tags = {}
  if (patch.title !== undefined) tags.title = patch.title.trim()
  if (patch.artist !== undefined) tags.artist = patch.artist.trim()
  if (patch.album !== undefined) tags.album = patch.album.trim()
  if (patch.year !== undefined) tags.year = patch.year.trim()
  if (patch.genre !== undefined) tags.genre = patch.genre.trim()
  if (patch.track !== undefined) tags.trackNumber = patch.track > 0 ? String(Math.round(patch.track)) : ''
  return tags
}

interface TagResult {
  library: LocalLibrary
  /** Songs that couldn't be changed, with why. */
  failed: { path: string; why: string }[]
}

async function each(paths: string[], job: (full: string, path: string) => Promise<void>): Promise<TagResult> {
  const failed: TagResult['failed'] = []
  for (const path of paths) {
    try {
      await job(inFolder(path), path)
    } catch (err) {
      logError('changing a music file', err)
      failed.push({ path, why: err instanceof Error ? err.message : String(err) })
    }
  }
  return { library: await refreshLibrary(true), failed }
}

/** Each song's own changes (undo puts back each song's old details). */
function editTags(changes: { path: string; patch: SongTagPatch }[]): Promise<TagResult> {
  const byPath = new Map(changes.map((c) => [c.path, c.patch]))
  return each([...byPath.keys()], (full, path) => writeTags(full, toId3(byPath.get(path)!)))
}

/** Fills empty details from names like "01 - Artist - Title.mp3". */
function fillFromNames(paths: string[]): Promise<TagResult> {
  return each(paths, async (full, path) => {
    const { common } = await parseFile(full, { duration: false, skipCovers: true })
    const guess = guessFromName(path)
    const patch: SongTagPatch = {}
    if (!common.title?.trim() && guess.title) patch.title = guess.title
    if (!(common.artist ?? '').trim() && guess.artist) patch.artist = guess.artist
    if (!common.track?.no && guess.track) patch.track = guess.track
    if (Object.keys(patch).length) await writeTags(full, toId3(patch))
  })
}

export async function imageFrom(source: { file?: string; url?: string }): Promise<{ data: Buffer; mime: string }> {
  if (source.file) {
    const mime = IMAGE_TYPES[extname(source.file).toLowerCase()]
    if (!mime) throw new Error('Use a JPG, PNG or WebP picture.')
    if ((await stat(source.file)).size > MAX_IMAGE) throw new Error('That picture is too big (8 MB at most).')
    return { data: await readFile(source.file), mime }
  }
  if (source.url && /^https:\/\//i.test(source.url)) {
    const res = await net.fetch(source.url)
    if (!res.ok) throw new Error(`Couldn’t download the cover (${res.status}).`)
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!Object.values(IMAGE_TYPES).includes(mime)) throw new Error('That link isn’t a picture.')
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length > MAX_IMAGE) throw new Error('That picture is too big (8 MB at most).')
    return { data, mime }
  }
  throw new Error('No picture was given.')
}

/** The same cover for each song (usually a whole album). */
async function setCover(paths: string[], source: { file?: string; url?: string }): Promise<TagResult> {
  const { data, mime } = await imageFrom(source)
  const image = { mime, type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: data }
  return each(paths, (full) => writeTags(full, { image } as NodeID3.Tags))
}

/** Covers Apple's free catalogue has for an album (biggest first). */
async function findCovers(artist: string, album: string): Promise<{ url: string; album: string; artist: string }[]> {
  const term = `${artist} ${album}`.replace(/\s+/g, ' ').trim()
  if (!term) return []
  let res: Response
  try {
    res = await net.fetch(`https://itunes.apple.com/search?media=music&entity=album&limit=12&term=${encodeURIComponent(term)}`)
  } catch (err) {
    logError('finding album covers', err)
    throw new Error('Couldn’t reach the cover search. Check you’re online, then try again.')
  }
  if (!res.ok) throw new Error(`The cover search didn’t answer (${res.status}).`)
  const json = (await res.json()) as { results?: Record<string, unknown>[] }
  const seen = new Set<string>()
  const out: { url: string; album: string; artist: string }[] = []
  for (const r of json.results ?? []) {
    const art = typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : ''
    if (!art.startsWith('https://') || seen.has(art)) continue
    seen.add(art)
    out.push({ url: art, album: String(r.collectionName ?? ''), artist: String(r.artistName ?? '') })
  }
  return out.slice(0, 8)
}

async function chooseImage(e: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options = { title: 'Choose a cover picture', properties: ['openFile' as const], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

const folderOrThrow = (): string => {
  const folder = musicFolder()
  if (!folder) throw new Error('Choose your music folder first (Settings → Music).')
  return folder
}

const rel = (folder: string, full: string): string => relative(folder, full).split(sep).join('/')

/** A free name next to `full` ("Song (2).mp3" if "Song.mp3" is taken). */
export function freeName(full: string): string {
  if (!existsSync(full)) return full
  const ext = extname(full)
  const stem = full.slice(0, -ext.length)
  for (let n = 2; ; n++) if (!existsSync(`${stem} (${n})${ext}`)) return `${stem} (${n})${ext}`
}

/** Copies music files into the music folder (the top of it, like the rest of your songs). */
async function importFiles(files: string[]): Promise<{ library: LocalLibrary; added: string[]; skipped: string[] }> {
  const folder = folderOrThrow()
  const added: string[] = []
  const skipped: string[] = []
  for (const file of files.map(String)) {
    try {
      if (!LOCAL_AUDIO.includes(extname(file).toLowerCase()) || !(await stat(file)).isFile()) {
        skipped.push(basename(file))
        continue
      }
      // Already in the folder: nothing to copy.
      const inside = relative(folder, file)
      if (inside && !inside.startsWith('..') && !inside.includes(':')) {
        added.push(inside.split(sep).join('/'))
        continue
      }
      const to = freeName(join(folder, safeName(basename(file, extname(file))) + extname(file).toLowerCase()))
      await copyFile(file, to)
      added.push(rel(folder, to))
    } catch (err) {
      logError('adding a music file', err)
      skipped.push(basename(file))
    }
  }
  return { library: await refreshLibrary(true), added, skipped }
}

async function chooseImport(e: Electron.IpcMainInvokeEvent): Promise<ReturnType<typeof importFiles> | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options = {
    title: 'Add songs to your music',
    properties: ['openFile' as const, 'multiSelections' as const],
    filters: [{ name: 'Music', extensions: LOCAL_AUDIO.map((x) => x.slice(1)) }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || !result.filePaths.length ? null : importFiles(result.filePaths)
}

/** Renames and moves songs inside the music folder; returns the moves that were made. */
async function moveFiles(moves: { from: string; to: string }[]): Promise<{ library: LocalLibrary; done: { from: string; to: string }[]; failed: string[] }> {
  const folder = folderOrThrow()
  const done: { from: string; to: string }[] = []
  const failed: string[] = []
  const left = new Set<string>()
  for (const m of moves) {
    try {
      const from = inFolder(m.from)
      const to = inFolder(m.to)
      if (!LOCAL_AUDIO.includes(extname(to).toLowerCase())) throw new Error('Not a music file name.')
      if (from.toLowerCase() !== to.toLowerCase() && existsSync(to)) throw new Error('Something already has that name.')
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      done.push({ from: m.from, to: m.to })
      left.add(dirname(from))
    } catch (err) {
      logError('tidying a music file', err)
      failed.push(m.from)
    }
  }
  // Folders the songs came out of, if nothing is left in them.
  for (const dir of [...left].sort((a, b) => b.length - a.length)) {
    for (let d = dir; d.length > folder.length && d.startsWith(folder); d = dirname(d)) {
      try {
        if ((await readdir(d)).length) break
        await rmdir(d)
      } catch {
        break
      }
    }
  }
  return { library: await refreshLibrary(true), done, failed }
}

/** Puts songs in the Recycle Bin / Bin (so they can still be got back). */
async function trashSongs(paths: string[]): Promise<LocalLibrary> {
  for (const path of paths) {
    try {
      await shell.trashItem(inFolder(path))
    } catch (err) {
      logError('putting a song in the bin', err)
    }
  }
  return refreshLibrary(true)
}

/**
 * Cuts a song down to the part from `start` to `end` (seconds), in place. ffmpeg copies the sound
 * as it is (no re-encoding, so nothing is lost) along with its details and cover. The original goes
 * to the Recycle Bin / Bin, so a trim can still be undone by hand.
 */
async function trimSong(path: string, start: number, end: number): Promise<LocalLibrary> {
  const full = inFolder(path)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.1) throw new Error('Pick at least a moment of the song to keep.')
  const ffmpeg = existsSync(ffmpegPath()) ? ffmpegPath() : (await downloadFfmpeg(), existsSync(ffmpegPath()) ? ffmpegPath() : null)
  if (!ffmpeg) throw new Error('Trimming needs ffmpeg, the free sound and video tool, and it couldn’t be downloaded. Try again in a moment.')
  const ext = extname(full)
  const tmp = `${full.slice(0, -ext.length)}.orbit-trim${ext}`
  // Seeking before -i jumps straight there (exact to the frame when copying), and -t is how long to keep.
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-i', full, '-t', (end - start).toFixed(3), '-map', '0', '-c', 'copy', '-map_metadata', '0']
  if (ext.toLowerCase() === '.mp3') args.push('-id3v2_version', '3', '-write_xing', '1')
  args.push(tmp)
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(ffmpeg, args, { windowsHide: true, timeout: 120_000 }, (err, _out, stderr) => (err ? reject(new Error(stderr.trim().split('\n').pop() || err.message)) : resolve()))
    )
    if (!existsSync(tmp) || (await stat(tmp)).size < 1024) throw new Error('The trimmed song came out empty.')
    // Make sure an MP3 keeps every detail and its cover, whatever ffmpeg carried over.
    if (canTag(full)) {
      const tags = NodeID3.read(full, { noRaw: true })
      if (Object.keys(tags).length && NodeID3.write(tags, tmp) !== true) throw new Error('Its details couldn’t be copied over.')
    }
    await shell.trashItem(full)
    await rename(tmp, full)
  } catch (err) {
    logError('trimming a song', err)
    if (existsSync(tmp)) await shell.trashItem(tmp).catch(() => undefined)
    throw new Error(`Couldn’t trim “${basename(full)}”. ${err instanceof Error ? err.message : String(err)}`)
  }
  return refreshLibrary(true)
}

/** Sound quality and size of each song, to suggest which copy to keep. */
async function quality(paths: string[]): Promise<Record<string, { bitrate: number; size: number }>> {
  const out: Record<string, { bitrate: number; size: number }> = {}
  for (const path of paths.slice(0, 500)) {
    try {
      const full = inFolder(path)
      const [{ format }, info] = await Promise.all([parseFile(full, { duration: false, skipCovers: true }), stat(full)])
      out[path] = { bitrate: Math.round((format.bitrate ?? 0) / 1000), size: info.size }
    } catch {
      // Left out: no suggestion for that one.
    }
  }
  return out
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

export function setupMusicTags(): void {
  ipcMain.handle('musicTags:edit', (_e, changes: { path: string; patch: SongTagPatch }[]) => editTags(Array.isArray(changes) ? changes.filter((c) => c && typeof c.path === 'string' && c.patch) : []))
  ipcMain.handle('musicTags:fillFromNames', (_e, paths: string[]) => fillFromNames(strings(paths)))
  ipcMain.handle('musicTags:setCover', (_e, paths: string[], source: { file?: string; url?: string }) => setCover(strings(paths), { file: source?.file ? String(source.file) : undefined, url: source?.url ? String(source.url) : undefined }))
  ipcMain.handle('musicTags:findCovers', (_e, artist: string, album: string) => findCovers(String(artist ?? ''), String(album ?? '')))
  ipcMain.handle('musicTags:chooseImage', (e) => chooseImage(e))
  ipcMain.handle('musicTags:trim', (_e, path: string, start: number, end: number) => trimSong(String(path), Number(start), Number(end)))
  ipcMain.handle('localMusic:import', (_e, files: string[]) => importFiles(strings(files)))
  ipcMain.handle('localMusic:chooseImport', (e) => chooseImport(e))
  ipcMain.handle('localMusic:move', (_e, moves: { from: string; to: string }[]) => moveFiles(Array.isArray(moves) ? moves.filter((m) => m && typeof m.from === 'string' && typeof m.to === 'string') : []))
  ipcMain.handle('localMusic:trash', (_e, paths: string[]) => trashSongs(strings(paths)))
  ipcMain.handle('localMusic:quality', (_e, paths: string[]) => quality(strings(paths)))
}
