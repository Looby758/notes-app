import { app, ipcMain, net, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import { bumpVersion, releaseBase, VERSION_BUMPS, type VersionBump } from '@shared/appStudio'
import {
  addNotesEntry,
  aheadBehind,
  CHECK_LABELS,
  explainProblem,
  finishedTestFile,
  isNotesList,
  isVersionTag,
  lastLines,
  NOTES_FILE_NAMES,
  notesVersions,
  removeNotesEntries,
  staleNotes,
  type BuildJob,
  type BuildStatus,
  type Check,
  type CheckId,
  type CheckState,
  type FixId,
  type Preflight,
  type FixResult,
  type MainStatus,
  type Problem,
  type ReleaseResult,
  type TestProgress
} from '@shared/releaseCheck'
import { appInfo, github, GitHubError, token, validRepo } from './appStudio'
import type { AppInfo } from '@shared/appStudio'
import { logError } from './log'
import { nameApp, recordStudioError, sawBuild, sawFailure, sawFix, sawMainStatus, sawPreflight, sawRelease, sawTests } from './studioErrors'
import { findTool, hasNvm, toolEnv } from './toolPath'
import { npmMissingText } from '@shared/toolPath'

/**
 * App Studio's release helper, in the main process so it can read what git and npm say instead of
 * leaving it in a terminal: the checks before a release, the release itself (npm version, then a
 * push), the one-click fixes, and what GitHub's build of the release is doing (with buttons to
 * recover when it failed). Every git and npm call runs with fixed arguments in the app's folder.
 */

const WINDOWS = process.platform === 'win32'

interface Ran {
  ok: boolean
  /** stdout and stderr together. */
  out: string
  /** npm isn't anywhere Orbit (or the Terminal) would look. */
  npmMissing?: boolean
}

/**
 * Runs git or npm in a folder. Git never stops to ask for a password here (it would wait forever
 * with no one to answer): it fails, and the sign-in fix asks in a terminal instead.
 */
async function run(folder: string, tool: 'git' | 'npm', args: string[], opts: { timeout?: number; interactive?: boolean } = {}): Promise<Ran> {
  const how = await command(tool, args, opts.interactive)
  if (!how) return { ok: false, out: 'spawn npm ENOENT', npmMissing: true }
  const { cmd, argv, env, viaShell } = how
  return new Promise((done) => {
    execFile(cmd, argv, { cwd: folder, timeout: opts.timeout ?? 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, shell: viaShell, env }, (err, stdout, stderr) => {
      let out = [String(stdout ?? ''), String(stderr ?? '')].filter((s) => s.trim()).join('\n')
      const missing = !!err && tool === 'npm' && ((err as NodeJS.ErrnoException).code === 'ENOENT' || /'npm(\.cmd)?' is not recognized/i.test(out))
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') out += `\nspawn ${cmd} ENOENT`
      if (err && err.killed) out += '\nIt took too long and was stopped.'
      done({ ok: !err, out, npmMissing: missing })
    })
  })
}

/** How to start git or npm here: the program, its arguments and environment. Null when npm can't be found. */
async function command(tool: 'git' | 'npm', args: string[], interactive = false): Promise<{ cmd: string; argv: string[]; env: NodeJS.ProcessEnv; viaShell: boolean } | null> {
  // The PATH the Terminal would have, so npm (and the node it needs) is found even when Orbit was
  // opened from the Dock or Finder.
  const env = await toolEnv({ GIT_TERMINAL_PROMPT: '0', FORCE_COLOR: '0', NO_COLOR: '1', CI: 'true' })
  if (!interactive) env.GCM_INTERACTIVE = 'never'
  if (tool === 'npm') withoutNpmFlags(env)
  // npm.cmd only runs through the shell on Windows, which joins the arguments with spaces, so any
  // with a space are quoted. They're all fixed here, never typed in.
  const viaShell = tool === 'npm' && WINDOWS
  let cmd = tool === 'npm' ? (WINDOWS ? 'npm.cmd' : 'npm') : 'git'
  if (tool === 'npm' && !WINDOWS) {
    const found = await findTool('npm')
    if (!found) return null
    cmd = found
  }
  const argv = viaShell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args
  return { cmd, argv, env, viaShell }
}

const minutes = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minute${Math.round(ms / 60_000) === 1 ? '' : 's'}` : `${Math.round(ms / 1000)} seconds`)

interface Watched extends Ran {
  /** Why it was stopped early, in plain words (it hung, or took too long). */
  stopped?: string
}

/**
 * Runs npm and hands over its output a line at a time, for the release check's progress. Unlike
 * execFile, a stop takes everything npm started with it (vitest and its workers), not only npm:
 * killing just npm used to leave the tests running, and the check waiting on them. It's stopped
 * when it says nothing new for `quiet` (stuck), or runs past `limit`.
 */
async function runWatched(
  folder: string,
  args: string[],
  opts: { limit: number; quiet?: number; what: string; onLine?: (line: string) => void; signal?: AbortSignal }
): Promise<Watched> {
  const how = await command('npm', args)
  if (!how) return { ok: false, out: 'spawn npm ENOENT', npmMissing: true }
  const { cmd, argv, env, viaShell } = how
  return new Promise((done) => {
    let out = ''
    let partial = ''
    let stopped: string | undefined
    let finished = false
    // Its own process group (not on Windows, where taskkill /T finds the children), so all of it can be stopped at once.
    const child = spawn(cmd, argv, { cwd: folder, windowsHide: true, shell: viaShell, env, detached: !WINDOWS, stdio: ['ignore', 'pipe', 'pipe'] })
    const stop = (why: string): void => {
      if (finished || stopped) return
      stopped = why
      killTree(child)
    }
    let quietTimer: NodeJS.Timeout | undefined
    const heard = (): void => {
      if (!opts.quiet) return
      clearTimeout(quietTimer)
      quietTimer = setTimeout(() => stop(`${opts.what} stopped making progress: nothing new for ${minutes(opts.quiet!)}, so Orbit stopped them.`), opts.quiet)
    }
    const limitTimer = setTimeout(() => stop(`${opts.what} were still going after ${minutes(opts.limit)}, so Orbit stopped them.`), opts.limit)
    const onAbort = (): void => stop('Stopped, because the check was started again.')
    opts.signal?.addEventListener('abort', onAbort)
    heard()
    const take = (d: Buffer): void => {
      const text = d.toString()
      if (out.length < 32 * 1024 * 1024) out += text
      partial += text
      const lines = partial.split(/\r?\n/)
      partial = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) opts.onLine?.(line)
      heard()
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const finish = (code: number | null, err?: NodeJS.ErrnoException): void => {
      if (finished) return
      finished = true
      clearTimeout(quietTimer)
      clearTimeout(limitTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (partial.trim()) opts.onLine?.(partial)
      let text = out.trim()
      if (err?.code === 'ENOENT') text += `\nspawn ${cmd} ENOENT`
      if (stopped) text += `\n${stopped}`
      const missing = !!err?.code && err.code === 'ENOENT'
      done({ ok: !stopped && !err && code === 0, out: text, npmMissing: missing || (code !== 0 && /'npm(\.cmd)?' is not recognized/i.test(text)), stopped })
    }
    child.on('error', (err) => finish(null, err))
    // 'exit', not 'close': something npm started can keep the output open after npm has gone, and
    // that mustn't keep the check waiting. A moment's grace lets the last lines arrive.
    child.on('exit', (code) => {
      if (stopped) killTree(child)
      setTimeout(() => finish(code), 300)
    })
    child.on('close', (code) => finish(code))
  })
}

/** Stops a program and everything it started. */
function killTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (WINDOWS) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

/**
 * Takes out the settings a parent npm passes down as environment variables when Orbit (or its
 * tests) was started with npm run. Newer npm counts an inherited allow-scripts setting as if it was
 * typed on the command line and refuses to install in a project with it (EALLOWSCRIPTS), so it's
 * removed, and npm reads the app's own .npmrc and package.json instead.
 */
export function withoutNpmFlags(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    if (/^npm_config_allow[-_]scripts$/i.test(key)) delete env[key]
  }
  return env
}

/** npm couldn't be found anywhere: what to do, for this computer. */
const npmMissing = (id: CheckId, out: string): Check => check(id, 'fail', npmMissingText(process.platform, { nvm: hasNvm() }), { output: out })
const npmProblem = (): Problem => ({ title: 'Orbit couldn’t find npm', detail: npmMissingText(process.platform, { nvm: hasNvm() }), fixes: [] })

const gitOut = async (folder: string, args: string[]): Promise<string | null> => {
  const r = await run(folder, 'git', args, { timeout: 15_000 })
  return r.ok ? r.out.trim() : null
}

const check = (id: CheckId, state: CheckState, text: string, extra: Partial<Check> = {}): Check => ({ id, label: CHECK_LABELS[id], state, text, ...extra })
const fromProblem = (id: CheckId, p: Problem, output: string, state: CheckState = 'fail'): Check => check(id, state, `${p.title}. ${p.detail}`, { fixes: p.fixes, output: lastLines(output, 60) })

/** Folders an app's own code is in (looked through for a "What's new" list). */
const SKIP_DIRS = /^(node_modules|out|dist|build|release|\.git|coverage|\.vite|\.next)$/

/** The app's "What's new" list file, relative to its folder, if it keeps one in its code. */
export function findNotesFile(folder: string): string | null {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || found.length) return
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP_DIRS.test(name) || name.startsWith('.')) continue
      const path = join(dir, name)
      const st = statSync(path, { throwIfNoEntry: false })
      if (st?.isFile() && NOTES_FILE_NAMES.test(name) && !/\.test\./.test(name) && st.size < 2_000_000) {
        try {
          if (isNotesList(readFileSync(path, 'utf8'))) found.push(path)
        } catch {
          // Unreadable: not it.
        }
      }
    }
    for (const name of names) {
      if (SKIP_DIRS.test(name) || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) walk(path, depth + 1)
    }
  }
  walk(join(folder, 'src'), 0)
  if (!found.length) walk(folder, 3)
  return found.length ? relative(folder, found[0]).replace(/\\/g, '/') : null
}

/**
 * The version a release counts up from: package.json's, unless that one was never released (its
 * release was given up), then the newest that was. Tags here and on GitHub both count.
 */
async function baseVersion(folder: string, version: string, there: Set<string> | null): Promise<string> {
  const here = ((await gitOut(folder, ['tag', '--list', 'v*'])) ?? '').split('\n')
  return releaseBase(version, [...here, ...(there ?? [])])
}

/** Tags on GitHub (from git, with the app's own sign-in), or null when it couldn't ask. */
async function remoteTags(folder: string): Promise<Set<string> | null> {
  const r = await run(folder, 'git', ['ls-remote', '--tags', 'origin'], { timeout: 60_000 })
  if (!r.ok) return null
  return new Set([...r.out.matchAll(/refs\/tags\/([^\s^]+)/g)].map((m) => m[1]))
}

interface ApiRelease {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  html_url: string
}

async function releaseFor(repo: string, tag: string): Promise<ApiRelease | undefined> {
  const list = await github<ApiRelease[]>(`/repos/${repo}/releases?per_page=30`)
  return list.find((r) => r.tag_name === tag)
}

/** The quick checks before a release (the tests are run separately, as they take a while). */
async function preflight(folder: string, bump: VersionBump): Promise<Preflight> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  if (!info.ok || info.error) throw new Error(info.error ?? 'Orbit couldn’t read this app’s folder.')
  const version = info.version
  if (!version) throw new Error('Orbit bumps the version in package.json, so it can only release apps that have one.')
  const hasOrigin = (await gitOut(folder, ['remote', 'get-url', 'origin'])) !== null
  const tagsThere = hasOrigin ? await remoteTags(folder) : new Set<string>()
  const next = bumpVersion(await baseVersion(folder, version, tagsThere), bump)
  if (!next) throw new Error(`The version in package.json (${version}) isn’t a plain number like 1.2.3, so Orbit can’t work out the next one.`)
  const tag = `v${next}`
  const main = info.mainBranch ?? 'main'
  const ctx = { windows: WINDOWS, tag, main }
  const checks: Check[] = []
  const onMain = info.branch === main

  const changed = info.changedFiles ?? 0
  checks.push(
    changed
      ? check('tree', 'fail', `${changed === 1 ? '1 file has' : `${changed} files have`} changed since the last commit, so ${changed === 1 ? 'it' : 'they'} wouldn’t be in the release. Put them away (they can come back later with git stash pop) or commit them.`, { fixes: ['put-away'] })
      : check('tree', 'pass', 'Nothing is waiting to be committed.')
  )
  checks.push(onMain ? check('branch', 'pass', `On ${main}.`) : check('branch', 'fail', `It’s on ${info.branch ?? 'no branch'}. Releases are made from ${main}, which is what GitHub builds.`, { fixes: ['switch-main'] }))

  if (!hasOrigin) {
    checks.push(check('latest', 'skip', 'This app’s folder isn’t linked to GitHub, so there’s nothing to compare with.'))
  } else {
    const fetched = await run(folder, 'git', ['fetch', 'origin', main], { timeout: 120_000 })
    if (!fetched.ok) checks.push(fromProblem('latest', explainProblem(fetched.out, ctx), fetched.out))
    else if (!onMain) checks.push(check('latest', 'skip', `Checked once it’s on ${main}.`))
    else {
      const ab = aheadBehind(await gitOut(folder, ['rev-list', '--left-right', '--count', `HEAD...origin/${main}`]))
      if (!ab) checks.push(check('latest', 'skip', `Couldn’t compare with GitHub’s ${main}.`))
      else if (ab.behind)
        checks.push(check('latest', 'fail', `GitHub has ${ab.behind === 1 ? '1 commit' : `${ab.behind} commits`} this computer doesn’t (something was merged). Get the latest first, so the release has it and the push isn’t turned away.`, { fixes: ['pull'] }))
      else checks.push(check('latest', 'pass', ab.ahead ? `Up to date. ${ab.ahead === 1 ? '1 commit here isn’t' : `${ab.ahead} commits here aren’t`} on GitHub yet; ${ab.ahead === 1 ? 'it goes' : 'they go'} up with the release.` : 'Up to date.'))
    }
  }

  const [localNow, localNext] = await Promise.all([
    gitOut(folder, ['tag', '--list', `v${version}`]),
    gitOut(folder, ['tag', '--list', tag])
  ])
  // A release made here (npm version tagged it) whose push failed.
  if (hasOrigin && tagsThere && localNow === `v${version}` && !tagsThere.has(`v${version}`)) {
    checks.push(
      check('unfinished', 'fail', `v${version} was made on this computer but never reached GitHub (the push must have failed). Push it to finish that release, or delete its tag to leave it out.`, {
        fixes: ['finish-push', 'delete-tag'],
        tag: `v${version}`
      })
    )
  } else checks.push(check('unfinished', 'pass', 'Nothing left over from an earlier release.'))

  const nextHere = localNext === tag
  const nextThere = !!tagsThere?.has(tag)
  if (nextHere || nextThere) {
    let published = false
    if (info.repo) {
      try {
        const r = await releaseFor(info.repo, tag)
        published = !!r && !r.draft
      } catch {
        // Not known; the tag is still in the way.
      }
    }
    checks.push(
      published
        ? check('tag', 'fail', `${tag} is already released. Pick a bigger version.`)
        : check('tag', 'fail', `There’s already a ${tag} tag ${nextThere ? 'on GitHub' : 'on this computer'}, left over from a release that didn’t finish. Delete it (and its draft release) and the release can use ${tag}.`, { fixes: ['delete-tag'], tag })
    )
  } else checks.push(check('tag', 'pass', `${tag} isn’t used yet.`))

  const notesFile = findNotesFile(folder) ?? undefined
  if (notesFile) {
    const have = notesVersions(readFileSync(join(folder, notesFile), 'utf8'))
    const stale = staleNotes(have, next)
    const list = stale.length === 1 ? stale[0] : `${stale.slice(0, -1).join(', ')} and ${stale[stale.length - 1]}`
    checks.push(
      stale.length
        ? check(
            'notes',
            'fail',
            `${notesFile} has notes for ${list}, newer than ${next}, which ${stale.length === 1 ? 'was' : 'were'} never released (left over from a version you gave up on). The app would show them, and a test wants the list newest first. Take them out and Orbit commits that.${have.includes(next) ? '' : ` Then write the notes for ${next}.`}`,
            { fixes: have.includes(next) ? ['drop-notes'] : ['drop-notes', 'write-notes'] }
          )
        : have.includes(next)
          ? check('notes', 'pass', `${notesFile} has notes for ${next}.`)
          : check('notes', 'fail', `${notesFile} has no notes for ${next} yet. The app shows them after it updates (and a test may check for them, which would stop GitHub’s build). Write them and Orbit adds them and commits them.`, { fixes: ['write-notes'] })
    )
  }

  if (hasOrigin && onMain) {
    const dry = await run(folder, 'git', ['push', '--dry-run', 'origin', `HEAD:refs/heads/${main}`], { timeout: 60_000 })
    const p = dry.ok ? null : explainProblem(dry.out, ctx)
    // Turned away for being behind is the "up to date" check's job.
    if (!p || p.fixes.includes('pull')) checks.push(check('push', 'pass', 'Git is signed in and can push.'))
    else checks.push(fromProblem('push', p, dry.out))
  }

  if (info.repo && info.releaseWorkflow) {
    if (!token()) checks.push(check('token', 'warn', 'Not connected. Orbit can still release, but it can’t watch GitHub build it, put the notes on it, or fix a failed one from here.', { fixes: ['connect-github'] }))
    else {
      try {
        await github(`/repos/${info.repo}/actions/runs?per_page=1`, { doing: 'see GitHub’s builds (Actions)', needs: 'Actions' })
        checks.push(check('token', 'pass', 'Connected, and it can see GitHub’s builds.'))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = err instanceof GitHubError ? err.status : 0
        checks.push(check('token', 'warn', `${message} Orbit can still release, but can’t watch the build or run it again.`, { fixes: status === 401 ? ['connect-github'] : status === 403 ? ['new-token'] : [] }))
      }
    }
  }

  checks.push(check('tests', info.hasTests ? 'running' : 'skip', info.hasTests ? 'Running…' : 'This app has no tests.'))
  return { version, next, tag, checks, notesFile }
}

/** Failing tests: kept in App Studio's problem history with everything npm said (the check shows the end). */
function testsFailed(folder: string, p: Problem, output: string): Check {
  recordStudioError(folder, 'tests', 'Type check and tests', p.title, p.detail, output)
  return fromProblem('tests', p, output)
}

/** Folders and files skipped when counting an app's test files. */
const NOT_TESTS = new Set(['node_modules', '.git', 'out', 'dist', 'build', 'release', 'coverage', '.next', '.vite'])

/** The app's test files (a.test.ts, b.spec.tsx), so the progress can say "120 of 210". Undefined when there are too many to count quickly. */
export function countTestFiles(folder: string): string[] | undefined {
  const found: string[] = []
  const todo = [folder]
  let seen = 0
  while (todo.length) {
    const dir = todo.pop()!
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (++seen > 50_000) return undefined
      if (name.startsWith('.') && name !== '.') continue
      const full = join(dir, name)
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) found.push(relative(folder, full).split('\\').join('/'))
      else if (!NOT_TESTS.has(name) && !/\.\w+$/.test(name)) {
        try {
          if (statSync(full).isDirectory()) todo.push(full)
        } catch {
          // Gone, or not ours to read.
        }
      }
    }
  }
  return found.length ? found : undefined
}

/** How long each stage took the last time it passed, by folder, for a rough time left. */
const timesFile = (): string => join(app.getPath('userData'), 'release-test-times.json')
type Times = Record<string, Partial<Record<TestProgress['stage'], number>>>
function readTimes(): Times {
  try {
    return JSON.parse(readFileSync(timesFile(), 'utf8')) as Times
  } catch {
    return {}
  }
}
function saveTime(folder: string, stage: TestProgress['stage'], ms: number): void {
  try {
    const times = readTimes()
    times[folder] = { ...times[folder], [stage]: Math.round(ms) }
    writeFileSync(timesFile(), JSON.stringify(times))
  } catch {
    // Only a guess for next time.
  }
}

/**
 * How long the release check's type check and tests may take. The type check can't say how far
 * it's got, so it only has a time limit; vitest and jest say something each time a test file
 * finishes, so that long with nothing new means one is stuck. (Changed by the tests.)
 */
export const testLimits = { typecheck: 10 * 60_000, tests: 15 * 60_000, quiet: 3 * 60_000 }

/** The test run going on in each folder, so starting the check again stops the old one first. */
const testRuns = new Map<string, AbortController>()

/**
 * The type check (when there is one) and the tests, as GitHub's build runs them. Says how far it's
 * got as it goes, and stops (saying why) when the tests get stuck or run too long.
 */
async function runTests(folder: string, progress: (p: TestProgress) => void = () => undefined): Promise<Check> {
  let scripts: Record<string, string> = {}
  try {
    scripts = (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
  } catch {
    return check('tests', 'skip', 'No package.json.')
  }
  const hasTests = !!scripts.test && !/no test specified/.test(scripts.test)
  if (!hasTests && !scripts.typecheck) return check('tests', 'skip', 'This app has no tests.')
  testRuns.get(folder)?.abort()
  const controller = new AbortController()
  testRuns.set(folder, controller)
  try {
    const times = readTimes()[folder] ?? {}
    const stages = (scripts.typecheck ? 1 : 0) + (hasTests ? 1 : 0)
    let output = ''
    if (scripts.typecheck) {
      const startedAt = Date.now()
      progress({ folder, stage: 'typecheck', stages, startedAt, filesDone: 0, testsDone: 0, failed: 0, expectedMs: times.typecheck })
      const r = await runWatched(folder, ['run', 'typecheck'], { limit: testLimits.typecheck, what: 'The type check', signal: controller.signal })
      output += r.out
      if (controller.signal.aborted) return check('tests', 'skip', 'Started again.')
      if (r.npmMissing) return npmMissing('tests', r.out)
      if (r.stopped) return testsStopped(folder, r.stopped.replace('were still going', 'was still going').replace('stopped them', 'stopped it'), output)
      if (!r.ok) return testsFailed(folder, explainProblem(r.out, { windows: WINDOWS, source: 'tests' }), output)
      saveTime(folder, 'typecheck', Date.now() - startedAt)
    }
    if (hasTests) {
      const files = countTestFiles(folder)
      const startedAt = Date.now()
      const p: TestProgress = { folder, stage: 'tests', stages, startedAt, filesDone: 0, filesTotal: files?.length, testsDone: 0, failed: 0, expectedMs: times.tests }
      const done = new Set<string>()
      let sent = 0
      progress({ ...p })
      const r = await runWatched(folder, ['test'], {
        limit: testLimits.tests,
        quiet: testLimits.quiet,
        what: 'The tests',
        signal: controller.signal,
        onLine: (line) => {
          const f = finishedTestFile(line)
          if (!f) return
          done.add(f.file)
          p.filesDone++
          p.testsDone += f.tests
          p.failed += f.failed
          // More finished than were counted (the counting missed some): stop claiming a total.
          if (p.filesTotal && p.filesDone > p.filesTotal) p.filesTotal = undefined
          if (Date.now() - sent > 400) {
            sent = Date.now()
            progress({ ...p })
          }
        }
      })
      output += '\n' + r.out
      if (controller.signal.aborted) return check('tests', 'skip', 'Started again.')
      if (r.npmMissing) return npmMissing('tests', r.out)
      if (r.stopped) {
        const left = files?.filter((f) => !done.has(f) && ![...done].some((d) => d.endsWith(f) || f.endsWith(d)))
        const where = left?.length && left.length <= 5 ? ` Still running: ${left.join(', ')}.` : p.filesDone ? ` ${p.filesDone}${p.filesTotal ? ` of ${p.filesTotal}` : ''} test files had finished.` : ''
        return testsStopped(folder, r.stopped + where, output)
      }
      if (!r.ok) return testsFailed(folder, explainProblem(r.out, { windows: WINDOWS, source: 'tests' }), output)
      saveTime(folder, 'tests', Date.now() - startedAt)
      const count = /Tests\s+(\d+) passed/.exec(r.out)?.[1]
      return check('tests', 'pass', `${scripts.typecheck ? 'The type check and ' : ''}${count ? `all ${count} tests` : 'the tests'} passed.`.replace(/^./, (c) => c.toUpperCase()), { output: lastLines(output, 30) })
    }
    return check('tests', 'pass', 'The type check passed.', { output: lastLines(output, 30) })
  } finally {
    if (testRuns.get(folder) === controller) testRuns.delete(folder)
  }
}

/** Tests that hung or ran too long: kept in the problem history, with what they'd said so far. */
function testsStopped(folder: string, text: string, output: string): Check {
  recordStudioError(folder, 'tests', 'Type check and tests', 'The tests didn’t finish', text, output)
  return check('tests', 'fail', `${text} Run npm test in the terminal to see which test is stuck.`, { output: lastLines(output, 40), fixes: ['ask-claude'] })
}

/** The release: npm sets the version, commits and tags it; then the commit and tag are pushed. */
async function release(folder: string, bump: VersionBump, expected: string): Promise<ReleaseResult> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  const main = info.mainBranch ?? 'main'
  const hasOrigin = (await gitOut(folder, ['remote', 'get-url', 'origin'])) !== null
  const next = info.version ? bumpVersion(await baseVersion(folder, info.version, hasOrigin ? await remoteTags(folder) : null), bump) : null
  if (next !== expected) throw new Error('The version changed since the check. Check again.')
  const tag = `v${next}`
  const ctx = { windows: WINDOWS, tag, main }
  // The number itself rather than "minor": after a given-up release it can be the one package.json already says.
  const version = await run(folder, 'npm', ['version', next, ...(next === info.version ? ['--allow-same-version'] : []), '-m', 'Release %s'], { timeout: 120_000 })
  if (!version.ok) return { ok: false, step: 'version', problem: version.npmMissing ? npmProblem() : explainProblem(version.out, ctx), output: lastLines(version.out, 60) }
  const push = await run(folder, 'git', ['push', '--atomic', '--follow-tags', 'origin', `HEAD:refs/heads/${main}`], { timeout: 180_000, interactive: true })
  if (!push.ok) {
    const p = explainProblem(push.out, ctx)
    p.detail += ` ${tag} is made on this computer, so once that’s sorted, Push it finishes the release.`
    p.fixes = [...new Set<FixId>([...p.fixes, 'finish-push'])]
    return { ok: false, step: 'push', tag, problem: p, output: lastLines(version.out + '\n' + push.out, 60) }
  }
  return { ok: true, tag, output: lastLines(version.out + '\n' + push.out, 40) }
}

const failed = (r: Ran, ctx: { tag?: string; main?: string } = {}): FixResult => {
  const problem = explainProblem(r.out, { windows: WINDOWS, ...ctx })
  return { ok: false, message: `${problem.title}. ${problem.detail}`, problem, output: lastLines(r.out, 60) }
}

/** The version in package.json at a commit. */
async function versionAt(folder: string, ref: string): Promise<string | null> {
  const text = await gitOut(folder, ['show', `${ref}:package.json`])
  try {
    return text ? ((JSON.parse(text) as { version?: string }).version ?? null) : null
  } catch {
    return null
  }
}

/**
 * Gets GitHub's latest. When this computer has commits GitHub doesn't (a release whose push was
 * turned away), they're put on top of GitHub's (a rebase), and a release tag that hasn't reached
 * GitHub yet moves with its commit. If the changes clash, nothing is changed.
 */
async function pullLatest(folder: string, main: string, dirty: boolean): Promise<FixResult> {
  const ff = await run(folder, 'git', ['pull', '--ff-only', 'origin', main], { timeout: 120_000, interactive: true })
  if (ff.ok) return { ok: true, message: 'Got the latest from GitHub.' }
  if (!/Not possible to fast-forward|diverg/i.test(ff.out)) return failed(ff, { main })
  if (dirty) return { ok: false, message: 'Commit or put away the changed files first, then get the latest.' }
  const tagsHere = ((await gitOut(folder, ['tag', '--points-at', 'HEAD'])) ?? '').split('\n').filter(isVersionTag)
  const there = await remoteTags(folder)
  const moving = tagsHere.filter((t) => there && !there.has(t))
  const ahead = aheadBehind(await gitOut(folder, ['rev-list', '--left-right', '--count', `HEAD...origin/${main}`]))?.ahead ?? 0
  const rebase = await run(folder, 'git', ['rebase', `origin/${main}`], { timeout: 120_000 })
  if (!rebase.ok) {
    await run(folder, 'git', ['rebase', '--abort'])
    return failed(rebase, { main })
  }
  for (const tag of moving) {
    const v = await versionAt(folder, 'HEAD')
    if (`v${v}` === tag) await run(folder, 'git', ['tag', '-f', '-a', tag, '-m', `Release ${tag.slice(1)}`])
  }
  return { ok: true, message: `Got the latest from GitHub and put ${ahead === 1 ? 'the commit' : `the ${ahead} commits`} from this computer on top${moving.length ? ` (${moving.join(', ')} moved with ${ahead === 1 ? 'it' : 'them'})` : ''}.` }
}

/**
 * How the folder compares with GitHub's main: fetched fresh, then counted against the folder's own
 * main (the branch a release is made from), whichever branch it's on now.
 */
async function mainStatus(folder: string): Promise<MainStatus> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  if (!info.ok || info.error) throw new Error(info.error ?? 'Orbit couldn’t read this app’s folder.')
  const main = info.mainBranch ?? 'main'
  const base = { main, branch: info.branch, onMain: info.branch === main, dirty: info.changedFiles ?? 0, behind: 0, ahead: 0 }
  if ((await gitOut(folder, ['remote', 'get-url', 'origin'])) === null) return { ...base, linked: false }
  const fetched = await run(folder, 'git', ['fetch', 'origin', main], { timeout: 90_000 })
  if (!fetched.ok) {
    const p = explainProblem(fetched.out, { windows: WINDOWS, main })
    return { ...base, linked: true, problem: `Couldn’t check GitHub: ${p.title}. ${p.detail}`, output: lastLines(fetched.out, 40) }
  }
  // Off main, the folder's own main is what a switch would land on (or nothing yet, when it's
  // never been checked out here: then all of GitHub's main is new).
  const ref = base.onMain ? 'HEAD' : (await gitOut(folder, ['rev-parse', '--verify', '--quiet', `refs/heads/${main}`])) ? main : null
  if (!ref) {
    const count = Number(await gitOut(folder, ['rev-list', '--count', `origin/${main}`])) || 0
    return { ...base, linked: true, behind: count }
  }
  const ab = aheadBehind(await gitOut(folder, ['rev-list', '--left-right', '--count', `${ref}...origin/${main}`]))
  if (!ab) return { ...base, linked: true, problem: `Couldn’t compare with GitHub’s ${main}.` }
  return { ...base, linked: true, ...ab }
}

/**
 * The "Get latest main" button: puts the folder on main (when it's on another branch) and brings
 * in everything on GitHub's main, so a release is made from what's really there. Changed files are
 * never thrown away: on another branch it won't switch with them (they'd come along to main), and
 * on main git itself refuses if the new commits touch them.
 */
/** The files that say which packages an app needs: when any of these change, npm install is due. */
const PACKAGE_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']

/** Packages package.json asks for that aren't in node_modules (none when it has no package.json). */
export function missingPackages(folder: string): string[] {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
  } catch {
    return []
  }
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  return names.filter((name) => !existsSync(join(folder, 'node_modules', name, 'package.json')))
}

/** Get latest main results where git was fine and npm install failed (kept as packages problems in the error history). */
const installFailed = new WeakSet<FixResult>()

/** What Get latest main is doing now, for the button to show. */
type Step = (text: string) => void

/**
 * Runs npm install after Get latest main when the new code needs it: package.json or the lock
 * file changed, or a package it asks for isn't installed (an earlier get didn't install it).
 * Returns null when there was nothing to install.
 */
async function installIfNeeded(folder: string, from: string | null, step: Step): Promise<{ ok: boolean; text: string; output?: string; problem?: Problem } | null> {
  if (!existsSync(join(folder, 'package.json'))) return null
  const changed = from ? ((await gitOut(folder, ['diff', '--name-only', from, 'HEAD', '--', ...PACKAGE_FILES])) ?? '').split('\n').filter(Boolean) : []
  const missing = missingPackages(folder)
  if (!changed.length && !missing.length) return null
  step('Installing the new packages (npm install)…')
  const r = await run(folder, 'npm', ['install', '--no-audit', '--no-fund'], { timeout: 15 * 60_000 })
  if (r.npmMissing) return { ok: false, text: npmMissingText(process.platform, { nvm: hasNvm() }), output: lastLines(r.out, 80), problem: npmProblem() }
  if (!r.ok) {
    const locked = /\b(EPERM|EBUSY|resource busy or locked)\b/.test(r.out)
    const detail = locked
      ? 'A file npm needed to replace is in use. Close the app if it’s running from this folder (npm run dev), then press Get latest main again to finish installing.'
      : 'The code is up to date, but the new packages aren’t installed, so it may not build. Look at what npm said, then press Get latest main again to try the install again.'
    return { ok: false, text: `Installing the new packages failed. ${detail}`, output: lastLines(r.out, 80), problem: { title: 'Installing the new packages failed', detail, fixes: [] } }
  }
  const still = missingPackages(folder)
  if (still.length) {
    const detail = `npm finished, but ${still.slice(0, 5).join(', ')}${still.length > 5 ? ` and ${still.length - 5} more` : ''} still ${still.length === 1 ? 'isn’t' : 'aren’t'} in node_modules.`
    return { ok: false, text: `Installing the new packages didn’t finish. ${detail}`, output: lastLines(r.out, 80), problem: { title: 'Installing the new packages didn’t finish', detail, fixes: [] } }
  }
  return { ok: true, text: 'Installed the new packages.' }
}

async function getLatestMain(folder: string, step: Step = () => undefined): Promise<FixResult> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  if (!info.ok || info.error) throw new Error(info.error ?? 'Orbit couldn’t read this app’s folder.')
  const main = info.mainBranch ?? 'main'
  const dirty = info.changedFiles ?? 0
  if ((await gitOut(folder, ['remote', 'get-url', 'origin'])) === null) return { ok: false, message: 'This app’s folder isn’t linked to GitHub, so there’s no main to get.' }
  const files = dirty === 1 ? '1 file has' : `${dirty} files have`
  const start = await gitOut(folder, ['rev-parse', 'HEAD'])
  step(`Getting GitHub’s ${main}…`)
  let switched = ''
  if (info.branch !== main) {
    if (dirty)
      return {
        ok: false,
        message: `${files} changed on ${info.branch ?? 'this branch'}. Commit them or put them away first, so they stay with that branch and don’t come along to ${main}. Nothing was changed.`,
        problem: { title: 'Changed files on another branch', detail: 'Commit them or put them away first.', fixes: ['put-away'] }
      }
    const fetched = await run(folder, 'git', ['fetch', 'origin', main], { timeout: 120_000, interactive: true })
    if (!fetched.ok) return failed(fetched, { main })
    const co = await run(folder, 'git', ['checkout', main])
    if (!co.ok) return failed(co, { main })
    switched = `Switched from ${info.branch ?? 'the detached commit'} to ${main}. `
  }
  const before = await gitOut(folder, ['rev-parse', 'HEAD'])
  const pulled = await pullLatest(folder, main, !!dirty)
  if (!pulled.ok) return switched ? { ...pulled, message: switched + pulled.message } : pulled
  const after = await gitOut(folder, ['rev-parse', 'HEAD'])
  const came = before && after && before !== after ? Number(await gitOut(folder, ['rev-list', '--count', `${before}..${after}`])) || 0 : 0
  const ahead = aheadBehind(await gitOut(folder, ['rev-list', '--left-right', '--count', `HEAD...origin/${main}`]))
  if (ahead?.behind) return { ok: false, message: `${switched}Something stopped git getting all of GitHub’s ${main}: it’s still ${ahead.behind} behind.` }
  const got = pulled.message.includes('on top')
    ? pulled.message
    : `${came ? `Got ${came === 1 ? '1 new commit' : `${came} new commits`} from GitHub’s ${main}.` : `Already up to date with GitHub’s ${main}.`}${dirty ? ` Your ${dirty === 1 ? 'changed file is' : `${dirty} changed files are`} still here.` : ''}`
  const installed = await installIfNeeded(folder, start, step)
  if (!installed) return { ok: true, message: switched + got }
  if (!installed.ok) {
    const r: FixResult = { ok: false, message: `${switched}${got} ${installed.text}`, problem: installed.problem, output: installed.output }
    installFailed.add(r)
    return r
  }
  return { ok: true, message: `${switched}${got} ${installed.text}` }
}

/** One of the one-click fixes. */
async function fix(folder: string, id: string, arg: string): Promise<FixResult> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  const main = info.mainBranch ?? 'main'
  const repo = info.repo
  if (id === 'put-away') {
    const r = await run(folder, 'git', ['stash', 'push', '--include-untracked', '-m', 'Put away by Orbit before a release'])
    return r.ok ? { ok: true, message: 'Put the changes away. Bring them back later with git stash pop.' } : failed(r)
  }
  if (id === 'switch-main') {
    const r = await run(folder, 'git', ['checkout', main])
    if (!r.ok) return failed(r, { main })
    const p = await run(folder, 'git', ['pull', '--ff-only', 'origin', main], { timeout: 120_000, interactive: true })
    return p.ok ? { ok: true, message: `Switched to ${main} and got the latest.` } : failed(p, { main })
  }
  if (id === 'pull') return pullLatest(folder, main, !!info.changedFiles)
  if (id === 'finish-push') {
    const p = await run(folder, 'git', ['push', '--atomic', '--follow-tags', 'origin', `HEAD:refs/heads/${main}`], { timeout: 180_000, interactive: true })
    return p.ok ? { ok: true, message: 'Pushed. GitHub builds the release next.' } : failed(p, { main })
  }
  if (id === 'drop-notes') {
    if (!/^\d+\.\d+\.\d+$/.test(arg)) throw new Error('Not allowed')
    return dropNotes(folder, arg)
  }
  if (!isVersionTag(arg)) throw new Error('Not allowed')
  const tag = arg
  if (id === 'delete-tag') {
    let draftNote = ''
    if (repo && token()) {
      const r = await releaseFor(repo, tag).catch(() => undefined)
      if (r && !r.draft) return { ok: false, message: `${tag} is a published release, so Orbit won’t delete it. To go back from it, use the roll back on the release instead.` }
      if (r) {
        await github(`/repos/${repo}/releases/${r.id}`, { method: 'DELETE', doing: 'delete releases', needs: 'Contents' })
        draftNote = ' and its draft release'
      }
    } else if (repo) {
      const r = await releaseFor(repo, tag).catch(() => undefined)
      if (r && !r.draft) return { ok: false, message: `${tag} is a published release, so Orbit won’t delete it.` }
    }
    const there = await remoteTags(folder)
    if (there?.has(tag)) {
      const r = await run(folder, 'git', ['push', 'origin', `:refs/tags/${tag}`], { timeout: 120_000, interactive: true })
      if (!r.ok) return failed(r, { tag })
    }
    if ((await gitOut(folder, ['tag', '--list', tag])) === tag) {
      const r = await run(folder, 'git', ['tag', '-d', tag])
      if (!r.ok) return failed(r, { tag })
    }
    const extra = repo && !token() ? ' If GitHub has a draft release for it, delete that on GitHub too (connect GitHub and Orbit can do it).' : ''
    return { ok: true, message: `Deleted the ${tag} tag${draftNote}.${extra}` }
  }
  if (id === 'retag') {
    if (repo) {
      const r = await releaseFor(repo, tag).catch(() => undefined)
      if (r && !r.draft) return { ok: false, message: `${tag} is already published, so Orbit won’t move it.` }
    }
    if (info.branch !== main) return { ok: false, message: `Switch to ${main} first: the build has to be of ${main}.` }
    if (info.changedFiles) return { ok: false, message: 'Commit or put away the changed files first, so the fix is in what’s built.' }
    const v = await versionAt(folder, 'HEAD')
    if (`v${v}` !== tag) return { ok: false, message: `package.json says ${v ?? 'no version'} now, not ${tag.slice(1)}, so building it as ${tag} would be wrong. Release it as a new version instead.` }
    const p = await run(folder, 'git', ['push', 'origin', `HEAD:refs/heads/${main}`], { timeout: 180_000, interactive: true })
    if (!p.ok) return failed(p, { tag, main })
    const t = await run(folder, 'git', ['tag', '-f', '-a', tag, '-m', `Release ${tag.slice(1)}`])
    if (!t.ok) return failed(t, { tag })
    const tp = await run(folder, 'git', ['push', '--force', 'origin', `refs/tags/${tag}`], { timeout: 120_000, interactive: true })
    if (!tp.ok) return failed(tp, { tag })
    return { ok: true, message: `Moved ${tag} to the latest commit. GitHub builds it again now.` }
  }
  throw new Error('Not allowed')
}

/** Adds the "What's new" notes for a version to the app's list and commits just that file. */
async function writeNotes(folder: string, version: string, items: string[]): Promise<FixResult> {
  const file = findNotesFile(folder)
  if (!file) return { ok: false, message: 'Orbit couldn’t find the app’s What’s new list.' }
  const path = join(folder, file)
  const updated = addNotesEntry(readFileSync(path, 'utf8'), version, items)
  if (updated === null) return { ok: false, message: notesVersions(readFileSync(path, 'utf8')).includes(version) ? `${file} already has notes for ${version}.` : `Orbit couldn’t see where the list starts in ${file}. Add them by hand (or ask Claude).` }
  writeFileSync(path, updated)
  const add = await run(folder, 'git', ['add', '--', file])
  if (!add.ok) return failed(add)
  const commit = await run(folder, 'git', ['commit', '-m', `What's new notes for ${version}`, '--', file])
  if (!commit.ok) return failed(commit)
  return { ok: true, message: `Added the notes for ${version} to ${file} and committed them.` }
}

