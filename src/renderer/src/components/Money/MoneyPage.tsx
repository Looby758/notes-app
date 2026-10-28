import { useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, PoundSterling, Trash2, Upload, X } from 'lucide-react'
import {
  addCategory,
  addEntry,
  deleteCategory,
  deleteEntry,
  importEntries,
  restoreEntry,
  setBudget,
  updateCategory,
  updateEntry,
  useMoney
} from '../../store/money'
import {
  addMonths,
  budgetState,
  CATEGORY_COLORS,
  dayOf,
  detectColumns,
  formatPounds,
  guessCategory,
  importKeys,
  merchantKey,
  monthName,
  monthOf,
  monthTotals,
  niceMax,
  OTHER,
  OTHER_INCOME,
  parseAmount,
  parseCsv,
  readStatement,
  type CsvColumns,
  type MoneyCategory,
  type MoneyEntry
} from '../../lib/money'
import { notify } from '../../store/notify'
import { addHomeCard } from '../../lib/home'
import { readWorkbook } from '../../lib/sheets'
import { statementFromPdf } from '../../lib/pdfStatement'
import MoneyHomeCard from './MoneyHomeCard'

addHomeCard({ id: 'money', order: 25, Card: MoneyHomeCard })

type View = 'overview' | 'entries' | 'import' | 'budgets'
const VIEWS: [View, string][] = [
  ['overview', 'This month'],
  ['entries', 'Spending log'],
  ['import', 'Import statement'],
  ['budgets', 'Budgets & categories']
]

/** "12.50" typed into a box → pence (always positive), or null. */
const typedPence = (text: string): number | null => {
  const p = parseAmount(text)
  return p === null ? null : Math.abs(p)
}
const penceText = (pence: number | undefined): string => (pence ? (pence / 100).toFixed(2).replace(/\.00$/, '') : '')

