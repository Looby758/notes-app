import { describe, expect, it } from 'vitest'
import { emptyMoney, formatPounds, readMoney, type Iou } from './money'
import {
  balanceNow,
  byPerson,
  changeOver,
  dueIouReminders,
  historyFor,
  iouTotals,
  netWorth,
  nudgeText,
  readNames,
  recordNetWorth,
  splitEvenly
} from './moneyAccounts'

const iou = (over: Partial<Iou>): Iou => ({ id: Math.random().toString(36), person: 'Sam', amount: 1000, theyOwe: true, note: '', date: '2026-11-01', paid: 0, remind: '', ...over })

describe('net worth', () => {
  const entries = [
    { id: 'a', date: '2026-11-10', amount: 2000, income: false, category: 'other', note: 'Tesco' },
    { id: 'b', date: '2026-11-12', amount: 50000, income: true, category: 'pay', note: 'Wages' },
    { id: 'c', date: '2026-11-25', amount: 999, income: false, category: 'other', note: 'Later' }
  ]

  it('follows the current account from the balance you set', () => {
    expect(balanceNow(entries, { amount: 10000, date: '2026-11-09' }, '2026-11-20')).toBe(10000 - 2000 + 50000)
    // Entries on or before the day you set it are already in it.
    expect(balanceNow(entries, { amount: 10000, date: '2026-11-10' }, '2026-11-20')).toBe(60000)
  })

  it('adds up accounts, cards and IOUs', () => {
    const nw = netWorth(
      {
        entries,
        balance: { amount: 10000, date: '2026-11-20' },
        accounts: [
          { id: 's', name: 'Savings', kind: 'savings', amount: 250000, date: '2026-11-01' },
          { id: 'c', name: 'Card', kind: 'credit', amount: -30000, date: '2026-11-01' }
        ],
        ious: [iou({ amount: 850 }), iou({ amount: 400, theyOwe: false, person: 'Jo' }), iou({ amount: 999, settled: '2026-11-02' })]
      },
      '2026-11-20'
    )
    expect(nw.current).toBe(10000)
    expect(nw.inAccounts).toBe(10000 + 250000 - 30000)
    expect(nw.owedToYou).toBe(850)
    expect(nw.youOwe).toBe(400)
    expect(nw.total).toBe(230000 + 850 - 400)
    expect(nw.any).toBe(true)
  })

  it('has nothing to add up until there is an account', () => {
    expect(netWorth({ ...emptyMoney(), ious: [iou({})] }, '2026-11-20').any).toBe(false)
  })
})

describe('net worth history', () => {
  it('keeps one point a day, the latest one', () => {
    let h = recordNetWorth([], '2026-11-01', 100)
    h = recordNetWorth(h, '2026-11-01', 150)
    h = recordNetWorth(h, '2026-11-03', 120)
    expect(h).toEqual([
      { date: '2026-11-01', total: 150 },
      { date: '2026-11-03', total: 120 }
    ])
    expect(recordNetWorth(h, '2026-11-03', 120)).toBe(h)
    // The clock went backwards: leave the history alone.
    expect(recordNetWorth(h, '2026-10-01', 5)).toBe(h)
  })

  it('works out the change and the points for a range', () => {
    const h = [
      { date: '2026-08-01', total: 1000 },
      { date: '2026-10-25', total: 2000 },
      { date: '2026-11-15', total: 2500 }
    ]
    expect(changeOver(h, '2026-11-20', 30, 3000)).toBe(2000)
    expect(changeOver(h, '2026-11-20', 10, 3000)).toBe(1000)
    expect(changeOver(h, '2026-11-20', 365, 3000)).toBeNull()
    // The point before the range starts is kept, so the line starts at the left edge.
    expect(historyFor(h, '2026-11-20', 30).map((p) => p.total)).toEqual([1000, 2000, 2500])
    expect(historyFor(h, '2026-11-20', 10).map((p) => p.total)).toEqual([2000, 2500])
    expect(historyFor(h, '2026-11-20', 0)).toBe(h)
  })

  it('reads back from money.json, dropping junk and repeated days', () => {
    const data = readMoney(
      JSON.stringify({
        accounts: [{ id: 'x', name: 'Pot', kind: 'weird', amount: 12.4, date: '2026-11-01' }, { name: 'no id' }],
        netWorth: [{ date: '2026-11-02', total: 5 }, { date: '2026-11-01', total: 1 }, { date: '2026-11-02', total: 7 }, { date: 'nope', total: 1 }],
        ious: [{ id: 'i', person: 'Sam', amount: 850, theyOwe: false, date: '2026-11-01', remind: '2026-11-08', paid: -3 }, { id: 'bad', person: 'X', amount: 0 }]
      })
    )
    expect(data.accounts).toEqual([{ id: 'x', name: 'Pot', kind: 'other', amount: 12, date: '2026-11-01' }])
    expect(data.netWorth).toEqual([
      { date: '2026-11-01', total: 1 },
      { date: '2026-11-02', total: 7 }
    ])
    expect(data.ious).toEqual([{ id: 'i', person: 'Sam', amount: 850, theyOwe: false, note: '', date: '2026-11-01', paid: 0, remind: '2026-11-08' }])
    // Older files have none of these.
    const old = readMoney('{"entries":[]}')
    expect([old.accounts, old.netWorth, old.ious]).toEqual([[], [], []])
  })
})

describe('IOUs', () => {
  it('splits a bill to the penny', () => {
    expect(splitEvenly(3450, 3)).toEqual([1150, 1150, 1150])
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333])
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b)).toBe(1000)
  })

  it('reads the names typed in', () => {
    expect(readNames('Sam, Jo and Alex')).toEqual(['Sam', 'Jo', 'Alex'])
    expect(readNames('sam & Sam, me')).toEqual(['sam'])
    expect(readNames('  ')).toEqual([])
  })

  it('nets out each person and leaves settled ones out', () => {
    const list = [iou({ amount: 1000 }), iou({ person: 'sam ', amount: 300, theyOwe: false }), iou({ person: 'Jo', amount: 2000, paid: 500 }), iou({ person: 'Al', settled: '2026-11-02' })]
    const people = byPerson(list)
    expect(people.map((p) => [p.person, p.net])).toEqual([
      ['Jo', 1500],
      ['Sam', 700]
    ])
    expect(iouTotals(list)).toEqual({ owedToYou: 2500, youOwe: 300 })
  })

  it('reminds once, on or after the day', () => {
    const list = [iou({ id: 'a', remind: '2026-11-20' }), iou({ id: 'b', remind: '2026-11-21' }), iou({ id: 'c', remind: '2026-11-19', reminded: '2026-11-19' }), iou({ id: 'd', remind: '2026-11-01', settled: '2026-11-02' })]
    expect(dueIouReminders(list, '2026-11-20').map((i) => i.id)).toEqual(['a'])
    // Snoozed to a new day: it goes off again then.
    expect(dueIouReminders([iou({ id: 'c', remind: '2026-11-20', reminded: '2026-11-19' })], '2026-11-20')).toHaveLength(1)
  })

  it('writes a friendly nudge', () => {
    expect(nudgeText('Sam', [iou({ amount: 850, note: 'Takeaway' })], formatPounds)).toBe('Hey Sam, just a reminder about the £8.50 for takeaway 🙂')
    expect(nudgeText('Sam', [iou({ amount: 500, note: 'KFC' }), iou({ amount: 500, note: 'cinema' })], formatPounds)).toBe('Hey Sam, just a reminder about the £10.00 for KFC and cinema 🙂')
  })
})
