import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  addNotesEntry,
  aheadBehind,
  buildPhase,
  cleanOutput,
  explainProblem,
  failedTests,
  isNotesList,
  jobsLine,
  notesItems,
  notesVersions,
  problemCard,
  readyToRelease,
  recoveryActions,
  type BuildStatus,
  type Check
} from './releaseCheck'

// The kinds of output the release has stopped on before (shortened, but as the tools print it).
const SYMLINK_ON_WINDOWS = `
 FAIL  src/main/archive/archive.test.ts > archives > keeps symlinks inside the archive
Error: EPERM: operation not permitted, symlink 'target.txt' -> 'C:\\Users\\me\\AppData\\Local\\Temp\\orbit-archive\\link.txt'
 ❯ Object.symlinkSync node:fs:1813:3

 Test Files  1 failed | 88 passed (89)
      Tests  1 failed | 1207 passed (1208)
`

const LOCAL_STORAGE = `
 FAIL  src/renderer/src/lib/editorController.test.ts [ src/renderer/src/lib/editorController.test.ts ]
ReferenceError: localStorage is not defined
 ❯ src/renderer/src/store/comics.ts:13:68

 Test Files  2 failed | 87 passed (89)
`

// GitHub's log: a timestamp on every line, and colour codes.
const MISSING_NOTES_ON_GITHUB = [
  '2026-11-22T18:02:11.1234567Z > notesapp@1.14.0 test',
  '2026-11-22T18:02:11.2234567Z > vitest run',
  "2026-11-22T18:02:40.0000000Z \x1b[31m FAIL \x1b[39m src/shared/whatsNew.test.ts > what's new > has notes for the current version or a newer one",
  '2026-11-22T18:02:40.0000000Z AssertionError: expected -1 to be greater than or equal to 0',
  '2026-11-22T18:02:41.0000000Z  Test Files  1 failed | 88 passed (89)',
  '2026-11-22T18:02:41.0000000Z ##[error]Process completed with exit code 1.'
].join('\n')

