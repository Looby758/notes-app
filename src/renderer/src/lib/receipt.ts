import { dayOf, parseDate } from './money'

/** What a scanned receipt says: the shop, the total and the day (as well as the reader could tell). */
export interface Receipt {
  shop: string
  /** Pence; null if no total was found. */
  total: number | null
  /** YYYY-MM-DD; today if no date was found. */
  date: string
}

const AMOUNT = /£?\s?(\d{1,5}(?:,\d{3})*[.,]\d{2})\b/g
const toPence = (s: string): number => Math.round(parseFloat(s.replace(/,(?=\d{3})/g, '').replace(',', '.')) * 100)

/** Reads the text of a receipt (from the phone scanner, read by Tesseract). */
export function parseReceipt(text: string, today = new Date()): Receipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const amounts = (line: string): number[] => [...line.matchAll(AMOUNT)].map((m) => toPence(m[1]))

  // The total: the line that says so (not the subtotal, VAT or change), else the biggest amount.
  let total: number | null = null
  for (const line of lines) {
    if (!/\b(total|amount due|balance due|to pay|card|visa|mastercard|contactless)\b/i.test(line)) continue
    if (/sub\s?-?total|vat|tax|change|saving|discount|points/i.test(line)) continue
    const found = amounts(line)
    if (found.length) {
      total = found[found.length - 1]
      if (/total/i.test(line)) break
    }
  }
  if (total === null) {
    const all = lines.flatMap(amounts)
    total = all.length ? Math.max(...all) : null
  }

  let date: string | null = null
  for (const line of lines) {
    for (const m of line.matchAll(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2} [A-Za-z]{3,9} \d{2,4})\b/g)) {
      date = parseDate(m[1])
      if (date) break
    }
    if (date) break
  }

  // The shop's name is usually the first line with a few letters in it.
  const shop = lines.find((l) => (l.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && !/receipt|welcome|tel|vat no/i.test(l)) ?? 'Receipt'
  return { shop: shop.replace(/[^\w &'’.-]/g, '').trim().slice(0, 60) || 'Receipt', total, date: date ?? dayOf(today) }
}
