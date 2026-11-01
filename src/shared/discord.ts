/**
 * Discord voice controls: who's in your voice channel, and mute / deafen from Orbit or the phone.
 *
 * This only uses Discord's own official local RPC (the socket the Discord app opens on this
 * computer, documented at discord.com/developers/docs/topics/rpc). Nothing is injected into
 * Discord and there's no client mod, so it's within Discord's rules. You sign in once with your
 * own free Discord application (made in the Developer Portal), and Discord asks you to allow it.
 *
 * These are the pure parts (shared with tests); the socket itself is in main/discord.ts.
 */

/**
 * Scopes asked for: read who's in voice, change your own mute / deafen (and each person's volume
 * for you), and read the voice channel's text chat. A sign-in made before the chat was added
 * doesn't have `messages.read`; the pop-out then asks you to sign in again to see the chat.
 */
export const DISCORD_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write', 'messages.read'] as const
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token'
/** Must also be added under OAuth2 → Redirects in the Developer Portal (Discord checks it matches). */
export const DISCORD_REDIRECT = 'http://localhost'
export const DISCORD_PORTAL = 'https://discord.com/developers/applications'

/** The socket's message kinds. */
export const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const

export type DiscordStage =
  /** No Discord application saved yet. */
  | 'setup'
  /** Saved, but not signed in (or the sign-in was turned down / expired). */
  | 'signed-out'
  /** Looking for the Discord app on this computer. */
  | 'connecting'
  /** Discord is showing its "Authorize" window. */
  | 'authorizing'
  /** Discord isn't running (or can't be reached). */
  | 'no-discord'
  | 'ready'

export interface VoiceMember {
  id: string
  name: string
  avatar: string | null
  /** Muted / deafened by themselves. */
  selfMute: boolean
  selfDeaf: boolean
  /** Muted / deafened by the server. */
  serverMute: boolean
  serverDeaf: boolean
  /** Talking right now. */
  speaking: boolean
  bot: boolean
  /** How loud you hear them, 0 to 200 (100 is normal). Only changes it for you. */
  volume: number
  /** Muted just for you (they can still talk to everyone else). */
  localMute: boolean
  /** Sharing their screen ("Go Live") or their camera, when Discord says so. */
  streaming: boolean
  video: boolean
}

/** One message of the voice channel's text chat. */
export interface ChatMessage {
  id: string
  authorId: string
  author: string
  avatar: string | null
  content: string
  /** When it was sent (ms). */
  at: number
  /** It had a picture, a file or an embed (only the text is shown). */
  attachments: number
  /** The people mentioned in it, by id: the name Discord shows (server nickname first) and their username. */
  mentions: Record<string, MentionName>
}

export interface MentionName {
  name: string
  username: string | null
}

/** A finished call, for the call history (kept only on this computer). */
export interface CallRecord {
  id: string
  channel: string
  server: string | null
  /** When you joined and left (ms). */
  start: number
  end: number
  /** Everyone else who was in it at some point. */
  people: string[]
}

export interface DiscordStatus {
  stage: DiscordStage
  /** What went wrong last, in plain words. */
  error: string | null
  canEncrypt: boolean
  /** The saved application's id (not secret). */
  clientId: string | null
  /** You, once signed in. */
  me: { id: string; name: string } | null
  /** Your own mute / deafen (from Discord's voice settings). */
  mute: boolean
  deaf: boolean
  /** The voice channel you're in, or null. */
  channel: VoiceChannel | null
  /** The voice channel's text chat, newest last (only while you're in a channel). */
  chat: ChatMessage[]
  /** Whether the chat can be read: 'ok', 'sign-in' (the sign-in is older than the chat), or 'none' (this kind of channel has none). */
  chatState: 'ok' | 'sign-in' | 'none'
}

export interface VoiceChannel {
  id: string
  name: string
  server: string | null
  /** The server's id, for opening the channel in Discord; null for a private call. */
  guildId: string | null
  /** When you joined (ms): for the call timer. If Orbit connected mid-call, when Orbit saw you there. */
  joinedAt: number
  members: VoiceMember[]
}