describe('explaining what went wrong', () => {
  it('says a symlink test failing on Windows is a Windows setting, with Developer Mode as the fix', () => {
    const p = explainProblem(SYMLINK_ON_WINDOWS, { windows: true })
    expect(p.title).toMatch(/symlink/)
    expect(p.detail).toMatch(/not a problem with your code/)
    expect(p.fixes).toEqual(['developer-mode', 'ask-claude'])
    // Not on Windows there's no Developer Mode to offer.
    expect(explainProblem(SYMLINK_ON_WINDOWS, { windows: false }).fixes).toEqual(['ask-claude'])
  })

  it('explains a test that trips over localStorage', () => {
    const p = explainProblem(LOCAL_STORAGE)
    expect(p.title).toBe('A test tripped over localStorage, which only exists inside the app')
    expect(p.fixes).toEqual(['ask-claude'])
    expect(p.detail).toMatch(/Failed: editorController\.test\.ts/)
  })

  it('spots missing What’s new notes in GitHub’s build log and offers to write them', () => {
    const p = explainProblem(MISSING_NOTES_ON_GITHUB, { tag: 'v1.14.0' })
    expect(p.title).toMatch(/What’s new notes/)
    expect(p.detail).toMatch(/1\.14\.0/)
    expect(p.fixes).toEqual(['write-notes'])
  })

  it('doesn’t blame the notes when their test passed and another failed', () => {
    const out = ' ✓ src/shared/whatsNew.test.ts (6 tests) 4ms\n FAIL  src/shared/money.test.ts > adds up\n Tests  1 failed | 20 passed'
    const p = explainProblem(out)
    expect(p.title).toBe('1 test failed')
    expect(p.detail).toMatch(/money\.test\.ts › adds up/)
  })

  it('explains git turning the push away because GitHub has newer commits', () => {
    const out = ` ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/Looby758/notes-app.git'
hint: Updates were rejected because the remote contains work that you do not have locally.`
    expect(explainProblem(out)).toMatchObject({ title: 'GitHub has changes this computer doesn’t', fixes: ['pull'] })
  })

  it('explains git not being signed in', () => {
    expect(explainProblem("fatal: could not read Username for 'https://github.com': terminal prompts disabled").fixes).toEqual(['sign-in'])
    expect(explainProblem('remote: Permission to Looby758/notes-app.git denied to someone.\nfatal: unable to access').fixes).toEqual(['sign-in'])
    expect(explainProblem('git@github.com: Permission denied (publickey).').title).toBe('Git couldn’t sign in to GitHub')
  })

  it('explains a leftover tag, uncommitted files, protected branches and no internet', () => {
    expect(explainProblem("npm error fatal: tag 'v1.14.0' already exists")).toMatchObject({ title: 'There’s already a v1.14.0 tag', fixes: ['delete-tag'] })
    expect(explainProblem('npm error Git working directory not clean.\nnpm error M package-lock.json').fixes).toEqual(['put-away'])
    expect(explainProblem('remote: error: GH006: Protected branch update failed for refs/heads/main.', { main: 'main' }).title).toBe('GitHub doesn’t allow pushing straight to main')
    expect(explainProblem("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com").title).toBe('Couldn’t reach GitHub')
  })

  it('explains type errors and missing packages', () => {
    expect(explainProblem("src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.").title).toBe('TypeScript found mistakes in the code')
    expect(explainProblem("'vitest' is not recognized as an internal or external command").fixes).toEqual(['npm-install'])
    expect(explainProblem('sh: 1: vitest: not found').fixes).toEqual(['npm-install'])
  })

  it('doesn’t take test names or code in a test run for git problems', () => {
    // A failed run lists the tests that passed in the same file, and their names can sound like a problem.
    const out = [
      ' ❯ src/shared/releaseCheck.test.ts (21 tests | 1 failed) 40ms',
      '   ✓ explaining what went wrong > explains a leftover tag, uncommitted files, protected branches and no internet 1ms',
      '   √ explaining what went wrong > explains git not being signed in 0ms',
      '   × the app’s What’s new list > adds an entry at the top 3ms',
      " FAIL  src/shared/releaseCheck.test.ts > the app’s What’s new list > adds an entry at the top",
      "AssertionError: expected 'remote: error: GH006: Protected branch update failed' to contain 'x'",
      ' Test Files  1 failed | 185 passed (186)',
      '      Tests  1 failed | 1822 passed (1823)'
    ].join('\n')
    const p = explainProblem(out, { source: 'tests' })
    expect(p.title).toBe('1 test failed')
    expect(p.detail).toContain('releaseCheck.test.ts › adds an entry at the top')
    // The same words from git itself still explain a push.
    expect(explainProblem('remote: error: GH006: Protected branch update failed for refs/heads/main.', { source: 'git', main: 'main' }).title).toBe('GitHub doesn’t allow pushing straight to main')
    expect(explainProblem(out, { source: 'build' }).title).toBe('1 test failed')
  })

  it('falls back to the last error line, and Claude', () => {
    const p = explainProblem('doing things\nnpm error code E418\nnpm error I’m a teapot\nmore')
    expect(p.title).toBe('Something went wrong')
    expect(p.detail).toContain('I’m a teapot')
    expect(p.fixes).toEqual(['ask-claude'])
  })

  it('makes a board card for Claude with what the tools said', () => {
    const card = problemCard('Orbit', '1.14.0', explainProblem(LOCAL_STORAGE), LOCAL_STORAGE)
    expect(card.title).toMatch(/^Release blocked: A test tripped over localStorage/)
    expect(card.details).toContain('Releasing Orbit v1.14.0 stopped')
    expect(card.details).toContain('ReferenceError: localStorage is not defined')
  })
})

describe('reading tool output', () => {
  it('drops colour codes, redraws and GitHub’s timestamps', () => {
    expect(cleanOutput('2026-11-22T18:02:11.1234567Z \x1b[32mok\x1b[39m')).toBe('ok')
    expect(cleanOutput('50%\r100%')).toBe('100%')
  })

  it('lists the failed tests by file and name', () => {
    expect(failedTests(SYMLINK_ON_WINDOWS)).toEqual(['archive.test.ts › keeps symlinks inside the archive'])
    expect(failedTests(MISSING_NOTES_ON_GITHUB)).toEqual(['whatsNew.test.ts › has notes for the current version or a newer one'])
    expect(failedTests(' FAIL  src/a.test.ts\n FAIL  src/a.test.ts > b')).toEqual(['a.test.ts › b'])
  })

  it('reads how far ahead and behind GitHub this computer is', () => {
    expect(aheadBehind('2\t3')).toEqual({ ahead: 2, behind: 3 })
    expect(aheadBehind(null)).toBeNull()
    expect(aheadBehind('fatal: bad revision')).toBeNull()
  })

  it('is ready only when nothing failed or is still running', () => {
    const c = (state: Check['state']): Check => ({ id: 'tree', label: '', state, text: '' })
    expect(readyToRelease([c('pass'), c('warn'), c('skip')])).toBe(true)
    expect(readyToRelease([c('pass'), c('fail')])).toBe(false)
    expect(readyToRelease([c('pass'), c('running')])).toBe(false)
    expect(readyToRelease([])).toBe(false)
  })
})

