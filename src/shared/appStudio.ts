import { latestAndRunCommand } from './terminalTools'

/**
 * App Studio: a place in Orbit for the apps you make with Claude Code (Orbit, Eclipse…). Each app
 * is a folder (the same projects as the Terminal tab's run buttons). Its card shows what git knows
 * about it, and the pull request inbox lists the open pull requests on its GitHub repository.
 */

/** What git and package.json say about an app's folder. */
export interface AppInfo {
  ok: boolean
  /** Why it couldn't be read (not a folder, not a git repository…). */
  error?: string
  version?: string
  branch?: string
  /** The last commit: its first line, when, and who made it. */
  lastChange?: { subject: string; date: string; author: string }
  /** Files changed but not committed. */
  changedFiles?: number
  /** "owner/name" when the folder's origin is on GitHub. */
  repo?: string
  /** A GitHub Actions workflow that runs when a version tag is pushed (it builds and publishes the release). */
  releaseWorkflow?: boolean
  /** package.json scripts that build the app (build, build:win, dist…). */
  buildScripts?: string[]
}

export interface PullRequest {
  repo: string
  number: number
  title: string
  /** The description, as written. */
  body: string
  author: string
  branch: string
  base: string
  url: string
  draft: boolean
  createdAt: string
  updatedAt: string
  /** Lines added and removed, and files changed (when GitHub said). */
  additions?: number
  deletions?: number
  changedFiles?: number
}

export interface GitHubStatus {
  connected: boolean
  login?: string
  canEncrypt: boolean
}

/** "owner/name" for a GitHub remote (https or ssh), or null for anywhere else. */
export function githubRepo(remote: string): string | null {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/**
 * A pull request's description cut down to what changed: without hidden notes, "Requested by" and
 * "Generated with" lines or links to the Claude session, and at most `maxLines` lines (each cut
 * to about `maxLength` letters). A "Summary"
 * or "What's new" part is preferred when there is one.
 */
export function prSummary(body: string, maxLines = 5, maxLength = 170): string[] {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '')
  const lines = text.split('\n')
  // Start at a Summary / What's new heading if there is one, and stop at the next heading.
  const start = lines.findIndex((l) => /^#{1,4}\s*(summary|what'?s new|what changed|changes)\b/i.test(l.trim()))
  let picked = start >= 0 ? lines.slice(start + 1) : lines
  if (start >= 0) {
    const end = picked.findIndex((l) => /^#{1,4}\s/.test(l.trim()))
    if (end >= 0) picked = picked.slice(0, end)
  }
  return picked
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^_?requested by\b/i.test(l) &&
        !/generated with \[?claude code/i.test(l) &&
        !/^https?:\/\/claude\.ai\/code\//i.test(l) &&
        !/^#{1,6}\s/.test(l) &&
        !/^[-*_]{3,}$/.test(l)
    )
    .map((l) =>
      l
        .replace(/^[-*+]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, '$1$2')
    )
    .map((l) => (l.length > maxLength ? l.slice(0, maxLength - 1).replace(/\s+\S*$/, '') + '…' : l))
    .slice(0, maxLines)
}

/**
 * The "Try it" button's command line: get the pull request's branch, switch to it, pull its
 * latest, install packages if they changed, then start the app. Each step only runs if the one
 * before worked.
 */
export function tryBranchCommand(windows: boolean, branch: string, run = 'npm run dev'): string {
  const b = /^[\w./@+-]+$/.test(branch) ? branch : `"${branch.replace(/"/g, '')}"`
  const latest = latestAndRunCommand(windows, run)
  if (windows) return `git fetch origin; if ($LASTEXITCODE -eq 0) { git checkout ${b}; if ($LASTEXITCODE -eq 0) { ${latest} } }`
  return `git fetch origin && git checkout ${b} && ${latest}`
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", or the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined })
}

/** Whether a token looks like a GitHub token at all (classic, fine-grained, or an app's). */
export function looksLikeGitHubToken(token: string): boolean {
  return /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})$/.test(token.trim())
}

// ---------- Idea board ----------

