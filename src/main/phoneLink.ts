import { ipcMain, type BrowserWindow } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { networkInterfaces } from 'os'
import { basename, extname } from 'path'
import { contentDisposition, escapeHtml, formatBytes, isShareableLink, pickLanAddress } from '@shared/phoneLink'
import type { PhoneShare } from '@shared/types'
import { logError } from './log'

/**
 * The phone link: a small web server on the local Wi-Fi that a phone reaches by scanning a QR
 * code, with nothing to install on the phone. Each thing shared gets its own session, addressed by
 * an unguessable token, that ends on its own after a while; the server stops when none are left.
 *
 * Other features can open their own sessions (`openSession`) with whatever handler they need, e.g.
 * a page the phone sends photos back through.
 */

/** Handles one session's requests; `rest` is the path after the session's address `base` ("/" for the address itself). */
export type SessionHandler = (req: IncomingMessage, res: ServerResponse, rest: string, base: string) => void | Promise<void>

interface Session {
  handler: SessionHandler
  timer?: ReturnType<typeof setTimeout>
}

const SHARE_MINUTES = 10
const sessions = new Map<string, Session>()
let server: Server | null = null
let listening: Promise<number> | null = null

/** Starts the server, on `preferredPort` if it's free (so a saved phone link keeps working), else any free port. */
function start(preferredPort = 0): Promise<number> {
  listening ??= new Promise<number>((resolve, reject) => {
    const listen = (port: number): void => {
      const s = createServer((req, res) => void route(req, res))
      s.on('error', (err: NodeJS.ErrnoException) => {
        if (port !== 0 && err.code === 'EADDRINUSE') return listen(0)
        logError('phone link', err)
        server = null
        listening = null
        reject(err)
      })
      // Every interface, so the phone can reach it over Wi-Fi.
      s.listen(port, '0.0.0.0', () => resolve((s.address() as { port: number }).port))
      server = s
    }
    listen(preferredPort)
  })
  return listening
}

export function endSession(token: string): void {
  const s = sessions.get(token)
  if (!s) return
  clearTimeout(s.timer)
  sessions.delete(token)
  if (sessions.size === 0 && server) {
    server.close()
    server = null
    listening = null
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const match = /^\/s\/([A-Za-z0-9_-]{22})(\/[^?]*)?/.exec(req.url ?? '')
  const session = match && sessions.get(match[1])
  if (!match || !session) return page(res, 404, 'This link has run out', 'Make a new QR code in Notes and scan it again.')
  try {
    await session.handler(req, res, match[2] || '/', `/s/${match[1]}`)
  } catch (err) {
    logError('phone link', err)
    if (!res.headersSent) page(res, 500, 'Something went wrong', 'Try again from Notes.')
    else res.destroy()
  }
}

export interface SessionOptions {
  /** How long it lasts; null for as long as Notes is open (until `close`). */
  minutes?: number | null
  /** Reuse a token (a phone that's already paired); otherwise a new one is made. */
  token?: string
  preferredPort?: number
}

/** Starts a session; its address is what goes in the QR code. Ends after `minutes`, or when `close` is called. */
export async function openSession(handler: SessionHandler, options: SessionOptions = {}): Promise<PhoneShare & { port: number; close: () => void }> {
  const address = lanAddress()
  const port = await start(options.preferredPort)
  const token = options.token ?? newToken()
  const minutes = options.minutes === undefined ? SHARE_MINUTES : options.minutes
  clearTimeout(sessions.get(token)?.timer)
  sessions.set(token, { handler, timer: minutes === null ? undefined : setTimeout(() => endSession(token), minutes * 60_000) })
  return {
    token,
    url: `http://${address}:${port}/s/${token}`,
    expiresAt: minutes === null ? 0 : Date.now() + minutes * 60_000,
    port,
    close: () => endSession(token)
  }
}

export const newToken = (): string => randomBytes(16).toString('base64url')

export function lanAddress(): string {
  const address = pickLanAddress(networkInterfaces())
  if (!address) throw new Error('This computer isn’t on a Wi-Fi or local network, so a phone can’t reach it.')
  return address
}

/** A plain, phone-sized page. `above` and `below` are trusted HTML around the (escaped) title and text. */
export function page(res: ServerResponse, status: number, title: string, text: string, extra: { above?: string; below?: string } = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;font:17px/1.45 system-ui,-apple-system,sans-serif;background:#16161c;color:#e8e8ee;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
main{padding:24px;max-width:420px}h1{font-size:22px;margin:0 0 6px;word-break:break-word}p{color:#9a9aa8;margin:0 0 22px}
img{max-width:100%;max-height:50vh;border-radius:10px;margin-bottom:20px}
a.btn{display:inline-block;background:#7c6cf0;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600}
</style></head><body><main>${extra.above ?? ''}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${extra.below ?? ''}</main></body></html>`)
}

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

/** Shares a file: a page with its name, size (and a preview for pictures), and a Download button. */
async function shareFile(full: string, onDelivered: () => void): Promise<PhoneShare> {
  const info = await stat(full)
  if (!info.isFile()) throw new Error('Only files can be sent to a phone.')
  const name = basename(full)
  const type = TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  const picture = type.startsWith('image/') && type !== 'image/heic'
  const { token, url, expiresAt } = await openSession((req, res, rest, base) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end()
    if (rest === '/') {
      return page(res, 200, name, formatBytes(info.size), {
        above: picture ? `<img src="${base}/view" alt="">` : '',
        below: `<a class="btn" href="${base}/file" download>Download</a>`
      })
    }
    if (rest !== '/file' && rest !== '/view') return page(res, 404, 'Not found', '')
    const view = rest === '/view'
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Content-Disposition': contentDisposition(name, view) })
    if (req.method === 'HEAD') return void res.end()
    const stream = createReadStream(full)
    stream.on('error', () => res.destroy())
    if (!view) res.on('finish', onDelivered)
    stream.pipe(res)
  })
  return { token, url, expiresAt }
}

/** Shares a link: the phone just opens it. */
async function shareLink(link: string, onDelivered: () => void): Promise<PhoneShare> {
  if (!isShareableLink(link)) throw new Error('Only web links can be sent to a phone.')
  const { token, url, expiresAt } = await openSession((_req, res) => {
    res.writeHead(302, { Location: link }).end()
    onDelivered()
  })
  return { token, url, expiresAt }
}

/** Sending notes, attachments and web links to a phone; the window hears `phone:delivered` once the phone has it. */
export function setupPhoneLink(getWindow: () => BrowserWindow | null, abs: (path: string) => string): void {
  const share = async (make: (onDelivered: () => void) => Promise<PhoneShare>): Promise<PhoneShare> => {
    let token = ''
    const made = await make(() => getWindow()?.webContents.send('phone:delivered', token))
    token = made.token
    return made
  }
  ipcMain.handle('phone:shareFile', (_e, path: string) => share((done) => shareFile(abs(path), done)))
  ipcMain.handle('phone:shareLink', (_e, link: string) => share((done) => shareLink(link, done)))
  ipcMain.handle('phone:stop', (_e, token: string) => endSession(token))
}
