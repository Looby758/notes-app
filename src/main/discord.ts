import { app, BrowserWindow, ipcMain, net, safeStorage, shell } from 'electron'
import { createConnection, type Socket } from 'net'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  addCall,
  channelLink,
  clampVolume,
  cleanCalls,
  decodeFrames,
  discordError,
  DISCORD_PORTAL,
  DISCORD_REDIRECT,
  DISCORD_SCOPES,
  DISCORD_TOKEN_URL,
  EMPTY_DISCORD,
  encodeFrame,
  ipcPaths,
  membersFrom,
  memberFrom,
  messageFrom,
  messagesFrom,
  OP,
  patchMember,
  upsertMessage,
  removeMember,
  setSpeaking,
  tokenError,
  upsertMember,
  validClientId,
  type CallRecord,
  type DiscordStatus
} from '@shared/discord'
import { logError } from './log'

/**
 * Discord voice controls, through Discord's official local RPC socket (see shared/discord.ts).
 * Your own Discord application's id and secret, and the sign-in, are kept encrypted (Electron
 * safeStorage, like the AI key) in `discord.json`. Nothing is sent anywhere but to the Discord app
 * on this computer and Discord's own sign-in server.
 */

interface Stored {
  clientId?: string
  /** All encrypted. */
  secret?: string
  access?: string
  refresh?: string
  /** When the access token runs out (ms). */
  expires?: number
  /** The scopes the sign-in was given (space-separated, not secret). */
  scopes?: string
}

let stored: Stored | null = null
const storeFile = (): string => join(app.getPath('userData'), 'discord.json')

function load(): Stored {
  if (stored) return stored
  try {
    const s = JSON.parse(readFileSync(storeFile(), 'utf8'))
    stored = s && typeof s === 'object' ? s : {}
  } catch {
    stored = {}
  }
  return stored!
}

