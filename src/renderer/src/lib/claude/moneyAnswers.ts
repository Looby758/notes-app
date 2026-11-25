import {
  addAccount,
  addCategory,
  addEntry,
  addGoal,
  addIous,
  addSubscription,
  addToGoal,
  deleteEntry,
  deleteGoal,
  deleteSubscription,
  ensureMoney,
  payBackIou,
  setBalance,
  setBudget,
  setCancelled,
  updateAccount,
  updateEntry,
  updateGoal,
  useMoney
} from '../../store/money'
import { CATEGORY_COLORS, formatPounds, OTHER, OTHER_INCOME, type AccountKind, type MoneyCategory, type MoneyEntry, type RepeatInterval } from '../money'
import { iouLeft, openIous } from '../moneyAccounts'
import { allRecurring } from '../moneyInsights'
import { dayKey } from '../dates'
import { has, needNotes, num, pence, pickOne, str, type Answer, type Args } from './common'

/**
 * Money for Claude Desktop: adding, finding, changing and deleting what was spent, budgets,
 * savings goals, who owes who, subscriptions and balances. Every change can be undone in Orbit.
 */

const today = (): string => dayKey(new Date())
const isDay = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v)

async function money(): Promise<ReturnType<typeof useMoney.getState>> {
  needNotes()
  await ensureMoney()
  return useMoney.getState()
}

function categoryFor(want: string, income: boolean): MoneyCategory {
  const all = useMoney.getState().categories
  const side = all.filter((c) => !!c.income === income)
  if (!want.trim()) return side.find((c) => c.id === (income ? OTHER_INCOME : OTHER)) ?? side[0]
  return pickOne(side, want, (c) => c.name, income ? 'money-in category' : 'spending category')
}

const catName = (id: string): string => useMoney.getState().categories.find((c) => c.id === id)?.name ?? id
const entryLine = (e: MoneyEntry): string => `id ${e.id}: ${e.date} ${e.income ? '+' : '-'}${formatPounds(e.amount)} ${catName(e.category)}${e.note ? `, “${e.note}”` : ''}`

async function addEntryFor(args: Args): Promise<string> {
  await money()
  const income = args.type === 'received'
  const amount = Math.abs(pence(args.amount))
  if (!amount) throw new Error('The amount can’t be 0.')
  const date = str(args.date) || today()
  if (!isDay(date)) throw new Error('The date has to be like 2026-11-25.')
  const cat = categoryFor(str(args.category), income)
  addEntry({ date, amount, income, category: cat.id, note: str(args.note).trim().slice(0, 200) })
  return `Added: ${date} ${income ? 'received' : 'spent'} ${formatPounds(amount)} (${cat.name})${str(args.note) ? `, “${str(args.note).trim()}”` : ''}. Ctrl+Z in Orbit undoes it.`
}

async function findEntriesFor(args: Args): Promise<string> {
  const m = await money()
  const q = str(args.search).trim().toLowerCase()
  const from = str(args.from)
  const to = str(args.to)
  const cat = str(args.category).trim()
  const catIds = cat ? new Set(m.categories.filter((c) => c.name.toLowerCase().includes(cat.toLowerCase())).map((c) => c.id)) : null
  const list = m.entries
    .filter((e) => (!q || e.note.toLowerCase().includes(q)) && (!from || e.date >= from) && (!to || e.date <= to) && (!catIds || catIds.has(e.category)))
    .sort((a, b) => b.date.localeCompare(a.date))
  if (!list.length) return 'No entries match.'
  const limit = Math.min(300, num(args.limit, 50))
  const spent = list.filter((e) => !e.income).reduce((t, e) => t + e.amount, 0)
  const got = list.filter((e) => e.income).reduce((t, e) => t + e.amount, 0)
  return `${list.length} entr${list.length === 1 ? 'y' : 'ies'}: ${formatPounds(spent)} out, ${formatPounds(got)} in.\n${list.slice(0, limit).map(entryLine).join('\n')}${list.length > limit ? `\n…and ${list.length - limit} more.` : ''}`
}

async function entryById(args: Args): Promise<MoneyEntry> {
  const m = await money()
  const e = m.entries.find((x) => x.id === str(args.id))
  if (!e) throw new Error(`There’s no entry with the id “${str(args.id)}”. Use find_money_entries for the ids.`)
  return e
}

async function editEntryFor(args: Args): Promise<string> {
  const e = await entryById(args)
  const change: Partial<Omit<MoneyEntry, 'id'>> = {}
  if (has(args, 'amount')) change.amount = Math.abs(pence(args.amount))
  if (has(args, 'type')) change.income = args.type === 'received'
  const income = change.income ?? e.income
  if (has(args, 'category') || change.income !== undefined) change.category = categoryFor(str(args.category), income).id
  if (has(args, 'note')) change.note = str(args.note).trim().slice(0, 200)
  if (has(args, 'date')) {
    if (!isDay(str(args.date))) throw new Error('The date has to be like 2026-11-25.')
    change.date = str(args.date)
  }
  updateEntry(e.id, change)
  return `Changed it to: ${entryLine({ ...e, ...change })}. Ctrl+Z in Orbit undoes it.`
}

