/**
 * The video player's thinking, with no Electron or React in it so it can be tested: which files
 * are videos, reading what ffmpeg says about one, choosing how to play it, and reading subtitle
 * files. The main process (main/videoPlayer.ts) runs ffmpeg; the page is components/Video.
 *
 * How a video plays:
 * - "direct": the window plays the file as it is (MP4, WebM, most MKVs), with normal seeking.
 * - "remux": the picture is fine but the sound (AC3, DTS…) or the container (AVI with H.264) isn't,
 *   so ffmpeg copies the picture untouched and turns only the sound into AAC, as it plays. Cheap.
 * - "transcode": the picture itself needs converting (old AVIs, WMV, FLV…). ffmpeg converts it to
 *   H.264 as it plays.
 * The last two are a live stream with no seeking of their own: the page restarts the stream from
 * the new spot instead.
 */

const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')

/** Every kind of video file the player opens. */
export const VIDEO_EXTS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'asf', 'flv', 'f4v', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg',
  'vob', '3gp', '3g2', 'ogv', 'divx', 'rm', 'rmvb'
]
/** The ones the window can usually play without help. */
const NATIVE_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv']
export const SUBTITLE_EXTS = ['srt', 'vtt', 'ass', 'ssa']

export const isVideoFile = (name: string): boolean => VIDEO_EXTS.includes(extOf(name))
export const isSubtitleFile = (name: string): boolean => SUBTITLE_EXTS.includes(extOf(name))
/** Whether the window might play it with no help (worth trying before ffmpeg is downloaded). */
export const maybeNative = (name: string): boolean => NATIVE_EXTS.includes(extOf(name))

// ---------- what's in a video ----------

export interface VideoTrack {
  /** The stream's number in the file (ffmpeg's 0:N). */
  stream: number
  codec: string
  language: string | null
  title: string | null
  isDefault: boolean
}
export interface AudioTrack extends VideoTrack {
  channels: string | null
}
export interface SubtitleTrack extends VideoTrack {
  /** Text subtitles can be shown; picture ones (Blu-ray PGS, DVD) can't. */
  text: boolean
}

export interface VideoProbe {
  /** ffmpeg's names for the container, e.g. "matroska,webm" or "avi". */
  container: string
  duration: number | null
  /** When the file's clock starts (usually 0; often not for .ts recordings). */
  start: number
  video: { codec: string; width: number; height: number } | null
  audio: AudioTrack[]
  subtitles: SubtitleTrack[]
}

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer', 'subviewer1', 'sami', 'realtext', 'jacosub', 'mpl2', 'pjs', 'vplayer', 'stl'])

const secondsOf = (h: string, m: string, s: string): number => Number(h) * 3600 + Number(m) * 60 + Number(s)

/** Reads what `ffmpeg -i <file>` prints about a file. */
export function parseProbe(log: string): VideoProbe | null {
  const input = /Input #0, ([^\n]+?), from /.exec(log)
  if (!input) return null
  const probe: VideoProbe = { container: input[1], duration: null, start: 0, video: null, audio: [], subtitles: [] }
  const dur = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log)
  if (dur) probe.duration = secondsOf(dur[1], dur[2], dur[3])
  const start = /Duration: [^\n]*?start: (-?\d+(?:\.\d+)?)/.exec(log)
  if (start) probe.start = Number(start[1])

  const lines = log.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?: (Video|Audio|Subtitle): ([^\s,]+)(.*)$/.exec(lines[i])
    if (!m) continue
    const [, n, lang, type, codec, rest] = m
    // Its "Metadata:" block (more indented lines straight after) may name it.
    let title: string | null = null
    const indent = (lines[i].match(/^\s*/)?.[0].length ?? 0) + 1
    for (let j = i + 1; j < lines.length && (lines[j].match(/^\s*/)?.[0].length ?? 0) >= indent && !/Stream #/.test(lines[j]); j++) {
      const t = /^\s*title\s*:\s*(.+)$/.exec(lines[j])
      if (t) title = t[1].trim()
    }
    const base = {
      stream: Number(n),
      codec: codec.toLowerCase(),
      language: lang && lang !== 'und' ? lang : null,
      title,
      isDefault: /\(default\)/.test(rest)
    }
    if (type === 'Video') {
      // Album art and thumbnails show up as a one-picture "video".
      if (probe.video || /\(attached pic\)/.test(rest) || ['mjpeg', 'png', 'bmp'].includes(base.codec)) continue
      const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(rest)
      probe.video = { codec: base.codec, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0 }
    } else if (type === 'Audio') {
      const ch = /, (mono|stereo|\d+\.\d+(?:\([^)]*\))?|\d+ channels)\b/.exec(rest)
      probe.audio.push({ ...base, channels: ch ? ch[1].replace(/\(.*\)$/, '') : null })
    } else {
      probe.subtitles.push({ ...base, text: TEXT_SUBS.has(base.codec) })
    }
  }
  return probe
}

