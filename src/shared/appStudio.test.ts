import { describe, expect, it } from 'vitest'
import { bugReportUrl, newReports, reportButtonCard, reportCard, type BugReport, rollbackCommand, rollbackVersion, parseOutdated, parseAudit, severityCounts, healthLevel, healthLine, healthBoardItem, type HealthReport, addDownloadDay, countText, downloadsByPlatform, downloadsSince, isDownloadFile, platformOf, type DownloadHistory, boardKey, commitAllCommand, describeChange, stashCommand, isTokenPermissionError, newTokenUrl, readyForReviewError, mergeAfterReadyError, TOKEN_NOT_ALLOWED, bumpVersion, changelogSource, claudePrompt, copyFolderName, copyRunCommand, githubRepo, imageUrls, isGitHubImage, keywords, looksLikeGitHubToken, matchPull, notesTarget, plainChangelog, prSummary, pullKey, readBoard, releaseCommand, shotsByFeature, switchBranchCommand, timeAgo, tryBranchCommand, type BoardItem, type Release, type Shot } from './appStudio'

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

describe('releases', () => {
  it('bumps versions', () => {
    expect(bumpVersion('1.11.1', 'patch')).toBe('1.11.2')
    expect(bumpVersion('1.11.1', 'minor')).toBe('1.12.0')
    expect(bumpVersion('v1.11.1', 'major')).toBe('2.0.0')
    expect(bumpVersion('1.2.3-beta.1', 'patch')).toBe('1.2.4')
    expect(bumpVersion('nope', 'patch')).toBeNull()
  })

  it('makes the release command for each shell', () => {
    expect(releaseCommand(false, 'minor')).toBe('npm version minor -m "Release %s" && git push --follow-tags')
    expect(releaseCommand(true, 'patch')).toBe('npm version patch -m "Release %s"; if ($LASTEXITCODE -eq 0) { git push --follow-tags }')
    expect(releaseCommand(false, 'patch', true)).toBe('npm test && npm version patch -m "Release %s" && git push --follow-tags')
    expect(releaseCommand(true, 'patch', true)).toBe('npm test; if ($LASTEXITCODE -eq 0) { npm version patch -m "Release %s"; if ($LASTEXITCODE -eq 0) { git push --follow-tags } }')
  })

  it('writes plain notes from pull request titles', () => {
    const notes = plainChangelog([
      { title: 'feat: add a dark mode' },
      { title: 'Fix the export button on Safari (#12)' },
      { title: 'chore: bump dependencies' },
      { title: 'App Studio: release builder.' },
      { title: 'fix(sync): lost edits' }
    ])
    expect(notes).toBe("What's new\n- Add a dark mode\n- App Studio: release builder\n\nFixes\n- Fix the export button on Safari\n- Lost edits")
    expect(plainChangelog([{ title: 'Fix crash' }])).toBe('Fixes\n- Fix crash')
    expect(plainChangelog([])).toBe('')
  })

  it('gives the AI helper titles and short summaries', () => {
    const src = changelogSource('Orbit', [{ number: 3, title: 'Add a thing', body: '## Summary\n- It does X\n\n## Testing\n- ran it', author: 'a', url: '', mergedAt: '' }])
    expect(src).toContain('App: Orbit')
    expect(src).toContain('- Add a thing\n  • It does X')
    expect(src).not.toContain('ran it')
  })

  it('picks the release the notes go on', () => {
    const r = (tag: string, draft = false): Release => ({ tag, name: tag, date: '', draft, prerelease: false, url: '', body: '' })
    expect(notesTarget('1.2.0', [r('v1.3.0', true), r('v1.2.0')])).toBe('v1.3.0')
    expect(notesTarget('1.3.0', [r('v1.2.0')])).toBe('v1.3.0')
    expect(notesTarget('1.2.0', [r('v1.2.0')])).toBe('v1.3.0')
    expect(notesTarget(undefined, [])).toBeNull()
  })
})

describe('switchBranchCommand', () => {
  it('switches and pulls', () => {
    expect(switchBranchCommand(false, 'main')).toBe('git checkout main && git pull')
    expect(switchBranchCommand(true, 'main')).toBe('git checkout main; if ($LASTEXITCODE -eq 0) { git pull }')
  })
})