function save(): void {
  try {
    const file = storeFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(load()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving Discord sign-in', err)
  }
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
function decrypt(text: string | undefined): string | null {
  if (!text) return null
  try {
    return safeStorage.decryptString(Buffer.from(text, 'base64'))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Status

let status: DiscordStatus = { ...EMPTY_DISCORD }

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('discord:changed', status)
}

function update(patch: Partial<DiscordStatus>): void {
  const before = status.channel?.id ?? null
  status = { ...status, ...patch }
  const after = status.channel?.id ?? null
  if (before !== after) {
    finishCall()
    if (!after) status = { ...status, chat: [], chatState: 'none' }
  }
  trackCall()
  broadcast()
  if (before !== after) for (const l of channelListeners) l(before, after, firstLook)
}

// ---------------------------------------------------------------------------------------------
// Call history (only on this computer: discord-calls.json in the settings folder)

interface OpenCall {
  channelId: string
  record: CallRecord
  people: Set<string>
}
let openCall: OpenCall | null = null
let calls: CallRecord[] | null = null
const callsFile = (): string => join(app.getPath('userData'), 'discord-calls.json')

function loadCalls(): CallRecord[] {
  if (calls) return calls
  try {
    calls = cleanCalls(JSON.parse(readFileSync(callsFile(), 'utf8')))
  } catch {
    calls = []
  }
  return calls
}

function saveCalls(): void {
  try {
    const file = callsFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(loadCalls()), 'utf8')
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError('saving the call history', err)
  }
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('discord:calls-changed', loadCalls())
}

/** Starts a call when you're in a channel, and notes everyone who's been in it. */
function trackCall(): void {
  const ch = status.channel
  if (!ch) return
  if (!openCall || openCall.channelId !== ch.id) {
    openCall = { channelId: ch.id, people: new Set(), record: { id: randomUUID(), channel: ch.name, server: ch.server, start: ch.joinedAt, end: ch.joinedAt, people: [] } }
  }
  openCall.record.channel = ch.name
  openCall.record.server = ch.server
  for (const m of ch.members) if (m.id !== status.me?.id && !m.bot) openCall.people.add(m.name)
}

/** You left (or Discord closed): the call goes into the history. */
function finishCall(): void {
  const c = openCall
  openCall = null
  if (!c) return
  const before = loadCalls()
  calls = addCall(before, { ...c.record, end: Date.now(), people: [...c.people] })
  if (calls !== before) saveCalls()
}

type ChannelListener = (before: string | null, after: string | null, firstLook: boolean) => void
const channelListeners = new Set<ChannelListener>()
/** True while the channel being shown is the one you were already in when Orbit connected. */
let firstLook = false

/** Called when you join, leave or change voice channel (main/discordPopout.ts offers the pop-out). */
export function onDiscordChannel(listener: ChannelListener): () => void {
  channelListeners.add(listener)
  return () => channelListeners.delete(listener)
}

const hasApp = (): boolean => !!load().clientId && !!load().secret
const hasSignIn = (): boolean => !!load().refresh || !!load().access

function idleStage(): DiscordStatus['stage'] {
  return hasApp() ? 'signed-out' : 'setup'
}

// ---------------------------------------------------------------------------------------------
// The socket

let socket: Socket | null = null
let buffer: Uint8Array = new Uint8Array(0)
const pending = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
let onReady: ((user: unknown) => void) | null = null
let retryTimer: NodeJS.Timeout | undefined
/** Bumped on every (re)connect, so an old connection's late answers are ignored. */
let generation = 0
let channelId: string | null = null

class DiscordError extends Error {
  constructor(
    message: string,
    readonly code?: unknown
  ) {
    super(message)
  }
}

function closeSocket(): void {
  generation++
  onReady = null
  channelId = null
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(new DiscordError('Discord closed the connection.'))
  }
  pending.clear()
  if (socket) {
    socket.removeAllListeners()
    socket.on('error', () => {})
    socket.destroy()
  }
  socket = null
  buffer = new Uint8Array(0)
}

function write(op: number, payload: unknown): void {
  socket?.write(encodeFrame(op, payload))
}

/** Sends a command and waits for its answer. */
function command(cmd: string, args: Record<string, unknown> = {}, evt?: string, timeoutMs = 15_000): Promise<unknown> {
  if (!socket) return Promise.reject(new DiscordError('Discord isn’t connected.'))
  const nonce = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(nonce)
      reject(new DiscordError('Discord didn’t answer in time.'))
    }, timeoutMs)
    pending.set(nonce, { resolve, reject, timer })
    write(OP.frame, evt ? { cmd, args, evt, nonce } : { cmd, args, nonce })
  })
}

function tryPath(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection(path)
    const fail = (err: Error): void => {
      s.destroy()
      reject(err)
    }
    s.once('connect', () => {
      s.off('error', fail)
      resolve(s)
    })
    s.once('error', fail)
  })
}

async function openSocket(): Promise<Socket | null> {
  for (const path of ipcPaths(process.platform, process.env)) {
    try {
      return await tryPath(path)
    } catch {
      // Not this one.
    }
  }
  return null
}

