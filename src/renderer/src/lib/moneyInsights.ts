import { looksLikeSubscription, merchantKey, monthTotals, OTHER, type Balance, type MoneyData, type MoneyEntry, type RepeatInterval, type SavingsGoal } from './money'

/**
 * Working things out from your money entries, all on your computer:
 *   - repeating payments (subscriptions and bills) and paydays, with when the next one is due
 *   - where the month is heading at the rate you're spending
 *   - how much to put aside each week for a savings goal
 */

export type Interval = RepeatInterval

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
  /** Only one payment so far, but it's to a subscription: probably one you've just started. */
  fresh?: boolean
  /** Set for one you added yourself: its id in MoneyData.subscriptions. */
  manual?: string
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

/** How a payment is grouped with others from the same payee. */
export const payeeKey = (note: string): string => merchantKey(note) || note.toLowerCase().trim()

/** A one-off payment that is still worth listing: to a subscription (by its category, or a well-known name). */
const subscriptionLike = (e: MoneyEntry): boolean => e.category === 'subscriptions' || (e.category === OTHER && looksLikeSubscription(e.note))

/** One payment missed (plus a few days' grace for the bank) and it has probably stopped. */
const GRACE = 10 * DAY

/**
 * Payments that repeat: the same payee at a steady interval for roughly the same amount. Monthly
 * ones need 2 payments, weekly ones 3. A single recent payment to a subscription (NOW, Netflix…)
 * counts too, as a new monthly one. Ones you've said aren't repeating are left out, and so are
 * ones that seem to have stopped (a payment missed).
 */
export function findRecurring(entries: MoneyEntry[], today: string, ignore: readonly string[] = []): Recurring[] {
  const groups = new Map<string, MoneyEntry[]>()
  for (const e of entries) {
    const key = `${e.income ? '+' : '-'}${payeeKey(e.note)}`
    if (key.length < 3) continue
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  const out: Recurring[] = []
  const now = toTime(today)
  for (const [k, list] of groups) {
    const key = k.slice(1)
    if (ignore.includes(key)) continue
    list.sort((a, b) => a.date.localeCompare(b.date))
    // One payment per day at most (a refund and re-charge on one day is one payment).
    const days = list.filter((e, i) => i === 0 || e.date !== list[i - 1].date)
    const last = days[days.length - 1]
    const known = !last.income && days.some(subscriptionLike)
    let interval: Interval | null
    if (days.length === 1) {
      // Just started: one payment to a subscription, nothing to measure a gap from yet.
      if (!known || last.date > today) continue
      interval = 'monthly'
    } else {
      const gaps = days.slice(1).map((e, i) => Math.round((toTime(e.date) - toTime(days[i].date)) / DAY))
      interval = intervalOf(gaps)
      if (!interval || (interval === 'weekly' && days.length < 3)) continue
      const amounts = days.map((e) => e.amount)
      const typical = median(amounts)
      // Bills move a bit (energy, phone); a one-off of the same shop at a wildly different price isn't the same thing.
      // Subscriptions often start cheap (a £1 first month) or go up, so their price isn't held against them.
      if (!known && !amounts.slice(-3).every((a) => Math.abs(a - typical) <= Math.max(typical * 0.35, 200))) continue
    }
    let next = step(last.date, interval)
    if (now > toTime(next) + GRACE) continue
    while (toTime(next) < now) next = step(next, interval)
    out.push({
      key,
      name: last.note || key,
      income: last.income,
      amount: last.amount,
      interval,
      category: last.category,
      last: last.date,
      next,
      count: days.length,
      ...(days.length === 1 ? { fresh: true } : {})
    })
  }
  return out.sort((a, b) => a.next.localeCompare(b.next))
}

/** One you added yourself, with its last and next payment worked out from the date you gave. */
function manualRecurring(s: MoneyData['subscriptions'][number], today: string): Recurring {
  let last = ''
  let next = s.date
  for (let i = 0; i < 5000 && next < today; i++) {
    last = next
    next = step(next, s.interval)
  }
  return { key: payeeKey(s.name), name: s.name, income: false, amount: s.amount, interval: s.interval, category: s.category, last, next, count: 0, manual: s.id }
}

/**
 * Everything repeating, as the Money page, Home, the calendar and Ask everything show it: what the
 * statements show, minus the ones you cancelled (until they charge you again), plus the ones you
 * added yourself (which win over a found one for the same payee).
 */
export function allRecurring(
  data: Pick<MoneyData, 'entries' | 'notRecurring' | 'subscriptions' | 'cancelled'>,
  today: string
): Recurring[] {
  const mine = data.subscriptions.map((s) => manualRecurring(s, today))
  const taken = new Set(mine.map((r) => r.key))
  const found = findRecurring(data.entries, today, data.notRecurring).filter((r) => {
    if (r.income) return true
    if (taken.has(r.key)) return false
    const cancelledOn = data.cancelled[r.key]
    return !cancelledOn || r.last > cancelledOn
  })
  return [...found, ...mine].sort((a, b) => a.next.localeCompare(b.next))
}

/** Found subscriptions you cancelled that have charged you again since: worth a warning. */
export function chargedAfterCancelling(recurring: Recurring[], cancelled: Record<string, string>): Recurring[] {
  return recurring.filter((r) => !r.income && !r.manual && cancelled[r.key] && r.last > cancelled[r.key])
}

/** What a repeating payment costs a month on average. */
export function monthlyCost(r: Pick<Recurring, 'amount' | 'interval'>): number {
  return Math.round(r.interval === 'weekly' ? (r.amount * 52) / 12 : r.interval === 'yearly' ? r.amount / 12 : r.amount)
}

/** Every date a repeating payment falls on between two days (inclusive), for the calendar. */
export function occurrences(r: Pick<Recurring, 'next' | 'interval'>, from: string, to: string): string[] {
  const out: string[] = []
  let d = r.next
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
  /** With a balance you entered: about what's in your account today (that balance plus what's come in and gone out since). */
  balanceNow?: number
}

/**
 * Where this month is heading: what's in and out so far, the bills and pay still due, and
 * everyday spending at the pace you've been going (repeating payments not counted in the pace).
 */
export function forecastMonth(entries: MoneyEntry[], recurring: Recurring[], today: string, balance: Balance | null = null): Forecast {
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
    .filter((e) => !e.income && e.date.startsWith(month) && e.date <= today && !repeating.has(payeeKey(e.note)))
    .reduce((sum, e) => sum + e.amount, 0)
  const everydayLeft = Math.round((everydaySoFar / Math.max(1, d)) * daysLeft)
  const still = payDue - billsDue - everydayLeft
  if (balance) {
    // Your balance, plus anything logged after the day it was right on, then what's still to come.
    const since = balance.date < today ? balance.date : today
    const balanceNow = entries
      .filter((e) => e.date > since && e.date <= today)
      .reduce((sum, e) => sum + (e.income ? e.amount : -e.amount), balance.amount)
    return { received, spent, billsDue, payDue, everydayLeft, endOfMonth: balanceNow + still, daysLeft, balanceNow }
  }
  return { received, spent, billsDue, payDue, everydayLeft, endOfMonth: received - spent + still, daysLeft }
}

/** How much to put aside each week to reach a goal by its date (null without a date, or once it's reached). */
export function weeklyToGoal(goal: Pick<SavingsGoal, 'target' | 'saved' | 'due'>, today: string): number | null {
  const left = goal.target - goal.saved
  if (left <= 0 || !goal.due) return null
  const weeks = Math.max(1, Math.ceil((toTime(goal.due) - toTime(today)) / (7 * DAY)))
  return Math.ceil(left / weeks)
}
