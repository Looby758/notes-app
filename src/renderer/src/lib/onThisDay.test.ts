import { describe, expect, it } from 'vitest'
import { earlierDays } from './onThisDay'

describe('earlierDays', () => {
  it('lists the same date in past months, then past years', () => {
    const days = earlierDays(new Date(2026, 9, 26), 2)
    expect(days.slice(0, 2)).toEqual([
      { key: '2026-09-26', label: '1 month ago' },
      { key: '2026-08-26', label: '2 months ago' }
    ])
    expect(days.slice(-2)).toEqual([
      { key: '2025-10-26', label: '1 year ago' },
      { key: '2024-10-26', label: '2 years ago' }
    ])
    expect(days).toHaveLength(13)
  })
  it('skips dates that do not exist', () => {
    const keys = earlierDays(new Date(2026, 4, 31), 1).map((d) => d.key)
    expect(keys).not.toContain('2026-04-31')
    expect(keys).toContain('2026-03-31')
    const leap = earlierDays(new Date(2028, 1, 29), 4).filter((d) => d.label.includes('year')).map((d) => d.key)
    expect(leap).toEqual(['2024-02-29'])
  })
})
