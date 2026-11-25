import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import Private from '../Streamer/Private'
import { addBudgetLines, deleteBudgetLine, updateBudgetLine, useMoney, useMoneyView } from '../../store/money'
import { budgetTotals, formatPounds, lineMonthly, monthOf, monthTotals, parseAmount, type BudgetLine, type RepeatInterval } from '../../lib/money'
import { MONEY_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import { useRecurring } from './MoneyPlans'

const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}
const penceText = (pence: number): string => (pence ? (pence / 100).toFixed(2).replace(/\.00$/, '') : '')
const pct = (part: number, whole: number): number => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : part > 0 ? 100 : 0)

const INTERVALS: [RepeatInterval, string][] = [
  ['weekly', 'a week'],
  ['monthly', 'a month'],
  ['yearly', 'a year']
]

function IntervalSelect({ value, onChange, label }: { value: RepeatInterval; onChange: (v: RepeatInterval) => void; label: string }) {
  return (
    <select className="select money-line-interval" value={value} onChange={(e) => onChange(e.target.value as RepeatInterval)} aria-label={label}>
      {INTERVALS.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  )
}

/** The Budget tab: type in what comes in and what goes out, and see what's left each month. */
export default function BudgetView() {
  const lines = useMoney((s) => s.budgetLines)
  const entries = useMoney((s) => s.entries)
  const totals = budgetTotals(lines)
  const month = monthOf(new Date())
  const spent = useMemo(() => monthTotals(entries, month).spent, [entries, month])
  const incoming = lines.filter((l) => l.income)
  const outgoing = lines.filter((l) => !l.income)

  return (
    <div className="money-budget-view" data-money-budget>
      <div className="money-tiles">
        <div className="money-tile">
          <span>Coming in</span>
          <strong>{formatPounds(totals.income)}</strong>
          <small>a month</small>
        </div>
        <div className="money-tile">
          <span>Going out</span>
          <strong>{formatPounds(totals.out)}</strong>
          <small>a month</small>
        </div>
        <div className="money-tile">
          <span>{totals.left >= 0 ? 'Left over' : 'Short'}</span>
          <strong className={totals.left < 0 ? 'down' : totals.left > 0 ? 'up' : ''}>{formatPounds(Math.abs(totals.left))}</strong>
          <small>
            a month, {formatPounds(Math.abs(totals.left) * 12, true)} a year
          </small>
        </div>
      </div>

      {totals.income > 0 && totals.out > 0 && (
        <div className={`money-line-share ${totals.left < 0 ? 'over' : ''}`}>
          <div className="money-budget-bar">
            <div style={{ width: `${pct(totals.out, totals.income)}%` }} />
          </div>
          <span className="money-hint">
            {totals.left >= 0
              ? `Your outgoings use ${Math.round((totals.out / totals.income) * 100)}% of what comes in.`
              : `Your outgoings are ${formatPounds(-totals.left)} a month more than what comes in.`}
          </span>
        </div>
      )}

      {totals.out > 0 && spent > 0 && (
        <p className="money-hint" data-budget-this-month>
          So far this month you've spent <strong>{formatPounds(spent)}</strong>
          {spent > totals.out ? `, ${formatPounds(spent - totals.out)} more than your budget's outgoings.` : ` of the ${formatPounds(totals.out)} your budget plans for.`}
        </p>
      )}

      <LineList title="Money in" income lines={incoming} />
      <LineList title="Money out" income={false} lines={outgoing} />
    </div>
  )
}

function LineList({ title, income, lines }: { title: string; income: boolean; lines: BudgetLine[] }) {
  const recurring = useRecurring()
  // Subscriptions, bills and pay that Money already knows about, not in the budget yet.
  const known = new Set(useMoney((s) => s.budgetLines).map((l) => l.name.trim().toLowerCase()))
  const missing = recurring.filter((r) => r.income === income && !known.has(r.name.trim().toLowerCase()))
  const total = lines.reduce((n, l) => n + lineMonthly(l), 0)
  return (
    <section className="money-section">
      <h3>
        {title}
        {lines.length > 0 && <span className="money-line-total">{formatPounds(total)} a month</span>}
      </h3>
      {lines.length > 0 && (
        <ul className="money-lines">
          {lines.map((l) => (
            <LineRow key={l.id} line={l} />
          ))}
        </ul>
      )}
      <NewLine income={income} />
      {missing.length > 0 && (
        <p className="money-hint">
          <button
            className="link-button"
            onClick={() => addBudgetLines(missing.map((r) => ({ name: r.name, amount: r.amount, income, interval: r.interval })))}
            data-budget-add-found
          >
            Add {missing.length === 1 ? missing[0].name : `${missing.length} ${income ? 'payments' : 'subscriptions and bills'}`}
          </button>{' '}
          from your bank statements and Goals &amp; bills ({missing.slice(0, 4).map((r) => r.name).join(', ')}
          {missing.length > 4 ? '…' : ''})
        </p>
      )}
    </section>
  )
}

/** One line: its name, amount and how often, all changed in place. */
function LineRow({ line }: { line: BudgetLine }) {
  const [name, setName] = useState(line.name)
  const [amount, setAmount] = useState(penceText(line.amount))
  return (
    <li data-budget-line={line.name}>
      <input
        className="text-input money-line-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? name.trim() !== line.name && updateBudgetLine(line.id, { name: name.trim() }) : setName(line.name))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="What it is"
      />
      <label className="money-amount">
        <span>£</span>
        <input
          className="text-input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const p = typedPence(amount)
            if (p && p !== line.amount) updateBudgetLine(line.id, { amount: p })
            setAmount(penceText(p || line.amount))
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={`Amount for ${line.name}`}
        />
      </label>
      <IntervalSelect value={line.interval} onChange={(interval) => updateBudgetLine(line.id, { interval })} label={`How often for ${line.name}`} />
      <span className="money-line-monthly">{line.interval !== 'monthly' && `${formatPounds(lineMonthly(line))} a month`}</span>
      <button className="icon-btn" title={`Remove ${line.name}`} onClick={() => deleteBudgetLine(line.id)}>
        <Trash2 size={13} />
      </button>
    </li>
  )
}

function NewLine({ income }: { income: boolean }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [interval, setInterval] = useState<RepeatInterval>('monthly')
  const pence = typedPence(amount)
  const add = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !pence) return
    addBudgetLines([{ name: name.trim(), amount: pence, income, interval }])
    setName('')
    setAmount('')
    ;(e.currentTarget as HTMLFormElement).querySelector('input')?.focus()
  }
  return (
    <form className="money-new-line" onSubmit={add}>
      <input
        className="text-input money-line-name"
        placeholder={income ? 'e.g. Wages' : 'e.g. Netflix, Rent, Phone'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={income ? 'New money in' : 'New money out'}
      />
      <label className="money-amount">
        <span>£</span>
        <input className="text-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
      </label>
      <IntervalSelect value={interval} onChange={setInterval} label="How often" />
      <button className="btn" type="submit" disabled={!name.trim() || !pence}>
        <Plus size={14} /> Add
      </button>
    </form>
  )
}