async function deleteEntryFor(args: Args): Promise<string> {
  const e = await entryById(args)
  deleteEntry(e.id)
  return `Deleted ${entryLine(e)}. Ctrl+Z in Orbit brings it back.`
}

async function setBudgetFor(args: Args): Promise<string> {
  await money()
  const cat = categoryFor(str(args.category), false)
  const amount = Math.max(0, pence(args.amount))
  setBudget(cat.id, amount)
  return amount ? `The ${cat.name} budget is now ${formatPounds(amount)} a month.` : `Took the budget off ${cat.name}.`
}

async function addCategoryFor(args: Args): Promise<string> {
  const m = await money()
  const name = str(args.name).trim().slice(0, 40)
  if (!name) throw new Error('Say the category’s name.')
  if (m.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return `There’s already a ${name} category.`
  addCategory({ name, color: CATEGORY_COLORS[m.categories.length % CATEGORY_COLORS.length], ...(args.income === true ? { income: true } : {}) })
  return `Added the ${name} category.`
}

// ---------- savings goals ----------

const pickGoal = (want: string) => pickOne(useMoney.getState().goals, want, (g) => g.name, 'savings goal')

async function addGoalFor(args: Args): Promise<string> {
  await money()
  const name = str(args.name).trim().slice(0, 60)
  if (!name) throw new Error('Say what it’s for.')
  const target = pence(args.target, 'target')
  if (target <= 0) throw new Error('The target has to be more than 0.')
  const due = str(args.due)
  if (due && !isDay(due)) throw new Error('The date has to be like 2027-06-01.')
  const g = addGoal({ name, target, due, saved: has(args, 'saved') ? Math.max(0, pence(args.saved)) : 0 })
  return `Added the goal ${g.name}: ${formatPounds(g.saved)} of ${formatPounds(g.target)}${due ? ` by ${due}` : ''}.`
}

async function goalMoneyFor(args: Args): Promise<string> {
  await money()
  const g = pickGoal(str(args.goal))
  const amount = pence(args.amount)
  addToGoal(g.id, amount)
  const now = useMoney.getState().goals.find((x) => x.id === g.id)!
  return `${amount < 0 ? 'Took' : 'Put'} ${formatPounds(Math.abs(amount))} ${amount < 0 ? 'out of' : 'into'} ${g.name}: ${formatPounds(now.saved)} of ${formatPounds(now.target)} now.`
}

async function editGoalFor(args: Args): Promise<string> {
  await money()
  const g = pickGoal(str(args.goal))
  const change: Parameters<typeof updateGoal>[1] = {}
  if (has(args, 'name')) change.name = str(args.name).trim().slice(0, 60) || g.name
  if (has(args, 'target')) change.target = Math.max(1, pence(args.target, 'target'))
  if (has(args, 'due')) {
    const due = str(args.due)
    if (due && !isDay(due)) throw new Error('The date has to be like 2027-06-01, or empty for no date.')
    change.due = due
  }
  updateGoal(g.id, change)
  return `Changed the ${g.name} goal.`
}

async function deleteGoalFor(args: Args): Promise<string> {
  await money()
  const g = pickGoal(str(args.goal))
  deleteGoal(g.id)
  return `Deleted the ${g.name} goal. Ctrl+Z in Orbit brings it back.`
}

// ---------- who owes who ----------

async function iousFor(): Promise<string> {
  const m = await money()
  const open = openIous(m.ious)
  if (!open.length) return 'Nobody owes anybody anything.'
  return open.map((i) => `${i.theyOwe ? `${i.person} owes them` : `They owe ${i.person}`} ${formatPounds(iouLeft(i))}${i.note ? ` for ${i.note}` : ''} (since ${i.date}${i.paid ? `, ${formatPounds(i.paid)} paid back` : ''}${i.remind ? `, reminder ${i.remind}` : ''})`).join('\n')
}

async function addIouFor(args: Args): Promise<string> {
  await money()
  const person = str(args.person).trim().slice(0, 40)
  if (!person) throw new Error('Say who.')
  const amount = Math.abs(pence(args.amount))
  if (!amount) throw new Error('The amount can’t be 0.')
  const remind = str(args.remind)
  if (remind && !isDay(remind)) throw new Error('The reminder date has to be like 2026-12-01.')
  const theyOwe = args.they_owe !== false
  addIous([{ person, amount, theyOwe, note: str(args.note).trim().slice(0, 100), date: today(), remind }])
  return `Noted: ${theyOwe ? `${person} owes them` : `they owe ${person}`} ${formatPounds(amount)}${str(args.note) ? ` for ${str(args.note).trim()}` : ''}${remind ? `, with a reminder on ${remind}` : ''}.`
}

async function payBackFor(args: Args): Promise<string> {
  const m = await money()
  const want = str(args.person).trim().toLowerCase()
  const theirs = openIous(m.ious)
    .filter((i) => i.person.toLowerCase() === want)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!theirs.length) throw new Error(`Nothing is owed between them and ${str(args.person)}.`)
  let left = has(args, 'amount') ? Math.abs(pence(args.amount)) : theirs.reduce((t, i) => t + iouLeft(i), 0)
  const paid = left
  // Oldest first, as the Money page does.
  for (const i of theirs) {
    if (left <= 0) break
    const part = Math.min(left, iouLeft(i))
    payBackIou(i.id, part)
    left -= part
  }
  const still = openIous(useMoney.getState().ious).filter((i) => i.person.toLowerCase() === want).reduce((t, i) => t + iouLeft(i), 0)
  return `Paid back ${formatPounds(paid - left)} with ${theirs[0].person}.${still ? ` ${formatPounds(still)} is still owed.` : ' All settled.'}`
}

