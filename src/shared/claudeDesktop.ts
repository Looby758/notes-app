import type { Problem } from './releaseCheck'
import type { BoardColumn, BoardItem } from './appStudio'

/**
 * Claude Desktop connection (main/claudeDesktop.ts): a small server inside Orbit, reachable only
 * from this computer, that Claude Desktop talks to (through a bridge it starts, see BRIDGE_SCRIPT)
 * so you can ask Claude about your notes, calendar, App Studio errors and so on. Off until you
 * switch it on in Settings → AI, and each part of Orbit can be left out.
 */

// ---------- The parts of Orbit Claude can see ----------

export type ClaudeArea = 'appStudio' | 'notes' | 'calendar' | 'clocks' | 'money' | 'flashcards' | 'files' | 'music' | 'videos' | 'computer' | 'look' | 'games' | 'discord' | 'phone' | 'web' | 'clipboard' | 'email'

export const CLAUDE_AREAS: readonly { id: ClaudeArea; label: string; what: string; onAtStart: boolean }[] = [
  { id: 'notes', label: 'Notes', what: 'Find, read, open, make, change, rename, move, copy and delete notes, daily notes, tasks, tags, links and folders (deleted ones go to the bin), and show or make mind maps. Locked notes are never shown.', onAtStart: true },
  { id: 'calendar', label: 'Calendar, reminders and weather', what: 'See what’s coming up, add, move, rename and delete events (repeating ones and Google ones too), tick tasks, countdowns, reminders, the weather, finding free time to plan your week, and a morning briefing.', onAtStart: true },
  { id: 'clocks', label: 'World clocks', what: 'The time anywhere, converting times between places, when to message friends, and adding, renaming and removing clocks.', onAtStart: true },
  { id: 'money', label: 'Money', what: 'Read your spending, budgets and savings, a weekly check-in, splitting a bill, reading receipts and bank statements, and adding, changing and deleting entries, budgets, savings goals, who owes who, subscriptions and balances (Ctrl+Z undoes them).', onAtStart: true },
  { id: 'flashcards', label: 'Flashcards', what: 'See your cards and which ones you keep getting wrong, and add new ones.', onAtStart: true },
  { id: 'files', label: 'Files and downloads', what: 'Find files you’ve colour-tagged, find and read screenshots, see downloads and how full your drives are, and convert files (saved beside the original).', onAtStart: true },
  { id: 'music', label: 'Music', what: 'Play, queue, shuffle and loop songs and playlists, change the volume, make, edit and tidy playlists, like, rate and tag songs, fix song details, suggest songs, music for a mood, a DJ that fills Up next, routines like “gym” or “bedtime” (they can start at a time), and download songs from YouTube into your music.', onAtStart: true },
  { id: 'videos', label: 'Videos', what: 'Find videos in your notes folder and play them in the video player, including a show’s episodes (“play the next episode”), Up next, and pause, skip, speed and volume.', onAtStart: true },
  { id: 'computer', label: 'Task manager', what: 'See what’s running and how busy the computer is, and close a stuck program (Orbit asks you first).', onAtStart: true },
  { id: 'look', label: 'Home page, themes and focus', what: 'Arrange the Home page, change or make themes (one colour, with a picture behind if you like), and start focus mode: a study timer that holds Orbit’s pop-ups, with zen mode and music.', onAtStart: true },
  { id: 'games', label: 'Games and comics', what: 'Your Steam, Epic and other games with time played and what you played last, find and start a game (it asks when a name could mean more than one), hide games, mini game scores, Hypixel SkyBlock profile, goals and sessions, and comics (what you’re up to, open the next one).', onAtStart: true },
  { id: 'discord', label: 'Discord', what: 'Who’s in your call, mute and deafen, someone’s volume, leave, past calls and call notes.', onAtStart: true },
  { id: 'phone', label: 'Phone', what: 'Send a note, file or link to your phone, and alert your paired phone.', onAtStart: true },
  { id: 'web', label: 'Web, wikis and dictionary', what: 'Open sites in Orbit’s browser, your browser history and bookmarks, search and ask your downloaded wikis, and look up words.', onAtStart: true },
  { id: 'clipboard', label: 'Clipboard history', what: 'Remembers text you copy (not passwords, and only until Orbit closes) so Claude can find it, and copy text for you. Off unless you switch it on.', onAtStart: false },
  { id: 'appStudio', label: 'App Studio', what: 'Read errors and release checks, run tests, get the latest code, check packages, read and change cards on Ideas & bugs, pull requests, releases and bug reports. Merging or closing a pull request asks you first.', onAtStart: true },
  { id: 'email', label: 'Email', what: 'Search and read your emails. Off unless you switch it on.', onAtStart: false }
]

