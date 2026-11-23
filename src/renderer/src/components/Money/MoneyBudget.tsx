import { useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Pencil, Repeat, Sparkles, Target, X } from 'lucide-react'
import Private from '../Streamer/Private'
import { setBudget, setBudgets, setBudgetWarnAt, setMonthBudget, setRollover, useMoney, useMoneyView } from '../../store/money'
import { addMonths, budgetState, dayOf, formatPounds, monthName, monthOf, parseAmount } from '../../lib/money'
import { budgetHistory, budgetMonth, limitFor, suggestBudget, type BudgetMonth, type BudgetRow } from '../../lib/moneyBudget'
import { MONEY_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'

const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}
const penceText = (pence: number | undefined): string => (pence ? (pence / 100).toFixed(2).replace(/\.00$/, '') : '')
const shortMonth = (month: string): string => monthName(month).split(' ')[0]
const pct = (part: number, whole: number): number => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : part > 0 ? 100 : 0)

function useBudgetMonth(month: string): BudgetMonth {
  const categories = useMoney((s) => s.categories)
  const entries = useMoney((s) => s.entries)
  const budgets = useMoney((s) => s.budgets)
  const budget = useMoney((s) => s.budget)
  const today = dayOf(new Date())
  return useMemo(() => budgetMonth({ categories, entries, budgets, budget }, month, today), [categories, entries, budgets, budget, month, today])
}

/** The bar: what's used of what's available, with a tick for how far through the month it is. */
function BudgetBar({ row }: { row: BudgetRow }) {
  const used = pct(row.spent, row.available)
  return (
    <div
      className="money-budget-bar"
      title={row.available > 0 ? `${Math.round((row.spent / row.available) * 100)}% of your ${row.cat.name} budget used` : `Nothing left for ${row.cat.name} this month`}
    >
      <div style={{ width: `${used}%` }} />
      {row.pace !== undefined && row.pace < 1 && (
        <span className="money-budget-pace" style={{ left: `${row.pace * 100}%` }} title={`${Math.round(row.pace * 100)}% of the month has gone`} />
      )}
    </div>
  )
}

/** One line under the bar: what's left (or over), and a word about the pace. */
function BudgetStatus({ row }: { row: BudgetRow }) {
  if (row.state === 'over')
    return (
      <>
        <AlertTriangle size={12} /> <Private>{formatPounds(-row.left)}</Private> over budget
      </>
    )
  return (
    <>
      {(row.state === 'near' || row.ahead) && <AlertTriangle size={12} />} <Private>{formatPounds(row.left)}</Private> left
      {row.state === 'near' && ' (nearly used up)'}
      {row.state !== 'near' && row.ahead && row.projected !== undefined && (
        <>
          {' '}
          · spending fast: about <Private>{formatPounds(row.projected)}</Private> by the end of the month
        </>
      )}
    </>
  )
}

