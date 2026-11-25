import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildStatus, FixResult, MainStatus, ReleaseResult } from '@shared/releaseCheck'

const home = mkdtempSync(join(tmpdir(), 'orbit-errors-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('./log', () => ({ logError: vi.fn() }))

const s = await import('./studioErrors')

beforeEach(() => {
  rmSync(join(home, 'app-studio-errors.json'), { force: true })
  s.resetStudioErrorsForTests()
})

describe('App Studio’s problem history', () => {
  it('is saved in the settings folder and still there after a restart', () => {
    s.nameApp('/code/notes-app', 'Looby758/notes-app')
    s.recordStudioError('/code/notes-app', 'tests', 'Type check and tests', '1 test failed', 'whatsNew.test.ts', 'FAIL whatsNew.test.ts')
    const saved = JSON.parse(readFileSync(join(home, 'app-studio-errors.json'), 'utf8'))
    expect(saved[0]).toMatchObject({ app: 'Looby758/notes-app', title: '1 test failed', output: 'FAIL whatsNew.test.ts' })
    // A restart: nothing in memory, read from the file.
    s.resetStudioErrorsForTests()
    expect(s.studioErrors()[0]).toMatchObject({ app: 'Looby758/notes-app', kind: 'tests' })
  })

  it('records a failed release, a failed build, git trouble and a failed fix', () => {
    const folder = '/code/orbit-music'
    const release: ReleaseResult = { ok: false, step: 'push', tag: 'v1.2.0', problem: { title: 'GitHub turned the push away', detail: 'Get the latest first.', fixes: [] }, output: '! [rejected]' }
    s.sawRelease(folder, release)
    const build: BuildStatus = {
      tag: 'v1.2.0',
      tagHere: true,
      tagOnGitHub: true,
      tagIsHead: true,
      run: { id: 1, status: 'completed', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/1', started: '', jobs: [{ name: 'build (windows-latest)', status: 'completed', conclusion: 'failure', failedStep: 'Run tests' }] },
      problem: { title: 'A test failed on GitHub', detail: 'It passes here.', fixes: [] },
      log: 'Error: expected 1'
    }
    s.sawBuild(folder, build)
    const main: MainStatus = { main: 'main', onMain: true, dirty: 0, linked: true, behind: 0, ahead: 0, problem: 'Couldn’t check GitHub: Git isn’t signed in. Sign in again.', output: 'fatal: Authentication failed' }
    s.sawMainStatus(folder, main)
    const fix: FixResult = { ok: false, message: 'The changes clash. Fix them by hand.', output: 'CONFLICT (content)' }
    s.sawFix(folder, 'Get latest main', fix)
    const list = s.studioErrors()
    expect(list.map((e) => e.kind)).toEqual(['git', 'git', 'build', 'release'])
    expect(list[2]).toMatchObject({ step: 'build (windows-latest): Run tests', title: 'A test failed on GitHub', output: 'Error: expected 1' })
    expect(list[1]).toMatchObject({ title: 'Couldn’t check GitHub: Git isn’t signed in', step: 'Checking GitHub’s main' })
    expect(list[0]).toMatchObject({ step: 'Get latest main', title: 'The changes clash', output: 'CONFLICT (content)' })
    expect(list[3]).toMatchObject({ step: 'Pushing the release to GitHub', output: '! [rejected]' })
  })

  it('leaves out things that worked, and double clicks', () => {
    s.sawRelease('/a', { ok: true, tag: 'v1.0.1', output: '' })
    s.sawFix('/a', 'Put changes away', { ok: true, message: 'Done.' })
    s.sawMainStatus('/a', { main: 'main', onMain: true, dirty: 0, linked: true, behind: 0, ahead: 0 })
    s.sawFailure('/a', 'release', 'Making the release', new Error('Orbit is already doing something with this app’s release. Wait for it to finish.'))
    expect(s.studioErrors()).toEqual([])
    // But it does remember what the release helper said.
    expect(s.releaseMemory('/a').release?.result.tag).toBe('v1.0.1')
    expect(s.knownFolders()).toEqual(['/a'])
  })
})
