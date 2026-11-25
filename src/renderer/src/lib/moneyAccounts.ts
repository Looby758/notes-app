import type { Account, AccountKind, Balance, Iou, MoneyData, MoneyEntry, NetWorthPoint } from './money'

/**
 * Accounts, net worth over time, and IOUs. Your main current account is the balance you tell the
 * forecast (it follows what you log and import after that day); the others (savings, cash, a credit
 * card) are balances you type in now and then. Everything stays in money.json on this computer.
 */

export const ACCOUNT_KINDS: { kind: AccountKind; name: string; emoji: string }[] = [
  { kind: 'current', name: 'Current account', emoji: '🏦' },
  { kind: 'savings', name: 'Savings', emoji: '🐷' },
  { kind: 'cash', name: 'Cash', emoji: '💷' },
  { kind: 'credit', name: 'Credit card', emoji: '💳' },
  { kind: 'other', name: 'Other', emoji: '📦' }
]

export const kindInfo = (kind: AccountKind): { name: string; emoji: string } => ACCOUNT_KINDS.find((k) => k.kind === kind) ?? ACCOUNT_KINDS[4]

/** Your current account now: the balance you said, plus anything logged or imported after that day. */
export function balanceNow(entries: MoneyEntry[], balance: Balance, today: string): number {
  const since = balance.date < today ? balance.date : today
  return entries.filter((e) => e.date > since && e.date <= today).reduce((sum, e) => sum + (e.income ? e.amount : -e.amount), balance.amount)
}

/** What's still owed on an IOU. */
export const iouLeft = (i: Pick<Iou, 'amount' | 'paid'>): number => Math.max(0, i.amount - i.paid)

export const openIous = (ious: Iou[]): Iou[] => ious.filter((i) => !i.settled && iouLeft(i) > 0)

export interface IouTotals {
  owedToYou: number
  youOwe: number
}

export function iouTotals(ious: Iou[]): IouTotals {
  const t: IouTotals = { owedToYou: 0, youOwe: 0 }
  for (const i of openIous(ious)) {
    if (i.theyOwe) t.owedToYou += iouLeft(i)
    else t.youOwe += iouLeft(i)
  }
  return t
}

/** Each person's balance with you: positive when they owe you overall, negative when you owe them. Biggest first. */
export function byPerson(ious: Iou[]): { person: string; net: number; ious: Iou[] }[] {
  const people = new Map<string, { person: string; net: number; ious: Iou[] }>()
  for (const i of openIous(ious)) {
    const key = i.person.trim().toLowerCase()
    const p = people.get(key) ?? { person: i.person.trim(), net: 0, ious: [] }
    p.net += i.theyOwe ? iouLeft(i) : -iouLeft(i)
    p.ious.push(i)
    people.set(key, p)
  }
  return [...people.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.localeCompare(b.person))
}

export interface NetWorth {
  /** Your main current account now, or null when you haven't told Orbit its balance. */
  current: number | null
  /** Each other account and what's in it. */
  accounts: { account: Account; amount: number }[]
  /** Everything in your accounts, minus credit cards. */
  inAccounts: number
  owedToYou: number
  youOwe: number
  /** inAccounts + owedToYou - youOwe */
  total: number
  /** Whether there's anything to add up yet. */
  any: boolean
}

export function netWorth(data: Pick<MoneyData, 'entries' | 'balance' | 'accounts' | 'ious'>, today: string): NetWorth {
  const current = data.balance ? balanceNow(data.entries, data.balance, today) : null
  const accounts = data.accounts.map((account) => ({ account, amount: account.amount }))
  const inAccounts = (current ?? 0) + accounts.reduce((n, a) => n + a.amount, 0)
  const { owedToYou, youOwe } = iouTotals(data.ious)
  return {
    current,
    accounts,
    inAccounts,
    owedToYou,
    youOwe,
    total: inAccounts + owedToYou - youOwe,
    any: current !== null || accounts.length > 0
  }
}

/** Keeps at most this many days of history (a little over five years). */
const MAX_POINTS = 2000

/** Today's total, written over any earlier one for today. Returns the same array when nothing changed. */
export function recordNetWorth(history: NetWorthPoint[], today: string, total: number): NetWorthPoint[] {
  const last = history[history.length - 1]
  if (last?.date === today) return last.total === total ? history : [...history.slice(0, -1), { date: today, total }]
  if (last && last.date > today) return history // the clock went backwards: leave it be
  return [...history, { date: today, total }].slice(-MAX_POINTS)
}

const DAY = 86_400_000
const time = (day: string): number => new Date(`${day}T12:00:00Z`).getTime()
export const daysBetween = (from: string, to: string): number => Math.round((time(to) - time(from)) / DAY)
export const addDays = (day: string, n: number): string => new Date(time(day) + n * DAY).toISOString().slice(0, 10)

/** The points from `days` ago up to today (all of them for 0), starting with the last one before that if there is one. */
export function historyFor(history: NetWorthPoint[], today: string, days: number): NetWorthPoint[] {
  if (!days) return history
  const from = addDays(today, -days)
  const i = history.findIndex((p) => p.date >= from)
  if (i < 0) return history.slice(-1)
  return history.slice(Math.max(0, i - 1))
}

/** How much the total moved over the last `days` days (null when there's no point that old). */
export function changeOver(history: NetWorthPoint[], today: string, days: number, now: number): number | null {
  const from = addDays(today, -days)
  const before = [...history].reverse().find((p) => p.date <= from)
  return before ? now - before.total : null
}

/** Splits a bill evenly between `people` people, to the penny: the odd pennies go to the first shares. */
export function splitEvenly(total: number, people: number): number[] {
  const n = Math.max(1, Math.floor(people))
  const base = Math.floor(total / n)
  const extra = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/** "Sam, Jo and Alex" from what was typed ("Sam, Jo and Alex" or "Sam & Jo"), without repeats. */
export function readNames(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/,|&|\band\b|\+|\n/i)
    .map((n) => n.trim())
    .filter((n) => n && !/^(me|myself|i)$/i.test(n))
    .filter((n) => {
      const k = n.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/** IOUs whose reminder day has come and that haven't been reminded about for that day. */
export const dueIouReminders = (ious: Iou[], today: string): Iou[] =>
  openIous(ious).filter((i) => i.remind && i.remind <= today && i.reminded !== i.remind)

/** A friendly nudge to paste into a message: "Hey Sam, just a reminder about the £8.50 for the takeaway 🙂". */
export function nudgeText(person: string, ious: Iou[], formatPounds: (p: number) => string): string {
  const owed = ious.filter((i) => i.theyOwe)
  const total = owed.reduce((n, i) => n + iouLeft(i), 0)
  const fors = owed.map((i) => i.note.trim()).filter(Boolean)
  const joined = fors.length > 1 ? `${fors.slice(0, -1).join(', ')} and ${fors[fors.length - 1]}` : (fors[0] ?? '')
  // "Takeaway" reads better as "takeaway" mid-sentence; "KFC" stays as it is.
  const what = joined ? ` for ${/^[A-Z][a-z]/.test(joined) ? joined[0].toLowerCase() + joined.slice(1) : joined}` : ''
  return `Hey ${person}, just a reminder about the ${formatPounds(total)}${what} 🙂`
}
