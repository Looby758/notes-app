/**
 * Instant replay and the clip editor (lib/replay.ts, main/clips.ts, components/Clips). This file
 * is the plain rules and maths, with no Electron or DOM, so it can be tested.
 *
 * Instant replay keeps recording the screen in short pieces ("segments"), each a complete little
 * video, and forgets the old ones. Pressing the key joins the newest pieces into one file. Starting
 * every piece on a fresh keyframe is what lets ffmpeg join them without re-encoding, so saving is
 * near-instant even in the middle of a game.
 */

/** How long each piece of the replay buffer is. Shorter pieces trim closer to the asked-for length. */
export const SEGMENT_MS = 5000

export interface ReplaySegment {
  /** When this piece started and stopped (Date.now() times). */
  start: number
  end: number
}

/**
 * The pieces worth keeping: the newest ones that together cover at least `seconds` (counting back
 * from the newest piece's end). The rest can be thrown away. Returned oldest first.
 */
export function segmentsToKeep<T extends ReplaySegment>(segments: T[], seconds: number): T[] {
  if (!segments.length) return []
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const until = sorted[sorted.length - 1].end - Math.max(1, seconds) * 1000
  let from = sorted.length - 1
  while (from > 0 && sorted[from].start > until) from--
  return sorted.slice(from)
}

/** How many seconds a set of pieces covers. */
export const segmentsLength = (segments: ReplaySegment[]): number => segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0) / 1000

/** "Replay 2026-10-31 14-05-09.mp4" or "Clip …" (no colons: Windows doesn't allow them). */
export function clipFileName(kind: 'Replay' | 'Clip', date: Date, ext: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${kind} ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.${ext}`
}

/** The videos the clip editor lists and can play. */
export const CLIP_TYPES = ['.mp4', '.webm', '.mov', '.m4v']
export const isClipFile = (name: string): boolean => CLIP_TYPES.some((t) => name.toLowerCase().endsWith(t)) && !name.startsWith('.')

/** The list ffmpeg's concat reader takes: one `file '…'` line a piece, with quotes escaped. */
export function concatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

// ---------- the clip editor ----------

export type CaptionPosition = 'top' | 'bottom'

export interface ClipExport {
  /** The video, as listed by the clip editor. */
  path: string
  /** The part to keep, in seconds. */
  start: number
  end: number
  /** The caption as a picture (a transparent PNG exactly as wide as the video), laid over the video. */
  captionPng?: Uint8Array
  captionPosition?: CaptionPosition
  /** Small enough to send to Discord (see DISCORD_LIMIT). */
  forDiscord?: boolean
}

/**
 * Discord's upload limit without Nitro or a boosted server is 10 MB. Clips aim a little under it,
 * since a video's size can only be estimated before it's made.
 */
export const DISCORD_LIMIT = 10_000_000
const DISCORD_TARGET = 9_200_000

const num = (n: number): string => String(Math.round(n * 1000) / 1000)

/**
 * What a clip for Discord is made at: the video's bits per second (in kbit/s) and height. Longer
 * clips get fewer bits, so they're made smaller to still look sharp. `scale` (below 1) is for a
 * second try when the first came out too big.
 */
export function discordSettings(seconds: number, scale = 1): { videoKbps: number; audioKbps: number; height: number } {
  const length = Math.max(1, seconds)
  const audioKbps = length > 60 ? 64 : 128
  const total = ((DISCORD_TARGET * 8) / length / 1000) * scale
  const videoKbps = Math.max(150, Math.min(8000, Math.floor(total - audioKbps)))
  const height = videoKbps >= 3500 ? 1080 : videoKbps >= 1500 ? 720 : videoKbps >= 700 ? 480 : 360
  return { videoKbps, audioKbps, height }
}

/** Everything ffmpeg is told to make a clip (inputs included), except the output file at the end. */
export function clipArgs(input: string, clip: Pick<ClipExport, 'start' | 'end' | 'captionPosition' | 'forDiscord'>, captionFile: string | null, scale = 1): string[] {
  const start = Math.max(0, clip.start)
  const length = Math.max(0.1, clip.end - start)
  const discord = clip.forDiscord ? discordSettings(length, scale) : null
  const inputs = ['-ss', num(start), '-t', num(length), '-i', input]
  if (captionFile) inputs.push('-i', captionFile)
  // Never made bigger than it was; -2 keeps the width even, which H.264 needs.
  const size = discord ? `scale=-2:'min(ih,${discord.height})'` : null
  let filter: string[]
  if (captionFile) {
    // The caption picture is made as wide as the video (components/Clips), so it's just laid on top.
    const at = clip.captionPosition === 'top' ? '0' : 'main_h-overlay_h'
    const chain = `[0:v][1:v]overlay=(main_w-overlay_w)/2:${at}:format=auto${size ? `,${size}` : ''},format=yuv420p[out]`
    filter = ['-filter_complex', chain, '-map', '[out]', '-map', '0:a?']
  } else {
    filter = [...(size ? ['-vf', `${size},format=yuv420p`] : ['-pix_fmt', 'yuv420p']), '-map', '0:v:0', '-map', '0:a?']
  }
  const video = discord
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${discord.videoKbps}k`, '-maxrate', `${Math.round(discord.videoKbps * 1.2)}k`, '-bufsize', `${discord.videoKbps * 2}k`]
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
  const audio = ['-c:a', 'aac', '-b:a', `${discord ? discord.audioKbps : 192}k`]
  return [...inputs, ...filter, ...video, ...audio, '-movflags', '+faststart']
}

/** How long a clip is, in seconds (for its progress bar). */
export const clipLength = (clip: Pick<ClipExport, 'start' | 'end'>): number => Math.max(0.1, clip.end - Math.max(0, clip.start))

/** Keeps a trim inside the video and at least a tenth of a second long. */
export function cleanTrim(start: number, end: number, duration: number): { start: number; end: number } {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0
  const s = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), Math.max(0, d - 0.1))
  const e = Math.max(s + 0.1, Math.min(d || s + 0.1, Number.isFinite(end) ? end : d))
  return { start: s, end: e }
}

// ---------- Discord ----------

/**
 * A Discord webhook: a channel's private posting address, made in Discord under Server Settings →
 * Integrations → Webhooks (or a channel's Edit Channel → Integrations). Only real Discord addresses
 * are accepted, so a saved clip can never be sent anywhere else.
 */
export function cleanWebhookUrl(url: string): string | null {
  const m = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,120})\/?$/.exec(url.trim())
  return m ? `https://discord.com/api/webhooks/${m[1]}/${m[2]}` : null
}

export interface DiscordHook {
  id: string
  /** What you called it ("#clips on my server"). */
  name: string
}

/** A message Discord accepts with a file: at most 2000 characters, and no surprise @everyone pings. */
export function discordPayload(message: string): string {
  return JSON.stringify({ content: message.trim().slice(0, 2000), allowed_mentions: { parse: [] } })
}

/** Megabytes, for showing a size: "8.4 MB". */
export const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
