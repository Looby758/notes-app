import { AlertTriangle, PoundSterling } from 'lucide-react'
import { useMoney } from '../../store/money'
import { budgetState, formatPounds, monthName, monthOf, monthTotals } from '../../lib/money'
import { MONEY_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import Private from '../Streamer/Private'

/** The Home page's "spending this month" box: nothing until the money tracker has something in it. */
export default function MoneyHomeCard() {
  const entries = useMoney((s) => s.entries)
  const categories = useMoney((s) => s.categories)
  const budgets = useMoney((s) => s.budgets)
  if (!entries.length) return null
  const month = monthOf(new Date())
  const totals = monthTotals(entries, month)
  const warnings = categories
    .filter((c) => !c.income && budgets[c.id])
    .map((c) => ({ cat: c, spent: totals.byCategory.get(c.id) ?? 0, budget: budgets[c.id] }))
    .filter((x) => budgetState(x.spent, x.budget) !== 'ok')
  return (
    <HomeBox
      icon={<PoundSterling size={15} />}
      title="Spending this month"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(MONEY_TAB)}>
          Money
        </button>
      }
    >
      <div className="money-home">
        <strong>
          <Private>{formatPounds(totals.spent)}</Private>
        </strong>
        <span>
          spent in {monthName(month).split(' ')[0]}
          {totals.received > 0 && (
            <>
              , <Private>{formatPounds(totals.received)}</Private> received
            </>
          )}
        </span>
      </div>
      {warnings.map(({ cat, spent, budget }) => (
        <div key={cat.id} className={`money-home-warn budget-${budgetState(spent, budget)}`}>
          <AlertTriangle size={12} />
          {cat.name}:{' '}
          {spent > budget ? (
            <>
              <Private>{formatPounds(spent - budget)}</Private> over budget
            </>
          ) : (
            <>
              only <Private>{formatPounds(budget - spent)}</Private> left
            </>
          )}
        </div>
      ))}
    </HomeBox>
  )
}
