import { useMemo, useState, type FormEvent } from 'react'
import { ArrowUp, CalendarClock, EyeOff, Minus, PiggyBank, Plus, Repeat, Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { addGoal, addToGoal, deleteGoal, setNotRecurring, updateGoal, useMoney } from '../../store/money'
import { askEverything, useAi } from '../../store/ai'
import { dayOf, formatPounds, monthName, parseAmount, type SavingsGoal } from '../../lib/money'
import { findRecurring, forecastMonth, monthlyCost, weeklyToGoal, type Recurring } from '../../lib/moneyInsights'
import Private from '../Streamer/Private'

const shortDate = (key: string): string => new Date(`${key}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}

/** Repeating payments and paydays, worked out from your entries (today's view). */
export function useRecurring(): Recurring[] {
  const entries = useMoney((s) => s.entries)
  const notRecurring = useMoney((s) => s.notRecurring)
  return useMemo(() => findRecurring(entries, dayOf(new Date()), notRecurring), [entries, notRecurring])
}

/** "At this rate you'll end October with £230 left": shown on This month for the current month. */
export function ForecastCard() {
  const entries = useMoney((s) => s.entries)
  const recurring = useRecurring()
  const today = dayOf(new Date())
  const f = useMemo(() => forecastMonth(entries, recurring, today), [entries, recurring, today])
  if (!entries.length) return null
  const ok = f.endOfMonth >= 0
  const month = monthName(today.slice(0, 7)).split(' ')[0]
  return (
    <section className={`money-forecast ${ok ? 'ok' : 'short'}`} data-money-forecast>
      <div className="money-forecast-icon">{ok ? <TrendingUp size={18} /> : <TrendingDown size={18} />}</div>
      <div>
        <strong>
          At this rate you’ll end {month} {ok ? 'with ' : ''}
          <Private>{formatPounds(Math.abs(f.endOfMonth))}</Private> {ok ? 'left' : 'short'}
        </strong>
        <p>
          {f.daysLeft} {f.daysLeft === 1 ? 'day' : 'days'} to go
          {f.billsDue > 0 && (
            <>
              {' '}
              · <Private>{formatPounds(f.billsDue)}</Private> of bills still to come
            </>
          )}
          {f.payDue > 0 && (
            <>
              {' '}
              · <Private>{formatPounds(f.payDue)}</Private> pay due
            </>
          )}
          {f.everydayLeft > 0 && (
            <>
              {' '}
              · about <Private>{formatPounds(f.everydayLeft)}</Private> more everyday spending
            </>
          )}
        </p>
      </div>
    </section>
  )
}

const ASK_EXAMPLES = ['How much did I spend on takeaways last month?', 'What are my biggest subscriptions?', 'Where could I save £50 a month?']

/** "Ask about your money": goes to Ask everything with the money digest switched on. */
export function AskMoney() {
  const [q, setQ] = useState('')
  const moneyOn = useAi((s) => s.sources.money)
  const ask = (question: string): void => {
    if (!question.trim()) return
    setQ('')
    void askEverything(question)
  }
  return (
    <section className="money-section money-ask" data-money-ask>
      <h3>
        <Sparkles size={14} /> Ask about your money
      </h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. When did I last pay the gas bill?" />
        <button className="btn btn-primary" disabled={!q.trim()} title="Ask">
          <ArrowUp size={14} />
        </button>
      </form>
      <div className="money-ask-examples">
        {ASK_EXAMPLES.map((e) => (
          <button key={e} className="btn" onClick={() => ask(e)}>
            {e}
          </button>
        ))}
      </div>
      <p className="money-hint">
        Claude answers from your money tracker{moneyOn ? '' : ' (switched off on the Ask everything page, so it can’t see it yet)'}. Nothing is sent until you
        ask. Needs your Anthropic key in Settings → AI helper.
      </p>
    </section>
  )
}

/** Goals & bills: savings goals, subscriptions and bills found in your spending, and paydays. */
export default function MoneyPlans() {
  const recurring = useRecurring()
  const goals = useMoney((s) => s.goals)
  const notRecurring = useMoney((s) => s.notRecurring)
  const subs = recurring.filter((r) => !r.income)
  const pay = recurring.filter((r) => r.income)
  const monthly = subs.reduce((n, r) => n + monthlyCost(r), 0)

  return (
    <>
      <section className="money-section" data-money-goals>
        <h3>
          <PiggyBank size={15} /> Savings goals
        </h3>
        {goals.length > 0 && (
          <ul className="money-goals">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </ul>
        )}
        <NewGoal first={!goals.length} />
      </section>

      <section className="money-section" data-money-recurring>
        <h3>
          <Repeat size={15} /> Subscriptions & bills
        </h3>
        {subs.length ? (
          <>
            <div className="money-tiles">
              <div className="money-tile">
                <span>A month</span>
                <strong>
                  <Private>{formatPounds(monthly)}</Private>
                </strong>
              </div>
              <div className="money-tile">
                <span>A year</span>
                <strong>
                  <Private>{formatPounds(monthly * 12, true)}</Private>
                </strong>
              </div>
              <div className="money-tile">
                <span>Found</span>
                <strong>{subs.length}</strong>
              </div>
            </div>
            <ul className="money-recurring">
              {subs.map((r) => (
                <RecurringRow key={r.key} r={r} />
              ))}
            </ul>
          </>
        ) : (
          <p className="money-hint">
            Nothing repeating yet. Import a couple of months of bank statements and Orbit spots the payments that come round every week, month or year
            (Netflix, the phone bill, the gym…) and shows them here and on the calendar.
          </p>
        )}
      </section>

      {pay.length > 0 && (
        <section className="money-section">
          <h3>
            <CalendarClock size={15} /> Paydays
          </h3>
          <ul className="money-recurring">
            {pay.map((r) => (
              <RecurringRow key={r.key} r={r} />
            ))}
          </ul>
        </section>
      )}

      {notRecurring.length > 0 && (
        <p className="money-hint">
          {notRecurring.length} hidden as “not repeating”.{' '}
          <button className="link-button" onClick={() => notRecurring.forEach((k) => setNotRecurring(k, false))}>
            Show them again
          </button>
        </p>
      )}
    </>
  )
}

function RecurringRow({ r }: { r: Recurring }) {
  const categories = useMoney((s) => s.categories)
  const cat = categories.find((c) => c.id === r.category)
  const days = Math.round((new Date(`${r.next}T12:00`).getTime() - Date.now()) / 86400000)
  return (
    <li className="money-recurring-row" data-recurring={r.key}>
      <span className="money-swatch" style={{ background: cat?.color ?? '#8a8e9a' }} />
      <span className="money-recurring-name">
        <Private>{r.name}</Private>
        <small>
          {r.interval} · {r.count} payments so far{cat ? ` · ${cat.name}` : ''}
        </small>
      </span>
      <span className="money-recurring-next" title={`Last one ${shortDate(r.last)}`}>
        {r.income ? 'Next' : 'Due'} {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : shortDate(r.next)}
      </span>
      <strong>
        <Private>{formatPounds(r.amount)}</Private>
      </strong>
      <button className="icon-btn" title="Not a repeating payment: stop listing it" onClick={() => setNotRecurring(r.key)}>
        <EyeOff size={13} />
      </button>
    </li>
  )
}

function GoalRow({ goal: g }: { goal: SavingsGoal }) {
  const [amount, setAmount] = useState('')
  const pct = Math.min(100, Math.round((g.saved / g.target) * 100))
  const weekly = weeklyToGoal(g, dayOf(new Date()))
  const done = g.saved >= g.target
  const move = (sign: 1 | -1) => (e?: FormEvent) => {
    e?.preventDefault()
    const p = typedPence(amount)
    if (!p) return
    addToGoal(g.id, sign * p)
    setAmount('')
  }
  return (
    <li className={`money-goal ${done ? 'done' : ''}`} data-goal={g.id}>
      <div className="money-goal-head">
        <span className="money-swatch" style={{ background: g.color }} />
        <input className="money-goal-name" value={g.name} onChange={(e) => updateGoal(g.id, { name: e.target.value })} aria-label="Goal name" />
        <span className="money-goal-figures">
          <Private>{formatPounds(g.saved, true)}</Private> of <Private>{formatPounds(g.target, true)}</Private>
        </span>
        <button className="icon-btn" title="Delete goal" onClick={() => deleteGoal(g.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="money-goal-bar">
        <span style={{ width: `${pct}%`, background: g.color }} />
      </div>
      <div className="money-goal-foot">
        <span className="money-hint">
          {done ? (
            '🎉 Goal reached!'
          ) : weekly ? (
            <>
              Put aside <Private>{formatPounds(weekly)}</Private> a week to get there by {shortDate(g.due)}
            </>
          ) : (
            `${pct}% there`
          )}
        </span>
        <label className="money-goal-due">
          By
          <input type="date" value={g.due} onChange={(e) => updateGoal(g.id, { due: e.target.value })} />
        </label>
        <form className="money-goal-add" onSubmit={move(1)}>
          <span>£</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" inputMode="decimal" aria-label="Amount" />
          <button type="button" className="icon-btn" title="Take out" onClick={() => move(-1)()} disabled={!typedPence(amount)}>
            <Minus size={13} />
          </button>
          <button className="icon-btn" title="Put in" disabled={!typedPence(amount)}>
            <Plus size={13} />
          </button>
        </form>
      </div>
    </li>
  )
}

function NewGoal({ first }: { first: boolean }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [due, setDue] = useState('')
  const pence = typedPence(target)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !pence) return
    addGoal({ name: name.trim(), target: pence, due })
    setName('')
    setTarget('')
    setDue('')
  }
  return (
    <form className="money-new-goal" onSubmit={submit} data-new-goal>
      {first && <p className="money-hint">Saving up for something? Add it here and see how close you are, and how much to put aside each week.</p>}
      <div className="money-new-goal-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What for? (New PC, holiday…)" />
        <label className="money-amount">
          £<input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="1200" inputMode="decimal" />
        </label>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="By when (optional)" />
        <button className="btn btn-primary" disabled={!name.trim() || !pence}>
          <Plus size={13} /> Add goal
        </button>
      </div>
    </form>
  )
}
