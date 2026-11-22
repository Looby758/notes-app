import { latestAndRunCommand, PACKAGE_FILES } from './terminalTools'

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
  /** The first few of them, as git lists them (" M package-lock.json", "?? notes.txt"). */
  changes?: string[]
  /** "owner/name" when the folder's origin is on GitHub. */
  repo?: string
  /** The repository's main branch (origin's default), e.g. "main". */
  mainBranch?: string
  /** A GitHub Actions workflow that runs when a version tag is pushed (it builds and publishes the release). */
  releaseWorkflow?: boolean
  /** package.json scripts that build the app (build, build:win, dist…). */
  buildScripts?: string[]
  /** Whether package.json has a real test script (run before a release). */
  hasTests?: boolean
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
  /** When it was last sent to Claude. */
  sentAt?: string
  /** The pull request Claude opened for it ("owner/name#12"), once matched. */
  pull?: string
}

/** A screenshot of one of an app's features, for its gallery. */
export interface Shot {
  id: string
  /** The app's board key. */
  app: string
  /** The feature it shows (a pull request's title, say). */
  feature: string
  /** Notes-folder path of the picture. */
  picture: string
  /** When it was taken or merged. */
  date: string
  note?: string
  /** Where it was imported from (an image in a pull request), so it isn't imported twice. */
  source?: string
}

export interface BoardData {
  items: BoardItem[]
  /** Each app's Claude project link, by board key. */
  claude: Record<string, string>
  shots: Shot[]
}

const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((c) => c.id))

/** Reads the saved board, leaving out anything that isn't a proper item. */
export function readBoard(json: string | null): BoardData {
  if (!json) return { items: [], claude: {}, shots: [] }
  try {
    const raw = JSON.parse(json) as { items?: unknown; claude?: unknown; shots?: unknown }
    const items = Array.isArray(raw.items) ? raw.items : []
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    const claude = Object.fromEntries(
      Object.entries(raw.claude && typeof raw.claude === 'object' ? (raw.claude as Record<string, unknown>) : {}).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
    const shots = (Array.isArray(raw.shots) ? raw.shots : [])
      .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
      .filter((i) => typeof i.id === 'string' && typeof i.app === 'string' && typeof i.picture === 'string')
      .map((i) => ({
        id: i.id as string,
        app: i.app as string,
        feature: str(i.feature) ?? 'Other',
        picture: i.picture as string,
        date: str(i.date) ?? new Date(0).toISOString(),
        note: str(i.note),
        source: str(i.source)
      }))
    return {
      claude,
      shots,
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
          updated: typeof i.updated === 'string' ? i.updated : typeof i.created === 'string' ? i.created : new Date(0).toISOString(),
          sentAt: str(i.sentAt),
          pull: str(i.pull)
        }))
    }
  } catch {
    return { items: [], claude: {}, shots: [] }
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
  /** How many times its installers were downloaded (the updater's own files left out). */
  downloads?: number
  /** Each installer file and its downloads. */
  files?: ReleaseFile[]
}

export interface ReleaseFile {
  name: string
  downloads: number
}

/** Files on a release that people don't download themselves: the updater's own files, checksums, signatures. */
const NOT_A_DOWNLOAD = /(\.(ya?ml|blockmap|json|txt|sha(1|256|512)|sig|asc|md5)|^(latest|RELEASES)[\w.-]*)$/i

/** Whether a release file is an installer (or a zip of the app) that counts as a download. */
export const isDownloadFile = (name: string): boolean => !NOT_A_DOWNLOAD.test(name)

export type Platform = 'Windows' | 'Mac' | 'Linux' | 'Other'

/** Which computer a release file is for, from its name. */
export function platformOf(name: string): Platform {
  const n = name.toLowerCase()
  if (/\.(exe|msi|appx|msix)$/.test(n) || /\b(win|windows|win32|win64)\b/.test(n)) return 'Windows'
  if (/\.(dmg|pkg)$/.test(n) || /\b(mac|macos|darwin|osx)\b/.test(n)) return 'Mac'
  if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(n) || /\blinux\b/.test(n)) return 'Linux'
  return 'Other'
}

