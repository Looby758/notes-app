import { create } from 'zustand'
import type { AppInfo, GitHubStatus, PullRequest } from '@shared/appStudio'
import { useTerminals } from './terminals'

/**
 * App Studio's state: what each app's folder says (git and package.json), the open pull requests
 * on their GitHub repositories, and whether GitHub is connected. The apps themselves are the
 * Terminal tab's projects (store/terminals), so an app added in either place shows in both.
 */

interface AppStudioState {
  section: 'apps' | 'pulls'
  /** By folder. */
  info: Record<string, AppInfo>
  pulls: PullRequest[]
  /** Pull request errors, by repository. */
  pullErrors: Record<string, string>
  github: GitHubStatus | null
  loadingApps: boolean
  loadingPulls: boolean
  /** When the pull requests were last fetched (ms), so they aren't fetched on every visit. */
  pullsAt: number
}

export const useAppStudio = create<AppStudioState>(() => ({
  section: 'apps',
  info: {},
  pulls: [],
  pullErrors: {},
  github: null,
  loadingApps: false,
  loadingPulls: false,
  pullsAt: 0
}))

export function setSection(section: AppStudioState['section']): void {
  useAppStudio.setState({ section })
}

/** Reads every app's folder again. */
export async function refreshApps(): Promise<void> {
  const folders = [...new Set(useTerminals.getState().projects.map((p) => p.folder))]
  useAppStudio.setState({ loadingApps: true })
  try {
    const results = await Promise.all(folders.map((f) => window.api.appsInfo(f).catch((err) => ({ ok: false, error: String(err?.message ?? err) }) as AppInfo)))
    useAppStudio.setState({ info: Object.fromEntries(folders.map((f, i) => [f, results[i]])) })
  } finally {
    useAppStudio.setState({ loadingApps: false })
  }
}

/** The GitHub repositories of the apps ("owner/name"). */
export const appRepos = (info: Record<string, AppInfo>): string[] =>
  [...new Set(Object.values(info).map((i) => i.repo).filter((r): r is string => !!r))]

/** Fetches the open pull requests on the apps' repositories (after reading the apps, if not done yet). */
export async function refreshPulls(): Promise<void> {
  if (!Object.keys(useAppStudio.getState().info).length) await refreshApps()
  const repos = appRepos(useAppStudio.getState().info)
  useAppStudio.setState({ loadingPulls: true })
  try {
    const { pulls, errors } = repos.length ? await window.api.appsPulls(repos) : { pulls: [], errors: {} }
    useAppStudio.setState({ pulls, pullErrors: errors, pullsAt: Date.now() })
  } finally {
    useAppStudio.setState({ loadingPulls: false })
  }
}

export async function refreshGithub(): Promise<void> {
  useAppStudio.setState({ github: await window.api.appsGithubStatus() })
}

export function setGithub(github: GitHubStatus): void {
  useAppStudio.setState({ github })
}

/** Takes a pull request off the list (merged or closed). */
export function dropPull(repo: string, number: number): void {
  useAppStudio.setState((s) => ({ pulls: s.pulls.filter((p) => !(p.repo === repo && p.number === number)) }))
}
