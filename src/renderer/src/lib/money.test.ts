import { describe, expect, it } from 'vitest'
import {
  addMonths,
  budgetState,
  DEFAULT_CATEGORIES,
  detectColumns,
  formatPounds,
  guessCategory,
  importKeys,
  merchantKey,
  monthTotals,
  parseAmount,
  parseCsv,
  parseDate,
  readMoney,
  readStatement
} from './money'

describe('parseAmount', () => {
  it('reads pounds as pence, negative for money out', () => {
    expect(parseAmount('£1,234.56')).toBe(123456)
    expect(parseAmount('-12.5')).toBe(-1250)
    expect(parseAmount('-£3.20')).toBe(-320)
    expect(parseAmount('£-3.20')).toBe(-320)
    expect(parseAmount('(4.20)')).toBe(-420)
    expect(parseAmount('4.20 DR')).toBe(-420)
    expect(parseAmount('4.20CR')).toBe(420)
    expect(parseAmount('+7')).toBe(700)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('Tesco')).toBeNull()
  })
})

describe('parseDate', () => {
  it('reads UK dates day first', () => {
    expect(parseDate('05/01/2024')).toBe('2024-01-05')
    expect(parseDate('5/1/24')).toBe('2024-01-05')
    expect(parseDate('2024-01-05')).toBe('2024-01-05')
    expect(parseDate('05 Jan 2024')).toBe('2024-01-05')
    expect(parseDate('05-Jan-24')).toBe('2024-01-05')
    expect(parseDate('5 January 2024')).toBe('2024-01-05')
    expect(parseDate('2024-01-05T10:22:00Z')).toBe('2024-01-05')
    expect(parseDate('05/01/2024 10:22:00')).toBe('2024-01-05')
  })
  it('refuses things that are not dates', () => {
    expect(parseDate('31/02/2024')).toBeNull()
    expect(parseDate('Date')).toBeNull()
    expect(parseDate('12.50')).toBeNull()
  })
})

describe('months', () => {
  it('steps across years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
  it('formats pounds', () => {
    expect(formatPounds(123456)).toBe('£1,234.56')
    expect(formatPounds(123456, true)).toBe('£1,235')
  })
})

describe('parseCsv', () => {
  it('handles quotes, commas in quotes and Windows line endings', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3']
    ])
  })
})

const statement = (csv: string) => {
  const rows = parseCsv(csv)
  return readStatement(rows, detectColumns(rows))
}

describe('reading bank statements', () => {
  it('reads a single signed amount column (Monzo, Starling, NatWest…)', () => {
    const csv = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency\nx1,05/01/2024,10:00:00,Card payment,Tesco,,Groceries,-12.34,GBP\nx2,06/01/2024,09:00:00,Faster payment,ACME LTD SALARY,,Income,2000.00,GBP\n'
    expect(statement(csv)).toEqual([
      { date: '2024-01-05', amount: -1234, description: 'Tesco' },
      { date: '2024-01-06', amount: 200000, description: 'ACME LTD SALARY' }
    ])
  })
  it('reads paid out / paid in columns after lines about the account (Nationwide)', () => {
    const csv =
      '"Account Name:","FlexAccount ****1234"\n"Account Balance:","£1,000.00"\n\n"Date","Transaction type","Description","Paid out","Paid in","Balance"\n"05 Jan 2024","Contactless Payment","TESCO STORES 3297","£12.34","","£987.66"\n"06 Jan 2024","Bank credit","ACME","","£100.00","£1,087.66"\n'
    expect(statement(csv)).toEqual([
      { date: '2024-01-05', amount: -1234, description: 'TESCO STORES 3297' },
      { date: '2024-01-06', amount: 10000, description: 'ACME' }
    ])
  })
  it('reads debit / credit columns (Lloyds, Halifax)', () => {
    const csv =
      'Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n05/01/2024,DEB,\'11-22-33,12345678,TFL TRAVEL CH,2.80,,100.00\n'
    expect(statement(csv)).toEqual([{ date: '2024-01-05', amount: -280, description: 'TFL TRAVEL CH' }])
  })
  it('guesses the columns of a file without column names (HSBC)', () => {
    const csv = '05/01/2024,CARD PAYMENT TO TESCO STORES,-12.34\n06/01/2024,DEPOSIT,50.00\n'
    expect(statement(csv)).toEqual([
      { date: '2024-01-05', amount: -1234, description: 'CARD PAYMENT TO TESCO STORES' },
      { date: '2024-01-06', amount: 5000, description: 'DEPOSIT' }
    ])
  })
  it('can flip signs for cards that show spending as positive', () => {
    const rows = parseCsv('Date,Description,Amount\n05/01/2024,AMAZON,9.99\n')
    expect(readStatement(rows, { ...detectColumns(rows), flip: true })[0].amount).toBe(-999)
  })
  it('tells identical rows apart, the same way every time', () => {
    const rows = [
      { date: '2024-01-05', amount: -300, description: 'Costa' },
      { date: '2024-01-05', amount: -300, description: 'Costa' }
    ]
    const keys = importKeys(rows)
    expect(keys[0]).not.toBe(keys[1])
    expect(importKeys(rows)).toEqual(keys)
  })
})