/** Takes out the "What's new" notes for versions newer than `next` (never released), and commits just that file. */
async function dropNotes(folder: string, next: string): Promise<FixResult> {
  const file = findNotesFile(folder)
  if (!file) return { ok: false, message: 'Orbit couldn’t find the app’s What’s new list.' }
  const path = join(folder, file)
  const source = readFileSync(path, 'utf8')
  const stale = staleNotes(notesVersions(source), next)
  if (!stale.length) return { ok: true, message: `${file} has no notes newer than ${next}.` }
  const updated = removeNotesEntries(source, stale)
  if (updated === null) return { ok: false, message: `Orbit couldn’t take the notes for ${stale.join(', ')} out of ${file}. Take them out by hand (or ask Claude).` }
  writeFileSync(path, updated)
  const add = await run(folder, 'git', ['add', '--', file])
  if (!add.ok) return failed(add)
  const commit = await run(folder, 'git', ['commit', '-m', `Remove What's new notes for unreleased ${stale.join(', ')}`, '--', file])
  if (!commit.ok) return failed(commit)
  return { ok: true, message: `Took the notes for ${stale.join(', ')} out of ${file} and committed it.` }
}

/** A GitHub address's text (a job's log). GitHub sends a link to the log, which fetch follows. */
async function githubText(path: string): Promise<string | null> {
  const key = token()
  if (!key) return null
  try {
    const res = await net.fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Orbit', Authorization: `Bearer ${key}` } })
    return res.ok ? (await res.text()).slice(-400_000) : null
  } catch {
    return null
  }
}

