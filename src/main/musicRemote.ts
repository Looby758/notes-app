import { ipcMain } from 'electron'
import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import { artPathFrom, cleanRemoteCommand, remoteFileName, remoteState, type RemoteFile } from '@shared/musicRemote'
import { endSession, lanAddress, newToken, openSession } from './phoneLink'
import { musicRemoteHtml } from './musicRemotePage'
import { lastMusic, musicCommand, onMusic } from './musicMini'
import { cover, musicFolder } from './localMusic'
import { loadSettings, saveSettings } from './settings'
import type { MusicRemoteStatus } from '@shared/types'
import { logError } from './log'
import { addonOn } from './addonGate'

/**
 * The music phone remote (shared/musicRemote.ts): a page on the Wi-Fi that controls the music
 * playing in Orbit. It has its own link, separate from the paired phone (which can also open it), so
 * it only ever reaches the music. While it's on, "orbit-remote-<computer>.json" in the music folder
 * tells the Orbit Music phone app where to find it.
 */

let session: { token: string; port: number; close: () => void } | null = null
const clients = new Set<ServerResponse>()
let offMusic: (() => void) | null = null

/** The computer's name as the phone app shows it ("Loobys-PC", without ".local"). */
const computerName = (): string => hostname().replace(/\.local$/i, '') || 'Computer'

function broadcast(): void {
  for (const res of clients) {
    const base = (res as ServerResponse & { remoteBase?: string }).remoteBase ?? ''
    res.write(`data: ${JSON.stringify(remoteState(lastMusic(), base))}\n\n`)
  }
}

function connect(req: IncomingMessage, res: ServerResponse, base: string): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
  ;(res as ServerResponse & { remoteBase?: string }).remoteBase = base
  res.write(`data: ${JSON.stringify(remoteState(lastMusic(), base))}\n\n`)
  clients.add(res)
  offMusic ??= onMusic(broadcast)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
    if (!clients.size) {
      offMusic?.()
      offMusic = null
    }
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 10_000) {
        reject(new Error('Too big'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
}

/**
 * Answers the remote's requests: the page, its live updates, button presses and covers. Used by the
 * remote's own link and by the paired phone page (under its /music).
 */
export async function handleMusicRemote(req: IncomingMessage, res: ServerResponse, rest: string, base: string): Promise<void> {
  if (req.method === 'GET' && (rest === '/' || rest === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return void res.end(musicRemoteHtml(base))
  }
  if (req.method === 'GET' && rest === '/events') return connect(req, res, base)
  if (req.method === 'GET' && rest.startsWith('/art/')) {
    const path = artPathFrom(rest.slice('/art/'.length))
    const pic = path ? await cover(path).catch(() => null) : null
    if (!pic) return void res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': pic.type, 'Cache-Control': 'max-age=3600' })
    return void res.end(Buffer.from(pic.data))
  }
  if (req.method === 'POST' && rest === '/cmd') {
    let command
    try {
      command = cleanRemoteCommand(JSON.parse(await readBody(req)))
    } catch {
      command = null
    }
    if (!command) return json(res, 400, { error: 'Orbit didn’t understand that button.' })
    if (!lastMusic()?.state) return json(res, 200, { error: 'Open Orbit’s music player on the computer first.' })
    musicCommand(command)
    return json(res, 200, { ok: true })
  }
  json(res, 404, { error: 'Not found' })
}

// ---------- The file the phone app finds it by ----------

function writeRemoteFile(url: string): void {
  const folder = musicFolder()
  if (!folder) return
  const file = join(folder, remoteFileName(computerName()))
  const value: RemoteFile = { name: computerName(), url, updated: Date.now() }
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    logError('writing the music remote file', err)
  }
}

function removeRemoteFile(): void {
  const folder = musicFolder()
  if (!folder) return
  const file = join(folder, remoteFileName(computerName()))
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch (err) {
    logError('removing the music remote file', err)
  }
}

// ---------- On and off ----------

async function start(fresh = false): Promise<MusicRemoteStatus> {
  if (session && !fresh) {
    const url = `http://${lanAddress()}:${session.port}/s/${session.token}`
    writeRemoteFile(url)
    return { on: true, url, connected: clients.size }
  }
  if (session) {
    session.close()
    for (const res of clients) res.end()
    clients.clear()
  }
  const saved = loadSettings()
  const token = !fresh && saved.musicRemoteToken ? saved.musicRemoteToken : newToken()
  // The same port as last time (or the paired phone's), so a phone's saved link keeps working after a restart.
  const s = await openSession((req, res, rest, base) => handleMusicRemote(req, res, rest, base), { minutes: null, token, preferredPort: saved.musicRemotePort ?? saved.phonePort })
  session = { token, port: s.port, close: s.close }
  saveSettings({ musicRemote: true, musicRemoteToken: token, musicRemotePort: s.port })
  writeRemoteFile(s.url)
  return { on: true, url: s.url, connected: clients.size }
}

function stop(): MusicRemoteStatus {
  if (session) endSession(session.token)
  session = null
  for (const res of clients) res.end()
  clients.clear()
  saveSettings({ musicRemote: false })
  removeRemoteFile()
  return { on: false, url: null, connected: 0 }
}

async function status(): Promise<MusicRemoteStatus> {
  if (!session) return { on: false, url: null, connected: 0 }
  try {
    return await start()
  } catch (err) {
    return { on: true, url: null, connected: clients.size, error: err instanceof Error ? err.message : String(err) }
  }
}

export function setupMusicRemote(): void {
  ipcMain.handle('musicRemote:status', () => status())
  ipcMain.handle('musicRemote:set', async (_e, on: boolean, fresh?: boolean) => {
    try {
      return on ? await start(fresh === true) : stop()
    } catch (err) {
      return { on: false, url: null, connected: 0, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // On last time Orbit was open: on again (the phone's saved link keeps working).
  if (loadSettings().musicRemote && addonOn('music')) start().catch((err) => logError('music remote', err))
}