export const defaultAreas = (): Record<ClaudeArea, boolean> => Object.fromEntries(CLAUDE_AREAS.map((a) => [a.id, a.onAtStart])) as Record<ClaudeArea, boolean>

/** Saved switches, with anything missing or odd put back to its default. */
export function cleanAreas(raw: unknown): Record<ClaudeArea, boolean> {
  const out = defaultAreas()
  if (raw && typeof raw === 'object') for (const a of CLAUDE_AREAS) if (typeof (raw as Record<string, unknown>)[a.id] === 'boolean') out[a.id] = (raw as Record<string, boolean>)[a.id]
  return out
}

export interface ClaudeDesktopStatus {
  on: boolean
  areas: Record<ClaudeArea, boolean>
  /** Orbit has been added to Claude Desktop's settings file on this computer. */
  connected: boolean
  /** This computer can encrypt the token (needed to switch it on). */
  canEncrypt: boolean
  error?: string
}

export interface ConnectResult {
  /** Orbit wrote Claude Desktop's settings file itself. */
  written: boolean
  /** The file it wrote (or where the text below goes). */
  file: string
  /** What to paste, when Orbit couldn't write it. */
  text?: string
  message: string
}

// ---------- Keeping secrets out ----------

const SECRET_PATTERNS: RegExp[] = [
  // GitHub tokens.
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  // Anthropic, OpenAI and similar keys.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // Slack, Google, AWS.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // npm.
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  // JSON web tokens.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
]

/**
 * Text with anything that looks like a token, key or password blanked out, so nothing secret
 * reaches Claude even when a log happens to contain one (git sometimes prints the address it
 * pushed to, password and all).
 */
