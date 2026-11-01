import { createReadStream, statSync, type ReadStream } from 'fs'
import { extname, resolve, sep } from 'path'
import { Readable } from 'stream'

/**
 * Letting go of files. While Orbit has a file open (a video playing, a comic being read, a song,
 * a preview), Windows won't let anything delete or move it, and says Orbit is using it. Every
 * viewer that keeps a file open registers here how to let go of it, so closing a viewer, or
 * deleting, renaming or moving the file in Orbit, frees it straight away instead of only when
 * Orbit quits.
 */

type Releaser = (covers: (path: string) => boolean) => void | Promise<void>

const releasers = new Set<Releaser>()

/** How a viewer lets go of the files it has open (it's handed a test for which ones). */
export function onRelease(fn: Releaser): void {
  releasers.add(fn)
}

/** Windows and Macs don't mind capitals in file names. */
const norm = (p: string): string => {
  const full = resolve(p)
  return process.platform === 'linux' ? full : full.toLowerCase()
}

/** True when `path` is one of `targets`, or inside one of them (a folder). */
export function covers(targets: string[], path: string): boolean {
  const p = norm(path)
  return targets.some((t) => {
    const n = norm(t)
    return p === n || p.startsWith(n.endsWith(sep) ? n : n + sep)
  })
}

/** Has every viewer let go of these files (and anything in these folders). */
export async function releaseFiles(paths: string | string[]): Promise<void> {
  const targets = (Array.isArray(paths) ? paths : [paths]).filter((p): p is string => typeof p === 'string' && !!p)
  if (!targets.length) return
  const test = (path: string): boolean => covers(targets, path)
  await Promise.all([...releasers].map((fn) => Promise.resolve(fn(test)).catch(() => undefined)))
}

// ---------- files read in pieces ----------

const reading = new Map<ReadStream, string>()

/** Waits (briefly) for a stream's file to really be closed. */
function closed(s: ReadStream): Promise<void> {
  if (s.closed) return Promise.resolve()
  return new Promise((done) => {
    const t = setTimeout(done, 1000)
    s.once('close', () => (clearTimeout(t), done()))
  })
}

/** A file read that Orbit can stop (and close) when the file needs letting go. */
export function trackedReadStream(full: string, opts: { start?: number; end?: number } = {}): ReadStream {
  const s = createReadStream(full, opts)
  reading.set(s, full)
  s.once('close', () => reading.delete(s))
  return s
}

/** How many files are being read right now (for the tests). */
export const openReads = (): number => reading.size

onRelease(async (test) => {
  const stopping: Promise<void>[] = []
  for (const [s, full] of reading) {
    if (!test(full)) continue
    reading.delete(s)
    s.destroy()
    stopping.push(closed(s))
  }
  await Promise.all(stopping)
})

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12'
}

export const contentType = (full: string): string => TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream'

/**
 * A file for the window, in pieces as it asks for them ("Range" requests, which let a video or song
 * jump around), read in a way Orbit can stop when the file needs letting go.
 */
export function serveFile(full: string, range: string | null, extraHeaders: Record<string, string> = {}): Response {
  const size = statSync(full).size
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  let start = 0
  let end = size - 1
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1])
      if (m[2]) end = Math.min(size - 1, Number(m[2]))
    } else start = Math.max(0, size - Number(m[2]))
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, ...extraHeaders } })
  }
  const body = size ? (Readable.toWeb(trackedReadStream(full, { start, end })) as unknown as ReadableStream<Uint8Array>) : null
  const headers: Record<string, string> = { 'Content-Type': contentType(full), 'Content-Length': String(size ? end - start + 1 : 0), 'Accept-Ranges': 'bytes', ...extraHeaders }
  if (!m || !size) return new Response(body, { status: 200, headers })
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } })
}