function handleFrame(op: number, msg: unknown): void {
  if (op === OP.ping) return write(OP.pong, msg)
  if (op === OP.close) {
    const m = msg as { code?: unknown; message?: unknown } | null
    const err = discordError(m?.code, m?.message)
    lost(err)
    return
  }
  if (op !== OP.frame || !msg || typeof msg !== 'object') return
  const m = msg as { cmd?: string; evt?: string | null; nonce?: string | null; data?: Record<string, unknown> }
  if (m.nonce && pending.has(m.nonce)) {
    const p = pending.get(m.nonce)!
    pending.delete(m.nonce)
    clearTimeout(p.timer)
    if (m.evt === 'ERROR') p.reject(new DiscordError(discordError(m.data?.code, m.data?.message), m.data?.code))
    else p.resolve(m.data)
    return
  }
  if (m.cmd !== 'DISPATCH') return
  const data = m.data ?? {}
  switch (m.evt) {
    case 'READY':
      onReady?.(data.user)
      onReady = null
      break
    case 'VOICE_SETTINGS_UPDATE':
      update({ mute: data.mute === true, deaf: data.deaf === true })
      break
    case 'VOICE_CHANNEL_SELECT':
      void followChannel(typeof data.channel_id === 'string' ? data.channel_id : null)
      break
    case 'MESSAGE_CREATE':
    case 'MESSAGE_UPDATE': {
      const msg = messageFrom(data)
      if (msg && status.channel && data.channel_id === status.channel.id) update({ chat: upsertMessage(status.chat, msg) })
      break
    }
    case 'MESSAGE_DELETE': {
      const id = (data.message as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' && data.channel_id === status.channel?.id) update({ chat: status.chat.filter((x) => x.id !== id) })
      break
    }
    case 'VOICE_STATE_CREATE':
    case 'VOICE_STATE_UPDATE': {
      const member = memberFrom(data)
      if (member && status.channel) {
        update({ channel: { ...status.channel, members: upsertMember(status.channel.members, member) } })
        // Your own entry carries your mute / deafen too.
        if (member.id === status.me?.id) update({ mute: member.selfMute || member.selfDeaf, deaf: member.selfDeaf })
      }
      break
    }
    case 'VOICE_STATE_DELETE': {
      const id = (data.user as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' && status.channel) update({ channel: { ...status.channel, members: removeMember(status.channel.members, id) } })
      break
    }
    case 'SPEAKING_START':
    case 'SPEAKING_STOP': {
      const id = data.user_id
      if (typeof id === 'string' && status.channel)
        update({ channel: { ...status.channel, members: setSpeaking(status.channel.members, id, m.evt === 'SPEAKING_START') } })
      break
    }
  }
}

const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP']
const CHAT_EVENTS = ['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE']

/** The sign-in includes reading messages (sign-ins from before the chat was added don't). */
const canReadChat = (): boolean => (load().scopes ?? '').split(/\s+/).includes('messages.read')

/**
 * Shows the voice channel you're in (or none), and listens to who comes and goes and to its chat.
 * `first`: Orbit just connected and you were already in it (so it isn't a fresh join).
 */
async function followChannel(id: string | null, first = false): Promise<void> {
  const gen = generation
  if (channelId && channelId !== id) {
    const old = channelId
    await Promise.all([...CHANNEL_EVENTS, ...CHAT_EVENTS].map((evt) => command('UNSUBSCRIBE', { channel_id: old }, evt).catch(() => {})))
  }
  if (gen !== generation) return
  channelId = id
  firstLook = first
  if (!id) return update({ channel: null })
  try {
    const ch = (await command('GET_CHANNEL', { channel_id: id })) as Record<string, unknown> | null
    if (gen !== generation || channelId !== id) return
    await showChannel(ch)
    await Promise.all(CHANNEL_EVENTS.map((evt) => command('SUBSCRIBE', { channel_id: id }, evt).catch(() => {})))
    if (!canReadChat()) return update({ chatState: 'sign-in' })
    const ok = await Promise.all(CHAT_EVENTS.map((evt) => command('SUBSCRIBE', { channel_id: id }, evt).then(() => true, () => false)))
    if (gen === generation && channelId === id) update({ chatState: ok[0] ? 'ok' : 'none' })
  } catch (err) {
    logError('reading the Discord voice channel', err)
  } finally {
    firstLook = false
  }
}

async function showChannel(ch: Record<string, unknown> | null): Promise<void> {
  if (!ch || typeof ch.id !== 'string') return update({ channel: null })
  let server: string | null = null
  if (typeof ch.guild_id === 'string') {
    try {
      const g = (await command('GET_GUILD', { guild_id: ch.guild_id })) as { name?: unknown } | null
      if (typeof g?.name === 'string') server = g.name
    } catch {
      // Not important.
    }
  }
  const name = typeof ch.name === 'string' && ch.name ? ch.name : 'Private call'
  const guildId = typeof ch.guild_id === 'string' ? ch.guild_id : null
  const joinedAt = status.channel?.id === ch.id ? status.channel.joinedAt : Date.now()
  update({ channel: { id: ch.id, name, server, guildId, joinedAt, members: membersFrom(ch) }, chat: messagesFrom(ch) })
}

// ---------------------------------------------------------------------------------------------
// Signing in

async function tokenRequest(params: Record<string, string>): Promise<void> {
  const s = load()
  const secret = decrypt(s.secret)
  if (!s.clientId || !secret) throw new DiscordError('Add your Discord application first.')
  const body = new URLSearchParams({ client_id: s.clientId, client_secret: secret, ...params })
  const res = await net.fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    // Handled below.
  }
  if (!res.ok || typeof json.access_token !== 'string') throw new DiscordError(tokenError(res.status, json), json.error)
  s.access = encrypt(json.access_token)
  if (typeof json.refresh_token === 'string') s.refresh = encrypt(json.refresh_token)
  if (typeof json.scope === 'string') s.scopes = json.scope
  s.expires = Date.now() + (typeof json.expires_in === 'number' ? json.expires_in : 604_800) * 1000
  save()
}

/** A working access token, refreshed if it's about to run out; null if there's no sign-in. */
async function accessToken(): Promise<string | null> {
  const s = load()
  if (s.access && s.expires && s.expires - Date.now() > 60_000) {
    const t = decrypt(s.access)
    if (t) return t
  }
  const refresh = decrypt(s.refresh)
  if (!refresh) return null
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
  return decrypt(load().access)
}

function forgetSignIn(): void {
  const s = load()
  delete s.access
  delete s.refresh
  delete s.expires
  delete s.scopes
  save()
}

/**
 * Connects to the Discord app and signs in. `interactive`: you pressed Sign in, so Discord may
 * show its Authorize window; otherwise only a saved sign-in is used.
 */
async function connect(interactive: boolean): Promise<void> {
  clearTimeout(retryTimer)
  const s = load()
  if (!hasApp()) return update({ ...EMPTY_DISCORD, canEncrypt: safeStorage.isEncryptionAvailable() })
  if (!interactive && !hasSignIn()) return update({ stage: 'signed-out', clientId: s.clientId ?? null })
  closeSocket()
  const gen = generation
  update({ stage: 'connecting', error: null, clientId: s.clientId ?? null })
  const sock = await openSocket()
  if (gen !== generation) return void sock?.destroy()
  if (!sock) {
    update({ stage: 'no-discord', me: null, channel: null })
    scheduleRetry()
    return
  }
  socket = sock
  sock.on('data', (chunk: Buffer) => {
    if (gen !== generation) return
    const joined = new Uint8Array(buffer.length + chunk.length)
    joined.set(buffer)
    joined.set(chunk, buffer.length)
    try {
      const { frames, rest } = decodeFrames(joined)
      buffer = rest
      for (const f of frames) handleFrame(f.op, f.data)
    } catch (err) {
      logError('reading from Discord', err)
      lost('Discord sent something Orbit can’t read.')
    }
  })
  sock.on('close', () => gen === generation && lost(null))
  sock.on('error', () => {})

  try {
    const ready = new Promise<unknown>((resolve, reject) => {
      onReady = resolve
      setTimeout(() => reject(new DiscordError('Discord didn’t answer. Is it fully started?')), 10_000)
    })
    write(OP.handshake, { v: 1, client_id: s.clientId })
    await ready
    if (gen !== generation) return

    let token: string | null = null
    try {
      token = await accessToken()
    } catch (err) {
      // A refresh that's turned down means signing in again.
      forgetSignIn()
      if (!interactive) throw err
    }
    if (!token) {
      if (!interactive) throw new DiscordError('Sign in to Discord again.')
      update({ stage: 'authorizing' })
      const auth = (await command('AUTHORIZE', { client_id: s.clientId, scopes: [...DISCORD_SCOPES] }, undefined, 300_000)) as { code?: unknown }
      if (typeof auth?.code !== 'string') throw new DiscordError('Discord didn’t give Orbit a sign-in.')
      await tokenRequest({ grant_type: 'authorization_code', code: auth.code, redirect_uri: DISCORD_REDIRECT })
      token = decrypt(load().access)
    }
    if (gen !== generation) return
    let authed: { user?: { id?: unknown; username?: unknown; global_name?: unknown } }
    try {
      authed = (await command('AUTHENTICATE', { access_token: token })) as typeof authed
    } catch (err) {
      forgetSignIn()
      throw err
    }
    const user = authed?.user
    const me = typeof user?.id === 'string' ? { id: user.id, name: String(user.global_name || user.username || 'You') } : null
    update({ stage: 'ready', me, error: null })

    await Promise.all(['VOICE_CHANNEL_SELECT', 'VOICE_SETTINGS_UPDATE'].map((evt) => command('SUBSCRIBE', {}, evt).catch(() => {})))
    const settings = (await command('GET_VOICE_SETTINGS').catch(() => null)) as { mute?: unknown; deaf?: unknown } | null
    if (settings) update({ mute: settings.mute === true, deaf: settings.deaf === true })
    const ch = (await command('GET_SELECTED_VOICE_CHANNEL').catch(() => null)) as Record<string, unknown> | null
    if (gen !== generation) return
    if (ch && typeof ch.id === 'string') await followChannel(ch.id, true)
    else update({ channel: null })
  } catch (err) {
    if (gen !== generation) return
    closeSocket()
    const message = err instanceof Error ? err.message : String(err)
    update({ stage: hasSignIn() ? 'no-discord' : 'signed-out', error: message, me: null, channel: null })
    if (hasSignIn()) scheduleRetry()
  }
}

/** The connection dropped (Discord closed, restarted…). */
function lost(error: string | null): void {
  const wasReady = status.stage === 'ready'
  closeSocket()
  update({ stage: hasSignIn() ? 'no-discord' : idleStage(), me: null, channel: null, error })
  if (hasSignIn()) scheduleRetry(wasReady ? 3_000 : undefined)
}

/** Tries again in a while, so Orbit picks Discord up when you start it. */
function scheduleRetry(ms = 20_000): void {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void connect(false), ms)
}

