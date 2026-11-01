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
import { recordUndo } from '../lib/undo'

/**
 * The money tracker. Saved in the vault (.notesapp/money.json) so it follows your notes to other
 * computers via Google Drive.
 */
export const useMoney = create<MoneyData & { loaded: boolean }>(() => ({ ...emptyMoney(), loaded: false }))

const FILE = 'money.json'

/** Bumped when money.json is read again (another notes folder, say): older undo steps no longer fit. */
let generation = 0

export async function loadMoney(): Promise<void> {
  generation++
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

function write(change: Partial<MoneyData>): void {
  useMoney.setState(change)
  persist()
}

/**
 * Makes a change, which Ctrl+Z (outside a text box) can undo, named by `label`. Changes with the
 * same `mergeKey` a moment apart (typing a goal's name) undo as one.
 */
function save(change: Partial<MoneyData>, label: string, mergeKey?: string): void {
  const state = useMoney.getState()
  const before = Object.fromEntries(Object.keys(change).map((k) => [k, state[k as keyof MoneyData]])) as Partial<MoneyData>
  const at = generation
  const swap = (to: Partial<MoneyData>) => (): void => {
    if (at !== generation) throw new Error('Your money tracker was reloaded since, so that can’t be undone.')
    write(to)
  }
  write(change)
  recordUndo({ label, mergeKey: mergeKey && `money:${mergeKey}`, undo: swap(before), redo: swap(change) })
}

const named = (text: string | undefined, fallback: string): string => (text?.trim() ? `“${text.trim()}”` : fallback)

/** Remembers the category picked for an imported row's shop, so its next visit is sorted the same way. */
function learn(rules: Record<string, string>, entry: MoneyEntry, category: string): Record<string, string> {
  if (!entry.importKey) return rules
  const key = merchantKey(entry.note)
  return key ? { ...rules, [key]: category } : rules
}

export function addEntry(entry: Omit<MoneyEntry, 'id'>): void {
  save({ entries: [...useMoney.getState().entries, { ...entry, id: newId() }] }, `Added ${named(entry.note, 'an entry')}`)
}

export function updateEntry(id: string, change: Partial<Omit<MoneyEntry, 'id'>>): void {
  const { entries, rules } = useMoney.getState()
  const old = entries.find((e) => e.id === id)
  if (!old) return
  save({
    entries: entries.map((e) => (e.id === id ? { ...e, ...change } : e)),
    rules: change.category && change.category !== old.category ? learn(rules, old, change.category) : rules
  }, `Changed ${named(old.note, 'an entry')}`)
}

export function deleteEntry(id: string): MoneyEntry | undefined {
  const { entries } = useMoney.getState()
  const gone = entries.find((e) => e.id === id)
  if (!gone) return undefined
  save({ entries: entries.filter((e) => e.id !== id) }, `Deleted ${named(gone.note, 'an entry')}`)
  return gone
}

/** Adds statement rows; the categories you chose are remembered for those shops. */
export function importEntries(rows: Omit<MoneyEntry, 'id'>[], picked: Record<string, string>): void {
  const { entries, rules } = useMoney.getState()
  save({ entries: [...entries, ...rows.map((r) => ({ ...r, id: newId() }))], rules: { ...rules, ...picked } }, `Imported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`)
}

export function setBudget(category: string, pence: number): void {
  const budgets = { ...useMoney.getState().budgets }
  if (pence > 0) budgets[category] = pence
  else delete budgets[category]
  save({ budgets }, 'Changed a budget', `budget:${category}`)
}

export function addCategory(category: Omit<MoneyCategory, 'id'>): void {
  save({ categories: [...useMoney.getState().categories, { ...category, id: newId() }] }, `Added the ${named(category.name, 'new')} category`)
}

export function updateCategory(id: string, change: Partial<Omit<MoneyCategory, 'id' | 'income'>>): void {
  const cat = useMoney.getState().categories.find((c) => c.id === id)
  save({ categories: useMoney.getState().categories.map((c) => (c.id === id ? { ...c, ...change } : c)) }, `Changed the ${named(cat?.name, 'unnamed')} category`, `category:${id}`)
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
  }, `Deleted the ${named(cat.name, 'unnamed')} category`)
}

