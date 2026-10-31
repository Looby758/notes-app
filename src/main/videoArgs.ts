import type { GifSettings, SaveFormat } from '@shared/types'

/** What ffmpeg is told for each kind of file a video can become. */
export function videoArgs(format: SaveFormat, maxHeight: number | null): string[] {
  // -2 keeps the width even, which most video formats need; never makes a video bigger.
  const scale = maxHeight ? `scale=-2:'min(ih,${maxHeight})'` : null
  const vf = (filters: (string | null)[]): string[] => {
    const list = filters.filter(Boolean)
    return list.length ? ['-vf', list.join(',')] : []
  }
  // H.264 and AAC: plays on every phone, computer and website.
  const h264 = [...vf([scale]), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k']
  switch (format) {
    case 'mp4':
      return [...h264, '-movflags', '+faststart']
    case 'mov':
      return h264
    case 'webm':
      return [...vf([scale]), '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k']
    case 'gif': {
      // GIFs get big fast: 12 frames a second, and 480 pixels wide unless a smaller size was picked.
      const size = maxHeight ? `scale=-2:'min(ih,${maxHeight})':flags=lanczos` : `scale='min(iw,480)':-2:flags=lanczos`
      return ['-filter_complex', `fps=12,${size},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', '-an']
    }
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k']
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le']
    default:
      throw new Error('Videos can’t be turned into that.')
  }
}

/** Seconds in an ffmpeg time like "01:02:03.45". */
export function parseTime(text: string): number | null {
  const m = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

const PALETTE = 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'
const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
const num = (n: number): string => String(Math.round(n * 1000) / 1000)

/**
 * Everything ffmpeg is told to make a GIF in the GIF maker, inputs included: just the chosen part
 * of the video, cropped, sped up or slowed down, and with the caption bar (a picture) stacked on.
 */
export function gifMakerArgs(input: string, gif: GifSettings, captionFile: string | null, captionHeight = 0): string[] {
  const start = Math.max(0, gif.start)
  const length = Math.max(0.1, gif.end - start)
  const speed = Math.min(4, Math.max(0.25, gif.speed || 1))
  const fps = Math.min(30, Math.max(5, Math.round(gif.fps || 12)))
  const width = even(Math.min(1280, Math.max(64, gif.width)))
  const video = [
    gif.crop && `crop=${even(gif.crop.w)}:${even(gif.crop.h)}:${Math.max(0, Math.round(gif.crop.x))}:${Math.max(0, Math.round(gif.crop.y))}`,
    speed !== 1 && `setpts=PTS/${num(speed)}`,
    `fps=${fps}`,
    `scale=${width}:-2:flags=lanczos`,
    'format=rgb24'
  ]
    .filter(Boolean)
    .join(',')
  const inputs = ['-ss', num(start), '-t', num(length), '-i', input]
  if (!captionFile || !captionHeight) return [...inputs, '-filter_complex', `[0:v]${video},${PALETTE}`, '-loop', '0', '-an']
  // Room is made for the bar, then the caption picture is laid over it (it stays for every frame).
  const bar = Math.round(captionHeight)
  const top = gif.caption?.position !== 'bottom'
  const pad = top ? `pad=iw:ih+${bar}:0:${bar}` : `pad=iw:ih+${bar}:0:0`
  const at = top ? '0:0' : `0:main_h-${bar}`
  return [
    ...inputs,
    '-i',
    captionFile,
    '-filter_complex',
    `[0:v]${video},${pad}[v];[1:v]scale=${width}:${bar},format=rgb24[c];[v][c]overlay=${at}:format=rgb,${PALETTE}`,
    '-loop',
    '0',
    '-an'
  ]
}

/** How long the GIF maker's GIF lasts, in seconds (for its progress). */
export const gifLength = (gif: GifSettings): number => Math.max(0.1, gif.end - Math.max(0, gif.start)) / Math.min(4, Math.max(0.25, gif.speed || 1))
