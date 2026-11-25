import { appMatches, NOT_READY } from '@shared/claudeDesktop'
import type { BoardItem } from '@shared/appStudio'
import { deleteItem, updateItem, useAppBoard } from '../../store/appBoard'
import { useAppStudio } from '../../store/appStudio'
import { useTerminals } from '../../store/terminals'
import { num, str, type Answer, type Args } from './common'

/**
 * More of App Studio for Claude Desktop: editing and deleting cards, pull requests, releases,
 * bug reports, running an app's tests, getting the latest code and checking its packages.
 * Merging or closing a pull request always asks the user in Orbit first.
 */

interface App {
  name: string
  folder: string
  repo?: string
}

function apps(): App[] {
  const info = useAppStudio.getState().info
  const seen = new Set<string>()
  return useTerminals
    .getState()
    .projects.filter((p) => !seen.has(p.folder) && seen.add(p.folder))
    .map((p) => ({ name: p.name, folder: p.folder, repo: info[p.folder]?.repo }))
}

function findApp(want: string): App {
  const all = apps()
  const found = all.filter((a) => appMatches(want, a))
  if (found.length === 1) return found[0]
  if (!all.length) throw new Error('App Studio has no apps yet.')
  if (found.length > 1) throw new Error(`More than one app is called “${want}”. Use its GitHub repository (owner/name).`)
  throw new Error(`App Studio has no app called “${want}”. Its apps are: ${all.map((a) => (a.repo ? `${a.name} (${a.repo})` : a.name)).join(', ')}.`)
}

function repoOf(want: string): string {
  const app = findApp(want)
  if (!app.repo) throw new Error(`${app.name} isn’t on GitHub, so it has no pull requests, releases or bug reports.`)
  return app.repo
}

