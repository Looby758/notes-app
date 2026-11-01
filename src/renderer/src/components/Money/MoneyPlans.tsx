import { useMemo, useState, type FormEvent } from 'react'
import { ArrowUp, Ban, CalendarClock, Check, EyeOff, Landmark, Minus, Pencil, PiggyBank, Plus, Repeat, RotateCcw, Sparkles, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react'
import {
  addGoal,
  addSubscription,
  addToGoal,
  deleteGoal,
  deleteSubscription,
  setBalance,
  setCancelled,
  setNotRecurring,
  updateGoal,
  updateSubscription,
  useMoney
} from '../../store/money'
import { notify } from '../../store/notify'
import { UNDO_KEY } from '../../lib/undo'
import { askEverything, useAi } from '../../store/ai'
import { dayOf, formatPounds, monthName, parseAmount, type ManualSubscription, type RepeatInterval, type SavingsGoal } from '../../lib/money'
import { allRecurring, chargedAfterCancelling, forecastMonth, payeeKey, monthlyCost, weeklyToGoal, type Recurring } from '../../lib/moneyInsights'

const shortDate = (key: string): string => new Date(`${key}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}

/** Repeating payments and paydays, worked out from your entries (today's view). */
export function useRecurring(): Recurring[] {
  const entries = useMoney((s) => s.entries)
  const notRecurring = useMoney((s) => s.notRecurring)
  const subscriptions = useMoney((s) => s.subscriptions)
  const cancelled = useMoney((s) => s.cancelled)
  const today = dayOf(new Date())
  return useMemo(
    () => allRecurring({ entries, notRecurring, subscriptions, cancelled }, today),
    [entries, notRecurring, subscriptions, cancelled, today]
  )
}

/** "At this rate you'll end October with £230 left": shown on This month for the current month. */
export function ForecastCard() {
  const entries = useMoney((s) => s.entries)
  const balance = useMoney((s) => s.balance)
  const recurring = useRecurring()
  const today = dayOf(new Date())
  const f = useMemo(() => forecastMonth(entries, recurring, today, balance), [entries, recurring, today, balance])
  const [editing, setEditing] = useState(false)
  if (!entries.length && !balance && !recurring.length) return null
  const ok = f.endOfMonth >= 0
  const month = monthName(today.slice(0, 7)).split(' ')[0]
  const stale = balance ? Math.round((new Date(`${today}T12:00`).getTime() - new Date(`${balance.date}T12:00`).getTime()) / 86400000) : 0
  return (
    <section className={`money-forecast ${ok ? 'ok' : 'short'}`} data-money-forecast>
      <div className="money-forecast-icon">{ok ? <TrendingUp size={18} /> : <TrendingDown size={18} />}</div>
      <div className="money-forecast-body">
        <strong>
          At this rate you’ll end {month} {ok ? 'with ' : ''}
          {formatPounds(Math.abs(f.endOfMonth))} {ok ? 'left' : 'short'}
        </strong>
        <p>
          {f.daysLeft === 0 ? 'Last day of the month' : `${f.daysLeft} ${f.daysLeft === 1 ? 'day' : 'days'} to go`}
          {f.billsDue > 0 && (
            <>
              {' '}
              · {formatPounds(f.billsDue)} of bills still to come
            </>
          )}
          {f.payDue > 0 && (
            <>
              {' '}
              · {formatPounds(f.payDue)} pay due
            </>
          )}
          {f.everydayLeft > 0 && (
            <>
              {' '}
              · about {formatPounds(f.everydayLeft)} more everyday spending
            </>
          )}
        </p>
        {editing ? (
          <BalanceForm
            start={f.balanceNow}
            onDone={(pence) => {
              if (pence !== undefined) setBalance({ amount: pence, date: today })
              setEditing(false)
            }}
          />
        ) : balance && f.balanceNow !== undefined ? (
          <p className="money-forecast-balance" data-money-balance>
            <Landmark size={12} /> Starting from your balance: about {formatPounds(f.balanceNow)} now
            {stale > 0 && (
              <>
                {' '}
                (you said {formatPounds(balance.amount)} {stale === 1 ? 'yesterday' : `${stale} days ago`}
                {stale > 7 ? ', worth updating' : ''})
              </>
            )}
            .{' '}
            <button className="link-button" onClick={() => setEditing(true)}>
              Update
            </button>{' '}
            ·{' '}
            <button className="link-button" onClick={() => setBalance(null)} title="Go back to working it out from your statements only">
              Stop using it
            </button>
          </p>
        ) : (
          <p className="money-forecast-balance">
            Worked out from your statements only.{' '}
            <button className="link-button" onClick={() => setEditing(true)} data-set-balance>
              Tell Orbit your real balance
            </button>{' '}
            for a truer figure.
          </p>
        )}
      </div>
    </section>
  )
}

/** "How much is in your account right now?" */
function BalanceForm({ start, onDone }: { start?: number; onDone: (pence?: number) => void }) {
  const [text, setText] = useState(start !== undefined ? (start / 100).toFixed(2) : '')
  const pence = parseAmount(text)
  return (
    <form
      className="money-balance-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (pence !== null) onDone(pence)
      }}
    >
      <label className="money-amount">
        How much is in your account right now? £
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onDone()}
          placeholder="e.g. 342.18 (or -50 if overdrawn)"
          inputMode="decimal"
          aria-label="Current balance"
        />
      </label>
      <button className="btn btn-primary" disabled={pence === null}>
        Save
      </button>
      <button type="button" className="btn" onClick={() => onDone()}>
        Cancel
      </button>
      <span className="money-hint">Anything you log or import after today is added on top, so you only need to set it once in a while.</span>
    </form>
  )
}

const ASK_EXAMPLES = ['How much did I spend on takeaways last month?', 'What are my biggest subscriptions?', 'Where could I save £50 a month?']

/** "Ask about your money": goes to Ask everything with the money digest switched on. */
export function AskMoney() {
  const [q, setQ] = useState('')
  const moneyOn = useAi((s) => s.sources.money)
  const offline = useAi((s) => s.status?.offline.state === 'ready')
  const ask = (question: string): void => {
    if (!question.trim()) return
    setQ('')
    // With the offline AI, money questions stay on this computer.
    void askEverything(question, { private: true })
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
      {offline ? (
        <p className="money-hint">
          The offline AI answers from your money tracker{moneyOn ? '' : ' (switched off on the Ask everything page, so it can’t see it yet)'}, privately: it runs on
          this computer, so your money never leaves it.
        </p>
      ) : (
        <p className="money-hint">
          Claude answers from your money tracker{moneyOn ? '' : ' (switched off on the Ask everything page, so it can’t see it yet)'}. Nothing is sent until you
          ask. Needs your Anthropic key in Settings → AI helper, or get the offline AI there to keep it all on this computer.
        </p>
      )}
    </section>
  )
}

/** Goals & bills: savings goals, subscriptions and bills found in your spending, and paydays. */
export default function MoneyPlans() {
  const recurring = useRecurring()
  const goals = useMoney((s) => s.goals)
  const notRecurring = useMoney((s) => s.notRecurring)
  const cancelled = useMoney((s) => s.cancelled)
  const entries = useMoney((s) => s.entries)
  const subs = recurring.filter((r) => !r.income)
  const pay = recurring.filter((r) => r.income)
  const monthly = subs.reduce((n, r) => n + monthlyCost(r), 0)
  const warned = chargedAfterCancelling(recurring, cancelled)
  const cancelledList = Object.entries(cancelled).filter(([key]) => !warned.some((r) => r.key === key))
  // A readable name for each cancelled one: how it last appeared on a statement.
  const names = useMemo(() => {
    const m = new Map<string, string>()
    const keys = new Set(Object.keys(cancelled))
    for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
      const k = payeeKey(e.note)
      if (!e.income && keys.has(k)) m.set(k, e.note)
    }
    return m
  }, [entries, cancelled])

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
        {warned.map((r) => (
          <div key={r.key} className="money-undo money-warn-row" data-charged-again={r.key}>
            ⚠️ {r.name} charged you {formatPounds(r.amount)} on {shortDate(r.last)}, after you marked it cancelled.
            <button className="link-button" onClick={() => setCancelled(r.key, null)}>
              Keep it listed
            </button>
            <button className="link-button" onClick={() => setCancelled(r.key, r.last)}>
              Still cancelled
            </button>
          </div>
        ))}
        {subs.length ? (
          <>
            <div className="money-tiles">
              <div className="money-tile">
                <span>A month</span>
                <strong>{formatPounds(monthly)}</strong>
              </div>
              <div className="money-tile">
                <span>A year</span>
                <strong>{formatPounds(monthly * 12, true)}</strong>
              </div>
              <div className="money-tile">
                <span>Active</span>
                <strong>{subs.length}</strong>
              </div>
            </div>
            <ul className="money-recurring">
              {subs.map((r) => (
                <RecurringRow key={r.manual ?? r.key} r={r} />
              ))}
            </ul>
          </>
        ) : (
          <p className="money-hint">
            Nothing repeating yet. Import a couple of months of bank statements and Orbit spots the payments that come round every week, month or year
            (Netflix, the phone bill, the gym…) and shows them here and on the calendar. Or add one yourself.
          </p>
        )}
        <NewSubscription />
        {cancelledList.length > 0 && (
          <details className="money-cancelled" data-money-cancelled>
            <summary>
              {cancelledList.length} you’ve cancelled
            </summary>
            <ul>
              {cancelledList.map(([key, on]) => (
                <li key={key}>
                  <span>{names.get(key) ?? key}</span>
                  <small>cancelled {shortDate(on)}</small>
                  <button className="link-button" onClick={() => setCancelled(key, null)}>
                    Still have it
                  </button>
                </li>
              ))}
            </ul>
          </details>
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

const EVERY: Record<RepeatInterval, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }

function RecurringRow({ r }: { r: Recurring }) {
  const categories = useMoney((s) => s.categories)
  const [editing, setEditing] = useState(false)
  const cat = categories.find((c) => c.id === r.category)
  const days = Math.round((new Date(`${r.next}T12:00`).getTime() - new Date(`${dayOf(new Date())}T12:00`).getTime()) / 86400000)
  const about = r.edited ? 'edited by you' : r.manual ? 'added by you' : r.fresh ? 'new: 1 payment so far' : `${r.count} payments so far`
  if (editing) {
    return (
      <li className="money-recurring-row money-recurring-editing" data-recurring={r.key}>
        <SubscriptionForm
          start={{ name: r.name, amount: r.amount, interval: r.interval, date: r.next }}
          action="Save"
          hint={r.manual ? undefined : 'Your version is shown instead of what the statements found. Remove it later to go back to theirs.'}
          onDone={(sub) => {
            setEditing(false)
            if (!sub) return
            if (r.manual) updateSubscription(r.manual, sub)
            else addSubscription({ ...sub, category: r.category, replaces: r.key })
          }}
        />
      </li>
    )
  }
  return (
    <li className={`money-recurring-row ${r.fresh ? 'fresh' : ''}`} data-recurring={r.key}>
      <span className="money-swatch" style={{ background: cat?.color ?? '#8a8e9a' }} />
      <span className="money-recurring-name">
        {r.name}
        <small>
          {EVERY[r.interval].toLowerCase()} · {about}
          {cat ? ` · ${cat.name}` : ''}
        </small>
      </span>
      <span className="money-recurring-next" title={r.last ? `Last one ${shortDate(r.last)}` : undefined}>
        {r.income ? 'Next' : 'Due'} {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : shortDate(r.next)}
      </span>
      <strong>{formatPounds(r.amount)}</strong>
      {!r.income && (
        <button className="icon-btn" title="Edit (name, amount, how often, next date)" onClick={() => setEditing(true)} data-edit-sub>
          <Pencil size={13} />
        </button>
      )}
      {r.manual ? (
        <button
          className="icon-btn"
          title={r.edited ? 'Undo your changes (go back to what the statements show)' : 'Remove (cancelled, or added by mistake)'}
          onClick={() => {
            const gone = deleteSubscription(r.manual!)
            if (gone) notify(gone.replaces ? `Put “${gone.name}” back to what the statements show. ${UNDO_KEY} to undo.` : `Removed “${gone.name}”. ${UNDO_KEY} to undo.`, 'info')
          }}
        >
          {r.edited ? <RotateCcw size={13} /> : <Trash2 size={13} />}
        </button>
      ) : (
        <>
          {!r.income && (
            <button className="icon-btn" title="I’ve cancelled this: stop listing it (it comes back with a warning if it charges you again)" onClick={() => setCancelled(r.key, dayOf(new Date()))} data-cancel-sub>
              <Ban size={13} />
            </button>
          )}
          <button className="icon-btn" title={`Not a repeating ${r.income ? 'payment' : 'subscription or bill'}: stop listing it`} onClick={() => setNotRecurring(r.key)}>
            <EyeOff size={13} />
          </button>
        </>
      )}
    </li>
  )
}

type SubDraft = Pick<ManualSubscription, 'name' | 'amount' | 'interval' | 'date'>

/** The name / amount / how often / next payment form, for adding a subscription or editing one. */
function SubscriptionForm({ start, action, hint, onDone }: { start?: SubDraft; action: string; hint?: string; onDone: (sub?: SubDraft) => void }) {
  const [name, setName] = useState(start?.name ?? '')
  const [amount, setAmount] = useState(start ? (start.amount / 100).toFixed(2) : '')
  const [interval, setEvery] = useState<RepeatInterval>(start?.interval ?? 'monthly')
  const [date, setDate] = useState(start?.date ?? dayOf(new Date()))
  const pence = typedPence(amount)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim() || !pence || !date) return
    onDone({ name: name.trim(), amount: pence, interval, date })
  }
  return (
    <form className="money-new-goal money-new-sub" onSubmit={submit} data-new-sub>
      <div className="money-new-goal-row">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it? (NOW TV, gym…)" aria-label="Name" />
        <label className="money-amount">
          £<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9.99" inputMode="decimal" aria-label="Amount" />
        </label>
        <select className="select" value={interval} onChange={(e) => setEvery(e.target.value as RepeatInterval)} aria-label="How often">
          {(Object.keys(EVERY) as RepeatInterval[]).map((k) => (
            <option key={k} value={k}>
              {EVERY[k]}
            </option>
          ))}
        </select>
        <label className="money-goal-due">
          Next payment
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn btn-primary" disabled={!name.trim() || !pence || !date}>
          {action === 'Add' ? <Plus size={13} /> : <Check size={13} />} {action}
        </button>
        <button type="button" className="icon-btn" title="Cancel" onClick={() => onDone()}>
          <X size={13} />
        </button>
      </div>
      {hint && <p className="money-hint">{hint}</p>}
    </form>
  )
}

/** "+ Add a subscription": for ones the statements don't show yet, like one you've just started. */
function NewSubscription() {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button className="btn money-add-sub" onClick={() => setOpen(true)} data-add-sub>
        <Plus size={13} /> Add a subscription or bill
      </button>
    )
  }
  return (
    <SubscriptionForm
      action="Add"
      hint="It goes in the totals, the forecast and the calendar. If your statements find it later, yours is the one shown."
      onDone={(sub) => {
        setOpen(false)
        if (sub) addSubscription({ ...sub, category: 'subscriptions' })
      }}
    />
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
          {formatPounds(g.saved, true)} of {formatPounds(g.target, true)}
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
              Put aside {formatPounds(weekly)} a week to get there by {shortDate(g.due)}
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
