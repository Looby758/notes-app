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
export function clipFileName(kind: 'Replay' | 'Clip' | 'Call clip', date: Date, ext: string): string {
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

/**
 * The bytes a video player asked for ("Range: bytes=1000-" when you jump to a moment), as
 * inclusive positions. null: the whole file. 'bad': a range outside the file.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'bad' {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start >= size || start > end ? 'bad' : { start, end }
}

// ---------- clips sorted by game ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A game's name as a folder name: nothing Windows or a Mac can't use in a name, no dots or spaces
 * at the ends, not too long. '' when nothing is left.
 */
export function cleanFolderName(name: string): string {
  const clean = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim()
  // Names Windows keeps for itself.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `${clean} clips` : clean
}

/**
 * A replay saved while a game was running: "SkyBlock 21 Nov 23.10.mp4". Shown as
 * "SkyBlock 21 Nov 23:10" (see clipTitle): a colon can't be in a file name on Windows.
 */
export function gameClipName(game: string, date: Date, ext: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${cleanFolderName(game) || 'Game'} ${date.getDate()} ${MONTHS[date.getMonth()]} ${p(date.getHours())}.${p(date.getMinutes())}.${ext}`
}

/** What a clip is called in the list: its file name without the type, with "23.10" shown as "23:10". */
export function clipTitle(fileName: string): string {
  const base = fileName.replace(/\.\w+$/, '')
  return base.replace(/^(.+ \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)) (\d{2})\.(\d{2})(?=$| )/, '$1 $2:$3')
}

/** The name of an edited copy of a clip: "SkyBlock 21 Nov 23.10 (edit).mp4". */
export function editedClipName(fileName: string): string {
  return `${fileName.replace(/\.\w+$/, '').replace(/ \(edit\)( \(\d+\))?$/, '')} (edit).mp4`
}

/**
 * What Orbit remembers about the recordings folder, kept in it as ".orbit-clips.json" (so it moves
 * with the folder): which sub-folders are clip folders (Orbit made them, so a Studio take folder
 * isn't mistaken for one), which game goes in which folder (renaming "Minecraft" to "SkyBlock"
 * keeps new clips going there), and the starred clips.
 */
export interface ClipsMeta {
  /** Sub-folder names that hold clips. */
  folders: string[]
  /** A game's name (as the Games page knows it) → its folder. */
  games: Record<string, string>
  /** Starred clips, as "Folder/file.mp4" or "file.mp4" (top of the folder). */
  favourites: string[]
}

export const EMPTY_CLIPS_META: ClipsMeta = { folders: [], games: {}, favourites: [] }

/** Reads .orbit-clips.json, fixing anything missing or wrong instead of failing. */
export function cleanClipsMeta(raw: unknown): ClipsMeta {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const folders = Array.isArray(o.folders) ? [...new Set(o.folders.filter((f): f is string => typeof f === 'string').map(cleanFolderName).filter(Boolean))] : []
  const games: Record<string, string> = {}
  if (o.games && typeof o.games === 'object') {
    for (const [game, folder] of Object.entries(o.games as Record<string, unknown>)) {
      const f = typeof folder === 'string' ? cleanFolderName(folder) : ''
      if (game && f && folders.includes(f)) games[game.slice(0, 120)] = f
    }
  }
  const favourites = Array.isArray(o.favourites) ? [...new Set(o.favourites.filter((f): f is string => typeof f === 'string' && !!clipRelPath(f)))] : []
  return { folders, games, favourites }
}

/**
 * A clip's place in the recordings folder ("file.mp4" or "Folder/file.mp4"), or null for anything
 * else (deeper, "..", a backslash): only these can be played, changed or starred.
 */
export function clipRelPath(rel: string): string | null {
  if (typeof rel !== 'string' || rel.includes('\\')) return null
  const parts = rel.split('/')
  if (parts.length > 2 || parts.some((p) => !p || p === '.' || p === '..')) return null
  if (parts.length === 2 && cleanFolderName(parts[0]) !== parts[0]) return null
  return isClipFile(parts[parts.length - 1]) ? rel : null
}

/** The folder a game's replays go in: the one it was given, or one named after it. */
export function folderForGame(meta: ClipsMeta, game: string): string {
  return meta.games[game] ?? (cleanFolderName(game) || 'Game')
}

/** Remembers a game's folder (made the first time one of its replays is saved). */
export function withGameFolder(meta: ClipsMeta, game: string, folder: string): ClipsMeta {
  return { ...meta, folders: meta.folders.includes(folder) ? meta.folders : [...meta.folders, folder], games: { ...meta.games, [game]: folder } }
}

/** Stars or unstars a clip. */
export function withFavourite(meta: ClipsMeta, rel: string, on: boolean): ClipsMeta {
  const rest = meta.favourites.filter((f) => f !== rel)
  return { ...meta, favourites: on ? [...rest, rel] : rest }
}

/** A folder was renamed: its games, stars and name follow it. */
export function withRenamedFolder(meta: ClipsMeta, from: string, to: string): ClipsMeta {
  const games: Record<string, string> = {}
  for (const [g, f] of Object.entries(meta.games)) games[g] = f === from ? to : f
  return {
    folders: [...new Set(meta.folders.map((f) => (f === from ? to : f)))],
    games,
    favourites: meta.favourites.map((f) => (f.startsWith(`${from}/`) ? `${to}/${f.slice(from.length + 1)}` : f))
  }
}

/** A clip moved (to another folder, or ''), so its star moves with it. */
export function withMovedClip(meta: ClipsMeta, from: string, to: string): ClipsMeta {
  return { ...meta, favourites: meta.favourites.map((f) => (f === from ? to : f)) }
}
