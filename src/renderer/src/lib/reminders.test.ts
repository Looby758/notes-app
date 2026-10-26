import { describe, expect, it } from 'vitest'
import { dueReminders, fillInDates, parseReminders, reminderTime } from './reminders'

const text = [
  '- [ ] Call the dentist ⏰ 2026-10-28 15:00',
  '- [x] Done already ⏰ 2026-10-28 09:00',
  '- [ ] Stand-up ⏰ 9:30',
  '- Not a task ⏰ 2026-10-28 10:00',
  '- [ ] Bad time ⏰ 2026-10-28 25:00',
  '```',
  '- [ ] in code ⏰ 2026-10-28 11:00',
  '```'
].join('\n')

describe('parseReminders', () => {
  it('reads dated reminders on open tasks', () => {
    const { reminders, undated } = parseReminders(text, 'Todo.md', null)
    expect(reminders.map((r) => [r.title, r.date, r.time, r.line])).toEqual([['Call the dentist', '2026-10-28', '15:00', 0]])
    expect(undated).toEqual([2])
  })
  it('uses the daily note\'s date for a bare time', () => {
    const { reminders } = parseReminders(text, 'Daily/2026-10-26.md', '2026-10-26')
    expect(reminders.map((r) => [r.title, r.date, r.time])).toContainEqual(['Stand-up', '2026-10-26', '09:30'])
  })
})

describe('fillInDates', () => {
  it("adds today's date to a bare time", () => {
    expect(fillInDates(text, [2], '2026-10-26').split('\n')[2]).toBe('- [ ] Stand-up ⏰ 2026-10-26 9:30')
  })
})

describe('dueReminders', () => {
  const { reminders } = parseReminders('- [ ] A ⏰ 2026-10-28 15:00\n- [ ] B ⏰ 2026-10-27 08:00\n- [ ] C ⏰ 2026-10-29 08:00\n- [ ] D ⏰ 2026-10-01 08:00', 'x.md', null)
  it('finds what is due now and what was missed', () => {
    const now = new Date(2026, 9, 28, 15, 1)
    const { due, missed } = dueReminders(reminders, new Set(), now)
    expect(due.map((r) => r.title)).toEqual(['A'])
    expect(missed.map((r) => r.title)).toEqual(['B'])
    expect(dueReminders(reminders, new Set([due[0].key]), now).due).toEqual([])
  })
  it('works out the moment', () => {
    expect(reminderTime({ date: '2026-10-28', time: '15:00' }).getHours()).toBe(15)
  })
})
