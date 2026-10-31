import type { SaveFormat } from '@shared/types'

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