/** A release's downloads by computer, biggest first. */
export function downloadsByPlatform(files: ReleaseFile[]): { platform: Platform; downloads: number }[] {
  const out = new Map<Platform, number>()
  for (const f of files) out.set(platformOf(f.name), (out.get(platformOf(f.name)) ?? 0) + f.downloads)
  return [...out].map(([platform, downloads]) => ({ platform, downloads })).sort((a, b) => b.downloads - a.downloads)
}

/** 1234 → "1,234", 15300 → "15.3k". */
export function countText(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-GB')
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** An app's total downloads, noted once a day on this computer, so the week and month can be worked out. */
export type DownloadHistory = { day: string; total: number }[]

/** Adds today's total (replacing today's earlier one), keeping the last year. */
export function addDownloadDay(history: DownloadHistory, day: string, total: number): DownloadHistory {
  const rest = history.filter((h) => h.day !== day)
  return [...rest, { day, total }].sort((a, b) => a.day.localeCompare(b.day)).slice(-366)
}

/** Downloads in the last `days` days, from the history; null when it doesn't go back that far yet. */
export function downloadsSince(history: DownloadHistory, days: number, today: string): number | null {
  if (!history.length) return null
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10)
  const before = [...history].reverse().find((h) => h.day <= cutoff)
  if (!before) return null
  return Math.max(0, history[history.length - 1].total - before.total)
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
 * The release button's command line: the app's tests first (when it has them, so a release that
 * would fail on GitHub stops here instead), then npm bumps the version in package.json, commits it
 * and tags it (v1.2.3), and the commit and tag are pushed. A release workflow on GitHub picks the
 * tag up.
 */
export function releaseCommand(windows: boolean, bump: VersionBump, test = false): string {
  const steps = [...(test ? ['npm test'] : []), `npm version ${bump} -m "Release %s"`, 'git push --follow-tags']
  if (!windows) return steps.join(' && ')
  // PowerShell: each step only if the one before worked.
  return steps.reduceRight((rest, step) => `${step}; if ($LASTEXITCODE -eq 0) { ${rest} }`)
}

/** Switches to a branch and gets its latest, in the app's terminal. */
export function switchBranchCommand(windows: boolean, branch: string): string {
  const b = /^[\w./@+-]+$/.test(branch) ? branch : `"${branch.replace(/"/g, '')}"`
  return windows ? `git checkout ${b}; if ($LASTEXITCODE -eq 0) { git pull }` : `git checkout ${b} && git pull`
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

// ---------- Test copies ----------

/** A separate copy of an app (a git worktree) with a pull request's version in it, so the app's own folder isn't touched. */
export interface TestCopy {
  path: string
  /** The commit it's on. */
  head: string
}

/** The folder name for a branch's test copy: "claude/dark-mode-x1" → "claude-dark-mode-x1". */
export function copyFolderName(branch: string): string {
  return branch.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(-60) || 'copy'
}

const quoteBranch = (branch: string): string => (/^[\w./@+-]+$/.test(branch) ? branch : `"${branch.replace(/"/g, '')}"`)

/**
 * Runs a test copy: gets the branch's latest, installs packages if they changed (or never were),
 * then starts the app. Each step only runs if the one before worked.
 */
export function copyRunCommand(windows: boolean, branch: string, run = 'npm run dev'): string {
  const b = quoteBranch(branch)
  const files = PACKAGE_FILES.join(' ')
  if (windows) {
    return (
      `$before = git rev-parse HEAD; git fetch origin ${b}; if ($LASTEXITCODE -eq 0) { git checkout --detach FETCH_HEAD; if ($LASTEXITCODE -eq 0) { ` +
      `if (-not (Test-Path node_modules) -or (git diff --name-only $before HEAD -- ${files})) { npm install }; ` +
      `if ($LASTEXITCODE -eq 0) { ${run} } } }`
    )
  }
  return (
    `before=$(git rev-parse HEAD) && git fetch origin ${b} && git checkout --detach FETCH_HEAD && ` +
    `{ if [ ! -d node_modules ] || ! git diff --quiet "$before" HEAD -- ${files}; then npm install; fi; } && ${run}`
  )
}

// ---------- Matching pull requests to cards ----------

export const pullKey = (repo: string, number: number): string => `${repo}#${number}`

const STOP = new Set('a an and are as at be but by can do for from has have i in into is it its me my of on or so that the this to was when with you your add make fix please new app should would want like just also it\'s there them then than'.split(' '))

/** The words that say what something is about: lower case, without little words. */
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''))
      .filter((w) => w.length > 2 && !STOP.has(w))
  )
}