/** Makes sure money.json has been read (other pages and Ctrl+K can add things before Money is opened). */
export async function ensureMoney(): Promise<void> {
  if (!useMoney.getState().loaded) await loadMoney()
}

// ---------- savings goals ----------

export function addGoal(goal: Omit<SavingsGoal, 'id' | 'color' | 'saved'> & { saved?: number }): SavingsGoal {
  const { goals } = useMoney.getState()
  const made: SavingsGoal = { saved: 0, ...goal, id: newId(), color: CATEGORY_COLORS[goals.length % CATEGORY_COLORS.length] }
  save({ goals: [...goals, made] }, `Added the ${named(made.name, 'new')} goal`)
  return made
}

export function updateGoal(id: string, change: Partial<Omit<SavingsGoal, 'id'>>): void {
  const goal = useMoney.getState().goals.find((g) => g.id === id)
  save({ goals: useMoney.getState().goals.map((g) => (g.id === id ? { ...g, ...change } : g)) }, `Changed ${named(goal?.name, 'a goal')}`, `goal:${id}:${Object.keys(change).sort().join(',')}`)
}

/** Puts money into (or takes it out of) a goal. */
export function addToGoal(id: string, pence: number): void {
  const goal = useMoney.getState().goals.find((g) => g.id === id)
  save({ goals: useMoney.getState().goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, g.saved + pence) } : g)) }, `${pence < 0 ? 'Took money out of' : 'Put money into'} ${named(goal?.name, 'a goal')}`)
}

export function deleteGoal(id: string): void {
  const goal = useMoney.getState().goals.find((g) => g.id === id)
  save({ goals: useMoney.getState().goals.filter((g) => g.id !== id) }, `Deleted ${named(goal?.name, 'a goal')}`)
}

/** "That isn't a subscription": stops listing a repeating payment. */
export function setNotRecurring(key: string, not = true): void {
  const list = useMoney.getState().notRecurring.filter((k) => k !== key)
  save({ notRecurring: not ? [...list, key] : list }, not ? 'Marked a payment as not repeating' : 'Listed a repeating payment again')
}

// ---------- subscriptions you manage yourself ----------

/** Adds a subscription or bill the statements haven't shown (yet). */
export function addSubscription(sub: Omit<ManualSubscription, 'id'>): ManualSubscription {
  const made: ManualSubscription = { ...sub, id: newId() }
  save({ subscriptions: [...useMoney.getState().subscriptions, made] }, `Added ${named(made.name, 'a subscription')}`)
  return made
}

export function updateSubscription(id: string, change: Partial<Omit<ManualSubscription, 'id'>>): void {
  const sub = useMoney.getState().subscriptions.find((s) => s.id === id)
  save({ subscriptions: useMoney.getState().subscriptions.map((s) => (s.id === id ? { ...s, ...change } : s)) }, `Changed ${named(sub?.name, 'a subscription')}`, `sub:${id}:${Object.keys(change).sort().join(',')}`)
}

export function deleteSubscription(id: string): ManualSubscription | undefined {
  const { subscriptions } = useMoney.getState()
  const gone = subscriptions.find((s) => s.id === id)
  if (!gone) return undefined
  save({ subscriptions: subscriptions.filter((s) => s.id !== id) }, `Removed ${named(gone.name, 'a subscription')}`)
  return gone
}

/** "I've cancelled this": stops listing a found subscription until it charges you again after `on`. Pass null to undo. */
export function setCancelled(key: string, on: string | null): void {
  const { [key]: _old, ...rest } = useMoney.getState().cancelled
  save({ cancelled: on ? { ...rest, [key]: on } : rest }, on ? 'Marked a subscription cancelled' : 'Listed a subscription again')
}

// ---------- your real balance ----------

/** What's in your account right now (pence, negative if overdrawn), or null to go back to statements only. */
export function setBalance(balance: Balance | null): void {
  save({ balance }, balance ? 'Set your balance' : 'Cleared your balance')
}
