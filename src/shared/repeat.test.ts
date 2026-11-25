import { describe, expect, it } from 'vitest'
import { formatRepeat, moveRule, occurrences, parseRepeat, repeatChoices, toRRule, type RepeatRule } from './repeat'

describe('parseRepeat', () => {
  it('reads everyday ways of saying it', () => {
    expect(parseRepeat('every day')).toEqual({ freq: 'day', interval: 1 })
    expect(parseRepeat('daily')).toEqual({ freq: 'day', interval: 1 })
    expect(parseRepeat('every 3 days')).toEqual({ freq: 'day', interval: 3 })
    expect(parseRepeat('every Tuesday')).toEqual({ freq: 'week', interval: 1, weekdays: [2] })
    expect(parseRepeat('every tue and thu')).toEqual({ freq: 'week', interval: 1, weekdays: [2, 4] })
    expect(parseRepeat('every Monday, Wednesday and Friday')).toEqual({ freq: 'week', interval: 1, weekdays: [1, 3, 5] })
    expect(parseRepeat('every other Friday')).toEqual({ freq: 'week', interval: 2, weekdays: [5] })
    expect(parseRepeat('every 2 weeks on Thursday')).toEqual({ freq: 'week', interval: 2, weekdays: [4] })
    expect(parseRepeat('every weekday')).toEqual({ freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] })
    expect(parseRepeat('fortnightly')).toEqual({ freq: 'week', interval: 2 })
    expect(parseRepeat('every month on the 1st')).toEqual({ freq: 'month', interval: 1, monthDay: 1 })
    expect(parseRepeat('the 1st of every month')).toEqual({ freq: 'month', interval: 1, monthDay: 1 })
    expect(parseRepeat('the last Friday of every month')).toEqual({ freq: 'month', interval: 1, nth: { n: -1, weekday: 5 } })
    expect(parseRepeat('every month on the third Saturday')).toEqual({ freq: 'month', interval: 1, nth: { n: 3, weekday: 6 } })
    expect(parseRepeat('every month on the last day')).toEqual({ freq: 'month', interval: 1, monthDay: -1 })
    expect(parseRepeat('every year')).toEqual({ freq: 'year', interval: 1 })
    expect(parseRepeat('every Tuesday until 2027-01-31 except 2026-12-22, 2026-12-29')).toEqual({
      freq: 'week',
      interval: 1,
      weekdays: [2],
      until: '2027-01-31',
      except: ['2026-12-22', '2026-12-29']
    })
  })
  it('says no to things that are not rules', () => {
    expect(parseRepeat('sometimes')).toBeNull()
    expect(parseRepeat('every blue moon')).toBeNull()
    expect(parseRepeat('every month on the 40th')).toBeNull()
    expect(parseRepeat('')).toBeNull()
  })
  it('writes rules back the same way they are read', () => {
    for (const text of ['every day', 'every 3 days', 'every Tuesday', 'every Tuesday and Thursday', 'every 2 weeks on Friday', 'every weekday', 'every month on the 1st', 'every month on the last day', 'every month on the third Saturday', 'every year', 'every Monday until 2027-01-01 except 2026-12-28']) {
      expect(formatRepeat(parseRepeat(text)!)).toBe(text)
    }
  })
})

