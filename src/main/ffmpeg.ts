import { app, net } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import type { FfmpegState } from '@shared/types'
import { logError } from './log'

/**
 * ffmpeg, the program that converts videos (and that the Studio streams with). It isn't part of
 * Orbit: it's downloaded only when you ask, from a fixed release whose SHA-256 is checked before
 * it's used, into Orbit's own folder. One copy serves every feature that needs it.
 */

/** Static builds with x264, VP9, AAC, Opus and MP3: https://github.com/eugeneware/ffmpeg-static (release b6.0). */
const FFMPEG_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0'
const FFMPEG_BUILDS: Record<string, { sha256: string; bytes: number }> = {
  'win32-x64': { sha256: '450d66226c79405c724e821f291cab0911e934bfa9fa2231adcab587f3e07b50', bytes: 28_894_894 },
  'darwin-arm64': { sha256: '6be74d6f449889c2e87a75873894f8520cad56c08ac76f2a628d85b0519daaca', bytes: 19_253_088 },
  'darwin-x64': { sha256: 'a12354fce7eb62361473bbe10d53a1893695babd35869ec8e92e5dfea8d0440b', bytes: 25_067_704 }
}
const BUILD = `${process.platform}-${process.arch}`

export const ffmpegDir = (): string => join(app.getPath('userData'), 'ffmpeg')
export const ffmpegPath = (): string => join(ffmpegDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

let download: { progress: number; error?: string; done?: Promise<void> } | null = null
const listeners = new Set<(state: FfmpegState) => void>()

export function ffmpegState(): FfmpegState {
  if (download && !download.error) return { state: 'downloading', progress: download.progress }
  if (existsSync(ffmpegPath())) return { state: 'ready' }
  if (!FFMPEG_BUILDS[BUILD]) return { state: 'unsupported' }
  return { state: 'missing', error: download?.error }
}

/** Calls back whenever ffmpeg's state changes (download progress, done, failed). */
export function onFfmpegState(listener: (state: FfmpegState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const tell = (): void => {
  const state = ffmpegState()
  for (const l of listeners) l(state)
}

async function fetchFfmpeg(build: { sha256: string; bytes: number }): Promise<void> {
  mkdirSync(ffmpegDir(), { recursive: true })
  const tmp = `${ffmpegPath()}.part`
  try {
    const res = await net.fetch(`${FFMPEG_RELEASE}/ffmpeg-${BUILD}.gz`)
    if (!res.ok || !res.body) throw new Error(`The download didn’t work (${res.status}).`)
    const hash = createHash('sha256')
    let got = 0
    let lastSent = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk)
        got += chunk.length
        const progress = Math.min(1, got / build.bytes)
        if (download && progress - lastSent > 0.01) {
          download.progress = progress
          lastSent = progress
          tell()
        }
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createGunzip(), createWriteStream(tmp))
    if (hash.digest('hex') !== build.sha256) throw new Error('The download was damaged or changed, so it wasn’t used. Try again.')
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    renameSync(tmp, ffmpegPath())
    // Apple Silicon only runs signed programs: sign it "ad hoc", like Orbit itself.
    if (process.platform === 'darwin') await new Promise<void>((resolve) => execFile('codesign', ['--force', '--sign', '-', ffmpegPath()], () => resolve()))
    rmSync(join(app.getPath('userData'), 'ffmpeg-wanted'), { force: true })
    download = null
  } catch (err) {
    rmSync(tmp, { force: true })
    download = { progress: 0, error: err instanceof Error ? err.message : String(err) }
    logError('ffmpeg download', err)
  } finally {
    tell()
  }
}

/** Downloads ffmpeg (once, however many times it's asked for at the same time). */
export async function downloadFfmpeg(): Promise<FfmpegState> {
  if (existsSync(ffmpegPath())) return ffmpegState()
  const build = FFMPEG_BUILDS[BUILD]
  if (!build) return ffmpegState()
  if (!download?.done || download.error) {
    download = { progress: 0 }
    download.done = fetchFfmpeg(build)
    tell()
  }
  await download.done
  return ffmpegState()
}
