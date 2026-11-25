import { describe, expect, it } from 'vitest'
import { compactJson, djPicks, freeSlots, outlineToHeadings, songsFor, themeColours } from './claudeHelpers'
import type { LocalSong } from './localMusic'

const song = (title: string, artist: string, genre?: string, durationMs = 180_000): LocalSong => ({ path: `${title}.mp3`, title, artist, album: '', track: 0, durationMs, art: false, genre })

describe('freeSlots', () => {
  it('finds the gaps around what’s on', () => {
    const slots = freeSlots([{ date: '2026-11-25', start: '10:00', end: '11:30' }, { date: '2026-11-25', start: '14:00' }], ['2026-11-25', '2026-11-26'], '09:00', '18:00', 45)
    expect(slots).toEqual([
      { date: '2026-11-25', start: '09:00', end: '10:00', minutes: 60 },
      { date: '2026-11-25', start: '11:30', end: '14:00', minutes: 150 },
      { date: '2026-11-25', start: '15:00', end: '18:00', minutes: 180 },
      { date: '2026-11-26', start: '09:00', end: '18:00', minutes: 540 }
    ])
  })
})

describe('music picks', () => {
  const songs = [song('A', 'Ruelle', 'Pop'), song('B', 'Ruelle', 'Pop'), song('C', 'Ruelle', 'Pop'), song('D', 'Other', 'Pop'), song('E', 'Metal Band', 'Metal')]

  it('plays more like the song that’s on, two per artist at most', () => {
    const picks = djPicks(songs[0], songs, { playlists: [], avoid: new Set(), liked: new Set(), ratings: {}, count: 3, rand: () => 0 })
    expect(picks.map((s) => s.title)).toEqual(['B', 'C', 'D'])
  })

  it('picks songs for a mood, about as long as asked', () => {
    const picks = songsFor(songs, { genres: ['pop'] }, {}, 7, () => 0.5)
    expect(picks).toHaveLength(3)
    expect(picks.every((s) => s.genre === 'Pop')).toBe(true)
  })
})

describe('themes and tidying', () => {
  it('makes readable colours from one colour', () => {
    const dark = themeColours('#6b2fbf', false)
    expect(dark.bg).toMatch(/^#[0-9a-f]{6}$/)
    expect(parseInt(dark.bg.slice(1, 3), 16)).toBeLessThan(40)
    expect(parseInt(dark.textStrong.slice(1, 3), 16)).toBeGreaterThan(200)
  })

  it('leaves out pictures', () => {
    expect(compactJson({ name: 'x', skin: 'abc', icon: 'data:image/png;base64,xx', n: 1 })).toBe('{"name":"x","n":1}')
  })

  it('turns an outline into headings', () => {
    expect(outlineToHeadings('Plants', '- Roots\n  - Water\n- Leaves')).toBe('# Plants\n\n## Roots\n\n### Water\n\n## Leaves\n')
  })
})
