/**
 * The budget tracker: how much each spending category may use in a month (with changes over time,
 * one-month amounts and rollover), how much is used and left, the pace you're spending at, and
 * suggestions from what you usually spend. Pure functions over MoneyData; amounts are whole pence.
 */
import { addMonths, budgetState, monthTotals, OTHER, type BudgetSettings, type BudgetState, type MoneyCategory, type MoneyData, type MoneyEntry } from './money'

type BudgetData = Pick<MoneyData, 'budgets' | 'budget'>

/** The furthest back rollover looks, so a very old start month can't make this slow. */
const MAX_ROLLOVER_MONTHS = 120

/** The category's own budget for `month` (before rollover), or 0 for none. */
export function limitFor(data: BudgetData, category: string, month: string): number {
  const once = data.budget.months[month]?.[category]
  if (once !== undefined) return once
  const steps = data.budget.history[category]
  if (!steps?.length) return data.budgets[category] ?? 0
  let found = 0
  for (const [from, pence] of steps) if (from <= month) found = pence
  return found
}

/**
 * What rolls into `month` for a rollover category: each earlier month's budget minus what was spent,
 * from the month rollover started. Overspending carries too (it's taken off). Months without a
 * budget are skipped.
 */
export function carryInto(data: BudgetData, entries: MoneyEntry[], category: string, month: string, spentIn?: (m: string) => number): number {
  const start = data.budget.rollover[category]
  if (!start || start >= month) return 0
  const spent = spentIn ?? spentBy(entries, category)
  let m = start
  const earliest = addMonths(month, -MAX_ROLLOVER_MONTHS)
  if (m < earliest) m = earliest
  let carry = 0
  for (; m < month; m = addMonths(m, 1)) {
    const limit = limitFor(data, category, m)
    if (limit > 0) carry += limit - spent(m)
  }
  return carry
}

/** Spent in one category, by month ("YYYY-MM"), worked out once. */
function spentBy(entries: MoneyEntry[], category: string): (month: string) => number {
  const by = new Map<string, number>()
  for (const e of entries) if (!e.income && e.category === category) by.set(e.date.slice(0, 7), (by.get(e.date.slice(0, 7)) ?? 0) + e.amount)
  return (m) => by.get(m) ?? 0
}

export interface BudgetRow {
  cat: MoneyCategory
  /** This month's own budget. */
  limit: number
  /** Rolled in from earlier months (negative after overspending). 0 when rollover is off. */
  carry: number
  rollover: boolean
  /** limit + carry: what you can spend this month. */
  available: number
  spent: number
  /** available - spent (negative when over). */
  left: number
  state: BudgetState
  /** Set only for the current month: the share of the month gone (0–1). */
  pace?: number
  /** At the current rate, what this category will have used by the end of the month (current month only). */
  projected?: number
  /** Spending faster than the month is going, enough to go over by the end (current month only, not already over). */
  ahead?: boolean
  /** Only this month has this amount. */
  once: boolean
}

export interface BudgetMonth {
  month: string
  rows: BudgetRow[]
  /** Spending categories without a budget this month, with what was spent in each (largest first). */
  unbudgeted: { cat: MoneyCategory; spent: number }[]
  available: number
  spent: number
  left: number
  /** Days left in the month including today (current month only). */
  daysLeft?: number
  /** What you can spend each day for the rest of the month and stay within budget (current month only, 0 when none left). */
  perDay?: number
}

export const daysInMonth = (month: string): number => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/**
 * Every spending category with a budget in `month`, what's used and left, plus the ones without one.
 * `today` (YYYY-MM-DD) decides the pace and per-day figures when it falls in `month`.
 */
