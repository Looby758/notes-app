import { describe, expect, it } from 'vitest'
import { describeSmart, parseSmart, validSmart } from './smartParse'
import { radialIndexAt } from './radial'

const now = new Date(2026, 9, 31, 12, 0) // Saturday 31 Oct 2026
const features = [
  { id: 'money', name: 'Money', keywords: 'bank budget' },
  { id: 'email', name: 'Email', keywords: 'gmail inbox' },
  { id: 'today', name: "Today's note", keywords: 'daily' }
]
const p = (s: string) => parseSmart(s, { now, features })

describe('parseSmart', () => {
  it('reads spending', () => {
    expect(p('spent 12 on food')).toEqual({ kind: 'money', income: false, amount: 1200, category: 'eating-out', note: 'Food', date: '2026-10-31' })
    expect(p('paid £4.50 at Costa')).toMatchObject({ amount: 450, category: 'eating-out' })
    expect(p('spent £30 on petrol yesterday')).toMatchObject({ amount: 3000, category: 'transport', date: '2026-10-30' })
    expect(p('bought a hoodie for 25')).toMatchObject({ amount: 2500, category: 'shopping', note: 'A hoodie' })
    expect(p('£12 on lunch')).toMatchObject({ amount: 1200, category: 'eating-out' })
  })
  it('reads money coming in', () => {
    expect(p('got paid 500')).toMatchObject({ kind: 'money', income: true, amount: 50000, category: 'pay' })
    expect(p('received 20 from mum')).toMatchObject({ income: true, amount: 2000, category: 'other-income', note: 'Mum' })
  })
  it('reads reminders and events', () => {
    expect(p('remind me friday 5pm call Dave')).toEqual({ kind: 'event', date: '2026-11-06', time: '17:00', title: 'call Dave', remind: true })
    expect(p('remind me to call Dave tomorrow at 9:30')).toMatchObject({ date: '2026-11-01', time: '09:30', title: 'call Dave' })
    expect(p('event dentist on 4 Nov')).toMatchObject({ kind: 'event', date: '2026-11-04', remind: false })
    expect(p('remind me to buy milk')).toEqual({ kind: 'jot', text: '- [ ] buy milk' })
  })
  it('reads other commands', () => {
    expect(p('convert this to mp3')).toEqual({ kind: 'convert', format: 'mp3' })
    expect(p('convert to word')).toEqual({ kind: 'convert', format: 'docx' })
    expect(p('play Drake')).toEqual({ kind: 'play', query: 'Drake' })
    expect(p('next song')).toEqual({ kind: 'music', action: 'next' })
    expect(p('new note called Shopping')).toEqual({ kind: 'note', title: 'Shopping' })
    expect(p('open money')).toEqual({ kind: 'open', feature: 'money' })
    expect(p('go to my inbox')).toEqual({ kind: 'open', feature: 'email' })
    expect(p('google cheap flights')).toEqual({ kind: 'web', query: 'cheap flights' })
    expect(p('save 1200 for a new PC')).toEqual({ kind: 'goal', name: 'New PC', amount: 120000 })
    expect(p('12*4')).toMatchObject({ kind: 'calc', result: '48' })
    expect(p('when did I last pay the gas bill?')).toMatchObject({ kind: 'ask' })
  })
  it('leaves things it does not understand', () => {
    expect(p('banana')).toBeNull()
    expect(p('grabbed a coffee earlier')).toBeNull()
  })
  it('describes actions', () => {
    expect(describeSmart(p('spent 12 on food')!, { now })).toBe('Add £12.00 spent on Eating out (Food), today')
    expect(describeSmart(p('remind me friday 5pm call Dave')!, { now })).toBe('Remind you: “call Dave”, Fri 6 Nov at 17:00')
  })
  it('checks actions from the AI', () => {
    expect(validSmart({ kind: 'money', amount: 400, income: false, category: 'eating-out', date: '2026-10-31', note: 'Coffee' })).toMatchObject({ amount: 400 })
    expect(validSmart({ kind: 'money', amount: -4, date: '2026-10-31' })).toBeNull()
    expect(validSmart({ kind: 'delete-everything' })).toBeNull()
    expect(validSmart({ kind: 'event', title: 'x', date: '2026-10-31', time: '25:00', remind: true })).toMatchObject({ time: undefined, remind: false })
  })
})

describe('radial menu', () => {
  it('picks by direction', () => {
    expect(radialIndexAt(0, -50, 4, 30)).toBe(0)
    expect(radialIndexAt(50, 0, 4, 30)).toBe(1)
    expect(radialIndexAt(0, 50, 4, 30)).toBe(2)
    expect(radialIndexAt(-50, 0, 4, 30)).toBe(3)
    expect(radialIndexAt(5, 5, 4, 30)).toBe(-1)
  })
})