export function redactSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[hidden]')
  return (
    out
      // https://user:password@github.com → https://[hidden]@github.com
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[hidden]@')
      // Authorization: Bearer abc…, token=abc…, "password": "abc"
      .replace(/\b(authorization\s*:\s*(?:bearer|token|basic)\s+)\S+/gi, '$1[hidden]')
      .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, '$1[hidden]')
      .replace(/(["']?\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[hidden]')
  )
}

// ---------- App Studio's problems ----------

export type StudioErrorKind = 'preflight' | 'tests' | 'release' | 'build' | 'git' | 'packages'

export const STUDIO_ERROR_KINDS: Record<StudioErrorKind, string> = {
  preflight: 'Checks before a release',
  tests: 'Tests',
  release: 'Making the release',
  build: 'GitHub’s build',
  git: 'Git',
  packages: 'Installing packages'
}

export interface StudioError {
  id: string
  /** The app: its GitHub repository ("owner/name") when it has one, else its folder's name. */
  app: string
  folder: string
  /** ISO time. */
  at: string
  kind: StudioErrorKind
  /** Which step failed, in words ("Up to date", "Pushing", "build (windows-latest): Run tests"). */
  step: string
  title: string
  detail: string
  /** What git, npm or GitHub said. */
  output: string
}

export const MAX_STUDIO_ERRORS = 20
/** Enough of a log to see what went wrong, without one huge log pushing everything else out. */
export const MAX_ERROR_OUTPUT = 40_000

const cap = (text: string, max: number): string => (text.length > max ? `…${text.slice(-max)}` : text)

/**
 * The list with a new problem at the top, newest first, at most MAX_STUDIO_ERRORS. The same
 * problem seen again (App Studio checks some things every few minutes) moves to the top with its
 * new time and output instead of filling the list.
 */
export function addStudioError(list: readonly StudioError[], error: Omit<StudioError, 'id'> & { id?: string }): StudioError[] {
  const item: StudioError = {
    ...error,
    id: error.id ?? `e${Date.parse(error.at).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: redactSecrets(error.title).slice(0, 300),
    detail: redactSecrets(error.detail).slice(0, 2000),
    step: error.step.slice(0, 200),
    output: cap(redactSecrets(error.output), MAX_ERROR_OUTPUT)
  }
  const same = (e: StudioError): boolean => e.folder === item.folder && e.kind === item.kind && e.step === item.step && e.title === item.title
  return [item, ...list.filter((e) => !same(e))].slice(0, MAX_STUDIO_ERRORS)
}

/** A saved list, leaving out anything that isn't a proper problem. */
export function readStudioErrors(raw: unknown): StudioError[] {
  if (!Array.isArray(raw)) return []
  const str = (v: unknown): v is string => typeof v === 'string'
  return raw
    .filter(
      (e): e is StudioError =>
        !!e && typeof e === 'object' && str(e.id) && str(e.app) && str(e.folder) && str(e.at) && str(e.kind) && e.kind in STUDIO_ERROR_KINDS && str(e.step) && str(e.title) && str(e.detail) && str(e.output)
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_STUDIO_ERRORS)
}

const lastPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/**
 * Whether `app` (as Claude wrote it) names this app: its repository, the repository's name, or
 * its folder's name, in any case.
 */
export function appMatches(want: string, app: { repo?: string; name?: string; folder?: string }): boolean {
  const w = want.trim().toLowerCase()
  if (!w) return true
  const names = [app.repo, app.repo?.split('/')[1], app.name, app.folder, app.folder && lastPart(app.folder)].filter((n): n is string => !!n).map((n) => n.toLowerCase())
  return names.includes(w)
}

export function studioErrorsFor(list: readonly StudioError[], app?: string): StudioError[] {
  return app?.trim() ? list.filter((e) => appMatches(app, { repo: e.app.includes('/') ? e.app : undefined, name: e.app, folder: e.folder })) : [...list]
}

/** One problem as Claude reads it. */
export function studioErrorText(e: StudioError): string {
  return [`${e.title} (${STUDIO_ERROR_KINDS[e.kind]}: ${e.step})`, `App: ${e.app}`, `When: ${e.at}`, `Folder: ${e.folder}`, e.detail && `What Orbit said: ${e.detail}`, e.output && `Output:\n${e.output}`]
    .filter(Boolean)
    .join('\n')
}

/** A problem from the release helper, worded for the list. */
export const problemText = (p: Problem): { title: string; detail: string } => ({ title: p.title, detail: p.detail })

// ---------- The Ideas & bugs board ----------

export const CARD_COLUMNS: readonly BoardColumn[] = ['ideas', 'building', 'testing', 'done']

export interface CardForClaude {
  id: string
  app: string
  kind: BoardItem['kind']
  title: string
  details: string
  column: BoardColumn
  pull?: string
  issue?: string
  updated: string
}

/** The cards Claude sees: the ones not done yet (or all, when asked), for one app or every app. */
export function cardsForClaude(items: readonly BoardItem[], opts: { app?: string; includeDone?: boolean } = {}): CardForClaude[] {
  return items
    .filter((i) => opts.includeDone || i.column !== 'done')
    .filter((i) => !opts.app?.trim() || appMatches(opts.app, { repo: i.app.includes('/') ? i.app : undefined, name: i.app }))
    .map((i) => ({ id: i.id, app: i.app, kind: i.kind, title: i.title, details: redactSecrets(i.details), column: i.column, pull: i.pull, issue: i.issue, updated: i.updated }))
}

/**
 * A pull request as Claude might write it ("owner/name#12", "#12", "12", or its GitHub address)
 * in the board's own form ("owner/name#12"). `repo` fills in a bare number.
 */
export function parsePullRef(raw: string, repo?: string): string | null {
  const text = raw.trim()
  const url = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(text)
  if (url) return `${url[1]}#${Number(url[2])}`
  const full = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text)
  if (full) return `${full[1]}#${Number(full[2])}`
  const bare = /^#?(\d+)$/.exec(text)
  if (bare && repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) return `${repo}#${Number(bare[1])}`
  return null
}

// ---------- Connecting Claude Desktop ----------

/** The name Orbit has in Claude Desktop's list of connections. */
export const SERVER_NAME = 'orbit'

export interface BridgeEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * How Claude Desktop starts the bridge: Orbit's own program, run as plain Node (so nothing else
 * needs installing), with the bridge script and where to find Orbit.
 */
export function bridgeEntry(execPath: string, script: string, portFile: string, token: string): BridgeEntry {
  return { command: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', ORBIT_PORT_FILE: portFile, ORBIT_TOKEN: token } }
}

/**
 * Claude Desktop's settings with Orbit added (or updated), keeping everything else as it was.
 * Throws when the file isn't valid JSON, so a hand-edited file is never overwritten.
 */
export function withOrbitServer(existing: string | null, entry: BridgeEntry): string {
  let config: Record<string, unknown> = {}
  if (existing && existing.trim()) {
    const parsed = JSON.parse(existing) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Claude Desktop’s settings file isn’t in the form Orbit expected.')
    config = parsed as Record<string, unknown>
  }
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? (config.mcpServers as Record<string, unknown>) : {}
  return JSON.stringify({ ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } }, null, 2) + '\n'
}

/** Claude Desktop's settings without Orbit (when you switch the connection off). */
export function withoutOrbitServer(existing: string): string | null {
  const config = JSON.parse(existing) as Record<string, unknown>
  const servers = config.mcpServers as Record<string, unknown> | undefined
  if (!servers || typeof servers !== 'object' || !(SERVER_NAME in servers)) return null
  const { [SERVER_NAME]: _gone, ...rest } = servers
  return JSON.stringify({ ...config, mcpServers: rest }, null, 2) + '\n'
}

