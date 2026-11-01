import { create } from 'zustand'
import {
  emptyMoney,
  merchantKey,
  newId,
  readMoney,
  OTHER,
  OTHER_INCOME,
  type Balance,
  type ManualSubscription,
  type MoneyCategory,
  type MoneyData,
  type MoneyEntry,
  type SavingsGoal,
  CATEGORY_COLORS
} from '../lib/money'
import { notify } from './notify'

/**
 * The money tracker. Saved in the vault (.notesapp/money.json) so it follows your notes to other
 * computers via Google Drive.
 */
export const useMoney = create<MoneyData & { loaded: boolean }>(() => ({ ...emptyMoney(), loaded: false }))

const FILE = 'money.json'

export async function loadMoney(): Promise<void> {
  useMoney.setState({ ...emptyMoney(), loaded: false })
  try {
    useMoney.setState({ ...readMoney(await window.api.readAppData(FILE)), loaded: true })
  } catch {
    // unreadable file: start empty rather than failing
    useMoney.setState({ loaded: true })
  }
}

let writing = false
let again = false

/** Writes the file, one write at a time. */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  const { categories, entries, budgets, rules, goals, notRecurring, subscriptions, cancelled, balance } = useMoney.getState()
  window.api
    .writeAppData(FILE, JSON.stringify({ categories, entries, budgets, rules, goals, notRecurring, subscriptions, cancelled, balance }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function save(change: Partial<MoneyData>): void {
  useMoney.setState(change)
  persist()
}

/** Remembers the category picked for an imported row's shop, so its next visit is sorted the same way. */
function learn(rules: Record<string, string>, entry: MoneyEntry, category: string): Record<string, string> {
  if (!entry.importKey) return rules
  const key = merchantKey(entry.note)
  return key ? { ...rules, [key]: category } : rules
}

export function addEntry(entry: Omit<MoneyEntry, 'id'>): void {
  save({ entries: [...useMoney.getState().entries, { ...entry, id: newId() }] })
}

export function updateEntry(id: string, change: Partial<Omit<MoneyEntry, 'id'>>): void {
  const { entries, rules } = useMoney.getState()
  const old = entries.find((e) => e.id === id)
  if (!old) return
  save({
    entries: entries.map((e) => (e.id === id ? { ...e, ...change } : e)),
    rules: change.category && change.category !== old.category ? learn(rules, old, change.category) : rules
  })
}

export function deleteEntry(id: string): MoneyEntry | undefined {
  const { entries } = useMoney.getState()
  const gone = entries.find((e) => e.id === id)
  save({ entries: entries.filter((e) => e.id !== id) })
  return gone
}

/** Puts back an entry that was just deleted. */
export function restoreEntry(entry: MoneyEntry): void {
  save({ entries: [...useMoney.getState().entries, entry] })
}

/** Adds statement rows; the categories you chose are remembered for those shops. */
export function importEntries(rows: Omit<MoneyEntry, 'id'>[], picked: Record<string, string>): void {
  const { entries, rules } = useMoney.getState()
  save({ entries: [...entries, ...rows.map((r) => ({ ...r, id: newId() }))], rules: { ...rules, ...picked } })
}

export function setBudget(category: string, pence: number): void {
  const budgets = { ...useMoney.getState().budgets }
  if (pence > 0) budgets[category] = pence
  else delete budgets[category]
  save({ budgets })
}

export function addCategory(category: Omit<MoneyCategory, 'id'>): void {
  save({ categories: [...useMoney.getState().categories, { ...category, id: newId() }] })
}

export function updateCategory(id: string, change: Partial<Omit<MoneyCategory, 'id' | 'income'>>): void {
  save({ categories: useMoney.getState().categories.map((c) => (c.id === id ? { ...c, ...change } : c)) })
}

/** Deletes a category; its entries move to Other (or Other income). */
export function deleteCategory(id: string): void {
  if (id === OTHER || id === OTHER_INCOME) return
  const { categories, entries, budgets, rules } = useMoney.getState()
  const cat = categories.find((c) => c.id === id)
  if (!cat) return
  const to = cat.income ? OTHER_INCOME : OTHER
  const { [id]: _gone, ...rest } = budgets
  save({
    categories: categories.filter((c) => c.id !== id),
    entries: entries.map((e) => (e.category === id ? { ...e, category: to } : e)),
    budgets: rest,
    rules: Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== id))
  })
}

/** Makes sure money.json has been read (other pages and Ctrl+K can add things before Money is opened). */
export async function ensureMoney(): Promise<void> {
  if (!useMoney.getState().loaded) await loadMoney()
}

// ---------- savings goals ----------

export function addGoal(goal: Omit<SavingsGoal, 'id' | 'color' | 'saved'> & { saved?: number }): SavingsGoal {
  const { goals } = useMoney.getState()
  const made: SavingsGoal = { saved: 0, ...goal, id: newId(), color: CATEGORY_COLORS[goals.length % CATEGORY_COLORS.length] }
  save({ goals: [...goals, made] })
  return made
}

export function updateGoal(id: string, change: Partial<Omit<SavingsGoal, 'id'>>): void {
  save({ goals: useMoney.getState().goals.map((g) => (g.id === id ? { ...g, ...change } : g)) })
}

/** Puts money into (or takes it out of) a goal. */
export function addToGoal(id: string, pence: number): void {
  save({ goals: useMoney.getState().goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, g.saved + pence) } : g)) })
}

export function deleteGoal(id: string): void {
  save({ goals: useMoney.getState().goals.filter((g) => g.id !== id) })
}

/** "That isn't a subscription": stops listing a repeating payment. */
export function setNotRecurring(key: string, not = true): void {
  const list = useMoney.getState().notRecurring.filter((k) => k !== key)
  save({ notRecurring: not ? [...list, key] : list })
}

// ---------- subscriptions you manage yourself ----------

/** Adds a subscription or bill the statements haven't shown (yet). */
export function addSubscription(sub: Omit<ManualSubscription, 'id'>): ManualSubscription {
  const made: ManualSubscription = { ...sub, id: newId() }
  save({ subscriptions: [...useMoney.getState().subscriptions, made] })
  return made
}

export function updateSubscription(id: string, change: Partial<Omit<ManualSubscription, 'id'>>): void {
  save({ subscriptions: useMoney.getState().subscriptions.map((s) => (s.id === id ? { ...s, ...change } : s)) })
}

export function deleteSubscription(id: string): ManualSubscription | undefined {
  const { subscriptions } = useMoney.getState()
  const gone = subscriptions.find((s) => s.id === id)
  save({ subscriptions: subscriptions.filter((s) => s.id !== id) })
  return gone
}

/** Puts back one that was just removed. */
export function restoreSubscription(sub: ManualSubscription): void {
  save({ subscriptions: [...useMoney.getState().subscriptions.filter((s) => s.id !== sub.id), sub] })
}

/** "I've cancelled this": stops listing a found subscription until it charges you again after `on`. Pass null to undo. */
export function setCancelled(key: string, on: string | null): void {
  const { [key]: _old, ...rest } = useMoney.getState().cancelled
  save({ cancelled: on ? { ...rest, [key]: on } : rest })
}

// ---------- your real balance ----------

/** What's in your account right now (pence, negative if overdrawn), or null to go back to statements only. */
export function setBalance(balance: Balance | null): void {
  save({ balance })
}