/** The budgets, compact: used on the "This month" view. */
export function BudgetBars({ month, showBudget }: { month: string; showBudget: () => void }) {
  const b = useBudgetMonth(month)
  if (!b.rows.length)
    return (
      <p className="money-hint">
        No budgets yet.{' '}
        <button className="link-button" onClick={showBudget}>
          Set a monthly budget for each category
        </button>{' '}
        to see how you're doing here.
      </p>
    )
  return (
    <ul className="money-budgets">
      {b.rows.map((row) => (
        <li key={row.cat.id} className={`budget-${row.state}${row.ahead ? ' budget-ahead' : ''}`}>
          <div className="money-budget-row">
            <span className="money-swatch" style={{ background: row.cat.color }} />
            <span className="money-budget-name">{row.cat.name}</span>
            <span className="money-budget-figures">
              {formatPounds(row.spent)} of {formatPounds(row.available)}
            </span>
          </div>
          <BudgetBar row={row} />
          <div className="money-budget-left">
            <BudgetStatus row={row} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The Budget tab: every budget for the month, editing them, rollover, suggestions and how past months went. */
export default function BudgetView({ month }: { month: string }) {
  const b = useBudgetMonth(month)
  const entries = useMoney((s) => s.entries)
  const categories = useMoney((s) => s.categories)
  const warnAt = useMoney((s) => s.budget.warnAt)
  const [editing, setEditing] = useState<string | null>(null)
  const now = monthOf(new Date())
  const current = month === now
  const past = month < now

  const suggestions = useMemo(
    () =>
      categories
        .filter((c) => !c.income && !b.rows.some((r) => r.cat.id === c.id))
        .map((c) => ({ cat: c, pence: suggestBudget(entries, c.id, month) }))
        .filter((s) => s.pence > 0),
    [categories, entries, b.rows, month]
  )
  const suggested = new Map(suggestions.map((s) => [s.cat.id, s.pence]))
  const without = categories.filter((c) => !c.income && !b.rows.some((r) => r.cat.id === c.id))
  const spentWithout = new Map(b.unbudgeted.map((u) => [u.cat.id, u.spent]))
  const unbudgetedTotal = b.unbudgeted.reduce((n, u) => n + u.spent, 0)

  return (
    <div className="money-budget-view" data-money-budget>
      <div className="money-tiles money-tiles-4">
        <div className="money-tile">
          <span>Budgeted for {shortMonth(month)}</span>
          <strong>{formatPounds(b.available)}</strong>
        </div>
        <div className="money-tile">
          <span>Spent</span>
          <strong>{formatPounds(b.spent)}</strong>
          {b.available > 0 && <small>{Math.round((b.spent / b.available) * 100)}% of your budgets</small>}
        </div>
        <div className="money-tile">
          <span>{b.left >= 0 ? 'Left' : 'Over'}</span>
          <strong className={b.left < 0 ? 'down' : ''}>{formatPounds(Math.abs(b.left))}</strong>
        </div>
        <div className="money-tile">
          {current && b.perDay !== undefined && b.rows.length ? (
            <>
              <span>Each day</span>
              <strong>{formatPounds(b.perDay)}</strong>
              <small>
                for the {b.daysLeft === 1 ? 'last day' : `next ${b.daysLeft} days`}, to stay on budget
              </small>
            </>
          ) : (
            <>
              <span>Spent without a budget</span>
              <strong>{formatPounds(unbudgetedTotal)}</strong>
            </>
          )}
        </div>
      </div>

      <section className="money-section">
        <h3>
          <Target size={14} /> Budgets for {monthName(month)}
        </h3>
        {b.rows.length ? (
          <ul className="money-budgets money-budget-list">
            {b.rows.map((row) => (
              <li key={row.cat.id} className={`budget-${row.state}${row.ahead ? ' budget-ahead' : ''}`} data-budget-row={row.cat.id}>
                <div className="money-budget-row">
                  <span className="money-swatch" style={{ background: row.cat.color }} />
                  <span className="money-budget-name">{row.cat.name}</span>
                  {row.rollover && (
                    <span className="money-budget-tag" title="What's left (or overspent) carries into next month">
                      <Repeat size={11} /> rollover
                    </span>
                  )}
                  {row.once && <span className="money-budget-tag">just {shortMonth(month)}</span>}
                  <span className="money-budget-figures">
                    <Private>{formatPounds(row.spent)}</Private> of <Private>{formatPounds(row.available)}</Private>
                  </span>
                  <button className="icon-btn" title={`Change the ${row.cat.name} budget`} onClick={() => setEditing(editing === row.cat.id ? null : row.cat.id)}>
                    <Pencil size={13} />
                  </button>
                </div>
                <BudgetBar row={row} />
                <div className="money-budget-left">
                  <BudgetStatus row={row} />
                  {row.carry !== 0 && (
                    <span className="money-budget-carry">
                      {formatPounds(row.limit)} budget {row.carry > 0 ? '+' : '−'} <Private>{formatPounds(Math.abs(row.carry))}</Private>{' '}
                      {row.carry > 0 ? 'rolled over' : 'overspent before'}
                    </span>
                  )}
                </div>
                {editing === row.cat.id && <BudgetEditor categoryId={row.cat.id} month={month} past={past} done={() => setEditing(null)} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="money-hint">
            No budgets for {monthName(month)} yet. Give a category a monthly limit below and Orbit shows how much is left, warns you
            when it's nearly used up, and can carry what's left into next month.
          </p>
        )}
      </section>

      {without.length > 0 && (
        <section className="money-section">
          <h3>No budget{b.rows.length ? ' yet' : ''}</h3>
          {suggestions.length > 1 && !past && (
            <p className="money-hint">
              <button
                className="btn"
                onClick={() => setBudgets(Object.fromEntries(suggestions.map((s) => [s.cat.id, s.pence])))}
                data-budget-suggest-all
              >
                <Sparkles size={13} /> Use suggested budgets
              </button>{' '}
              based on what you spent in recent months ({suggestions.map((s) => `${s.cat.name} ${formatPounds(s.pence, true)}`).join(', ')}).
            </p>
          )}
          <ul className="money-budget-none">
            {without.map((c) => (
              <li key={c.id}>
                <div className="money-budget-row">
                  <span className="money-swatch" style={{ background: c.color }} />
                  <span className="money-budget-name">{c.name}</span>
                  <span className="money-budget-figures">
                    {spentWithout.get(c.id) ? (
                      <>
                        <Private>{formatPounds(spentWithout.get(c.id)!)}</Private> spent
                      </>
                    ) : (
                      'nothing spent'
                    )}
                  </span>
                  <button className="link-button" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    Set a budget
                  </button>
                </div>
                {editing === c.id && (
                  <BudgetEditor categoryId={c.id} month={month} past={past} suggestion={suggested.get(c.id)} done={() => setEditing(null)} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <BudgetHistory month={month} />

      <section className="money-section">
        <h3>Warnings</h3>
        <label className="money-hint money-budget-warn-at">
          Warn me when a budget is{' '}
          <select className="select" style={{ width: 84 }} value={String(warnAt)} onChange={(e) => setBudgetWarnAt(Number(e.target.value))} aria-label="When to warn">
            {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95].map((v) => (
              <option key={v} value={String(v)}>
                {Math.round(v * 100)}%
              </option>
            ))}
          </select>{' '}
          used. Orbit also tells you when something you add takes a budget past that, or over.
        </label>
      </section>
    </div>
  )
}

/** Changing one category's budget: the amount, for how long, and whether what's left rolls over. */
function BudgetEditor({ categoryId, month, past, suggestion, done }: { categoryId: string; month: string; past: boolean; suggestion?: number; done: () => void }) {
  const data = useMoney((s) => s)
  const cat = data.categories.find((c) => c.id === categoryId)
  const usual = limitFor({ budgets: data.budgets, budget: { ...data.budget, months: {} } }, categoryId, month)
  const once = data.budget.months[month]?.[categoryId]
  const [amount, setAmount] = useState(penceText(limitFor(data, categoryId, month) || suggestion))
  // A past month can only be changed on its own; this month or later can change from then on.
  const [scope, setScope] = useState<'on' | 'once'>(past || once !== undefined ? 'once' : 'on')
  const rolloverFrom = data.budget.rollover[categoryId]
  const [rollover, setRolloverOn] = useState(!!rolloverFrom)
  const pence = typedPence(amount)
  if (!cat) return null

  const save = (e: FormEvent): void => {
    e.preventDefault()
    if (pence === null) return
    if (scope === 'once') setMonthBudget(categoryId, month, pence)
    else {
      if (once !== undefined) setMonthBudget(categoryId, month, null)
      setBudget(categoryId, pence, month)
    }
    // Rollover starts with the month before the one shown, so its leftover shows up straight away.
    if (rollover !== !!rolloverFrom) setRollover(categoryId, rollover ? addMonths(month, -1) : null)
    done()
  }

  return (
    <form className="money-budget-editor" onSubmit={save} data-budget-editor>
      <label className="money-amount">
        <span>£</span>
        <input
          className="text-input"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
          aria-label={`Budget for ${cat.name}`}
        />
        <span className="money-hint">a month</span>
      </label>
      {suggestion && !amount && <span className="money-hint">Suggested: {formatPounds(suggestion)} (what you usually spend)</span>}
      <div className="segmented">
        {!past && (
          <button type="button" className={scope === 'on' ? 'selected' : ''} onClick={() => setScope('on')}>
            From {shortMonth(month)} on
          </button>
        )}
        <button type="button" className={scope === 'once' ? 'selected' : ''} onClick={() => setScope('once')}>
          Just {shortMonth(month)}
        </button>
      </div>
      <label className="money-budget-check" title="Off: the budget starts fresh every month. On: what's left is added to next month, and overspending is taken off it.">
        <input type="checkbox" checked={rollover} onChange={(e) => setRolloverOn(e.target.checked)} />
        Carry what's left into next month
      </label>
      <button className="btn btn-primary" type="submit" disabled={pence === null}>
        Save
      </button>
      <button className="btn" type="button" onClick={done}>
        Cancel
      </button>
      {once !== undefined && (
        <button
          className="link-button"
          type="button"
          onClick={() => {
            setMonthBudget(categoryId, month, null)
            done()
          }}
        >
          Back to the usual {usual ? formatPounds(usual) : 'no budget'}
        </button>
      )}
      {limitFor(data, categoryId, month) > 0 && (
        <button
          className="icon-btn"
          type="button"
          title={past ? `No budget for ${cat.name} in ${monthName(month)}` : `No budget for ${cat.name} from ${monthName(month)} on`}
          onClick={() => {
            if (past) setMonthBudget(categoryId, month, 0)
            else {
              if (once !== undefined) setMonthBudget(categoryId, month, null)
              setBudget(categoryId, 0, month)
            }
            done()
          }}
        >
          <X size={13} />
        </button>
      )}
    </form>
  )
}

/** How each budget went over the last six months: a square per month, green under, amber close, red over. */
function BudgetHistory({ month }: { month: string }) {
  const data = useMoney((s) => s)
  const rows = data.categories
    .filter((c) => !c.income)
    .map((c) => ({ cat: c, cells: budgetHistory(data, c.id, month, 6) }))
    .filter((r) => r.cells.some((x) => x.state !== 'none'))
  if (!rows.length) return null
  const months = rows[0].cells.map((c) => c.month)
  return (
    <section className="money-section">
      <h3>The last six months</h3>
      <table className="money-budget-history">
        <thead>
          <tr>
            <th />
            {months.map((m) => (
              <th key={m}>{shortMonth(m).slice(0, 3)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ cat, cells }) => (
            <tr key={cat.id}>
              <th>
                <span className="money-swatch" style={{ background: cat.color }} /> {cat.name}
              </th>
              {cells.map((c) => (
                <td key={c.month}>
                  <span
                    className={`money-budget-cell budget-${c.state}`}
                    title={
                      c.state === 'none'
                        ? `${monthName(c.month)}: no budget, ${formatPounds(c.spent)} spent`
                        : `${monthName(c.month)}: ${formatPounds(c.spent)} of ${formatPounds(c.available)}${c.spent > c.available ? ` (${formatPounds(c.spent - c.available)} over)` : ''}`
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** The Home page's "Budget this month" box: nothing until you've set a budget. */
export function BudgetHomeCard() {
  const b = useBudgetMonth(monthOf(new Date()))
  const warnAt = useMoney((s) => s.budget.warnAt)
  if (!b.rows.length) return null
  const open = (): void => {
    useMoneyView.setState({ view: 'budget' })
    openSpecialTab(MONEY_TAB)
  }
  const worry = b.rows
    .filter((r) => r.state !== 'ok' || r.ahead)
    .sort((a, z) => a.left / Math.max(1, a.available) - z.left / Math.max(1, z.available))
  const overall = budgetState(b.spent, b.available, warnAt)
  const pace = b.rows[0].pace
  return (
    <HomeBox
      icon={<Target size={15} />}
      title="Budget this month"
      action={
        <button className="link-button home-box-action" onClick={open}>
          Budget
        </button>
      }
    >
      <div className={`money-budget-home budget-${overall}`} data-budget-home>
        <div className="money-home">
          <strong>
            <Private>{formatPounds(Math.abs(b.left))}</Private>
          </strong>
          <span>
            {b.left >= 0 ? 'left' : 'over'} of <Private>{formatPounds(b.available)}</Private>
          </span>
        </div>
        <div className="money-budget-bar">
          <div style={{ width: `${pct(b.spent, b.available)}%` }} />
          {pace !== undefined && pace < 1 && <span className="money-budget-pace" style={{ left: `${pace * 100}%` }} title={`${Math.round(pace * 100)}% of the month has gone`} />}
        </div>
        {b.left > 0 && b.daysLeft !== undefined && (
          <div className="money-home-next">
            About <Private>{formatPounds(b.perDay ?? 0)}</Private> a day for the {b.daysLeft === 1 ? 'last day' : `next ${b.daysLeft} days`}
          </div>
        )}
      </div>
      {worry.slice(0, 3).map((r) => (
        <button key={r.cat.id} className={`money-home-warn link-button budget-${r.state}${r.ahead ? ' budget-ahead' : ''}`} onClick={open}>
          <AlertTriangle size={12} />
          {r.cat.name}:{' '}
          {r.state === 'over' ? (
            <>
              <Private>{formatPounds(-r.left)}</Private> over budget
            </>
          ) : r.state === 'near' ? (
            <>
              only <Private>{formatPounds(r.left)}</Private> left
            </>
          ) : (
            <>spending faster than the month</>
          )}
        </button>
      ))}
      {worry.length > 3 && <div className="money-hint">and {worry.length - 3} more</div>}
    </HomeBox>
  )
}
