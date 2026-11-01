import { describe, expect, it } from 'vitest'
import {
  changeSentence,
  cleanClocks,
  clockText,
  differenceText,
  findClockPlaces,
  lastChange,
  nextChange,
  nextGapChange,
  offsetMinutes,
  offsetText,
  onSummerTime,
  relativeDay,
  timeIn,
  zoneAbbreviation
} from './worldClock'

const at = (iso: string): Date => new Date(iso)

describe('time in a zone', () => {
  it('follows each place’s own daylight saving', () => {
    expect(offsetMinutes('Europe/London', at('2026-07-01T12:00:00Z'))).toBe(60)
    expect(offsetMinutes('Europe/London', at('2026-10-31T12:00:00Z'))).toBe(0)
    // The US changes a week later than the UK, on 1 Nov 2026.
    expect(offsetMinutes('America/New_York', at('2026-10-31T12:00:00Z'))).toBe(-240)
    expect(offsetMinutes('America/New_York', at('2026-11-02T12:00:00Z'))).toBe(-300)
    // Southern summer: Sydney is on daylight saving in our winter.
    expect(offsetMinutes('Australia/Sydney', at('2026-12-01T00:00:00Z'))).toBe(660)
    expect(offsetMinutes('Asia/Kolkata', at('2026-12-01T00:00:00Z'))).toBe(330)
  })

  it('reads the wall clock there', () => {
    const t = timeIn('Asia/Tokyo', at('2026-10-31T22:34:00Z'))
    expect([t.day, t.hour, t.minute, t.weekday]).toEqual([1, 7, 34, 0])
    expect(relativeDay('Asia/Tokyo', 'Europe/London', at('2026-10-31T22:34:00Z'))).toBe('Tomorrow')
    expect(relativeDay('America/Los_Angeles', 'Asia/Tokyo', at('2026-10-31T22:34:00Z'))).toBe('Yesterday')
  })

  it('says the difference and the zone name', () => {
    const now = at('2026-10-31T12:00:00Z')
    expect(differenceText('America/New_York', 'Europe/London', now)).toBe('4 hours behind')
    expect(differenceText('Asia/Kolkata', 'Europe/London', now)).toBe('5 hours 30 minutes ahead')
    expect(differenceText('Europe/London', 'Europe/London', now)).toBe('Same time as you')
    expect(offsetText(-240)).toBe('UTC−4')
    expect(offsetText(345)).toBe('UTC+5:45')
    expect(zoneAbbreviation('Europe/London', at('2026-07-01T12:00:00Z'))).toBe('BST')
    expect(zoneAbbreviation('Europe/London', now)).toBe('GMT')
    expect(clockText({ hour: 0, minute: 5 }, true)).toBe('12:05 am')
    expect(clockText({ hour: 13, minute: 5 }, false)).toBe('13:05')
  })
})

describe('clock changes', () => {
  it('finds the next change to the minute', () => {
    const c = nextChange('America/New_York', at('2026-10-31T12:00:00Z'))!
    expect(c.at.toISOString()).toBe('2026-11-01T06:00:00.000Z')
    expect([c.before, c.after]).toEqual([-240, -300])
    expect(changeSentence('America/New_York', c, false)).toBe('Clocks go back 1 hour on Sun 1 Nov at 02:00 (to 01:00)')
    const uk = nextChange('Europe/London', at('2026-10-31T12:00:00Z'))!
    expect(uk.at.toISOString()).toBe('2027-03-28T01:00:00.000Z')
    expect(changeSentence('Europe/London', uk, false)).toBe('Clocks go forward 1 hour on Sun 28 Mar at 01:00 (to 02:00)')
  })

  it('finds the last change, and none where there is no daylight saving', () => {
    const c = lastChange('Europe/London', at('2026-10-31T12:00:00Z'))!
    expect(c.at.toISOString()).toBe('2026-10-25T01:00:00.000Z')
    expect(changeSentence('Europe/London', c, true, true)).toBe('Clocks went back 1 hour on Sun 25 Oct at 2:00 am (to 1:00 am)')
    expect(nextChange('Asia/Tokyo', at('2026-10-31T12:00:00Z'))).toBeNull()
    expect(onSummerTime('Asia/Tokyo', at('2026-07-01T00:00:00Z'))).toBe(false)
    expect(onSummerTime('Europe/London', at('2026-07-01T00:00:00Z'))).toBe(true)
    expect(onSummerTime('Australia/Sydney', at('2026-07-01T00:00:00Z'))).toBe(false)
    expect(onSummerTime('Australia/Sydney', at('2026-12-01T00:00:00Z'))).toBe(true)
  })

  it('knows when the gap between two places changes', () => {
    const g = nextGapChange('America/New_York', 'Europe/London', at('2026-10-31T12:00:00Z'))!
    expect(g.at.toISOString()).toBe('2026-11-01T06:00:00.000Z')
    expect([g.before, g.after, g.who]).toEqual([-240, -300, 'there'])
    // London and Paris change together, so the gap never changes.
    expect(nextGapChange('Europe/Paris', 'Europe/London', at('2026-10-31T12:00:00Z'))).toBeNull()
    // Sydney goes forward while London goes back: both move the gap.
    const s = nextGapChange('Australia/Sydney', 'Europe/London', at('2026-08-01T00:00:00Z'))!
    expect(s.at.toISOString()).toBe('2026-10-03T16:00:00.000Z')
    expect([s.before, s.after]).toEqual([540, 600])
  })
})

describe('places and saved clocks', () => {
  it('finds places by name, country or nickname', () => {
    expect(findClockPlaces('new y')[0].zone).toBe('America/New_York')
    expect(findClockPlaces('sao')[0].zone).toBe('America/Sao_Paulo')
    expect(findClockPlaces('scotland')[0].name).toBe('Edinburgh')
    expect(findClockPlaces('chatham').some((p) => p.zone === 'Pacific/Chatham')).toBe(true)
    expect(findClockPlaces('')).toEqual([])
  })

  it('repairs a saved list', () => {
    expect(
      cleanClocks([
        { id: 'a', label: ' Mum ', zone: 'Australia/Sydney' },
        { id: 'a', label: 'again', zone: 'Asia/Tokyo' },
        { id: 'b', zone: 'Not/AZone' },
        { id: 'c', zone: 'America/New_York' },
        'junk'
      ])
    ).toEqual([
      { id: 'a', label: 'Mum', zone: 'Australia/Sydney' },
      { id: 'c', label: 'New York', zone: 'America/New_York' }
    ])
    expect(cleanClocks(null)).toEqual([])
  })
})
