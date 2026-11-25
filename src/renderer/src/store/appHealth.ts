import { create } from 'zustand'
import type { HealthReport } from '@shared/appStudio'
import { errorMessage } from '../lib/paths'

/**
 * App Studio's health check: each app's last report (newer versions of its packages, and known
 * security problems), by the app's folder. The reports are kept on this computer, so a card shows
 * the last check until you check again.
 */

interface AppHealthState {
  reports: Record<string, HealthReport>
  checking: Record<string, boolean>
  errors: Record<string, string>
}

const KEY = 'appstudio:health'

function read(): Record<string, HealthReport> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, HealthReport>) : {}
  } catch {
    return {}
  }
}

export const useAppHealth = create<AppHealthState>(() => ({ reports: read(), checking: {}, errors: {} }))

export async function checkHealth(folder: string): Promise<void> {
  useAppHealth.setState((s) => ({ checking: { ...s.checking, [folder]: true }, errors: { ...s.errors, [folder]: '' } }))
  try {
    const report = await window.api.appsHealth(folder)
    const reports = { ...useAppHealth.getState().reports, [folder]: report }
    useAppHealth.setState({ reports })
    try {
      localStorage.setItem(KEY, JSON.stringify(reports))
    } catch {
      // Only shown until Orbit closes.
    }
  } catch (err) {
    useAppHealth.setState((s) => ({ errors: { ...s.errors, [folder]: errorMessage(err) } }))
  } finally {
    useAppHealth.setState((s) => ({ checking: { ...s.checking, [folder]: false } }))
  }
}