describe('test copies', () => {
  it('names a copy after its branch', () => {
    expect(copyFolderName('claude/dark-mode-x1')).toBe('claude-dark-mode-x1')
    expect(copyFolderName('feature/über cool')).toBe('feature-ber-cool')
    expect(copyFolderName('---')).toBe('copy')
  })
  it('runs a copy with the branch’s latest', () => {
    expect(copyRunCommand(false, 'claude/x', 'npm run dev')).toBe(
      'before=$(git rev-parse HEAD) && git fetch origin claude/x && git checkout --detach FETCH_HEAD && { if [ ! -d node_modules ] || ! git diff --quiet "$before" HEAD -- package.json package-lock.json yarn.lock pnpm-lock.yaml; then npm install; fi; } && npm run dev'
    )
    expect(copyRunCommand(true, 'claude/x')).toContain('git fetch origin claude/x; if ($LASTEXITCODE -eq 0) { git checkout --detach FETCH_HEAD;')
  })
})

describe('matching pull requests to cards', () => {
  const item = (over: Partial<BoardItem>): BoardItem => ({
    id: 'a',
    app: 'me/app',
    kind: 'idea',
    title: 'Dark mode for the player',
    details: '',
    column: 'building',
    pictures: [],
    created: '2026-11-01T00:00:00Z',
    updated: '2026-11-01T00:00:00Z',
    sentAt: '2026-11-20T10:00:00Z',
    ...over
  })
  const pull = { title: 'Add dark mode to the music player', body: 'Adds a toggle.', createdAt: '2026-11-20T11:00:00Z' }

  it('finds the card a pull request is for', () => {
    const items = [item({}), item({ id: 'b', title: 'Keyboard shortcuts list' })]
    expect(matchPull(items, pull)?.id).toBe('a')
  })
  it('leaves out cards not sent, already matched, done, or sent after it opened', () => {
    expect(matchPull([item({ sentAt: undefined })], pull)).toBeNull()
    expect(matchPull([item({ pull: 'me/app#3' })], pull)).toBeNull()
    expect(matchPull([item({ column: 'done' })], pull)).toBeNull()
    expect(matchPull([item({ sentAt: '2026-11-21T00:00:00Z' })], pull)).toBeNull()
  })
  it('needs enough words in common', () => {
    expect(matchPull([item({ title: 'Better player' })], pull)).toBeNull()
    expect(matchPull([item({ title: 'Faster sync for notes' })], pull)).toBeNull()
  })
  it('makes keys', () => {
    expect(pullKey('me/app', 12)).toBe('me/app#12')
    expect([...keywords('The Save buttons are broken!')]).toEqual(['save', 'button', 'broken'])
  })
})

describe('screenshots', () => {
  it('finds GitHub images in a description', () => {
    const body = '![shot](https://github.com/user-attachments/assets/abc-123)\n<img width="400" src="https://user-images.githubusercontent.com/1/2.png">\n![x](https://evil.example/a.png) ![y](https://github.com/me/app/assets/1/def)'
    expect(imageUrls(body)).toEqual(['https://github.com/user-attachments/assets/abc-123', 'https://github.com/me/app/assets/1/def', 'https://user-images.githubusercontent.com/1/2.png'])
    expect(isGitHubImage('http://github.com/user-attachments/assets/a')).toBe(false)
    expect(isGitHubImage('https://github.com/login')).toBe(false)
  })
  it('groups by feature, newest first', () => {
    const shot = (id: string, feature: string, date: string): Shot => ({ id, app: 'a', feature, picture: `${id}.png`, date })
    const groups = shotsByFeature([shot('1', 'Board', '2026-11-01'), shot('2', 'Releases', '2026-11-05'), shot('3', 'Board', '2026-11-03')])
    expect(groups.map((g) => g.feature)).toEqual(['Releases', 'Board'])
    expect(groups[1].shots.map((s) => s.id)).toEqual(['3', '1'])
  })
  it('reads links, screenshots and matches from the saved board', () => {
    const data = readBoard(
      JSON.stringify({
        items: [{ id: 'a', app: 'x', title: 't', sentAt: '2026-11-20T10:00:00Z', pull: 'me/x#2' }],
        claude: { x: 'https://claude.ai/project/1', bad: 3 },
        shots: [{ id: 's', app: 'x', picture: 'a.png' }, { id: 'nope' }]
      })
    )
    expect(data.items[0]).toMatchObject({ sentAt: '2026-11-20T10:00:00Z', pull: 'me/x#2' })
    expect(data.claude).toEqual({ x: 'https://claude.ai/project/1' })
    expect(data.shots).toEqual([{ id: 's', app: 'x', feature: 'Other', picture: 'a.png', date: new Date(0).toISOString(), note: undefined, source: undefined }])
    expect(readBoard(null)).toEqual({ items: [], claude: {}, shots: [] })
  })
})