describe('occurrences', () => {
  const rule = (t: string): RepeatRule => parseRepeat(t)!
  it('weekly on a day', () => {
    // 2026-11-17 is a Tuesday.
    expect(occurrences(rule('every Tuesday'), '2026-11-17', '2026-11-01', '2026-12-08')).toEqual(['2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08'])
  })
  it('the start day always counts, even before the first match', () => {
    // Written on a Monday, repeating on Tuesdays.
    expect(occurrences(rule('every Tuesday'), '2026-11-16', '2026-11-01', '2026-11-24')).toEqual(['2026-11-16', '2026-11-17', '2026-11-24'])
  })
  it('every other week keeps to the start week', () => {
    expect(occurrences(rule('every other Friday'), '2026-11-06', '2026-11-01', '2026-12-31')).toEqual(['2026-11-06', '2026-11-20', '2026-12-04', '2026-12-18'])
    // Asking from the middle gives the same days.
    expect(occurrences(rule('every other Friday'), '2026-11-06', '2026-12-01', '2026-12-31')).toEqual(['2026-12-04', '2026-12-18'])
  })
  it('weekdays', () => {
    expect(occurrences(rule('every weekday'), '2026-11-20', '2026-11-20', '2026-11-25')).toEqual(['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25'])
  })
  it('every few days lines up with the start', () => {
    expect(occurrences(rule('every 3 days'), '2026-11-01', '2026-11-05', '2026-11-12')).toEqual(['2026-11-07', '2026-11-10'])
  })
  it('monthly on a date skips months without it', () => {
    expect(occurrences(rule('every month on the 31st'), '2026-10-31', '2026-10-01', '2027-03-31')).toEqual(['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31'])
    expect(occurrences(rule('the 1st of every month'), '2026-11-01', '2027-01-01', '2027-03-01')).toEqual(['2027-01-01', '2027-02-01', '2027-03-01'])
  })
  it('monthly on the last day and the nth weekday', () => {
    expect(occurrences(rule('every month on the last day'), '2026-11-30', '2026-11-01', '2027-02-28')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
    expect(occurrences(rule('every month on the third Saturday'), '2026-11-21', '2026-11-01', '2027-01-31')).toEqual(['2026-11-21', '2026-12-19', '2027-01-16'])
    expect(occurrences(rule('the last Friday of every month'), '2026-11-27', '2026-11-01', '2027-01-31')).toEqual(['2026-11-27', '2026-12-25', '2027-01-29'])
  })
  it('yearly, including 29 February', () => {
    expect(occurrences(rule('every year'), '2024-02-29', '2024-01-01', '2029-01-01')).toEqual(['2024-02-29', '2028-02-29'])
    expect(occurrences(rule('every year'), '2020-11-21', '2026-01-01', '2027-12-31')).toEqual(['2026-11-21', '2027-11-21'])
  })
  it('stops at until and skips except days', () => {
    expect(occurrences(rule('every Tuesday until 2026-12-08 except 2026-11-24'), '2026-11-17', '2026-11-01', '2027-01-01')).toEqual(['2026-11-17', '2026-12-01', '2026-12-08'])
  })
  it('nothing before the start', () => {
    expect(occurrences(rule('every day'), '2026-11-21', '2026-11-01', '2026-11-20')).toEqual([])
  })
})

describe('toRRule', () => {
  it('matches Google Calendar', () => {
    expect(toRRule(parseRepeat('every Tuesday')!, '2026-11-17')).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU')
    expect(toRRule(parseRepeat('every week')!, '2026-11-17')).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU')
    expect(toRRule(parseRepeat('every 2 weeks on Mon and Wed')!, '2026-11-16')).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
    expect(toRRule(parseRepeat('every month on the 1st until 2027-06-30')!, '2026-12-01')).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270630T235959Z')
    expect(toRRule(parseRepeat('the last friday of every month')!, '2026-11-27')).toBe('RRULE:FREQ=MONTHLY;BYDAY=-1FR')
    expect(toRRule(parseRepeat('every year')!, '2026-11-21')).toBe('RRULE:FREQ=YEARLY')
  })
})

describe('moveRule', () => {
  it('follows the event to its new day', () => {
    expect(formatRepeat(moveRule(parseRepeat('every Tuesday')!, '2026-11-17', '2026-11-18'))).toBe('every Wednesday')
    expect(formatRepeat(moveRule(parseRepeat('every month on the 1st')!, '2026-12-01', '2026-12-03'))).toBe('every month on the 3rd')
    expect(formatRepeat(moveRule(parseRepeat('every month on the third Saturday')!, '2026-11-21', '2026-11-20'))).toBe('every month on the third Friday')
    expect(formatRepeat(moveRule(parseRepeat('every day except 2026-11-25')!, '2026-11-21', '2026-11-22'))).toBe('every day except 2026-11-26')
  })
})

describe('repeatChoices', () => {
  it('is worded for the day', () => {
    const labels = repeatChoices('2026-11-21').map((c) => c.label)
    expect(labels).toContain('Every Saturday')
    expect(labels).toContain('Every month on the 21st')
    expect(labels).toContain('Every month on the third Saturday')
  })
})