describe('the app’s What’s new list', () => {
  // Git on Windows may check the file out with \r\n line endings; the tests are about the list, not those.
  const real = readFileSync(join(__dirname, 'whatsNew.ts'), 'utf8').replace(/\r\n/g, '\n')

  it('reads the versions in Orbit’s own list', () => {
    expect(isNotesList(real)).toBe(true)
    expect(notesVersions(real)).toContain('1.13.0')
    expect(isNotesList('export const version = "1.2.3"')).toBe(false)
  })

  it('turns written notes into lines', () => {
    expect(notesItems("What's new\n- Music page\n- Calendar: day view\n\nFixes\n- Fix: sign-in")).toEqual(['Music page', 'Calendar: day view', 'Fix: sign-in'])
    expect(notesItems('Just one line\nand another')).toEqual(['Just one line', 'and another'])
    expect(notesItems('1. First\n2) Second')).toEqual(['First', 'Second'])
  })

  it('adds an entry at the top of Orbit’s real list, and the file still works', () => {
    const items = ['Releases: checks before releasing', 'It’s got an apostrophe\'s and a \\ backslash']
    const out = addNotesEntry(real, '9.9.9', items)
    expect(out).not.toBeNull()
    expect(notesVersions(out!)[0]).toBe('9.9.9')
    // Run the changed file: the new entry is first, with the lines exactly as written.
    const js = ts.transpileModule(out!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const mod: { exports: Record<string, unknown> } = { exports: {} }
    new Function('module', 'exports', js)(mod, mod.exports)
    const notes = mod.exports.RELEASE_NOTES as { version: string; items: string[] }[]
    expect(notes[0]).toEqual({ version: '9.9.9', items })
    // The newest entry already there comes next, whatever it is by now.
    expect(notes[1].version).toBe(notesVersions(real)[0])
    // Indented like the entries already there.
    expect(out).toContain("\n  {\n    version: '9.9.9',\n    items: [\n      'Releases: checks before releasing',")
  })

  it('keeps Windows line endings', () => {
    const out = addNotesEntry(real.replace(/\n/g, '\r\n'), '9.9.9', ['A'])!
    expect(out).toContain("version: '9.9.9'")
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('adds to an empty list, and leaves a version that’s already there', () => {
    expect(addNotesEntry('export const RELEASE_NOTES = []\n', '1.0.0', ['First'])).toBe("export const RELEASE_NOTES = [\n  {\n    version: '1.0.0',\n    items: [\n      'First'\n    ]\n  }\n]\n")
    expect(addNotesEntry(real, '1.13.0', ['x'])).toBeNull()
    expect(addNotesEntry('const x = 1', '1.0.0', ['x'])).toBeNull()
  })
})

describe('after the release: GitHub’s build', () => {
  const base: BuildStatus = { tag: 'v1.14.0', tagHere: true, tagOnGitHub: true, tagIsHead: true }
  const run = (status: string, conclusion: string | null): BuildStatus['run'] => ({ id: 7, status, conclusion, url: 'https://github.com/x', started: '', jobs: [] })

  it('knows where a release is', () => {
    expect(buildPhase({ ...base, tagOnGitHub: false })).toBe('not-pushed')
    expect(buildPhase(base)).toBe('waiting')
    expect(buildPhase({ ...base, run: run('in_progress', null) })).toBe('building')
    expect(buildPhase({ ...base, run: run('completed', 'failure'), release: { draft: true, prerelease: false, url: '' } })).toBe('failed')
    expect(buildPhase({ ...base, run: run('completed', 'success'), release: { draft: false, prerelease: false, url: '' } })).toBe('published')
    expect(buildPhase({ ...base, run: run('completed', 'cancelled'), release: { draft: true, prerelease: false, url: '' } })).toBe('failed')
    expect(buildPhase({ ...base, release: { draft: true, prerelease: false, url: '' } })).toBe('draft')
  })

  it('offers the right ways back', () => {
    expect(recoveryActions({ ...base, tagOnGitHub: false })).toEqual(['finish-push', 'give-up'])
    expect(recoveryActions({ ...base, run: run('in_progress', null) })).toEqual([])
    expect(recoveryActions({ ...base, run: run('completed', 'failure') })).toEqual(['rerun', 'retag', 'give-up'])
    const notes = { ...base, run: run('completed', 'failure'), problem: explainProblem(MISSING_NOTES_ON_GITHUB, { tag: 'v1.14.0' }) }
    expect(recoveryActions(notes)).toEqual(['write-notes', 'rerun', 'retag', 'give-up'])
    // A published release is never offered for deleting.
    expect(recoveryActions({ ...base, run: run('completed', 'success'), release: { draft: false, prerelease: false, url: '' } })).toEqual([])
  })

  it('sums up the builds in a line', () => {
    expect(
      jobsLine([
        { name: 'Create draft release', status: 'completed', conclusion: 'success' },
        { name: 'Build (Windows)', status: 'completed', conclusion: 'failure', failedStep: 'Run npm test' },
        { name: 'Build (Mac)', status: 'in_progress', conclusion: null }
      ])
    ).toBe('Create draft release ✓ · Windows failed (Run npm test) · Mac building…')
  })
})