export const EMPTY_DISCORD: DiscordStatus = {
  stage: 'setup',
  error: null,
  canEncrypt: true,
  clientId: null,
  me: null,
  mute: false,
  deaf: false,
  channel: null,
  chat: [],
  chatState: 'none'
}

/** A Discord application id is a snowflake: 17 to 20 digits. */
export const validClientId = (id: string): boolean => /^\d{17,20}$/.test(id.trim())

/** The socket's paths to try, in order (Discord uses the first free one of 0 to 9). */
export function ipcPaths(platform: string, env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  if (platform === 'win32') {
    for (let i = 0; i < 10; i++) out.push(`\\\\?\\pipe\\discord-ipc-${i}`)
    return out
  }
  const base = (env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp').replace(/\/+$/, '')
  // Flatpak and Snap Discord put the socket in their own folder.
  const dirs = [base, `${base}/app/com.discordapp.Discord`, `${base}/snap.discord`]
  for (const dir of dirs) for (let i = 0; i < 10; i++) out.push(`${dir}/discord-ipc-${i}`)
  return out
}

/** One message on the socket: opcode and length (little-endian), then JSON. */
export function encodeFrame(op: number, payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  view.setInt32(0, op, true)
  view.setInt32(4, body.length, true)
  out.set(body, 8)
  return out
}

/** Takes as many whole messages as there are off the front of `buf`; returns them and what's left. */
export function decodeFrames(buf: Uint8Array): { frames: { op: number; data: unknown }[]; rest: Uint8Array } {
  const frames: { op: number; data: unknown }[] = []
  let at = 0
  while (buf.length - at >= 8) {
    const view = new DataView(buf.buffer, buf.byteOffset + at, 8)
    const op = view.getInt32(0, true)
    const len = view.getInt32(4, true)
    if (len < 0 || len > 4_000_000) throw new Error('Discord sent something Orbit can’t read.')
    if (buf.length - at - 8 < len) break
    const text = new TextDecoder().decode(buf.subarray(at + 8, at + 8 + len))
    let data: unknown = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
    frames.push({ op, data })
    at += 8 + len
  }
  return { frames, rest: buf.slice(at) }
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null)

export function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar || !/^[\w]+$/.test(avatar) || !/^\d+$/.test(userId)) return null
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`
}

/** One entry of a channel's `voice_states` (or a VOICE_STATE_* event) as a member; null if it isn't one. */
export function memberFrom(raw: unknown, speaking = false): VoiceMember | null {
  if (!isObj(raw) || !isObj(raw.user)) return null
  const user = raw.user
  const id = str(user.id)
  if (!id) return null
  const vs = isObj(raw.voice_state) ? raw.voice_state : {}
  const name = str(raw.nick) ?? str(user.global_name) ?? str(user.username) ?? 'Someone'
  return {
    id,
    name,
    avatar: avatarUrl(id, str(user.avatar)),
    selfMute: vs.self_mute === true,
    selfDeaf: vs.self_deaf === true,
    serverMute: vs.mute === true || vs.suppress === true,
    serverDeaf: vs.deaf === true,
    speaking,
    bot: user.bot === true,
    volume: clampVolume(raw.volume),
    localMute: raw.mute === true,
    streaming: vs.self_stream === true,
    video: vs.self_video === true
  }
}

/** Discord's per-person volume: 0 to 200, 100 when it isn't given. */
export function clampVolume(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 100
  return Math.round(Math.min(200, Math.max(0, n)))
}

/** Changes one member (by id). */
export const patchMember = (list: VoiceMember[], id: string, patch: Partial<VoiceMember>): VoiceMember[] => list.map((x) => (x.id === id ? { ...x, ...patch } : x))

/** Adds or replaces a member (keeping whether they're talking); the list stays in name order. */
export function upsertMember(list: VoiceMember[], m: VoiceMember): VoiceMember[] {
  const old = list.find((x) => x.id === m.id)
  const next = [...list.filter((x) => x.id !== m.id), { ...m, speaking: old?.speaking ?? m.speaking }]
  return next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export const removeMember = (list: VoiceMember[], id: string): VoiceMember[] => list.filter((x) => x.id !== id)

export const setSpeaking = (list: VoiceMember[], id: string, speaking: boolean): VoiceMember[] =>
  list.map((x) => (x.id === id && x.speaking !== speaking ? { ...x, speaking } : x))

/** The members of a GET_SELECTED_VOICE_CHANNEL / GET_CHANNEL answer. */
export function membersFrom(channel: unknown): VoiceMember[] {
  if (!isObj(channel) || !Array.isArray(channel.voice_states)) return []
  let list: VoiceMember[] = []
  for (const raw of channel.voice_states) {
    const m = memberFrom(raw)
    if (m) list = upsertMember(list, m)
  }
  return list
}

/** What to show for a member's state: "Deafened", "Muted", "Server muted"… or null when they can talk. */
export function memberState(m: VoiceMember): string | null {
  if (m.serverDeaf) return 'Server deafened'
  if (m.selfDeaf) return 'Deafened'
  if (m.serverMute) return 'Server muted'
  if (m.selfMute) return 'Muted'
  return null
}

/** Discord's error codes in plain words. */
export function discordError(code: unknown, message: unknown): string {
  const text = typeof message === 'string' ? message : ''
  if (code === 5000 || /invalid client id/i.test(text)) return 'Discord doesn’t know that application id. Check it in the Developer Portal.'
  if (code === 4002 || code === 4006 || /not authenticated|invalid token/i.test(text)) return 'Discord signed Orbit out. Sign in again.'
  if (code === 5003 || /closed|denied|cancel/i.test(text)) return 'You turned it down in Discord, so Orbit isn’t signed in.'
  if (code === 4000 || code === 4007) return 'Discord didn’t accept the request. Try again.'
  return text ? `Discord said: ${text}` : 'Discord didn’t answer properly. Try again.'
}

/** Turns the token endpoint's error into plain words. */
export function tokenError(status: number, body: unknown): string {
  const err = isObj(body) ? str(body.error) : null
  const desc = isObj(body) ? str(body.error_description) : null
  if (err === 'invalid_client') return 'Discord didn’t accept the client secret. Copy it again from OAuth2 in the Developer Portal.'
  if (err === 'invalid_grant' && desc && /redirect/i.test(desc))
    return `Add ${DISCORD_REDIRECT} under OAuth2 → Redirects in the Developer Portal, then try again.`
  if (err === 'invalid_grant') return 'That sign-in ran out. Try again.'
  return `Discord’s sign-in answered ${status}${desc ? `: ${desc}` : ''}.`
}

// ---------------------------------------------------------------------------------------------
// The text chat

/** A message from GET_CHANNEL's `messages` or a MESSAGE_CREATE / UPDATE event; null if it isn't one. */
export function messageFrom(raw: unknown): ChatMessage | null {
  if (!isObj(raw)) return null
  const msg = isObj(raw.message) ? raw.message : raw
  const id = str(msg.id)
  const author = isObj(msg.author) ? msg.author : null
  const authorId = author ? str(author.id) : null
  if (!id || !author || !authorId) return null
  const at = Date.parse(String(msg.timestamp ?? ''))
  const count = (x: unknown): number => (Array.isArray(x) ? x.length : 0)
  return {
    id,
    authorId,
    author: str(msg.nick) ?? str(author.global_name) ?? str(author.username) ?? 'Someone',
    avatar: avatarUrl(authorId, str(author.avatar)),
    content: typeof msg.content === 'string' ? msg.content : '',
    at: Number.isFinite(at) ? at : Date.now(),
    attachments: count(msg.attachments) + count(msg.embeds),
    mentions: mentionsFrom(msg.mentions)
  }
}

/** A message's `mentions` (the users it @s) as names by id. */
function mentionsFrom(raw: unknown): Record<string, MentionName> {
  const out: Record<string, MentionName> = {}
  if (!Array.isArray(raw)) return out
  for (const u of raw) {
    if (!isObj(u)) continue
    const id = str(u.id)
    if (!id) continue
    const member = isObj(u.member) ? u.member : {}
    const username = str(u.username)
    out[id] = { name: str(member.nick) ?? str(u.nick) ?? str(u.global_name) ?? username ?? 'someone', username }
  }
  return out
}

/** A piece of a chat message: plain text, or a mention / emoji / time shown as a highlighted name. */
export type ChatPart = { text: string } | { mention: string; kind: 'user' | 'role' | 'channel' | 'emoji' | 'time'; title?: string }

/**
 * Turns Discord's codes in a message into what Discord itself shows: <@123> and <@!123> become
 * @name (looked up with `userName`: the message's own mentions first, then whoever else Orbit
 * knows), <@&123> a role, <#123> a channel, <:smile:123> :smile:, and <t:1700000000:R> the time.
 */
export function chatParts(content: string, userName: (id: string) => MentionName | null): ChatPart[] {
  const parts: ChatPart[] = []
  const re = /<(@!?|@&|#)(\d+)>|<a?:(\w+):\d+>|<t:(-?\d+)(?::([tTdDfFR]))?>/g
  let at = 0
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > at) parts.push({ text: content.slice(at, m.index) })
    at = m.index + m[0].length
    if (m[1] === '@' || m[1] === '@!') {
      const who = userName(m[2])
      parts.push(who ? { mention: `@${who.name}`, kind: 'user', ...(who.username ? { title: `@${who.username}` } : {}) } : { mention: '@unknown user', kind: 'user' })
    } else if (m[1] === '@&') parts.push({ mention: '@role', kind: 'role' })
    else if (m[1] === '#') parts.push({ mention: '#channel', kind: 'channel' })
    else if (m[3]) parts.push({ mention: `:${m[3]}:`, kind: 'emoji' })
    else {
      const when = new Date(Number(m[4]) * 1000)
      parts.push({ mention: discordTime(when, m[5] ?? 'f'), kind: 'time', title: when.toLocaleString() })
    }
  }
  if (at < content.length) parts.push({ text: content.slice(at) })
  return parts
}

/** A <t:…> timestamp in its style (R: "in 5 minutes" / "2 hours ago"). */
function discordTime(when: Date, style: string, now = Date.now()): string {
  if (style === 'R') {
    const mins = Math.round((when.getTime() - now) / 60_000)
    const abs = Math.abs(mins)
    const n = abs < 60 ? `${abs} minute${abs === 1 ? '' : 's'}` : abs < 1440 ? `${Math.round(abs / 60)} hour${Math.round(abs / 60) === 1 ? '' : 's'}` : `${Math.round(abs / 1440)} day${Math.round(abs / 1440) === 1 ? '' : 's'}`
    return mins >= 0 ? `in ${n}` : `${n} ago`
  }
  if (style === 't' || style === 'T') return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (style === 'd' || style === 'D') return when.toLocaleDateString()
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const CHAT_KEEP = 60

/** Adds or replaces a message; keeps the newest CHAT_KEEP, oldest first. */
export function upsertMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id)
  const next = i >= 0 ? list.map((x, j) => (j === i ? m : x)) : [...list, m].sort((a, b) => a.at - b.at)
  return next.slice(-CHAT_KEEP)
}

/** All the messages of a GET_CHANNEL answer. */
export function messagesFrom(channel: unknown): ChatMessage[] {
  if (!isObj(channel) || !Array.isArray(channel.messages)) return []
  let list: ChatMessage[] = []
  for (const raw of channel.messages) {
    const m = messageFrom(raw)
    if (m) list = upsertMessage(list, m)
  }
  return list
}

/** The link that opens a channel in the Discord app (to reply in the chat). */
export function channelLink(guildId: string | null, channelId: string): string | null {
  if (!/^\d+$/.test(channelId) || (guildId && !/^\d+$/.test(guildId))) return null
  return `discord://-/channels/${guildId ?? '@me'}/${channelId}`
}

