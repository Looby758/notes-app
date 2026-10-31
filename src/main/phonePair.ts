import { clipboard, ipcMain, type BrowserWindow } from 'electron'
import type { IncomingMessage, ServerResponse } from 'http'
import { basename } from 'path'
import type { DeckButton, PhoneEvent, PhonePairing, PhoneScreen } from '@shared/types'
import { endSession, lanAddress, newToken, openSession } from './phoneLink'
import { phoneAppHtml } from './phoneApp'
import { sendInput, type PhoneInput } from './phoneInput'
import { lastMusic, musicCommand, onMusic } from './musicMini'
import { youTubeControl, type YouTubeAction } from './youtube'
import { readPrintedText } from './handwriting'
import { currentWifi } from './wifi'
import { loadSettings, saveSettings } from './settings'
import { logError } from './log'

/**
 * Your phone, paired: scan one QR code and the phone gets a page (it can go on the Home Screen)
 * with Send, Clipboard, Remote, Touchpad, Talk and Scan. The pairing is remembered, on the same
 * port, so the page reconnects by itself whenever Notes is open, until you choose Forget phone.
 */

const MAX_UPLOAD = 100 * 1024 * 1024
const MUSIC_ACTIONS = new Set(['toggle', 'next', 'previous'])
const YOUTUBE_ACTIONS = new Set(['toggle', 'back', 'forward', 'next'])

let getWindow: () => BrowserWindow | null
let saveFile: (name: string, data: Uint8Array) => Promise<string>
let current: { token: string; port: number } | null = null
const clients = new Set<ServerResponse>()
let clipTimer: ReturnType<typeof setInterval> | undefined
let lastClip = ''
let offMusic: (() => void) | null = null
let deck: DeckButton[] = []
let screenData: PhoneScreen | null = null

const toWindow = (event: PhoneEvent): void => getWindow()?.webContents.send('phone:event', event)

