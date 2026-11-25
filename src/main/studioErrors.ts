import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { addStudioError, readStudioErrors, type StudioError, type StudioErrorKind } from '@shared/claudeDesktop'
import type { BuildStatus, Check, FixResult, MainStatus, Preflight, ReleaseResult } from '@shared/releaseCheck'
import { logError } from './log'

/**
 * App Studio's problem history: the last few things that went wrong in the release helper (a
 * failed check, failing tests, a release or fix that didn't work, GitHub's build failing, git
 * trouble), kept in app-studio-errors.json in Orbit's settings folder so they're still there after
 * a restart. Claude Desktop reads them through the connection in claudeDesktop.ts.
 *
 * Also remembers what the release helper last said about each app, for "what does the release
 * helper say about it?".
 */

const file = (): string => join(app.getPath('userData'), 'app-studio-errors.json')

let cache: StudioError[] | null = null

export function studioErrors(): StudioError[] {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? readStudioErrors(JSON.parse(readFileSync(file(), 'utf8'))) : []
  } catch {
    cache = []
  }
  return cache
}

function save(list: StudioError[]): void {
  cache = list
  try {
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify(list, null, 1))
    renameSync(tmp, file())
  } catch (err) {
    logError('saving App Studio’s problems', err)
  }
}

/** Each app's name by folder (its repository when it has one), learned as the release helper runs. */
const appNames = new Map<string, string>()

export function nameApp(folder: string, repo: string | undefined): void {
  appNames.set(folder, repo ?? basename(folder))
}

const appOf = (folder: string): string => appNames.get(folder) ?? basename(folder)

export function recordStudioError(folder: string, kind: StudioErrorKind, step: string, title: string, detail: string, output = ''): void {
  save(addStudioError(studioErrors(), { app: appOf(folder), folder, at: new Date().toISOString(), kind, step, title, detail, output }))
}

/** Splits "Title. Detail…" (how a check words a problem) into its two parts. */
function split(text: string): { title: string; detail: string } {
  const at = text.indexOf('. ')
  return at > 0 && at < 160 ? { title: text.slice(0, at), detail: text.slice(at + 2) } : { title: text, detail: '' }
}

// ---------- What the release helper last said ----------

export interface ReleaseMemory {
  preflight?: { at: string; result: Preflight }
  tests?: { at: string; result: Check }
  release?: { at: string; result: ReleaseResult }
  build?: { at: string; result: BuildStatus }
  main?: { at: string; result: MainStatus }
  fix?: { at: string; what: string; result: FixResult }
}

const memory = new Map<string, ReleaseMemory>()
const now = (): string => new Date().toISOString()

export const releaseMemory = (folder: string): ReleaseMemory => memory.get(folder) ?? {}
/** Folders the release helper has looked at since Orbit started. */
export const knownFolders = (): string[] => [...memory.keys()]

function remember(folder: string, patch: ReleaseMemory): void {
  memory.set(folder, { ...memory.get(folder), ...patch })
}

// ---------- Called by the release helper with what it found ----------

export function sawPreflight(folder: string, result: Preflight): void {
  remember(folder, { preflight: { at: now(), result } })
  const failed = result.checks.filter((c) => c.state === 'fail')
  if (!failed.length) return
  const first = split(failed[0].text)
  const title = failed.length === 1 ? first.title : `${failed.length} checks failed before releasing ${result.tag}`
  const detail = failed.map((c) => `${c.label}: ${c.text}`).join('\n')
  const output = failed
    .filter((c) => c.output)
    .map((c) => `--- ${c.label} ---\n${c.output}`)
    .join('\n\n')
  recordStudioError(folder, 'preflight', failed.map((c) => c.label).join(', '), title, failed.length === 1 ? first.detail : detail, output)
}

export function sawTests(folder: string, result: Check): void {
  // A failure is recorded by the release helper itself, with all of npm's output.
  remember(folder, { tests: { at: now(), result } })
}

export function sawRelease(folder: string, result: ReleaseResult): void {
  remember(folder, { release: { at: now(), result } })
  if (result.ok) return
  recordStudioError(folder, 'release', result.step === 'push' ? 'Pushing the release to GitHub' : 'Setting the version (npm version)', result.problem?.title ?? 'The release didn’t finish', result.problem?.detail ?? '', result.output)
}

export function sawBuild(folder: string, result: BuildStatus): void {
  remember(folder, { build: { at: now(), result } })
  if (!result.problem) return
  const job = result.run?.jobs.find((j) => j.conclusion === 'failure')
  const step = job ? `${job.name}${job.failedStep ? `: ${job.failedStep}` : ''}` : `Building ${result.tag}`
  recordStudioError(folder, 'build', step, result.problem.title, `${result.problem.detail}${result.run?.url ? `\nOn GitHub: ${result.run.url}` : ''}`, result.log ?? '')
}

export function sawMainStatus(folder: string, result: MainStatus): void {
  remember(folder, { main: { at: now(), result } })
  if (!result.problem) return
  const { title, detail } = split(result.problem)
  recordStudioError(folder, 'git', 'Checking GitHub’s main', title, detail, result.output ?? '')
}

export function sawFix(folder: string, what: string, result: FixResult): void {
  remember(folder, { fix: { at: now(), what, result } })
  if (result.ok) return
  const { title, detail } = result.problem ? { title: result.problem.title, detail: result.problem.detail } : split(result.message)
  recordStudioError(folder, 'git', what, title, detail, result.output ?? '')
}

/** Something the release helper couldn't do at all (it threw). */
export function sawFailure(folder: string, kind: StudioErrorKind, step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  // Not problems with the app: a double click, or a request that wasn't allowed.
  if (message === 'busy' || message === 'Not allowed' || /already doing something/.test(message)) return
  recordStudioError(folder, kind, step, split(message).title, split(message).detail)
}

/** Only for tests. */
export function resetStudioErrorsForTests(): void {
  cache = null
  memory.clear()
  appNames.clear()
}
