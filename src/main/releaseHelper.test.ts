import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Check, FixResult, MainStatus, Preflight, ReleaseResult } from '@shared/releaseCheck'

/**
 * The release helper against real git repositories: an app folder cloned from a bare "GitHub" in
 * a temporary folder (so nothing reaches the real GitHub, and Orbit isn't connected to it).
 */

/** Made-up GitHub answers, by address (nothing is sent anywhere). */
const github: Record<string, unknown> = {}
async function fakeGitHub(url: string): Promise<Response> {
  const path = url.replace('https://api.github.com', '')
  const found = Object.entries(github).find(([p]) => path.startsWith(p))
  return found ? new Response(JSON.stringify(found[1]), { status: 200 }) : new Response('{"message":"Not Found"}', { status: 404 })
}

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const home = mkdtempSync(join(tmpdir(), 'orbit-release-'))

vi.mock('electron', () => ({
  app: { getPath: () => home, isPackaged: true, getAppPath: () => home, on: () => undefined },
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) },
  net: { fetch: (url: string) => fakeGitHub(url) },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() }
}))
vi.mock('./log', () => ({ logError: vi.fn() }))

const call = <T>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => handlers.get(name)!(null, ...args) as T)
const quiet = { stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[] }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', ...quiet }).trim()
const byId = (p: Preflight, id: Check['id']): Check => p.checks.find((c) => c.id === id)!

const NOTES = `export const RELEASE_NOTES = [
  {
    version: '1.0.0',
    items: ['First']
  }
]
`

let n = 0
/** A fresh "GitHub" (a bare repository) and the app's folder cloned from it, at 1.0.0 with notes for it. */
function newApp(): { app: string; origin: string; other: string } {
  const dir = join(home, `case${++n}`)
  const origin = join(dir, 'origin.git')
  const app = join(dir, 'app')
  const other = join(dir, 'other')
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], quiet)
  execFileSync('git', ['clone', '-q', origin, app], quiet)
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2) + '\n')
  mkdirSync(join(app, 'src', 'shared'), { recursive: true })
  writeFileSync(join(app, 'src', 'shared', 'whatsNew.ts'), NOTES)
  git(app, 'add', '-A')
  git(app, 'commit', '-qm', 'Start')
  git(app, 'push', '-q', 'origin', 'main')
  git(app, 'remote', 'set-head', 'origin', 'main')
  execFileSync('git', ['clone', '-q', origin, other], quiet)
  return { app, origin, other }
}

const remoteTags = (origin: string): string[] =>
  git(origin, 'tag', '--list')
    .split('\n')
    .filter(Boolean)

beforeAll(async () => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_CONFIG_NOSYSTEM: '1' })
  const { setupReleaseHelper } = await import('./releaseHelper')
  setupReleaseHelper()
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

