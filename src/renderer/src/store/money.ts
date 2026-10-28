import { create } from 'zustand'
import {
  emptyMoney,
  merchantKey,
  newId,
  readMoney,
  OTHER,
  OTHER_INCOME,
  type MoneyCategory,
  type MoneyData,
  type MoneyEntry
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
  const { categories, entries, budgets, rules } = useMoney.getState()
  window.api
    .writeAppData(FILE, JSON.stringify({ categories, entries, budgets, rules }, null, 2))
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
