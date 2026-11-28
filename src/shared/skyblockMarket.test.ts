import { describe, expect, it } from 'vitest'
import {
  addSnap,
  answerNote,
  answerNotePath,
  bazaarName,
  checkRule,
  cleanRule,
  contextLines,
  correlation,
  decodeBlock,
  emptyBlock,
  encodeBlock,
  eventKind,
  findAnomalies,
  groupAnomalies,
  HOUR,
  hourly,
  MINUTE,
  noteMayor,
  parseBazaar,
  parseCoflHistory,
  pickNew,
  questionText,
  rowOf,
  ruleText,
  seriesOf,
  triggerStarts,
  type Anomaly,
  type MarketQuestion,
  type MarketRule,
  type Point
} from './skyblockMarket'
import { yearlyEventsBetween } from './skyblockMore'

const T0 = Date.UTC(2026, 10, 1)

/** A steady item that wobbles a little each hour. */
function steady(hours: number, price = 100, coinsWeek = 1_000_000, end = T0 + hours * HOUR): Point[] {
  const out: Point[] = []
  for (let i = 0; i < hours; i++) {
    const wobble = 1 + 0.01 * Math.sin(i * 1.7)
    out.push({ at: end - (hours - i) * HOUR, buy: price * wobble * 1.02, sell: price * wobble, buyWeek: coinsWeek + i * 10, sellWeek: coinsWeek + i * 10 })
  }
  return out
}

describe('parseBazaar', () => {
  it('reads quick status for each product', () => {
    const snap = parseBazaar({
      success: true,
      lastUpdated: 123,
      products: { ENCHANTED_GOLD: { quick_status: { buyPrice: 10.5, sellPrice: 9.5, buyMovingWeek: 1000, sellMovingWeek: 2000 } }, BAD: {} }
    })
    expect(snap).toEqual({ at: 123, rows: { ENCHANTED_GOLD: [10.5, 9.5, 1000, 2000] } })
    expect(parseBazaar({})).toBeNull()
  })
})