// ---------- subscriptions ----------

const INTERVALS: RepeatInterval[] = ['weekly', 'monthly', 'yearly']

async function subscriptionsFor(): Promise<string> {
  const m = await money()
  const list = allRecurring(m, today()).filter((r) => !r.income)
  if (!list.length) return 'No subscriptions or bills found.'
  return list.map((r) => `${r.name}: ${formatPounds(r.amount)} ${r.interval}, next ${r.next} (${catName(r.category)})${r.manual ? ', added by hand' : ''}`).join('\n')
}

async function addSubscriptionFor(args: Args): Promise<string> {
  await money()
  const name = str(args.name).trim().slice(0, 60)
  if (!name) throw new Error('Say what it is.')
  const interval = (INTERVALS.includes(str(args.interval) as RepeatInterval) ? str(args.interval) : 'monthly') as RepeatInterval
  const date = str(args.next_payment) || today()
  if (!isDay(date)) throw new Error('The date has to be like 2026-12-01.')
  const cat = categoryFor(str(args.category) || 'Bills', false)
  const s = addSubscription({ name, amount: Math.abs(pence(args.amount)), interval, date, category: cat.id })
  return `Added ${s.name}: ${formatPounds(s.amount)} ${interval}, next on ${date}.`
}

async function removeSubscriptionFor(args: Args): Promise<string> {
  const m = await money()
  const r = pickOne(
    allRecurring(m, today()).filter((x) => !x.income),
    str(args.name),
    (x) => x.name,
    'subscription'
  )
  if (r.manual) deleteSubscription(r.manual)
  if (!r.manual || r.edited) setCancelled(r.key, today())
  return `Marked ${r.name} as cancelled. If it charges again, Orbit will list it again.`
}

// ---------- balances ----------

async function setBalanceFor(args: Args): Promise<string> {
  await money()
  const amount = pence(args.amount)
  setBalance({ amount, date: today() })
  return `Their main account balance is now ${formatPounds(amount)} (as of today).`
}

const KINDS: AccountKind[] = ['current', 'savings', 'cash', 'credit', 'other']

async function accountFor(args: Args): Promise<string> {
  const m = await money()
  const name = str(args.account).trim()
  const amount = pence(args.amount)
  const kind = (KINDS.includes(str(args.kind) as AccountKind) ? str(args.kind) : 'other') as AccountKind
  const found = m.accounts.filter((a) => a.name.toLowerCase().includes(name.toLowerCase()))
  if (found.length === 1) {
    updateAccount(found[0].id, { amount, date: today() })
    return `${found[0].name} now has ${formatPounds(amount)}.`
  }
  if (found.length > 1) throw new Error(`More than one account matches “${name}”: ${found.map((a) => a.name).join(', ')}.`)
  if (!name) throw new Error('Say which account.')
  const a = addAccount({ name: name.slice(0, 40), kind, amount, date: today() })
  return `Added the account ${a.name} with ${formatPounds(amount)}.`
}

export const MONEY_ANSWERS: Record<string, Answer> = {
  add_money_entry: addEntryFor,
  find_money_entries: findEntriesFor,
  edit_money_entry: editEntryFor,
  delete_money_entry: deleteEntryFor,
  set_budget: setBudgetFor,
  add_money_category: addCategoryFor,
  add_savings_goal: addGoalFor,
  savings_goal_money: goalMoneyFor,
  edit_savings_goal: editGoalFor,
  delete_savings_goal: deleteGoalFor,
  get_ious: iousFor,
  add_iou: addIouFor,
  pay_back_iou: payBackFor,
  get_subscriptions: subscriptionsFor,
  add_subscription: addSubscriptionFor,
  cancel_subscription: removeSubscriptionFor,
  set_balance: setBalanceFor,
  set_account_balance: accountFor
}
