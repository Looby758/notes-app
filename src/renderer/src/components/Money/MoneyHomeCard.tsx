import { AlertTriangle, PoundSterling } from 'lucide-react'
import { useMoney } from '../../store/money'
import { budgetState, formatPounds, monthName, monthOf, monthTotals } from '../../lib/money'
import { MONEY_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'

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
        <strong>{formatPounds(totals.spent)}</strong>
        <span>
          spent in {monthName(month).split(' ')[0]}
          {totals.received > 0 && `, ${formatPounds(totals.received)} received`}
        </span>
      </div>
      {warnings.map(({ cat, spent, budget }) => (
        <div key={cat.id} className={`money-home-warn budget-${budgetState(spent, budget)}`}>
          <AlertTriangle size={12} />
          {spent > budget
            ? `${cat.name}: ${formatPounds(spent - budget)} over budget`
            : `${cat.name}: only ${formatPounds(budget - spent)} left`}
        </div>
      ))}
    </HomeBox>
  )
}
