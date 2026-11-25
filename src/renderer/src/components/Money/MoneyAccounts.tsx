import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BellRing, Check, Copy, HandCoins, Landmark, Pencil, Plus, Split, Trash2, Users, Wallet, X } from 'lucide-react'
import {
  addAccount,
  addIous,
  deleteAccount,
  deleteIou,
  payBackIou,
  reopenIou,
  setBalance,
  settleIou,
  snapshot,
  updateAccount,
  updateIou,
  useMoney
} from '../../store/money'
import { notify } from '../../store/notify'
import { UNDO_KEY } from '../../lib/undo'
import { dayOf, formatPounds, parseAmount, type Account, type AccountKind, type Iou } from '../../lib/money'
import {
  ACCOUNT_KINDS,
  addDays,
  byPerson,
  changeOver,
  daysBetween,
  historyFor,
  iouLeft,
  kindInfo,
  netWorth,
  nudgeText,
  readNames,
  splitEvenly
} from '../../lib/moneyAccounts'

const shortDate = (key: string): string => new Date(`${key}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const longDate = (key: string): string => new Date(`${key}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}
const ago = (day: string, today: string): string => {
  const n = daysBetween(day, today)
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? `${n} days ago` : `on ${shortDate(day)}`
}
const signed = (pence: number): string => `${pence > 0 ? '+' : pence < 0 ? '−' : ''}${formatPounds(Math.abs(pence))}`

// ---------------------------------------------------------------- accounts & net worth

/** Accounts: your current account, savings, cash and cards, what it all adds up to, and that total over time. */
export function NetWorthView() {
  const entries = useMoney((s) => s.entries)
  const balance = useMoney((s) => s.balance)
  const accounts = useMoney((s) => s.accounts)
  const ious = useMoney((s) => s.ious)
  const history = useMoney((s) => s.netWorth)
  const today = dayOf(new Date())
  const nw = useMemo(() => netWorth({ entries, balance, accounts, ious }, today), [entries, balance, accounts, ious, today])
  const month = changeOver(history, today, 30, nw.total)

  // Opening the page counts as a look at today's total.
  useEffect(() => snapshot(), [])

  return (
    <>
      <div className="money-tiles money-tiles-4" data-net-worth>
        <div className="money-tile money-tile-main">
          <span>Net worth</span>
          <strong>{nw.any ? formatPounds(nw.total) : '–'}</strong>
          {month !== null && nw.any && (
            <small className={month >= 0 ? 'up' : 'down'} title="Compared with 30 days ago">
              {signed(month)} in 30 days
            </small>
          )}
        </div>
        <div className="money-tile">
          <span>In your accounts</span>
          <strong>{formatPounds(nw.inAccounts)}</strong>
        </div>
        <div className="money-tile">
          <span>Owed to you</span>
          <strong>{formatPounds(nw.owedToYou)}</strong>
        </div>
        <div className="money-tile">
          <span>You owe</span>
          <strong>{formatPounds(nw.youOwe)}</strong>
        </div>
      </div>

      <section className="money-section" data-net-worth-chart>
        <h3>
          <Landmark size={15} /> Over time
        </h3>
        <NetWorthChart today={today} now={nw.any ? nw.total : null} />
      </section>

      <section className="money-section" data-accounts>
        <h3>
          <Wallet size={15} /> Accounts
        </h3>
        <ul className="money-accounts">
          <CurrentAccountRow now={nw.current} today={today} />
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} today={today} />
          ))}
        </ul>
        <NewAccount />
        <p className="money-hint">
          Balances stay in your notes folder on this computer, like the rest of the money tracker. Your current account follows what you log and import; the others
          are what you last typed in, so update them now and then (Orbit adds the total up each day you use it and draws the line above). IOUs count too: what
          you’re owed is added and what you owe is taken off.
        </p>
      </section>
    </>
  )
}

const RANGES: [number, string][] = [
  [30, '1M'],
  [91, '3M'],
  [365, '1Y'],
  [0, 'All']
]
const RANGE_WORDS: Record<number, string> = { 30: 'in the last month', 91: 'in the last 3 months', 365: 'in the last year', 0: 'since you started' }

