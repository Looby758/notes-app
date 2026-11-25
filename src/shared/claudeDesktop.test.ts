import { describe, expect, it } from 'vitest'
import {
  addStudioError,
  appMatches,
  cardsForClaude,
  claudeConfigPaths,
  cleanAreas,
  hasOrbitServer,
  MAX_ERROR_OUTPUT,
  MAX_STUDIO_ERRORS,
  parsePullRef,
  readStudioErrors,
  redactSecrets,
  studioErrorsFor,
  studioErrorText,
  withOrbitServer,
  withoutOrbitServer,
  type StudioError
} from './claudeDesktop'
import type { BoardItem } from './appStudio'

const problem = (over: Partial<StudioError> = {}): Omit<StudioError, 'id'> => ({
  app: 'Looby758/notes-app',
  folder: '/code/notes-app',
  at: '2026-11-25T10:00:00.000Z',
  kind: 'tests',
  step: 'Type check and tests',
  title: '2 tests failed',
  detail: 'whatsNew.test.ts › has notes',
  output: 'FAIL src/whatsNew.test.ts',
  ...over
})

describe('redactSecrets', () => {
  it('blanks out tokens and keys', () => {
    const text = [
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'pat github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
      'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'Authorization: Bearer abc.def.ghi',
      'pushing to https://looby:hunter2@github.com/Looby758/notes-app.git',
      'password=hunter2 and "api_key": "abc123"',
      'aws AKIAABCDEFGHIJKLMNOP'
    ].join('\n')
    const out = redactSecrets(text)
    for (const secret of ['ghp_abcdef', 'github_pat_11', 'sk-ant-api03', 'abc.def.ghi', 'hunter2', 'abc123', 'AKIAABCDEFGHIJKLMNOP']) expect(out).not.toContain(secret)
    expect(out).toContain('https://[hidden]@github.com/Looby758/notes-app.git')
  })

  it('leaves ordinary output alone', () => {
    const text = 'FAIL src/main/thing.test.ts > adds up\nExpected 3, received 4\nnpm ERR! code ELIFECYCLE'
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('App Studio’s problem history', () => {
  it('keeps the newest first and at most 20', () => {
    let list: StudioError[] = []
    for (let i = 0; i < 25; i++) list = addStudioError(list, problem({ title: `Problem ${i}`, at: new Date(Date.UTC(2026, 10, 25, 0, i)).toISOString() }))
    expect(list).toHaveLength(MAX_STUDIO_ERRORS)
    expect(list[0].title).toBe('Problem 24')
    expect(list.at(-1)!.title).toBe('Problem 5')
  })

  it('moves the same problem seen again to the top instead of adding it twice', () => {
    let list = addStudioError([], problem({ title: 'Behind GitHub', kind: 'git', step: 'Checking GitHub’s main' }))
    list = addStudioError(list, problem({ title: 'Tests failed' }))
    list = addStudioError(list, problem({ title: 'Behind GitHub', kind: 'git', step: 'Checking GitHub’s main', at: '2026-11-25T11:00:00.000Z', output: 'newer' }))
    expect(list.map((e) => e.title)).toEqual(['Behind GitHub', 'Tests failed'])
    expect(list[0].output).toBe('newer')
  })

  it('hides secrets and keeps the end of a huge log', () => {
    const output = 'x'.repeat(MAX_ERROR_OUTPUT * 2) + '\nremote: token ghp_abcdefghijklmnopqrstuvwxyz0123456789 rejected'
    const [e] = addStudioError([], problem({ output }))
    expect(e.output.length).toBeLessThanOrEqual(MAX_ERROR_OUTPUT + 1)
    expect(e.output).toContain('rejected')
    expect(e.output).not.toContain('ghp_')
  })

  it('reads a saved list, leaving out broken entries', () => {
    const good = addStudioError([], problem())[0]
    expect(readStudioErrors([good, { id: 'x' }, null, 'nope', { ...good, kind: 'other' }])).toEqual([good])
    expect(readStudioErrors('nope')).toEqual([])
  })

  it('finds an app’s problems by repository, name or folder', () => {
    const list = [addStudioError([], problem())[0], addStudioError([], problem({ app: 'orbit-music', folder: 'C:\\code\\orbit-music' }))[0]]
    expect(studioErrorsFor(list, 'notes-app')).toHaveLength(1)
    expect(studioErrorsFor(list, 'Looby758/NOTES-APP')).toHaveLength(1)
    expect(studioErrorsFor(list, 'orbit-music')[0].app).toBe('orbit-music')
    expect(studioErrorsFor(list)).toHaveLength(2)
    expect(studioErrorsFor(list, 'something-else')).toHaveLength(0)
  })

  it('writes a problem out with its output', () => {
    const text = studioErrorText(addStudioError([], problem())[0])
    expect(text).toContain('2 tests failed (Tests: Type check and tests)')
    expect(text).toContain('App: Looby758/notes-app')
    expect(text).toContain('Output:\nFAIL src/whatsNew.test.ts')
  })
})

describe('appMatches', () => {
  it('matches the repository, its name, the app’s name or the folder', () => {
    const app = { repo: 'Looby758/orbit-music', name: 'Orbit Music', folder: '/Users/l/code/orbit-music' }
    for (const w of ['Looby758/orbit-music', 'orbit-music', 'ORBIT MUSIC', '/Users/l/code/orbit-music']) expect(appMatches(w, app)).toBe(true)
    expect(appMatches('notes-app', app)).toBe(false)
  })
})

describe('the board for Claude', () => {
  const item = (over: Partial<BoardItem>): BoardItem => ({ id: 'a', app: 'Looby758/notes-app', kind: 'bug', title: 'T', details: '', column: 'ideas', pictures: ['p.png'], created: '', updated: '', ...over })
  const items = [item({ id: 'a' }), item({ id: 'b', column: 'done' }), item({ id: 'c', app: 'Calc', details: 'token=abc123' })]

  it('leaves out done cards unless asked, and pictures always', () => {
    expect(cardsForClaude(items).map((c) => c.id)).toEqual(['a', 'c'])
    expect(cardsForClaude(items, { includeDone: true }).map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(cardsForClaude(items)[0]).not.toHaveProperty('pictures')
  })

  it('narrows to one app and hides secrets in the details', () => {
    expect(cardsForClaude(items, { app: 'notes-app' }).map((c) => c.id)).toEqual(['a'])
    expect(cardsForClaude(items, { app: 'calc' })[0].details).toBe('token=[hidden]')
  })

  it('reads pull requests however Claude writes them', () => {
    expect(parsePullRef('https://github.com/Looby758/notes-app/pull/201')).toBe('Looby758/notes-app#201')
    expect(parsePullRef('Looby758/notes-app#7')).toBe('Looby758/notes-app#7')
    expect(parsePullRef('#12', 'Looby758/notes-app')).toBe('Looby758/notes-app#12')
    expect(parsePullRef('12', 'Looby758/notes-app')).toBe('Looby758/notes-app#12')
    expect(parsePullRef('12')).toBeNull()
    expect(parsePullRef('the big one')).toBeNull()
  })
})

describe('Claude Desktop’s settings file', () => {
  const entry = { command: '/Applications/Orbit.app/Contents/MacOS/Orbit', args: ['/bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', ORBIT_PORT_FILE: '/port.json', ORBIT_TOKEN: 'secret' } }

  it('adds Orbit and keeps everything else', () => {
    const before = JSON.stringify({ theme: 'dark', mcpServers: { files: { command: 'npx', args: ['files'] } } })
    const after = JSON.parse(withOrbitServer(before, entry))
    expect(after.theme).toBe('dark')
    expect(after.mcpServers.files).toEqual({ command: 'npx', args: ['files'] })
    expect(after.mcpServers.orbit).toEqual(entry)
  })

  it('makes a new file when there isn’t one', () => {
    expect(JSON.parse(withOrbitServer(null, entry))).toEqual({ mcpServers: { orbit: entry } })
  })

  it('won’t overwrite a file it can’t read', () => {
    expect(() => withOrbitServer('{ not json', entry)).toThrow()
    expect(() => withOrbitServer('[1,2]', entry)).toThrow()
  })

  it('knows whether Orbit is set up with this token, and takes it back out', () => {
    const file = withOrbitServer(JSON.stringify({ mcpServers: { files: {} } }), entry)
    expect(hasOrbitServer(file, 'secret')).toBe(true)
    expect(hasOrbitServer(file, 'other')).toBe(false)
    expect(hasOrbitServer('nope', 'secret')).toBe(false)
    expect(JSON.parse(withoutOrbitServer(file)!)).toEqual({ mcpServers: { files: {} } })
    expect(withoutOrbitServer(JSON.stringify({ mcpServers: {} }))).toBeNull()
  })

  it('looks in the right places on Windows (both installs) and Mac', () => {
    expect(claudeConfigPaths('darwin', { home: '/Users/l' })).toEqual(['/Users/l/Library/Application Support/Claude/claude_desktop_config.json'])
    expect(claudeConfigPaths('win32', { home: 'C:\\Users\\l', appData: 'C:\\Users\\l\\AppData\\Roaming', localAppData: 'C:\\Users\\l\\AppData\\Local', packages: ['Claude_pzs8sxrjxfjjc'] })).toEqual([
      'C:\\Users\\l\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
      'C:\\Users\\l\\AppData\\Local\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json'
    ])
  })
})

describe('cleanAreas', () => {
  it('has email off until switched on, everything else on', () => {
    const a = cleanAreas(undefined)
    expect(a.email).toBe(false)
    expect(a.notes && a.appStudio && a.calendar).toBe(true)
    expect(cleanAreas({ email: true, notes: 'yes' })).toMatchObject({ email: true, notes: true })
  })
})
