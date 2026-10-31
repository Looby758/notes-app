import { merchantKey, monthTotals, type MoneyEntry, type SavingsGoal } from './money'

/**
 * Working things out from your money entries, all on your computer:
 *   - repeating payments (subscriptions and bills) and paydays, with when the next one is due
 *   - where the month is heading at the rate you're spending
 *   - how much to put aside each week for a savings goal
 */

export type Interval = 'weekly' | 'monthly' | 'yearly'

export interface Recurring {
  /** merchantKey of the payee, used to say "not a subscription". */
  key: string
  /** Name as it appeared most recently. */
  name: string
  income: boolean
  /** The latest amount, in pence. */
  amount: number
  interval: Interval
  category: string
  /** YYYY-MM-DD */
  last: string
  next: string
  count: number
}

const DAY = 86400000
const toTime = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromTime = (t: number): string => new Date(t).toISOString().slice(0, 10)

/** The same day N months on (31 Jan + 1 month → 28/29 Feb). */
function addMonthsTo(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return fromTime(Date.UTC(y, m - 1 + n, Math.min(d, last)))
}

function step(key: string, interval: Interval): string {
  if (interval === 'weekly') return fromTime(toTime(key) + 7 * DAY)
  return addMonthsTo(key, interval === 'monthly' ? 1 : 12)
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Which repeat a set of gaps (in days) looks like, if any. */
function intervalOf(gaps: number[]): Interval | null {
  if (!gaps.length) return null
  const g = median(gaps)
  const fits = (lo: number, hi: number): boolean => gaps.every((x) => x >= lo && x <= hi)
  if (g >= 6 && g <= 8 && fits(5, 9)) return 'weekly'
  if (g >= 26 && g <= 35 && fits(24, 38)) return 'monthly'
  if (g >= 350 && g <= 380 && fits(340, 390)) return 'yearly'
  return null
}

/**
 * Payments that repeat: the same payee at a steady interval for roughly the same amount. Monthly
 * ones need 2 payments, weekly ones 3. Ones you've said aren't repeating are left out, and so are
 * ones that seem to have stopped (a payment missed).
 */
export function findRecurring(entries: MoneyEntry[], today: string, ignore: readonly string[] = []): Recurring[] {
  const groups = new Map<string, MoneyEntry[]>()
  for (const e of entries) {
    const key = `${e.income ? '+' : '-'}${merchantKey(e.note) || e.note.toLowerCase().trim()}`
    if (key.length < 3) continue
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  const out: Recurring[] = []
  const now = toTime(today)
  for (const [k, list] of groups) {
    const key = k.slice(1)
    if (ignore.includes(key) || list.length < 2) continue
    list.sort((a, b) => a.date.localeCompare(b.date))
    // One payment per day at most (a refund and re-charge on one day is one payment).
    const days = list.filter((e, i) => i === 0 || e.date !== list[i - 1].date)
    const gaps = days.slice(1).map((e, i) => Math.round((toTime(e.date) - toTime(days[i].date)) / DAY))
    const interval = intervalOf(gaps)
    if (!interval || (interval === 'weekly' && days.length < 3)) continue
    const amounts = days.map((e) => e.amount)
    const typical = median(amounts)
    // Bills move a bit (energy, phone); a one-off of the same shop at a wildly different price isn't the same thing.
    if (!amounts.slice(-3).every((a) => Math.abs(a - typical) <= Math.max(typical * 0.35, 200))) continue
    const last = days[days.length - 1]
    let next = step(last.date, interval)
    // One payment missed (plus a few days' grace) and it has probably stopped.
    if (now > toTime(next) + 10 * DAY) continue
    while (toTime(next) < now) next = step(next, interval)
    out.push({ key, name: last.note || key, income: last.income, amount: last.amount, interval, category: last.category, last: last.date, next, count: days.length })
  }
  return out.sort((a, b) => a.next.localeCompare(b.next))
}

/** What a repeating payment costs a month on average. */
export function monthlyCost(r: Pick<Recurring, 'amount' | 'interval'>): number {
  return Math.round(r.interval === 'weekly' ? (r.amount * 52) / 12 : r.interval === 'yearly' ? r.amount / 12 : r.amount)
}

/** Every date a repeating payment falls on between two days (inclusive), for the calendar. */
export function occurrences(r: Pick<Recurring, 'last' | 'interval'>, from: string, to: string): string[] {
  const out: string[] = []
  let d = step(r.last, r.interval)
  for (let i = 0; i < 2000 && d <= to; i++) {
    if (d >= from) out.push(d)
    d = step(d, r.interval)
  }
  return out
}

export interface Forecast {
  /** What's come in and gone out so far this month. */
  received: number
  spent: number
  /** Repeating payments still to come this month. */
  billsDue: number
  /** Expected pay still to come this month. */
  payDue: number
  /** Day-to-day spending likely in the rest of the month, at this month's pace. */
  everydayLeft: number
  /** Money in minus money out by the end of the month (negative: you'd be short). */
  endOfMonth: number
  daysLeft: number
}

/**
 * Where this month is heading: what's in and out so far, the bills and pay still due, and
 * everyday spending at the pace you've been going (repeating payments not counted in the pace).
 */
export function forecastMonth(entries: MoneyEntry[], recurring: Recurring[], today: string): Forecast {
  const month = today.slice(0, 7)
  const { spent, received } = monthTotals(entries, month)
  const [y, m, d] = today.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const daysLeft = daysInMonth - d
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`
  const tomorrow = fromTime(toTime(today) + DAY)
  let billsDue = 0
  let payDue = 0
  for (const r of recurring) {
    const n = tomorrow <= monthEnd ? occurrences(r, tomorrow, monthEnd).length : 0
    if (r.income) payDue += n * r.amount
    else billsDue += n * r.amount
  }
  // Everyday pace: this month's spending without the repeating payments.
  const repeating = new Set(recurring.filter((r) => !r.income).map((r) => r.key))
  const everydaySoFar = entries
    .filter((e) => !e.income && e.date.startsWith(month) && e.date <= today && !repeating.has(merchantKey(e.note) || e.note.toLowerCase().trim()))
    .reduce((sum, e) => sum + e.amount, 0)
  const everydayLeft = Math.round((everydaySoFar / Math.max(1, d)) * daysLeft)
  return { received, spent, billsDue, payDue, everydayLeft, endOfMonth: received + payDue - spent - billsDue - everydayLeft, daysLeft }
}

/** How much to put aside each week to reach a goal by its date (null without a date, or once it's reached). */
export function weeklyToGoal(goal: Pick<SavingsGoal, 'target' | 'saved' | 'due'>, today: string): number | null {
  const left = goal.target - goal.saved
  if (left <= 0 || !goal.due) return null
  const weeks = Math.max(1, Math.ceil((toTime(goal.due) - toTime(today)) / (7 * DAY)))
  return Math.ceil(left / weeks)
}
