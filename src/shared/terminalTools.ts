/**
 * Small helpers for the Terminal tab: spotting errors in what a command prints, finding file paths
 * in it, and turning the run buttons' commands into what's typed.
 */

/** Commands a new project starts with (what's used most when testing an app). */
export const DEFAULT_PROJECT_COMMANDS = ['npm install', 'npm run dev', 'git pull', 'git checkout {branch or link}', 'git fetch origin']

const ERROR_WORDS =
  /(\berr(or|ors)?\b|\bERR!|\bfail(ed|ure|ures|ing)?\b|\bfatal\b|\bcrash(ed|es)?\b|\bexception\b|\bpanic(ked)?\b|\bunhandled\b|\bcannot find\b|\bcan't find\b|\bnot recognized\b|\bcommand not found\b|\bTraceback\b|\bsegmentation fault\b|✖|×\s)/i
/** "0 errors", "no failures", "without errors": a good result that happens to use the word. */
const ALL_CLEAR = /\b(0|no|zero|without)\s+(errors?|failures?|failed|problems?)\b|\berrors?:\s*0\b|\bfailed:\s*0\b/i
/** Escape codes (colours and so on) left in a line. */
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

/** Whether a line a command printed looks like an error (and not "0 errors"). */
export function isErrorLine(line: string): boolean {
  const text = line.replace(ESCAPES, '')
  if (!text.trim() || !ERROR_WORDS.test(text)) return false
  // A line that's only good news ("Found 0 errors") isn't one; "3 failed, 0 errors" still is.
  if (ALL_CLEAR.test(text)) return ERROR_WORDS.test(text.replace(new RegExp(ALL_CLEAR.source, 'gi'), ''))
  return true
}

const CODE_TYPES =
  'tsx?|jsx?|mjs|cjs|json|css|scss|sass|less|html?|md|vue|svelte|astro|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|ya?ml|toml|txt|log|sh|ps1|lock|env|xml|gradle|sql|graphql'

/**
 * A file in what a command printed: `src/app.ts:12:5`, `C:\code\eclipse\main.tsx(12,5)`,
 * `./index.js`, `/Users/me/eclipse/vite.config.ts:3`. Web addresses aren't files.
 */
const FILE = new RegExp(
  String.raw`(?<![\w/\\.:@-])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@()+-]+[\\/])*[\w.@+-]+\.(?:${CODE_TYPES}))(?![\w])(?:(?::(\d+))(?::(\d+))?|\((\d+),(\d+)\))?`,
  'g'
)

export interface FileMention {
  /** Where it starts and ends in the line (end is just past the last letter, line number included). */
  start: number
  end: number
  path: string
  line?: number
  column?: number
}

/** The file paths in a line a command printed. */
export function findFiles(line: string): FileMention[] {
  const found: FileMention[] = []
  for (const m of line.matchAll(FILE)) {
    const start = m.index ?? 0
    // Part of a web address (https://example.com/app.js).
    if (/[a-z]+:\/\/\S*$/i.test(line.slice(0, start))) continue
    const path = m[1]
    // A version number or a domain-like word with no folder or line number, e.g. "node.js".
    const lineNo = m[2] ?? m[4]
    if (!/[\\/]/.test(path) && !lineNo && !/^[\w.-]+\.(json|lock|env|ya?ml|toml|md|ts|tsx|jsx|py|log)$/i.test(path)) continue
    found.push({
      start,
      end: start + m[0].length,
      path,
      line: lineNo ? Number(lineNo) : undefined,
      column: m[3] ?? m[5] ? Number(m[3] ?? m[5]) : undefined
    })
  }
  return found
}

/** Joins a path a command printed onto the folder the terminal is in. */
export function resolveFrom(folder: string, path: string, home?: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(folder) || folder.includes('\\')
  if (/^[A-Za-z]:[\\/]/.test(path) || (!windows && path.startsWith('/'))) return path
  if (path.startsWith('~') && home) return joinPaths(home, path.slice(2), windows)
  if (windows && /^[\\/]/.test(path)) return folder.slice(0, 2) + path.replace(/\//g, '\\')
  return joinPaths(folder, path, windows)
}

function joinPaths(base: string, rel: string, windows: boolean): string {
  const sep = windows ? '\\' : '/'
  const parts = base.split(/[\\/]+/)
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  for (const part of rel.split(/[\\/]+/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(part)
  }
  const joined = parts.join(sep)
  return joined || sep
}

/** What a run button asks for before it runs, e.g. "branch or link" in `git checkout {branch or link}`. */
export function commandBlank(command: string): string | null {
  const m = /\{([^{}]+)\}/.exec(command)
  return m ? m[1].trim() || 'value' : null
}

/** A run button's label: the command, with "…" where you fill something in. */
export function commandLabel(command: string): string {
  return command.replace(/\s*\{[^{}]*\}/g, ' …').trim()
}

/**
 * What to put in a command's blank. For `git checkout`, a GitHub link works as well as a branch
 * name: a branch's link gives that branch, and a pull request's link fetches the pull request.
 */
export function fillCommand(command: string, value: string): string {
  const v = value.trim()
  const blank = /\{[^{}]+\}/
  if (/^git\s+checkout\b/.test(command.trim())) {
    const tree = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/tree\/(.+?)\/?$/i.exec(v)
    if (tree) return command.replace(blank, quote(decodeURIComponent(tree[1])))
    const compare = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/compare\/(?:[^.]+\.\.\.)?(.+?)\/?$/i.exec(v)
    if (compare) return command.replace(blank, quote(decodeURIComponent(compare[1])))
    const pull = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i.exec(v)
    if (pull) return `git fetch origin pull/${pull[1]}/head:pr-${pull[1]}; git checkout pr-${pull[1]}`
  }
  return command.replace(blank, quote(v))
}

/** Quoted only when it needs to be (a branch name is left as it is). */
function quote(v: string): string {
  return /^[\w./@:+-]+$/.test(v) ? v : `"${v.replace(/"/g, '')}"`
}

/** Commands that keep running until stopped (a dev server, a watcher), so they get a terminal of their own. */
export function keepsRunning(command: string): boolean {
  const c = command.trim()
  return (
    /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch|preview)\b/.test(c) ||
    /^(npx\s+)?(vite|next\s+dev|electron-vite\s+dev|nodemon)\b/.test(c) ||
    /\s--watch\b/.test(c)
  )
}

/**
 * Keeps track of a line being typed into the terminal, so finished commands can go in the history.
 * Gives up on a line once arrow keys or other special keys are used (the shell's own history or
 * editing), since what's on screen can't be known from here.
 */
export class LineTracker {
  private line = ''
  private unsure = false

  /** Feeds in what was typed; returns the commands finished by Enter. */
  feed(data: string): string[] {
    const done: string[] = []
    // A paste or an escape code: anything starting with Esc makes the line unknown.
    if (data.includes('\x1b')) {
      this.unsure = true
      // Still notice Enter after the escape code (rare).
    }
    for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1bO.|\x1b./g, '')) {
      if (ch === '\r' || ch === '\n') {
        const line = this.line.trim()
        if (line && !this.unsure) done.push(line)
        this.line = ''
        this.unsure = false
      } else if (ch === '\x7f' || ch === '\b') this.line = this.line.slice(0, -1)
      else if (ch === '\x03' || ch === '\x15') {
        // Ctrl+C or Ctrl+U: the line is thrown away.
        this.line = ''
        this.unsure = false
      } else if (ch === '\t') this.unsure = true
      else if (ch >= ' ') this.line += ch
      else this.unsure = true
    }
    return done
  }
}

