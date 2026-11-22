import { create } from 'zustand'
import { imageUrls, pullKey, reportCard, type BugReport } from '@shared/appStudio'
import { addItem } from './appBoard'
import { errorMessage } from '../lib/paths'

/**
 * Bug reports from people using your apps: the open issues on each app's GitHub repository, shown
 * above its board until you add one to the board (pictures and all) or hide it.
 */

interface AppReportsState {
  byRepo: Record<string, { reports: BugReport[]; error?: string; at: number }>
  loading: Record<string, boolean>
  /** Reports hidden from the board's list ("owner/name#7"), kept on this computer. */
  hidden: string[]
}

const HIDDEN_KEY = 'appstudio:hiddenReports'

function readHidden(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const useAppReports = create<AppReportsState>(() => ({ byRepo: {}, loading: {}, hidden: readHidden() }))

export async function loadReports(repo: string): Promise<void> {
  if (useAppReports.getState().loading[repo]) return
  useAppReports.setState((s) => ({ loading: { ...s.loading, [repo]: true } }))
  let next: AppReportsState['byRepo'][string]
  try {
    next = { reports: await window.api.appsIssues(repo), at: Date.now() }
  } catch (err) {
    next = { reports: useAppReports.getState().byRepo[repo]?.reports ?? [], error: errorMessage(err), at: Date.now() }
  }
  useAppReports.setState((s) => ({ byRepo: { ...s.byRepo, [repo]: next }, loading: { ...s.loading, [repo]: false } }))
}

export function hideReport(report: BugReport): void {
  const hidden = [...useAppReports.getState().hidden, pullKey(report.repo, report.number)].slice(-500)
  useAppReports.setState({ hidden })
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden))
  } catch {
    // Shows again next time.
  }
}

/** Puts a report on the app's board as a bug (or idea), with the pictures in it saved to your attachments. */
export async function addReportToBoard(report: BugReport, appKey: string, folder: string): Promise<void> {
  const pictures: string[] = []
  for (const url of imageUrls(report.body).slice(0, 6)) {
    try {
      const { bytes, type } = await window.api.appsFetchImage(url)
      const ext = type.includes('jpeg') ? 'jpg' : type.includes('gif') ? 'gif' : type.includes('webp') ? 'webp' : 'png'
      pictures.push(await window.api.saveAttachment(folder, `report-${report.number}-${pictures.length + 1}-${Date.now().toString(36)}.${ext}`, bytes))
    } catch {
      // The card still has the link to the report.
    }
  }
  const card = reportCard(report)
  addItem(appKey, card.kind, card.title, card.details, { pictures, issue: pullKey(report.repo, report.number) })
}

export async function closeReport(report: BugReport, comment?: string): Promise<void> {
  await window.api.appsCloseIssue(report.repo, report.number, comment)
  useAppReports.setState((s) => {
    const cur = s.byRepo[report.repo]
    if (!cur) return {}
    return { byRepo: { ...s.byRepo, [report.repo]: { ...cur, reports: cur.reports.filter((r) => r.number !== report.number) } } }
  })
}
