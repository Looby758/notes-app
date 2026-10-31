import type { CalEvent, EmailSummary } from '@shared/types'
import { formatPounds, monthName, monthTotals, addMonths, type MoneyData } from './money'
import { allRecurring, forecastMonth, monthlyCost } from './moneyInsights'

/**
 * "Ask everything": besides the notes that match, the AI gets a short, plain-text digest of your
 * money, calendar and inbox, so it can answer things like "when did I last pay the gas bill?" or
 * "what's on this week?". Only built when you ask a question, and only for the sources you've
 * left switched on.
 */

const WORD = /[a-z0-9£]{3,}/g
const STOP = new Set(['the', 'and', 'for', 'what', 'when', 'did', 'last', 'how', 'much', 'many', 'this', 'that', 'with', 'from', 'have', 'has', 'was', 'were', 'are', 'you', 'your', 'my', 'any', 'about', 'there', 'week', 'month', 'year', 'spend', 'spent', 'pay', 'paid', 'get', 'got'])

/** The words in a question worth searching for. */
export const questionWords = (q: string): string[] => [...new Set((q.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)))]

const line = (cells: (string | number | undefined)[]): string => cells.filter((c) => c !== undefined && c !== '').join(' | ')

/** Money as text: this month and the last few, budgets, goals, repeating payments, and entries (matching ones first). */
export function moneyContext(data: MoneyData, today: string, question: string, budget = 14000): string {
  if (!data.entries.length && !data.goals.length && !data.subscriptions.length && !data.balance) return ''
  const name = (id: string): string => data.categories.find((c) => c.id === id)?.name ?? id
  const month = today.slice(0, 7)
  const out: string[] = []
  for (let i = 0; i < 4; i++) {
    const m = addMonths(month, -i)
    const t = monthTotals(data.entries, m)
    if (!t.spent && !t.received) continue
    const cats = [...t.byCategory].sort((a, b) => b[1] - a[1]).map(([c, p]) => `${name(c)} ${formatPounds(p)}`)
    out.push(`${monthName(m)}${i === 0 ? ' (so far)' : ''}: in ${formatPounds(t.received)}, out ${formatPounds(t.spent)}. ${cats.join(', ')}`)
  }
  const budgets = Object.entries(data.budgets).map(([c, p]) => `${name(c)} ${formatPounds(p)}/month`)
  if (budgets.length) out.push(`Budgets: ${budgets.join(', ')}`)
  for (const g of data.goals) out.push(`Savings goal: ${g.name}, ${formatPounds(g.saved)} of ${formatPounds(g.target)}${g.due ? ` by ${g.due}` : ''}`)
  const recurring = allRecurring(data, today)
  for (const r of recurring) out.push(`Repeating ${r.income ? 'income' : 'payment'}: ${r.name}, ${formatPounds(r.amount)} ${r.interval} (about ${formatPounds(monthlyCost(r))} a month)${r.manual ? ', added by hand' : ''}${r.last ? `, last ${r.last}` : ''}, next ${r.next}`)
  const f = forecastMonth(data.entries, recurring, today, data.balance)
  if (f.balanceNow !== undefined) out.push(`Balance: about ${formatPounds(f.balanceNow)} now (you entered ${formatPounds(data.balance!.amount)} on ${data.balance!.date})`)
  out.push(`Forecast for the end of ${monthName(month)}: ${f.endOfMonth >= 0 ? `${formatPounds(f.endOfMonth)} left` : `${formatPounds(-f.endOfMonth)} short`}`)

  const words = questionWords(question)
  const matches = (note: string, cat: string): boolean => words.some((w) => note.toLowerCase().includes(w) || cat.toLowerCase().includes(w))
  const sorted = [...data.entries].sort((a, b) => b.date.localeCompare(a.date))
  const ranked = [...sorted.filter((e) => matches(e.note, name(e.category))), ...sorted.filter((e) => !matches(e.note, name(e.category)))]
  let text = out.join('\n') + '\n\nEntries (date | in/out | amount | category | note):\n'
  for (const e of ranked) {
    const row = line([e.date, e.income ? 'in' : 'out', formatPounds(e.amount), name(e.category), e.note]) + '\n'
    if (text.length + row.length > budget) break
    text += row
  }
  return text
}

/** Calendar events as text, one a line. */
export function calendarContext(events: CalEvent[]): string {
  const rows = [...events]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((e) => {
      const when = e.allDay ? `${e.start} (all day)` : new Date(e.start).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      return line([when, e.title, e.location, e.calendarName])
    })
  return rows.slice(0, 300).join('\n')
}

/** Emails as text: who from, when, subject and Gmail's preview. */
export function emailContext(emails: EmailSummary[]): string {
  const seen = new Set<string>()
  return emails
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .slice(0, 60)
    .map((e) => line([e.date.slice(0, 10), `${e.from.name || e.from.email} <${e.from.email}>`, e.subject, e.snippet.slice(0, 220), e.unread ? 'unread' : '']))
    .join('\n')
}