// ---------- how to play it ----------

export type PlayMode = 'direct' | 'remux' | 'transcode'

/** Picture formats the window decodes (HEVC only with the graphics card's help, so it's tried, with a fallback). */
const WINDOW_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora', 'hevc'])
/** Of those, the ones that can be copied untouched into the live MP4 stream. */
const COPYABLE_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9'])
const WINDOW_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const WINDOW_CONTAINERS = ['mov,mp4', 'matroska', 'webm', 'ogg']

/**
 * How to play a file. `audio` is the picked sound track's position in probe.audio; the window
 * itself only ever plays a file's first one, so any other means going through ffmpeg.
 * `failed` says the window already tried and couldn't (so try the next way).
 */
export function playMode(probe: VideoProbe, audio = 0, failed: PlayMode[] = []): PlayMode {
  const v = probe.video
  const a = probe.audio[audio] ?? null
  const containerOk = WINDOW_CONTAINERS.some((c) => probe.container.includes(c))
  const audioOk = !a || WINDOW_AUDIO.has(a.codec)
  const videoOk = !v || WINDOW_VIDEO.has(v.codec)
  if (containerOk && videoOk && audioOk && audio === 0 && !failed.includes('direct')) return 'direct'
  // HEVC the window already couldn't show won't show copied either: it gets converted.
  const copyable = !!v && COPYABLE_VIDEO.has(v.codec) && !(v.codec === 'hevc' && failed.includes('direct'))
  if (copyable && !failed.includes('remux')) return 'remux'
  return 'transcode'
}

export interface StreamOptions {
  mode: Exclude<PlayMode, 'direct'>
  /** Seconds into the video to start from. */
  start: number
  /** The picked sound track's position in probe.audio. */
  audio: number
  /** Converted pictures are kept no taller than this (so 4K converts fast enough to watch). */
  maxHeight?: number
}

/** ffmpeg's arguments for the live stream (written to its output, as fragmented MP4). */
export function streamArgs(file: string, opts: StreamOptions): string[] {
  const start = Math.max(0, opts.start)
  const video =
    opts.mode === 'remux'
      ? ['-c:v', 'copy']
      : [
          '-vf', `scale=-2:'min(ih,${opts.maxHeight ?? 1080})'`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'film', '-crf', '20', '-pix_fmt', 'yuv420p',
          // A keyframe every couple of seconds keeps the stream starting quickly.
          '-g', '48'
        ]
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
    '-i', file,
    '-map', '0:v:0?', '-map', `0:a:${Math.max(0, Math.floor(opts.audio))}?`,
    ...video,
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-sn', '-dn',
    '-max_muxing_queue_size', '1024',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ]
}

/**
 * Copying the picture can only start on a keyframe, so a remuxed stream starts at the keyframe
 * just before where you asked. This asks ffmpeg where that is (it prints the first packet's time).
 */