const short = (text: string, max = 600): string => {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

// ---------- cards ----------

function card(id: string): BoardItem {
  const s = useAppBoard.getState()
  if (!s.loaded) throw new Error(NOT_READY)
  const item = s.items.find((i) => i.id === id)
  if (!item) throw new Error(`There’s no card with the id “${id}”. Use get_board for the ids.`)
  return item
}

function editCardFor(args: Args): string {
  const item = card(str(args.id))
  const patch: Partial<Pick<BoardItem, 'title' | 'details' | 'kind'>> = {}
  if (str(args.title).trim()) patch.title = str(args.title).trim().slice(0, 200)
  if (typeof args.details === 'string') patch.details = args.details.trimEnd().slice(0, 10_000)
  if (args.kind === 'idea' || args.kind === 'bug') patch.kind = args.kind
  if (!Object.keys(patch).length) throw new Error('Say what to change: the title, the details or the kind.')
  const next = updateItem(item.id, patch)!
  return `Changed the card “${next.title}”.`
}

function deleteCardFor(args: Args): string {
  const item = card(str(args.id))
  deleteItem(item.id)
  return `Deleted the card “${item.title}”.`
}

// ---------- GitHub ----------

async function pullsFor(args: Args): Promise<string> {
  const repos = str(args.app) ? [repoOf(str(args.app))] : [...new Set(apps().map((a) => a.repo).filter((r): r is string => !!r))]
  if (!repos.length) return 'None of the apps are on GitHub.'
  const { pulls, errors } = await window.api.appsPulls(repos)
  const lines = pulls.map((p) => `${p.repo}#${p.number}: ${p.title}${p.draft ? ' (draft)' : ''}\n  by ${p.author}, ${p.branch} → ${p.base}, ${p.url}${p.additions !== undefined ? `, +${p.additions} −${p.deletions ?? 0} in ${p.changedFiles ?? '?'} files` : ''}${p.body.trim() ? `\n  ${short(p.body, 400).replace(/\n/g, '\n  ')}` : ''}`)
  const problems = Object.entries(errors).map(([repo, e]) => `${repo}: couldn’t check (${e})`)
  return [...(lines.length ? lines : ['No open pull requests.']), ...problems].join('\n')
}

async function pullAction(args: Args, action: 'merge' | 'close'): Promise<string> {
  const repo = repoOf(str(args.app))
  const number = Math.round(num(args.number, 0))
  if (number <= 0) throw new Error('Say the pull request’s number.')
  const ok = await window.api.confirm({
    message: action === 'merge' ? `Merge pull request #${number} into ${repo}?` : `Close pull request #${number} in ${repo} without merging?`,
    detail: `Claude asked to ${action} it.${action === 'merge' ? ' Its changes go into the main code.' : ''}`,
    ok: action === 'merge' ? 'Merge' : 'Close it',
    type: 'warning'
  })
  if (!ok) return `The user chose not to ${action} #${number}.`
  if (action === 'merge') {
    const r = await window.api.appsMerge(repo, number)
    return `Merged ${repo}#${number}${r.markedReady ? ' (it was a draft, so it was marked ready first)' : ''}.`
  }
  await window.api.appsClose(repo, number)
  return `Closed ${repo}#${number}.`
}

async function releasesFor(args: Args): Promise<string> {
  const repo = repoOf(str(args.app))
  const list = (await window.api.appsReleases(repo)).slice(0, Math.min(30, num(args.limit, 5)))
  if (!list.length) return `${repo} has no releases yet.`
  return list.map((r) => `${r.tag}${r.name && r.name !== r.tag ? ` “${r.name}”` : ''}: ${r.date.slice(0, 10)}${r.draft ? ', draft' : ''}${r.prerelease ? ', pre-release' : ''}${r.downloads !== undefined ? `, ${r.downloads} downloads` : ''}\n  ${r.url}${r.body.trim() ? `\n  ${short(r.body).replace(/\n/g, '\n  ')}` : ''}`).join('\n')
}

async function bugReportsFor(args: Args): Promise<string> {
  const repo = repoOf(str(args.app))
  const list = await window.api.appsIssues(repo)
  if (!list.length) return `${repo} has no open bug reports.`
  return list.map((b) => `#${b.number}: ${b.title} (by ${b.author}, ${b.createdAt.slice(0, 10)}${b.labels.length ? `, ${b.labels.join(', ')}` : ''}${b.comments ? `, ${b.comments} comments` : ''})\n  ${b.url}${b.body.trim() ? `\n  ${short(b.body).replace(/\n/g, '\n  ')}` : ''}`).join('\n')
}

async function closeBugFor(args: Args): Promise<string> {
  const repo = repoOf(str(args.app))
  const number = Math.round(num(args.number, 0))
  if (number <= 0) throw new Error('Say the bug report’s number.')
  await window.api.appsCloseIssue(repo, number, str(args.comment).trim() || undefined)
  return `Closed bug report ${repo}#${number}${str(args.comment).trim() ? ' with the comment' : ''}.`
}

// ---------- on this computer ----------

async function runTestsFor(args: Args): Promise<string> {
  const app = findApp(str(args.app))
  const check = await window.api.appsReleaseTests(app.folder)
  return `${app.name}: ${check.state === 'pass' ? 'passed' : check.state === 'fail' ? 'failed' : check.state}. ${check.text}${check.output && check.state !== 'pass' ? `\n\n${check.output.slice(-12_000)}` : ''}`
}

async function latestFor(args: Args): Promise<string> {
  const app = findApp(str(args.app))
  const r = await window.api.appsGetLatestMain(app.folder)
  return `${app.name}: ${r.message}${!r.ok && r.output ? `\n\n${r.output.slice(-6000)}` : ''}`
}

async function healthFor(args: Args): Promise<string> {
  const app = findApp(str(args.app))
  const h = await window.api.appsHealth(app.folder)
  const lines = [
    ...h.outdated.map((p) => `Outdated: ${p.name} ${p.current ?? '(not installed)'} → ${p.latest}${p.wanted !== p.latest ? ` (${p.wanted} is allowed now)` : ''}`),
    ...h.security.map((s) => `Security (${s.severity}): ${s.name}: ${s.title}${s.easyFix ? ' (npm audit fix can fix it)' : ''}${s.url ? ` ${s.url}` : ''}`),
    ...h.problems.map((p) => `Couldn’t check: ${p}`)
  ]
  return lines.length ? `${app.name}:\n${lines.join('\n')}` : `${app.name}: every package is up to date, with no security warnings.`
}

export const STUDIO_ANSWERS: Record<string, Answer> = {
  edit_card: editCardFor,
  delete_card: deleteCardFor,
  get_pull_requests: pullsFor,
  merge_pull_request: (args) => pullAction(args, 'merge'),
  close_pull_request: (args) => pullAction(args, 'close'),
  get_releases: releasesFor,
  get_bug_reports: bugReportsFor,
  close_bug_report: closeBugFor,
  run_tests: runTestsFor,
  get_latest_code: latestFor,
  check_packages: healthFor
}