describe('token permissions', () => {
  it('links to a token with the right permissions', () => {
    const url = new URL(newTokenUrl('Looby758'))
    expect(url.pathname).toBe('/settings/personal-access-tokens/new')
    expect(url.searchParams.get('pull_requests')).toBe('write')
    expect(url.searchParams.get('contents')).toBe('write')
    expect(url.searchParams.get('actions')).toBe('write')
    expect(url.searchParams.get('target_name')).toBe('Looby758')
    expect(isTokenPermissionError(`${TOKEN_NOT_ALLOWED} merge pull requests on a/b.`)).toBe(true)
    expect(isTokenPermissionError('GitHub said no (403).')).toBe(false)
  })
})

describe('uncommitted changes', () => {
  it('describes git status lines', () => {
    expect(describeChange(' M package-lock.json')).toBe('package-lock.json (changed)')
    expect(describeChange('?? notes.txt')).toBe('notes.txt (new)')
    expect(describeChange(' D old.ts')).toBe('old.ts (deleted)')
    expect(describeChange('R  a.ts -> b.ts')).toBe('b.ts (renamed)')
    expect(describeChange('?? "with space.txt"')).toBe('with space.txt (new)')
  })
  it('commits and stashes', () => {
    expect(commitAllCommand(false, 'Small "fixes"')).toBe('git add -A && git commit -m "Small fixes"')
    expect(commitAllCommand(true, 'x')).toBe('git add -A; if ($LASTEXITCODE -eq 0) { git commit -m "x" }')
    expect(stashCommand()).toContain('git stash push --include-untracked')
  })
})

describe('downloads', () => {
  it('counts installers, not the updater’s own files', () => {
    expect(isDownloadFile('Orbit-Setup-1.13.0.exe')).toBe(true)
    expect(isDownloadFile('Orbit-1.13.0-arm64.dmg')).toBe(true)
    expect(isDownloadFile('Orbit-1.13.0-mac.zip')).toBe(true)
    expect(isDownloadFile('latest.yml')).toBe(false)
    expect(isDownloadFile('latest-mac.yml')).toBe(false)
    expect(isDownloadFile('Orbit-Setup-1.13.0.exe.blockmap')).toBe(false)
    expect(isDownloadFile('checksums.sha256')).toBe(false)
  })
  it('tells which computer a file is for', () => {
    expect(platformOf('Orbit-Setup-1.13.0.exe')).toBe('Windows')
    expect(platformOf('Orbit-1.13.0-arm64.dmg')).toBe('Mac')
    expect(platformOf('Orbit-1.13.0-mac.zip')).toBe('Mac')
    expect(platformOf('orbit_1.13.0_amd64.deb')).toBe('Linux')
    expect(platformOf('source.zip')).toBe('Other')
    const files = [
      { name: 'a.exe', downloads: 3 },
      { name: 'a.dmg', downloads: 5 },
      { name: 'b.msi', downloads: 4 }
    ]
    expect(downloadsByPlatform(files)).toEqual([
      { platform: 'Windows', downloads: 7 },
      { platform: 'Mac', downloads: 5 }
    ])
  })
  it('writes counts short', () => {
    expect(countText(0)).toBe('0')
    expect(countText(1234)).toBe('1,234')
    expect(countText(15_300)).toBe('15.3k')
    expect(countText(250_000)).toBe('250k')
    expect(countText(2_000_000)).toBe('2m')
  })
  it('keeps one total a day and works out the last week', () => {
    let h: DownloadHistory = []
    h = addDownloadDay(h, '2026-11-01', 100)
    h = addDownloadDay(h, '2026-11-10', 150)
    h = addDownloadDay(h, '2026-11-15', 170)
    h = addDownloadDay(h, '2026-11-15', 180)
    expect(h).toHaveLength(3)
    expect(downloadsSince(h, 7, '2026-11-15')).toBe(80)
    expect(downloadsSince(h, 30, '2026-11-15')).toBeNull()
    expect(downloadsSince([], 7, '2026-11-15')).toBeNull()
  })
})

