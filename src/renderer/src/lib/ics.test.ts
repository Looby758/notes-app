import { describe, expect, it } from 'vitest'
import { parseIcs } from '@shared/ics'

const wrap = (events: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.trim().replace(/\n/g, '\r\n')}\r\nEND:VCALENDAR\r\n`

const from = new Date(Date.UTC(2026, 9, 1))
const to = new Date(Date.UTC(2026, 11, 1))

describe('parseIcs', () => {
  it('reads timed UTC events, all-day events, folded lines and escapes', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:a
DTSTART:20261026T093000Z
DTEND:20261026T100000Z
SUMMARY:Standup\\, team
 sync
LOCATION:Room 1
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART;VALUE=DATE:20261030
DTEND;VALUE=DATE:20261101
SUMMARY:Trip
END:VEVENT`)
    const events = parseIcs(ics, from, to)
    expect(events).toEqual([
      { uid: 'a', title: 'Standup, teamsync', location: 'Room 1', url: undefined, allDay: false, start: '2026-10-26T09:30:00.000Z', end: '2026-10-26T10:00:00.000Z' },
      { uid: 'b', title: 'Trip', location: undefined, url: undefined, allDay: true, start: '2026-10-30', end: '2026-11-01' }
    ])
  })

  it('converts TZID times to the right instant', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:ny
DTSTART;TZID=America/New_York:20261026T090000
DTEND;TZID=America/New_York:20261026T100000
SUMMARY:NY meeting
END:VEVENT`)
    // New York is UTC−4 on 26 Oct 2026 (daylight time until 1 Nov).
    expect(parseIcs(ics, from, to)[0].start).toBe('2026-10-26T13:00:00.000Z')
  })

  it('keeps local wall-clock time across a daylight-saving change in repeats', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:w
DTSTART;TZID=Europe/London:20261023T090000
DTEND;TZID=Europe/London:20261023T093000
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:Weekly
END:VEVENT`)
    const [a, b] = parseIcs(ics, from, to)
    expect(a.start).toBe('2026-10-23T08:00:00.000Z') // BST
    expect(b.start).toBe('2026-10-30T09:00:00.000Z') // GMT, still 9 am in London
  })

  it('expands weekly repeats on several weekdays, with EXDATE and UNTIL', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:gym
DTSTART:20261005T180000Z
DTEND:20261005T190000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261015T000000Z
EXDATE:20261007T180000Z
SUMMARY:Gym
END:VEVENT`)
    expect(parseIcs(ics, from, to).map((e) => e.start.slice(0, 10))).toEqual(['2026-10-05', '2026-10-12', '2026-10-14'])
  })

  it('expands monthly "first Monday" and "last day" rules', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:m1
DTSTART;VALUE=DATE:20261005
RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3
SUMMARY:First Monday
END:VEVENT
BEGIN:VEVENT
UID:m2
DTSTART;VALUE=DATE:20261031
RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=2
SUMMARY:Month end
END:VEVENT`)
    const byTitle = (t: string): string[] => parseIcs(ics, from, new Date(Date.UTC(2027, 1, 1))).filter((e) => e.title === t).map((e) => e.start)
    expect(byTitle('First Monday')).toEqual(['2026-10-05', '2026-11-02', '2026-12-07'])
    expect(byTitle('Month end')).toEqual(['2026-10-31', '2026-11-30'])
  })

  it('replaces a moved occurrence and drops cancelled ones', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:s
DTSTART:20261001T100000Z
DTEND:20261001T110000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Series
END:VEVENT
BEGIN:VEVENT
UID:s
RECURRENCE-ID:20261002T100000Z
DTSTART:20261002T150000Z
DTEND:20261002T160000Z
SUMMARY:Series (moved)
END:VEVENT
BEGIN:VEVENT
UID:x
STATUS:CANCELLED
DTSTART:20261003T100000Z
SUMMARY:Gone
END:VEVENT`)
    expect(parseIcs(ics, from, to).map((e) => `${e.start.slice(0, 16)} ${e.title}`)).toEqual([
      '2026-10-01T10:00 Series',
      '2026-10-02T15:00 Series (moved)',
      '2026-10-03T10:00 Series'
    ])
  })

  it('only returns events in the requested range', () => {
    const ics = wrap(`
BEGIN:VEVENT
UID:old
DTSTART:20250101T100000Z
SUMMARY:Old
END:VEVENT
BEGIN:VEVENT
UID:daily
DTSTART:20200101T080000Z
DTEND:20200101T083000Z
RRULE:FREQ=DAILY
SUMMARY:Forever
END:VEVENT`)
    const events = parseIcs(ics, new Date(Date.UTC(2026, 9, 26)), new Date(Date.UTC(2026, 9, 28)))
    expect(events.map((e) => e.start.slice(0, 10))).toEqual(['2026-10-26', '2026-10-27'])
  })
})