export type BoardColumn = 'ideas' | 'building' | 'testing' | 'done'

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: 'ideas', label: 'Ideas & bugs' },
  { id: 'building', label: 'Building' },
  { id: 'testing', label: 'Testing' },
  { id: 'done', label: 'Done' }
]

/** An idea or a bug on an app's board. Kept in the notes folder (.notesapp/app-studio.json), so it's the same on every computer. */
export interface BoardItem {
  id: string
  /** Which app: its GitHub repository ("owner/name") when it has one, else its name. */
  app: string
  kind: 'idea' | 'bug'
  title: string
  details: string
  column: BoardColumn
  /** Screenshots and sketches, as notes-folder paths. */
  pictures: string[]
  created: string
  updated: string
}

export interface BoardData {
  items: BoardItem[]
}

const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((c) => c.id))

/** Reads the saved board, leaving out anything that isn't a proper item. */
export function readBoard(json: string | null): BoardData {
  if (!json) return { items: [] }
  try {
    const raw = JSON.parse(json) as { items?: unknown }
    const items = Array.isArray(raw.items) ? raw.items : []
    return {
      items: items
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .filter((i) => typeof i.id === 'string' && typeof i.app === 'string' && typeof i.title === 'string')
        .map((i) => ({
          id: i.id as string,
          app: i.app as string,
          kind: i.kind === 'bug' ? 'bug' : 'idea',
          title: i.title as string,
          details: typeof i.details === 'string' ? i.details : '',
          column: typeof i.column === 'string' && COLUMN_IDS.has(i.column) ? (i.column as BoardColumn) : 'ideas',
          pictures: Array.isArray(i.pictures) ? i.pictures.filter((p): p is string => typeof p === 'string') : [],
          created: typeof i.created === 'string' ? i.created : new Date(0).toISOString(),
          updated: typeof i.updated === 'string' ? i.updated : typeof i.created === 'string' ? i.created : new Date(0).toISOString()
        }))
    }
  } catch {
    return { items: [] }
  }
}

/** The key an app's board items are saved under: its repository if it's on GitHub, else its name. */
export const boardKey = (app: { name: string; repo?: string }): string => app.repo ?? app.name

/**
 * A request for Claude Code made from one or more board items: what the app is, then each idea
 * or bug with its details, and a note about any pictures (pasted in separately).
 */
export function claudePrompt(app: { name: string; repo?: string }, items: BoardItem[]): string {
  const where = app.repo ? `my app ${app.name} (GitHub: ${app.repo})` : `my app ${app.name}`
  const ideas = items.filter((i) => i.kind === 'idea')
  const bugs = items.filter((i) => i.kind === 'bug')
  const pictures = items.reduce((n, i) => n + i.pictures.length, 0)
  const describe = (i: BoardItem, n: number): string => {
    const lines = [`${items.length > 1 ? `${n}. ` : ''}${i.title.trim()}`]
    const details = i.details.trim()
    if (details) lines.push(...details.split('\n').map((l) => (items.length > 1 ? `   ${l}` : l)))
    if (i.pictures.length) lines.push(`${items.length > 1 ? '   ' : ''}(${i.pictures.length === 1 ? 'A picture is' : `${i.pictures.length} pictures are`} attached for this.)`)
    return lines.join('\n')
  }
  const parts: string[] = []
  let n = 0
  if (bugs.length && ideas.length) parts.push(`I'd like some changes to ${where}.`)
  if (bugs.length) {
    parts.push(
      (ideas.length ? '' : `Please fix ${bugs.length === 1 ? 'this bug' : 'these bugs'} in ${where}.\n\n`) +
        (ideas.length ? `Bugs to fix:\n\n` : '') +
        bugs.map((b) => describe(b, ++n)).join('\n\n')
    )
  }
  if (ideas.length) {
    parts.push(
      (bugs.length ? `New features to add:\n\n` : `Please add ${ideas.length === 1 ? 'this' : 'these'} to ${where}.\n\n`) + ideas.map((i) => describe(i, ++n)).join('\n\n')
    )
  }
  if (pictures) parts.push(pictures === 1 ? 'I’ve attached a picture to show what I mean.' : `I’ve attached ${pictures} pictures to show what I mean.`)
  parts.push('When it’s done, open a pull request.')
  return parts.join('\n\n')
}

