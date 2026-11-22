/**
 * Big file sender: the parts with no Electron in them, so they can be tested on their own.
 *
 * A send gets a code like `4821-tiger-piano-river`. The number is the meeting room on the intro
 * server (main/fileSend.ts, server/file-sender). The words never leave the two computers: they make
 * the key that locks every setting-up message, so the intro server only ever passes on locked
 * messages it can't read or change. The file itself goes straight between the computers (or through
 * the relay, still locked) over WebRTC.
 */

/** 256 short, easy-to-say words: 8 bits each. */
export const CODE_WORDS = [
  'acorn', 'actor', 'adult', 'agent', 'album', 'alien', 'alley', 'amber', 'angel', 'ankle', 'apple', 'apron', 'arrow', 'atlas', 'attic', 'award',
  'bacon', 'badge', 'baker', 'banjo', 'beach', 'beard', 'berry', 'bison', 'blade', 'blank', 'bloom', 'board', 'bonus', 'boots', 'brain', 'brick',
  'bride', 'brook', 'brush', 'bunny', 'cabin', 'cable', 'camel', 'candy', 'canoe', 'cargo', 'chalk', 'charm', 'chess', 'chief', 'chili', 'cider',
  'cliff', 'clock', 'cloud', 'clown', 'coast', 'cobra', 'comet', 'coral', 'couch', 'crane', 'crown', 'cubic', 'curry', 'daisy', 'dance', 'delta',
  'denim', 'diary', 'diner', 'disco', 'dodge', 'donut', 'dough', 'draft', 'drama', 'dream', 'drift', 'drill', 'eagle', 'earth', 'elbow', 'ember',
  'emoji', 'event', 'fable', 'fairy', 'feast', 'fence', 'ferry', 'fever', 'field', 'flame', 'flash', 'flute', 'focus', 'forge', 'frame', 'frost',
  'fruit', 'fudge', 'gecko', 'genie', 'ghost', 'giant', 'glass', 'globe', 'glove', 'goose', 'grape', 'grass', 'gravy', 'guard', 'guide', 'habit',
  'harp', 'hazel', 'heart', 'hedge', 'honey', 'horse', 'hotel', 'house', 'igloo', 'image', 'index', 'ivory', 'jelly', 'jewel', 'joker', 'juice',
  'kayak', 'kebab', 'kite', 'koala', 'label', 'lake', 'lamp', 'laser', 'lemon', 'level', 'light', 'lilac', 'linen', 'llama', 'lodge', 'lotus',
  'lunar', 'magic', 'mango', 'maple', 'march', 'medal', 'melon', 'metal', 'meter', 'mint', 'model', 'money', 'moose', 'motor', 'mouse', 'movie',
  'music', 'nacho', 'noble', 'north', 'novel', 'nurse', 'oasis', 'ocean', 'olive', 'onion', 'opera', 'orbit', 'otter', 'owner', 'paint', 'panda',
  'paper', 'party', 'pasta', 'peach', 'pearl', 'pedal', 'penny', 'piano', 'pilot', 'pixel', 'pizza', 'plane', 'plant', 'plaza', 'poem', 'polar',
  'pond', 'potato', 'prism', 'pupil', 'puppy', 'quest', 'quiet', 'quilt', 'radar', 'radio', 'rainy', 'ranch', 'raven', 'river', 'robin', 'robot',
  'rocket', 'rose', 'royal', 'ruby', 'rugby', 'salad', 'salsa', 'sauce', 'scarf', 'scout', 'shark', 'sheep', 'shell', 'shirt', 'skate', 'sloth',
  'snack', 'snake', 'solar', 'sound', 'space', 'spice', 'spoon', 'squid', 'stamp', 'steam', 'stone', 'storm', 'sugar', 'sunny', 'swamp', 'table',
  'tiger', 'toast', 'token', 'topaz', 'torch', 'tower', 'train', 'tulip', 'uncle', 'unity', 'value', 'video', 'viola', 'vivid', 'wafer', 'zebra'
] as const

export const CODE_WORD_COUNT = 3
/** Room numbers on the intro server. */
export const ROOM_MIN = 1000
export const ROOM_MAX = 9999
/** A code nobody has used goes stale after this long. */
export const CODE_LIFETIME_MS = 60 * 60 * 1000
/** Wrong-code attempts before the sender gives up on a code (stops anyone guessing). */
export const MAX_BAD_TRIES = 3

export interface SendCode {
  room: number
  words: string[]
}

