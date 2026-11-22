import { app, ipcMain, net, safeStorage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { copyFolderName, githubRepo, isDownloadFile, isGitHubImage, parseAudit, parseOutdated, TOKEN_NOT_ALLOWED, type HealthReport, type AppInfo, type TestCopy, type GitHubStatus, type MergedPull, type PullRequest, type Release } from '@shared/appStudio'
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

async function github<T>(path: string, init: { method?: string; body?: unknown; key?: string | null; doing?: string; needs?: string } = {}): Promise<T> {
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
    // A fine-grained token without the permission (or without this repository) gets this.
    if (res.status === 403 && /resource not accessible by (personal access token|integration)/i.test(message)) {
      const repo = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1]
      throw new GitHubError(
        `${TOKEN_NOT_ALLOWED} ${init.doing ?? 'do that'}${repo ? ` on ${repo}` : ''}. It needs ${init.needs ?? 'Pull requests and Contents'} set to “Read and write”${repo ? `, with ${repo} in its repositories` : ''}. Make a new token with those and paste it into App Studio.`,
        403
      )
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
    execFile('git', args, { cwd: folder, timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout.trimEnd()))
  })
}

/** Runs git for longer jobs (fetching, making a copy); its output, or git's own error message. */
function gitLong(folder: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((done) => {
    execFile('git', args, { cwd: folder, timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      done({ ok: !err, out: String(stdout).trim(), err: String(stderr || err?.message || '').trim() })
    )
  })
}

/** Where an app's test copies go: a folder beside it, "<app>-test-copies". */
const copiesDir = (folder: string): string => join(dirname(folder), `${basename(folder)}-test-copies`)

const inside = (dir: string, path: string): boolean => {
  const rel = relative(dir, resolve(path))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function validFolder(folder: unknown): folder is string {
  return typeof folder === 'string' && isAbsolute(folder) && !!statSync(folder, { throwIfNoEntry: false })?.isDirectory()
}

async function copies(folder: string): Promise<TestCopy[]> {
  const list = await git(folder, ['worktree', 'list', '--porcelain'])
  if (!list) return []
  const dir = copiesDir(folder)
  return list
    .split(/\n\s*\n/)
    .map((block) => {
      const path = /^worktree (.+)$/m.exec(block)?.[1]
      const head = /^HEAD (\w+)$/m.exec(block)?.[1] ?? ''
      return path ? { path: resolve(path), head } : null
    })
    .filter((c): c is TestCopy => !!c && inside(dir, c.path) && existsSync(c.path))
}

/** Makes a test copy with the branch's latest in it (or finds the one already made). */
async function addCopy(folder: string, branch: string): Promise<string> {
  const path = join(copiesDir(folder), copyFolderName(branch))
  if ((await copies(folder)).some((c) => c.path === resolve(path))) return path
  if (existsSync(path)) throw new Error(`There’s already a folder at ${path} that isn’t a test copy. Move it out of the way first.`)
  const fetched = await gitLong(folder, ['fetch', 'origin', branch])
  if (!fetched.ok) throw new Error(`Git couldn’t get the branch ${branch}: ${fetched.err.split('\n').pop()}`)
  const made = await gitLong(folder, ['worktree', 'add', '--detach', path, 'FETCH_HEAD'])
  if (!made.ok) throw new Error(`Git couldn’t make the test copy: ${made.err.split('\n').pop()}`)
  return path
}

async function removeCopy(folder: string, path: string): Promise<void> {
  if (!inside(copiesDir(folder), path)) throw new Error('Not allowed')
  const done = await gitLong(folder, ['worktree', 'remove', '--force', path])
  await gitLong(folder, ['worktree', 'prune'])
  if (!done.ok && existsSync(path)) {
    throw new Error(/busy|denied|permission|in use/i.test(done.err) ? 'Some of its files are in use. Close the app running from this copy first.' : `Git couldn’t remove it: ${done.err.split('\n').pop()}`)
  }
}

async function appInfo(folder: string): Promise<AppInfo> {
  if (!isAbsolute(folder) || !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: 'This app’s folder isn’t there any more.' }
  let version: string | undefined
  let buildScripts: string[] | undefined
  let hasTests = false
  try {
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { version?: string; scripts?: Record<string, string> }
    version = pkg.version
    buildScripts = Object.keys(pkg.scripts ?? {}).filter((k) => /^(build|dist|make|package)(:|$)/.test(k))
    const test = pkg.scripts?.test
    hasTests = !!test && !/no test specified/.test(test)
  } catch {
    // No package.json: not every app has one.
  }
  const releaseWorkflow = hasReleaseWorkflow(folder)
  const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') return { ok: true, version, buildScripts, hasTests, releaseWorkflow, error: inside === null && !(await git(folder, ['--version'])) ? 'Git isn’t installed on this computer.' : 'This folder isn’t a git repository.' }
  const [branch, last, changes, remote, originHead] = await Promise.all([
    git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(folder, ['log', '-1', '--format=%s%x1f%cI%x1f%an']),
    git(folder, ['status', '--porcelain']),
    git(folder, ['remote', 'get-url', 'origin']),
    git(folder, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  ])
  const mainBranch = originHead?.replace(/^origin\//, '') || ((await git(folder, ['rev-parse', '--verify', '--quiet', 'refs/heads/master'])) && !(await git(folder, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'])) ? 'master' : 'main')
  const [subject, date, author] = (last ?? '').split('\x1f')
  return {
    ok: true,
    version,
    branch: branch ?? undefined,
    lastChange: subject ? { subject, date, author } : undefined,
    changedFiles: changes ? changes.split('\n').filter(Boolean).length : 0,
    changes: changes ? changes.split('\n').filter(Boolean).slice(0, 8) : [],
    repo: (remote && githubRepo(remote)) ?? undefined,
    mainBranch,
    buildScripts,
    hasTests,
    releaseWorkflow
  }
}

/** Whether a GitHub Actions workflow in the folder runs when a tag is pushed. */
function hasReleaseWorkflow(folder: string): boolean {
  const dir = join(folder, '.github', 'workflows')
  try {
    return readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .some((f) => {
        const text = readFileSync(join(dir, f), 'utf8')
        return /^\s*push\s*:/m.test(text) && /^\s*tags\s*:/m.test(text)
      })
  } catch {
    return false
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

interface ApiRelease {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
  html_url: string
  created_at: string
  published_at: string | null
  assets?: { name: string; download_count: number }[]
}

function toRelease(r: ApiRelease): Release {
  const files = (r.assets ?? []).filter((a) => isDownloadFile(a.name)).map((a) => ({ name: a.name, downloads: a.download_count ?? 0 }))
  return {
    tag: r.tag_name,
    name: r.name || r.tag_name,
    date: r.published_at ?? r.created_at,
    draft: r.draft,
    prerelease: r.prerelease,
    url: r.html_url,
    body: r.body ?? '',
    downloads: files.reduce((n, f) => n + f.downloads, 0),
    files
  }
}

async function releases(repo: string): Promise<Release[]> {
  const list = await github<ApiRelease[]>(`/repos/${repo}/releases?per_page=30`)
  return list.map(toRelease)
}

interface ApiClosedPull extends ApiPull {
  merged_at: string | null
}

/** Pull requests merged after `since` (all recent ones without it), newest first. */
async function merged(repo: string, since?: string): Promise<MergedPull[]> {
  const after = since ? Date.parse(since) : 0
  const out: MergedPull[] = []
  for (let page = 1; page <= 3; page++) {
    const list = await github<ApiClosedPull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`)
    for (const p of list) {
      if (p.merged_at && Date.parse(p.merged_at) > after) {
        out.push({ number: p.number, title: p.title, body: p.body ?? '', author: p.user?.login ?? '', url: p.html_url, mergedAt: p.merged_at })
      }
    }
    // Sorted by last update, so once one is older than `since` the rest are too.
    if (list.length < 50 || !after || Date.parse(list[list.length - 1].updated_at) < after) break
  }
  return out.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
}

/**
 * Puts the notes on the release for `tag`: the existing one (a draft too), or a new draft. A
 * release workflow that later finds the draft publishes it, notes and all.
 */
async function setReleaseNotes(repo: string, tag: string, body: string, title: string): Promise<Release> {
  const list = await github<ApiRelease[]>(`/repos/${repo}/releases?per_page=30`)
  const found = list.find((r) => r.tag_name === tag)
  const r = found
    ? await github<ApiRelease>(`/repos/${repo}/releases/${found.id}`, { method: 'PATCH', body: { body }, doing: 'change releases', needs: 'Contents' })
    : await github<ApiRelease>(`/repos/${repo}/releases`, { method: 'POST', body: { tag_name: tag, name: title, body, draft: true }, doing: 'make releases', needs: 'Contents' })
  return toRelease(r)
}

/** Whether each pull request is still open, was merged, or was closed without merging. */
async function pullStates(repo: string, numbers: number[]): Promise<Record<number, 'open' | 'merged' | 'closed'>> {
  const out: Record<number, 'open' | 'merged' | 'closed'> = {}
  await Promise.all(
    numbers.slice(0, 20).map(async (n) => {
      try {
        const p = await github<{ state: string; merged_at: string | null }>(`/repos/${repo}/pulls/${n}`)
        out[n] = p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed'
      } catch {
        // Unknown for now; asked again next time.
      }
    })
  )
  return out
}

/** Downloads a picture from a pull request's description (GitHub's own image addresses only). */
async function fetchImage(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  if (!isGitHubImage(url)) throw new Error('Not allowed')
  const key = token()
  let res: Response
  try {
    res = await net.fetch(url, { headers: { 'User-Agent': 'Orbit', ...(key ? { Authorization: `Bearer ${key}` } : {}) } })
  } catch {
    throw new Error('Couldn’t reach GitHub. Check your internet connection.')
  }
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.startsWith('image/')) throw new Error(`GitHub didn’t send the picture (${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > 25 * 1024 * 1024) throw new Error('That picture is too big.')
  return { bytes, type }
}

/** Runs npm in a folder; its output either way (npm outdated and npm audit exit with 1 when they find something). */
function npm(folder: string, args: string[]): Promise<{ out: string; err: string; missing: boolean }> {
  return new Promise((done) => {
    execFile(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args,
      // npm.cmd only runs through the shell on Windows; the arguments are fixed, never typed in.
      { cwd: folder, timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' },
      (err, stdout, stderr) => {
        const missing = !!err && ((err as NodeJS.ErrnoException).code === 'ENOENT' || /not recognized|not found/i.test(String(stderr)))
        done({ out: String(stdout ?? ''), err: String(stderr || ''), missing: missing && !String(stdout ?? '').trim() })
      }
    )
  })
}

/** Checks an app's packages: which have newer versions, and which have known security problems. */
async function health(folder: string): Promise<HealthReport> {
  if (!existsSync(join(folder, 'package.json'))) throw new Error('This app has no package.json, so there are no npm packages to check.')
  const problems: string[] = []
  const hasLock = existsSync(join(folder, 'package-lock.json'))
  const [outdated, audit] = await Promise.all([
    npm(folder, ['outdated', '--json', '--long']),
    hasLock ? npm(folder, ['audit', '--json']) : Promise.resolve({ out: '', err: '', missing: false })
  ])
  if (outdated.missing) throw new Error('npm isn’t installed on this computer (it comes with Node.js).')
  if (!hasLock) problems.push('There’s no package-lock.json, so npm can’t check for security problems. Run npm install once to make one.')
  else if (!audit.out.trim()) problems.push(`npm couldn’t check for security problems${/ENOTFOUND|ETIMEDOUT|network/i.test(audit.err) ? ' (no internet?)' : ''}.`)
  if (!existsSync(join(folder, 'node_modules'))) problems.push('The packages aren’t installed yet (no node_modules), so “now” shows as not installed.')
  return { checkedAt: new Date().toISOString(), outdated: parseOutdated(outdated.out), security: parseAudit(audit.out), problems }
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
  ipcMain.handle('apps:releases', (_e, repo: unknown) => {
    if (!validRepo(repo)) throw new Error('Not allowed')
    return releases(repo)
  })
  ipcMain.handle('apps:merged', (_e, repo: unknown, since: unknown) => {
    if (!validRepo(repo)) throw new Error('Not allowed')
    return merged(repo, typeof since === 'string' && since ? since : undefined)
  })
  ipcMain.handle('apps:setReleaseNotes', async (_e, repo: unknown, tag: unknown, body: unknown, title: unknown) => {
    if (!validRepo(repo) || typeof tag !== 'string' || !/^[\w.+-]{1,60}$/.test(tag)) throw new Error('Not allowed')
    needToken()
    return setReleaseNotes(repo, tag, String(body ?? '').slice(0, 100_000), String(title || tag).slice(0, 200))
  })
  ipcMain.handle('apps:copies', (_e, folder: unknown) => (validFolder(folder) ? copies(folder) : []))
  ipcMain.handle('apps:addCopy', (_e, folder: unknown, branch: unknown) => {
    if (!validFolder(folder) || typeof branch !== 'string' || !/^[\w./@+-]{1,200}$/.test(branch) || branch.startsWith('-')) throw new Error('Not allowed')
    return addCopy(folder, branch)
  })
  ipcMain.handle('apps:removeCopy', (_e, folder: unknown, path: unknown) => {
    if (!validFolder(folder) || typeof path !== 'string') throw new Error('Not allowed')
    return removeCopy(folder, path)
  })
  ipcMain.handle('apps:pullStates', (_e, repo: unknown, numbers: unknown) => {
    if (!validRepo(repo) || !Array.isArray(numbers)) throw new Error('Not allowed')
    return pullStates(repo, numbers.filter((n): n is number => Number.isInteger(n) && n > 0))
  })
  ipcMain.handle('apps:health', (_e, folder: unknown) => {
    if (!validFolder(folder)) throw new Error('This app’s folder isn’t there any more.')
    return health(folder)
  })
  ipcMain.handle('apps:fetchImage', (_e, url: unknown) => fetchImage(String(url)))
  ipcMain.handle('apps:merge', async (_e, repo: unknown, number: unknown) => {
    if (!validRepo(repo) || typeof number !== 'number') throw new Error('Not allowed')
    needToken()
    try {
      await github(`/repos/${repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: 'merge' }, doing: 'merge pull requests', needs: 'Pull requests and Contents' })
    } catch (err) {
      logError('app studio merge', err)
      throw err
    }
  })
  ipcMain.handle('apps:close', async (_e, repo: unknown, number: unknown) => {
    if (!validRepo(repo) || typeof number !== 'number') throw new Error('Not allowed')
    needToken()
    await github(`/repos/${repo}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' }, doing: 'close pull requests', needs: 'Pull requests' })
  })
}