/**
 * Which card (sent to Claude, not matched yet) a new pull request is for: the one whose title
 * shares the most words with the pull request's title and description, if it shares enough.
 */
export function matchPull(items: BoardItem[], pull: { title: string; body: string; createdAt: string }): BoardItem | null {
  const words = keywords(`${pull.title}\n${pull.body}`)
  const titleWords = keywords(pull.title)
  let best: { item: BoardItem; score: number } | null = null
  for (const item of items) {
    if (item.pull || !item.sentAt || item.column === 'done') continue
    // Sent after the pull request was opened: can't be what it's for.
    if (Date.parse(item.sentAt) > Date.parse(pull.createdAt) + 60_000) continue
    const mine = [...keywords(item.title)]
    if (!mine.length) continue
    const shared = mine.filter((w) => words.has(w)).length
    const inTitle = mine.filter((w) => titleWords.has(w)).length
    const score = shared / mine.length + inTitle * 0.1
    const enough = shared >= Math.min(2, mine.length) && shared / mine.length >= 0.5
    if (enough && (!best || score > best.score)) best = { item, score }
  }
  return best?.item ?? null
}

// ---------- Screenshots ----------

/** Image links in a pull request's description (markdown images and <img> tags) that are GitHub's own. */
export function imageUrls(body: string): string[] {
  const found = [
    ...[...(body ?? '').matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)].map((m) => m[1]),
    ...[...(body ?? '').matchAll(/<img[^>]*\ssrc=["'](https:\/\/[^"']+)["']/gi)].map((m) => m[1])
  ]
  return [...new Set(found)].filter(isGitHubImage)
}

export function isGitHubImage(url: string): boolean {
  try {
    const { protocol, hostname, pathname } = new URL(url)
    if (protocol !== 'https:') return false
    if (hostname === 'github.com') return /^\/(user-attachments\/assets|[\w.-]+\/[\w.-]+\/assets)\//.test(pathname)
    return /^(user-images|private-user-images|raw)\.githubusercontent\.com$/.test(hostname)
  } catch {
    return false
  }
}

/** Screenshots grouped by feature, newest feature first, each group's pictures newest first. */
export function shotsByFeature(shots: Shot[]): { feature: string; shots: Shot[]; latest: string }[] {
  const groups = new Map<string, Shot[]>()
  for (const s of shots) groups.set(s.feature, [...(groups.get(s.feature) ?? []), s])
  return [...groups.entries()]
    .map(([feature, list]) => {
      const sorted = [...list].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      return { feature, shots: sorted, latest: sorted[0].date }
    })
    .sort((a, b) => Date.parse(b.latest) - Date.parse(a.latest))
}

// ---------- Token permissions ----------

/** The start of the message shown when GitHub says the token isn't allowed to do something. */
export const TOKEN_NOT_ALLOWED = 'Your GitHub token isn’t allowed to'

export const isTokenPermissionError = (message: string): boolean => message.includes(TOKEN_NOT_ALLOWED)

