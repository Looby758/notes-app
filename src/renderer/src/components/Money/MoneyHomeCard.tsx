import { AlertTriangle, PoundSterling } from 'lucide-react'
import { useMoney, useMoneyView } from '../../store/money'
import { netWorth } from '../../lib/moneyAccounts'
import { dayOf } from '../../lib/money'
import { iouHeadline } from './MoneyAccounts'
import { budgetState, formatPounds, monthName, monthOf, monthTotals } from '../../lib/money'
import { MONEY_TAB, openSpecialTab } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import Private from '../Streamer/Private'
import { useRecurring } from './MoneyPlans'

/** The Home page's "spending this month" box: nothing until the money tracker has something in it. */
export default function MoneyHomeCard() {
  const entries = useMoney((s) => s.entries)
  const categories = useMoney((s) => s.categories)
  const budgets = useMoney((s) => s.budgets)
  const nextBill = useRecurring().find((r) => !r.income)
  const balance = useMoney((s) => s.balance)
  const accounts = useMoney((s) => s.accounts)
  const ious = useMoney((s) => s.ious)
  const nw = netWorth({ entries, balance, accounts, ious }, dayOf(new Date()))
  const iou = iouHeadline(ious)
  const open = (view: string) => (): void => {
    useMoneyView.setState({ view })
    openSpecialTab(MONEY_TAB)
  }
  if (!entries.length && !nw.any && !iou) return null
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
      {nextBill && (
        <div className="money-home-next" data-money-next-bill>
          🧾 Next bill: <Private>{nextBill.name}</Private> <Private>{formatPounds(nextBill.amount)}</Private>,{' '}
          {new Date(`${nextBill.next}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>
      )}
      {(accounts.length > 0 || (nw.any && nw.owedToYou + nw.youOwe > 0)) && (
        <button className="money-home-next link-button" onClick={open('accounts')} data-money-home-net-worth>
          🏦 Net worth: <Private>{formatPounds(nw.total)}</Private>
        </button>
      )}
      {iou && (
        <button className="money-home-next link-button" onClick={open('ious')} data-money-home-iou>
          💸 <Private>{iou.text}</Private>
        </button>
      )}
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
