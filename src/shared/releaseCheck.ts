/**
 * App Studio's release helper: the checks run before a release, plain-language explanations of
 * what went wrong (from git, npm, the tests or GitHub's build log), and the "What's new" list an
 * app keeps in its code. Everything here is pure, so it's tested without git, npm or GitHub.
 */

/** Something a check or an explanation offers to do about a problem (a button). */
export type FixId =
  /** git stash the uncommitted changes. */
  | 'put-away'
  /** git checkout <main> and pull. */
  | 'switch-main'
  /** git pull --ff-only: get what's on GitHub. */
  | 'pull'
  /** Push a release that was made on this computer but never reached GitHub. */
  | 'finish-push'
  /** Delete a tag (and its draft release) left over from a release that didn't finish. */
  | 'delete-tag'
  /** Write the "What's new" notes for the version into the app's code. */
  | 'write-notes'
  /** Take out "What's new" notes for versions newer than the one being released (never released). */
  | 'drop-notes'
  /** Sign in to GitHub for git (a push in the terminal, so git can ask). */
  | 'sign-in'
  /** Connect GitHub in App Studio. */
  | 'connect-github'
  /** Make a new GitHub token with the permissions Orbit needs. */
  | 'new-token'
  /** Windows: turn on Developer Mode (lets tests make symlinks). */
  | 'developer-mode'
  /** npm install, for missing packages. */
  | 'npm-install'
  /** Put it on the Ideas & bugs board for Claude to fix. */
  | 'ask-claude'

/** A plain explanation of an error. */
export interface Problem {
  title: string
  detail: string
  fixes: FixId[]
}

export type CheckState = 'pass' | 'warn' | 'fail' | 'skip' | 'running'

export type CheckId = 'tree' | 'branch' | 'latest' | 'unfinished' | 'tag' | 'notes' | 'push' | 'token' | 'tests'

export interface Check {
  id: CheckId
  label: string
  state: CheckState
  /** What it found, in plain words. */
  text: string
  fixes?: FixId[]
  /** What git or npm actually said, for "Show details". */
  output?: string
  /** The tag its fixes act on (deleting a leftover one). */
  tag?: string
}

export interface Preflight {
  /** The version now (package.json) and the one being released. */
  version: string
  next: string
  tag: string
  checks: Check[]
  /** The app's "What's new" file (relative to its folder), when it has one. */
  notesFile?: string
}

/** How the app's folder compares with GitHub's main branch (the "Latest main" strip on Releases). */
export interface MainStatus {
  /** The main branch's name (main or master). */
  main: string
  /** The branch the folder is on now (none when git is mid-rebase or on a commit). */
  branch?: string
  onMain: boolean
  /** Files changed since the last commit. */
  dirty: number
  /** Whether the folder has a GitHub remote (origin) at all. */
  linked: boolean
  /** Commits on GitHub's main this folder's main doesn't have. */
  behind: number
  /** Commits on this folder's main GitHub doesn't have yet. */
  ahead: number
  /** Why GitHub couldn't be checked, in plain words. */
  problem?: string
  output?: string
}

/** A line saying how far behind (or ahead of) GitHub's main the folder is. */
export function mainStatusText(s: MainStatus): string {
  if (!s.linked) return 'This app’s folder isn’t linked to GitHub, so there’s no main to get.'
  if (s.problem) return s.problem
  const commits = (n: number): string => (n === 1 ? '1 commit' : `${n} commits`)
  // Off main it's still main that's compared (what a release is made from); the strip says which branch it's on.
  const where = `This folder’s ${s.main}`
  if (!s.behind && !s.ahead) return `${where} matches GitHub’s ${s.main}.`
  if (!s.behind) return `${where} has everything on GitHub’s ${s.main}, plus ${commits(s.ahead)} that ${s.ahead === 1 ? 'isn’t' : 'aren’t'} on GitHub yet.`
  const behind = `${where} is ${commits(s.behind)} behind GitHub’s ${s.main}`
  return s.ahead ? `${behind}, and has ${commits(s.ahead)} GitHub doesn’t.` : `${behind}.`
}

