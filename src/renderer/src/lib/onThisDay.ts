import { dayKey } from './dates'

export interface EarlierDay {
  key: string
  /** "1 month ago", "2 years ago" */
  label: string
}

/**
 * The same date in earlier months (1–11 months back) and years (1–10 years back), most recent
 * first. Dates that don't exist (31 April, 29 February outside leap years) are skipped.
 */
export function earlierDays(date: Date, years = 10): EarlierDay[] {
  const out: EarlierDay[] = []
  const d = date.getDate()
  for (let m = 1; m <= 11; m++) {
    const then = new Date(date.getFullYear(), date.getMonth() - m, d)
    if (then.getDate() !== d) continue
    out.push({ key: dayKey(then), label: m === 1 ? '1 month ago' : `${m} months ago` })
  }
  for (let y = 1; y <= years; y++) {
    const then = new Date(date.getFullYear() - y, date.getMonth(), d)
    if (then.getDate() !== d) continue
    out.push({ key: dayKey(then), label: y === 1 ? '1 year ago' : `${y} years ago` })
  }
  return out
}