/** Whether Claude Desktop's settings already start Orbit's bridge with this token. */
export function hasOrbitServer(existing: string | null, token: string): boolean {
  if (!existing) return false
  try {
    const entry = (JSON.parse(existing) as { mcpServers?: Record<string, BridgeEntry> }).mcpServers?.[SERVER_NAME]
    return !!entry && entry.env?.ORBIT_TOKEN === token
  } catch {
    return false
  }
}

/**
 * The bridge Claude Desktop runs: it reads Claude's messages (one JSON message a line) and passes
 * each to Orbit's server on this computer, and Orbit's answers back. Plain Node with nothing to
 * install, written next to Orbit's settings when you connect. Orbit's port is read from a file each
 * time, so it keeps working if the port changes after a restart.
 */
export const BRIDGE_SCRIPT = `// Orbit's bridge for Claude Desktop. Orbit writes this file; changes are replaced.
'use strict'
const http = require('http')
const fs = require('fs')
const readline = require('readline')

const portFile = process.env.ORBIT_PORT_FILE
const token = process.env.ORBIT_TOKEN || ''
let session = null

function port() {
  try {
    const p = JSON.parse(fs.readFileSync(portFile, 'utf8')).port
    return Number.isInteger(p) ? p : null
  } catch (e) {
    return null
  }
}

function reply(id, message) {
  if (id === undefined || id === null) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: -32000, message: message } }) + '\\n')
}

function send(line) {
  return new Promise(function (resolve) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch (e) {
      return resolve()
    }
    const p = port()
    if (!p) {
      reply(msg.id, 'Orbit isn’t open, or its Claude Desktop connection is switched off. Open Orbit and try again.')
      return resolve()
    }
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token }
    if (session) headers['Mcp-Session-Id'] = session
    const req = http.request({ host: '127.0.0.1', port: p, path: '/mcp', method: 'POST', headers: headers }, function (res) {
      const sid = res.headers['mcp-session-id']
      if (sid) session = String(sid)
      let body = ''
      res.setEncoding('utf8')
      res.on('data', function (c) { body += c })
      res.on('end', function () {
        if (res.statusCode === 401) reply(msg.id, 'Orbit didn’t accept the connection. In Orbit, open Settings → AI helper and press Connect to Claude Desktop again, then restart Claude Desktop.')
        else if (res.statusCode === 404 && session) {
          // Orbit restarted: start again with a new session next time.
          session = null
          reply(msg.id, 'Orbit restarted. Ask again.')
        } else if (body.trim()) {
          const type = String(res.headers['content-type'] || '')
          if (type.indexOf('text/event-stream') !== -1) {
            body.split('\\n').forEach(function (l) {
              if (l.indexOf('data:') === 0 && l.slice(5).trim()) process.stdout.write(l.slice(5).trim() + '\\n')
            })
          } else process.stdout.write(body.trim() + '\\n')
        }
        resolve()
      })
    })
    req.on('error', function () {
      reply(msg.id, 'Orbit isn’t open, or its Claude Desktop connection is switched off. Open Orbit and try again.')
      resolve()
    })
    req.end(line)
  })
}

let queue = Promise.resolve()
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', function (line) {
  if (line.trim()) queue = queue.then(function () { return send(line) })
})
// Claude Desktop closed the pipe: finish what's asked, let the last answers reach it (writing to a
// pipe is asynchronous, so exiting straight away could cut them off), then stop.
lines.on('close', function () {
  queue.then(function () {
    process.stdout.write('', function () { process.exit(0) })
  })
})
`

/** Where Claude Desktop keeps its settings on Windows (both installs) and Mac. */
export function claudeConfigPaths(platform: NodeJS.Platform, env: { home: string; appData?: string; localAppData?: string; packages?: string[] }): string[] {
  if (platform === 'darwin') return [`${env.home}/Library/Application Support/Claude/claude_desktop_config.json`]
  if (platform === 'win32') {
    const out: string[] = []
    if (env.appData) out.push(`${env.appData}\\Claude\\claude_desktop_config.json`)
    // The Microsoft Store version keeps its own copy.
    for (const p of env.packages ?? []) if (env.localAppData) out.push(`${env.localAppData}\\Packages\\${p}\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json`)
    return out
  }
  return [`${env.home}/.config/Claude/claude_desktop_config.json`]
}

/** What the tools tell Claude when Orbit can't answer (the window isn't ready yet). */
export const NOT_READY = 'Orbit is still starting up, or has no notes folder open. Open Orbit and try again.'