/** The Home page's budget box: nothing until you've typed in a budget. */
export function BudgetHomeCard() {
  const lines = useMoney((s) => s.budgetLines)
  const entries = useMoney((s) => s.entries)
  if (!lines.length) return null
  const totals = budgetTotals(lines)
  const spent = monthTotals(entries, monthOf(new Date())).spent
  const open = (): void => {
    useMoneyView.setState({ view: 'budget' })
    openSpecialTab(MONEY_TAB)
  }
  return (
    <HomeBox
      icon={<Wallet size={15} />}
      title="Budget"
      action={
        <button className="link-button home-box-action" onClick={open}>
          Budget
        </button>
      }
    >
      <div className="money-home" data-budget-home>
        <strong>
          <Private>{formatPounds(Math.abs(totals.left))}</Private>
        </strong>
        <span>{totals.left >= 0 ? 'left over each month' : 'short each month'}</span>
      </div>
      <div className="money-home-next">
        <Private>{formatPounds(totals.income)}</Private> in, <Private>{formatPounds(totals.out)}</Private> out a month
      </div>
      {totals.out > 0 && spent > 0 && (
        <div className={`money-line-share ${spent > totals.out ? 'over' : ''}`}>
          <div className="money-budget-bar">
            <div style={{ width: `${pct(spent, totals.out)}%` }} />
          </div>
          <span className="money-hint">
            <Private>{formatPounds(spent)}</Private> spent this month of <Private>{formatPounds(totals.out)}</Private> planned
          </span>
        </div>
      )}
    </HomeBox>
  )
}