export function budgetMonth(data: Pick<MoneyData, 'budgets' | 'budget' | 'categories' | 'entries'>, month: string, today: string): BudgetMonth {
  const totals = monthTotals(data.entries, month)
  const spending = data.categories.filter((c) => !c.income)
  // Entries whose category was deleted on another computer count under Other, as elsewhere.
  const known = new Set(spending.map((c) => c.id))
  const spentIn = (id: string): number =>
    (totals.byCategory.get(id) ?? 0) + (id === OTHER ? [...totals.byCategory].filter(([c]) => !known.has(c)).reduce((n, [, v]) => n + v, 0) : 0)
  const current = today.slice(0, 7) === month
  const days = daysInMonth(month)
  const day = current ? Number(today.slice(8, 10)) : 0
  const pace = current ? day / days : undefined

  const rows: BudgetRow[] = []
  const unbudgeted: BudgetMonth['unbudgeted'] = []
  for (const cat of spending) {
    const limit = limitFor(data, cat.id, month)
    const rollover = !!data.budget.rollover[cat.id]
    const spent = spentIn(cat.id)
    if (limit <= 0) {
      if (spent > 0) unbudgeted.push({ cat, spent })
      continue
    }
    const carry = carryInto(data, data.entries, cat.id, month)
    const available = limit + carry
    const state = budgetState(spent, available, data.budget.warnAt)
    const row: BudgetRow = { cat, limit, carry, rollover, available, spent, left: available - spent, state, once: data.budget.months[month]?.[cat.id] !== undefined }
    if (pace !== undefined) {
      row.pace = pace
      // A few days in, one big shop isn't a trend: only call it fast from the 4th on.
      row.projected = day > 0 ? Math.round((spent / day) * days) : spent
      row.ahead = state !== 'over' && day >= 4 && day < days && row.projected > available
    }
    rows.push(row)
  }
  unbudgeted.sort((a, b) => b.spent - a.spent)
  const available = rows.reduce((n, r) => n + r.available, 0)
  const spent = rows.reduce((n, r) => n + r.spent, 0)
  const out: BudgetMonth = { month, rows, unbudgeted, available, spent, left: available - spent }
  if (current) {
    out.daysLeft = days - day + 1
    out.perDay = Math.max(0, Math.floor(out.left / out.daysLeft))
  }
  return out
}

/**
 * A budget to suggest for a category: the average of the last three months before `month` that had
 * any spending in it, rounded up to the next £5. 0 when there's nothing to go on.
 */
export function suggestBudget(entries: MoneyEntry[], category: string, month: string): number {
  const spent = spentBy(entries, category)
  const months: number[] = []
  for (let i = 1; i <= 12 && months.length < 3; i++) {
    const p = spent(addMonths(month, -i))
    if (p > 0) months.push(p)
  }
  if (!months.length) return 0
  const avg = months.reduce((a, b) => a + b, 0) / months.length
  return Math.ceil(avg / 500) * 500
}

export interface BudgetHistoryCell {
  month: string
  available: number
  spent: number
  state: BudgetState | 'none'
}

/** The last `count` months before `month` (oldest first) for one category: what it had, used, and how it went. */
export function budgetHistory(data: Pick<MoneyData, 'budgets' | 'budget' | 'entries'>, category: string, month: string, count = 6): BudgetHistoryCell[] {
  const spent = spentBy(data.entries, category)
  const out: BudgetHistoryCell[] = []
  for (let i = count; i >= 1; i--) {
    const m = addMonths(month, -i)
    const limit = limitFor(data, category, m)
    const s = spent(m)
    if (limit <= 0) {
      out.push({ month: m, available: 0, spent: s, state: 'none' })
      continue
    }
    const available = limit + carryInto(data, data.entries, category, m, spent)
    out.push({ month: m, available, spent: s, state: budgetState(s, available, data.budget.warnAt) })
  }
  return out
}

/**
 * The budget settings after setting a category's budget to `pence` (0 for none) from `from` on.
 * Months before `from` keep what they had; later steps are replaced. A budget set before there was
 * any history is kept as the amount for all earlier months.
 */
export function withBudgetFrom(data: BudgetData, category: string, pence: number, from: string): BudgetSettings['history'] {
  const old = data.budget.history[category] ?? (data.budgets[category] ? ([['0000-01', data.budgets[category]]] as [string, number][]) : [])
  const kept = old.filter(([m]) => m < from)
  const steps: [string, number][] = [...kept, [from, Math.max(0, Math.round(pence))]]
  // Drop steps that change nothing (a leading "no budget", or the same amount again), so it stays short.
  const tidy: [string, number][] = []
  for (const s of steps) if (s[1] !== (tidy.length ? tidy[tidy.length - 1][1] : 0)) tidy.push(s)
  const history = { ...data.budget.history }
  if (tidy.length) history[category] = tidy
  else delete history[category]
  return history
}

/**
 * Which budgets just got worse because of new spending: categories whose state went from ok to near,
 * or to over, between `before` and `after` (both the same month).
 */
export function budgetWarnings(before: BudgetMonth, after: BudgetMonth): BudgetRow[] {
  const rank: Record<BudgetState, number> = { ok: 0, near: 1, over: 2 }
  const was = new Map(before.rows.map((r) => [r.cat.id, r.state]))
  return after.rows.filter((r) => rank[r.state] > rank[was.get(r.cat.id) ?? 'ok'])
}
