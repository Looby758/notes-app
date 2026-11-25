import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  BRIDGE_SCRIPT,
  bridgeEntry,
  claudeConfigPaths,
  cleanAreas,
  CLAUDE_AREAS,
  hasOrbitServer,
  NOT_READY,
  withOrbitServer,
  withoutOrbitServer,
  type ClaudeArea,
  type ClaudeDesktopStatus,
  type ConnectResult
} from '@shared/claudeDesktop'
import { loadSettings, saveSettings } from './settings'
import { registerOrbitTools, type ToolDeps } from './claudeTools'
import { knownFolders, releaseMemory, studioErrors } from './studioErrors'
import { lookAtRelease } from './releaseHelper'
import { logError } from './log'

/**
 * The Claude Desktop connection: an MCP server (the way Claude Desktop talks to other apps) inside
 * Orbit, so you can ask Claude about App Studio's errors, your notes, calendar and the rest.
 *
 * - Off until you switch it on in Settings → AI helper.
 * - Listens on 127.0.0.1 only: other computers and phones on the Wi-Fi can't reach it (unlike the
 *   phone remote, which is meant to be reached from the phone).
 * - Every request needs a secret token, kept encrypted in settings.json (safeStorage, like the other
 *   sign-ins). Claude Desktop gets a copy in its own settings file when you press Connect.
 * - Claude Desktop starts MCP servers as a program, so it runs a tiny bridge (BRIDGE_SCRIPT) with
 *   Orbit's own program as Node, which passes messages to this server. No API key: Claude Desktop
 *   uses your Claude plan.
 */

const BRIDGE_FILE = 'claude-desktop-bridge.cjs'
const PORT_FILE = 'claude-desktop-port.json'
const userData = (): string => app.getPath('userData')
const portFile = (): string => join(userData(), PORT_FILE)
const bridgeFile = (): string => join(userData(), BRIDGE_FILE)

let server: Server | null = null
let port: number | null = null
let getWindow: () => BrowserWindow | null = () => null

// ---------- The token ----------

function readToken(): string | null {
  const saved = loadSettings().claudeDesktopToken
  if (!saved || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(saved, 'base64'))
  } catch {
    return null
  }
}

function makeToken(): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the connection’s secret securely, so it can’t be switched on.')
  const token = randomBytes(32).toString('base64url')
  saveSettings({ claudeDesktopToken: safeStorage.encryptString(token).toString('base64') })
  return token
}

const tokenNow = (): string => readToken() ?? makeToken()

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim()
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------- Asking the window ----------

let nextAsk = 1
const waiting = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()

/** Asks Orbit's window for an answer (it has the notes, calendar and the rest loaded). */
export function askWindow(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return Promise.reject(new Error(NOT_READY))
  const id = nextAsk++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('Orbit took too long to answer. Try again.'))
    }, timeoutMs)
    waiting.set(id, { resolve, reject, timer })
    win.webContents.send('claude:ask', { id, name, args })
  })
}

function answered(id: unknown, ok: unknown, value: unknown): void {
  const w = typeof id === 'number' ? waiting.get(id) : undefined
  if (!w) return
  waiting.delete(id as number)
  clearTimeout(w.timer)
  if (ok === true) w.resolve(typeof value === 'string' ? value : JSON.stringify(value))
  else w.reject(new Error(typeof value === 'string' && value ? value : 'Orbit couldn’t do that.'))
}

// ---------- The server ----------

function deps(): ToolDeps {
  return {
    areas: cleanAreas(loadSettings().claudeDesktopAreas),
    ask: (name, args) => askWindow(name, args),
    errors: studioErrors,
    knownFolders,
    memory: releaseMemory,
    look: lookAtRelease
  }
}

/** A new MCP server with the tools for the parts that are switched on (one for each request). */
export function orbitMcpServer(d: ToolDeps = deps()): McpServer {
  const mcp = new McpServer(
    { name: 'orbit', version: app.getVersion?.() ?? '1.0.0' },
    {
      instructions:
        'Orbit is the user’s notes app. These tools read (and in a few cases change) what’s in it: App Studio’s errors and release checks, the Ideas & bugs board, notes, calendar, countdowns, money, flashcards, files, downloads, music and email, for whichever parts the user switched on. Passwords, locked notes and keys are never available.'
    }
  )
  registerOrbitTools(mcp, d)
  return mcp
}