// ---------------------------------------------------------------------------------------------
// The call timer and history

/** The call timer: "4:07", "12:30", "1:02:03". */
export function callClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** How long a call lasted, in words: "under a minute", "25 min", "1 h 05 min". */
export function callLength(ms: number): string {
  const min = Math.round(Math.max(0, ms) / 60_000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** Calls shorter than this (joined by mistake, hopped straight through) aren't kept. */
export const MIN_CALL_MS = 15_000
export const CALLS_KEEP = 300

/** Adds a finished call to the history (newest first); too-short ones are left out. */
export function addCall(list: CallRecord[], call: CallRecord): CallRecord[] {
  if (call.end - call.start < MIN_CALL_MS) return list
  return [call, ...list.filter((c) => c.id !== call.id)].slice(0, CALLS_KEEP)
}

/** The saved history, with anything damaged dropped. */
export function cleanCalls(raw: unknown): CallRecord[] {
  if (!Array.isArray(raw)) return []
  const out: CallRecord[] = []
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.channel !== 'string') continue
    if (typeof c.start !== 'number' || typeof c.end !== 'number' || !(c.end >= c.start)) continue
    out.push({
      id: c.id,
      channel: c.channel,
      server: typeof c.server === 'string' ? c.server : null,
      start: c.start,
      end: c.end,
      people: Array.isArray(c.people) ? c.people.filter((p): p is string => typeof p === 'string').slice(0, 50) : []
    })
  }
  return out.sort((a, b) => b.start - a.start).slice(0, CALLS_KEEP)
}

