/**
 * The soundboard's "From a link": paste a YouTube or TikTok link, Orbit downloads just its sound
 * (with the video downloader), you pick the part you want on a waveform, and that part becomes a
 * soundboard button. These are the plain rules (no Electron), so they can be tested.
 */

/** The longest part that can be made into a button (it's a soundboard, not a music player). */
export const MAX_PART_SECONDS = 120
/** What's picked to start with, from the beginning. */
export const FIRST_PART_SECONDS = 8

/**
 * Keeps a picked part inside the sound, at least a tenth of a second and at most MAX_PART_SECONDS
 * long. `keep` is the end that was just moved: when the part is too long, the other end follows it.
 */
export function cleanPart(start: number, end: number, duration: number, keep: 'start' | 'end' = 'start'): { start: number; end: number } {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0
  let s = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), Math.max(0, d - 0.1))
  let e = Math.min(d, Math.max(Number.isFinite(end) ? end : d, s + 0.1))
  if (e - s > MAX_PART_SECONDS) {
    if (keep === 'start') e = s + MAX_PART_SECONDS
    else s = e - MAX_PART_SECONDS
  }
  return { start: round(s), end: round(e) }
}

const round = (n: number): number => Math.round(n * 1000) / 1000

/** The first part offered: the first few seconds (or all of a short sound). */
export const firstPart = (duration: number): { start: number; end: number } => cleanPart(0, Math.min(duration, FIRST_PART_SECONDS), duration)

/**
 * ffmpeg's options to cut a part out of the downloaded sound and save it as an MP3 for the board.
 * A very short fade at each end stops a click where it was cut.
 */
export function partArgs(input: string, start: number, end: number, output: string): string[] {
  const length = Math.max(0.1, end - start)
  const fade = Math.min(0.03, length / 4)
  const num = (n: number): string => String(Math.round(n * 1000) / 1000)
  return [
    '-ss',
    num(Math.max(0, start)),
    '-t',
    num(length),
    '-i',
    input,
    '-vn',
    '-af',
    `afade=t=in:st=0:d=${num(fade)},afade=t=out:st=${num(Math.max(0, length - fade))}:d=${num(fade)}`,
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    output
  ]
}

/** A name for the button from the video's title: shorter, without "(Official Video)" and hashtags. */
export function nameFromTitle(title: string): string {
  const clean = String(title ?? '')
    .replace(/[([](official[^)\]]*|lyrics?[^)\]]*|hd|4k|audio)[)\]]/gi, '')
    .replace(/#[A-Za-z]\w*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > 40 ? `${clean.slice(0, 39).trimEnd()}…` : clean || 'Sound'
}

/** Seconds as "0:07.5" or "1:02.0", for the part's start and end. */
export function partTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}