/** The money tracker: log spending, monthly budgets, charts and importing bank statements. */
export default function MoneyPage() {
  const [view, setView] = useState<View>('overview')
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [editing, setEditing] = useState<MoneyEntry | null>(null)

  return (
    <div className="money-page" data-money-page>
      <div className="money-inner">
        <header className="money-head">
          <h2>
            <PoundSterling size={18} /> Money
          </h2>
          <div className="segmented" role="tablist">
            {VIEWS.map(([id, label]) => (
              <button key={id} role="tab" className={view === id ? 'selected' : ''} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
        </header>
        {(view === 'overview' || view === 'entries') && (
          <>
            <EntryForm key={editing?.id ?? 'new'} editing={editing} done={() => setEditing(null)} month={month} />
            <MonthNav month={month} setMonth={setMonth} />
          </>
        )}
        {view === 'overview' && <Overview month={month} setMonth={setMonth} showBudgets={() => setView('budgets')} />}
        {view === 'entries' && <Entries month={month} edit={setEditing} />}
        {view === 'import' && <Import done={() => setView('entries')} />}
        {view === 'budgets' && <Budgets />}
      </div>
    </div>
  )
}

function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const now = monthOf(new Date())
  return (
    <div className="money-month">
      <button className="icon-btn" title="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
        <ChevronLeft size={16} />
      </button>
      <strong>{monthName(month)}</strong>
      <button className="icon-btn" title="Next month" onClick={() => setMonth(addMonths(month, 1))}>
        <ChevronRight size={16} />
      </button>
      {month !== now && (
        <button className="link-button" onClick={() => setMonth(now)}>
          Back to this month
        </button>
      )}
    </div>
  )
}

function CategorySelect({ value, income, onChange }: { value: string; income: boolean; onChange: (id: string) => void }) {
  const categories = useMoney((s) => s.categories)
  return (
    <select className="select money-category-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {categories
        .filter((c) => !!c.income === income)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </select>
  )
}

/** Adding something you spent or received, or changing one you added before. */
function EntryForm({ editing, done, month }: { editing: MoneyEntry | null; done: () => void; month: string }) {
  const [income, setIncome] = useState(editing?.income ?? false)
  const [amount, setAmount] = useState(penceText(editing?.amount))
  const [category, setCategory] = useState(editing?.category ?? OTHER)
  // New entries go on today when looking at this month, otherwise on the 1st of the month shown.
  const [date, setDate] = useState(editing?.date ?? (month === monthOf(new Date()) ? dayOf(new Date()) : `${month}-01`))
  const [note, setNote] = useState(editing?.note ?? '')
  const amountBox = useRef<HTMLInputElement>(null)
  const categories = useMoney((s) => s.categories)
  const pence = typedPence(amount)

  const switchKind = (toIncome: boolean): void => {
    setIncome(toIncome)
    setCategory(toIncome ? (categories.find((c) => c.income)?.id ?? OTHER_INCOME) : OTHER)
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!pence || !date) return
    const entry = { date, amount: pence, income, category, note: note.trim() }
    if (editing) {
      updateEntry(editing.id, entry)
      done()
    } else {
      addEntry(entry)
      setAmount('')
      setNote('')
      amountBox.current?.focus()
    }
  }

  return (
    <form className={`money-form ${editing ? 'editing' : ''}`} onSubmit={submit}>
      <div className="segmented">
        <button type="button" className={!income ? 'selected' : ''} onClick={() => switchKind(false)}>
          Spent
        </button>
        <button type="button" className={income ? 'selected' : ''} onClick={() => switchKind(true)}>
          Received
        </button>
      </div>
      <label className="money-amount">
        <span>£</span>
        <input
          ref={amountBox}
          className="text-input"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount in pounds"
        />
      </label>
      <CategorySelect value={category} income={income} onChange={setCategory} />
      <input className="text-input money-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      <input
        className="text-input money-note"
        placeholder={income ? 'What was it? (e.g. wages)' : 'What was it? (e.g. Tesco)'}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn btn-primary" type="submit" disabled={!pence || !date}>
        {editing ? 'Save' : <><Plus size={14} /> Add</>}
      </button>
      {editing && (
        <button className="btn" type="button" onClick={done}>
          Cancel
        </button>
      )}
    </form>
  )
}

function Overview({ month, setMonth, showBudgets }: { month: string; setMonth: (m: string) => void; showBudgets: () => void }) {
  const entries = useMoney((s) => s.entries)
  const categories = useMoney((s) => s.categories)
  const budgets = useMoney((s) => s.budgets)
  const totals = useMemo(() => monthTotals(entries, month), [entries, month])
  const left = totals.received - totals.spent
  const spending = categories.filter((c) => !c.income)
  const budgeted = spending.filter((c) => budgets[c.id])
  const byAmount = spending
    .map((c) => ({ cat: c, spent: totals.byCategory.get(c.id) ?? 0 }))
    .filter((x) => x.spent > 0)
    .sort((a, b) => b.spent - a.spent)
  // Entries whose category was deleted on another computer still count, under Other.
  const known = new Set(spending.map((c) => c.id))
  const orphaned = [...totals.byCategory].filter(([id]) => !known.has(id)).reduce((n, [, v]) => n + v, 0)
  if (orphaned) {
    const other = byAmount.find((x) => x.cat.id === OTHER)
    if (other) other.spent += orphaned
    else byAmount.push({ cat: spending.find((c) => c.id === OTHER)!, spent: orphaned })
  }
  const biggest = byAmount[0]?.spent ?? 0

  return (
    <>
      <div className="money-tiles">
        <div className="money-tile">
          <span>Spent</span>
          <strong>{formatPounds(totals.spent)}</strong>
        </div>
        <div className="money-tile">
          <span>Received</span>
          <strong>{formatPounds(totals.received)}</strong>
        </div>
        <div className="money-tile">
          <span>{left >= 0 ? 'Left over' : 'Spent more than received'}</span>
          <strong>{formatPounds(Math.abs(left))}</strong>
        </div>
      </div>

      <section className="money-section">
        <h3>Budgets</h3>
        {budgeted.length ? (
          <ul className="money-budgets">
            {budgeted.map((c) => {
              const spent = totals.byCategory.get(c.id) ?? 0
              const budget = budgets[c.id]
              const state = budgetState(spent, budget)
              return (
                <li key={c.id} className={`budget-${state}`}>
                  <div className="money-budget-row">
                    <span className="money-swatch" style={{ background: c.color }} />
                    <span className="money-budget-name">{c.name}</span>
                    <span className="money-budget-figures">
                      {formatPounds(spent)} of {formatPounds(budget)}
                    </span>
                  </div>
                  <div className="money-budget-bar" title={`${Math.round((spent / budget) * 100)}% of your ${c.name} budget`}>
                    <div style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
                  </div>
                  <div className="money-budget-left">
                    {state === 'over' ? (
                      <>
                        <AlertTriangle size={12} /> {formatPounds(spent - budget)} over budget
                      </>
                    ) : (
                      <>
                        {state === 'near' && <AlertTriangle size={12} />} {formatPounds(budget - spent)} left
                        {state === 'near' && ' (nearly used up)'}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="money-hint">
            No budgets yet.{' '}
            <button className="link-button" onClick={showBudgets}>
              Set a monthly budget for each category
            </button>{' '}
            to see how you're doing here.
          </p>
        )}
      </section>

      <section className="money-section">
        <h3>Where it went</h3>
        {byAmount.length ? (
          <ul className="money-bars">
            {byAmount.map(({ cat, spent }) => (
              <li key={cat.id} title={`${cat.name}: ${formatPounds(spent)} (${Math.round((spent / totals.spent) * 100)}% of spending)`}>
                <span className="money-bar-name">
                  <span className="money-swatch" style={{ background: cat.color }} />
                  {cat.name}
                </span>
                <span className="money-bar-track">
                  <span className="money-bar-fill" style={{ width: `${(spent / biggest) * 100}%`, background: cat.color }} />
                </span>
                <span className="money-bar-value">
                  {formatPounds(spent)} <small>{Math.round((spent / totals.spent) * 100)}%</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="money-hint">Nothing spent in {monthName(month)} yet. Add what you spend above, or import a bank statement.</p>
        )}
      </section>

      <section className="money-section">
        <h3>Month by month</h3>
        <MonthsChart month={month} setMonth={setMonth} />
      </section>
    </>
  )
}

/** Spent and received for the six months up to the one shown. Click a month to see it. */
function MonthsChart({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const entries = useMoney((s) => s.entries)
  const [hover, setHover] = useState<number | null>(null)
  const months = useMemo(() => {
    const list = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5))
    return list.map((m) => ({ month: m, ...monthTotals(entries, m) }))
  }, [entries, month])
  const max = niceMax(Math.max(...months.map((m) => Math.max(m.spent, m.received))))
  const W = 640
  const H = 200
  const left = 52
  const bottom = 24
  const plotH = H - bottom - 8
  const slot = (W - left) / months.length
  const bar = Math.min(22, slot / 3)
  const y = (v: number): number => 8 + plotH - (v / max) * plotH
  const ticks = [0, 0.5, 1].map((f) => f * max)

  return (
    <div className="money-chart">
      <div className="money-legend">
        <span>
          <span className="money-swatch spent" /> Spent
        </span>
        <span>
          <span className="money-swatch received" /> Received
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spent and received over the last six months">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} className="money-grid" />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" className="money-axis">
              {formatPounds(t, true)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = left + slot * i + slot / 2
          return (
            <g
              key={m.month}
              className={`money-col ${m.month === month ? 'current' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setMonth(m.month)}
            >
              <rect x={left + slot * i} y={0} width={slot} height={H} className="money-hit" />
              {m.spent > 0 && <rect x={cx - bar - 1} y={y(m.spent)} width={bar} height={y(0) - y(m.spent)} rx={3} className="money-spent" />}
              {m.received > 0 && <rect x={cx + 1} y={y(m.received)} width={bar} height={y(0) - y(m.received)} rx={3} className="money-received" />}
              <text x={cx} y={H - 6} textAnchor="middle" className="money-axis">
                {new Date(+m.month.slice(0, 4), +m.month.slice(5) - 1, 1).toLocaleDateString('en-GB', { month: 'short' })}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="money-tooltip" style={{ left: `${((left + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{monthName(months[hover].month)}</strong>
          <span>Spent {formatPounds(months[hover].spent)}</span>
          <span>Received {formatPounds(months[hover].received)}</span>
        </div>
      )}
    </div>
  )
}

function Entries({ month, edit }: { month: string; edit: (e: MoneyEntry) => void }) {
  const entries = useMoney((s) => s.entries)
  const categories = useMoney((s) => s.categories)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [deleted, setDeleted] = useState<MoneyEntry | null>(null)
  const names = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const days = useMemo(() => {
    const q = search.trim().toLowerCase()
    const shown = entries
      .filter((e) => e.date.startsWith(month))
      .filter((e) => !filter || e.category === filter)
      .filter((e) => !q || e.note.toLowerCase().includes(q) || (names.get(e.category)?.name ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date))
    const map = new Map<string, MoneyEntry[]>()
    for (const e of shown) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return [...map]
  }, [entries, month, filter, search, names])

  const remove = (id: string): void => setDeleted(deleteEntry(id) ?? null)

  return (
    <section className="money-section">
      <div className="money-filters">
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="text-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {deleted && (
        <div className="money-undo">
          Deleted {deleted.note ? `"${deleted.note}"` : 'that entry'}.
          <button
            className="link-button"
            onClick={() => {
              restoreEntry(deleted)
              setDeleted(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
      {days.length === 0 && <p className="money-hint">Nothing here for {monthName(month)}.</p>}
      {days.map(([day, list]) => (
        <div key={day} className="money-day">
          <h4>{new Date(day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          <ul>
            {list.map((e) => (
              <li key={e.id} className="money-entry">
                <span className="money-swatch" style={{ background: names.get(e.category)?.color ?? '#8a8e9a' }} />
                <span className="money-entry-note">{e.note || <em>No description</em>}</span>
                <CategorySelect value={names.has(e.category) ? e.category : e.income ? OTHER_INCOME : OTHER} income={e.income} onChange={(category) => updateEntry(e.id, { category })} />
                <span className={`money-entry-amount ${e.income ? 'in' : ''}`}>
                  {e.income ? '+' : '−'}
                  {formatPounds(e.amount)}
                </span>
                <button className="icon-btn" title="Change" onClick={() => edit(e)}>
                  <Pencil size={13} />
                </button>
                <button className="icon-btn" title="Delete" onClick={() => remove(e.id)}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** A statement file as rows of cells, whatever kind of file it is. */
async function statementRows(file: File, pdfPassword?: string): Promise<string[][]> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'pdf') {
    const { pdfPages } = await import('../../lib/pdfText')
    const rows = statementFromPdf(await pdfPages(await file.arrayBuffer(), pdfPassword))
    if (!rows.length)
      throw new Error(
        "Couldn't find any payments in that PDF. If it's a scan or photo of a statement, there's no text in it to read."
      )
    return rows
  }
  if (ext === 'xls') throw new Error('That is an old-style Excel file. Open it in Excel and save it as .xlsx or CSV first.')
  if (ext === 'xlsx' || ext === 'xlsm') {
    const sheets = await readWorkbook(await file.arrayBuffer())
    const sheet = sheets.find((s) => !s.hidden) ?? sheets[0]
    return sheet.rows.map((r) => r.map((c) => c.text.trim())).filter((r) => r.some((c) => c))
  }
  return parseCsv(await file.text())
}

interface Preview {
  name: string
  rows: string[][]
  cols: CsvColumns
}

function Import({ done }: { done: () => void }) {
  const entries = useMoney((s) => s.entries)
  const rules = useMoney((s) => s.rules)
  const categories = useMoney((s) => s.categories)
  const [preview, setPreview] = useState<Preview | null>(null)
  /** Categories you changed in the preview, by row number. */
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  /** A PDF waiting for its password. */
  const [locked, setLocked] = useState<{ file: File; wrong: boolean } | null>(null)
  const [password, setPassword] = useState('')

  const open = async (file: File, pdfPassword?: string): Promise<void> => {
    setReading(true)
    try {
      const rows = await statementRows(file, pdfPassword)
      if (!rows.length) throw new Error('That file is empty.')
      setPreview({ name: file.name, rows, cols: detectColumns(rows) })
      setPicked({})
      setSkipped(new Set())
      setLocked(null)
      setPassword('')
    } catch (err) {
      const { PdfPasswordError } = await import('../../lib/pdfText')
      if (err instanceof PdfPasswordError) setLocked({ file, wrong: err.wrong })
      else notify(err)
    } finally {
      setReading(false)
    }
  }

  const statement = useMemo(() => (preview ? readStatement(preview.rows, preview.cols) : []), [preview])
  const keys = useMemo(() => importKeys(statement), [statement])
  const existing = useMemo(() => new Set(entries.map((e) => e.importKey).filter(Boolean)), [entries])
  const fresh = statement.map((_, i) => !existing.has(keys[i]))
  const freshCount = fresh.filter(Boolean).length
  const chosen = statement.map((_, i) => fresh[i] && !skipped.has(i))
  const chosenCount = chosen.filter(Boolean).length
  const categoryOf = (i: number): string => picked[i] ?? guessCategory(statement[i], rules, categories)

  const run = (): void => {
    const rows: Omit<MoneyEntry, 'id'>[] = []
    const learned: Record<string, string> = {}
    statement.forEach((r, i) => {
      if (!chosen[i]) return
      rows.push({ date: r.date, amount: Math.abs(r.amount), income: r.amount > 0, category: categoryOf(i), note: r.description, importKey: keys[i] })
      const key = merchantKey(r.description)
      if (picked[i] && key) learned[key] = picked[i]
    })
    importEntries(rows, learned)
    notify(`Added ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} from ${preview!.name}.`, 'info')
    setPreview(null)
    done()
  }

  const header = preview && preview.cols.headerRow >= 0 ? preview.rows[preview.cols.headerRow] : null
  const width = preview ? Math.max(...preview.rows.slice(0, 30).map((r) => r.length)) : 0
  const columnName = (i: number): string => (header?.[i] ? header[i] : `Column ${i + 1}`)
  const setCols = (change: Partial<CsvColumns>): void => setPreview((p) => p && { ...p, cols: { ...p.cols, ...change } })
  const columnPick = (label: string, value: number, field: keyof CsvColumns, optional = false) => (
    <label>
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => setCols({ [field]: +e.target.value })}>
        {optional && <option value={-1}>(none)</option>}
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            {columnName(i)}
          </option>
        ))}
      </select>
    </label>
  )
  const split = preview ? preview.cols.paidOut >= 0 || preview.cols.paidIn >= 0 : false

  return (
    <section className="money-section">
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,text/csv,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void open(file)
          e.target.value = ''
        }}
      />
      {locked ? (
        <form
          className="money-import-start"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void open(locked.file, password)
          }}
        >
          <p>
            <strong>{locked.file.name}</strong> is protected with a password. Banks often use something like your date of
            birth or part of your account number; the letter or email that came with it usually says which.
          </p>
          {locked.wrong && <p className="money-hint">That password didn't work. Try again?</p>}
          <div className="money-new-cat">
            <input
              className="text-input"
              type="password"
              placeholder="PDF password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!password || reading}>
              Open
            </button>
            <button className="btn" type="button" onClick={() => setLocked(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : !preview ? (
        <div className="money-import-start">
          <p>
            Choose a statement you've downloaded from your bank's website or app: a <strong>PDF</strong>, a{' '}
            <strong>CSV</strong> file or an <strong>Excel</strong> spreadsheet. You'll see the entries to check before
            they're added.
          </p>
          <p className="money-hint">
            Statements are read on this computer and never sent anywhere. Anything you've imported before is skipped, so
            it's fine to import overlapping statements. Categories are guessed from the shop's name, and when you change
            one, it's remembered for next time.
          </p>
          <button className="btn btn-primary" disabled={reading} onClick={() => fileInput.current?.click()}>
            <Upload size={14} /> {reading ? 'Reading statement…' : 'Choose a statement…'}
          </button>
        </div>
      ) : (
        <>
          <div className="money-import-head">
            <strong>{preview.name}</strong>
            <button className="icon-btn" title="Choose a different file" onClick={() => setPreview(null)}>
              <X size={14} />
            </button>
          </div>
          <details className="money-columns" open={!statement.length}>
            <summary>Columns (change these if the entries below look wrong)</summary>
            <div className="money-columns-grid">
              {columnPick('Date', preview.cols.date, 'date')}
              {columnPick('Description', preview.cols.description, 'description')}
              <label>
                <span>Amounts</span>
                <select
                  className="select"
                  value={split ? 'split' : 'one'}
                  onChange={(e) =>
                    e.target.value === 'split'
                      ? setCols({ paidOut: Math.max(0, preview.cols.amount), paidIn: Math.max(0, preview.cols.amount), amount: -1 })
                      : setCols({ amount: Math.max(0, preview.cols.paidOut), paidOut: -1, paidIn: -1 })
                  }
                >
                  <option value="one">In one column</option>
                  <option value="split">Separate "paid out" and "paid in" columns</option>
                </select>
              </label>
              {split ? (
                <>
                  {columnPick('Paid out', preview.cols.paidOut, 'paidOut', true)}
                  {columnPick('Paid in', preview.cols.paidIn, 'paidIn', true)}
                </>
              ) : (
                <>
                  {columnPick('Amount', preview.cols.amount, 'amount')}
                  <label className="money-flip">
                    <input type="checkbox" checked={preview.cols.flip} onChange={(e) => setCols({ flip: e.target.checked })} />
                    <span>Spending shows as positive numbers (common for credit cards)</span>
                  </label>
                </>
              )}
            </div>
          </details>
          {statement.length === 0 ? (
            <p className="money-hint">No entries found with these columns. Try changing them above.</p>
          ) : (
            <>
              <p className="money-hint">
                {freshCount} new {freshCount === 1 ? 'entry' : 'entries'}
                {statement.length > freshCount && `, ${statement.length - freshCount} already added before (skipped)`}. Untick
                any you don't want.
              </p>
              <div className="money-import-table">
                <table>
                  <tbody>
                    {statement.map((r, i) => (
                      <tr key={i} className={fresh[i] ? (chosen[i] ? '' : 'skipped') : 'already'}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!fresh[i]}
                            checked={chosen[i]}
                            onChange={() =>
                              setSkipped((s) => {
                                const next = new Set(s)
                                if (!next.delete(i)) next.add(i)
                                return next
                              })
                            }
                          />
                        </td>
                        <td className="money-import-date">{new Date(r.date + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="money-import-desc">{r.description}</td>
                        <td>
                          {fresh[i] ? (
                            <CategorySelect value={categoryOf(i)} income={r.amount > 0} onChange={(id) => setPicked((p) => ({ ...p, [i]: id }))} />
                          ) : (
                            <span className="money-hint">Already added</span>
                          )}
                        </td>
                        <td className={`money-entry-amount ${r.amount > 0 ? 'in' : ''}`}>
                          {r.amount > 0 ? '+' : '−'}
                          {formatPounds(Math.abs(r.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="money-import-actions">
                <button className="btn btn-primary" disabled={!chosenCount} onClick={run}>
                  Add {chosenCount} {chosenCount === 1 ? 'entry' : 'entries'}
                </button>
                <button className="btn" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function Budgets() {
  const categories = useMoney((s) => s.categories)
  const budgets = useMoney((s) => s.budgets)
  const spending = categories.filter((c) => !c.income)
  const incoming = categories.filter((c) => c.income)
  const total = spending.reduce((n, c) => n + (budgets[c.id] ?? 0), 0)

  return (
    <>
      <section className="money-section">
        <h3>Spending categories and monthly budgets</h3>
        <p className="money-hint">
          Leave a budget empty if you don't want one for that category.
          {total > 0 && ` Your budgets add up to ${formatPounds(total)} a month.`}
        </p>
        <ul className="money-cats">
          {spending.map((c) => (
            <CategoryRow key={c.id} cat={c} budget={budgets[c.id]} />
          ))}
        </ul>
        <NewCategory income={false} />
      </section>
      <section className="money-section">
        <h3>Money coming in</h3>
        <ul className="money-cats">
          {incoming.map((c) => (
            <CategoryRow key={c.id} cat={c} />
          ))}
        </ul>
        <NewCategory income />
      </section>
    </>
  )
}

function CategoryRow({ cat, budget }: { cat: MoneyCategory; budget?: number }) {
  const [name, setName] = useState(cat.name)
  const [amount, setAmount] = useState(penceText(budget))
  const fixed = cat.id === OTHER || cat.id === OTHER_INCOME
  return (
    <li>
      <input
        type="color"
        className="money-color"
        value={cat.color}
        title="Colour"
        onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
      />
      <input
        className="text-input money-cat-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? name.trim() !== cat.name && updateCategory(cat.id, { name: name.trim() }) : setName(cat.name))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Category name"
      />
      {!cat.income && (
        <label className="money-amount">
          <span>£</span>
          <input
            className="text-input"
            inputMode="decimal"
            placeholder="No budget"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const p = typedPence(amount) ?? 0
              if (p !== (budget ?? 0)) setBudget(cat.id, p)
              setAmount(penceText(p))
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label={`Monthly budget for ${cat.name}`}
          />
          <span className="money-hint">a month</span>
        </label>
      )}
      {!fixed && (
        <button
          className="icon-btn"
          title={`Delete (anything in ${cat.name} moves to ${cat.income ? 'Other income' : 'Other'})`}
          onClick={() => deleteCategory(cat.id)}
        >
          <Trash2 size={13} />
        </button>
      )}
    </li>
  )
}

function NewCategory({ income }: { income: boolean }) {
  const categories = useMoney((s) => s.categories)
  const [name, setName] = useState('')
  const add = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    const used = categories.filter((c) => !!c.income === income).length
    addCategory({ name: name.trim(), color: CATEGORY_COLORS[used % CATEGORY_COLORS.length], ...(income ? { income: true } : {}) })
    setName('')
  }
  return (
    <form className="money-new-cat" onSubmit={add}>
      <input className="text-input" placeholder={income ? 'New income category' : 'New spending category'} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn" type="submit" disabled={!name.trim()}>
        <Plus size={14} /> Add
      </button>
    </form>
  )
}