export function keyframeArgs(file: string, at: number): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', Math.max(0, at).toFixed(3), '-i', file, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-copyts', '-f', 'framemd5', '-']
}

/** The first packet's time in seconds, from ffmpeg's framemd5 output. */
export function parseKeyframe(out: string): number | null {
  const tb = /#tb 0: (\d+)\/(\d+)/.exec(out)
  const row = /^0,\s*-?\d+,\s*(-?\d+),/m.exec(out)
  if (!tb || !row) return null
  return (Number(row[1]) * Number(tb[1])) / Number(tb[2])
}

/** Arguments that turn one of a video's own subtitle tracks into WebVTT text. */
export function subtitleArgs(file: string, stream: number): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-map', `0:${stream}`, '-f', 'webvtt', 'pipe:1']
}

// ---------- names ----------

const LANGUAGES: Record<string, string> = {
  eng: 'English', en: 'English', jpn: 'Japanese', ja: 'Japanese', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian',
  kor: 'Korean', ko: 'Korean', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', ara: 'Arabic', hin: 'Hindi', dut: 'Dutch', nld: 'Dutch',
  pol: 'Polish', tur: 'Turkish', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew',
  tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', ukr: 'Ukrainian', cze: 'Czech', ces: 'Czech', hun: 'Hungarian', rum: 'Romanian', ron: 'Romanian'
}

export const languageName = (code: string | null): string | null => (code ? (LANGUAGES[code.toLowerCase()] ?? code.toUpperCase()) : null)