// ---------- Releases ----------

export interface Release {
  tag: string
  name: string
  /** When it was published (or made, for a draft). */
  date: string
  draft: boolean
  prerelease: boolean
  url: string
  /** Its notes, as written. */
  body: string
}

/** A pull request that was merged. */
export interface MergedPull {
  number: number
  title: string
  body: string
  author: string
  url: string
  mergedAt: string
}

export type VersionBump = 'patch' | 'minor' | 'major'

export const VERSION_BUMPS: { id: VersionBump; label: string; hint: string }[] = [
  { id: 'patch', label: 'Fixes', hint: 'Small fixes' },
  { id: 'minor', label: 'New features', hint: 'New things added' },
  { id: 'major', label: 'Big update', hint: 'A big change' }
]

/** The next version: 1.4.2 → 1.4.3 (patch), 1.5.0 (minor) or 2.0.0 (major). Null if it isn't a plain version. */
export function bumpVersion(version: string, bump: VersionBump): string | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec((version ?? '').trim())
  if (!m) return null
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * The release button's command line: npm bumps the version in package.json, commits it and tags it
 * (v1.2.3), then the commit and tag are pushed. A release workflow on GitHub picks the tag up.
 */
export function releaseCommand(windows: boolean, bump: VersionBump): string {
  const version = `npm version ${bump} -m "Release %s"`
  const push = 'git push --follow-tags'
  return windows ? `${version}; if ($LASTEXITCODE -eq 0) { ${push} }` : `${version} && ${push}`
}

/** A pull request title as a line for people using the app: no "feat:"/"fix(x):" prefix, starting with a capital. */
export function plainTitle(title: string): string {
  const t = title
    .trim()
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/^(feat|feature|fix|bugfix|chore|docs|refactor|perf|style|test|build|ci)(\([^)]*\))?!?:\s*/i, '')
    .replace(/\s*\(#\d+\)$/, '')
    .replace(/\.$/, '')
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

const FIX_WORDS = /^(fix(es|ed)?|stop|don.?t|no longer|correct|repair|handle|avoid|prevent)\b/i
const SKIP_WORDS = /^(chore|ci|test|tests|build|refactor|docs?)\b|\b(bump (deps|dependencies)|update dependencies|merge branch)\b/i

/** A plain "What's new" list made from the pull requests' titles: new things first, then fixes. Internal-only changes are left out. */
export function plainChangelog(pulls: { title: string }[]): string {
  const added: string[] = []
  const fixed: string[] = []
  for (const p of pulls) {
    if (SKIP_WORDS.test(p.title.trim())) continue
    const line = plainTitle(p.title)
    if (!line) continue
    ;(/^(fix|bugfix)\b/i.test(p.title.trim()) || FIX_WORDS.test(line) ? fixed : added).push(line)
  }
  const parts: string[] = []
  if (added.length) parts.push("What's new", ...added.map((l) => `- ${l}`))
  if (fixed.length) parts.push(...(added.length ? [''] : []), 'Fixes', ...fixed.map((l) => `- ${l}`))
  return parts.join('\n')
}

/** What the AI helper is given to write the notes from: each pull request's title and a short summary. */
export function changelogSource(app: string, pulls: MergedPull[]): string {
  const lines = [`App: ${app}`, '', 'Pull requests merged since the last release:']
  for (const p of pulls) {
    lines.push('', `- ${p.title}`)
    for (const l of prSummary(p.body, 6, 240)) lines.push(`  ${l}`)
  }
  return lines.join('\n')
}

/**
 * Which release the notes go on: a draft waiting to be published, else the version in package.json
 * if it hasn't been released yet (just bumped), else the next version up.
 */
export function notesTarget(version: string | undefined, releases: Release[]): string | null {
  const draft = releases.find((r) => r.draft)
  if (draft) return draft.tag
  if (!version) return null
  const now = `v${version}`
  if (!releases.some((r) => r.tag === now)) return now
  return `v${bumpVersion(version, 'minor') ?? version}`
}