export const CHECK_LABELS: Record<CheckId, string> = {
  tree: 'Everything is committed',
  branch: 'On the main branch',
  latest: 'Up to date with GitHub',
  unfinished: 'No half-finished release',
  tag: 'The new version is free',
  notes: 'What’s new notes are written',
  push: 'Git can push to GitHub',
  token: 'GitHub connected in Orbit',
  tests: 'Tests pass'
}

/** Whether nothing stops the release (warnings are fine). */
export const readyToRelease = (checks: Check[]): boolean => checks.length > 0 && checks.every((c) => c.state === 'pass' || c.state === 'warn' || c.state === 'skip')

export interface ReleaseResult {
  ok: boolean
  tag?: string
  /** Which step stopped: setting the version, or pushing. */
  step?: 'version' | 'push'
  problem?: Problem
  output: string
}

export interface FixResult {
  ok: boolean
  message: string
  problem?: Problem
  output?: string
}

// ---------- Reading tool output ----------

/** Output without colour codes, carriage-return redraws or GitHub's per-line timestamps. */
export function cleanOutput(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .split('\n')
      .map((l) => l.replace(/^.*\r(?!$)/, '').replace(/\r$/, ''))
      .map((l) => l.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z ?/, ''))
      .join('\n')
  )
}

/** The last `lines` lines, for "Show details". */
export function lastLines(text: string, lines = 40): string {
  const all = cleanOutput(text).trimEnd().split('\n')
  return all.slice(-lines).join('\n')
}

/** The tests that failed, from vitest's (or jest's) output: "whatsNew.test.ts › has notes for…". */
export function failedTests(output: string): string[] {
  const out: string[] = []
  for (const line of cleanOutput(output).split('\n')) {
    // vitest: " FAIL  src/x.test.ts > group > name"   jest: " ● group › name"
    const m = /^\s*(?:FAIL|×|✗)\s+(\S+\.(?:test|spec)\.[jt]sx?)(?:\s+>\s+(.+?))?(?:\s+\[[^\]]*\])?(?:\s+\d+m?s)?\s*$/.exec(line)
    if (m) {
      const file = m[1].split(/[\\/]/).pop() ?? m[1]
      const name = m[2] ? `${file} › ${m[2].split(/\s+>\s+/).pop()}` : file
      if (!out.includes(name) && !out.some((n) => n.startsWith(name + ' › '))) out.push(name)
    }
  }
  // A file listed alone when its tests are listed too adds nothing.
  return out.filter((n) => n.includes(' › ') || !out.some((o) => o.startsWith(n + ' › '))).slice(0, 12)
}

/** How many commits this computer has that GitHub doesn't, and the other way round (`git rev-list --left-right --count HEAD...origin/main`). */
export function aheadBehind(text: string | null): { ahead: number; behind: number } | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(text ?? '')
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null
}

interface Rule {
  /** Only for what git (or npm version) said: never matched in a test run's or GitHub build's output. */
  git?: boolean
  test: RegExp
  problem: (m: RegExpExecArray, ctx: ExplainContext) => Problem
}

export interface ExplainContext {
  windows?: boolean
  /** The release's tag, when there is one. */
  tag?: string
  /** The app's main branch. */
  main?: string
  /**
   * Where the output came from. A test run's output is full of test names and code ("explains
   * protected branches", "Authentication failed" in a fixture…), so git's explanations aren't
   * looked for in it.
   */
  source?: 'git' | 'tests' | 'build'
}

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/**
 * What went wrong, said plainly, with what to do about it. The rules go from most to least
 * specific, so a failed test explains itself before the "npm test failed" that follows it.
 */