describe('health check', () => {
  it('reads npm outdated', () => {
    const json = JSON.stringify({
      react: { current: '18.2.0', wanted: '18.3.1', latest: '19.1.0', type: 'devDependencies' },
      zustand: { current: '5.0.1', wanted: '5.0.8', latest: '5.0.8', type: 'devDependencies' },
      chokidar: [{ current: '4.0.1', wanted: '4.0.3', latest: '4.0.3', type: 'dependencies' }],
      broken: { current: '1.0.0' }
    })
    const list = parseOutdated(json)
    expect(list.map((p) => p.name)).toEqual(['chokidar', 'zustand', 'react'])
    expect(list.find((p) => p.name === 'react')).toMatchObject({ major: true, dev: true })
    expect(list.find((p) => p.name === 'chokidar')).toMatchObject({ major: false, dev: false })
    expect(parseOutdated('')).toEqual([])
    expect(parseOutdated('not json')).toEqual([])
  })
  it('reads npm audit', () => {
    const json = JSON.stringify({
      vulnerabilities: {
        'brace-expansion': { name: 'brace-expansion', severity: 'low', via: [{ title: 'ReDoS', url: 'https://github.com/advisories/1' }], fixAvailable: true },
        vite: { name: 'vite', severity: 'high', via: [{ title: 'File read', url: 'https://github.com/advisories/2' }], fixAvailable: { name: 'vite', version: '7.0.0', isSemVerMajor: true } },
        'electron-vite': { name: 'electron-vite', severity: 'high', via: ['vite'], fixAvailable: false }
      }
    })
    const list = parseAudit(json)
    expect(list.map((w) => w.name)).toEqual(['electron-vite', 'vite', 'brace-expansion'])
    expect(list[0].title).toBe('Uses vite, which has a problem')
    expect(list[1]).toMatchObject({ easyFix: false, majorFix: true })
    expect(list[2]).toMatchObject({ easyFix: true, majorFix: false })
    expect(severityCounts(list)).toEqual([
      { severity: 'high', count: 2 },
      { severity: 'low', count: 1 }
    ])
  })
  it('sums it up', () => {
    const report: HealthReport = { checkedAt: '', outdated: [], security: [], problems: [] }
    expect(healthLevel(report)).toBe('good')
    expect(healthLine(report)).toBe('All up to date and safe')
    report.outdated = [{ name: 'a', current: '1.0.0', wanted: '1.1.0', latest: '2.0.0', major: true, dev: false }]
    expect(healthLevel(report)).toBe('fine')
    report.security = [{ name: 'b', severity: 'high', title: 'Bad', easyFix: true, majorFix: false }]
    expect(healthLevel(report)).toBe('attention')
    expect(healthLine(report)).toBe('1 security warning (1 high) · 1 update')
    const card = healthBoardItem(report)
    expect(card.title).toBe('Fix the security warnings and update packages')
    expect(card.details).toContain('- b (high): Bad')
    expect(card.details).toContain('- a 1.0.0 → 2.0.0')
  })
})