// ---------------------------------------------------------------------------------------------
// Controls

/** Mutes / deafens (or un-), or flips it when `value` is left out. Returns the new status. */
export async function setVoice(which: 'mute' | 'deaf', value?: boolean): Promise<DiscordStatus> {
  if (status.stage !== 'ready') throw new Error(status.stage === 'no-discord' ? 'Discord isn’t open on this computer.' : 'Sign in to Discord in Orbit first.')
  const next = value ?? !status[which]
  const res = (await command('SET_VOICE_SETTINGS', { [which]: next })) as { mute?: unknown; deaf?: unknown } | null
  update({ mute: res?.mute === true, deaf: res?.deaf === true })
  return status
}

function needReady(): void {
  if (status.stage !== 'ready') throw new Error(status.stage === 'no-discord' ? 'Discord isn’t open on this computer.' : 'Sign in to Discord in Orbit first.')
}

/** How loud you hear one person (0 to 200), and muting them just for you. Nobody else hears a difference. */
export async function setUserVoice(userId: string, patch: { volume?: number; mute?: boolean }): Promise<DiscordStatus> {
  needReady()
  if (!/^\d+$/.test(userId)) throw new Error('Unknown person.')
  const args: Record<string, unknown> = { user_id: userId }
  if (patch.volume !== undefined) args.volume = clampVolume(patch.volume)
  if (patch.mute !== undefined) args.mute = !!patch.mute
  const res = (await command('SET_USER_VOICE_SETTINGS', args)) as { volume?: unknown; mute?: unknown } | null
  if (status.channel) {
    const volume = typeof res?.volume === 'number' ? clampVolume(res.volume) : (args.volume as number | undefined)
    const localMute = typeof res?.mute === 'boolean' ? res.mute : (args.mute as boolean | undefined)
    update({
      channel: {
        ...status.channel,
        members: patchMember(status.channel.members, userId, { ...(volume !== undefined ? { volume } : {}), ...(localMute !== undefined ? { localMute } : {}) })
      }
    })
  }
  return status
}