/**
 * GitHub's page for making a fine-grained token, filled in with what App Studio needs: Pull
 * requests and Contents set to read and write (merging, closing, release notes), for the owner's
 * repositories.
 */
export function newTokenUrl(owner?: string): string {
  const q = new URLSearchParams({ name: 'Orbit App Studio', description: 'Merge, close and release from Orbit’s App Studio', pull_requests: 'write', contents: 'write', metadata: 'read' })
  if (owner) q.set('target_name', owner)
  return `https://github.com/settings/personal-access-tokens/new?${q.toString()}`
}

// ---------- Uncommitted changes ----------

/** "package-lock.json (changed)" from a line of `git status --porcelain`. */
export function describeChange(line: string): string {
  const code = line.slice(0, 2)
  const file = line.slice(3).replace(/^"(.*)"$/, '$1')
  const what = code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('R') ? 'renamed' : code.includes('A') ? 'added' : 'changed'
  return `${file.includes(' -> ') ? file.split(' -> ')[1] : file} (${what})`
}

/** Puts uncommitted changes (new files too) aside in a git stash, to bring back later with `git stash pop`. */
export const stashCommand = (): string => 'git stash push --include-untracked -m "Put away by Orbit before a release"'

/** Commits every change, with a message. */
export function commitAllCommand(windows: boolean, message: string): string {
  const m = message.replace(/["`$\\]/g, '').trim() || 'Update'
  return windows ? `git add -A; if ($LASTEXITCODE -eq 0) { git commit -m "${m}" }` : `git add -A && git commit -m "${m}"`
}

// ---------- Health check ----------

/** A package with a newer version out. */
export interface OutdatedPackage {
  name: string
  /** What's installed (missing when the packages aren't installed yet). */
  current?: string
  /** The newest version package.json already allows (what `npm update` gets). */
  wanted: string
  /** The newest version there is. */
  latest: string
  /** Getting `latest` means a new major version, which can need code changes. */
  major: boolean
  dev: boolean
}

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info'

export const SEVERITIES: Severity[] = ['critical', 'high', 'moderate', 'low', 'info']

/** A package with a known security problem. */
export interface SecurityWarning {
  name: string
  severity: Severity
  /** What the problem is, from the advisory. */
  title: string
  url?: string
  /** Whether `npm audit fix` can fix it without a major update. */
  easyFix: boolean
  /** Fixing it needs a major update of a package (npm audit fix --force), which can break things. */
  majorFix: boolean
}

export interface HealthReport {
  checkedAt: string
  outdated: OutdatedPackage[]
  security: SecurityWarning[]
  /** Something that stopped part of the check (npm not installed, no package-lock.json…). */
  problems: string[]
}

const majorOf = (v?: string): number | null => {
  const m = /^\D*(\d+)\./.exec(v ?? '')
  return m ? Number(m[1]) : null
}

/** Reads `npm outdated --json --long`. */
export function parseOutdated(json: string): OutdatedPackage[] {
  let data: unknown
  try {
    data = JSON.parse(json || '{}')
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const out: OutdatedPackage[] = []
  for (const [name, raw] of Object.entries(data as Record<string, unknown>)) {
    // Workspaces list a package once for each place it's used.
    const entry = (Array.isArray(raw) ? raw[0] : raw) as { current?: string; wanted?: string; latest?: string; type?: string } | undefined
    if (!entry || typeof entry.latest !== 'string' || typeof entry.wanted !== 'string') continue
    const from = majorOf(entry.current ?? entry.wanted)
    const to = majorOf(entry.latest)
    out.push({
      name,
      current: entry.current,
      wanted: entry.wanted,
      latest: entry.latest,
      major: from !== null && to !== null && to > from,
      dev: entry.type === 'devDependencies'
    })
  }
  return out.sort((a, b) => Number(a.major) - Number(b.major) || a.name.localeCompare(b.name))
}

/** Reads `npm audit --json` (npm 7 and later): one warning for each package with a problem. */
export function parseAudit(json: string): SecurityWarning[] {
  let data: { vulnerabilities?: Record<string, { name?: string; severity?: string; via?: unknown[]; fixAvailable?: unknown }> }
  try {
    data = JSON.parse(json || '{}')
  } catch {
    return []
  }
  const out: SecurityWarning[] = []
  for (const [key, v] of Object.entries(data?.vulnerabilities ?? {})) {
    const severity = (SEVERITIES as string[]).includes(v.severity ?? '') ? (v.severity as Severity) : 'info'
    // "via" holds the advisories themselves, or the names of other packages that bring the problem in.
    const advisory = (v.via ?? []).find((x): x is { title?: string; url?: string } => !!x && typeof x === 'object')
    const through = (v.via ?? []).filter((x): x is string => typeof x === 'string')
    const fix = v.fixAvailable
    out.push({
      name: v.name ?? key,
      severity,
      title: advisory?.title ?? (through.length ? `Uses ${through.slice(0, 3).join(', ')}, which ${through.length === 1 ? 'has' : 'have'} a problem` : 'A known problem'),
      url: advisory?.url,
      easyFix: fix === true || (!!fix && typeof fix === 'object' && !(fix as { isSemVerMajor?: boolean }).isSemVerMajor),
      majorFix: !!fix && typeof fix === 'object' && !!(fix as { isSemVerMajor?: boolean }).isSemVerMajor
    })
  }
  return out.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.name.localeCompare(b.name))
}

/** Each severity and how many warnings have it, worst first ("2 high, 1 low"). */
export function severityCounts(warnings: SecurityWarning[]): { severity: Severity; count: number }[] {
  return SEVERITIES.map((severity) => ({ severity, count: warnings.filter((w) => w.severity === severity).length })).filter((c) => c.count > 0)
}

/** How the app is doing: good (nothing to do), fine (updates, no security problems), or attention (security problems). */
export function healthLevel(report: HealthReport): 'good' | 'fine' | 'attention' {
  if (report.security.some((w) => w.severity !== 'info' && w.severity !== 'low')) return 'attention'
  if (report.security.length || report.outdated.length) return 'fine'
  return 'good'
}

/** One line about it, for the app's card. */
export function healthLine(report: HealthReport): string {
  const parts: string[] = []
  if (report.security.length) {
    const worst = severityCounts(report.security)[0]
    parts.push(`${report.security.length} security warning${report.security.length === 1 ? '' : 's'}${worst.severity !== 'info' ? ` (${worst.count} ${worst.severity})` : ''}`)
  }
  if (report.outdated.length) parts.push(`${report.outdated.length} update${report.outdated.length === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : report.problems.length ? 'Couldn’t check everything' : 'All up to date and safe'
}

/** A board card asking Claude to update the packages and fix the security warnings. */
export function healthBoardItem(report: HealthReport): { title: string; details: string } {
  const lines: string[] = []
  if (report.security.length) {
    lines.push('Security warnings from npm audit:')
    for (const w of report.security) lines.push(`- ${w.name} (${w.severity}): ${w.title}${w.url ? ` ${w.url}` : ''}`)
  }
  const majors = report.outdated.filter((p) => p.major)
  const minors = report.outdated.filter((p) => !p.major)
  if (minors.length) {
    if (lines.length) lines.push('')
    lines.push('Safe updates:')
    for (const p of minors) lines.push(`- ${p.name} ${p.current ?? '(not installed)'} → ${p.latest}`)
  }
  if (majors.length) {
    if (lines.length) lines.push('')
    lines.push('Big updates (new major versions, check nothing breaks):')
    for (const p of majors) lines.push(`- ${p.name} ${p.current ?? '(not installed)'} → ${p.latest}`)
  }
  lines.push('', 'Update what’s safe, fix the security warnings, and make sure the app still builds and its tests pass.')
  const title = report.security.length ? 'Fix the security warnings and update packages' : 'Update packages'
  return { title, details: lines.join('\n') }
}
