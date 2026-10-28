import { describe, expect, it } from 'vitest'
import { statementFromPdf, type PdfItem } from './pdfStatement'
import { detectColumns, readStatement } from './money'

/**
 * Builds a page the way a PDF reader sees it: each line is [x, text] pieces at one height, and each
 * word is its own bit of text (as PDFs often store them). Amounts are right-aligned on `x`.
 */
function page(lines: [number, string][][]): PdfItem[] {
  const items: PdfItem[] = []
  lines.forEach((line, i) => {
    const y = 100 + i * 14
    for (const [x, text] of line) {
      const right = /^[£(\-\d][\d,.£()]*( ?(CR|DR|OD|D))?$/.test(text)
      let at = right ? x - text.length * 5 : x
      for (const word of text.split(' ')) {
        items.push({ str: word, x: at, y, width: word.length * 5 })
        at += word.length * 5 + 2.5
      }
    }
  })
  return items
}

const read = (pages: PdfItem[][]) => {
  const rows = statementFromPdf(pages, new Date(2026, 9, 28))
  return readStatement(rows, detectColumns(rows))
}

describe('statementFromPdf', () => {
  it('reads paid out / paid in columns, dates shown once a day and descriptions over two lines (HSBC style)', () => {
    const p = page([
      [[40, 'Your Statement 1 January 2026 to 31 January 2026']],
      [[40, 'Date'], [110, 'Payment type and details'], [380, 'Paid out'], [460, 'Paid in'], [540, 'Balance']],
      [[40, '01 Jan 26'], [110, 'BALANCE BROUGHT FORWARD'], [540, '1,000.00']],
      [[40, '05 Jan 26'], [110, 'VIS TESCO STORES 3297'], [380, '12.34'], [540, '987.66']],
      [[110, 'DD BRITISH GAS'], [380, '45.00'], [540, '942.66']],
      [[40, '06 Jan 26'], [110, 'CR ACME LTD']],
      [[110, 'SALARY JAN'], [460, '2,000.00'], [540, '2,942.66']],
      [[40, '31 Jan 26'], [110, 'BALANCE CARRIED FORWARD'], [540, '2,942.66']]
    ])
    expect(read([p])).toEqual([
      { date: '2026-01-05', amount: -1234, description: 'VIS TESCO STORES 3297' },
      { date: '2026-01-05', amount: -4500, description: 'DD BRITISH GAS' },
      { date: '2026-01-06', amount: 200000, description: 'CR ACME LTD SALARY JAN' }
    ])
  })

  it('fills in the year, going into the next year in January (money out / money in)', () => {
    const p1 = page([
      [[40, 'Statement 15 Dec 2025 - 14 Jan 2026']],
      [[40, 'Date'], [100, 'Description'], [400, 'Money out'], [470, 'Money in'], [550, 'Balance']],
      [[40, '30 Dec'], [100, 'Card payment to PRET A MANGER'], [400, '4.95'], [550, '95.05']]
    ])
    const p2 = page([
      [[40, 'Date'], [100, 'Description'], [400, 'Money out'], [470, 'Money in'], [550, 'Balance']],
      [[40, '2 Jan'], [100, 'Refund from AMAZON'], [470, '10.00'], [550, '105.05']],
      [[40, 'Page 2 of 2']]
    ])
    expect(read([p1, p2])).toEqual([
      { date: '2025-12-30', amount: -495, description: 'Card payment to PRET A MANGER' },
      { date: '2026-01-02', amount: 1000, description: 'Refund from AMAZON' }
    ])
  })

  it('reads one amount column with minus signs', () => {
    const p = page([
      [[40, 'Date'], [130, 'Description'], [450, 'Amount (£)'], [540, 'Balance (£)']],
      [[40, '05/01/2026'], [130, 'Tesco'], [450, '-12.34'], [540, '87.66']],
      [[40, '06/01/2026'], [130, 'Transfer from Sam'], [450, '+20.00'], [540, '107.66']]
    ])
    expect(read([p]).map((r) => r.amount)).toEqual([-1234, 2000])
  })

  it('uses the balance to tell which way money went when the columns have no headings', () => {
    const p = page([
      [[40, 'Opening balance'], [540, '500.00']],
      [[40, '05Jan26'], [110, 'TFL TRAVEL'], [440, '2.80'], [540, '497.20']],
      [[40, '06Jan26'], [110, 'GIFT FROM MUM'], [440, '50.00'], [540, '547.20']]
    ])
    expect(read([p]).map((r) => [r.date, r.amount])).toEqual([
      ['2026-01-05', -280],
      ['2026-01-06', 5000]
    ])
  })

  it('reads overdrawn balances and skips totals', () => {
    const p = page([
      [[40, 'Date'], [100, 'Details'], [400, 'Withdrawn'], [470, 'Paid in'], [550, 'Balance']],
      [[40, '05 Jan 2026'], [100, 'RENT'], [400, '600.00'], [550, '100.00 OD']],
      [[40, '06 Jan 2026'], [100, 'WAGES'], [470, '900.00'], [550, '800.00']],
      [[100, 'Total payments'], [400, '600.00'], [470, '900.00']]
    ])
    expect(read([p]).map((r) => [r.description, r.amount])).toEqual([
      ['RENT', -60000],
      ['WAGES', 90000]
    ])
  })

  it('reads Lloyds statements: hidden screen-reader labels, a summary box and a Type column', () => {
    const p = page([
      [[300, '28 October 2026']],
      [[300, '01 October 2026 to 28 October 2026']],
      [[57, 'Money In'], [291, '£150.00'], [304, 'Balance on 01 October 2026'], [538, '£85.23']],
      [[57, 'Money Out'], [291, '£15.73'], [304, 'Balance on 28 October 2026'], [538, '£219.50']],
      [[57, 'Date'], [122, 'Description'], [271, 'Type'], [323, 'Money In (£)'], [393, 'Money Out (£)'], [490, 'Balance (£)']],
      [[57, '01 Oct 26'], [122, 'SAINSBURYS S/MKT'], [271, 'DEB'], [454, '5.85'], [538, '79.38']],
      [[57, '05 Oct 26'], [122, 'M JONES'], [271, 'FPI'], [376, '150.00'], [538, '229.38']],
      [[57, '06 Oct 26'], [122, 'GROUND NEWS'], [271, 'DEB'], [454, '9.88'], [538, '219.50']],
      [[57, '(Continued on next page)']]
    ])
    // Lloyds adds tiny invisible copies of the headings above each row, and a "." after every cell.
    const hidden = (str: string, x: number, y: number): PdfItem => ({ str, x, y, width: 0, size: 0.05 })
    const extra = p.flatMap((item) => (item.size === undefined && /\d\.\d\d$/.test(item.str) ? [hidden('.', item.x + item.width, item.y)] : []))
    extra.push(hidden('Date', 57, 165), hidden('Description', 122, 165), hidden('Money In (£)', 375, 169), hidden('blank.', 375, 169))
    expect(read([[...p, ...extra]])).toEqual([
      { date: '2026-10-01', amount: -585, description: 'SAINSBURYS S/MKT' },
      { date: '2026-10-05', amount: 15000, description: 'M JONES' },
      { date: '2026-10-06', amount: -988, description: 'GROUND NEWS' }
    ])
  })

  it('finds nothing in a PDF that is not a statement', () => {
    expect(statementFromPdf([page([[[40, 'Dear customer, thank you for banking with us.']]])])).toEqual([])
  })
})
