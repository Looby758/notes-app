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

/** Scopes asked for: read who's in voice and change your own mute / deafen. */
export const DISCORD_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'] as const
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
  channel: { id: string; name: string; server: string | null; members: VoiceMember[] } | null
}

export const EMPTY_DISCORD: DiscordStatus = {
  stage: 'setup',
  error: null,
  canEncrypt: true,
  clientId: null,
  me: null,
  mute: false,
  deaf: false,
  channel: null
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
    bot: user.bot === true
  }
}

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