/** Adds a command to the front of the history (once), keeping the newest `max`. */
export function addToHistory(history: string[], command: string, max = 300): string[] {
  const c = command.trim()
  if (!c) return history
  return [c, ...history.filter((h) => h !== c)].slice(0, max)
}

/** Files that, when a pull changes them, mean `npm install` is needed. */
const PACKAGE_FILES = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']

/**
 * The "Get latest and run" button's command line: pull the latest code, install packages only if
 * the pull changed them (or they've never been installed), then start the app. Each step only runs
 * if the one before worked. Written for PowerShell on Windows, and for zsh/bash on a Mac.
 */
export function latestAndRunCommand(windows: boolean, run = 'npm run dev'): string {
  const files = PACKAGE_FILES.join(' ')
  if (windows) {
    return (
      `$before = git rev-parse HEAD; git pull; if ($LASTEXITCODE -eq 0) { ` +
      `if (-not (Test-Path node_modules) -or (git diff --name-only $before HEAD -- ${files})) { npm install }; ` +
      `if ($LASTEXITCODE -eq 0) { ${run} } }`
    )
  }
  return (
    `before=$(git rev-parse HEAD) && git pull && ` +
    `{ if [ ! -d node_modules ] || ! git diff --quiet "$before" HEAD -- ${files}; then npm install; fi; } && ${run}`
  )
}

/** The command a project's "Get latest and run" button starts the app with: its first one that keeps running. */
export function runCommandOf(commands: string[]): string {
  return commands.find((c) => keepsRunning(c) && !/\{[^{}]+\}/.test(c)) ?? 'npm run dev'
}