export const codeText = (code: SendCode): string => [code.room, ...code.words].join('-')

/** Makes a code from random numbers (pass crypto.randomInt). */
export function makeCode(randomInt: (min: number, max: number) => number): SendCode {
  const words = Array.from({ length: CODE_WORD_COUNT }, () => CODE_WORDS[randomInt(0, CODE_WORDS.length)])
  return { room: randomInt(ROOM_MIN, ROOM_MAX + 1), words }
}

/** Reads a code someone typed or pasted: `4821-tiger-piano-river`, `4821 Tiger Piano River`… */
export function parseCode(input: string): SendCode | null {
  const parts = input
    .trim()
    .toLowerCase()
    .split(/[\s\-_.,]+/)
    .filter(Boolean)
  if (parts.length !== CODE_WORD_COUNT + 1 || !/^\d{4}$/.test(parts[0])) return null
  const room = Number(parts[0])
  if (room < ROOM_MIN || room > ROOM_MAX) return null
  const words = parts.slice(1)
  if (!words.every((w) => (CODE_WORDS as readonly string[]).includes(w))) return null
  return { room, words }
}

/** What the key-making (scrypt) is fed: the words, tied to the room so codes can't be mixed up. */
export const keyInput = (code: SendCode): { secret: string; salt: string } => ({
  secret: code.words.join(' '),
  salt: `orbit-send v1 room ${code.room}`
})

// ---------- What's being sent ----------

export interface SendFile {
  /** Path inside the send, with / between folders: `My game/data/level1.pak`. */
  path: string
  size: number
}

export interface Manifest {
  from: string
  files: SendFile[]
  total: number
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * Makes a path from the other computer safe to save: no going up folders, no drive letters, no
 * names Windows can't save. Null if nothing sensible is left.
 */
export function safeRelPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path || path.length > 1000) return null
  const parts = path
    .split(/[\\/]+/)
    .map((part) =>
      part
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/, '')
        .trim()
    )
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => (WINDOWS_RESERVED.test(part) ? `_${part}` : part))
  if (!parts.length) return null
  return parts.join('/')
}

/** Checks a manifest from the other computer; null if it's not one. */
export function readManifest(raw: unknown): Manifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 200_000) return null
  const files: SendFile[] = []
  const seen = new Set<string>()
  for (const f of m.files as Record<string, unknown>[]) {
    const path = safeRelPath(f?.path)
    const size = f?.size
    if (!path || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null
    // Two files can't land in the same place (e.g. A.txt and a.txt on Windows).
    const key = path.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    files.push({ path, size })
  }
  const from = typeof m.from === 'string' && m.from.trim() ? m.from.trim().slice(0, 60) : 'Someone'
  return { from, files, total: files.reduce((n, f) => n + f.size, 0) }
}

/** Where a transfer has got to: which file, and how far into it. */
export interface Position {
  index: number
  offset: number
}

export const bytesDone = (files: SendFile[], pos: Position): number =>
  files.slice(0, pos.index).reduce((n, f) => n + f.size, 0) + (pos.index < files.length ? pos.offset : 0)

/** Moves past finished (and empty) files; returns the indexes of files that just finished. */
export function settle(files: SendFile[], pos: Position): number[] {
  const finished: number[] = []
  while (pos.index < files.length && pos.offset >= files[pos.index].size) {
    finished.push(pos.index)
    pos.index += 1
    pos.offset = 0
  }
  return finished
}

/** Is a start position from the other computer one we can send from? */
export function validPosition(files: SendFile[], raw: unknown): Position | null {
  if (!raw || typeof raw !== 'object') return null
  const { index, offset } = raw as Record<string, unknown>
  if (typeof index !== 'number' || typeof offset !== 'number' || !Number.isSafeInteger(index) || !Number.isSafeInteger(offset)) return null
  if (index < 0 || index > files.length || offset < 0) return null
  if (index === files.length) return offset === 0 ? { index, offset } : null
  return offset <= files[index].size ? { index, offset } : null
}

/** Top-level names in a send (what the friend sees: "My game" and 2 more). */
export function topNames(files: SendFile[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const top = f.path.split('/')[0]
    if (!out.includes(top)) out.push(top)
  }
  return out
}

export function sendTitle(files: SendFile[]): string {
  const tops = topNames(files)
  if (!tops.length) return 'Nothing'
  return tops.length === 1 ? tops[0] : `${tops[0]} and ${tops.length - 1} more`
}

