import { describe, expect, it } from 'vitest'
import { boardKey, claudePrompt, githubRepo, looksLikeGitHubToken, prSummary, readBoard, timeAgo, tryBranchCommand, type BoardItem } from './appStudio'

describe('githubRepo', () => {
  it('reads https and ssh remotes', () => {
    expect(githubRepo('https://github.com/Looby758/notes-app.git')).toBe('Looby758/notes-app')
    expect(githubRepo('https://github.com/Looby758/notes-app')).toBe('Looby758/notes-app')
    expect(githubRepo('git@github.com:me/eclipse.git')).toBe('me/eclipse')
    expect(githubRepo('http://127.0.0.1:1234/git/me/eclipse')).toBeNull()
    expect(githubRepo('')).toBeNull()
  })
})

describe('prSummary', () => {
  const body = `<!-- claude-projects-attribution: {"github_login":"me"} -->
_Requested by **Me** · [project thread](https://claude.ai/x)_

Makes the Terminal tab better.

## What's new
- **Several terminals**: a strip along the top.
- **Close app**: same as \`Ctrl+C\`.

## Testing
- tests pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_1`
  it('picks the What’s new part, tidied', () => {
    expect(prSummary(body)).toEqual(['• Several terminals: a strip along the top.', '• Close app: same as Ctrl+C.'])
  })
  it('uses the whole description when there are no headings, without Claude’s footer lines', () => {
    const plain = 'Fixes the login button.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_1'
    expect(prSummary(plain)).toEqual(['Fixes the login button.'])
    expect(prSummary('')).toEqual([])
  })
  it('cuts long lines and takes away *emphasis*', () => {
    const [line] = prSummary('Saved as its own *down* and *up* moment, ' + 'word '.repeat(60))
    expect(line.startsWith('Saved as its own down and up moment,')).toBe(true)
    expect(line.length).toBeLessThanOrEqual(170)
    expect(line.endsWith('…')).toBe(true)
  })
  it('keeps to the most lines asked for', () => {
    expect(prSummary('a\nb\nc\nd', 2)).toEqual(['a', 'b'])
  })
})

describe('tryBranchCommand', () => {
  it('fetches, switches branch, then gets latest and runs', () => {
    const mac = tryBranchCommand(false, 'claude/fix-login')
    expect(mac.startsWith('git fetch origin && git checkout claude/fix-login && before=')).toBe(true)
    expect(mac.endsWith('npm run dev')).toBe(true)
    const win = tryBranchCommand(true, 'claude/fix-login', 'npm start')
    expect(win).toContain('git checkout claude/fix-login;')
    expect(win).not.toContain('&&')
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-11-21T20:00:00Z')
  it('says how long ago', () => {
    expect(timeAgo('2026-11-21T19:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-11-21T19:55:00Z', now)).toBe('5 minutes ago')
    expect(timeAgo('2026-11-21T17:00:00Z', now)).toBe('3 hours ago')
    expect(timeAgo('2026-11-19T20:00:00Z', now)).toBe('2 days ago')
    expect(timeAgo('nonsense', now)).toBe('')
  })
})

describe('looksLikeGitHubToken', () => {
  it('knows token shapes', () => {
    expect(looksLikeGitHubToken('ghp_' + 'a'.repeat(36))).toBe(true)
    expect(looksLikeGitHubToken('github_pat_' + 'A1_'.repeat(20))).toBe(true)
    expect(looksLikeGitHubToken('hello')).toBe(false)
  })
})

describe('idea board', () => {
  const item = (over: Partial<BoardItem>): BoardItem => ({
    id: 'a',
    app: 'me/eclipse',
    kind: 'idea',
    title: 'Dark mode',
    details: '',
    column: 'ideas',
    pictures: [],
    created: '2026-11-21T20:00:00Z',
    updated: '2026-11-21T20:00:00Z',
    ...over
  })
  it('reads saved boards and skips broken items', () => {
    const json = JSON.stringify({ items: [item({}), { id: 'x' }, item({ id: 'b', column: 'nonsense' as never, kind: 'bug' })] })
    const board = readBoard(json)
    expect(board.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(board.items[1].column).toBe('ideas')
    expect(board.items[1].kind).toBe('bug')
    expect(readBoard('not json').items).toEqual([])
    expect(readBoard(null).items).toEqual([])
  })
  it('keys apps by repository, else name', () => {
    expect(boardKey({ name: 'Eclipse', repo: 'me/eclipse' })).toBe('me/eclipse')
    expect(boardKey({ name: 'Eclipse' })).toBe('Eclipse')
  })
  it('writes a prompt for one idea', () => {
    const p = claudePrompt({ name: 'Eclipse', repo: 'me/eclipse' }, [item({ details: 'A toggle in settings.' })])
    expect(p).toBe('Please add this to my app Eclipse (GitHub: me/eclipse).\n\nDark mode\nA toggle in settings.\n\nWhen it’s done, open a pull request.')
  })
  it('writes a prompt for bugs and ideas together, mentioning pictures', () => {
    const p = claudePrompt({ name: 'Eclipse' }, [item({ kind: 'bug', title: 'Login button does nothing', pictures: ['a.png'] }), item({ id: 'b', title: 'Dark mode' })])
    expect(p).toContain("I'd like some changes to my app Eclipse.")
    expect(p).toContain('Bugs to fix:\n\n1. Login button does nothing\n   (A picture is attached for this.)')
    expect(p).toContain('New features to add:\n\n2. Dark mode')
    expect(p).toContain('I’ve attached a picture to show what I mean.')
  })
})