/** "Sam, Alex and 3 others" for the history list. */
export function peopleList(people: string[], max = 3): string {
  if (!people.length) return 'Just you'
  if (people.length <= max) return people.length === 1 ? people[0] : `${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}`
  const rest = people.length - max
  return `${people.slice(0, max).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------------------------
// The "pop it out?" note when you join

/**
 * Whether joining should offer the pop-out: only on a real join (not Orbit connecting while you're
 * already in a call, and not hopping between channels), when the note is turned on and the pop-out
 * isn't already open.
 */
export function offerPopout(prevChannel: string | null, nextChannel: string | null, firstLook: boolean, enabled: boolean, popoutOpen: boolean): boolean {
  return enabled && !popoutOpen && !firstLook && !prevChannel && !!nextChannel
}

// ---------------------------------------------------------------------------------------------
// The pop-out's place on screen

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where the pop-out was left: its place, and which screen it was on (and where on that screen). */
export interface SavedPlace extends Rect {
  maximized?: boolean
  /** The screen's id, and the window's top-left corner measured from that screen's corner. */
  displayId?: number
  offsetX?: number
  offsetY?: number
}

/**
 * Where to open the pop-out: exactly where it was left when that's still on a screen; on the same
 * screen (same spot on it) when the screens were rearranged; null when that screen is gone (the
 * caller then picks a default). It's always made to fit the screen it lands on.
 */
export function restorePlace(saved: SavedPlace | null | undefined, displays: { id: number; workArea: Rect }[]): Rect | null {
  if (!saved || !(saved.width > 0) || !(saved.height > 0)) return null
  const fit = (r: Rect, a: Rect): Rect => {
    const width = Math.min(r.width, a.width)
    const height = Math.min(r.height, a.height)
    return {
      x: Math.round(Math.min(Math.max(r.x, a.x), a.x + a.width - width)),
      y: Math.round(Math.min(Math.max(r.y, a.y), a.y + a.height - height)),
      width: Math.round(width),
      height: Math.round(height)
    }
  }
  // Mostly on one screen (its title bar can be reached): keep it there.
  const home = displays.find(({ workArea: a }) => saved.x + 60 < a.x + a.width && saved.x + saved.width - 60 > a.x && saved.y >= a.y - 10 && saved.y + 30 < a.y + a.height)
  const same = displays.find((d) => d.id === saved.displayId)
  if (home && (!same || same === home)) return fit(saved, home.workArea)
  if (same) {
    const a = same.workArea
    return fit({ ...saved, x: a.x + (saved.offsetX ?? 0), y: a.y + (saved.offsetY ?? 0) }, a)
  }
  return home ? fit(saved, home.workArea) : null
}

/** The corner note's place: bottom right of a screen's work area. */
export function cornerOf(area: Rect, width: number, height: number, margin = 16): Rect {
  return { x: Math.round(area.x + area.width - width - margin), y: Math.round(area.y + area.height - height - margin), width, height }
}