// Real git and npm are slow to start on Windows (npm.cmd especially), so these get longer than vitest's 5 seconds.
describe('release helper (with real git)', { timeout: 60_000 }, () => {
  let app: string, origin: string, other: string
  beforeEach(() => {
    ;({ app, origin, other } = newApp())
  }, 60_000)

  it('checks a ready app, wants notes for the new version, writes them, and releases', async () => {
    let pre = await call<Preflight>('apps:preflight', app, 'minor')
    expect(pre).toMatchObject({ version: '1.0.0', next: '1.1.0', tag: 'v1.1.0', notesFile: 'src/shared/whatsNew.ts' })
    for (const id of ['tree', 'branch', 'latest', 'unfinished', 'tag', 'push'] as const) expect(byId(pre, id).state, id).toBe('pass')
    expect(byId(pre, 'notes')).toMatchObject({ state: 'fail', fixes: ['write-notes'] })
    // No GitHub repository (the origin is a folder), so no token check.
    expect(pre.checks.some((c) => c.id === 'token')).toBe(false)

    const wrote = await call<FixResult>('apps:writeNotes', app, '1.1.0', ['Checks before releasing', "Notes with an ' in them"])
    expect(wrote.ok).toBe(true)
    expect(readFileSync(join(app, 'src/shared/whatsNew.ts'), 'utf8')).toContain("version: '1.1.0'")
    expect(git(app, 'log', '-1', '--format=%s')).toBe("What's new notes for 1.1.0")
    expect(git(app, 'status', '--porcelain')).toBe('')

    pre = await call<Preflight>('apps:preflight', app, 'minor')
    expect(byId(pre, 'notes').state).toBe('pass')
    expect(byId(pre, 'latest').text).toMatch(/1 commit here isn’t on GitHub yet/)

    const tests = await call<Check>('apps:releaseTests', app)
    expect(tests.state).toBe('pass')

    const done = await call<ReleaseResult>('apps:release', app, 'minor', '1.1.0')
    expect(done).toMatchObject({ ok: true, tag: 'v1.1.0' })
    expect(remoteTags(origin)).toEqual(['v1.1.0'])
    expect(git(origin, 'log', '-1', '--format=%s', 'main')).toBe('Release 1.1.0')
  })

  it('won’t release a version other than the one checked', async () => {
    await expect(call('apps:release', app, 'major', '1.1.0')).rejects.toThrow(/changed since the check/)
  })

  it('spots uncommitted files and puts them away', async () => {
    writeFileSync(join(app, 'scratch.txt'), 'hi')
    let pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'tree')).toMatchObject({ state: 'fail', fixes: ['put-away'] })
    expect((await call<FixResult>('apps:releaseFix', app, 'put-away')).ok).toBe(true)
    pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'tree').state).toBe('pass')
    expect(git(app, 'stash', 'list')).toMatch(/Put away by Orbit/)
  })

  it('spots another branch and switches back to main', async () => {
    git(app, 'checkout', '-qb', 'feature')
    let pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'branch')).toMatchObject({ state: 'fail', fixes: ['switch-main'] })
    expect((await call<FixResult>('apps:releaseFix', app, 'switch-main')).ok).toBe(true)
    pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'branch').state).toBe('pass')
  })

  it('spots that GitHub has newer commits, and gets them', async () => {
    writeFileSync(join(other, 'merged.txt'), 'from a pull request')
    git(other, 'add', '-A')
    git(other, 'commit', '-qm', 'Merged on GitHub')
    git(other, 'push', '-q', 'origin', 'main')
    let pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'latest')).toMatchObject({ state: 'fail', fixes: ['pull'] })
    // Being behind isn't a sign-in problem.
    expect(byId(pre, 'push').state).toBe('pass')
    expect((await call<FixResult>('apps:releaseFix', app, 'pull')).ok).toBe(true)
    pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'latest').state).toBe('pass')
  })

  describe('Get latest main', () => {
    const mergeOnGitHub = (name: string, text = 'from a pull request'): void => {
      writeFileSync(join(other, name), text)
      git(other, 'add', '-A')
      git(other, 'commit', '-qm', `Merged ${name}`)
      git(other, 'push', '-q', 'origin', 'main')
    }

    it('says how far behind main is, and gets it', async () => {
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ onMain: true, linked: true, behind: 0, ahead: 0 })
      mergeOnGitHub('a.txt')
      mergeOnGitHub('b.txt')
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ onMain: true, behind: 2, ahead: 0 })
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r).toMatchObject({ ok: true, message: 'Got 2 new commits from GitHub’s main.' })
      expect(git(app, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'))
      expect((await call<FixResult>('apps:getLatestMain', app)).message).toBe('Already up to date with GitHub’s main.')
    })

    it('keeps changed files that the new commits don’t touch', async () => {
      mergeOnGitHub('a.txt')
      writeFileSync(join(app, 'mine.txt'), 'not committed')
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r.ok).toBe(true)
      expect(r.message).toMatch(/Your changed file is still here/)
      expect(readFileSync(join(app, 'mine.txt'), 'utf8')).toBe('not committed')
    })

    it('stops, changing nothing, when the new commits touch a changed file', async () => {
      mergeOnGitHub('clash.txt', 'GitHub’s')
      writeFileSync(join(app, 'clash.txt'), 'mine')
      const head = git(app, 'rev-parse', 'HEAD')
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r.ok).toBe(false)
      expect(git(app, 'rev-parse', 'HEAD')).toBe(head)
      expect(readFileSync(join(app, 'clash.txt'), 'utf8')).toBe('mine')
    })

    it('switches from another branch to main and gets it', async () => {
      git(app, 'checkout', '-qb', 'feature')
      mergeOnGitHub('a.txt')
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ onMain: false, branch: 'feature', behind: 1 })
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r).toMatchObject({ ok: true, message: 'Switched from feature to main. Got 1 new commit from GitHub’s main.' })
      expect(git(app, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
      expect(git(app, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'))
    })

    it('won’t switch branches with changed files', async () => {
      git(app, 'checkout', '-qb', 'feature')
      writeFileSync(join(app, 'wip.txt'), 'work in progress')
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/Nothing was changed/)
      expect(git(app, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature')
      expect(readFileSync(join(app, 'wip.txt'), 'utf8')).toBe('work in progress')
    })

    it('puts this computer’s own commits on top when main has moved on', async () => {
      mergeOnGitHub('a.txt')
      writeFileSync(join(app, 'local.txt'), 'here')
      git(app, 'add', '-A')
      git(app, 'commit', '-qm', 'Local work')
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ behind: 1, ahead: 1 })
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r.ok).toBe(true)
      expect(git(app, 'log', '--format=%s', '-2').split('\n')).toEqual(['Local work', 'Merged a.txt'])
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ behind: 0, ahead: 1 })
    })

    /** Merges a package.json on GitHub that needs a local package (so it installs offline), with any extra scripts. */
    const addPackageOnGitHub = (scripts: Record<string, string> = {}): void => {
      mkdirSync(join(other, 'lib'), { recursive: true })
      writeFileSync(join(other, 'lib', 'package.json'), JSON.stringify({ name: 'demo-lib', version: '1.0.0' }))
      writeFileSync(join(other, '.gitignore'), 'node_modules\npackage-lock.json\n')
      const pkg = JSON.parse(readFileSync(join(other, 'package.json'), 'utf8'))
      pkg.dependencies = { 'demo-lib': 'file:./lib' }
      Object.assign(pkg.scripts, scripts)
      writeFileSync(join(other, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
      git(other, 'add', '-A')
      git(other, 'commit', '-qm', 'New package')
      git(other, 'push', '-q', 'origin', 'main')
    }

    it('installs new packages after getting main, saying what it’s doing', async () => {
      addPackageOnGitHub()
      const steps: string[] = []
      const sender = { isDestroyed: () => false, send: (_c: string, s: { text: string }) => steps.push(s.text) }
      const r = await Promise.resolve(handlers.get('apps:getLatestMain')!({ sender }, app) as Promise<FixResult>)
      expect(r).toMatchObject({ ok: true, message: 'Got 1 new commit from GitHub’s main. Installed the new packages.' })
      expect(existsSync(join(app, 'node_modules', 'demo-lib', 'package.json'))).toBe(true)
      expect(steps).toEqual(['Getting GitHub’s main…', 'Installing the new packages (npm install)…'])
      // Nothing new and nothing missing: no install.
      expect((await call<FixResult>('apps:getLatestMain', app)).message).toBe('Already up to date with GitHub’s main.')
    })

    it('installs packages an earlier get left out, even when already up to date', async () => {
      addPackageOnGitHub()
      git(app, 'pull', '-q', 'origin', 'main')
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r).toMatchObject({ ok: true, message: 'Already up to date with GitHub’s main. Installed the new packages.' })
      expect(existsSync(join(app, 'node_modules', 'demo-lib', 'package.json'))).toBe(true)
    })

    it('says when installing the new packages fails, with what npm said, and keeps it in the error history', async () => {
      addPackageOnGitHub({ postinstall: 'node -e "console.error(\'native build broke\');process.exit(1)"' })
      const r = await call<FixResult>('apps:getLatestMain', app)
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/^Got 1 new commit from GitHub’s main\. Installing the new packages failed\./)
      expect(r.output).toMatch(/native build broke/)
      // The code still came in.
      expect(git(app, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'))
      const { studioErrors } = await import('./studioErrors')
      const latest = studioErrors().find((e) => e.folder === app)
      expect(latest).toMatchObject({ kind: 'packages', step: 'Get latest main: npm install', title: 'Installing the new packages failed' })
    })

    it('says when the folder isn’t on GitHub', async () => {
      git(app, 'remote', 'remove', 'origin')
      expect(await call<MainStatus>('apps:mainStatus', app)).toMatchObject({ linked: false })
      expect((await call<FixResult>('apps:getLatestMain', app)).ok).toBe(false)
    })
  })

  it('explains a push turned away during the release, and finishes it once sorted', async () => {
    await call('apps:writeNotes', app, '1.0.1', ['A fix'])
    // Something lands on GitHub between the check and the release.
    writeFileSync(join(other, 'late.txt'), 'late')
    git(other, 'add', '-A')
    git(other, 'commit', '-qm', 'Late merge')
    git(other, 'push', '-q', 'origin', 'main')
    const r = await call<ReleaseResult>('apps:release', app, 'patch', '1.0.1')
    expect(r).toMatchObject({ ok: false, step: 'push', tag: 'v1.0.1' })
    expect(r.problem?.title).toBe('GitHub has changes this computer doesn’t')
    expect(r.problem?.fixes).toEqual(['pull', 'finish-push'])

    // Next time, the checks say the release never reached GitHub.
    const pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'unfinished')).toMatchObject({ state: 'fail', fixes: ['finish-push', 'delete-tag'], tag: 'v1.0.1' })

    // Nothing reached GitHub: the push was all or nothing, so the tag didn't go up on its own.
    expect(remoteTags(origin)).toEqual([])

    // Getting the latest puts the release on top of GitHub's commit, and its tag moves with it.
    const pulled = await call<FixResult>('apps:releaseFix', app, 'pull')
    expect(pulled.ok).toBe(true)
    expect(pulled.message).toMatch(/v1\.0\.1 moved/)
    expect(git(app, 'rev-parse', 'v1.0.1^{commit}')).toBe(git(app, 'rev-parse', 'HEAD'))
    expect((await call<FixResult>('apps:releaseFix', app, 'finish-push')).ok).toBe(true)
    expect(remoteTags(origin)).toEqual(['v1.0.1'])
    expect(git(origin, 'rev-parse', 'v1.0.1^{commit}')).toBe(git(origin, 'rev-parse', 'main'))
    expect(git(origin, 'log', '--format=%s', 'main').split('\n').slice(0, 3)).toEqual(['Release 1.0.1', "What's new notes for 1.0.1", 'Late merge'])
  })

  it('deletes a leftover tag here and on GitHub', async () => {
    git(app, 'tag', '-a', 'v1.0.1', '-m', 'left over')
    git(app, 'push', '-q', 'origin', 'v1.0.1')
    let pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'tag')).toMatchObject({ state: 'fail', fixes: ['delete-tag'], tag: 'v1.0.1' })
    const r = await call<FixResult>('apps:releaseFix', app, 'delete-tag', 'v1.0.1')
    expect(r.ok).toBe(true)
    expect(remoteTags(origin)).toEqual([])
    expect(git(app, 'tag', '--list')).toBe('')
    pre = await call<Preflight>('apps:preflight', app, 'patch')
    expect(byId(pre, 'tag').state).toBe('pass')
  })

  it('moves a release’s tag to a fix and pushes it, so GitHub builds again', async () => {
    await call('apps:writeNotes', app, '1.0.1', ['A fix'])
    expect((await call<ReleaseResult>('apps:release', app, 'patch', '1.0.1')).ok).toBe(true)
    const first = git(origin, 'rev-parse', 'v1.0.1^{commit}')
    // The tag is already on the latest commit: nothing to build again from.
    writeFileSync(join(app, 'fix.txt'), 'the fix')
    git(app, 'add', '-A')
    git(app, 'commit', '-qm', 'The fix')
    const r = await call<FixResult>('apps:releaseFix', app, 'retag', 'v1.0.1')
    expect(r.ok).toBe(true)
    const moved = git(origin, 'rev-parse', 'v1.0.1^{commit}')
    expect(moved).not.toBe(first)
    expect(moved).toBe(git(app, 'rev-parse', 'HEAD'))
    expect(git(origin, 'log', '-1', '--format=%s', 'main')).toBe('The fix')
  })

  it('won’t move a tag to a commit with a different version', async () => {
    git(app, 'tag', '-a', 'v2.0.0', '-m', 'wrong')
    const r = await call<FixResult>('apps:releaseFix', app, 'retag', 'v2.0.0')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/package.json says 1.0.0/)
  })

  it('only acts on plain version tags', async () => {
    await expect(call('apps:releaseFix', app, 'delete-tag', 'main')).rejects.toThrow('Not allowed')
    await expect(call('apps:releaseFix', app, 'delete-tag', '--force')).rejects.toThrow('Not allowed')
    await expect(call('apps:releaseFix', app, 'rm -rf', 'v1.0.0')).rejects.toThrow('Not allowed')
  })

  it('explains failing tests in plain words', async () => {
    const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    pkg.scripts.test = 'node -e "console.error(\'ReferenceError: localStorage is not defined\'); process.exit(1)"'
    writeFileSync(join(app, 'package.json'), JSON.stringify(pkg))
    const c = await call<Check>('apps:releaseTests', app)
    expect(c.state).toBe('fail')
    expect(c.text).toMatch(/^A test tripped over localStorage/)
    expect(c.fixes).toEqual(['ask-claude'])
    expect(c.output).toContain('localStorage is not defined')
  })

  it('reads GitHub’s build of a release (made-up GitHub answers)', async () => {
    await call('apps:writeNotes', app, '1.0.1', ['A fix'])
    expect((await call<ReleaseResult>('apps:release', app, 'patch', '1.0.1')).ok).toBe(true)
    Object.assign(github, {
      '/repos/me/demo/releases': [{ id: 1, tag_name: 'v1.0.1', draft: true, prerelease: false, html_url: 'https://github.com/me/demo/releases/tag/v1.0.1' }],
      '/repos/me/demo/actions/runs?': { workflow_runs: [{ id: 42, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/me/demo/actions/runs/42', created_at: '2026-11-22T18:00:00Z', event: 'push' }] },
      '/repos/me/demo/actions/runs/42/jobs': {
        jobs: [
          { id: 1, name: 'Create draft release', status: 'completed', conclusion: 'success', steps: [] },
          { id: 2, name: 'Build (Windows)', status: 'completed', conclusion: 'failure', steps: [{ name: 'Run npm test', conclusion: 'failure' }] }
        ]
      }
    })
    const s = await call<import('@shared/releaseCheck').BuildStatus>('apps:buildStatus', app, 'me/demo', 'v1.0.1')
    expect(s).toMatchObject({ tag: 'v1.0.1', tagHere: true, tagOnGitHub: true, tagIsHead: true, release: { draft: true } })
    expect(s.run?.jobs.map((j) => j.failedStep ?? j.conclusion)).toEqual(['success', 'Run npm test'])
    // Not connected, so there's no log to read: it says which step failed.
    expect(s.problem?.title).toBe('The “Run npm test” step failed')
    await expect(call('apps:buildStatus', app, 'me/demo', 'main')).rejects.toThrow('Not allowed')
  })
})
