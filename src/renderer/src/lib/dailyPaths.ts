import type { Prefs } from '@shared/prefs'
import { dayKey, formatDate, parseDate } from './dates'
import { usePrefs } from '../store/prefs'

/** Daily notes live at <daily folder>/<date in your format>.md, e.g. Daily/2026-10-26.md. */
export function dailyPath(date: Date, prefs: Prefs = usePrefs.getState().prefs): string {
  const name = formatDate(date, prefs.dailyFormat)
  return `${prefs.dailyFolder ? prefs.dailyFolder + '/' : ''}${name}.md`
}

/** The day a note is the daily note for (as a day key), or null if it isn't one. */
export function dailyDateOf(path: string, prefs: Prefs = usePrefs.getState().prefs): string | null {
  const prefix = prefs.dailyFolder ? prefs.dailyFolder + '/' : ''
  if (!path.startsWith(prefix) || !/\.md$/i.test(path)) return null
  const date = parseDate(path.slice(prefix.length, -3), prefs.dailyFormat)
  return date ? dayKey(date) : null
}