const CODEC_NAMES: Record<string, string> = { ac3: 'Dolby', eac3: 'Dolby+', truehd: 'TrueHD', dts: 'DTS', aac: 'AAC', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', vorbis: 'Vorbis' }

/** "English · 5.1 · Dolby", "Japanese 2.0", "Track 2". */
export function trackLabel(track: AudioTrack | SubtitleTrack, i: number): string {
  const lang = languageName(track.language)
  const parts: string[] = []
  if (track.title && (!lang || !track.title.toLowerCase().includes(lang.toLowerCase()))) parts.push(...(lang ? [lang] : []), track.title)
  else parts.push(track.title ?? lang ?? `Track ${i + 1}`)
  if ('channels' in track && track.channels && track.channels !== 'mono' && track.channels !== 'stereo') parts.push(track.channels)
  if ('channels' in track && CODEC_NAMES[track.codec]) parts.push(CODEC_NAMES[track.codec])
  return parts.join(' · ')
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// ---------- subtitles ----------

export interface Cue {
  start: number
  end: number
  text: string
}

/** "00:01:02,500", "01:02.5", "0:01:02.50" → seconds. */
function cueTime(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/.exec(text.trim())
  if (!m) return null
  const frac = m[4] ? Number(`0.${m[4]}`) : 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac
}

/** Subtitles are shown as plain text: formatting tags and ASS styling codes are taken out. */
function cleanText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

/** SRT and WebVTT (they're nearly the same). */
function parseTimed(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const [from, rest] = lines[at].split('-->')
    const start = cueTime(from)
    // VTT puts cue settings ("align:start") after the end time.
    const end = cueTime(rest.trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null) continue
    const body = cleanText(lines.slice(at + 1).join('\n'))
    if (body) cues.push({ start, end, text: body })
  }
  return cues
}

/** Advanced SubStation (.ass/.ssa): the Dialogue lines under [Events]. */
function parseAss(text: string): Cue[] {
  const cues: Cue[] = []
  let format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  let inEvents = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^\[.*\]$/.test(t)) {
      inEvents = /^\[events\]$/i.test(t)
      continue
    }
    if (!inEvents) continue
    if (/^format:/i.test(t)) {
      format = t.slice(t.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    if (!/^dialogue:/i.test(t)) continue
    const fields = t.slice(t.indexOf(':') + 1).split(',')
    const textAt = format.indexOf('text')
    // The text is the last field and may itself contain commas.
    const values = [...fields.slice(0, textAt), fields.slice(textAt).join(',')].map((v) => v.trim())
    const start = cueTime(values[format.indexOf('start')] ?? '')
    const end = cueTime(values[format.indexOf('end')] ?? '')
    const body = cleanText(values[textAt] ?? '')
    if (start !== null && end !== null && body) cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** Reads a subtitle file (SRT, WebVTT, ASS/SSA) into cues, in time order. */
export function parseSubtitles(text: string, name = ''): Cue[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const ext = extOf(name)
  const cues = ext === 'ass' || ext === 'ssa' || /^\s*\[script info\]/i.test(clean) ? parseAss(clean) : parseTimed(clean)
  return cues.sort((a, b) => a.start - b.start)
}

/** The cues on screen at `time` (usually one; overlapping ones are stacked). */
export function cuesAt(cues: Cue[], time: number): Cue[] {
  // Binary search for the last cue starting at or before `time`, then look back for overlaps.
  let lo = 0
  let hi = cues.length - 1
  let last = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= time) {
      last = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const on: Cue[] = []
  for (let i = last; i >= 0 && i > last - 20; i--) if (cues[i].end > time) on.unshift(cues[i])
  return on
}

/** Subtitle files beside a video that belong to it: "Film.srt", "Film.en.srt", "Film.English.forced.ass". */
export function matchingSubtitles(video: string, names: string[]): string[] {
  const dot = video.lastIndexOf('.')
  const base = (dot > 0 ? video.slice(0, dot) : video).toLowerCase()
  return names
    .filter((n) => isSubtitleFile(n))
    .filter((n) => {
      const lower = n.toLowerCase()
      const stem = lower.slice(0, lower.lastIndexOf('.'))
      return stem === base || stem.startsWith(`${base}.`) || stem.startsWith(`${base} `) || stem.startsWith(`${base}_`)
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
}

// ---------- carrying on where you stopped ----------

/** Where to carry on from, or null to start at the beginning (barely started, or as good as finished). */
export function resumePoint(saved: number | undefined, duration: number | null | undefined): number | null {
  if (!saved || saved < 10) return null
  if (duration && duration > 0 && saved > duration - Math.max(20, duration * 0.03)) return null
  return saved
}

/** Watched to the end (or into the credits), so the next play starts again. */
export const isFinished = (at: number, duration: number | null | undefined): boolean =>
  !!duration && duration > 0 && at > duration - Math.max(20, duration * 0.03)

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** The next speed up or down from `speed`. */
export function stepSpeed(speed: number, dir: 1 | -1): number {
  if (dir > 0) return SPEEDS.find((s) => s > speed + 0.001) ?? SPEEDS[SPEEDS.length - 1]
  return [...SPEEDS].reverse().find((s) => s < speed - 0.001) ?? SPEEDS[0]
}

// ---------- addresses ----------

/** Where the window plays a file as it is (vault://video/…, served from disk with seeking). */
export const videoUrl = (path: string): string => `vault://video/${encodeURIComponent(path)}`

/** Where the window plays ffmpeg's live stream of a file, starting `start` seconds in. */
export const videoStreamUrl = (path: string, opts: StreamOptions & { session: string }): string =>
  `vault://videostream/${encodeURIComponent(path)}?mode=${opts.mode}&start=${opts.start.toFixed(3)}&audio=${opts.audio}&s=${encodeURIComponent(opts.session)}`

/** What the main process says about a video when it's opened. */
export interface VideoInfo {
  path: string
  name: string
  size: number
  /** Null when ffmpeg isn't downloaded yet (or couldn't read it). */
  probe: VideoProbe | null
  /** Subtitle files beside it ("Film.srt", "Film.en.srt"), full paths. */
  subtitleFiles: string[]
}
