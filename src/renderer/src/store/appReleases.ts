import { create } from 'zustand'
import { addDownloadDay, type DownloadHistory, type MergedPull, type Release } from '@shared/appStudio'
import { errorMessage } from '../lib/paths'

/**
 * App Studio's Releases tab: each app's releases on GitHub, the pull requests merged since the
 * last one, and the "What's new" notes being written for the next one (kept while Orbit is open).
 */

interface RepoReleases {
  releases: Release[]
  merged: MergedPull[]
  error?: string
  at: number
}

interface AppReleasesState {
  /** The app picked (its key: repository or name). */
  app: string | null
  byRepo: Record<string, RepoReleases>
  loading: Record<string, boolean>
  /** Notes being written, by repository. */
  notes: Record<string, string>
  /** Each app's total downloads, noted once a day (kept on this computer), by repository. */
  history: Record<string, DownloadHistory>
}

const HISTORY_KEY = 'appstudio:downloads'
function readHistory(): Record<string, DownloadHistory> {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, DownloadHistory>) : {}
  } catch {
    return {}
  }
}

export const useAppReleases = create<AppReleasesState>(() => ({ app: null, byRepo: {}, loading: {}, notes: {}, history: readHistory() }))

/** All of an app's downloads: every published release added up. */
export const totalDownloads = (releases: Release[]): number => releases.filter((r) => !r.draft).reduce((n, r) => n + (r.downloads ?? 0), 0)

/** Today on this computer, "2026-11-22". */
export function downloadDay(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function noteDownloads(repo: string, releases: Release[]): void {
  if (!releases.some((r) => r.files?.length)) return
  const { history } = useAppReleases.getState()
  const next = { ...history, [repo]: addDownloadDay(history[repo] ?? [], downloadDay(), totalDownloads(releases)) }
  useAppReleases.setState({ history: next })
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // Only the week and month totals miss out.
  }
}

export const setReleasesApp = (app: string): void => useAppReleases.setState({ app })

export function setNotes(repo: string, text: string): void {
  useAppReleases.setState((s) => ({ notes: { ...s.notes, [repo]: text } }))
}

/** The last published release (not a draft). */
export const lastRelease = (releases: Release[]): Release | undefined => releases.find((r) => !r.draft)

/** Reads a repository's releases, then the pull requests merged since the last one. */
export async function loadReleases(repo: string): Promise<void> {
  useAppReleases.setState((s) => ({ loading: { ...s.loading, [repo]: true } }))
  let next: RepoReleases
  try {
    const releases = await window.api.appsReleases(repo)
    const merged = await window.api.appsMerged(repo, lastRelease(releases)?.date)
    next = { releases, merged, at: Date.now() }
    noteDownloads(repo, releases)
  } catch (err) {
    next = { releases: [], merged: [], error: errorMessage(err), at: Date.now() }
  }
  useAppReleases.setState((s) => ({ byRepo: { ...s.byRepo, [repo]: next }, loading: { ...s.loading, [repo]: false } }))
}

export function putRelease(repo: string, release: Release): void {
  useAppReleases.setState((s) => {
    const cur = s.byRepo[repo]
    if (!cur) return {}
    const releases = cur.releases.some((r) => r.tag === release.tag) ? cur.releases.map((r) => (r.tag === release.tag ? release : r)) : [release, ...cur.releases]
    return { byRepo: { ...s.byRepo, [repo]: { ...cur, releases } } }
  })
}