/** Leaves the voice channel. */
export async function leaveVoice(): Promise<void> {
  needReady()
  await command('SELECT_VOICE_CHANNEL', { channel_id: null })
}

/**
 * The pop-out's push-to-talk button: while it's held you're unmuted, and muted again when it's let
 * go. It only unmutes if you were muted (and not deafened), so it never mutes you by surprise.
 */
let talkingByButton = false
export async function pushToTalk(down: boolean): Promise<DiscordStatus> {
  needReady()
  if (down) {
    if (status.mute && !status.deaf && !talkingByButton) {
      talkingByButton = true
      await setVoice('mute', false)
    }
  } else if (talkingByButton) {
    talkingByButton = false
    await setVoice('mute', true)
  }
  return status
}

export const discordStatus = (): DiscordStatus => status

export function setupDiscord(): void {
  status = { ...EMPTY_DISCORD, canEncrypt: safeStorage.isEncryptionAvailable(), stage: idleStage(), clientId: load().clientId ?? null }

  ipcMain.handle('discord:get', () => status)
  ipcMain.handle('discord:save-app', (_e, clientId: string, secret: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the secret securely, so it wasn’t saved.')
    const id = String(clientId ?? '').trim()
    const sec = String(secret ?? '').trim()
    if (!validClientId(id)) throw new Error('That doesn’t look like an application id. It’s a long number, under General Information.')
    if (sec.length < 16) throw new Error('That doesn’t look like a client secret. Reset and copy it under OAuth2.')
    closeSocket()
    stored = { clientId: id, secret: encrypt(sec) }
    save()
    update({ ...EMPTY_DISCORD, canEncrypt: true, stage: 'signed-out', clientId: id })
    return status
  })
  ipcMain.handle('discord:sign-in', () => {
    void connect(true)
    return status
  })
  ipcMain.handle('discord:retry', () => {
    void connect(false)
    return status
  })
  ipcMain.handle('discord:sign-out', () => {
    clearTimeout(retryTimer)
    closeSocket()
    forgetSignIn()
    update({ ...EMPTY_DISCORD, canEncrypt: safeStorage.isEncryptionAvailable(), stage: idleStage(), clientId: load().clientId ?? null })
    return status
  })
  ipcMain.handle('discord:forget', () => {
    clearTimeout(retryTimer)
    closeSocket()
    stored = {}
    save()
    update({ ...EMPTY_DISCORD, canEncrypt: safeStorage.isEncryptionAvailable() })
    return status
  })
  ipcMain.handle('discord:set', (_e, which: unknown, value: unknown) => {
    if (which !== 'mute' && which !== 'deaf') throw new Error('Unknown control.')
    return setVoice(which, typeof value === 'boolean' ? value : undefined)
  })
  ipcMain.handle('discord:open-portal', () => shell.openExternal(DISCORD_PORTAL))
  ipcMain.handle('discord:user-voice', (_e, userId: unknown, patch: unknown) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as { volume?: unknown; mute?: unknown }
    return setUserVoice(String(userId ?? ''), {
      ...(typeof p.volume === 'number' ? { volume: p.volume } : {}),
      ...(typeof p.mute === 'boolean' ? { mute: p.mute } : {})
    })
  })
  ipcMain.handle('discord:leave', () => leaveVoice())
  ipcMain.handle('discord:push-to-talk', (_e, down: unknown) => pushToTalk(down === true))
  // Opens the voice channel in the Discord app (to type in its chat, or watch a stream there).
  ipcMain.handle('discord:open-channel', () => {
    const ch = status.channel
    const link = ch && channelLink(ch.guildId, ch.id)
    if (link) return shell.openExternal(link)
    return undefined
  })
  // Signs in again, so Discord asks for the newer permissions (reading the chat).
  ipcMain.handle('discord:reauthorize', () => {
    forgetSignIn()
    void connect(true)
    return status
  })
  ipcMain.handle('discord:calls', () => loadCalls())
  ipcMain.handle('discord:remove-call', (_e, id: unknown) => {
    calls = loadCalls().filter((c) => c.id !== id)
    saveCalls()
    return calls
  })
  ipcMain.handle('discord:clear-calls', () => {
    calls = []
    saveCalls()
    return calls
  })

  // A saved sign-in connects quietly at start (and whenever Discord starts later).
  if (hasSignIn()) void connect(false)
}

export function teardownDiscord(): void {
  clearTimeout(retryTimer)
  // Quitting mid-call still keeps the call in the history.
  finishCall()
  closeSocket()
}