describe('roll back', () => {
  it('picks one fix up from the newest version', () => {
    expect(rollbackVersion('1.13.0', [{ tag: 'v1.13.0' }, { tag: 'v1.12.1' }])).toBe('1.13.1')
    expect(rollbackVersion('1.13.0', [{ tag: 'v1.13.2' }, { tag: 'v1.12.1' }])).toBe('1.13.3')
    expect(rollbackVersion('1.9.0', [{ tag: 'v1.10.0' }])).toBe('1.10.1')
    expect(rollbackVersion(undefined, [])).toBeNull()
  })
  it('puts the old code back and releases it as a new version', () => {
    const mac = rollbackCommand(false, 'v1.12.1', '1.13.1')
    expect(mac).toContain('git restore --source=v1.12.1 --staged --worktree -- .')
    expect(mac).toContain('npm version 1.13.1 --no-git-tag-version')
    expect(mac).toContain('git tag -a v1.13.1')
    expect(mac.endsWith('git push --follow-tags')).toBe(true)
    expect(rollbackCommand(true, 'v1.12.1', '1.13.1')).toMatch(/^git fetch --tags origin; if \(\$LASTEXITCODE -eq 0\) \{ git restore/)
    expect(() => rollbackCommand(false, 'v1; rm -rf /', '1.13.1')).toThrow()
  })
})

describe('bug reports', () => {
  const report = (n: number, extra: Partial<BugReport> = {}): BugReport => ({
    repo: 'me/eclipse',
    number: n,
    title: `Report ${n}`,
    body: '',
    author: 'sam',
    url: `https://github.com/me/eclipse/issues/${n}`,
    createdAt: `2026-11-0${n}T10:00:00Z`,
    labels: [],
    comments: 0,
    ...extra
  })
  it('lists the ones not on the board yet, newest first', () => {
    const list = newReports([report(1), report(2), report(3)], [{ issue: 'me/eclipse#2' }, {}], ['me/eclipse#1'])
    expect(list.map((r) => r.number)).toEqual([3])
    expect(newReports([report(1), report(3)], []).map((r) => r.number)).toEqual([3, 1])
  })
  it('turns a report into a card', () => {
    const card = reportCard(report(4, { title: ' Crashes on start ', body: '<!-- template -->\nIt crashes.\n\n![shot](https://x/y.png)\n\n\n\nEclipse 1.2', labels: ['bug'] }))
    expect(card).toEqual({ title: 'Crashes on start', kind: 'bug', details: 'It crashes.\n\nEclipse 1.2\n\nReported by sam on GitHub: https://github.com/me/eclipse/issues/4' })
    expect(reportCard(report(5, { labels: ['enhancement'] })).kind).toBe('idea')
  })
  it('makes a ready-filled report link', () => {
    const url = new URL(bugReportUrl('me/eclipse', { app: 'Eclipse', version: '1.2.3', os: 'Windows 11' }))
    expect(url.origin + url.pathname).toBe('https://github.com/me/eclipse/issues/new')
    expect(url.searchParams.get('labels')).toBe('bug')
    expect(url.searchParams.get('body')).toContain('Eclipse 1.2.3 on Windows 11')
    expect(reportButtonCard({ name: 'Eclipse', repo: 'me/eclipse' }).details).toContain('https://github.com/me/eclipse/issues/new?')
  })
})

describe('draft pull requests', () => {
  it('turns a missing permission into the token message', () => {
    const m = readyForReviewError([{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }], 'me/app')
    expect(isTokenPermissionError(m)).toBe(true)
    expect(m).toContain('me/app')
  })
  it('says nothing was merged when it stays a draft', () => {
    expect(readyForReviewError([{ message: 'Could not resolve to a node' }], 'me/app')).toBe('GitHub wouldn’t take it out of draft: Could not resolve to a node. Nothing was merged.')
    expect(readyForReviewError([], 'me/app')).toContain('Nothing was merged')
  })
  it('says it was marked ready when the merge then fails', () => {
    expect(mergeAfterReadyError('Merge conflict')).toBe('It’s now marked ready for review, but GitHub couldn’t merge it: Merge conflict. You can try Merge again.')
    expect(mergeAfterReadyError(`${TOKEN_NOT_ALLOWED} merge pull requests`)).toBe(`${TOKEN_NOT_ALLOWED} merge pull requests`)
  })
})