interface ApiRun {
  id: number
  status: string
  conclusion: string | null
  html_url: string
  run_started_at?: string
  created_at: string
  updated_at?: string
  event: string
  workflow_id?: number
}

interface ApiJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at?: string | null
  completed_at?: string | null
  steps?: { name: string; status: string; conclusion: string | null }[]
}

const took = (from?: string | null, to?: string | null): number | undefined => {
  const t = from && to ? Date.parse(to) - Date.parse(from) : NaN
  return Number.isFinite(t) && t > 0 ? t : undefined
}

const average = (list: (number | undefined)[]): number | undefined => {
  const ok = list.filter((n): n is number => n !== undefined)
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : undefined
}

/**
 * How long a workflow's last few good builds took, in all and job by job, for the time left.
 * Asked once per workflow (they don't change while a build runs).
 */
const usualTimes = new Map<string, Promise<{ run?: number; jobs: Record<string, number> }>>()
function usualTimesFor(repo: string, workflow: number, skip: number): Promise<{ run?: number; jobs: Record<string, number> }> {
  const key = `${repo}#${workflow}`
  let got = usualTimes.get(key)
  if (!got) {
    got = (async () => {
      const runs = await github<{ workflow_runs: ApiRun[] }>(`/repos/${repo}/actions/workflows/${workflow}/runs?status=success&per_page=4`)
      const last = runs.workflow_runs.filter((r) => r.id !== skip).slice(0, 3)
      const lists = await Promise.all(last.map((r) => github<{ jobs: ApiJob[] }>(`/repos/${repo}/actions/runs/${r.id}/jobs?filter=latest`).then((j) => j.jobs, () => [] as ApiJob[])))
      const names = new Set(lists.flat().map((j) => j.name))
      const jobs: Record<string, number> = {}
      for (const name of names) {
        const t = average(lists.map((l) => l.find((j) => j.name === name)).map((j) => took(j?.started_at, j?.completed_at)))
        if (t) jobs[name] = t
      }
      return { run: average(last.map((r) => took(r.run_started_at ?? r.created_at, r.updated_at))), jobs }
    })()
    usualTimes.set(key, got)
    // A failed look is tried again next time.
    got.catch(() => usualTimes.delete(key))
  }
  return got
}