function readBody(req: IncomingMessage, max = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('Too big'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const refuse = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }))
}

/** Answers one request from the bridge. Exported for tests. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse, token: string, makeServer: () => McpServer = () => orbitMcpServer()): Promise<void> {
  // A web page can send requests to this computer too: those come with an Origin (and a Host that
  // isn't this address), and are turned away before the token is even looked at.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (req.headers.origin || (host !== '127.0.0.1' && host !== 'localhost')) return refuse(res, 403, 'Not allowed')
  if (!tokenMatches(req.headers.authorization, token)) return refuse(res, 401, 'Wrong token')
  if ((req.url ?? '').split('?')[0] !== '/mcp') return refuse(res, 404, 'Not found')
  if (req.method !== 'POST') return refuse(res, 405, 'Only POST')
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return refuse(res, 400, 'Orbit couldn’t read that message.')
  }
  // Stateless: every message gets its own server and transport, so nothing is kept between them.
  const mcp = makeServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void mcp.close()
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res, body)
}

function writePortFile(p: number | null): void {
  try {
    if (p === null) rmSync(portFile(), { force: true })
    else {
      const tmp = `${portFile()}.tmp`
      writeFileSync(tmp, JSON.stringify({ port: p }))
      renameSync(tmp, portFile())
    }
  } catch (err) {
    logError('Claude Desktop port file', err)
  }
}

async function start(): Promise<void> {
  if (server) return
  const token = tokenNow()
  const s = createServer((req, res) => {
    handleRequest(req, res, token).catch((err) => {
      logError('Claude Desktop request', err)
      if (!res.headersSent) refuse(res, 500, 'Something went wrong in Orbit.')
    })
  })
  const listen = (p: number): Promise<number> =>
    new Promise((resolve, reject) => {
      s.once('error', reject)
      s.listen(p, '127.0.0.1', () => {
        s.off('error', reject)
        resolve((s.address() as { port: number }).port)
      })
    })
  const preferred = loadSettings().claudeDesktopPort ?? 0
  try {
    port = await listen(preferred)
  } catch (err) {
    if (preferred === 0) throw err
    port = await listen(0)
  }
  server = s
  writePortFile(port)
  saveSettings({ claudeDesktop: true, claudeDesktopPort: port })
}

function stop(): void {
  server?.close()
  server = null
  port = null
  writePortFile(null)
  for (const [id, w] of waiting) {
    clearTimeout(w.timer)
    w.reject(new Error('The Claude Desktop connection was switched off in Orbit.'))
    waiting.delete(id)
  }
}

// ---------- Claude Desktop's settings file ----------

/** Where Claude Desktop's settings are (or would be) on this computer. */
export function configFiles(): string[] {
  let packages: string[] = []
  const local = process.env.LOCALAPPDATA
  if (process.platform === 'win32' && local) {
    try {
      packages = readdirSync(join(local, 'Packages')).filter((p) => /^Claude_/i.test(p))
    } catch {
      packages = []
    }
  }
  return claudeConfigPaths(process.platform, { home: homedir(), appData: process.env.APPDATA, localAppData: local, packages })
}

/** The files Claude Desktop is set up in: the ones that exist (or, if none does yet, the usual one). */
function targetFiles(): string[] {
  const all = configFiles()
  const there = all.filter((f) => existsSync(f) || existsSync(dirname(f)))
  return there.length ? there : all.slice(0, 1)
}

function writeBridge(): void {
  if (existsSync(bridgeFile()) && readFileSync(bridgeFile(), 'utf8') === BRIDGE_SCRIPT) return
  writeFileSync(bridgeFile(), BRIDGE_SCRIPT)
}