describe('categories', () => {
  it('finds the shop in a description', () => {
    expect(merchantKey('CARD PAYMENT TO TESCO STORES 3297 LONDON')).toBe('tesco stores')
    expect(merchantKey('Contactless Payment PRET A MANGER')).toBe('pret manger')
  })
  it('guesses from well-known names, and prefers what you picked before', () => {
    const row = (description: string, amount = -500) => ({ date: '2024-01-05', amount, description })
    expect(guessCategory(row('TESCO STORES 3297'), {}, DEFAULT_CATEGORIES)).toBe('groceries')
    expect(guessCategory(row('UBER EATS'), {}, DEFAULT_CATEGORIES)).toBe('eating-out')
    expect(guessCategory(row('UBER TRIP'), {}, DEFAULT_CATEGORIES)).toBe('transport')
    expect(guessCategory(row('TFL TRAVEL'), {}, DEFAULT_CATEGORIES)).toBe('transport')
    expect(guessCategory(row('Something odd'), {}, DEFAULT_CATEGORIES)).toBe('other')
    expect(guessCategory(row('ACME SALARY', 100000), {}, DEFAULT_CATEGORIES)).toBe('pay')
    expect(guessCategory(row('Refund', 1000), {}, DEFAULT_CATEGORIES)).toBe('other-income')
    expect(guessCategory(row('TESCO STORES 3297'), { 'tesco stores': 'home' }, DEFAULT_CATEGORIES)).toBe('home')
  })
})

describe('totals and budgets', () => {
  it('adds up a month', () => {
    const t = monthTotals(
      [
        { id: '1', date: '2024-01-05', amount: 500, income: false, category: 'groceries', note: '' },
        { id: '2', date: '2024-01-09', amount: 250, income: false, category: 'groceries', note: '' },
        { id: '3', date: '2024-01-10', amount: 9000, income: true, category: 'pay', note: '' },
        { id: '4', date: '2024-02-01', amount: 100, income: false, category: 'fun', note: '' }
      ],
      '2024-01'
    )
    expect([t.spent, t.received, t.byCategory.get('groceries'), t.byCategory.has('fun')]).toEqual([750, 9000, 750, false])
  })
  it('warns near the limit', () => {
    expect(budgetState(50, 100)).toBe('ok')
    expect(budgetState(80, 100)).toBe('near')
    expect(budgetState(101, 100)).toBe('over')
  })
})

describe('readMoney', () => {
  it('starts with the default categories and survives a damaged file', () => {
    expect(readMoney(null).categories.length).toBe(DEFAULT_CATEGORIES.length)
    expect(readMoney('{nope').entries).toEqual([])
    const data = readMoney(JSON.stringify({ categories: [{ id: 'x', name: 'X', color: '#fff' }], entries: [{ id: 'a', date: 'bad' }], budgets: { x: 500 } }))
    expect(data.categories.map((c) => c.id)).toEqual(['x', 'other', 'other-income'])
    expect(data.entries).toEqual([])
    expect(data.budgets).toEqual({ x: 500 })
  })
})