/** What GitHub's build of a release is doing, and why it failed when it did. */
async function buildStatus(folder: string, repo: string, tag: string): Promise<BuildStatus> {
  const [tagCommit, head, there] = await Promise.all([gitOut(folder, ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]), gitOut(folder, ['rev-parse', 'HEAD']), remoteTags(folder)])
  const out: BuildStatus = { tag, tagHere: !!tagCommit, tagOnGitHub: !!there?.has(tag), tagIsHead: !!tagCommit && tagCommit === head }
  try {
    const r = await releaseFor(repo, tag)
    if (r) out.release = { draft: r.draft, prerelease: r.prerelease, url: r.html_url }
    if (!there && r) out.tagOnGitHub = true
    const runs = await github<{ workflow_runs: ApiRun[] }>(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(tag)}&per_page=5`, { doing: 'see GitHub’s builds (Actions)', needs: 'Actions' })
    const latest = runs.workflow_runs.find((w) => w.event === 'push' || w.event === 'workflow_dispatch')
    if (latest) {
      const [jobs, usual] = await Promise.all([
        github<{ jobs: ApiJob[] }>(`/repos/${repo}/actions/runs/${latest.id}/jobs?filter=latest`),
        latest.status !== 'completed' && latest.workflow_id ? usualTimesFor(repo, latest.workflow_id, latest.id).catch(() => undefined) : undefined
      ])
      const list: BuildJob[] = jobs.jobs.map((j) => ({
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        failedStep: j.steps?.find((s) => s.conclusion === 'failure')?.name,
        started: j.started_at ?? undefined,
        finished: j.completed_at ?? undefined,
        steps: j.steps?.map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
        usualMs: usual?.jobs[j.name]
      }))
      out.run = {
        id: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        url: latest.html_url,
        started: latest.run_started_at ?? latest.created_at,
        finished: latest.status === 'completed' ? latest.updated_at : undefined,
        usualMs: usual?.run,
        jobs: list
      }
      const bad = jobs.jobs.find((j) => j.conclusion === 'failure')
      if (bad) {
        const log = await githubText(`/repos/${repo}/actions/jobs/${bad.id}/logs`)
        const step = list.find((j) => j.name === bad.name)?.failedStep ?? ''
        out.problem = explainProblem(log ?? `${step} failed`, { tag, windows: /windows/i.test(bad.name), source: 'build' })
        if (log) out.log = lastLines(log, 80)
        // Without the log, at least say which step it was.
        if (!log && out.problem.title === 'Something went wrong') out.problem = { title: `The “${step || bad.name}” step failed`, detail: 'Open it on GitHub to see why, or connect GitHub (with Actions access) so Orbit can read it.', fixes: ['ask-claude'] }
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
  }
  return out
}

/** The fixes that run here, in words, for App Studio's problem history. */
const FIX_NAMES: Record<string, string> = {
  'put-away': 'Put changes away',
  'switch-main': 'Switch to main',
  pull: 'Get the latest',
  'finish-push': 'Push the release',
  'delete-tag': 'Delete the tag',
  retag: 'Build it again',
  'drop-notes': 'Take out leftover notes'
}

const validFolder = (folder: unknown): folder is string => typeof folder === 'string' && isAbsolute(folder) && !!statSync(folder, { throwIfNoEntry: false })?.isDirectory()
const validBump = (bump: unknown): bump is VersionBump => VERSION_BUMPS.some((b) => b.id === bump)

/** One release job per folder at a time, so a double click can't run two. */
const busy = new Set<string>()
async function once<T>(folder: string, job: () => Promise<T>): Promise<T> {
  if (busy.has(folder)) throw new Error('Orbit is already doing something with this app’s release. Wait for it to finish.')
  busy.add(folder)
  try {
    return await job()
  } catch (err) {
    logError('release helper', err)
    throw err
  } finally {
    busy.delete(folder)
  }
}

/**
 * A fresh, look-only check of an app for Claude Desktop: how it compares with GitHub's main, and
 * GitHub's build of its current version. Nothing is changed (it only fetches), and it waits for
 * nothing: when a release job is running on the folder, it says so instead.
 */
export async function lookAtRelease(folder: string): Promise<{ info: AppInfo; main?: MainStatus; build?: BuildStatus; busy?: boolean }> {
  const info = await appInfo(folder)
  nameApp(folder, info.repo)
  if (busy.has(folder)) return { info, busy: true }
  const main = info.ok && !info.error ? await mainStatus(folder).catch(() => undefined) : undefined
  if (main) sawMainStatus(folder, main)
  const tag = info.version ? `v${info.version}` : null
  const build = info.repo && tag && info.releaseWorkflow && token() ? await buildStatus(folder, info.repo, tag).catch(() => undefined) : undefined
  if (build) sawBuild(folder, build)
  return { info, main, build }
}

export function setupReleaseHelper(): void {
  ipcMain.handle('apps:preflight', (_e, folder: unknown, bump: unknown) => {
    if (!validFolder(folder) || !validBump(bump)) throw new Error('Not allowed')
    return once(folder, () => preflight(folder, bump)).then(
      (r) => (sawPreflight(folder, r), r),
      (err) => {
        sawFailure(folder, 'preflight', 'Checking before a release', err)
        throw err
      }
    )
  })
  // Not under once(): the tests run while you look at (and fix) the other checks.
  ipcMain.handle('apps:releaseTests', (e, folder: unknown) => {
    if (!validFolder(folder)) throw new Error('Not allowed')
    const sender = e?.sender
    const progress = (p: TestProgress): void => {
      if (sender && !sender.isDestroyed()) sender.send('apps:releaseTestsProgress', p)
    }
    return runTests(folder, progress).then((r) => (sawTests(folder, r), r))
  })
  ipcMain.handle('apps:release', (_e, folder: unknown, bump: unknown, expected: unknown) => {
    if (!validFolder(folder) || !validBump(bump) || typeof expected !== 'string') throw new Error('Not allowed')
    return once(folder, () => release(folder, bump, expected)).then(
      (r) => (sawRelease(folder, r), r),
      (err) => {
        sawFailure(folder, 'release', 'Making the release', err)
        throw err
      }
    )
  })
  ipcMain.handle('apps:releaseFix', (_e, folder: unknown, id: unknown, arg: unknown) => {
    if (!validFolder(folder) || typeof id !== 'string') throw new Error('Not allowed')
    const what = `Fix: ${FIX_NAMES[id] ?? id}`
    return once(folder, () => fix(folder, id, typeof arg === 'string' ? arg : '')).then(
      (r) => (sawFix(folder, what, r), r),
      (err) => {
        sawFailure(folder, 'git', what, err)
        throw err
      }
    )
  })
  // Not under once() (it's only a look), but it waits its turn behind a release job, so their
  // fetches don't trip over each other.
  ipcMain.handle('apps:mainStatus', (_e, folder: unknown) => {
    if (!validFolder(folder)) throw new Error('Not allowed')
    if (busy.has(folder)) throw new Error('busy')
    return mainStatus(folder).then((r) => (sawMainStatus(folder, r), r))
  })
  ipcMain.handle('apps:getLatestMain', (e, folder: unknown) => {
    if (!validFolder(folder)) throw new Error('Not allowed')
    const step: Step = (text) => {
      const sender = e?.sender
      if (sender && !sender.isDestroyed()) sender.send('apps:latestMainStep', { folder, text })
    }
    return once(folder, () => getLatestMain(folder, step)).then(
      (r) => (installFailed.delete(r) ? sawFix(folder, 'Get latest main: npm install', r, 'packages') : sawFix(folder, 'Get latest main', r), r),
      (err) => {
        sawFailure(folder, 'git', 'Get latest main', err)
        throw err
      }
    )
  })
  ipcMain.handle('apps:writeNotes', (_e, folder: unknown, version: unknown, items: unknown) => {
    if (!validFolder(folder) || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || !Array.isArray(items)) throw new Error('Not allowed')
    const lines = items.filter((i): i is string => typeof i === 'string' && !!i.trim()).map((i) => i.trim().slice(0, 500)).slice(0, 40)
    if (!lines.length) throw new Error('Write at least one line first.')
    return once(folder, () => writeNotes(folder, version, lines)).then((r) => (sawFix(folder, 'Writing the What’s new notes', r), r))
  })
  ipcMain.handle('apps:buildStatus', (_e, folder: unknown, repo: unknown, tag: unknown) => {
    if (!validFolder(folder) || !validRepo(repo) || typeof tag !== 'string' || !isVersionTag(tag)) throw new Error('Not allowed')
    return buildStatus(folder, repo, tag).then((r) => (sawBuild(folder, r), r))
  })
  ipcMain.handle('apps:rerunBuild', async (_e, repo: unknown, runId: unknown) => {
    if (!validRepo(repo) || !Number.isInteger(runId)) throw new Error('Not allowed')
    if (!token()) throw new Error('Connect GitHub in App Studio first, so Orbit can do that for you.')
    await github(`/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST', doing: 'run GitHub’s builds again (Actions)', needs: 'Actions' })
  })
  ipcMain.handle('apps:openDeveloperSettings', () => (WINDOWS ? shell.openExternal('ms-settings:developers') : undefined))
}
