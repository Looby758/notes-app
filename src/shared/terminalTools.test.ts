import { describe, expect, it } from 'vitest'
import { LineTracker, addToHistory, commandBlank, commandLabel, fillCommand, findFiles, isErrorLine, keepsRunning, latestAndRunCommand, resolveFrom, runCommandOf } from './terminalTools'

describe('isErrorLine', () => {
  it('spots errors from npm, git, TypeScript and test runners', () => {
    expect(isErrorLine('npm ERR! code ERESOLVE')).toBe(true)
    expect(isErrorLine("error: pathspec 'feature' did not match any file(s) known to git")).toBe(true)
    expect(isErrorLine('src/app.ts(3,5): error TS2304: Cannot find name "x".')).toBe(true)
    expect(isErrorLine(' FAIL  src/app.test.ts')).toBe(true)
    expect(isErrorLine('Tests  2 failed | 10 passed')).toBe(true)
    expect(isErrorLine('fatal: not a git repository')).toBe(true)
    expect(isErrorLine("Uncaught Exception: boom")).toBe(true)
    expect(isErrorLine("'vite' is not recognized as an internal or external command")).toBe(true)
    expect(isErrorLine('\x1b[31mError\x1b[39m: listen EADDRINUSE')).toBe(true)
  })
  it('leaves ordinary and all-clear lines alone', () => {
    expect(isErrorLine('  VITE v5.4.0  ready in 300 ms')).toBe(false)
    expect(isErrorLine('Found 0 errors. Watching for file changes.')).toBe(false)
    expect(isErrorLine('added 120 packages, and audited 121 packages in 3s')).toBe(false)
    expect(isErrorLine('src/errorHandler.ts')).toBe(false)
    expect(isErrorLine('')).toBe(false)
  })
  it('still counts a line with an error next to good news', () => {
    expect(isErrorLine('0 errors, 2 failed')).toBe(true)
  })
})

describe('findFiles', () => {
  it('finds paths with line numbers', () => {
    expect(findFiles('src/app.ts:12:5 - error')).toEqual([{ start: 0, end: 15, path: 'src/app.ts', line: 12, column: 5 }])
    const win = findFiles('C:\\code\\eclipse\\main.tsx(12,5): error TS1005')
    expect(win[0]).toMatchObject({ path: 'C:\\code\\eclipse\\main.tsx', line: 12, column: 5 })
    expect(findFiles('at /Users/me/eclipse/vite.config.ts:3')[0]).toMatchObject({ path: '/Users/me/eclipse/vite.config.ts', line: 3 })
    expect(findFiles('see ./index.js')[0]).toMatchObject({ path: './index.js' })
    expect(findFiles('in package.json')[0]).toMatchObject({ path: 'package.json' })
  })
  it('skips web addresses and words that only look like files', () => {
    expect(findFiles('open http://localhost:5173/src/main.ts')).toEqual([])
    expect(findFiles('built with node.js and vue.js')).toEqual([])
  })
})

describe('resolveFrom', () => {
  it('joins relative paths onto the terminal folder', () => {
    expect(resolveFrom('/Users/me/eclipse', 'src/app.ts')).toBe('/Users/me/eclipse/src/app.ts')
    expect(resolveFrom('/Users/me/eclipse', '../other/a.ts')).toBe('/Users/me/other/a.ts')
    expect(resolveFrom('C:\\code\\eclipse', 'src/app.ts')).toBe('C:\\code\\eclipse\\src\\app.ts')
    expect(resolveFrom('C:\\code\\eclipse', '.\\src\\app.ts')).toBe('C:\\code\\eclipse\\src\\app.ts')
  })
  it('keeps full paths', () => {
    expect(resolveFrom('/x', '/Users/me/a.ts')).toBe('/Users/me/a.ts')
    expect(resolveFrom('C:\\x', 'D:\\a.ts')).toBe('D:\\a.ts')
    expect(resolveFrom('/x', '~/a.ts', '/Users/me')).toBe('/Users/me/a.ts')
  })
})

describe('run button commands', () => {
  it('labels and fills blanks', () => {
    expect(commandBlank('git checkout {branch or link}')).toBe('branch or link')
    expect(commandBlank('npm run dev')).toBeNull()
    expect(commandLabel('git checkout {branch or link}')).toBe('git checkout …')
    expect(fillCommand('git checkout {branch or link}', 'claude/project-thread-0g75sa')).toBe('git checkout claude/project-thread-0g75sa')
  })
  it('turns GitHub links into branches', () => {
    expect(fillCommand('git checkout {branch}', 'https://github.com/me/eclipse/tree/claude/fix-login')).toBe('git checkout claude/fix-login')
    expect(fillCommand('git checkout {branch}', 'https://github.com/me/eclipse/compare/main...claude/fix-login')).toBe('git checkout claude/fix-login')
    expect(fillCommand('git checkout {branch}', 'https://github.com/me/eclipse/pull/42')).toBe('git fetch origin pull/42/head:pr-42; git checkout pr-42')
  })
  it('quotes odd values', () => {
    expect(fillCommand('echo {text}', 'hello world')).toBe('echo "hello world"')
  })
  it('knows which commands keep running', () => {
    expect(keepsRunning('npm run dev')).toBe(true)
    expect(keepsRunning('npm start')).toBe(true)
    expect(keepsRunning('npx vite')).toBe(true)
    expect(keepsRunning('npm install')).toBe(false)
    expect(keepsRunning('git pull')).toBe(false)
  })
})

describe('LineTracker', () => {
  it('collects typed commands', () => {
    const t = new LineTracker()
    expect(t.feed('git pul')).toEqual([])
    expect(t.feed('x\x7fl\r')).toEqual(['git pull'])
    expect(t.feed('npm run dev\r')).toEqual(['npm run dev'])
  })
  it('gives up on lines edited with arrow keys or tab', () => {
    const t = new LineTracker()
    expect(t.feed('\x1b[A\r')).toEqual([])
    expect(t.feed('git che\tmain\r')).toEqual([])
    expect(t.feed('ls\r')).toEqual(['ls'])
  })
})

describe('addToHistory', () => {
  it('puts the newest first, once', () => {
    expect(addToHistory(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(addToHistory(['a'], '  ')).toEqual(['a'])
    expect(addToHistory(['a', 'b'], 'c', 2)).toEqual(['c', 'a'])
  })
})

describe('get latest and run', () => {
  it('pulls, installs only when packages changed, then runs', () => {
    const mac = latestAndRunCommand(false)
    expect(mac).toContain('git pull &&')
    expect(mac).toContain('git diff --quiet "$before" HEAD -- package.json package-lock.json')
    expect(mac.endsWith('&& npm run dev')).toBe(true)
    const win = latestAndRunCommand(true, 'npm start')
    expect(win).toContain('Test-Path node_modules')
    expect(win).toContain('{ npm start }')
    expect(win).not.toContain('&&')
  })
  it('picks the command that starts the app', () => {
    expect(runCommandOf(['npm install', 'npm run dev', 'git pull'])).toBe('npm run dev')
    expect(runCommandOf(['npm install', 'npm start'])).toBe('npm start')
    expect(runCommandOf(['git pull'])).toBe('npm run dev')
  })
})
