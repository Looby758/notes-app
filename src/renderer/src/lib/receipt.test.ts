import { describe, expect, it } from 'vitest'
import { parseReceipt } from './receipt'

describe('parseReceipt', () => {
  it('finds the shop, total and date', () => {
    const text = `TESCO\nSuperstore Leeds\nMilk 1.45\nBread 1.10\nSUBTOTAL 2.55\nTOTAL £2.55\nCARD 2.55\n12/10/2026 14:32\nVAT 0.00`
    expect(parseReceipt(text)).toEqual({ shop: 'TESCO', total: 255, date: '2026-10-12' })
  })
  it('falls back to the biggest amount and today', () => {
    const r = parseReceipt('Joe’s Cafe\nLatte 3.20\nCake 2.80\n6.00', new Date(2026, 9, 28))
    expect(r).toEqual({ shop: 'Joe’s Cafe', total: 600, date: '2026-10-28' })
  })
  it('copes with nothing readable', () => {
    expect(parseReceipt('', new Date(2026, 0, 2))).toEqual({ shop: 'Receipt', total: null, date: '2026-01-02' })
  })
})