function broadcast(data: unknown): void {
  const line = `data: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(line)
}

function music(): unknown {
  const m = lastMusic()?.state
  return { type: 'music', playing: !!m?.playing, name: m?.track?.name ?? '', artist: m?.track?.artist ?? '', art: m?.track?.art ?? '' }
}

/** A phone has the page open: it hears the computer's clipboard and what's playing. */
function connect(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
  res.write(`data: ${JSON.stringify({ type: 'clip', text: clipboard.readText() })}\n\n`)
  res.write(`data: ${JSON.stringify(music())}\n\n`)
  res.write(`data: ${JSON.stringify({ type: 'deck', buttons: deck })}\n\n`)
  if (screenData) res.write(`data: ${JSON.stringify({ type: 'screen', ...screenData })}\n\n`)
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  if (clients.size === 1) {
    lastClip = clipboard.readText()
    clipTimer = setInterval(() => {
      const text = clipboard.readText()
      if (text === lastClip) return
      lastClip = text
      broadcast({ type: 'clip', text })
    }, 1500)
    offMusic = onMusic(() => broadcast(music()))
    toWindow({ type: 'connected', count: clients.size })
  }
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
    if (clients.size === 0) {
      clearInterval(clipTimer)
      offMusic?.()
      offMusic = null
    }
    toWindow({ type: 'connected', count: clients.size })
  })
}

function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('That file is too big (over 100 MB).'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
}

async function command(cmd: { kind?: string; [key: string]: unknown }): Promise<void> {
  switch (cmd.kind) {
    case 'music':
      if (MUSIC_ACTIONS.has(cmd.action as string)) musicCommand({ action: cmd.action as 'toggle' })
      return
    case 'youtube':
      if (!YOUTUBE_ACTIONS.has(cmd.action as string)) return
      if (!(await youTubeControl(cmd.action as YouTubeAction))) throw new Error('Open the YouTube mini window in Notes first.')
      return
    case 'move':
    case 'click':
    case 'scroll':
    case 'type':
    case 'key':
      return sendInput(cmd as PhoneInput)
    case 'dictate':
      toWindow({ type: 'dictate', id: String(cmd.id ?? ''), text: String(cmd.text ?? '').slice(0, 20_000), done: cmd.done === true })
      return
    case 'clip':
      lastClip = String(cmd.text ?? '')
      clipboard.writeText(lastClip)
      return
    case 'deck': {
      const button = deck.find((b) => b.id === cmd.id)
      if (!button) throw new Error('That button isn’t on the deck any more.')
      const win = getWindow()
      if (!win || win.isDestroyed()) throw new Error('Open Orbit on your computer first.')
      if (button.show) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      toWindow({ type: 'deck', id: button.id })
      return
    }
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, rest: string, base: string): Promise<void> {
  if (req.method === 'GET' && rest === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return void res.end(phoneAppHtml(base))
  }
  if (req.method === 'GET' && rest === '/events') return connect(req, res)
  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' })
  try {
    if (rest === '/cmd') {
      await command(JSON.parse((await body(req, 100_000)).toString('utf8')))
      return json(res, 200, { ok: true })
    }
    if (rest === '/upload') {
      const params = new URL(req.url ?? '', 'http://phone').searchParams
      const into = params.get('into')
      const name = basename(params.get('name') || 'From phone').slice(0, 120)
      const data = await body(req, MAX_UPLOAD)
      const path = await saveFile(name, data)
      if (into === 'receipt') toWindow({ type: 'receipt', path, text: await readPrintedText(data) })
      else toWindow({ type: 'file', path, into: into === 'note' ? 'note' : 'folder' })
      return json(res, 200, { ok: true, path })
    }
  } catch (err) {
    return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
  }
  json(res, 404, { error: 'Not found' })
}

/** A heads-up on the phone (a reminder going off, new messages): shown while the Orbit page is open there. */
export function phoneNotify(title: string, body: string): void {
  if (clients.size) broadcast({ type: 'notify', title: title.slice(0, 200), body: body.slice(0, 500) })
}

const cleanDeck = (v: unknown): DeckButton[] =>
  (Array.isArray(v) ? v : [])
    .filter((b): b is DeckButton => !!b && typeof b.id === 'string' && typeof b.label === 'string' && typeof b.icon === 'string')
    .slice(0, 40)
    .map((b) => ({ id: b.id.slice(0, 40), label: b.label.slice(0, 40), icon: b.icon.slice(0, 8), show: b.show === true }))

/** Starts the paired session (a remembered one if there is one) and returns its QR address. */
async function pair(fresh = false): Promise<PhonePairing> {
  const saved = loadSettings()
  // The address is worked out again each time, in case the computer has moved to another network.
  if (current && !fresh) return { url: `http://${lanAddress()}:${current.port}/s/${current.token}`, connected: clients.size }
  if (current) endSession(current.token)
  const token = !fresh && saved.phoneToken ? saved.phoneToken : newToken()
  const session = await openSession((req, res, rest, base) => handle(req, res, rest, base), { minutes: null, token, preferredPort: saved.phonePort })
  current = { token, port: session.port }
  saveSettings({ phoneToken: token, phonePort: session.port })
  return { url: session.url, connected: clients.size }
}

function forget(): void {
  if (current) endSession(current.token)
  current = null
  for (const res of clients) res.end()
  clients.clear()
  saveSettings({ phoneToken: undefined, phonePort: undefined })
}

export function setupPhonePair(
  window: () => BrowserWindow | null,
  save: (name: string, data: Uint8Array) => Promise<string>
): void {
  getWindow = window
  saveFile = save
  ipcMain.handle('phone:pair', (_e, fresh?: boolean) => pair(fresh === true))
  ipcMain.handle('phone:forget', () => forget())
  ipcMain.handle('phone:wifi', () => currentWifi())
  ipcMain.handle('phone:setDeck', (_e, buttons: unknown) => {
    deck = cleanDeck(buttons)
    broadcast({ type: 'deck', buttons: deck })
  })
  ipcMain.handle('phone:setScreen', (_e, data: PhoneScreen) => {
    if (!data || typeof data !== 'object') return
    screenData = data
    broadcast({ type: 'screen', ...data })
  })
  ipcMain.handle('phone:notify', (_e, title: string, body: string) => phoneNotify(String(title), String(body)))
  // A phone paired before reconnects as soon as Notes is open again.
  if (loadSettings().phoneToken) pair().catch((err) => logError('phone link', err))
}
