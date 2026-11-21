import { describe, expect, it } from 'vitest'
import { githubRepo, looksLikeGitHubToken, prSummary, timeAgo, tryBranchCommand } from './appStudio'

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
