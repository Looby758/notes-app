import { app, ipcMain, net, safeStorage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { copyFolderName, githubRepo, isDownloadFile, isGitHubImage, parseAudit, parseOutdated, TOKEN_NOT_ALLOWED, readyForReviewError, mergeAfterReadyError, mergeBlockedReason, mergeFailedMessage, type Mergeability, type GraphQLError, type HealthReport, type BugReport, type AppInfo, type TestCopy, type GitHubStatus, type MergedPull, type PullRequest, type Release } from '@shared/appStudio'
import { npmMissingText } from '@shared/toolPath'
import { appNameProblem, appSlug, starterFiles, STARTERS, type MadeApp, type NewApp } from '@shared/appStarters'
import { logError } from './log'
import { findTool, toolEnv } from './toolPath'
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

export function token(): string | null {
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

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function github<T>(path: string, init: { method?: string; body?: unknown; key?: string | null; doing?: string; needs?: string } = {}): Promise<T> {
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
export function git(folder: string, args: string[]): Promise<string | null> {
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

export async function appInfo(folder: string): Promise<AppInfo> {
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

export const validRepo = (repo: unknown): repo is string => typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo)

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

interface ApiIssue {
  number: number
  title: string
  body: string | null
  user: { login: string } | null
  html_url: string
  created_at: string
  labels: (string | { name?: string })[]
  comments: number
  pull_request?: unknown
}

/** The open issues on a repository (people's bug reports and ideas), leaving out pull requests. */
async function issues(repo: string): Promise<BugReport[]> {
  const list = await github<ApiIssue[]>(`/repos/${repo}/issues?state=open&per_page=40&sort=created&direction=desc`)
  return list
    .filter((i) => !i.pull_request)
    .map((i) => ({
      repo,
      number: i.number,
      title: i.title,
      body: i.body ?? '',
      author: i.user?.login ?? '',
      url: i.html_url,
      createdAt: i.created_at,
      labels: i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
      comments: i.comments
    }))
}

/** Marks a release as a pre-release (so it isn't the latest, and apps that update themselves skip it) or back again. */
async function setPrerelease(repo: string, tag: string, prerelease: boolean): Promise<Release> {
  const list = await github<ApiRelease[]>(`/repos/${repo}/releases?per_page=30`)
  const found = list.find((r) => r.tag_name === tag)
  if (!found) throw new Error(`GitHub has no release ${tag}.`)
  return toRelease(await github<ApiRelease>(`/repos/${repo}/releases/${found.id}`, { method: 'PATCH', body: { prerelease, make_latest: prerelease ? 'false' : 'true' }, doing: 'change releases', needs: 'Contents' }))
}

/**
 * Merges a pull request. GitHub won't merge a draft, so a draft is marked ready for review first
 * (that's only in GitHub's GraphQL API), then merged. Says whether it had to do that.
 */
async function merge(repo: string, number: number): Promise<{ markedReady: boolean }> {
  type Pull = Mergeability & { node_id: string; draft?: boolean; state: string; merged_at: string | null; base: { ref: string } }
  let pull = await github<Pull>(`/repos/${repo}/pulls/${number}`)
  if (pull.merged_at) return { markedReady: false }
  if (pull.state !== 'open') throw new GitHubError(`#${number} was closed on GitHub, so it can’t be merged.`, 409)
  // GitHub works out whether it can merge in the background (after anything lands on the base, for
  // one), and says null until it has. Give it a few seconds before going ahead without knowing.
  for (let i = 0; pull.mergeable === null && i < 4; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    pull = await github<Pull>(`/repos/${repo}/pulls/${number}`)
  }
  const base = pull.base?.ref || 'main'
  // Say why before marking a draft ready, so a pull request that can't merge stays as it was.
  const blocked = mergeBlockedReason(pull, number, base)
  if (blocked) throw new GitHubError(blocked, 409)
  let markedReady = false
  if (pull.draft) {
    const res = await github<{ errors?: GraphQLError[] }>('/graphql', {
      method: 'POST',
      body: { query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', variables: { id: pull.node_id } },
      doing: 'mark pull requests ready for review',
      needs: 'Pull requests'
    })
    if (res?.errors?.length) throw new GitHubError(readyForReviewError(res.errors, repo), 403)
    markedReady = true
  }
  try {
    await github(`/repos/${repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: 'merge' }, doing: 'merge pull requests', needs: 'Pull requests and Contents' })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const status = err instanceof GitHubError ? err.status : 0
    const message = status === 405 || status === 409 || status === 422 ? mergeFailedMessage(raw, number, base) : raw
    throw new GitHubError(markedReady ? mergeAfterReadyError(message) : message, status)
  }
  return { markedReady }
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
async function npm(folder: string, args: string[]): Promise<{ out: string; err: string; missing: boolean }> {
  // Found where the Terminal would find it, even when Orbit was opened from the Dock or Finder.
  const env = await toolEnv()
  const found = process.platform === 'win32' ? 'npm.cmd' : await findTool('npm')
  if (!found) return { out: '', err: 'spawn npm ENOENT', missing: true }
  return new Promise((done) => {
    execFile(
      found,
      args,
      // npm.cmd only runs through the shell on Windows; the arguments are fixed, never typed in.
      { cwd: folder, timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32', env },
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
  if (outdated.missing) throw new Error(npmMissingText(process.platform))
  if (!hasLock) problems.push('There’s no package-lock.json, so npm can’t check for security problems. Run npm install once to make one.')
  else if (!audit.out.trim()) problems.push(`npm couldn’t check for security problems${/ENOTFOUND|ETIMEDOUT|network/i.test(audit.err) ? ' (no internet?)' : ''}.`)
  if (!existsSync(join(folder, 'node_modules'))) problems.push('The packages aren’t installed yet (no node_modules), so “now” shows as not installed.')
  return { checkedAt: new Date().toISOString(), outdated: parseOutdated(outdated.out), security: parseAudit(audit.out), problems }
}

/**
 * Starts a new app: a folder named after it with the starter's files, a git repository with them
 * committed, and (if asked, and GitHub is connected) a GitHub repository set as its origin. The
 * first push runs in the app's terminal afterwards, with your own git sign-in.
 */
async function createApp(req: NewApp): Promise<MadeApp> {
  const problem = appNameProblem(req.name)
  if (problem) throw new Error(problem)
  if (!validFolder(req.parent)) throw new Error('Pick a folder to put it in.')
  const slug = appSlug(req.name)
  const folder = join(req.parent, slug)
  if (existsSync(folder)) throw new Error(`There’s already a folder called ${slug} in there. Pick another name or folder.`)
  const files = starterFiles(req.starter, req.name.trim(), req.what)
  mkdirSync(folder)
  for (const [path, text] of Object.entries(files)) {
    const full = resolve(folder, path)
    if (!inside(folder, full)) continue
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  const init = await gitLong(folder, ['init', '-b', 'main'])
  if (!init.ok) {
    // Git before 2.28 has no -b.
    const old = await gitLong(folder, ['init'])
    if (!old.ok) throw new Error(/ENOENT|not recognized|not found/i.test(old.err) ? 'The app was made, but git isn’t installed on this computer, so it isn’t a git repository yet.' : `The app was made, but git couldn’t start a repository: ${old.err.split('\n').pop()}`)
    await gitLong(folder, ['checkout', '-b', 'main'])
  }
  await gitLong(folder, ['add', '-A'])
  const commit = await gitLong(folder, ['commit', '-m', `Start ${req.name.trim()}`])
  if (!commit.ok) {
    const why = /user\.(name|email)|identity/i.test(commit.err) ? 'git doesn’t know your name and email yet (git config --global user.name and user.email)' : commit.err.split('\n').pop()
    throw new Error(`The app was made in ${folder}, but git couldn’t save the first version: ${why}.`)
  }
  if (!req.github) return { folder }
  if (!token()) return { folder, githubError: 'GitHub isn’t connected in App Studio, so no repository was made.' }
  try {
    const firstLine = req.what.trim().split('\n')[0].slice(0, 300)
    const made = await github<{ full_name: string; clone_url: string }>('/user/repos', {
      method: 'POST',
      body: { name: slug, private: req.github === 'private', description: firstLine || undefined, auto_init: false },
      doing: 'make repositories',
      needs: 'Administration'
    })
    await gitLong(folder, ['remote', 'add', 'origin', made.clone_url])
    return { folder, repo: made.full_name }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { folder, githubError: /name already exists/i.test(message) ? `You already have a repository called ${slug} on GitHub.` : message }
  }
}

export function needToken(): void {
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
  ipcMain.handle('apps:setPrerelease', async (_e, repo: unknown, tag: unknown, prerelease: unknown) => {
    if (!validRepo(repo) || typeof tag !== 'string' || !/^[\w.+-]{1,60}$/.test(tag)) throw new Error('Not allowed')
    needToken()
    return setPrerelease(repo, tag, !!prerelease)
  })
  ipcMain.handle('apps:issues', (_e, repo: unknown) => {
    if (!validRepo(repo)) throw new Error('Not allowed')
    return issues(repo)
  })
  ipcMain.handle('apps:closeIssue', async (_e, repo: unknown, number: unknown, comment: unknown) => {
    if (!validRepo(repo) || !Number.isInteger(number) || (number as number) < 1) throw new Error('Not allowed')
    needToken()
    const text = typeof comment === 'string' ? comment.trim().slice(0, 2000) : ''
    if (text) await github(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body: text }, doing: 'comment on issues', needs: 'Issues' })
    await github(`/repos/${repo}/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' }, doing: 'close issues', needs: 'Issues' })
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
  ipcMain.handle('apps:createApp', (_e, req: unknown) => {
    const r = (req ?? {}) as Partial<NewApp>
    if (typeof r.parent !== 'string' || typeof r.name !== 'string' || !STARTERS.some((s) => s.id === r.starter)) throw new Error('Not allowed')
    return createApp({ parent: r.parent, name: r.name.slice(0, 80), starter: r.starter as NewApp['starter'], what: String(r.what ?? '').slice(0, 5000), github: r.github === 'private' || r.github === 'public' ? r.github : null })
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
      return await merge(repo, number)
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