const RULES: Rule[] = [
  {
    test: /keeps the notes newest first/i,
    problem: () => ({
      title: 'The What’s new list is out of order',
      detail: 'A test checks the app’s What’s new list goes newest version first, and it doesn’t. Usually that’s notes left over from a version you gave up on, sitting above the new ones. Check again: Orbit spots leftovers and can take them out.',
      fixes: ['ask-claude']
    })
  },
  {
    test: /has notes for the current version|(?:FAIL|×|✗)\s+\S*whats-?new\.test/i,
    problem: (_m, ctx) => ({
      title: 'The What’s new notes for this version are missing',
      detail: `The app shows a “What’s new” list after it updates, and a test checks there’s an entry for ${ctx.tag ? ctx.tag.replace(/^v/, '') : 'the new version'}. Write the notes and Orbit adds them to the code and commits them.`,
      fixes: ['write-notes']
    })
  },
  {
    test: /EPERM[^\n]*symlink|symlink[^\n]*EPERM|A required privilege is not held by the client/i,
    problem: (_m, ctx) => ({
      title: 'A test needs to make a shortcut (a symlink), and Windows said no',
      detail: ctx.windows
        ? 'This is a Windows setting on this PC, not a problem with your code: it passes on GitHub. Windows only lets programs make symlinks with Developer Mode on. Turn it on, then check again. (Or ask Claude to make the test skip itself when it can’t make symlinks.)'
        : 'The computer running the tests isn’t allowed to make symlinks. Ask Claude to make the test skip itself when it can’t.',
      fixes: ctx.windows ? ['developer-mode', 'ask-claude'] : ['ask-claude']
    })
  },
  {
    test: /(localStorage|sessionStorage|window|document|navigator) is not defined/,
    problem: (m) => ({
      title: `A test tripped over ${m[1]}, which only exists inside the app`,
      detail: `Tests run without the app’s window, so there’s no ${m[1]} there. Some code reads it as soon as it’s loaded. It needs wrapping so it carries on without it. It isn’t a problem in the app itself. Ask Claude to fix it.`,
      fixes: ['ask-claude']
    })
  },
  {
    test: /(?:vitest|jest|tsc|electron-vite|electron-builder)['"]?(?: is not recognized|: not found|: command not found)|Cannot find module '(?:vitest|typescript|electron)[^']*'/i,
    problem: () => ({
      title: 'The app’s packages aren’t installed',
      detail: 'The tools the tests need come from npm, and they’re not in this folder (or are out of date). Install them, then check again.',
      fixes: ['npm-install']
    })
  },
  {
    test: /'npm' is not recognized|npm: (?:command )?not found|spawn npm(?:\.cmd)? ENOENT/i,
    problem: () => ({
      title: 'npm isn’t installed on this computer',
      detail: 'Orbit uses npm (it comes with Node.js) to run the tests and set the version. Install Node.js from nodejs.org, then restart Orbit.',
      fixes: []
    })
  },
  {
    test: /error TS(\d+):/,
    problem: (_m) => ({
      title: 'TypeScript found mistakes in the code',
      detail: 'The type check runs on GitHub before the installers are built, so the release would fail there. Ask Claude to fix them.',
      fixes: ['ask-claude']
    })
  },
  {
    git: true,
    test: /Git working directory not clean|working tree (?:is )?not clean|Your local changes to the following files would be overwritten/i,
    problem: () => ({
      title: 'Some files are changed but not committed',
      detail: 'A release is made from what’s committed. Put the changes away (you can bring them back later) or commit them, then try again.',
      fixes: ['put-away']
    })
  },
  {
    git: true,
    test: /tag '?(v?[\w.+-]+)'? already exists/i,
    problem: (m) => ({
      title: `There’s already a ${m[1]} tag`,
      detail: `A release that didn’t finish probably left it behind. If ${m[1]} was never published, delete the leftover tag and try again.`,
      fixes: ['delete-tag']
    })
  },
  {
    git: true,
    test: /GH006|Protected branch update failed|protected branch hook declined/i,
    problem: (_m, ctx) => ({
      title: `GitHub doesn’t allow pushing straight to ${ctx.main ?? 'main'}`,
      detail: `${ctx.main ?? 'main'} is a protected branch on GitHub, so the version change can’t go straight onto it. Turn off “Require a pull request before merging” in the repository’s Settings → Branches, or release from GitHub’s Actions tab instead.`,
      fixes: []
    })
  },
  {
    git: true,
    test: /refusing to allow a (?:Personal Access Token|OAuth App) to create or update workflow/i,
    problem: () => ({
      title: 'Git’s sign-in can’t change the release workflow',
      detail: 'This release changes a file in .github/workflows, and the token git uses isn’t allowed to. Give that token the “workflow” permission, or push from a computer signed in with the browser.',
      fixes: ['sign-in']
    })
  },
  {
    git: true,
    test: /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)|Updates were rejected because the (?:remote contains work|tip of your current branch is behind)/,
    problem: () => ({
      title: 'GitHub has changes this computer doesn’t',
      detail: 'Something was merged on GitHub since you last got the latest. Get it first, then release again.',
      fixes: ['pull']
    })
  },
  {
    git: true,
    test: /Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \(publickey\)|returned error: 403|Permission to \S+ denied to/i,
    problem: () => ({
      title: 'Git couldn’t sign in to GitHub',
      detail: 'Git on this computer needs to be signed in to push. Sign in once from the terminal (a GitHub window may pop up), then check again.',
      fixes: ['sign-in']
    })
  },
  {
    git: true,
    test: /Could not resolve host|Failed to connect to|unable to access|ETIMEDOUT|ENOTFOUND|ECONNRESET|Couldn.t reach GitHub/i,
    problem: () => ({
      title: 'Couldn’t reach GitHub',
      detail: 'Check the internet connection, then try again.',
      fixes: []
    })
  },
  {
    git: true,
    test: /Not possible to fast-forward|diverging branches|have diverged/i,
    problem: (_m, ctx) => ({
      title: `This computer’s ${ctx.main ?? 'main'} and GitHub’s have gone different ways`,
      detail: 'There are commits here that aren’t on GitHub, and commits on GitHub that aren’t here, so git can’t simply catch up. Open the terminal and run git pull to combine them (or ask Claude).',
      fixes: ['ask-claude']
    })
  },
  {
    git: true,
    test: /CONFLICT \(|Automatic merge failed/i,
    problem: () => ({
      title: 'Git found changes that clash',
      detail: 'The same lines were changed here and on GitHub. Sort it out in the terminal, or ask Claude to.',
      fixes: ['ask-claude']
    })
  },
  {
    test: /Tests?\s+(\d+) failed|Test Files\s+(\d+) failed|(\d+) failing/,
    problem: (m) => {
      const n = Number(m[1] ?? m[2] ?? m[3])
      return {
        title: `${plural(n, 'test')} failed`,
        detail: 'The same tests run on GitHub before the installers are built, so the release would fail there too. Ask Claude to fix them, then check again.',
        fixes: ['ask-claude']
      }
    }
  },
  {
    test: /ENOSPC|no space left on device/i,
    problem: () => ({ title: 'The disk is full', detail: 'Free some space, then try again.', fixes: [] })
  }
]

/** What went wrong, in plain words, with what to do about it. */
export function explainProblem(output: string, ctx: ExplainContext = {}): Problem {
  // Tests that passed say nothing about what went wrong, but their names can sound like it.
  const text = cleanOutput(output)
    .split('\n')
    .filter((l) => !/^\s*[✓✔√]\s/.test(l))
    .join('\n')
  for (const rule of RULES) {
    if (rule.git && (ctx.source === 'tests' || ctx.source === 'build')) continue
    const m = rule.test.exec(text)
    if (m) {
      const p = rule.problem(m, ctx)
      // Name the failed tests, when the output says which.
      const tests = failedTests(text)
      if (tests.length && p.fixes.includes('ask-claude')) p.detail += ` Failed: ${tests.slice(0, 4).join(', ')}${tests.length > 4 ? ` and ${tests.length - 4} more` : ''}.`
      return p
    }
  }
  const last = text
    .trim()
    .split('\n')
    .reverse()
    .find((l) => /error|fatal|failed/i.test(l))
  return {
    title: 'Something went wrong',
    detail: last ? `The last error was: “${last.trim().replace(/^npm (ERR!|error) /, '').slice(0, 220)}”. The details below have the rest. Ask Claude if it doesn’t make sense.` : 'The details below have what it said. Ask Claude if it doesn’t make sense.',
    fixes: ['ask-claude']
  }
}

/** A board card for Claude about a release problem: what happened and what the tools said. */
export function problemCard(app: string, version: string, problem: Problem, output?: string): { title: string; details: string } {
  const lines = [`Releasing ${app} v${version} stopped: ${problem.title}.`, '', problem.detail]
  if (output?.trim()) lines.push('', 'What it said:', '```', lastLines(output, 60), '```')
  return { title: `Release blocked: ${problem.title}`.slice(0, 120), details: lines.join('\n') }
}

// ---------- The app's "What's new" list ----------

/** Where an app keeps its "What's new" notes, looked for in this order. */
export const NOTES_FILE_NAMES = /^(whats-?new|release-?notes|changelog)\.(ts|js|mjs|cjs|tsx|jsx)$/i

/** The versions a "What's new" file has notes for ({ version: '1.2.3', … }). */
export function notesVersions(source: string): string[] {
  return [...source.matchAll(/\bversion\s*:\s*['"`](\d+\.\d+\.\d+)['"`]/g)].map((m) => m[1])
}

/** Whether a file looks like a list of notes by version (not just any file that mentions one). */
export const isNotesList = (source: string): boolean => /\bversion\s*:\s*['"`]\d+\.\d+\.\d+['"`]/.test(source) && /\bitems\s*:\s*\[/.test(source)

/** "What's new" text (a list, maybe with headings) as the lines for the app's notes. */
export function notesItems(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const bullets = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
  return (bullets.length ? bullets : lines.filter((l) => !/^(#+\s|what.?s new$|fixes$|new$)/i.test(l)))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 40)
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`

const versionParts = (v: string): number[] => v.split('.').map(Number)
/** 1 when a is the newer version, -1 when b is, 0 when they're the same. */
export function compareVersion(a: string, b: string): number {
  const x = versionParts(a)
  const y = versionParts(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1
  return 0
}

/** Notes for versions newer than the one being released: left over from a version that was given up on. */
export const staleNotes = (versions: string[], next: string): string[] => versions.filter((v) => compareVersion(v, next) > 0)

interface NotesEntry {
  version: string
  /** Where its `{` is, and just after its `}`. */
  start: number
  end: number
}

/** The entries in a notes list, found by matching their braces (skipping over strings). */
function notesEntries(source: string): NotesEntry[] {
  const out: NotesEntry[] = []
  for (const m of source.matchAll(/\bversion\s*:\s*['"`](\d+\.\d+\.\d+)['"`]/g)) {
    const start = source.lastIndexOf('{', m.index)
    if (start < 0) continue
    let depth = 0
    let quote = ''
    let end = -1
    for (let i = start; i < source.length && end < 0; i++) {
      const c = source[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = ''
      } else if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) end = i + 1
    }
    if (end > 0) out.push({ version: m[1], start, end })
  }
  return out
}

const lineStart = (source: string, at: number): number => source.lastIndexOf('\n', at - 1) + 1

/**
 * The file with an entry for `version` added to its list, in version order (newest first), indented
 * like the entries already there. Null when there's no list to add to, or it already has that version.
 */
export function addNotesEntry(source: string, version: string, items: string[]): string | null {
  if (notesVersions(source).includes(version)) return null
  const start = /(RELEASE_NOTES|releaseNotes|WHATS_NEW|whatsNew|CHANGELOG|changelog|NOTES|notes)\b[^=\n]*=\s*\[/.exec(source)
  if (!start) return null
  const at = start.index + start[0].length
  const rest = source.slice(at)
  // Indentation: the first entry's, else two spaces.
  const first = /\n([ \t]*)\{/.exec(rest)
  const indent = first ? first[1] : '  '
  const unit = indent.includes('\t') ? '\t' : indent.length >= 2 ? indent.slice(0, 2) : '  '
  const lines = [`${indent}{`, `${indent}${unit}version: '${version}',`, `${indent}${unit}items: [`]
  items.forEach((item, i) => lines.push(`${indent}${unit}${unit}${quote(item)}${i < items.length - 1 ? ',' : ''}`))
  lines.push(`${indent}${unit}]`, `${indent}}`)
  // Windows line endings stay Windows line endings (git on Windows often checks files out that way).
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const entries = notesEntries(source).filter((e) => e.start >= at)
  // Below any newer entries (notes written ahead for a bigger version), so the list stays in order.
  if (entries.length && compareVersion(entries[0].version, version) > 0) {
    const older = entries.find((e) => compareVersion(e.version, version) < 0)
    if (older) {
      const line = lineStart(source, older.start)
      return source.slice(0, line) + lines.join(eol) + ',' + eol + source.slice(line)
    }
    const last = entries[entries.length - 1]
    const comma = /^\s*,/.test(source.slice(last.end)) ? '' : ','
    const after = last.end + (comma ? 0 : source.slice(last.end).indexOf(',') + 1)
    return source.slice(0, after) + comma + eol + lines.join(eol) + source.slice(after)
  }
  lines[lines.length - 1] += /^\s*\]/.test(rest) ? '' : ','
  return source.slice(0, at) + eol + lines.join(eol) + (/^[ \t]*\r?\n/.test(rest) ? '' : eol) + rest
}

/** The file without the entries for these versions (and their lines). Null when none were there. */
export function removeNotesEntries(source: string, versions: string[]): string | null {
  const gone = notesEntries(source).filter((e) => versions.includes(e.version))
  if (!gone.length) return null
  let out = source
  for (const e of gone.sort((a, b) => b.start - a.start)) {
    const from = lineStart(out, e.start)
    // The comma after it, and the rest of its line.
    const tail = /^[ \t]*,?[ \t]*(\r?\n)?/.exec(out.slice(e.end))
    out = out.slice(0, from) + out.slice(e.end + (tail ? tail[0].length : 0))
  }
  return out
}

// ---------- After the release: GitHub's build ----------

export interface BuildJob {
  name: string
  /** queued, in_progress, completed. */
  status: string
  /** success, failure, cancelled, skipped… once completed. */
  conclusion: string | null
  /** The step it failed on. */
  failedStep?: string
  /** When GitHub started and finished it (ISO times). */
  started?: string
  finished?: string
  /** Its steps, in order, as GitHub lists them. */
  steps?: BuildStep[]
  /** How long it took on the last good builds (ms), for the time left. */
  usualMs?: number
}

export interface BuildStep {
  name: string
  status: string
  conclusion: string | null
}

export interface BuildStatus {
  tag: string
  /** The tag on this computer and on GitHub, and whether it's on the commit you're on now. */
  tagHere: boolean
  tagOnGitHub: boolean
  tagIsHead: boolean
  /** The release on GitHub for the tag. */
  release?: { draft: boolean; prerelease: boolean; url: string }
  /** The newest GitHub Actions run for the tag. */
  run?: { id: number; status: string; conclusion: string | null; url: string; started: string; finished?: string; usualMs?: number; jobs: BuildJob[] }
  /** Why it failed, when it did (read from the failed job's log). */
  problem?: Problem
  /** The end of the failed job's log. */
  log?: string
  /** Why GitHub couldn't be asked (no token, no Actions permission…). */
  error?: string
}

export type BuildPhase = 'not-pushed' | 'waiting' | 'building' | 'failed' | 'published' | 'draft' | 'unknown'

/** Where a release is: never reached GitHub, building, failed, out, or stuck as a draft. */
export function buildPhase(s: BuildStatus): BuildPhase {
  if (s.tagHere && !s.tagOnGitHub) return 'not-pushed'
  if (s.release && !s.release.draft && (!s.run || s.run.status === 'completed')) return 'published'
  if (s.run && s.run.status !== 'completed') return 'building'
  if (s.run && s.run.conclusion && s.run.conclusion !== 'success') return 'failed'
  if (s.release?.draft) return 'draft'
  if (s.tagOnGitHub && !s.run && !s.release) return 'waiting'
  return 'unknown'
}

export type RecoveryId = 'finish-push' | 'rerun' | 'retag' | 'give-up' | 'write-notes'

/**
 * The buttons for a release that didn't make it: push it (it never left this computer), run the
 * failed builds again (for a hiccup), build again from the latest commit (once the problem's fixed
 * and committed: the tag moves to it), or give up on the version (the draft release and the tag go;
 * the next release uses the next number). Nothing that touches a published release.
 */
export function recoveryActions(s: BuildStatus): RecoveryId[] {
  const phase = buildPhase(s)
  if (phase === 'not-pushed') return ['finish-push', 'give-up']
  if (phase !== 'failed' && phase !== 'draft') return []
  const out: RecoveryId[] = []
  if (s.problem?.fixes.includes('write-notes')) out.push('write-notes')
  if (phase === 'failed' && s.run) out.push('rerun')
  if (s.tagHere || s.tagOnGitHub) out.push('retag')
  out.push('give-up')
  return out
}

/** "Windows ✓ · Mac failed (npm test)". */
export function jobsLine(jobs: BuildJob[]): string {
  return jobs
    .map((j) => {
      const name = j.name.replace(/^Build \((.+)\)$/, '$1')
      if (j.status !== 'completed') return `${name} ${j.status === 'queued' ? 'waiting' : 'building…'}`
      if (j.conclusion === 'success') return `${name} ✓`
      if (j.conclusion === 'skipped') return `${name} skipped`
      return `${name} ${j.conclusion === 'cancelled' ? 'cancelled' : 'failed'}${j.failedStep ? ` (${j.failedStep})` : ''}`
    })
    .join(' · ')
}

export type JobState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled'

export interface JobProgress {
  /** "Windows" for "Build (Windows)". */
  label: string
  state: JobState
  /** "Step 4 of 9: Build and upload installers", "Waiting for a computer", "Done in 6:12"… */
  text: string
  /** How far through it is (0 to 1), when that can be told. */
  share?: number
  /** "3:05" so far (or in all, once it's done). */
  elapsed?: string
  /** "about 4 min left", "almost done", "taking longer than usual (6:10)". */
  left?: string
}

const ms = (iso?: string): number | undefined => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : undefined
}

/** Rough time left from how long it usually takes. */
export function leftText(elapsed: number, usualMs?: number): string {
  if (!usualMs) return ''
  const left = usualMs - elapsed
  if (left < 0) return `taking longer than usual (${clockTime(usualMs)})`
  if (left < 15_000) return 'almost done'
  return left < 60_000 ? `about ${Math.ceil(left / 10_000) * 10} seconds left` : `about ${Math.round(left / 60_000)} min left`
}

/** What one of GitHub's build jobs is doing, in words, with its time so far and time left. */
export function jobProgress(j: BuildJob, now: number): JobProgress {
  const label = j.name.replace(/^Build \((.+)\)$/, '$1')
  const start = ms(j.started)
  const end = ms(j.finished)
  const steps = j.steps ?? []
  if (j.status === 'completed') {
    const took = start && end ? clockTime(end - start) : undefined
    if (j.conclusion === 'success') return { label, state: 'done', text: took ? `Done in ${took}` : 'Done', share: 1, elapsed: took }
    if (j.conclusion === 'skipped') return { label, state: 'skipped', text: 'Skipped' }
    if (j.conclusion === 'cancelled') return { label, state: 'cancelled', text: 'Cancelled', elapsed: took }
    return { label, state: 'failed', text: j.failedStep ? `Failed at “${j.failedStep}”` : 'Failed', elapsed: took }
  }
  if (j.status !== 'in_progress' || !start) return { label, state: 'waiting', text: j.status === 'queued' ? 'Waiting for one of GitHub’s computers' : 'Waiting for the jobs before it', share: 0 }
  const elapsed = Math.max(0, now - start)
  const at = steps.findIndex((s) => s.status !== 'completed')
  const text = steps.length && at >= 0 ? `Step ${at + 1} of ${steps.length}: ${steps[at].name}` : 'Starting…'
  const byTime = j.usualMs ? elapsed / j.usualMs : undefined
  const bySteps = steps.length ? Math.max(0, at) / steps.length : undefined
  const share = Math.min(0.97, byTime ?? bySteps ?? 0)
  return { label, state: 'running', text, share, elapsed: clockTime(elapsed), left: leftText(elapsed, j.usualMs) || undefined }
}

/** The whole build: "4:12 so far, about 3 min left" or "Took 7:40". */
export function runTimeText(run: NonNullable<BuildStatus['run']>, now: number): string {
  const start = ms(run.started)
  if (!start) return ''
  if (run.status === 'completed') {
    const end = ms(run.finished)
    return end ? `Took ${clockTime(end - start)}` : ''
  }
  const elapsed = Math.max(0, now - start)
  const left = leftText(elapsed, run.usualMs)
  return `${clockTime(elapsed)} so far${left ? `, ${left}` : ''}`
}

/** Only plain version tags are touched by the recovery buttons. */
export const isVersionTag = (tag: string): boolean => /^v\d+\.\d+\.\d+$/.test(tag)

/** Where the release check's type check and tests are up to, sent while they run. */
export interface TestProgress {
  folder: string
  stage: 'typecheck' | 'tests'
  /** How many stages this run has (1 when there's no type check). */
  stages: number
  /** When this stage started (ms since 1970). */
  startedAt: number
  /** Test files finished, and how many there are (when the files could be counted). */
  filesDone: number
  filesTotal?: number
  testsDone: number
  failed: number
  /** How long this stage took the last time it passed, for a rough time left. */
  expectedMs?: number
}

/** One finished test file in vitest's (✓ a.test.ts (12 tests | 1 failed) 30ms) or jest's (PASS a.test.ts) output. */
export function finishedTestFile(line: string): { file: string; tests: number; failed: number } | null {
  const v = /^\s*(?:✓|√|❯|×|✗|↓)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\((\d+) tests?([^)]*)\)/.exec(line)
  if (v) return { file: v[1], tests: Number(v[2]), failed: Number(/(\d+) failed/.exec(v[3])?.[1] ?? 0) }
  const j = /^\s*(PASS|FAIL)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/.exec(line)
  if (j) return { file: j[2], tests: 0, failed: j[1] === 'FAIL' ? 1 : 0 }
  return null
}

/** 75000 → "1:15". */
export function clockTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Rough time left: from how far through the files it is, else from how long it took last time. */
export function timeLeft(p: TestProgress, now: number): string {
  const elapsed = now - p.startedAt
  let left: number | undefined
  if (p.filesTotal && p.filesDone >= 3 && elapsed > 3000) left = (elapsed / p.filesDone) * (p.filesTotal - p.filesDone)
  else if (p.expectedMs) left = p.expectedMs - elapsed
  if (left === undefined) return ''
  if (left < 0) return p.expectedMs ? `taking longer than last time (${clockTime(p.expectedMs)})` : ''
  if (left < 10_000) return 'almost done'
  return left < 60_000 ? `about ${Math.ceil(left / 10_000) * 10} seconds left` : `about ${Math.round(left / 60_000)} min left`
}

/** "Step 2 of 2: running the tests. 120 of 210 files done (1,204 tests). 0:42 so far, about 20 seconds left." */
export function testProgressText(p: TestProgress, now: number): string {
  const step = p.stages > 1 ? `Step ${p.stage === 'typecheck' ? 1 : 2} of ${p.stages}: ` : ''
  let what = p.stage === 'typecheck' ? `${step}checking the types.` : `${step}running the tests.`
  if (p.stage === 'tests' && (p.filesDone || p.filesTotal)) {
    what += ` ${p.filesDone}${p.filesTotal ? ` of ${p.filesTotal}` : ''} file${(p.filesTotal ?? p.filesDone) === 1 ? '' : 's'} done`
    if (p.testsDone) what += ` (${p.testsDone.toLocaleString('en-GB')} tests)`
    what += p.failed ? `, ${p.failed} failed so far.` : '.'
  }
  const left = timeLeft(p, now)
  return `${what.replace(/^./, (c) => c.toUpperCase())} ${clockTime(now - p.startedAt)} so far${left ? `, ${left}` : ''}.`
}