/** Sets Claude Desktop up to start Orbit's bridge: writes its settings file (backing up the old one). */
function connect(): ConnectResult {
  const token = tokenNow()
  writeBridge()
  const entry = bridgeEntry(process.execPath, bridgeFile(), portFile(), token)
  const files = targetFiles()
  let wrote: string | null = null
  let problem = ''
  for (const file of files) {
    try {
      const existing = existsSync(file) ? readFileSync(file, 'utf8') : null
      const next = withOrbitServer(existing, entry)
      mkdirSync(dirname(file), { recursive: true })
      if (existing !== null) copyFileSync(file, `${file}.before-orbit`)
      const tmp = `${file}.tmp`
      writeFileSync(tmp, next)
      renameSync(tmp, file)
      wrote ??= file
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err)
      logError('setting up Claude Desktop', err)
    }
  }
  if (wrote) return { written: true, file: wrote, message: 'Done. Quit Claude Desktop completely and open it again, and Orbit will be in its list of connectors.' }
  return {
    written: false,
    file: files[0],
    text: JSON.stringify({ mcpServers: { orbit: entry } }, null, 2),
    message: `Orbit couldn’t change Claude Desktop’s settings file (${problem || 'it couldn’t be written'}). Copy the text below into it by hand.`
  }
}

/** Takes Orbit back out of Claude Desktop's settings (when you switch the connection off). */
function disconnect(): void {
  for (const file of configFiles()) {
    try {
      if (!existsSync(file)) continue
      const next = withoutOrbitServer(readFileSync(file, 'utf8'))
      if (next !== null) writeFileSync(file, next)
    } catch (err) {
      logError('removing Orbit from Claude Desktop', err)
    }
  }
}

function connected(): boolean {
  const token = readToken()
  if (!token) return false
  return configFiles().some((f) => {
    try {
      return existsSync(f) && hasOrbitServer(readFileSync(f, 'utf8'), token)
    } catch {
      return false
    }
  })
}

function status(error?: string): ClaudeDesktopStatus {
  const s = loadSettings()
  return { on: !!server, areas: cleanAreas(s.claudeDesktopAreas), connected: connected(), canEncrypt: safeStorage.isEncryptionAvailable(), error: error ?? (s.claudeDesktop && !server ? 'It’s switched on but couldn’t start. Switch it off and on again.' : undefined) }
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function setupClaudeDesktop(window: () => BrowserWindow | null): void {
  getWindow = window
  ipcMain.on('claude:answer', (e, id: unknown, ok: unknown, value: unknown) => {
    const win = getWindow()
    if (win && e.sender === win.webContents) answered(id, ok, value)
  })
  ipcMain.handle('claude:status', () => status())
  ipcMain.handle('claude:set', async (_e, on: unknown) => {
    try {
      if (on === true) await start()
      else {
        stop()
        saveSettings({ claudeDesktop: false })
      }
      return status()
    } catch (err) {
      logError('Claude Desktop connection', err)
      stop()
      saveSettings({ claudeDesktop: false })
      return status(errorText(err))
    }
  })
  ipcMain.handle('claude:setArea', (_e, area: unknown, on: unknown) => {
    if (!CLAUDE_AREAS.some((a) => a.id === area) || typeof on !== 'boolean') throw new Error('Not allowed')
    saveSettings({ claudeDesktopAreas: { ...cleanAreas(loadSettings().claudeDesktopAreas), [area as ClaudeArea]: on } })
    return status()
  })
  ipcMain.handle('claude:connect', () => {
    try {
      return connect()
    } catch (err) {
      return { written: false, file: configFiles()[0], message: errorText(err) } satisfies ConnectResult
    }
  })
  // A new secret: whatever had the old one (Claude Desktop) has to be connected again.
  ipcMain.handle('claude:newToken', async () => {
    const wasOn = !!server
    const wasConnected = connected()
    stop()
    makeToken()
    if (wasOn) await start()
    if (wasConnected) connect()
    return status()
  })
  ipcMain.handle('claude:disconnect', () => {
    disconnect()
    return status()
  })
  if (loadSettings().claudeDesktop) start().catch((err) => logError('Claude Desktop connection', err))
  app.on('will-quit', () => writePortFile(null))
}
