import { describe, expect, it } from 'vitest'
import { dayKeyOf, findWhen } from './when'

// Monday 26 October 2026, 14:00.
const now = new Date(2026, 9, 26, 14, 0)
const at = (text: string): { day: string; time?: string; title: string; hasDate: boolean } | null => {
  const w = findWhen(text, now)
  return w && { day: dayKeyOf(w.date), time: w.time, title: w.title, hasDate: w.hasDate }
}

describe('findWhen', () => {
  it('reads the example from the plan', () => {
    expect(at('Going to watch The Walking Dead with Jack at around 20:00 today')).toEqual({
      day: '2026-10-26',
      time: '20:00',
      title: 'Going to watch The Walking Dead with Jack',
      hasDate: true
    })
  })
  it('understands days', () => {
    expect(at('Dentist tomorrow at 9:30')).toMatchObject({ day: '2026-10-27', time: '09:30', title: 'Dentist' })
    expect(at('Call mum on Friday')).toMatchObject({ day: '2026-10-30', title: 'Call mum' })
    expect(at('Gym next monday 7am')).toMatchObject({ day: '2026-11-02', time: '07:00', title: 'Gym' })
    expect(at('Party on 31st October at 8pm')).toMatchObject({ day: '2026-10-31', time: '20:00', title: 'Party' })
    expect(at('Flight Dec 3rd 06:15')).toMatchObject({ day: '2026-12-03', time: '06:15', title: 'Flight' })
    expect(at('Pay rent 1/11')).toMatchObject({ day: '2026-11-01', title: 'Pay rent' })
    expect(at('Review in 2 weeks')).toMatchObject({ day: '2026-11-09', title: 'Review' })
    expect(at('Thing 2026-12-25')).toMatchObject({ day: '2026-12-25', title: 'Thing' })
    // A date earlier in the year means next year.
    expect(at('Birthday 3 March')).toMatchObject({ day: '2027-03-03' })
  })
  it('understands times', () => {
    expect(at('Lunch with Sam at noon')).toMatchObject({ day: '2026-10-26', time: '12:00', title: 'Lunch with Sam', hasDate: false })
    expect(at('Movie at 8')).toMatchObject({ time: '20:00', title: 'Movie' })
    expect(at('Call at 10')).toMatchObject({ time: '22:00' })
    expect(at('Call tomorrow at 10')).toMatchObject({ time: '10:00' })
    expect(at('Pick up 12:30am')).toMatchObject({ time: '00:30' })
    expect(at('Run 6:45 pm tonight')).toMatchObject({ day: '2026-10-26', time: '18:45', title: 'Run' })
  })
  it('leaves ordinary text alone', () => {
    expect(at('Buy 2 eggs and 3 apples')).toBeNull()
    expect(at('Idea: a notes app with maps')).toBeNull()
    expect(at('Read chapter 12 of the book')).toBeNull()
  })
})
