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