describe('blocks', () => {
  it('round-trips through bytes, with items that appear later', () => {
    const b = emptyBlock()
    addSnap(b, { at: 1, rows: { A: [1, 2, 3, 4] } })
    addSnap(b, { at: 2, rows: { A: [5, 6, 7, 8], B: [9, 10, 11, 12] } })
    const back = decodeBlock(encodeBlock(b))!
    expect(back.ids).toEqual(['A', 'B'])
    expect(back.times).toEqual([1, 2])
    expect(rowOf(back, 0, 0)).toEqual([1, 2, 3, 4])
    expect(rowOf(back, 0, 1)).toBeNull()
    expect(rowOf(back, 1, 1)).toEqual([9, 10, 11, 12])
    expect(decodeBlock(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('averages prices into whole hours', () => {
    const b = emptyBlock()
    addSnap(b, { at: T0, rows: { A: [10, 8, 100, 100] } })
    addSnap(b, { at: T0 + 30 * MINUTE, rows: { A: [20, 12, 150, 160] } })
    addSnap(b, { at: T0 + HOUR + 5 * MINUTE, rows: { A: [30, 30, 200, 200] } })
    const h = hourly(b, T0 + HOUR + 10 * MINUTE)
    expect(h.times).toEqual([T0])
    expect(rowOf(h, 0, 0)).toEqual([15, 10, 150, 160])
    expect(seriesOf([h], 'A')[0]).toMatchObject({ at: T0, buy: 15, sell: 10 })
  })
})

describe('findAnomalies', () => {
  const now = T0 + 200 * HOUR
  const hours = steady(197, 100, 1_000_000, now - 3 * HOUR)

  it('says nothing about an item doing what it always does', () => {
    const recent = [{ at: now - 3 * HOUR, buy: 102, sell: 100, buyWeek: 1e6, sellWeek: 1e6 }, { at: now - 5 * MINUTE, buy: 102.5, sell: 100.5, buyWeek: 1e6, sellWeek: 1e6 }]
    expect(findAnomalies('A', hours, recent, now)).toEqual([])
  })

  it('notices a big jump', () => {
    const recent = [{ at: now - 3 * HOUR, buy: 102, sell: 100, buyWeek: 1e6, sellWeek: 1e6 }, { at: now - 5 * MINUTE, buy: 140, sell: 136, buyWeek: 1e6, sellWeek: 1e6 }]
    const [a] = findAnomalies('A', hours, recent, now)
    expect(a.kind).toBe('up')
    expect(a.change).toBeCloseTo(0.36, 1)
    expect(a.z).toBeGreaterThan(4)
  })

  it('waits until it has learned what normal is', () => {
    const recent = [{ at: now - 5 * MINUTE, buy: 200, sell: 190, buyWeek: 1e6, sellWeek: 1e6 }]
    expect(findAnomalies('A', hours.slice(-20), recent, now)).toEqual([])
  })

  it('ignores tiny markets', () => {
    const small = steady(197, 1, 100, now - 3 * HOUR)
    const recent = [{ at: now - 3 * HOUR, buy: 1, sell: 1, buyWeek: 100, sellWeek: 100 }, { at: now - 5 * MINUTE, buy: 3, sell: 3, buyWeek: 100, sellWeek: 100 }]
    expect(findAnomalies('A', small, recent, now)).toEqual([])
  })

  it('notices the buy and sell prices pulling apart', () => {
    const recent = [{ at: now - 3 * HOUR, buy: 102, sell: 100, buyWeek: 1e6, sellWeek: 1e6 }, { at: now - 5 * MINUTE, buy: 125, sell: 80, buyWeek: 1e6, sellWeek: 1e6 }]
    expect(findAnomalies('A', hours, recent, now).map((a) => a.kind)).toContain('spread')
  })
})

describe('grouping and picking', () => {
  const a = (id: string, score: number, kind: Anomaly['kind'] = 'up'): Anomaly => ({ id, kind, z: 5, change: 0.3, before: 1, now: 1.3, coins: 1e7, score })

  it('puts items that move together into one question', () => {
    const groups = groupAnomalies([a('A', 5), a('B', 9), a('C', 3), a('C', 2, 'volume')], (x, y) => [x, y].sort().join() === 'A,B')
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([['B', 'A'], ['C', 'C']])
  })

  it('skips muted items, recent repeats and anything over the daily limit', () => {
    const q = (id: string, at: number, status: MarketQuestion['status'] = 'explained'): MarketQuestion => ({ id: 'q', at, kind: 'up', items: [{ id, name: id, change: 0, before: 0, now: 0 }], z: 0, score: 0, text: '', context: [], history: [], status })
    const now = T0 + 10 * HOUR
    const groups = [[a('A', 9)], [a('B', 8)], [a('C', 7)], [a('D', 6)]]
    const picked = pickNew(groups, [q('B', now - HOUR), q('D', now - 30 * HOUR, 'later')], [{ item: 'A', kind: 'up' }], now, { perDay: 2, quietFor: 24 * HOUR, fileAfter: 0, settleAfter: 0 })
    expect(picked.map((g) => g[0].id)).toEqual(['C'])
  })
})

describe('correlation', () => {
  it('is high for items that move the same way', () => {
    const a = steady(48)
    const b = a.map((p) => ({ ...p, buy: p.buy * 3, sell: p.sell * 3 }))
    expect(correlation(a, b)).toBeCloseTo(1, 3)
  })
})

describe('mayors and context', () => {
  it('starts a new term when the mayor changes', () => {
    let terms = noteMayor([], { name: 'Diana', perks: ['Mythological Ritual'], minister: null }, 1)
    terms = noteMayor(terms, { name: 'Diana', perks: [], minister: 'Paul' }, 2)
    terms = noteMayor(terms, { name: 'Derpy', perks: [], minister: null }, 3)
    expect(terms).toEqual([
      { name: 'Diana', perks: ['Mythological Ritual'], minister: 'Paul', start: 1, end: 2 },
      { name: 'Derpy', perks: [], minister: null, start: 3, end: 3 }
    ])
  })

  it('says what was going on', () => {
    const terms = [
      { name: 'Diana', perks: [], minister: null, start: 0, end: 10 * HOUR },
      { name: 'Derpy', perks: [], minister: null, start: 10 * HOUR, end: 20 * HOUR }
    ]
    const lines = contextLines(12 * HOUR, terms, [{ name: 'Spooky Festival', start: 11 * HOUR, end: 13 * HOUR }], [{ at: 11.5 * HOUR, kind: 'firesale', text: 'Mushroom hat' }])
    expect(lines).toEqual(['Derpy became mayor 2 hours earlier', 'Spooky Festival started 1 hour earlier', 'Fire sale: Mushroom hat'])
  })

  it('finds past calendar events', () => {
    const events = yearlyEventsBetween(T0, T0 + 10 * 24 * HOUR)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.start >= T0)).toBe(true)
    expect(eventKind('zoo-summer-412')).toBe('zoo')
    expect(eventKind('spooky-412')).toBe('spooky')
  })
})

describe('questions', () => {
  it('reads like a person asking', () => {
    const text = questionText('up', [{ id: 'ENCHANTED_GOLD', name: 'Enchanted Gold', change: 0.38, before: 12.1, now: 16.7 }, { id: 'X', name: 'X', change: 0.3, before: 1, now: 1.3 }], [])
    expect(text).toBe('Enchanted Gold’s price is up 38% in 3 hours (12.1 → 16.7 coins). 1 item that usually moves with it did the same. Nothing on the SkyBlock calendar explains it. Any idea why?')
  })

  it('becomes a note in the vault', () => {
    const q: MarketQuestion = { id: 'q', at: T0, kind: 'down', items: [{ id: 'A', name: 'Enchanted Gold', change: -0.2, before: 10, now: 8 }], z: 5, score: 5, text: 'It dropped. Any idea why?', context: ['Derpy became mayor 1 hour earlier'], history: [], status: 'explained', answer: 'Update nerf' }
    expect(answerNotePath(q)).toBe('SkyBlock Market/Explanations/2026-11-01 Enchanted Gold price drop.md')
    const note = answerNote(q)
    expect(note).toContain('## Why\n\nUpdate nerf')
    expect(note).toContain('- Derpy became mayor 1 hour earlier')
  })
})

describe('rules', () => {
  const names = (id: string): string => bazaarName(id)
  it('cleans what the AI suggests', () => {
    const r = cleanRule({ item: 'enchanted_gold', trigger: { type: 'event', kind: 'spooky' }, fromHours: -48, toHours: 0, expect: 'up', size: 0.15, why: 'People stock up' }, names, 1)!
    expect(r).toMatchObject({ item: 'ENCHANTED_GOLD', itemName: 'Enchanted Gold', fromHours: -48, toHours: 0, expect: 'up', size: 0.15, source: 'ai' })
    expect(cleanRule({ item: 'X', trigger: { type: 'event', kind: 'spooky' }, fromHours: 5, toHours: 1, expect: 'up', size: 0.1 }, names, 1)).toBeNull()
    expect(cleanRule({ item: 'X', trigger: { type: 'party' }, fromHours: 0, toHours: 1, expect: 'up', size: 0.1 }, names, 1)).toBeNull()
  })

  it('checks a rule against what happened', () => {
    const rule = cleanRule({ item: 'A', trigger: { type: 'mayor', name: 'Derpy' }, fromHours: 0, toHours: 24, expect: 'up', size: 0.2 }, names, 1) as MarketRule
    const terms = [
      { name: 'Diana', perks: [], minister: null, start: 0, end: 100 * HOUR },
      { name: 'Derpy', perks: [], minister: null, start: 100 * HOUR, end: 200 * HOUR }
    ]
    const starts = triggerStarts(rule.trigger, terms, [])
    expect(starts).toEqual([100 * HOUR])
    const price = (at: number): number => (at >= 124 * HOUR ? 115 : 100)
    expect(checkRule(rule, starts, price, 300 * HOUR)).toEqual([{ at: 100 * HOUR, change: expect.closeTo(0.15, 5), hit: true }])
    expect(checkRule(rule, starts, price, 110 * HOUR)).toEqual([])
    expect(ruleText(rule)).toBe('A goes up 20% in the 24 hours after Derpy becomes mayor')
    expect(ruleText({ ...rule, trigger: { type: 'event', kind: 'spooky' }, fromHours: -48, toHours: 0 }, [{ id: 'spooky', name: 'Spooky Festival' }])).toBe('A goes up 20% in the 2 days before Spooky Festival starts')
    expect(ruleText({ ...rule, fromHours: 2, toHours: 6 })).toBe('A goes up 20% between 2 hours after and 6 hours after Derpy becomes mayor')
  })

  it('names Bazaar items it has no name for', () => {
    expect(bazaarName('ENCHANTED_GOLD_BLOCK')).toBe('Enchanted Gold Block')
    expect(bazaarName('ENCHANTMENT_SHARPNESS_5')).toBe('Sharpness 5 (book)')
  })
})

describe('parseCoflHistory', () => {
  it('reads Coflnet history as UTC, oldest first', () => {
    const pts = parseCoflHistory([
      { buy: 2, sell: 1, buyMovingWeek: 10, sellMovingWeek: 20, timestamp: '2026-11-28T12:00:00' },
      { buy: 3, sell: 2, buyMovingWeek: 11, sellMovingWeek: 21, timestamp: '2026-11-28T10:00:00' },
      { nope: true }
    ])
    expect(pts).toEqual([
      { at: Date.UTC(2026, 10, 28, 10), buy: 3, sell: 2, buyWeek: 11, sellWeek: 21 },
      { at: Date.UTC(2026, 10, 28, 12), buy: 2, sell: 1, buyWeek: 10, sellWeek: 20 }
    ])
  })
})
