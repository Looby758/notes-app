import { describe, expect, it } from 'vitest'
import { appendUnderHeading, formatEventLine, insertEvent, parseDatedItems, parseEventText, toggleTaskAt } from './schedule'

const opts = { dailyDate: '2026-10-26', scheduleHeading: 'Schedule', title: '2026-10-26' }

describe('parseEventText', () => {
  it('reads times and ranges', () => {
    expect(parseEventText('09:30-10:30 Standup #work')).toEqual({ start: '09:30', end: '10:30', title: 'Standup #work' })
    expect(parseEventText('14:00 Dentist')).toEqual({ start: '14:00', title: 'Dentist' })
    expect(parseEventText('9am – 11am Workshop')).toEqual({ start: '09:00', end: '11:00', title: 'Workshop' })
    expect(parseEventText('2:30pm Call')).toEqual({ start: '14:30', title: 'Call' })
  })
  it('treats anything else as all-day', () => {
    expect(parseEventText('Holiday')).toEqual({ title: 'Holiday' })
    expect(parseEventText('3 books to return')).toEqual({ title: '3 books to return' })
    expect(parseEventText('25:00 Not a time')).toEqual({ title: '25:00 Not a time' })
  })
})

describe('parseDatedItems', () => {
  it('finds events under the schedule heading of a daily note', () => {
    const text = '# Monday\n\n## Schedule\n\n- 09:30-10:30 Standup\n- [x] 14:00 Dentist\n- Holiday\n\n## Notes\n\n- not an event\n'
    const items = parseDatedItems(text, 'Daily/2026-10-26.md', opts)
    expect(items.map((i) => [i.kind, i.title, i.start ?? null, i.done ?? null])).toEqual([
      ['daily', '2026-10-26', null, null],
      ['event', 'Standup', '09:30', null],
      ['event', 'Dentist', '14:00', true],
      ['event', 'Holiday', null, null]
    ])
    expect(items[1].line).toBe(4)
  })

  it('ignores schedules in notes that are not daily notes', () => {
    const items = parseDatedItems('## Schedule\n- 10:00 Thing\n', 'Ideas.md', { ...opts, dailyDate: null })
    expect(items).toEqual([])
  })

  it('finds task due dates in any note', () => {
    const items = parseDatedItems('- [ ] Pay rent 📅 2026-10-30\n- [x] File taxes due:2026-11-02\n- No task 📅 2026-10-30', 'Todo.md', { ...opts, dailyDate: null })
    expect(items.map((i) => [i.date, i.title, i.done])).toEqual([
      ['2026-10-30', 'Pay rent', false],
      ['2026-11-02', 'File taxes', true]
    ])
  })

  it('reads frontmatter date and due', () => {
    const items = parseDatedItems('---\ndate: 2026-10-20\ndue: "2026-11-01"\n---\nBody', 'Report.md', { ...opts, dailyDate: null, title: 'Report' })
    expect(items.map((i) => [i.kind, i.date, i.due])).toEqual([
      ['note', '2026-10-20', false],
      ['note', '2026-11-01', true]
    ])
  })

  it('skips code blocks', () => {
    expect(parseDatedItems('```\n- [ ] x 📅 2026-10-30\n```', 'A.md', { ...opts, dailyDate: null })).toEqual([])
  })
})

describe('insertEvent', () => {
  it('adds a schedule section when there is none', () => {
    expect(insertEvent('# Monday\n', 'Schedule', formatEventLine('Lunch', '12:00', '13:00'))).toBe(
      '# Monday\n\n## Schedule\n\n- 12:00-13:00 Lunch\n'
    )
  })
  it('keeps timed events in order', () => {
    const text = '## Schedule\n\n- Holiday\n- 09:00 A\n- 15:00 C\n\n## Notes\n'
    expect(insertEvent(text, 'Schedule', '- 12:00 B')).toBe('## Schedule\n\n- Holiday\n- 09:00 A\n- 12:00 B\n- 15:00 C\n\n## Notes\n')
    expect(insertEvent(text, 'Schedule', '- 18:00 D')).toBe('## Schedule\n\n- Holiday\n- 09:00 A\n- 15:00 C\n- 18:00 D\n\n## Notes\n')
  })
  it('fills an empty section', () => {
    expect(insertEvent('## Schedule\n\n## Notes', 'Schedule', '- X')).toBe('## Schedule\n\n- X\n## Notes')
  })
})

describe('appendUnderHeading', () => {
  it('creates the heading at the end when missing', () => {
    expect(appendUnderHeading('# Day\n\nHello\n', 'Captured', '- idea')).toBe('# Day\n\nHello\n\n## Captured\n\n- idea\n')
  })
  it('adds after the last line of the section, before the next heading', () => {
    const text = '## Captured\n\n- one\n\n## Notes\nx'
    expect(appendUnderHeading(text, 'Captured', '- two')).toBe('## Captured\n\n- one\n- two\n\n## Notes\nx')
  })
  it('fills an empty section', () => {
    expect(appendUnderHeading('## Captured\n## Notes', 'Captured', '- a')).toBe('## Captured\n\n- a\n\n## Notes')
  })
  it('appends to the end with no heading', () => {
    expect(appendUnderHeading('# Inbox\n\n- old\n\n', '', '- new')).toBe('# Inbox\n\n- old\n- new\n')
    expect(appendUnderHeading('# Inbox\n\n', '', '- first')).toBe('# Inbox\n\n- first\n')
    expect(appendUnderHeading('Some text', '', '- item')).toBe('Some text\n\n- item\n')
  })
})

describe('toggleTaskAt', () => {
  it('ticks and unticks', () => {
    expect(toggleTaskAt('a\n- [ ] b', 1)).toBe('a\n- [x] b')
    expect(toggleTaskAt('- [x] b', 0)).toBe('- [ ] b')
    expect(toggleTaskAt('- b', 0)).toBeNull()
  })
})