/** The total over time, as a line. Hover for the figure on a day. */
function NetWorthChart({ today, now }: { today: string; now: number | null }) {
  const history = useMoney((s) => s.netWorth)
  const [days, setDays] = useState(91)
  const [hover, setHover] = useState<number | null>(null)
  const points = historyFor(history, today, days)
  if (points.length < 2 || now === null) {
    return (
      <p className="money-hint" data-net-worth-empty>
        {now === null
          ? 'Add your accounts below and Orbit adds up what you have each day, so you can watch it grow.'
          : 'Orbit adds up what you have each day you use it, so the line starts tomorrow. Come back in a few days to see it move.'}
      </p>
    )
  }
  const W = 640
  const H = 180
  const PAD = { l: 64, r: 12, t: 12, b: 24 }
  const first = days ? addDays(today, -days) < points[0].date ? points[0].date : addDays(today, -days) : points[0].date
  const span = Math.max(1, daysBetween(first, today))
  const values = points.map((p) => p.total)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi === lo) {
    hi += 5000
    lo -= 5000
  }
  const pad = (hi - lo) * 0.12
  lo -= pad
  hi += pad
  const x = (day: string): number => PAD.l + (Math.max(0, daysBetween(first, day)) / span) * (W - PAD.l - PAD.r)
  const y = (v: number): number => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  // A step line: a total holds until the next day it was added up. It runs on to today.
  let d = ''
  points.forEach((p, i) => {
    const px = x(p.date)
    const py = y(p.total)
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`
  })
  d += `H${x(today)}`
  const area = `${d}V${H - PAD.b}H${x(points[0].date)}Z`
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad]
  const shown = hover !== null ? points[hover] : null
  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - mx) < Math.abs(x(points[best].date) - mx)) best = i
    })
    setHover(best)
  }
  return (
    <div className="money-nw-chart">
      <div className="segmented money-nw-ranges">
        {RANGES.map(([n, label]) => (
          <button key={label} className={days === n ? 'selected' : ''} onClick={() => setDays(n)}>
            {label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net worth over time" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end">
              {formatPounds(Math.round(t), true)}
            </text>
          </g>
        ))}
        {lo < 0 && hi > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="zero" />}
        <path d={area} className="area" />
        <path d={d} className="line" />
        <text x={PAD.l} y={H - 6}>
          {shortDate(first)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">
          Today
        </text>
        {shown && (
          <g>
            <line x1={x(shown.date)} x2={x(shown.date)} y1={PAD.t} y2={H - PAD.b} className="cursor" />
            <circle cx={x(shown.date)} cy={y(shown.total)} r={4} className="dot" />
          </g>
        )}
      </svg>
      <div className="money-nw-readout">
        {shown ? (
          <>
            <strong>{formatPounds(shown.total)}</strong> on {longDate(shown.date)}
          </>
        ) : (
          <>
            {(() => {
              const c = changeOver(history, today, days || daysBetween(points[0].date, today), now)
              return c === null ? 'Hover over the line to see a day.' : `${signed(c)} ${RANGE_WORDS[days]}`
            })()}
          </>
        )}
      </div>
    </div>
  )
}

/** "How much is in it?" for one account. */
function AmountForm({ start, credit, onDone }: { start?: number; credit?: boolean; onDone: (pence?: number) => void }) {
  const [text, setText] = useState(start !== undefined ? (Math.abs(credit ? -start : start) / 100).toFixed(2) : '')
  const p = credit ? typedPence(text) : parseAmount(text)
  return (
    <form
      className="money-account-amount"
      onSubmit={(e) => {
        e.preventDefault()
        if (p !== null) onDone(credit ? -p : p)
      }}
    >
      <label className="money-amount">
        {credit ? 'Owed on it £' : '£'}
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onDone()}
          placeholder={credit ? '250.00' : '0.00'}
          inputMode="decimal"
          aria-label="Balance"
        />
      </label>
      <button className="icon-btn" title="Save" disabled={p === null}>
        <Check size={14} />
      </button>
      <button type="button" className="icon-btn" title="Cancel" onClick={() => onDone()}>
        <X size={14} />
      </button>
    </form>
  )
}

function CurrentAccountRow({ now, today }: { now: number | null; today: string }) {
  const balance = useMoney((s) => s.balance)
  const [editing, setEditing] = useState(false)
  return (
    <li className="money-account" data-account="current">
      <span className="money-account-icon">🏦</span>
      <span className="money-account-name">
        Current account
        <small>{balance ? `follows your spending log · you last set it ${ago(balance.date, today)}` : 'not set yet: the one you spend from'}</small>
      </span>
      {editing ? (
        <AmountForm
          start={now ?? undefined}
          onDone={(p) => {
            if (p !== undefined) setBalance({ amount: p, date: today })
            setEditing(false)
          }}
        />
      ) : now === null ? (
        <button className="btn btn-primary" onClick={() => setEditing(true)} data-set-current>
          Set its balance
        </button>
      ) : (
        <>
          <strong className={now < 0 ? 'negative' : ''}>{formatPounds(now)}</strong>
          <button className="icon-btn" title="Update the balance" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </button>
          {/* Lines the figure up with the other accounts, which have a remove button here. */}
          <span className="money-account-spacer" />
        </>
      )}
    </li>
  )
}

function AccountRow({ account: a, today }: { account: Account; today: string }) {
  const [editing, setEditing] = useState(false)
  const info = kindInfo(a.kind)
  const stale = daysBetween(a.date, today) > 31
  return (
    <li className="money-account" data-account={a.id}>
      <span className="money-account-icon">{info.emoji}</span>
      <span className="money-account-name">
        <input className="money-goal-name" value={a.name} onChange={(e) => updateAccount(a.id, { name: e.target.value })} aria-label="Account name" />
        <small className={stale ? 'stale' : ''}>
          {info.name.toLowerCase()} · updated {ago(a.date, today)}
          {stale ? ', worth checking' : ''}
        </small>
      </span>
      {editing ? (
        <AmountForm
          start={a.amount}
          credit={a.kind === 'credit'}
          onDone={(p) => {
            if (p !== undefined) updateAccount(a.id, { amount: p, date: today })
            setEditing(false)
          }}
        />
      ) : (
        <>
          <strong className={a.amount < 0 ? 'negative' : ''}>{formatPounds(a.amount)}</strong>
          <button className="icon-btn" title="Update the balance" onClick={() => setEditing(true)} data-update-account>
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn"
            title="Remove this account"
            onClick={() => {
              const gone = deleteAccount(a.id)
              if (gone) notify(`Removed “${gone.name}”. ${UNDO_KEY} to undo.`, 'info')
            }}
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </li>
  )
}

function NewAccount() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<AccountKind>('savings')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const credit = kind === 'credit'
  const p = credit ? typedPence(amount) : parseAmount(amount)
  if (!open) {
    return (
      <button className="btn money-add-sub" onClick={() => setOpen(true)} data-add-account>
        <Plus size={13} /> Add savings, cash or a card
      </button>
    )
  }
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (p === null) return
    addAccount({ kind, name: name.trim() || kindInfo(kind).name, amount: credit ? -p : p, date: dayOf(new Date()) })
    setName('')
    setAmount('')
    setOpen(false)
  }
  return (
    <form className="money-new-goal money-new-account" onSubmit={submit} data-new-account>
      <div className="money-new-goal-row">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} aria-label="Kind of account">
          {ACCOUNT_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.emoji} {k.name}
            </option>
          ))}
        </select>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={credit ? 'Name (e.g. Barclaycard)' : 'Name (e.g. Monzo savings pot)'} />
        <label className="money-amount">
          {credit ? 'Owed £' : '£'}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" aria-label="Balance" />
        </label>
        <button className="btn btn-primary" disabled={p === null}>
          <Plus size={13} /> Add
        </button>
        <button type="button" className="icon-btn" title="Cancel" onClick={() => setOpen(false)}>
          <X size={13} />
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- IOUs

/** IOUs: who owes you and who you owe, splitting a bill, and a reminder to chase it up. */
export function IousView() {
  const ious = useMoney((s) => s.ious)
  const people = useMemo(() => byPerson(ious), [ious])
  const settled = ious.filter((i) => i.settled).sort((a, b) => (b.settled ?? '').localeCompare(a.settled ?? ''))
  const owedToYou = people.filter((p) => p.net > 0).reduce((n, p) => n + p.net, 0)
  const youOwe = people.filter((p) => p.net < 0).reduce((n, p) => n - p.net, 0)
  return (
    <>
      <NewIou />
      {people.length > 0 && (
        <div className="money-tiles">
          <div className="money-tile">
            <span>Owed to you</span>
            <strong className="up">{formatPounds(owedToYou)}</strong>
          </div>
          <div className="money-tile">
            <span>You owe</span>
            <strong className={youOwe ? 'down' : ''}>{formatPounds(youOwe)}</strong>
          </div>
          <div className="money-tile">
            <span>People</span>
            <strong>{people.length}</strong>
          </div>
        </div>
      )}
      <section className="money-section" data-ious>
        <h3>
          <Users size={15} /> Who owes who
        </h3>
        {people.length ? (
          <ul className="money-people">
            {people.map((p) => (
              <PersonCard key={p.person.toLowerCase()} person={p.person} net={p.net} ious={p.ious} />
            ))}
          </ul>
        ) : (
          <p className="money-hint">
            All square: nobody owes you and you don’t owe anyone. Paid for a takeaway? Use <strong>Split a bill</strong> above and Orbit works out each share and
            reminds you to chase it up.
          </p>
        )}
      </section>
      {settled.length > 0 && (
        <details className="money-cancelled" data-ious-settled>
          <summary>{settled.length} settled</summary>
          <ul>
            {settled.slice(0, 50).map((i) => (
              <li key={i.id}>
                <span>
                  {i.theyOwe ? `${i.person} paid you` : `You paid ${i.person}`} {formatPounds(i.amount)}
                  {i.note ? ` · ${i.note}` : ''}
                </span>
                <small>settled {shortDate(i.settled!)}</small>
                <button className="link-button" onClick={() => reopenIou(i.id)}>
                  Not paid after all
                </button>
                <button className="icon-btn" title="Delete for good" onClick={() => deleteIou(i.id)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function PersonCard({ person, net, ious }: { person: string; net: number; ious: Iou[] }) {
  const owedYou = ious.some((i) => i.theyOwe)
  const copy = (): void => {
    void navigator.clipboard.writeText(nudgeText(person, ious, formatPounds)).then(
      () => notify('Copied a friendly reminder: paste it into Discord or a text.', 'info'),
      notify
    )
  }
  return (
    <li className={`money-person ${net > 0 ? 'owes-you' : net < 0 ? 'you-owe' : ''}`} data-person={person}>
      <div className="money-person-head">
        <span className="money-person-avatar">{person.slice(0, 1).toUpperCase()}</span>
        <span className="money-person-name">
          {person}
          <small>{net > 0 ? `owes you ${formatPounds(net)}` : net < 0 ? `you owe ${formatPounds(-net)}` : 'all square'}</small>
        </span>
        {owedYou && (
          <button className="btn" onClick={copy} title="Copy a friendly message asking for it back" data-nudge>
            <Copy size={13} /> Copy a nudge
          </button>
        )}
      </div>
      <ul className="money-ious">
        {ious.map((i) => (
          <IouRow key={i.id} iou={i} />
        ))}
      </ul>
    </li>
  )
}

function IouRow({ iou: i }: { iou: Iou }) {
  const [paying, setPaying] = useState(false)
  const [part, setPart] = useState('')
  const today = dayOf(new Date())
  const left = iouLeft(i)
  const p = typedPence(part)
  return (
    <li className={`money-iou ${i.theyOwe ? 'in' : 'out'}`} data-iou={i.id}>
      <span className="money-iou-what">
        {i.note || (i.theyOwe ? 'Owes you' : 'You owe')}
        <small>
          {i.theyOwe ? 'they owe you' : 'you owe them'} · {shortDate(i.date)}
          {i.paid > 0 && ` · ${formatPounds(i.paid)} of ${formatPounds(i.amount)} paid back`}
        </small>
      </span>
      <label className={`money-iou-remind ${i.remind && i.remind <= today ? 'due' : ''}`} title="Remind me on this day">
        <BellRing size={12} />
        <input type="date" value={i.remind} onChange={(e) => updateIou(i.id, { remind: e.target.value })} aria-label="Remind me on" />
      </label>
      <strong>{formatPounds(left)}</strong>
      {paying ? (
        <form
          className="money-goal-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!p) return
            payBackIou(i.id, p)
            setPaying(false)
            setPart('')
          }}
        >
          <span>£</span>
          <input autoFocus value={part} onChange={(e) => setPart(e.target.value)} placeholder={(left / 100).toFixed(2)} inputMode="decimal" aria-label="Amount paid back" />
          <button className="icon-btn" title="Paid back this much" disabled={!p}>
            <Check size={13} />
          </button>
          <button type="button" className="icon-btn" title="Cancel" onClick={() => setPaying(false)}>
            <X size={13} />
          </button>
        </form>
      ) : (
        <>
          <button className="btn" onClick={() => settleIou(i.id)} title={i.theyOwe ? 'They paid you back' : 'You paid them back'} data-settle>
            <Check size={13} /> Paid
          </button>
          <button className="icon-btn" title="Some of it paid back" onClick={() => setPaying(true)}>
            <HandCoins size={13} />
          </button>
          <button
            className="icon-btn"
            title="Delete (added by mistake)"
            onClick={() => {
              if (deleteIou(i.id)) notify(`Deleted. ${UNDO_KEY} to undo.`, 'info')
            }}
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </li>
  )
}

type Mode = 'owes-me' | 'i-owe' | 'split'

/** Adding an IOU, or splitting a bill between friends. */
function NewIou() {
  const [mode, setMode] = useState<Mode>('split')
  const [who, setWho] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [payer, setPayer] = useState('me')
  const [remindOn, setRemindOn] = useState(true)
  const [remind, setRemind] = useState(() => addDays(dayOf(new Date()), 7))
  const pence = typedPence(amount)
  const names = readNames(who)
  const split = mode === 'split'
  const shares = split && pence && names.length ? splitEvenly(pence, names.length + 1) : []
  // The odd penny goes to the friends, not you.
  const yourShare = shares.length ? shares[shares.length - 1] : 0
  const payerName = names.find((n) => n.toLowerCase() === payer) ?? null
  const ready = !!pence && names.length > 0 && (!split || payer === 'me' || !!payerName)

  const preview = (): string => {
    if (!pence || !names.length) return ''
    if (!split) return mode === 'owes-me' ? `${names.join(', ')} ${names.length > 1 ? 'each owe' : 'owes'} you ${formatPounds(pence)}` : `You owe ${names.join(', ')} ${formatPounds(pence)}${names.length > 1 ? ' each' : ''}`
    const each = shares.slice(0, -1)
    const same = each.every((s) => s === each[0])
    if (payer === 'me') {
      return `${formatPounds(pence)} between ${names.length + 1}: ${
        same ? `${names.join(', ')} ${names.length > 1 ? 'each owe' : 'owes'} you ${formatPounds(each[0])}` : names.map((n, k) => `${n} owes ${formatPounds(each[k])}`).join(', ')
      }`
    }
    return payerName ? `${formatPounds(pence)} between ${names.length + 1}: you owe ${payerName} ${formatPounds(yourShare)}` : ''
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!ready || !pence) return
    const base = { note: note.trim(), date: dayOf(new Date()), remind: remindOn ? remind : '' }
    let made: Omit<Iou, 'id' | 'paid'>[]
    if (!split) made = names.map((person) => ({ ...base, person, amount: pence, theyOwe: mode === 'owes-me' }))
    else if (payer === 'me') made = names.map((person, k) => ({ ...base, person, amount: shares[k], theyOwe: true }))
    else made = [{ ...base, person: payerName!, amount: yourShare, theyOwe: false }]
    addIous(made)
    notify(`${preview()}.${base.remind ? ` Orbit reminds you on ${shortDate(base.remind)}.` : ''}`, 'info')
    setWho('')
    setAmount('')
    setNote('')
    setPayer('me')
  }

  return (
    <form className="money-new-iou" onSubmit={submit} data-new-iou>
      <div className="segmented">
        <button type="button" className={split ? 'selected' : ''} onClick={() => setMode('split')}>
          <Split size={13} /> Split a bill
        </button>
        <button type="button" className={mode === 'owes-me' ? 'selected' : ''} onClick={() => setMode('owes-me')}>
          Someone owes me
        </button>
        <button type="button" className={mode === 'i-owe' ? 'selected' : ''} onClick={() => setMode('i-owe')}>
          I owe someone
        </button>
      </div>
      <div className="money-new-goal-row">
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={split ? 'Who else was in? (Sam, Jo, Alex)' : 'Who? (Sam)'} aria-label="Who" />
        <label className="money-amount">
          {split ? 'Total £' : '£'}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={split ? '34.50' : '8.50'} inputMode="decimal" aria-label="Amount" />
        </label>
        <input className="money-iou-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What for? (Takeaway)" aria-label="What for" />
      </div>
      <div className="money-new-goal-row money-iou-options">
        {split && (
          <label className="money-goal-due">
            Who paid?
            <select className="select" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Who paid">
              <option value="me">I did</option>
              {names.map((n) => (
                <option key={n} value={n.toLowerCase()}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="money-goal-due">
          <input type="checkbox" checked={remindOn} onChange={(e) => setRemindOn(e.target.checked)} /> Remind me on
          <input type="date" value={remind} disabled={!remindOn} onChange={(e) => setRemind(e.target.value)} aria-label="Reminder date" />
        </label>
        <button className="btn btn-primary" disabled={!ready}>
          <Plus size={13} /> Add
        </button>
      </div>
      {preview() && (
        <p className="money-iou-preview" data-iou-preview>
          {preview()}
        </p>
      )}
    </form>
  )
}

/** A word to show on the Home box: "Sam owes you £8.50" or "You owe Jo £4". */
export function iouHeadline(ious: Iou[]): { text: string; theyOwe: boolean } | null {
  const top = byPerson(ious)[0]
  if (!top || !top.net) return null
  return top.net > 0 ? { text: `${top.person} owes you ${formatPounds(top.net)}`, theyOwe: true } : { text: `You owe ${top.person} ${formatPounds(-top.net)}`, theyOwe: false }
}