/** Programs that run when opened: worth a word of warning before saving someone else's. */
const RUNNABLE = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|lnk|dmg|pkg|app|command|sh)$/i
export const runnableFiles = (files: SendFile[]): string[] => files.filter((f) => RUNNABLE.test(f.path)).map((f) => f.path)

/**
 * Picks a name that isn't taken: `photo.jpg`, then `photo (2).jpg`… `taken` says whether a name is
 * already used.
 */
export function freeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken(candidate)) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

// ---------- Messages ----------

/** Setting-up messages, locked with the code's key and passed on by the intro server. */
export type FsSignal =
  | { t: 'offer'; sdp: string; session: number }
  | { t: 'answer'; sdp: string; session: number }
  | { t: 'ice'; candidate: RTCIceCandidateInit; session: number }
  /** The receiver is in the room and wants an offer. */
  | { t: 'ready' }
  /** Stopped (also sent on the data channel, but that can be queued behind a lot of file). */
  | { t: 'cancel' }

/** Messages on the data channel (the file itself goes as plain binary between them). */
export type FsControl =
  | { t: 'manifest'; manifest: Manifest }
  | { t: 'start'; pos: Position }
  | { t: 'ack'; bytes: number }
  | { t: 'decline' }
  | { t: 'cancel' }
  | { t: 'done' }

/** Size of each piece on the data channel (Chromium is happiest at 64 KB or less). */
export const CHUNK = 64 * 1024
/** How far ahead of what the receiver has saved the sender may get. */
export const MAX_AHEAD = 32 * 1024 * 1024
/** The receiver says how far it has saved every this many bytes. */
export const ACK_EVERY = 4 * 1024 * 1024

/** How the two computers are connected, from the chosen WebRTC route. */
export type Route = 'local' | 'direct' | 'relay'

const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd|fc)/i
export function routeOf(local: { candidateType?: string } | undefined, remote: { candidateType?: string; address?: string } | undefined): Route | undefined {
  if (!local || !remote) return undefined
  if (local.candidateType === 'relay' || remote.candidateType === 'relay') return 'relay'
  if (remote.candidateType === 'host' && (!remote.address || PRIVATE_IP.test(remote.address) || remote.address.endsWith('.local'))) return 'local'
  return 'direct'
}

export const ROUTE_TEXT: Record<Route, string> = {
  local: 'Same Wi-Fi',
  direct: 'Direct',
  relay: 'Through the relay'
}

// ---------- What the page shows ----------

export type TransferStatus =
  /** Sender: waiting for the friend to type the code. Receiver: finding the sender. */
  | 'waiting'
  | 'connecting'
  /** Receiver: deciding whether to accept. Sender: waiting for them to. */
  | 'asking'
  | 'sending'
  /** Lost the connection; trying to get it back. */
  | 'reconnecting'
  /** Orbit closed part-way; press Carry on. */
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface Transfer {
  id: string
  direction: 'send' | 'receive'
  /** Shown to the sender only (the receiver typed it). */
  code?: string
  status: TransferStatus
  title: string
  /** The other person's computer, once known. */
  peer?: string
  manifest?: Manifest
  /** Receiver: the folder it's saving into. */
  folder?: string
  /** Receiver: what each file was saved as (inside `folder`), once accepted. */
  targets?: string[]
  done: number
  total: number
  speed?: number
  route?: Route
  error?: string
  created: number
  /** Sender: when an unused code stops working. */
  expires?: number
  finished?: number
}

export interface FileSendState {
  /** The intro server's address, or '' if it hasn't been set up. */
  server: string
  transfers: Transfer[]
  drive: DriveShare[]
  /** Google sign-in: whether Drive links can be made yet. */
  driveAccess: 'ready' | 'setup' | 'connect' | 'scope'
}

// ---------- Google Drive links ----------

export const DRIVE_KEEP_DAYS = 7

export interface DriveShare {
  id: string
  title: string
  status: 'uploading' | 'ready' | 'failed' | 'removed'
  done: number
  total: number
  speed?: number
  link?: string
  /** The Drive file or folder Orbit made. */
  driveId?: string
  error?: string
  created: number
  /** When Orbit takes it off Drive. */
  expires?: number
}

/** Drive's resumable upload wants pieces in multiples of 256 KB. */
export const DRIVE_PIECE = 32 * 256 * 1024

/** How much of an upload Drive says it has, from a 308 reply's Range header (`bytes=0-1234`). */
export function driveReceived(range: string | null): number {
  const m = range && /bytes=0-(\d+)/.exec(range)
  return m ? Number(m[1]) + 1 : 0
}
