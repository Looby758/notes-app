import { create } from 'zustand'
import type { AppInfo, GitHubStatus, PullRequest, TestCopy } from '@shared/appStudio'
import { useTerminals } from './terminals'
import { syncPulls } from './appBoard'

/**
 * App Studio's state: what each app's folder says (git and package.json), the open pull requests
 * on their GitHub repositories, and whether GitHub is connected. The apps themselves are the
 * Terminal tab's projects (store/terminals), so an app added in either place shows in both.
 */

interface AppStudioState {
  section: 'apps' | 'pulls' | 'board' | 'releases' | 'shots'
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
  /** Each app's test copies, by the app's folder. */
  copies: Record<string, TestCopy[]>
  /** What each test copy is (its branch and pull request), by its folder. Kept on this computer, like the copies. */
  copyInfo: Record<string, CopyInfo>
  /** Test copies being made, by "folder|branch". */
  making: Record<string, boolean>
}

export interface CopyInfo {
  branch: string
  /** "#12 Dark mode", or the branch. */
  label: string
  repo?: string
  number?: number
  created: string
}

const COPY_KEY = 'appstudio:copies'
const readCopyInfo = (): Record<string, CopyInfo> => {
  try {
    return JSON.parse(localStorage.getItem(COPY_KEY) ?? '{}') as Record<string, CopyInfo>
  } catch {
    return {}
  }
}

export const useAppStudio = create<AppStudioState>(() => ({
  section: 'apps',
  info: {},
  pulls: [],
  pullErrors: {},
  github: null,
  loadingApps: false,
  loadingPulls: false,
  pullsAt: 0,
  copies: {},
  copyInfo: readCopyInfo(),
  making: {}
}))

function saveCopyInfo(copyInfo: Record<string, CopyInfo>): void {
  useAppStudio.setState({ copyInfo })
  try {
    localStorage.setItem(COPY_KEY, JSON.stringify(copyInfo))
  } catch {
    // Not remembered: the copy still works, it just shows its folder name.
  }
}

export async function refreshCopies(folder: string): Promise<void> {
  const list = await window.api.appsCopies(folder).catch(() => [] as TestCopy[])
  useAppStudio.setState((s) => ({ copies: { ...s.copies, [folder]: list } }))
}

/** Makes (or finds) a test copy of an app with a pull request's branch in it; its folder. */
export async function makeCopy(folder: string, branch: string, info: Omit<CopyInfo, 'branch' | 'created'>): Promise<string> {
  const key = `${folder}|${branch}`
  useAppStudio.setState((s) => ({ making: { ...s.making, [key]: true } }))
  try {
    const path = await window.api.appsAddCopy(folder, branch)
    const known = useAppStudio.getState().copyInfo
    saveCopyInfo({ ...known, [path]: { ...info, branch, created: known[path]?.created ?? new Date().toISOString() } })
    await refreshCopies(folder)
    return path
  } finally {
    useAppStudio.setState((s) => {
      const making = { ...s.making }
      delete making[key]
      return { making }
    })
  }
}

export async function removeCopy(folder: string, path: string): Promise<void> {
  await window.api.appsRemoveCopy(folder, path)
  const copyInfo = { ...useAppStudio.getState().copyInfo }
  delete copyInfo[path]
  saveCopyInfo(copyInfo)
  await refreshCopies(folder)
}

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
    void Promise.all(folders.map(refreshCopies))
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
    const { info } = useAppStudio.getState()
    void syncPulls(pulls, errors, (repo) => {
      const names = useTerminals
        .getState()
        .projects.filter((p) => info[p.folder]?.repo === repo)
        .map((p) => p.name)
      return names.length ? { keys: [repo, ...names] } : null
    })
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
