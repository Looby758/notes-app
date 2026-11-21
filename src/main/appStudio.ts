import { app, ipcMain, net, safeStorage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import { githubRepo, type AppInfo, type GitHubStatus, type PullRequest } from '@shared/appStudio'
import { logError } from './log'
import { TEST_COPY } from './testCopy'

/**
 * App Studio's side of things: what git knows about each app's folder, and its pull requests on
 * GitHub. Reading a public repository's pull requests works without signing in; private ones, and
 * merging or closing, need a GitHub token you paste in, stored encrypted (Electron safeStorage,
 * like the AI helper's key) in `app-studio.json`. Only GitHub is ever sent the token.
 */

const API = 'https://api.github.com'

interface Stored {
  /** Encrypted. */
  token?: string
  login?: string
}

const file = (): string => join(app.getPath('userData'), 'app-studio.json')

function load(): Stored {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Stored) : {}
  } catch {
    return {}
  }
}

function save(s: Stored): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, file())
}

function token(): string | null {
  const s = load()
  if (!s.token || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(s.token, 'base64'))
  } catch {
    return null
  }
}

function status(): GitHubStatus {
  const s = load()
  return { connected: !!s.token && token() !== null, login: s.login, canEncrypt: safeStorage.isEncryptionAvailable() }
}

class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function github<T>(path: string, init: { method?: string; body?: unknown; key?: string | null } = {}): Promise<T> {
  const key = init.key === undefined ? token() : init.key
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Orbit', 'X-GitHub-Api-Version': '2022-11-28' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await net.fetch(API + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  } catch {
    throw new GitHubError('Couldn’t reach GitHub. Check your internet connection.', 0)
  }
  if (!res.ok) {
    let message = ''
    try {
      message = ((await res.json()) as { message?: string }).message ?? ''
    } catch {
      // No details.
    }
    if (res.status === 401) throw new GitHubError('GitHub didn’t accept your token. Connect GitHub again in App Studio.', 401)
    if (res.status === 403 && /rate limit/i.test(message)) throw new GitHubError('GitHub says too many requests for now. Connect GitHub (or wait an hour) to see more.', 403)
    if (res.status === 404) throw new GitHubError(key ? 'GitHub couldn’t find that repository (or your token can’t see it).' : 'GitHub couldn’t find that repository. If it’s private, connect GitHub first.', 404)
    if (res.status === 405 || res.status === 409) throw new GitHubError(message || 'GitHub couldn’t merge it.', res.status)
    throw new GitHubError(message || `GitHub said no (${res.status}).`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

async function setToken(raw: string): Promise<GitHubStatus> {
  const key = raw.trim()
  if (!key) throw new Error('Paste your GitHub token first.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t store the token securely, so it wasn’t saved.')
  let login: string
  try {
    login = (await github<{ login: string }>('/user', { key })).login
  } catch (err) {
    if (err instanceof GitHubError && err.status === 401) throw new Error('GitHub didn’t accept that token. Check you copied all of it.')
    throw err
  }
  save({ token: safeStorage.encryptString(key).toString('base64'), login })
  return status()
}

/** Runs git in a folder; its output, or null if git failed. */
function git(folder: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: folder, timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout.trim()))
  })
}

async function appInfo(folder: string): Promise<AppInfo> {
  if (!isAbsolute(folder) || !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: 'This app’s folder isn’t there any more.' }
  let version: string | undefined
  try {
    version = (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { version?: string }).version
  } catch {
    // No package.json: not every app has one.
  }
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') return { ok: true, version, error: inside === null && !(await git(folder, ['--version'])) ? 'Git isn’t installed on this computer.' : 'This folder isn’t a git repository.' }
  const [branch, last, changes, remote] = await Promise.all([
    git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(folder, ['log', '-1', '--format=%s%x1f%cI%x1f%an']),
    git(folder, ['status', '--porcelain']),
    git(folder, ['remote', 'get-url', 'origin'])
  ])
  const [subject, date, author] = (last ?? '').split('\x1f')
  return {
    ok: true,
    version,
    branch: branch ?? undefined,
    lastChange: subject ? { subject, date, author } : undefined,
    changedFiles: changes ? changes.split('\n').filter(Boolean).length : 0,
    repo: (remote && githubRepo(remote)) ?? undefined
  }
}

interface ApiPull {
  number: number
  title: string
  body: string | null
  user: { login: string } | null
  head: { ref: string }
  base: { ref: string }
  html_url: string
  draft?: boolean
  created_at: string
  updated_at: string
  additions?: number
  deletions?: number
  changed_files?: number
}

const validRepo = (repo: unknown): repo is string => typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo)

async function pulls(repos: string[]): Promise<{ pulls: PullRequest[]; errors: Record<string, string> }> {
  const out: PullRequest[] = []
  const errors: Record<string, string> = {}
  await Promise.all(
    repos.filter(validRepo).map(async (repo) => {
      try {
        const list = await github<ApiPull[]>(`/repos/${repo}/pulls?state=open&per_page=30&sort=updated&direction=desc`)
        // The list leaves out how big each one is; that's asked for the newest few.
        const detailed = await Promise.all(list.map((p, i) => (i < 15 ? github<ApiPull>(`/repos/${repo}/pulls/${p.number}`).catch(() => p) : Promise.resolve(p))))
        for (const p of detailed) {
          out.push({
            repo,
            number: p.number,
            title: p.title,
            body: p.body ?? '',
            author: p.user?.login ?? '',
            branch: p.head.ref,
            base: p.base.ref,
            url: p.html_url,
            draft: !!p.draft,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            additions: p.additions,
            deletions: p.deletions,
            changedFiles: p.changed_files
          })
        }
      } catch (err) {
        errors[repo] = err instanceof Error ? err.message : String(err)
      }
    })
  )
  out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return { pulls: out, errors }
}

function needToken(): void {
  if (!token()) throw new Error('Connect GitHub in App Studio first, so Orbit can do that for you.')
}

export function setupAppStudio(): void {
  ipcMain.handle('apps:githubStatus', () => status())
  ipcMain.handle('apps:isTestCopy', () => TEST_COPY)
  ipcMain.handle('apps:setToken', (_e, key: unknown) => setToken(String(key ?? '')))
  ipcMain.handle('apps:clearToken', () => {
    save({})
    return status()
  })
  ipcMain.handle('apps:info', (_e, folder: unknown) => (typeof folder === 'string' ? appInfo(folder) : { ok: false, error: 'No folder.' }))
  ipcMain.handle('apps:pulls', (_e, repos: unknown) => pulls(Array.isArray(repos) ? repos.slice(0, 30) : []))
  ipcMain.handle('apps:merge', async (_e, repo: unknown, number: unknown) => {
    if (!validRepo(repo) || typeof number !== 'number') throw new Error('Not allowed')
    needToken()
    try {
      await github(`/repos/${repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: 'merge' } })
    } catch (err) {
      logError('app studio merge', err)
      throw err
    }
  })
  ipcMain.handle('apps:close', async (_e, repo: unknown, number: unknown) => {
    if (!validRepo(repo) || typeof number !== 'number') throw new Error('Not allowed')
    needToken()
    await github(`/repos/${repo}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' } })
  })
}
