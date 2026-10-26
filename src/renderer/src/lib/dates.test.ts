import { describe, expect, it } from 'vitest'
import { addDays, dayKey, formatDate, fromDayKey, monthGrid, parseDate, startOfWeek } from './dates'
import { fillTemplate } from './templates'

const d = new Date(2026, 9, 5, 14, 7) // Monday 5 October 2026, 14:07

describe('formatDate', () => {
  it('formats common tokens', () => {
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-10-05')
    expect(formatDate(d, 'dddd D MMMM YYYY')).toBe('Monday 5 October 2026')
    expect(formatDate(d, 'ddd, MMM D')).toBe('Mon, Oct 5')
    expect(formatDate(d, 'HH:mm')).toBe('14:07')
    expect(formatDate(d, 'h:mm a')).toBe('2:07 pm')
    expect(formatDate(d, 'DD/MM/YY')).toBe('05/10/26')
    expect(formatDate(new Date(2026, 9, 5, 14, 7, 9), 'HHmmss')).toBe('140709')
  })

  it('keeps [bracketed] text literally', () => {
    expect(formatDate(d, '[Week of] D MMM')).toBe('Week of 5 Oct')
  })
})

describe('parseDate', () => {
  it('reads dates back in the same format', () => {
    expect(dayKey(parseDate('2026-10-05', 'YYYY-MM-DD')!)).toBe('2026-10-05')
    expect(dayKey(parseDate('Monday 5 October 2026', 'dddd D MMMM YYYY')!)).toBe('2026-10-05')
    expect(dayKey(parseDate('05/10/26', 'DD/MM/YY')!)).toBe('2026-10-05')
  })

  it('rejects text that does not match or impossible dates', () => {
    expect(parseDate('2026-02-30', 'YYYY-MM-DD')).toBeNull()
    expect(parseDate('Meeting notes', 'YYYY-MM-DD')).toBeNull()
  })
})

describe('calendar helpers', () => {
  it('finds the start of the week', () => {
    expect(dayKey(startOfWeek(d, 1))).toBe('2026-10-05') // Monday
    expect(dayKey(startOfWeek(d, 0))).toBe('2026-10-04') // Sunday
  })

  it('builds a 6-week month grid starting on the right day', () => {
    const grid = monthGrid(2026, 9, 1)
    expect(grid).toHaveLength(42)
    expect(dayKey(grid[0])).toBe('2026-09-28')
    expect(grid[0].getDay()).toBe(1)
  })

  it('round-trips day keys and moves across months', () => {
    expect(dayKey(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01')
    expect(fromDayKey('2026-13-01')).toBeNull()
  })
})

describe('fillTemplate', () => {
  it('fills placeholders and finds the cursor', () => {
    const { text, cursor } = fillTemplate('# {{title}}\n{{date}} {{weekday}}\n- {{cursor}}\n{{unknown}}', { title: 'Standup', date: d })
    expect(text).toBe('# Standup\n2026-10-05 Monday\n- \n{{unknown}}')
    expect(cursor).toBe(text.indexOf('- ') + 2)
  })

  it('supports custom date formats', () => {
    expect(fillTemplate('{{date:D MMM}} at {{time:h:mm a}}', { title: '', date: d }).text).toBe('5 Oct at 2:07 pm')
  })
})
